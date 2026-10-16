import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const output = 'artifacts/service-coverage';
mkdirSync(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
console.log('Coverage browser server ready.');
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  console.log('Coverage browser launched.');
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
    if (message.text().startsWith('Coverage')) console.log(message.text());
  });
  await page.route('**/service-coverage-probe', route => route.fulfill({
    contentType: 'text/html', body: '<html><body style="margin:0"></body></html>',
  }));
  await page.goto(new URL('service-coverage-probe', server.resolvedUrls.local[0]).href);
  console.log('Coverage browser page ready.');
  await page.evaluate(async () => {
    console.log('Coverage scene imports started.');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { initializeBuildingMaterialLibrary } = await import('/src/buildings/buildingMaterials.ts');
    const { ResidenceMarkers } = await import('/src/residences/ResidenceMarkers.ts');
    const { createDefaultNeeds } = await import('/src/residences/residenceNeedState.ts');
    console.log('Coverage scene imports ready.');
    const backend = await createPreferredRenderer();
    console.log('Coverage GPU renderer ready.');
    const renderer = backend.renderer;
    renderer.setSize(960, 640); renderer.setPixelRatio(1); renderer.setClearColor(0, 0);
    document.body.append(renderer.domElement);
    await initializeBuildingMaterialLibrary(backend.maxAnisotropy);
    console.log('Coverage materials ready.');
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6e7663, 2.5));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.5); sun.position.set(-30, 60, 40); scene.add(sun);
    const root = new THREE.Group(); scene.add(root);
    const markers = new ResidenceMarkers(root);
    const homes = [1, 2, 3, 4].map((tier, index) => ({
      id: `browser-home-${tier}`, zoneId: 'coverage', parcelIndex: index,
      x: (index % 2 - 0.5) * 20, z: (Math.floor(index / 2) - 0.5) * 21,
      yaw: index % 2 ? -0.2 : 0.2, population: 4, populationCapacity: 6,
      tier, settlementTicks: 0, needs: createDefaultNeeds(), abandoned: false, householdWealth: 8,
    }));
    markers.syncResidences(homes, () => 0);
    const camera = new THREE.PerspectiveCamera(38, 960 / 640, 0.1, 500);
    camera.position.set(43, 47, 67); camera.lookAt(0, 2, 0); camera.updateMatrixWorld(true);
    const target = new THREE.RenderTarget(960, 640);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150),
      new THREE.MeshBasicMaterial({ color: 0x687559 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.visible = false; scene.add(ground);
    const pixels = async () => {
      ground.visible = false; scene.background = null;
      renderer.setRenderTarget(target);
      await renderer.renderAsync(scene, camera);
      return renderer.readRenderTargetPixelsAsync(target, 0, 0, 960, 640);
    };
    const show = async kind => {
      markers.setServiceCoverageHighlights(kind ? new Set(homes.map(home => home.id)) : new Set(), kind,
        new Map(homes.map((home, index) => [home.id, ['fulfilled', 'partial', 'unfulfilled', 'fulfilled'][index]])));
    };
    const screenshot = async () => {
      scene.background = new THREE.Color(0x263038); ground.visible = true;
      renderer.setRenderTarget(null); await renderer.renderAsync(scene, camera);
    };
    window.coverageProbe = { pixels, show, screenshot, markers, homes, camera };
  });
  console.log('Coverage scene ready.');
  await page.evaluate(async () => { window.coverageProbe.baseline = await window.coverageProbe.pixels(); });
  await page.evaluate(() => window.coverageProbe.screenshot());
  await page.screenshot({ path: `${output}/normal.png` });
  const metrics = [];
  for (const kind of ['well', 'marketplace', 'chapel', 'tavern']) {
    await page.evaluate(kind => window.coverageProbe.show(kind), kind);
    const metric = await page.evaluate(async kind => {
      const probe = window.coverageProbe;
      const pixels = await probe.pixels();
      probe.lastPixels = pixels;
      const baseline = probe.baseline;
      let bodyPixels = 0, translucentPixels = 0, changedPixels = 0;
      for (let i = 0; i < baseline.length; i += 4) {
        if (baseline[i + 3] < 250) continue;
        bodyPixels++;
        if (pixels[i + 3] > 20 && pixels[i + 3] < 250) translucentPixels++;
        if (Math.abs(pixels[i] - baseline[i]) + Math.abs(pixels[i + 1] - baseline[i + 1])
          + Math.abs(pixels[i + 2] - baseline[i + 2]) > 24) changedPixels++;
      }
      return { kind, bodyPixels, translucentPixels, changedPixels };
    }, kind);
    metrics.push(metric);
    assert(metric.bodyPixels > 5000, 'the test must inspect full house surfaces');
    assert(metric.translucentPixels > metric.bodyPixels * 0.65, `${kind}: house interiors must become transparent`);
    assert(metric.changedPixels > metric.bodyPixels * 0.8, `${kind}: color must cover the model, beyond its outline`);
    await page.evaluate(() => window.coverageProbe.screenshot());
    await page.screenshot({ path: `${output}/${kind}.png` });
    // Snapshot updates must preserve coverage and never reintroduce opaque batches.
    await page.evaluate(() => window.coverageProbe.markers.syncResidences(window.coverageProbe.homes, () => 0));
    const changed = await page.evaluate(async () => {
      const probe = window.coverageProbe, refreshed = await probe.pixels();
      return refreshed.some((value, index) => value !== probe.lastPixels[index]);
    });
    assert.equal(changed, false, `${kind}: a world refresh must preserve transparent coverage`);
  }
  await page.evaluate(() => window.coverageProbe.show(null));
  const changed = await page.evaluate(async () => {
    const probe = window.coverageProbe, restored = await probe.pixels();
    return restored.some((value, index) => value !== probe.baseline[index]);
  });
  assert.equal(changed, false, 'clearing coverage must exactly restore the normal models');
  assert.deepEqual(errors, [], 'coverage must render without browser or GPU errors');
  writeFileSync(`${output}/metrics.json`, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics));
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
