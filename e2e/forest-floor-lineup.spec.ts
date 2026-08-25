import { expect, test, type Locator, type Page } from '@playwright/test';

type ForestFloorDataset = Record<string, string>;
type CaptureMode = 'baseline' | 'ivy' | 'nettles' | 'twigs' | 'final';

type RenderEvidence = {
  mode: CaptureMode;
  ivyAttached: boolean;
  nettleGroupAttached: boolean;
  twigGroupAttached: boolean;
  ivySubmissions: number;
  nettleSubmissions: number;
  twigSubmissions: number;
  renderCalls: number;
  triangles: number;
};

type PixelEvidence = {
  width: number;
  height: number;
  changedPixels: number;
  lowerChangedPixels: number;
  meanAbsDelta: number;
  meanReferenceRed: number;
  meanReferenceGreen: number;
  meanReferenceBlue: number;
  meanTargetRed: number;
  meanTargetGreen: number;
  meanTargetBlue: number;
  meanTargetLuminance: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function monitorRuntime(page: Page): { runtimeErrors: string[]; failedRequests: string[] } {
  const runtimeErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      runtimeErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`,
    );
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  return { runtimeErrors, failedRequests };
}

function expectCleanRuntime(runtimeErrors: string[], failedRequests: string[]): void {
  const unexpectedRuntimeErrors = runtimeErrors.filter((message) => !(
    /No available adapters\./.test(message)
    || /THREE\.WebGPURenderer: WebGPU is not available, running under WebGL2 backend\./.test(message)
    || /GL Driver Message .* GPU stall due to ReadPixels/.test(message)
  ));
  expect(unexpectedRuntimeErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
}

async function setCaptureMode(page: Page, mode: CaptureMode): Promise<RenderEvidence> {
  return page.evaluate(async (nextMode) => {
    const capture = (
      window as Window & {
        __FOREST_FLOOR_SET_CAPTURE_MODE__?: (
          requestedMode: CaptureMode,
        ) => Promise<RenderEvidence>;
      }
    ).__FOREST_FLOOR_SET_CAPTURE_MODE__;
    if (!capture) throw new Error('Forest-floor capture hook is unavailable.');
    return capture(nextMode);
  }, mode);
}

async function comparePngFrames(
  page: Page,
  reference: Buffer,
  target: Buffer,
): Promise<PixelEvidence> {
  return page.evaluate(async ({ referenceBase64, targetBase64 }) => {
    async function decodePng(base64: string): Promise<HTMLImageElement> {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      return image;
    }

    const [referenceImage, targetImage] = await Promise.all([
      decodePng(referenceBase64),
      decodePng(targetBase64),
    ]);
    if (
      referenceImage.naturalWidth !== targetImage.naturalWidth
      || referenceImage.naturalHeight !== targetImage.naturalHeight
    ) {
      throw new Error('Forest-floor comparison frames have different dimensions.');
    }

    const width = referenceImage.naturalWidth;
    const height = referenceImage.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create forest-floor comparison context.');

    context.drawImage(referenceImage, 0, 0);
    const referenceData = context.getImageData(0, 0, width, height).data;
    context.clearRect(0, 0, width, height);
    context.drawImage(targetImage, 0, 0);
    const targetData = context.getImageData(0, 0, width, height).data;

    let changedPixels = 0;
    let lowerChangedPixels = 0;
    let absoluteDelta = 0;
    let referenceRed = 0;
    let referenceGreen = 0;
    let referenceBlue = 0;
    let targetRed = 0;
    let targetGreen = 0;
    let targetBlue = 0;
    let targetLuminance = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let offset = 0; offset < targetData.length; offset += 4) {
      const redDelta = Math.abs(targetData[offset]! - referenceData[offset]!);
      const greenDelta = Math.abs(targetData[offset + 1]! - referenceData[offset + 1]!);
      const blueDelta = Math.abs(targetData[offset + 2]! - referenceData[offset + 2]!);
      if (Math.max(redDelta, greenDelta, blueDelta) < 8) continue;

      const pixelIndex = offset / 4;
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      changedPixels += 1;
      if (y >= height * 0.25) lowerChangedPixels += 1;
      absoluteDelta += (redDelta + greenDelta + blueDelta) / 3;
      referenceRed += referenceData[offset]!;
      referenceGreen += referenceData[offset + 1]!;
      referenceBlue += referenceData[offset + 2]!;
      targetRed += targetData[offset]!;
      targetGreen += targetData[offset + 1]!;
      targetBlue += targetData[offset + 2]!;
      targetLuminance += targetData[offset]! * 0.2126
        + targetData[offset + 1]! * 0.7152
        + targetData[offset + 2]! * 0.0722;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const divisor = Math.max(changedPixels, 1);
    return {
      width,
      height,
      changedPixels,
      lowerChangedPixels,
      meanAbsDelta: absoluteDelta / divisor,
      meanReferenceRed: referenceRed / divisor,
      meanReferenceGreen: referenceGreen / divisor,
      meanReferenceBlue: referenceBlue / divisor,
      meanTargetRed: targetRed / divisor,
      meanTargetGreen: targetGreen / divisor,
      meanTargetBlue: targetBlue / divisor,
      meanTargetLuminance: targetLuminance / divisor,
      minX: changedPixels > 0 ? minX : -1,
      minY: changedPixels > 0 ? minY : -1,
      maxX,
      maxY,
    };
  }, {
    referenceBase64: reference.toString('base64'),
    targetBase64: target.toString('base64'),
  });
}

async function captureCanvas(canvas: Locator): Promise<Buffer> {
  return canvas.screenshot({ animations: 'disabled' });
}

const seasons = [
  ['summer', { snow: '0.00', spring: '0.00', autumn: '0.00', dormancy: '0.00' }],
  ['autumn', { snow: '0.00', spring: '0.00', autumn: '1.00', dormancy: '0.18' }],
  ['winter', { snow: '0.86', spring: '0.00', autumn: '0.00', dormancy: '1.00' }],
] as const;

for (const [season, expected] of seasons) {
  test(`Forest-floor authored lineup — ${season}`, async ({ page }, testInfo) => {
    const runtime = monitorRuntime(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    const url = `/forest-floor-lineup.html?view=near&clean=1&time=4&season=${season}`;
    await page.goto(url);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    const dataset = await page.evaluate(
      () => ({ ...document.body.dataset }) as ForestFloorDataset,
    );

    expect(dataset.season).toBe(season);
    expect(dataset.view).toBe('near');
    expect(dataset.animationTime).toBe('4.00');
    expect(dataset.ivySnowCoverage).toBe(expected.snow);
    expect(dataset.nettleSpringFlush).toBe(expected.spring);
    expect(dataset.nettleAutumnColor).toBe(expected.autumn);
    expect(dataset.nettleDormancy).toBe(expected.dormancy);
    expect(Number(dataset.ivyPatches)).toBe(7);
    expect(Number(dataset.ivyRunners)).toBe(7);
    expect(Number(dataset.ivyLeaves)).toBe(294);
    expect(Number(dataset.ivyDrawCalls)).toBe(1);
    expect(Number(dataset.ivyTriangles)).toBe(5_880);
    expect(Number(dataset.ivyMaxHeight)).toBe(0.22);
    expect(Number(dataset.nettleInstances)).toBeGreaterThanOrEqual(25);
    expect(Number(dataset.nettleColonies)).toBeGreaterThanOrEqual(20);
    expect(Number(dataset.nettleResidentInstances)).toBe(Number(dataset.nettleInstances));
    expect(Number(dataset.nettleDrawCalls)).toBeGreaterThan(0);
    expect(Number(dataset.nettleDrawCalls)).toBeLessThanOrEqual(6);
    expect(Number(dataset.nettleTriangles)).toBeGreaterThan(2_500);
    const defaultTreeCount = Number(dataset.nettleDefaultTreeCount);
    const defaultNettleCount = Number(dataset.nettleDefaultCount);
    const defaultNettleColonies = Number(dataset.nettleDefaultColonies);
    expect(defaultTreeCount).toBeGreaterThan(10_000);
    expect(defaultNettleCount).toBeGreaterThan(defaultTreeCount * 5);
    expect(defaultNettleCount).toBeLessThan(defaultTreeCount * 6);
    expect(defaultNettleColonies).toBeGreaterThan(defaultTreeCount * 0.75);
    expect(Number(dataset.nettleDefaultMedianColonySize)).toBeGreaterThanOrEqual(6);
    expect(Number(dataset.nettleDefaultNearestP90)).toBeLessThan(4.8);
    expect(Number(dataset.nettleDefaultNearestP95)).toBeLessThan(7.5);
    expect(Number(dataset.nettleDefaultTreesWithoutFiveMeters)).toBeLessThan(defaultTreeCount * 0.1);
    expect(Number(dataset.nettleDefaultTreesWithoutEightMeters)).toBeLessThan(defaultTreeCount * 0.05);
    expect(Number(dataset.nettleDefaultUniqueSources)).toBe(defaultNettleColonies);
    expect(Number(dataset.nettleDefaultMaximumSourceIndex)).toBeGreaterThan(10_000);
    const defaultNettleVariantCounts = (dataset.nettleDefaultVariantCounts ?? '')
      .split(',')
      .map(Number);
    expect(defaultNettleVariantCounts).toHaveLength(3);
    expect(defaultNettleVariantCounts.reduce((sum, count) => sum + count, 0)).toBe(
      defaultNettleCount,
    );
    for (const count of defaultNettleVariantCounts) {
      expect(count).toBeGreaterThan(defaultNettleCount * 0.3);
    }
    expect(Number(dataset.twigInstances)).toBe(18);
    expect(Number(dataset.twigDrawCalls)).toBe(3);
    expect(Number(dataset.twigPrototypeVertices)).toBe(174);
    expect(Number(dataset.twigSubmittedTriangles)).toBe(1_296);
    expect(dataset.forestFloorSignature).toMatch(new RegExp(`^${season}:4\\.00:`));

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(1_200);
    expect(box?.height ?? 0).toBeGreaterThan(680);

    if (season === 'summer') {
      const firstSignature = dataset.forestFloorSignature;
      await page.reload();
      await page.waitForFunction(() => document.body.dataset.ready === 'true');
      await expect.poll(
        () => page.evaluate(() => document.body.dataset.forestFloorSignature),
      ).toBe(firstSignature);
    }

    const baselineEvidence = await setCaptureMode(page, 'baseline');
    const baselineFrame = await captureCanvas(canvas);
    const repeatedBaselineEvidence = await setCaptureMode(page, 'baseline');
    const repeatedBaselineFrame = await captureCanvas(canvas);
    const baselineNoise = await comparePngFrames(page, baselineFrame, repeatedBaselineFrame);

    const ivyEvidence = await setCaptureMode(page, 'ivy');
    const ivyFrame = await captureCanvas(canvas);
    const ivyPixels = await comparePngFrames(page, baselineFrame, ivyFrame);

    const nettleEvidence = await setCaptureMode(page, 'nettles');
    const nettleFrame = await captureCanvas(canvas);
    const nettlePixels = await comparePngFrames(page, baselineFrame, nettleFrame);

    const twigEvidence = await setCaptureMode(page, 'twigs');
    const twigFrame = await captureCanvas(canvas);
    const twigPixels = await comparePngFrames(page, baselineFrame, twigFrame);

    const finalEvidence = await setCaptureMode(page, 'final');
    const finalFrame = await captureCanvas(canvas);

    console.log(`[forest-floor-render] ${season}: ${JSON.stringify({
      baselineEvidence,
      ivyEvidence,
      nettleEvidence,
      twigEvidence,
      finalEvidence,
      baselineNoise,
      ivyPixels,
      nettlePixels,
      twigPixels,
    })}`);

    expect(baselineEvidence).toMatchObject({
      mode: 'baseline',
      ivyAttached: true,
      nettleGroupAttached: true,
      twigGroupAttached: true,
      ivySubmissions: 0,
      nettleSubmissions: 0,
      twigSubmissions: 0,
    });
    expect(repeatedBaselineEvidence).toMatchObject({
      mode: 'baseline',
      ivySubmissions: 0,
      nettleSubmissions: 0,
      twigSubmissions: 0,
    });
    expect(ivyEvidence).toMatchObject({
      mode: 'ivy',
      ivyAttached: true,
      nettleGroupAttached: true,
      twigGroupAttached: true,
      nettleSubmissions: 0,
      twigSubmissions: 0,
    });
    expect(ivyEvidence.ivySubmissions).toBe(Number(dataset.ivyDrawCalls));
    expect(ivyEvidence.renderCalls).toBeGreaterThan(baselineEvidence.renderCalls);
    expect(nettleEvidence).toMatchObject({
      mode: 'nettles',
      ivySubmissions: 0,
      nettleGroupAttached: true,
      twigGroupAttached: true,
      twigSubmissions: 0,
    });
    expect(nettleEvidence.nettleSubmissions).toBe(Number(dataset.nettleDrawCalls));
    expect(nettleEvidence.renderCalls).toBeGreaterThan(baselineEvidence.renderCalls);
    expect(twigEvidence).toMatchObject({
      mode: 'twigs',
      ivySubmissions: 0,
      nettleGroupAttached: true,
      twigGroupAttached: true,
      nettleSubmissions: 0,
    });
    expect(twigEvidence.twigSubmissions).toBe(Number(dataset.twigDrawCalls));
    expect(twigEvidence.renderCalls).toBeGreaterThan(baselineEvidence.renderCalls);
    expect(finalEvidence.ivySubmissions).toBe(Number(dataset.ivyDrawCalls));
    expect(finalEvidence.nettleSubmissions).toBe(Number(dataset.nettleDrawCalls));
    expect(finalEvidence.twigSubmissions).toBe(Number(dataset.twigDrawCalls));
    // WebGPU's WebGL2 fallback counts multi-material groups differently from
    // onBeforeRender. The exact submission hooks plus pixel deltas prove the
    // authored layers rendered; renderer.info only needs to move upward.
    expect(finalEvidence.renderCalls).toBeGreaterThan(nettleEvidence.renderCalls);
    expect(finalEvidence.renderCalls).toBeGreaterThan(twigEvidence.renderCalls);
    if (finalEvidence.triangles > baselineEvidence.triangles) {
      expect(ivyEvidence.triangles - baselineEvidence.triangles).toBe(
        Number(dataset.ivyTriangles),
      );
      expect(nettleEvidence.triangles - baselineEvidence.triangles).toBe(
        Number(dataset.nettleTriangles),
      );
      expect(twigEvidence.triangles - baselineEvidence.triangles).toBe(
        Number(dataset.twigSubmittedTriangles),
      );
    } else {
      expect([
        baselineEvidence.triangles,
        ivyEvidence.triangles,
        nettleEvidence.triangles,
        twigEvidence.triangles,
        finalEvidence.triangles,
      ]).toEqual([0, 0, 0, 0, 0]);
    }

    expect(baselineNoise.changedPixels).toBeLessThan(25);
    expect(ivyPixels.changedPixels).toBeGreaterThan(
      Math.max(500, baselineNoise.changedPixels * 10 + 100),
    );
    expect(nettlePixels.changedPixels).toBeGreaterThan(
      Math.max(750, baselineNoise.changedPixels * 10 + 100),
    );
    expect(twigPixels.changedPixels).toBeGreaterThan(
      Math.max(100, baselineNoise.changedPixels * 10 + 25),
    );
    expect(ivyPixels.lowerChangedPixels / ivyPixels.changedPixels).toBeGreaterThan(0.9);
    expect(nettlePixels.lowerChangedPixels / nettlePixels.changedPixels).toBeGreaterThan(0.9);
    expect(twigPixels.lowerChangedPixels / twigPixels.changedPixels).toBeGreaterThan(0.9);
    expect(ivyPixels.meanAbsDelta).toBeGreaterThan(8);
    expect(nettlePixels.meanAbsDelta).toBeGreaterThan(10);
    expect(twigPixels.meanAbsDelta).toBeGreaterThan(8);
    expect(ivyPixels.meanTargetLuminance).toBeGreaterThan(14);
    expect(nettlePixels.meanTargetLuminance).toBeGreaterThan(18);
    expect(twigPixels.meanTargetLuminance).toBeGreaterThan(18);
    if (season === 'summer') {
      expect(nettlePixels.meanTargetGreen).toBeGreaterThan(nettlePixels.meanTargetRed);
      expect(nettlePixels.meanTargetGreen).toBeGreaterThan(nettlePixels.meanTargetBlue + 5);
    } else {
      expect(nettlePixels.meanTargetRed).toBeGreaterThan(nettlePixels.meanTargetBlue + 4);
    }
    if (season !== 'winter') {
      expect(ivyPixels.meanTargetGreen).toBeGreaterThan(ivyPixels.meanTargetRed);
      expect(ivyPixels.meanTargetGreen).toBeGreaterThan(ivyPixels.meanTargetBlue + 3);
    }
    expect(twigPixels.meanTargetRed).toBeGreaterThan(twigPixels.meanTargetBlue + 3);

    if (process.env.E2E_CAPTURE === '1') {
      await setCaptureMode(page, 'ivy');
      await canvas.screenshot({
        path: `test-results/forest-floor-ivy-${season}.png`,
        animations: 'disabled',
      });
      await setCaptureMode(page, 'final');
      await canvas.screenshot({
        path: `test-results/forest-floor-${season}.png`,
        animations: 'disabled',
      });
      await testInfo.attach(`forest-floor-${season}`, {
        body: finalFrame,
        contentType: 'image/png',
      });
    }

    expectCleanRuntime(runtime.runtimeErrors, runtime.failedRequests);
  });
}
