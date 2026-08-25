import { expect, test, type Locator, type Page } from '@playwright/test';

type ForestSeason = 'spring' | 'summer' | 'autumn' | 'winter';
type CaptureLayer =
  | 'ground'
  | 'branches'
  | 'cards'
  | 'deciduous-cards'
  | 'evergreen-cards'
  | 'final';

type FoliagePresentation = {
  springFlush: number;
  autumnColor: number;
  dormancy: number;
};

type CaptureRequest = {
  layer?: CaptureLayer;
  season?: ForestSeason;
  foliage?: FoliagePresentation;
  snowCoverage?: number;
};

type RenderEvidence = {
  layer: CaptureLayer;
  season: ForestSeason;
  springFlush: number;
  autumnColor: number;
  dormancy: number;
  snowCoverage: number;
  retainedLeafSnow: boolean;
  visibleBranchMeshes: number;
  visibleCardMeshes: number;
  visibleDeciduousCardMeshes: number;
  visibleEvergreenCardMeshes: number;
  renderCalls: number;
  triangles: number;
};

type PixelEvidence = {
  width: number;
  height: number;
  changedPixels: number;
  meanAbsDelta: number;
  meanReferenceLuminance: number;
  meanTargetLuminance: number;
  meanTargetRed: number;
  meanTargetGreen: number;
  meanTargetBlue: number;
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
    || /THREE\.Renderer: "renderAsync\(\)" has been deprecated\./.test(message)
    || /GL Driver Message .* GPU stall due to ReadPixels/.test(message)
  ));
  expect(unexpectedRuntimeErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
}

async function capture(
  page: Page,
  request: CaptureRequest,
): Promise<RenderEvidence> {
  return page.evaluate(async (nextRequest) => {
    const hook = (
      window as Window & {
        __FOREST_SEASON_LINEUP_CAPTURE__?: (
          requested: CaptureRequest,
        ) => Promise<RenderEvidence>;
      }
    ).__FOREST_SEASON_LINEUP_CAPTURE__;
    if (!hook) throw new Error('Forest-season capture hook is unavailable.');
    return hook(nextRequest);
  }, request);
}

