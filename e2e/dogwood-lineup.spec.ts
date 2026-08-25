import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type DogwoodCaptureMode = 'baseline' | 'stems' | 'foliage' | 'final';

type DogwoodRenderEvidence = {
  mode: DogwoodCaptureMode;
  groupAttached: boolean;
  stemSubmissions: number;
  foliageSubmissions: number;
  renderCalls: number;
};

type PixelEvidence = {
  changedPixels: number;
  meanAbsDelta: number;
  meanTargetRed: number;
  meanTargetGreen: number;
  meanTargetBlue: number;
  meanTargetLuminance: number;
  minY: number;
  maxY: number;
};

type RuntimeMonitor = {
  runtimeErrors: string[];
  failedRequests: string[];
};

function monitorRuntime(page: Page): RuntimeMonitor {
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

function expectCleanRuntime(monitor: RuntimeMonitor): void {
  const unexpectedRuntimeErrors = monitor.runtimeErrors.filter((message) => !(
    /No available adapters\./.test(message)
    || /THREE\.WebGPURenderer: WebGPU is not available, running under WebGL2 backend\./.test(message)
    || /GL Driver Message .* GPU stall due to ReadPixels/.test(message)
  ));
  expect(unexpectedRuntimeErrors).toEqual([]);
  expect(monitor.failedRequests).toEqual([]);
}

async function setCaptureMode(
  page: Page,
  mode: DogwoodCaptureMode,
): Promise<DogwoodRenderEvidence> {
  return page.evaluate(async (nextMode) => {
    const capture = (
      window as Window & {
        __DOGWOOD_LINEUP_CAPTURE__?: (
          requestedMode: DogwoodCaptureMode,
        ) => Promise<DogwoodRenderEvidence>;
      }
    ).__DOGWOOD_LINEUP_CAPTURE__;
    if (!capture) throw new Error('Dogwood capture hook is unavailable.');
    return capture(nextMode);
  }, mode);
}

async function captureCanvas(canvas: Locator): Promise<Buffer> {
  return canvas.screenshot();
}

async function comparePngFrames(
  page: Page,
  reference: Buffer,
  target: Buffer,
): Promise<PixelEvidence> {
  return page.evaluate(async ({ referenceBase64, targetBase64 }) => {
    async function decode(base64: string): Promise<HTMLImageElement> {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      return image;
    }
    const [referenceImage, targetImage] = await Promise.all([
      decode(referenceBase64),
      decode(targetBase64),
    ]);
    if (
      referenceImage.naturalWidth !== targetImage.naturalWidth
      || referenceImage.naturalHeight !== targetImage.naturalHeight
    ) {
      throw new Error('Dogwood comparison frames have different dimensions.');
    }
    const width = referenceImage.naturalWidth;
    const height = referenceImage.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create dogwood pixel comparison context.');
    context.drawImage(referenceImage, 0, 0);
    const referenceData = context.getImageData(0, 0, width, height).data;
    context.clearRect(0, 0, width, height);
    context.drawImage(targetImage, 0, 0);
    const targetData = context.getImageData(0, 0, width, height).data;

    let changedPixels = 0;
    let absoluteDelta = 0;
    let targetRed = 0;
    let targetGreen = 0;
    let targetBlue = 0;
    let targetLuminance = 0;
    let minY = height;
    let maxY = -1;
    for (let offset = 0; offset < targetData.length; offset += 4) {
      const redDelta = Math.abs(targetData[offset]! - referenceData[offset]!);
      const greenDelta = Math.abs(targetData[offset + 1]! - referenceData[offset + 1]!);
      const blueDelta = Math.abs(targetData[offset + 2]! - referenceData[offset + 2]!);
      if (Math.max(redDelta, greenDelta, blueDelta) < 8) continue;
      const y = Math.floor((offset / 4) / width);
      changedPixels += 1;
      absoluteDelta += (redDelta + greenDelta + blueDelta) / 3;
      targetRed += targetData[offset]!;
      targetGreen += targetData[offset + 1]!;
      targetBlue += targetData[offset + 2]!;
      targetLuminance += targetData[offset]! * 0.2126
        + targetData[offset + 1]! * 0.7152
        + targetData[offset + 2]! * 0.0722;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const divisor = Math.max(changedPixels, 1);
    return {
      changedPixels,
      meanAbsDelta: absoluteDelta / divisor,
      meanTargetRed: targetRed / divisor,
      meanTargetGreen: targetGreen / divisor,
      meanTargetBlue: targetBlue / divisor,
      meanTargetLuminance: targetLuminance / divisor,
      minY: changedPixels > 0 ? minY : -1,
      maxY,
    };
  }, {
    referenceBase64: reference.toString('base64'),
    targetBase64: target.toString('base64'),
  });
}

const cases = [
  ['near', 'summer', '0.84', { autumn: '0.00', dormancy: '0.00', shadow: '1.0000' }],
  ['design', 'autumn', '1.00', { autumn: '1.00', dormancy: '0.18', shadow: '0.8488' }],
  ['far', 'winter', '1.25', { autumn: '0.00', dormancy: '1.00', shadow: '0.1600' }],
] as const;

for (const [view, season, scale, expected] of cases) {
  test(`Common dogwood rendered contract — ${view} ${season}`, async ({ page }, testInfo) => {
    const runtime = monitorRuntime(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(
      `/shrub-lineup.html?focus=dogwood&view=${view}&season=${season}&time=4&scale=${scale}`,
    );
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    const dataset = await page.evaluate(() => ({ ...document.body.dataset }));

    expect(dataset.focus).toBe('dogwood');
    expect(dataset.view).toBe(view);
    expect(dataset.season).toBe(season);
    expect(dataset.animationTime).toBe('4.00');
    expect(dataset.dogwoodScale).toBe(scale);
    expect(dataset.dogwoodAutumnColor).toBe(expected.autumn);
    expect(dataset.dogwoodDormancy).toBe(expected.dormancy);
    expect(Number(dataset.dogwoodInstances)).toBe(3);
    expect(dataset.dogwoodStemCounts).toBe('12,19,27');
    expect(Number(dataset.dogwoodDefaultTarget)).toBe(1_180);
    expect(Number(dataset.dogwoodDefaultAccepted)).toBe(1_180);
    expect(Number(dataset.dogwoodDefaultCount)).toBeGreaterThanOrEqual(100);
    expect(Number(dataset.dogwoodDefaultCount)).toBeLessThanOrEqual(230);
    expect(Number(dataset.dogwoodDefaultMinimumScale)).toBeGreaterThanOrEqual(0.84);
    expect(Number(dataset.dogwoodDefaultMinimumScale)).toBeLessThan(0.9);
    expect(Number(dataset.dogwoodDefaultMaximumScale)).toBeGreaterThan(1.2);
    expect(Number(dataset.dogwoodDefaultMaximumScale)).toBeLessThanOrEqual(1.25);
    expect(dataset.dogwoodDefaultSignature).toMatch(/^[0-9a-f]{8}$/);
    expect(dataset.dogwoodRepeatedSignature).toBe(dataset.dogwoodDefaultSignature);
    expect(Number(dataset.dogwoodTriangles)).toBeGreaterThan(24_000);
    expect(Number(dataset.dogwoodTriangles)).toBeLessThan(26_000);
    expect(Number(dataset.dogwoodLeafyDrawCalls)).toBe(9);
    expect(Number(dataset.dogwoodBareDrawCalls)).toBe(6);
    expect(dataset.dogwoodShadowWidths).toBe(
      [expected.shadow, expected.shadow, expected.shadow].join(','),
    );
    const finalHeights = (dataset.dogwoodFinalHeights ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    expect(finalHeights).toHaveLength(3);
    expect(Math.max(...finalHeights)).toBeLessThanOrEqual(3.4);
    expect(Math.min(...finalHeights)).toBeGreaterThanOrEqual(2);
    const groundContacts = (dataset.dogwoodGroundContacts ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    expect(groundContacts).toHaveLength(3);
    for (const groundContact of groundContacts) {
      expect(groundContact).toBeGreaterThanOrEqual(-0.01);
      expect(groundContact).toBeLessThanOrEqual(0.006);
    }
    const groundOrigins = (dataset.dogwoodGroundOrigins ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    expect(groundOrigins).toHaveLength(3);
    for (const groundOrigin of groundOrigins) expect(groundOrigin).toBeCloseTo(0.006, 5);
    if (scale === '0.84') expect(Math.max(...finalHeights)).toBeLessThan(2.3);
    if (scale === '1.25') expect(Math.min(...finalHeights)).toBeGreaterThan(3);
    expect(dataset.dogwoodSignature).toMatch(
      new RegExp(`^${view}:${season}:4\\.00:${scale}:`),
    );

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(1_200);
    expect(box?.height ?? 0).toBeGreaterThan(600);

    if (view === 'near') {
      const signature = dataset.dogwoodSignature;
      await page.reload();
      await page.waitForFunction(() => document.body.dataset.ready === 'true');
      expect(await page.evaluate(() => document.body.dataset.dogwoodSignature)).toBe(signature);
    }

    const baselineEvidence = await setCaptureMode(page, 'baseline');
    const baselineFrame = await captureCanvas(canvas);
    await setCaptureMode(page, 'baseline');
    const repeatedBaselineFrame = await captureCanvas(canvas);
    const baselineNoise = await comparePngFrames(page, baselineFrame, repeatedBaselineFrame);

    const stemEvidence = await setCaptureMode(page, 'stems');
    const stemFrame = await captureCanvas(canvas);
    const stemPixels = await comparePngFrames(page, baselineFrame, stemFrame);

    const foliageEvidence = await setCaptureMode(page, 'foliage');
    const foliageFrame = await captureCanvas(canvas);
    const foliagePixels = await comparePngFrames(page, baselineFrame, foliageFrame);

    const finalEvidence = await setCaptureMode(page, 'final');
    const finalFrame = await captureCanvas(canvas);
    const foliageOverStems = await comparePngFrames(page, stemFrame, finalFrame);

    expect(baselineEvidence).toMatchObject({
      mode: 'baseline',
      groupAttached: true,
      stemSubmissions: 0,
      foliageSubmissions: 0,
    });
    expect(stemEvidence).toMatchObject({
      mode: 'stems',
      groupAttached: true,
      stemSubmissions: 3,
      foliageSubmissions: 0,
    });
    expect(foliageEvidence).toMatchObject({
      mode: 'foliage',
      groupAttached: true,
      stemSubmissions: 0,
      foliageSubmissions: season === 'winter' ? 0 : 3,
    });
    expect(finalEvidence).toMatchObject({
      mode: 'final',
      groupAttached: true,
      stemSubmissions: 3,
      foliageSubmissions: season === 'winter' ? 0 : 3,
    });
    expect(stemEvidence.renderCalls).toBeGreaterThan(baselineEvidence.renderCalls);
    expect(foliageEvidence.renderCalls).toBeGreaterThanOrEqual(baselineEvidence.renderCalls);
    expect(finalEvidence.renderCalls).toBeGreaterThanOrEqual(stemEvidence.renderCalls);

    expect(baselineNoise.changedPixels).toBeLessThan(25);
    expect(stemPixels.changedPixels).toBeGreaterThan(100);
    expect(stemPixels.meanAbsDelta).toBeGreaterThan(8);
    expect(stemPixels.meanTargetLuminance).toBeGreaterThan(12);
    if (season === 'winter') {
      expect(foliagePixels.changedPixels).toBeLessThanOrEqual(
        Math.max(40, baselineNoise.changedPixels * 2 + 10),
      );
      expect(foliageOverStems.changedPixels).toBeLessThanOrEqual(
        Math.max(40, baselineNoise.changedPixels * 2 + 10),
      );
    } else {
      expect(foliagePixels.changedPixels).toBeGreaterThan(400);
      expect(foliagePixels.meanAbsDelta).toBeGreaterThan(9);
      expect(foliagePixels.meanTargetLuminance).toBeGreaterThan(15);
      expect(foliageOverStems.changedPixels).toBeGreaterThan(300);
      if (season === 'summer') {
        expect(foliagePixels.meanTargetGreen).toBeGreaterThan(foliagePixels.meanTargetRed + 3);
        expect(foliagePixels.meanTargetGreen).toBeGreaterThan(foliagePixels.meanTargetBlue + 5);
      } else {
        expect(foliagePixels.meanTargetRed).toBeGreaterThan(foliagePixels.meanTargetGreen + 5);
        expect(foliagePixels.meanTargetRed).toBeGreaterThan(foliagePixels.meanTargetBlue + 8);
      }
    }

    console.log(`[dogwood-lineup] ${view}/${season}: ${JSON.stringify({
      finalHeights,
      groundContacts,
      groundOrigins,
      baselineEvidence,
      stemEvidence,
      foliageEvidence,
      finalEvidence,
      baselineNoise,
      stemPixels,
      foliagePixels,
      foliageOverStems,
    })}`);

    if (process.env.E2E_CAPTURE === '1') {
      const capturePath = testInfo.outputPath(`dogwood-${view}-${season}.png`);
      await writeFile(capturePath, finalFrame);
      await testInfo.attach(`dogwood-${view}-${season}`, {
        path: capturePath,
        contentType: 'image/png',
      });
    }
    expectCleanRuntime(runtime);
  });
}
