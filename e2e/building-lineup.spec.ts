import { expect, test } from '@playwright/test';

const cases = [
  ['all-design-final', '/building-lineup.html?camera=design', 8_217, 226_796],
  ['all-far-no-post', '/building-lineup.html?camera=far&presentation=no-post', 8_200, 225_969],
  ['residences-near', '/building-lineup.html?compare=residences&camera=near', 747, 18_900],
  ['monastery-design', '/building-lineup.html?kind=monastery&camera=design', 2_458, 105_490],
] as const;

for (const [label, url, maxDrawCalls, maxTriangles] of cases) {
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
    console.log(`[building-lineup] ${label}: ${JSON.stringify(metrics)}`);
    const unexpectedRuntimeErrors = runtimeErrors.filter((message) => !(
      /powerPreference option is currently ignored/.test(message)
      || /No available adapters\./.test(message)
      || /THREE\.WebGPURenderer: WebGPU is not available, running under WebGL2 backend\./.test(message)
      || /GL Driver Message .* GPU stall due to ReadPixels/.test(message)
    ));
    expect(unexpectedRuntimeErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
}