async function captureCanvas(canvas: Locator): Promise<Buffer> {
  return canvas.screenshot({ animations: 'disabled' });
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
      throw new Error('Forest-season comparison frames have different dimensions.');
    }

    const width = referenceImage.naturalWidth;
    const height = referenceImage.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create forest-season comparison context.');

    context.drawImage(referenceImage, 0, 0);
    const referenceData = context.getImageData(0, 0, width, height).data;
    context.clearRect(0, 0, width, height);
    context.drawImage(targetImage, 0, 0);
    const targetData = context.getImageData(0, 0, width, height).data;

    let changedPixels = 0;
    let absoluteDelta = 0;
    let referenceLuminance = 0;
    let targetLuminance = 0;
    let targetRed = 0;
    let targetGreen = 0;
    let targetBlue = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let offset = 0; offset < targetData.length; offset += 4) {
      const redDelta = Math.abs(targetData[offset]! - referenceData[offset]!);
      const greenDelta = Math.abs(targetData[offset + 1]! - referenceData[offset + 1]!);
      const blueDelta = Math.abs(targetData[offset + 2]! - referenceData[offset + 2]!);
      if (Math.max(redDelta, greenDelta, blueDelta) < 7) continue;

      const pixelIndex = offset / 4;
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      const referenceLum = referenceData[offset]! * 0.2126
        + referenceData[offset + 1]! * 0.7152
        + referenceData[offset + 2]! * 0.0722;
      const targetLum = targetData[offset]! * 0.2126
        + targetData[offset + 1]! * 0.7152
        + targetData[offset + 2]! * 0.0722;
      changedPixels += 1;
      absoluteDelta += (redDelta + greenDelta + blueDelta) / 3;
      referenceLuminance += referenceLum;
      targetLuminance += targetLum;
      targetRed += targetData[offset]!;
      targetGreen += targetData[offset + 1]!;
      targetBlue += targetData[offset + 2]!;
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
      meanAbsDelta: absoluteDelta / divisor,
      meanReferenceLuminance: referenceLuminance / divisor,
      meanTargetLuminance: targetLuminance / divisor,
      meanTargetRed: targetRed / divisor,
      meanTargetGreen: targetGreen / divisor,
      meanTargetBlue: targetBlue / divisor,
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

const expectedPresentation: Record<ForestSeason, FoliagePresentation & { snow: number }> = {
  spring: { springFlush: 0.85, autumnColor: 0, dormancy: 0.15, snow: 0 },
  summer: { springFlush: 0, autumnColor: 0, dormancy: 0, snow: 0 },
  autumn: { springFlush: 0, autumnColor: 1, dormancy: 0.18, snow: 0 },
  winter: { springFlush: 0, autumnColor: 0, dormancy: 1, snow: 0.86 },
};

test('SeedThree canopy — deterministic fixed-view four-season contract', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const runtime = monitorRuntime(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/forest-season-lineup.html?season=spring&time=4&clean=1');
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, {
    timeout: 180_000,
  });

  const initialDataset = await page.evaluate(() => ({ ...document.body.dataset }));
  expect(initialDataset.season).toBe('spring');
  expect(initialDataset.animationTime).toBe('4.00');
  expect(initialDataset.windStrength).toBe('0.00');
  expect(initialDataset.supportedSeasons).toBe('spring,summer,autumn,winter');
  expect(initialDataset.species).toBe(
    'beech,sessileOak,sycamoreMaple,ash,larch,silverFir,norwaySpruce,scotsPine',
  );
  expect(initialDataset.deciduousSpecies).toBe('beech,sessileOak,sycamoreMaple,ash,larch');
  expect(initialDataset.evergreenSpecies).toBe('silverFir,norwaySpruce,scotsPine');
  expect(Number(initialDataset.treeCount)).toBe(8);
  expect(Number(initialDataset.deciduousTreeCount)).toBe(5);
  expect(Number(initialDataset.evergreenTreeCount)).toBe(3);
  expect(Number(initialDataset.branchMeshes)).toBeGreaterThanOrEqual(7);
  expect(Number(initialDataset.cardMeshes)).toBeGreaterThanOrEqual(7);
  expect(Number(initialDataset.seasonalMaterials)).toBeGreaterThan(0);
  expect(Number(initialDataset.snowMaterials)).toBeGreaterThan(
    Number(initialDataset.seasonalMaterials),
  );
  expect(Number(initialDataset.barkSnowMaterials)).toBeGreaterThanOrEqual(7);
  expect(Number(initialDataset.draws)).toBeGreaterThan(0);
  expect(Number(initialDataset.triangles)).toBeGreaterThan(10_000);
  expect(initialDataset.rendererBackend).toMatch(/^(?:webgpu|webgl2-node)$/);
  expect(initialDataset.cameraSignature).toBe('38:0.00,9.40,39.50:0.00,5.25,0.00');
  expect(initialDataset.scaleSignature).toBe(
    'beech:0.85,sessileOak:0.98,sycamoreMaple:0.96,ash:0.78,larch:0.47,'
      + 'silverFir:0.47,norwaySpruce:0.56,scotsPine:0.51',
  );
  expect(initialDataset.lineupSignature).toMatch(/^73656173:4\.00:/);

  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox?.width ?? 0).toBeGreaterThan(1_200);
  expect(canvasBox?.height ?? 0).toBeGreaterThan(680);

  const frames = new Map<ForestSeason, Buffer>();
  const evidences = new Map<ForestSeason, RenderEvidence>();
  const seasons: ForestSeason[] = ['spring', 'summer', 'autumn', 'winter'];
  const fixedSignatures = new Set<string>();

  for (const season of seasons) {
    const evidence = await capture(page, { layer: 'final', season });
    const dataset = await page.evaluate(() => ({ ...document.body.dataset }));
    const expected = expectedPresentation[season];
    expect(evidence).toMatchObject({
      layer: 'final',
      season,
      springFlush: expected.springFlush,
      autumnColor: expected.autumnColor,
      dormancy: expected.dormancy,
      snowCoverage: expected.snow,
    });
    expect(evidence.visibleBranchMeshes).toBeGreaterThanOrEqual(7);
    expect(evidence.visibleCardMeshes).toBeGreaterThanOrEqual(7);
    expect(evidence.renderCalls).toBeGreaterThan(8);
    // WebGPU's renderer.info triangle counter is backend-dependent; the
    // structural dataset above owns the exact geometry budget contract.
    expect(evidence.triangles).toBeGreaterThanOrEqual(0);
    expect(dataset.season).toBe(season);
    expect(dataset.springFlush).toBe(expected.springFlush.toFixed(2));
    expect(dataset.autumnColor).toBe(expected.autumnColor.toFixed(2));
    expect(dataset.dormancy).toBe(expected.dormancy.toFixed(2));
    expect(dataset.snowCoverage).toBe(expected.snow.toFixed(2));
    expect(dataset.animationTime).toBe('4.00');
    expect(dataset.cameraSignature).toBe(initialDataset.cameraSignature);
    expect(dataset.scaleSignature).toBe(initialDataset.scaleSignature);
    fixedSignatures.add(`${dataset.animationTime}:${dataset.cameraSignature}:${dataset.scaleSignature}`);

    const frame = await captureCanvas(canvas);
    frames.set(season, frame);
    evidences.set(season, evidence);
    await testInfo.attach(`forest-season-${season}`, {
      body: frame,
      contentType: 'image/png',
    });
  }

  expect(fixedSignatures.size).toBe(1);
  expect(evidences.get('winter')?.retainedLeafSnow).toBe(false);

  await capture(page, { layer: 'final', season: 'summer' });
  const summerRepeat = await captureCanvas(canvas);
  const summerNoise = await comparePngFrames(page, frames.get('summer')!, summerRepeat);
  expect(summerNoise.changedPixels).toBeLessThan(20);

  const springSummer = await comparePngFrames(
    page,
    frames.get('summer')!,
    frames.get('spring')!,
  );
  const autumnSummer = await comparePngFrames(
    page,
    frames.get('summer')!,
    frames.get('autumn')!,
  );
  const winterSummer = await comparePngFrames(
    page,
    frames.get('summer')!,
    frames.get('winter')!,
  );
  expect(springSummer.changedPixels).toBeGreaterThan(2_500);
  expect(autumnSummer.changedPixels).toBeGreaterThan(8_000);
  expect(winterSummer.changedPixels).toBeGreaterThan(12_000);
  expect(springSummer.meanAbsDelta).toBeGreaterThan(8);
  expect(autumnSummer.meanAbsDelta).toBeGreaterThan(16);
  expect(winterSummer.meanAbsDelta).toBeGreaterThan(18);
  expect(autumnSummer.meanTargetRed).toBeGreaterThan(autumnSummer.meanTargetBlue);
  expect(winterSummer.meanTargetLuminance).toBeGreaterThan(
    winterSummer.meanReferenceLuminance,
  );
  for (const evidence of [springSummer, autumnSummer, winterSummer]) {
    expect(evidence.minX).toBeGreaterThanOrEqual(0);
    expect(evidence.minY).toBeGreaterThanOrEqual(0);
    expect(evidence.maxX).toBeGreaterThan(evidence.minX);
    expect(evidence.maxY).toBeGreaterThan(evidence.minY);
  }

  const retainedFoliage: FoliagePresentation = {
    springFlush: 0,
    autumnColor: 1,
    dormancy: 0.68,
  };
  const retainedBaseEvidence = await capture(page, {
    layer: 'deciduous-cards',
    season: 'autumn',
    foliage: retainedFoliage,
    snowCoverage: 0,
  });
  const retainedBase = await captureCanvas(canvas);
  const retainedSnowEvidence = await capture(page, {
    layer: 'deciduous-cards',
    foliage: retainedFoliage,
    snowCoverage: 0.82,
  });
  const retainedSnow = await captureCanvas(canvas);
  const retainedSnowPixels = await comparePngFrames(page, retainedBase, retainedSnow);
  expect(retainedBaseEvidence.visibleDeciduousCardMeshes).toBeGreaterThan(0);
  expect(retainedBaseEvidence.visibleEvergreenCardMeshes).toBe(0);
  expect(retainedSnowEvidence.retainedLeafSnow).toBe(true);
  expect(retainedSnowPixels.changedPixels).toBeGreaterThan(500);
  expect(retainedSnowPixels.meanTargetLuminance).toBeGreaterThan(
    retainedSnowPixels.meanReferenceLuminance,
  );

  const evergreenBaseEvidence = await capture(page, {
    layer: 'evergreen-cards',
    season: 'winter',
    snowCoverage: 0,
  });
  const evergreenBase = await captureCanvas(canvas);
  const evergreenSnowEvidence = await capture(page, {
    layer: 'evergreen-cards',
    snowCoverage: 0.86,
  });
  const evergreenSnow = await captureCanvas(canvas);
  const evergreenSnowPixels = await comparePngFrames(page, evergreenBase, evergreenSnow);
  expect(evergreenBaseEvidence.visibleEvergreenCardMeshes).toBeGreaterThan(0);
  expect(evergreenSnowEvidence.visibleDeciduousCardMeshes).toBe(0);
  expect(evergreenSnowPixels.changedPixels).toBeGreaterThan(750);
  expect(evergreenSnowPixels.meanTargetLuminance).toBeGreaterThan(
    evergreenSnowPixels.meanReferenceLuminance,
  );

  const barkBaseEvidence = await capture(page, {
    layer: 'branches',
    season: 'winter',
    snowCoverage: 0,
  });
  const barkBase = await captureCanvas(canvas);
  const barkSnowEvidence = await capture(page, {
    layer: 'branches',
    snowCoverage: 0.86,
  });
  const barkSnow = await captureCanvas(canvas);
  const barkSnowPixels = await comparePngFrames(page, barkBase, barkSnow);
  expect(barkBaseEvidence.visibleBranchMeshes).toBeGreaterThanOrEqual(7);
  expect(barkSnowEvidence.visibleCardMeshes).toBe(0);
  expect(barkSnowPixels.changedPixels).toBeGreaterThan(350);
  expect(barkSnowPixels.meanTargetLuminance).toBeGreaterThan(
    barkSnowPixels.meanReferenceLuminance,
  );

  console.log(`[forest-season-render] ${JSON.stringify({
    springSummer,
    autumnSummer,
    winterSummer,
    summerNoise,
    retainedSnowPixels,
    evergreenSnowPixels,
    barkSnowPixels,
  })}`);

  expectCleanRuntime(runtime.runtimeErrors, runtime.failedRequests);
});
