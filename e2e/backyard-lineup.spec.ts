import { expect, test, type Page } from '@playwright/test';

type BackyardDiagnostics = NonNullable<Window['__BACKYARD_LINEUP_DIAGNOSTICS__']>;

const reviewedRendererBaselines = {
  'pear-close': { drawCalls: 22, submittedTriangles: 210_564, renderObjects: 20, instances: 22_366, geometryBytes: 3_677_512 },
  'aronia-close': { drawCalls: 42, submittedTriangles: 189_140, renderObjects: 40, instances: 128, geometryBytes: 1_184_796 },
  'rosehip-close': { drawCalls: 37, submittedTriangles: 144_248, renderObjects: 35, instances: 107, geometryBytes: 762_600 },
  'pig-close': { drawCalls: 31, submittedTriangles: 8_888, renderObjects: 29, instances: 29, geometryBytes: 265_768 },
  'animals-design': { drawCalls: 149, submittedTriangles: 32_294, renderObjects: 147, instances: 147, geometryBytes: 628_836 },
  'animals-far': { drawCalls: 149, submittedTriangles: 32_294, renderObjects: 147, instances: 147, geometryBytes: 628_836 },
  'animals-no-post': { drawCalls: 149, submittedTriangles: 32_294, renderObjects: 147, instances: 147, geometryBytes: 628_836 },
  'beetroot-close': { drawCalls: 11, submittedTriangles: 330, renderObjects: 6, instances: 6, geometryBytes: 23_100 },
  'vegetables-design': { drawCalls: 34, submittedTriangles: 2_160, renderObjects: 23, instances: 23, geometryBytes: 150_944 },
  'vegetables-far': { drawCalls: 34, submittedTriangles: 2_160, renderObjects: 23, instances: 23, geometryBytes: 150_944 },
  'vegetables-no-post': { drawCalls: 34, submittedTriangles: 2_160, renderObjects: 23, instances: 23, geometryBytes: 150_944 },
  'vegetables-stress': { drawCalls: 34, submittedTriangles: 2_160, renderObjects: 23, instances: 23, geometryBytes: 150_944 },
} as const;

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
    failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
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

function expectWithinRendererBudget(
  view: keyof typeof reviewedRendererBaselines,
  diagnostics: BackyardDiagnostics | undefined,
): void {
  expect(diagnostics).toBeTruthy();
  const baseline = reviewedRendererBaselines[view];
  for (const metric of ['drawCalls', 'submittedTriangles', 'renderObjects', 'instances', 'geometryBytes'] as const) {
    expect(Number.isFinite(diagnostics![metric]), `${view} ${metric} must remain finite`).toBe(true);
    expect(
      diagnostics![metric],
      `${view} ${metric} must stay within 10% of the reviewed fixed-view baseline`,
    ).toBeLessThanOrEqual(Math.ceil(baseline[metric] * 1.1));
  }
  expect(diagnostics!.renderPasses).toBe(2);
}

const views = [
  ['pear-close', 'Pear orchard'],
  ['aronia-close', 'Aronia bushes'],
  ['rosehip-close', 'Rosehip bushes'],
] as const;

for (const [view, label] of views) {
  test(`${label} authored backyard visual`, async ({ page }) => {
    const { runtimeErrors, failedRequests } = monitorRuntime(page);
    await page.goto(`/backyard-lineup.html?view=${view}`);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    await expect(page.locator('.label')).toHaveText(label);
    const diagnostics = await page.evaluate(() => window.__BACKYARD_LINEUP_DIAGNOSTICS__);
    console.log(`[backyard-lineup] ${view}: ${JSON.stringify(diagnostics)}`);
    expectWithinRendererBudget(view, diagnostics);
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(700);
    expect(box?.height ?? 0).toBeGreaterThan(500);
    expectCleanRuntime(runtimeErrors, failedRequests);
    await page.screenshot({
      path: `artifacts/backyard-${view}.png`,
      fullPage: true,
    });
  });
}

const animalViews = [
  ['pig-close', ['Pig pen']],
  ['animals-design', ['Animal pen shell', 'Chicken pen', 'Goat pen', 'Pig pen']],
  ['animals-far', ['Animal pen shell', 'Chicken pen', 'Goat pen', 'Pig pen']],
  ['animals-no-post', ['Animal pen shell', 'Chicken pen', 'Goat pen', 'Pig pen']],
] as const;

for (const [view, labels] of animalViews) {
  test(`Animal Pen authored visual — ${view}`, async ({ page }) => {
    const { runtimeErrors, failedRequests } = monitorRuntime(page);
    await page.goto(`/backyard-lineup.html?view=${view}`);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    await expect(page.locator('.label')).toHaveText([...labels]);
    const diagnostics = await page.evaluate(() => window.__BACKYARD_LINEUP_DIAGNOSTICS__);
    console.log(`[backyard-lineup] ${view}: ${JSON.stringify(diagnostics)}`);
    expectWithinRendererBudget(view, diagnostics);
    expect(diagnostics?.gardenCount).toBe(labels.length);
    expect(diagnostics?.triangleCount ?? 0).toBeGreaterThan(500);
    expect(diagnostics?.triangleCount ?? Number.POSITIVE_INFINITY).toBeLessThan(75_000);
    expect(diagnostics?.animalPlanKinds).toHaveLength(labels.length);
    expectCleanRuntime(runtimeErrors, failedRequests);
    await page.screenshot({
      path: `artifacts/backyard-${view}.png`,
      fullPage: true,
    });
  });
}

const vegetableViews = [
  ['beetroot-close', ['Beetroot garden']],
  ['vegetables-design', ['Vegetable garden', 'Cabbage garden', 'Carrot garden', 'Beetroot garden']],
  ['vegetables-far', ['Vegetable garden', 'Cabbage garden', 'Carrot garden', 'Beetroot garden']],
  ['vegetables-no-post', ['Vegetable garden', 'Cabbage garden', 'Carrot garden', 'Beetroot garden']],
  ['vegetables-stress', ['Vegetable garden', 'Cabbage garden', 'Carrot garden', 'Beetroot garden']],
] as const;

for (const [view, labels] of vegetableViews) {
  test(`Vegetable Garden authored visual — ${view}`, async ({ page }) => {
    const { runtimeErrors, failedRequests } = monitorRuntime(page);
    await page.goto(`/backyard-lineup.html?view=${view}`);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    await expect(page.locator('.label')).toHaveText([...labels]);
    const diagnostics = await page.evaluate(() => window.__BACKYARD_LINEUP_DIAGNOSTICS__);
    console.log(`[backyard-lineup] ${view}: ${JSON.stringify(diagnostics)}`);
    expectWithinRendererBudget(view, diagnostics);
    expect(diagnostics?.gardenCount).toBe(labels.length);
    expect(diagnostics?.triangleCount ?? 0).toBeGreaterThan(100);
    expect(diagnostics?.triangleCount ?? Number.POSITIVE_INFINITY).toBeLessThan(75_000);
    if (labels.length === 4) {
      expect(diagnostics?.vegetableCropKinds).toEqual([
        [],
        ['cabbage'],
        ['carrot'],
        ['beetroot'],
      ]);
    } else {
      expect(diagnostics?.vegetableCropKinds).toEqual([['beetroot']]);
    }
    expectCleanRuntime(runtimeErrors, failedRequests);
    await page.screenshot({
      path: `artifacts/backyard-${view}.png`,
      fullPage: true,
    });
  });
}
