import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type DogwoodCaptureMode = 'baseline' | 'stems' | 'foliage' | 'final';

type DogwoodRenderEvidence = {
  mode: DogwoodCaptureMode;
  groupAttached: boolean;
  stemSubmissions: number;
  foliageSubmissions: number;
  renderCalls: number;
  timeSeconds: number;
  windStrength: number;
  variant: number | null;
  rendererBackend: string;
  nodeMaterial: boolean;
};

type DogwoodCaptureOptions = {
  timeSeconds?: number;
  windStrength?: number;
  variant?: number | null;
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
  options?: DogwoodCaptureOptions,
): Promise<DogwoodRenderEvidence> {
  return page.evaluate(async ({ nextMode, captureOptions }) => {
    const capture = (
      window as Window & {
        __DOGWOOD_LINEUP_CAPTURE__?: (
          requestedMode: DogwoodCaptureMode,
          requestedOptions?: DogwoodCaptureOptions,
        ) => Promise<DogwoodRenderEvidence>;
      }
    ).__DOGWOOD_LINEUP_CAPTURE__;
    if (!capture) throw new Error('Dogwood capture hook is unavailable.');
    return capture(nextMode, captureOptions);
  }, { nextMode: mode, captureOptions: options });
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
  ['near', 'spring', '1.08', {
    spring: '0.85', autumn: '0.00', dormancy: '0.15', stemRed: '0.15', snow: '0.00', month: '4', shadow: '0.8740',
  }],
  ['near', 'summer', '0.98', {
    spring: '0.00', autumn: '0.00', dormancy: '0.00', stemRed: '0.00', snow: '0.00', month: '7', shadow: '1.0000',
  }],
  ['design', 'autumn', '1.20', {
    spring: '0.00', autumn: '1.00', dormancy: '0.18', stemRed: '0.63', snow: '0.00', month: '10', shadow: '0.8488',
  }],
  ['far', 'winter', '1.42', {
    spring: '0.00', autumn: '0.00', dormancy: '1.00', stemRed: '1.00', snow: '0.86', month: '1', shadow: '0.1600',
  }],
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
    expect(dataset.dogwoodSpringFlush).toBe(expected.spring);
    expect(dataset.dogwoodAutumnColor).toBe(expected.autumn);
    expect(dataset.dogwoodDormancy).toBe(expected.dormancy);
    expect(dataset.dogwoodSnowCoverage).toBe(expected.snow);
    expect(dataset.dogwoodStemAutumnColor).toBe(expected.autumn);
    expect(dataset.dogwoodStemDormancy).toBe(expected.dormancy);
    expect(dataset.dogwoodStemRedReveal).toBe(expected.stemRed);
    expect(dataset.dogwoodStemSeasonStrategy).toBe('age-aware-autumn-to-winter-red');
    expect(dataset.raspberrySpringFlush).toBe(expected.spring);
    expect(dataset.raspberryAutumnColor).toBe(expected.autumn);
    expect(dataset.raspberryDormancy).toBe(expected.dormancy);
    expect(dataset.raspberrySnowCoverage).toBe(expected.snow);
    expect(dataset.berryPreviewMonth).toBe(expected.month);
    if (season === 'winter') {
      expect(Number(dataset.visibleRaspberryFruit)).toBe(0);
    } else {
      expect(Number(dataset.visibleRaspberryFruit)).toBeGreaterThan(0);
    }
    expect(dataset.dogwoodRendererBackend).toMatch(/^(?:webgpu|webgl2-node)$/);
    expect(dataset.dogwoodNodeMaterial).toBe('true');
    expect(Number(dataset.dogwoodInstances)).toBe(3);
    expect(dataset.dogwoodStemCounts).toBe('12,19,27');
    expect(Number(dataset.dogwoodDefaultTarget)).toBe(7_375);
    expect(Number(dataset.dogwoodDefaultAccepted)).toBe(7_375);
    expect(Number(dataset.dogwoodDefaultTreeCount)).toBeGreaterThan(10_000);
    expect(Number(dataset.dogwoodDefaultRockCount)).toBeGreaterThan(300);
    expect(Number(dataset.dogwoodDefaultCount)).toBeGreaterThanOrEqual(1_300);
    expect(Number(dataset.dogwoodDefaultCount)).toBeLessThanOrEqual(1_750);
    expect(Number(dataset.dogwoodDefaultMinimumScale)).toBeGreaterThanOrEqual(0.98);
    expect(Number(dataset.dogwoodDefaultMinimumScale)).toBeLessThan(1);
    expect(Number(dataset.dogwoodDefaultMaximumScale)).toBeGreaterThan(1.39);
    expect(Number(dataset.dogwoodDefaultMaximumScale)).toBeLessThanOrEqual(1.42);
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
    expect(Math.max(...finalHeights)).toBeLessThanOrEqual(3.56);
    expect(Math.min(...finalHeights)).toBeGreaterThanOrEqual(2.35);
    expect(Math.max(...finalHeights) - Math.min(...finalHeights)).toBeGreaterThan(0.08);
    const finalWidthsX = (dataset.dogwoodFinalWidthsX ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    const finalWidthsZ = (dataset.dogwoodFinalWidthsZ ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    expect(finalWidthsX).toHaveLength(3);
    expect(finalWidthsZ).toHaveLength(3);
    expect(Math.min(...finalWidthsX, ...finalWidthsZ)).toBeGreaterThan(1.5);
    // Rotated AABBs may approach the full 2 × 1.85 m dogwood clearance
    // envelope at maximum scale; the structural suite checks radial clearance.
    expect(Math.max(...finalWidthsX, ...finalWidthsZ)).toBeLessThanOrEqual(3.7);
    const morphologyValues = (raw: string | undefined): number[] => (raw ?? '')
      .split(',')
      .filter(Boolean)
      .map(Number);
    const lowestFoliageMeters = morphologyValues(dataset.dogwoodLowestFoliageMeters);
    const lowestFoliageRatios = morphologyValues(dataset.dogwoodLowestFoliageRatios);
    const firstForkMeters = morphologyValues(dataset.dogwoodFirstForkMeters);
    const firstForkRatios = morphologyValues(dataset.dogwoodFirstForkRatios);
    const lowerThirdFoliageRatios = morphologyValues(
      dataset.dogwoodLowerThirdFoliageRatios,
    );
    const basalBranchFanScores = morphologyValues(dataset.dogwoodBasalBranchFanScores);
    const rootBaseSpreads = morphologyValues(dataset.dogwoodRootBaseSpreads);
    const rootAzimuthGapCvs = morphologyValues(dataset.dogwoodRootAzimuthGapCvs);
    const firstForkLengthRanges = morphologyValues(dataset.dogwoodFirstForkLengthRanges);
    const forkSiblingLengthRatios = morphologyValues(dataset.dogwoodForkSiblingLengthRatios);
    const canopyOppositeSectorImbalances = morphologyValues(
      dataset.dogwoodCanopyOppositeSectorImbalances,
    );
    const canopySectorCvs = morphologyValues(dataset.dogwoodCanopySectorCvs);
    for (const values of [
      lowestFoliageMeters,
      lowestFoliageRatios,
      firstForkMeters,
      firstForkRatios,
      lowerThirdFoliageRatios,
      basalBranchFanScores,
      rootBaseSpreads,
      rootAzimuthGapCvs,
      firstForkLengthRanges,
      forkSiblingLengthRatios,
      canopyOppositeSectorImbalances,
      canopySectorCvs,
    ]) {
      expect(values).toHaveLength(3);
      expect(values.every(Number.isFinite)).toBe(true);
    }
    for (const height of lowestFoliageMeters) expect(height).toBeLessThanOrEqual(0.45);
    for (const ratio of lowestFoliageRatios) expect(ratio).toBeLessThanOrEqual(0.2);
    for (const height of firstForkMeters) expect(height).toBeLessThanOrEqual(0.43);
    for (const ratio of firstForkRatios) expect(ratio).toBeLessThanOrEqual(0.18);
    for (const ratio of lowerThirdFoliageRatios) expect(ratio).toBeGreaterThanOrEqual(0.2);
    for (const score of basalBranchFanScores) expect(score).toBeGreaterThanOrEqual(0.3);
    for (const spread of rootBaseSpreads) {
      expect(spread).toBeGreaterThanOrEqual(0.04);
      expect(spread).toBeLessThanOrEqual(0.12);
    }
    for (const variation of rootAzimuthGapCvs) {
      expect(variation).toBeGreaterThanOrEqual(0.18);
      expect(variation).toBeLessThanOrEqual(0.7);
    }
    for (const range of firstForkLengthRanges) {
      expect(range).toBeGreaterThanOrEqual(0.12);
      expect(range).toBeLessThanOrEqual(0.18);
    }
    for (const ratio of forkSiblingLengthRatios) {
      expect(ratio).toBeGreaterThanOrEqual(1.18);
      expect(ratio).toBeLessThanOrEqual(1.5);
    }
    for (const imbalance of canopyOppositeSectorImbalances) {
      expect(imbalance).toBeGreaterThanOrEqual(0.2);
    }
    for (const variation of canopySectorCvs) {
      expect(variation).toBeGreaterThanOrEqual(0.2);
    }
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
    if (scale === '0.98') expect(Math.max(...finalHeights)).toBeLessThan(2.7);
    if (scale === '1.42') {
      expect(Math.min(...finalHeights)).toBeGreaterThan(3.4);
      expect(new Set(finalHeights.map((height) => height.toFixed(3))).size).toBe(3);
    }
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
      nodeMaterial: true,
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
      if (season === 'spring' || season === 'summer') {
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

test('Common dogwood stems transition from summer bark to vivid winter red', async ({ page }, testInfo) => {
  const runtime = monitorRuntime(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto('/shrub-lineup.html?focus=dogwood&view=near&season=summer&time=4&scale=1.20');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  expect(await page.evaluate(() => document.body.dataset.dogwoodStemRedReveal)).toBe('0.00');
  await setCaptureMode(page, 'stems', { timeSeconds: 4, windStrength: 0 });
  const summerFrame = await captureCanvas(page.locator('canvas'));

  await page.goto('/shrub-lineup.html?focus=dogwood&view=near&season=winter&time=4&scale=1.20');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  const winterDataset = await page.evaluate(() => ({ ...document.body.dataset }));
  expect(winterDataset.dogwoodStemRedReveal).toBe('1.00');
  expect(winterDataset.dogwoodStemSeasonStrategy).toBe('age-aware-autumn-to-winter-red');
  await setCaptureMode(page, 'stems', { timeSeconds: 4, windStrength: 0 });
  const winterFrame = await captureCanvas(page.locator('canvas'));
  const transitionPixels = await comparePngFrames(page, summerFrame, winterFrame);

  expect(transitionPixels.changedPixels).toBeGreaterThan(1_000);
  expect(transitionPixels.meanAbsDelta).toBeGreaterThan(10);
  expect(transitionPixels.meanTargetRed).toBeGreaterThan(transitionPixels.meanTargetGreen + 8);
  expect(transitionPixels.meanTargetRed).toBeGreaterThan(transitionPixels.meanTargetBlue + 20);

  if (process.env.E2E_CAPTURE === '1') {
    const summerPath = testInfo.outputPath('dogwood-stems-summer.png');
    const winterPath = testInfo.outputPath('dogwood-stems-winter-red.png');
    await Promise.all([
      writeFile(summerPath, summerFrame),
      writeFile(winterPath, winterFrame),
    ]);
    await testInfo.attach('dogwood-stems-summer', {
      path: summerPath,
      contentType: 'image/png',
    });
    await testInfo.attach('dogwood-stems-winter-red', {
      path: winterPath,
      contentType: 'image/png',
    });
  }
  console.log(`[dogwood-stem-season] ${JSON.stringify({ transitionPixels })}`);
  expectCleanRuntime(runtime);
});

test('Common dogwood leaf motion is rooted, deterministic, and SeedThree-responsive', async ({ page }, testInfo) => {
  const runtime = monitorRuntime(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/shrub-lineup.html?focus=dogwood&view=near&season=summer&time=2.5&scale=1.20');
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();

  const movingPixelCounts: number[][] = [];
  const checkpoints = [1.25, 5, 8] as const;
  for (let variant = 0; variant < 3; variant++) {
    const startEvidence = await setCaptureMode(page, 'foliage', {
      timeSeconds: 2.5,
      windStrength: 0.55,
      variant,
    });
    const startFrame = await captureCanvas(canvas);
    await setCaptureMode(page, 'foliage', {
      timeSeconds: 2.5,
      windStrength: 0.55,
      variant,
    });
    const repeatedStartFrame = await captureCanvas(canvas);
    const repeatedNoise = await comparePngFrames(page, startFrame, repeatedStartFrame);

    const checkpointEvidence: DogwoodRenderEvidence[] = [];
    const checkpointFrames: Buffer[] = [];
    const checkpointDeltas: PixelEvidence[] = [];
    for (const timeSeconds of checkpoints) {
      checkpointEvidence.push(await setCaptureMode(page, 'foliage', {
        timeSeconds,
        windStrength: 0.55,
        variant,
      }));
      const frame = await captureCanvas(canvas);
      checkpointFrames.push(frame);
      checkpointDeltas.push(await comparePngFrames(page, startFrame, frame));
    }

    await setCaptureMode(page, 'foliage', {
      timeSeconds: 2.5,
      windStrength: 0.55,
      variant,
    });
    const rewoundFrame = await captureCanvas(canvas);
    const rewindNoise = await comparePngFrames(page, startFrame, rewoundFrame);

    expect(startEvidence).toMatchObject({
      mode: 'foliage',
      variant,
      timeSeconds: 2.5,
      windStrength: 0.55,
      stemSubmissions: 0,
      foliageSubmissions: 1,
    });
    for (let index = 0; index < checkpoints.length; index++) {
      expect(checkpointEvidence[index]).toMatchObject({
        mode: 'foliage',
        variant,
        timeSeconds: checkpoints[index],
        windStrength: 0.55,
        stemSubmissions: 0,
        foliageSubmissions: 1,
        nodeMaterial: true,
      });
    }
    expect(repeatedNoise.changedPixels).toBeLessThan(5);
    expect(rewindNoise.changedPixels).toBeLessThan(5);
    for (const movingPixels of checkpointDeltas) {
      expect(movingPixels.changedPixels).toBeGreaterThan(
        Math.max(500, repeatedNoise.changedPixels * 5 + 100),
      );
      expect(movingPixels.meanAbsDelta).toBeGreaterThan(6);
      expect(movingPixels.minY).toBeGreaterThan(12);
      expect(movingPixels.maxY).toBeLessThan(708);
    }
    movingPixelCounts.push(checkpointDeltas.map((evidence) => evidence.changedPixels));

    if (process.env.E2E_CAPTURE === '1') {
      const startPath = testInfo.outputPath(`dogwood-motion-variant-${variant}-start.png`);
      const endPath = testInfo.outputPath(`dogwood-motion-variant-${variant}-end.png`);
      await Promise.all([
        writeFile(startPath, startFrame),
        writeFile(endPath, checkpointFrames.at(-1)!),
      ]);
      await testInfo.attach(`dogwood-motion-variant-${variant}-start`, {
        path: startPath,
        contentType: 'image/png',
      });
      await testInfo.attach(`dogwood-motion-variant-${variant}-end`, {
        path: endPath,
        contentType: 'image/png',
      });
    }
  }

  await setCaptureMode(page, 'foliage', {
    timeSeconds: 0,
    windStrength: 0,
    variant: 1,
  });
  const stillStart = await captureCanvas(canvas);
  await setCaptureMode(page, 'foliage', {
    timeSeconds: 12,
    windStrength: 0,
    variant: 1,
  });
  const stillEnd = await captureCanvas(canvas);
  const stillNoise = await comparePngFrames(page, stillStart, stillEnd);
  expect(stillNoise.changedPixels).toBeLessThan(25);
  expect(movingPixelCounts).toHaveLength(3);
  console.log(`[dogwood-motion] ${JSON.stringify({ movingPixelCounts, stillNoise })}`);
  expectCleanRuntime(runtime);
});
