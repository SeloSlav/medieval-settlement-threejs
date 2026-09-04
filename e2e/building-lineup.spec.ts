import { expect, test } from '@playwright/test';

const cases = [
  ['all-design-final', '/building-lineup.html?camera=design', 8_217, 226_796, undefined],
  ['all-far-no-post', '/building-lineup.html?camera=far&presentation=no-post', 8_200, 225_969, undefined],
  ['residences-near', '/building-lineup.html?compare=residences&camera=near', 747, 18_900, undefined],
  ['monastery-design', '/building-lineup.html?kind=monastery&camera=design', 2_458, 105_490, undefined],
  ['spinning-retting-design-stocked', '/building-lineup.html?kind=spinning_retting_house&camera=design&stocked=1', 400, 12_000, undefined],
  ['spinning-retting-massing', '/building-lineup.html?kind=spinning_retting_house&camera=design&debug=massing', 100, 5_000, undefined],
  ['stable-near-oxen', '/building-lineup.html?kind=stable&camera=near&oxen=3', 200, 18_000, 20],
  ['stable-design-oxen', '/building-lineup.html?kind=stable&camera=design&oxen=3', 200, 18_000, 20],
  ['stable-far-no-post-oxen', '/building-lineup.html?kind=stable&camera=far&presentation=no-post&oxen=3', 200, 18_000, 20],
] as const;

for (const [label, url, maxDrawCalls, maxTriangles, maxCpuFrameMs] of cases) {
  test(`Building lineup renderer budget — ${label}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
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
      if (response.status() >= 400) {
        failedRequests.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(url);
    await page.waitForFunction(() => window.__BUILDING_LINEUP_READY__ === true);
    const metrics = await page.evaluate(() => window.__BUILDING_LINEUP_METRICS__);
    expect(metrics).toBeTruthy();
    expect(metrics!.viewport).toEqual([1280, 646]);
    expect(metrics!.dpr).toBe(1);
    expect(metrics!.drawCalls).toBeGreaterThan(0);
    expect(metrics!.triangles).toBeGreaterThan(0);
    expect(metrics!.drawCalls).toBeLessThanOrEqual(maxDrawCalls);
    expect(metrics!.triangles).toBeLessThanOrEqual(maxTriangles);
    expect(Number.isFinite(metrics!.drawCalls)).toBe(true);
    expect(Number.isFinite(metrics!.triangles)).toBe(true);
    if (label.startsWith('spinning-retting-')) {
      expect(metrics!.seed).toBe(1551);
      expect(metrics!.debugMode).toBe(label.endsWith('-massing') ? 'massing' : 'final');
    }
    if (label.startsWith('stable-')) {
      expect(metrics!.stableOxVisuals).toBe(3);
      expect(metrics!.renderTargets).toBe(0);
      expect(metrics!.cpuFrameMs).toBeGreaterThan(0);
      expect(metrics!.cpuFrameMs).toBeLessThanOrEqual(maxCpuFrameMs!);
    }
    console.log(`[building-lineup] ${label}: ${JSON.stringify(metrics)}`);
    const unexpectedRuntimeErrors = runtimeErrors.filter((message) => !(
      /No available adapters\./.test(message)
      || /THREE\.WebGPURenderer: WebGPU is not available, running under WebGL2 backend\./.test(message)
      || /GL Driver Message .* GPU stall due to ReadPixels/.test(message)
    ));
    expect(unexpectedRuntimeErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
}

test('Building lineup uses the live-game orbit, pan, and zoom controls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/building-lineup.html?kind=founders_camp&camera=design&stocked=1');
  await page.waitForFunction(() => window.__BUILDING_LINEUP_READY__ === true);

  await expect(page.locator('#camera-help')).toContainText('Middle-drag / Q E orbit');
  const canvas = page.locator('canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  const x = bounds!.x + bounds!.width * 0.5;
  const y = bounds!.y + bounds!.height * 0.45;
  const initial = await page.evaluate(() => window.__BUILDING_LINEUP_CAMERA_STATE__!);
  expect(initial.controls).toBe('game-camera');
  expect(initial.activeViewIndex).toBe(0);

  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -160);
  await page.waitForFunction(
    (distance) => window.__BUILDING_LINEUP_CAMERA_STATE__!.views[0]!.orbitDistance < distance,
    initial.views[0]!.orbitDistance,
  );

  const beforeOrbit = await page.evaluate(() => window.__BUILDING_LINEUP_CAMERA_STATE__!.views[0]!);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x + 90, y - 45, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForFunction(
    (yaw) => Math.abs(window.__BUILDING_LINEUP_CAMERA_STATE__!.views[0]!.yaw - yaw) > 0.05,
    beforeOrbit.yaw,
  );

  const beforePan = await page.evaluate(() => window.__BUILDING_LINEUP_CAMERA_STATE__!.views[0]!);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 70, y + 35, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await page.waitForFunction(
    ([targetX, targetZ]) => {
      const target = window.__BUILDING_LINEUP_CAMERA_STATE__!.views[0]!.target;
      return Math.hypot(target[0] - targetX, target[2] - targetZ) > 0.05;
    },
    [beforePan.target[0], beforePan.target[2]],
  );
});

test('Building lineup routes camera input to the hovered comparison cell', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/building-lineup.html?compare=residences&camera=design');
  await page.waitForFunction(() => window.__BUILDING_LINEUP_READY__ === true);
  const canvas = page.locator('canvas');
  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  const before = await page.evaluate(() => window.__BUILDING_LINEUP_CAMERA_STATE__!);

  await page.mouse.move(
    bounds!.x + bounds!.width * 0.375,
    bounds!.y + bounds!.height * 0.42,
  );
  await page.mouse.wheel(0, -160);
  await page.waitForFunction(
    () => window.__BUILDING_LINEUP_CAMERA_STATE__!.activeViewIndex === 1,
  );
  await page.waitForFunction(
    (distance) => window.__BUILDING_LINEUP_CAMERA_STATE__!.views[1]!.orbitDistance < distance,
    before.views[1]!.orbitDistance,
  );
  const after = await page.evaluate(() => window.__BUILDING_LINEUP_CAMERA_STATE__!);
  expect(after.views[0]!.orbitDistance).toBeCloseTo(before.views[0]!.orbitDistance, 6);
});
