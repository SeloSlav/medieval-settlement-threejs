import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const output = 'artifacts/render-diagnostics';
mkdirSync(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/render-diagnostics-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body><main id="app"></main></body></html>' }));
  await page.goto(new URL('/render-diagnostics-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { RenderDiagnostics, registerRenderDiagnosticRoot } = await import('/src/scene/RenderDiagnostics.ts');
    const { DebugMenu } = await import('/src/ui/DebugMenu.ts');
    const { FirstPersonController } = await import('/src/camera/FirstPersonController.ts');
    await import('/src/ui/debugMenu.css');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { renderer } = await createPreferredRenderer();
    renderer.setSize(1280, 800);
    renderer.setPixelRatio(1);
    document.body.style.cssText = 'margin:0;background:#263429';
    document.body.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 3));
    const camera = new THREE.PerspectiveCamera(45, 1.6, .1, 100);
    camera.position.set(15, 12, 20); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
    let shadowInvalidations = 0;
    const diagnostics = new RenderDiagnostics(scene, () => shadowInvalidations++);
    const compound = new THREE.Group();
    scene.add(compound);
    const source = new THREE.Group(); compound.add(source);
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xaba26e }));
      mesh.position.set((i % 3) - 1, Math.floor(i / 3) + .5, 0); source.add(mesh);
    }
    // Both the building and its separately batched shadow draw share this root.
    const shadow = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), source.children[0].material);
    shadow.layers.set(1); compound.add(shadow);
    registerRenderDiagnosticRoot(compound, 'buildings', visit => visit(source, 4, 4, 4));
    const categories = ['people', 'carts', 'oxen', 'animals', 'trees', 'vegetation', 'sky'];
    const roots = new Map();
    for (const [i, category] of categories.entries()) {
      const root = new THREE.Mesh(new THREE.BoxGeometry(.5, 1, .5), source.children[0].material);
      root.position.set(i - 3, .5, 5); scene.add(root);
      registerRenderDiagnosticRoot(root, category); roots.set(category, root);
    }
    const render = () => {
      scene.updateMatrixWorld(true);
      diagnostics.beginRender();
      let stats;
      try {
        renderer.info.reset(); renderer.render(scene, camera);
        stats = { calls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles };
      } finally { diagnostics.endRender(); }
      return stats;
    };
    const normal = render();
    diagnostics.setBuildingMode('placeholder');
    const boxes = render();
    diagnostics.setBuildingMode('hidden');
    const hidden = render();
    const invariants = [];
    diagnostics.beginRender(); invariants.push(!compound.visible && shadow.visible); diagnostics.endRender();
    invariants.push(compound.visible && shadow.visible);
    for (const category of categories) {
      diagnostics.setHidden(category, true); diagnostics.beginRender();
      invariants.push(!roots.get(category).visible); diagnostics.endRender();
      invariants.push(roots.get(category).visible);
      diagnostics.setHidden(category, false);
    }
    diagnostics.setHidden('vegetation', true); diagnostics.beginRender();
    invariants.push(!roots.get('trees').visible && !roots.get('vegetation').visible);
    diagnostics.endRender();
    const late = new THREE.Group(); scene.add(late); registerRenderDiagnosticRoot(late, 'vegetation');
    diagnostics.beginRender(); invariants.push(!late.visible); diagnostics.endRender();
    roots.get('animals').visible = false;
    diagnostics.setHidden('animals', true); diagnostics.beginRender(); diagnostics.endRender();
    invariants.push(!roots.get('animals').visible);
    diagnostics.reset(); roots.get('animals').visible = true;
    const restored = render();
    let menu;
    // Register the walk listener first, matching the real app's event order.
    const firstPerson = new FirstPersonController({
      camera, domElement: renderer.domElement,
      bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, getHeightAt: () => 0,
      placementParent: scene, pickPlacementGround: () => new THREE.Vector3(),
      isSessionReady: () => true, isMenuOpen: () => menu?.isOpen() ?? false,
    });
    menu = new DebugMenu(document.getElementById('app'), {
      domElement: renderer.domElement, renderDiagnostics: diagnostics,
      getDate: () => ({ year: 1, month: 3, monthDay: 1 }), pickMapPoint: () => null,
      onGrantResources: async () => {}, onSetDate: async () => {}, onRunMapAction: async () => {},
    });
    const key = (key, code) => window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
    key('m', 'KeyM'); invariants.push(menu.isOpen() && !firstPerson.isPlacementActive());
    key('m', 'KeyM'); invariants.push(!menu.isOpen());
    key('~', 'Backquote'); invariants.push(firstPerson.isPlacementActive() && !menu.isOpen());
    key('~', 'Backquote'); invariants.push(!firstPerson.isPlacementActive());
    key('F8', 'F8'); invariants.push(!firstPerson.isPlacementActive() && !menu.isOpen());
    key('m', 'KeyM'); invariants.push(menu.isOpen());
    key('~', 'Backquote'); invariants.push(!firstPerson.isPlacementActive());
    window.__diagnosticProbe = { diagnostics, menu, render };
    // Wait past switch settling without starting a competing animation loop.
    await new Promise(resolve => setTimeout(resolve, 1600));
    for (let i = 0; i < 180; i++) diagnostics.recordFrame(i === 179 ? 35 : 16, normal);
    menu.updatePerformance(performance.now());
    return { normal, boxes, hidden, restored, invariants, shadowInvalidations, sample: diagnostics.getSample() };
  });
  assert.ok(result.invariants.every(Boolean), JSON.stringify(result.invariants));
  assert.equal(result.normal.calls - result.boxes.calls, 9);
  assert.equal(result.boxes.triangles - result.hidden.triangles, 12);
  assert.deepEqual(result.restored, result.normal);
  await page.locator('[data-render-baseline]').click();
  await page.locator('[data-render-buildings="placeholder"]').click();
  await page.locator('[data-render-category="people"]').click();
  assert.equal(await page.locator('[data-render-category="people"]').getAttribute('aria-pressed'), 'true');
  await page.locator('[data-render-actors]').click();
  for (const category of ['people', 'carts', 'oxen', 'animals']) {
    assert.equal(await page.locator(`[data-render-category="${category}"]`).getAttribute('aria-pressed'), 'true');
  }
  await page.locator('[data-render-reset]').click();
  assert.equal(await page.locator('[data-render-buildings="full"]').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: `${output}/development-menu.png` });
  await page.keyboard.press('m');
  assert.ok(await page.locator('.debug-menu-backdrop').isHidden());
  await page.evaluate(() => window.__diagnosticProbe.menu.updatePerformance(performance.now() + 500));
  assert.ok(await page.locator('.debug-performance-meter').isVisible());
  await page.keyboard.press('Backquote');
  assert.ok(await page.locator('.debug-menu-backdrop').isHidden());
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/browser-validation.json`, JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await server.close();
}
