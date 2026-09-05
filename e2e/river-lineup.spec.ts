import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

let fixtureServer: ChildProcess | null = null;
let fixtureOrigin = '';

test.beforeAll(async () => {
  const port = await reservePort();
  fixtureOrigin = `http://127.0.0.1:${port}`;
  fixtureServer = spawn(
    process.execPath,
    [
      resolve('node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, VITE_E2E_TEST: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  await waitForServer(`${fixtureOrigin}/river-lineup.html`);
});

test.afterAll(() => {
  fixtureServer?.kill();
  fixtureServer = null;
});

test('Kupa river production visual contract and renderer budget', async ({ page }, testInfo) => {
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
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`${fixtureOrigin}/river-lineup.html?view=design&time=6.25&clean=1`);
  await page.waitForFunction(() => window.__KUPA_RIVER_LINEUP_READY__ === true);
  const evidence = await page.evaluate(() => window.__KUPA_RIVER_LINEUP_EVIDENCE__!);

  expect(evidence.ready).toBe(true);
  expect(evidence.noPost).toBe(true);
  expect(evidence.deterministicInput).toBe('kupa-layout-4b757061-field-256');
  expect(evidence.bankOverlay).toEqual({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -8,
    opacityContract: 'smoothstep(0.08,0.62,uv.x)*0.94',
    surface: 'pale-carbonate-waterline-moss',
  });
  expect(evidence.crossSection.adjacentBankToWaterDropMeters).toBeGreaterThanOrEqual(3.05);
  expect(evidence.crossSection.centerWaterDepthMeters).toBeGreaterThanOrEqual(2.15);
  expect(evidence.crossSection.waterClimbsBank).toBe(false);
  expect(evidence.channel.rockCount).toBeGreaterThanOrEqual(20);
  expect(evidence.channel.stationCount).toBeGreaterThanOrEqual(12);
  expect(evidence.channel.mixedSideStationCount).toBe(0);
  expect(evidence.channel.foamSourcePixels).toBeGreaterThan(100);
  expect(evidence.channel.peakFoamSource).toBeGreaterThanOrEqual(180);
  expect(evidence.channel.packedSurfaceMapBytes).toBe(256 * 256 * 4);
  expect(evidence.channel.cattailInstances).toBeGreaterThan(0);
  expect(evidence.channel.cattailSubmergedInstances).toBe(evidence.channel.cattailInstances);
  expect(evidence.channel.qualityTier).toBe('hydraulic-flow-screen-optics');
  expect(evidence.channel.packedSurfaceTextureLookups).toBe(1);
  expect(evidence.channel.travellingFoam).toBe(true);
  expect(evidence.renderer.backend).toMatch(/^(?:webgpu|webgl2-node)$/);
  expect(evidence.renderer.drawCalls).toBeGreaterThan(0);
  expect(evidence.renderer.drawCalls).toBeLessThanOrEqual(20);
  expect(evidence.renderer.renderPasses).toBeGreaterThan(0);
  expect(evidence.renderer.renderPasses).toBeLessThanOrEqual(3);
  expect(evidence.renderer.triangles).toBeGreaterThan(0);
  expect(evidence.renderer.triangles).toBeLessThanOrEqual(320_000);
  expect(evidence.renderer.textures).toBeLessThanOrEqual(20);
  expect(evidence.renderer.renderTargets).toBeLessThanOrEqual(2);
  expect(evidence.performance.sampleCount).toBe(45);
  expect(evidence.performance.medianFps).toBeGreaterThan(0);
  if (evidence.renderer.backend === 'webgpu') {
    // 59.5 accepts one refresh-timer quantization step while still enforcing
    // the requested 60 Hz presentation floor at the fixed 1280x720 contract.
    expect(evidence.performance.medianFps).toBeGreaterThanOrEqual(59.5);
    expect(evidence.performance.p95CpuSubmitMs).toBeLessThanOrEqual(16.67);
    expect(evidence.performance.framesOver25Ms).toBeLessThanOrEqual(3);
  } else {
    // Software/WebGL2 fallback is a correctness path, not valid 60 FPS GPU
    // evidence. Keep a loose CPU-submission regression ceiling while exposing
    // its measured cadence in the evidence payload.
    expect(evidence.performance.p95CpuSubmitMs).toBeLessThanOrEqual(35);
  }

  const cameraViews = await page.evaluate(async () => {
    const capture = window.__KUPA_RIVER_LINEUP_CAPTURE__!;
    const near = await capture({ view: 'near', debugMode: 'final', animationTimeSeconds: 6.25 });
    const design = await capture({ view: 'design', debugMode: 'foam-field', animationTimeSeconds: 6.25 });
    const far = await capture({ view: 'far', debugMode: 'final', animationTimeSeconds: 6.25 });
    return { near, design, far };
  });
  expect(cameraViews.near.view).toBe('near');
  expect(cameraViews.design.view).toBe('design');
  expect(cameraViews.design.debugMode).toBe('foam-field');
  expect(cameraViews.far.view).toBe('far');
  expect(cameraViews.near.camera.position).not.toEqual(cameraViews.design.camera.position);
  expect(cameraViews.design.camera.position).not.toEqual(cameraViews.far.camera.position);
  const renderedProof = await page.screenshot({ animations: 'disabled' });
  // A flat background compresses to only a few kilobytes. This catches a
  // valid renderer-info payload paired with a clipped/zero-sized canvas.
  expect(renderedProof.byteLength).toBeGreaterThan(80_000);

  if (process.env.E2E_CAPTURE === '1') {
    const captures: Array<{ name: string; body: Buffer }> = [];
    await page.evaluate(() => window.__KUPA_RIVER_LINEUP_CAPTURE__!({
      view: 'near',
      debugMode: 'final',
      animationTimeSeconds: 6.25,
    }));
    captures.push({
      name: 'kupa-river-near-final.png',
      body: await page.screenshot({
      animations: 'disabled',
      }),
    });
    await page.evaluate(() => window.__KUPA_RIVER_LINEUP_CAPTURE__!({
      view: 'design',
      debugMode: 'foam-field',
      animationTimeSeconds: 6.25,
    }));
    captures.push({
      name: 'kupa-river-design-foam-field.png',
      body: await page.screenshot({
      animations: 'disabled',
      }),
    });
    await page.evaluate(() => window.__KUPA_RIVER_LINEUP_CAPTURE__!({
      view: 'far',
      debugMode: 'final',
      animationTimeSeconds: 6.25,
    }));
    captures.push({
      name: 'kupa-river-far-final.png',
      body: await page.screenshot({ animations: 'disabled' }),
    });
    // Attach only after every browser interaction. Writing into Playwright's
    // test-results tree earlier would make the standalone Vite server issue a
    // full-page reload while the next fixed view is being captured.
    for (const capture of captures) {
      await testInfo.attach(capture.name, {
        body: capture.body,
        contentType: 'image/png',
      });
    }
  }

  const unexpectedRuntimeErrors = runtimeErrors.filter((message) => !(
    /No available adapters\./.test(message)
    || /THREE\.WebGPURenderer: WebGPU is not available, running under WebGL2 backend\./.test(message)
    || /GL Driver Message .* GPU stall due to ReadPixels/.test(message)
  ));
  expect(unexpectedRuntimeErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a local Vite fixture port.'));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok && (await response.text()).includes('Kupa river visual contract')) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }
  throw new Error(`Timed out waiting for Kupa river fixture server: ${String(lastError)}`);
}
