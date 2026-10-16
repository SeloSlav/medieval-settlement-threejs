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
  // Exercise the browser Clipboard API path without replacing the user's clipboard.
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async text => { window.__copiedProfile = text; } },
  }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/render-diagnostics-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body><main id="app"></main></body></html>' }));
  await page.goto(new URL('/render-diagnostics-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { RenderDiagnostics, registerRenderDiagnosticRoot, RENDER_DIAGNOSTIC_CATEGORIES,
      VEGETATION_DIAGNOSTIC_CATEGORIES } = await import('/src/scene/RenderDiagnostics.ts');
    const { DebugMenu } = await import('/src/ui/DebugMenu.ts');
    const { SettlementHud } = await import('/src/ui/SettlementHud.ts');
    const { FirstPersonController } = await import('/src/camera/FirstPersonController.ts');
    await import('/src/style.css');
    await import('/src/ui/gameplayCraft.css');
    const hudHost = document.createElement('div');
    hudHost.style.display = 'none';
    const hudParent = document.createElement('div');
    hudHost.append(hudParent);
    document.body.append(hudHost);
    const hud = new SettlementHud(hudParent);
    hud.setFps(62.09);
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
    const categories = RENDER_DIAGNOSTIC_CATEGORIES.filter(category => category !== 'buildings');
    const roots = new Map();
    for (const [i, category] of categories.entries()) {
      const root = new THREE.Mesh(new THREE.BoxGeometry(.5, 1, .5), source.children[0].material);
      root.position.set((i % 7) - 3, .5, 5 - Math.floor(i / 7)); scene.add(root);
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
    invariants.push(!roots.get('vegetation').visible);
    for (const category of VEGETATION_DIAGNOSTIC_CATEGORIES) invariants.push(!roots.get(category).visible);
    for (const category of ['trees', 'grass', 'groundScatter']) invariants.push(roots.get(category).visible);
    invariants.push(JSON.stringify(diagnostics.getState().effectiveHidden) === JSON.stringify(
      ['buildings', 'vegetation', ...VEGETATION_DIAGNOSTIC_CATEGORIES].sort()));
    diagnostics.endRender();
    // Streamed plants added after a switch still inherit the master setting.
    const late = new THREE.Group(); scene.add(late); registerRenderDiagnosticRoot(late, 'reeds');
    diagnostics.beginRender(); invariants.push(!late.visible); diagnostics.endRender();
    diagnostics.setHidden('crops', true);
    diagnostics.setHidden('vegetation', false); diagnostics.beginRender();
    invariants.push(!roots.get('crops').visible && roots.get('reeds').visible && roots.get('grass').visible);
    diagnostics.endRender();
    roots.get('animals').visible = false;
    diagnostics.setHidden('animals', true); diagnostics.beginRender(); diagnostics.endRender();
    invariants.push(!roots.get('animals').visible);
    diagnostics.reset(); roots.get('animals').visible = true;
    const restored = render();
    let menu;
    let moving = false;
    let distance = 20;
    const work = { update() {} };
    const originalWork = work.update;
    const actions = { placeBuilding: async kind => kind };
    const profileFrame = time => {
      const profiler = diagnostics.profiler;
      if (!profiler.isRecording()) return;
      profiler.beginFrame(time, performance.now());
      work.update();
      if (moving) { camera.position.x += .1; distance -= .02; }
      const stats = render();
      profiler.completeFrame(performance.now(), stats);
      menu.updatePerformance(time);
      requestAnimationFrame(profileFrame);
    };
    // Register the walk listener first, matching the real app's event order.
    const firstPerson = new FirstPersonController({
      camera, domElement: renderer.domElement,
      bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, getHeightAt: () => 0,
      placementParent: scene, pickPlacementGround: () => new THREE.Vector3(),
      isSessionReady: () => true, isMenuOpen: () => menu?.isOpen() ?? false,
    });
    menu = new DebugMenu(document.getElementById('app'), {
      domElement: renderer.domElement, renderDiagnostics: diagnostics,
      onPerformanceDetails: details => hud.setPerformanceDetails(details),
      onStartProfile: async () => {
        diagnostics.profiler.start({ metadata: { source: 'browser-validation' }, toggles: diagnostics.getState(),
          getContext: () => ({ camera: { position: camera.position.toArray(), rotation: camera.quaternion.toArray(),
            target: [camera.position.x, 0, 0], distance, mode: 'orbit', navigating: moving },
            tool: moving ? 'building:well' : 'none', menuOpen: menu.isOpen(), visible: true, gameSpeed: 1, world: { buildings: 1 } }),
        });
        diagnostics.profiler.instrument(work, 'update', 'fixture.update');
        diagnostics.profiler.instrumentAction(actions, 'placeBuilding');
        requestAnimationFrame(profileFrame);
      },
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
    window.__diagnosticProbe = { diagnostics, menu, hud, render, move: () => { moving = true; }, actions, work, originalWork };
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
  await page.getByRole('button', { name: 'Hide all buildings', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__diagnosticProbe.diagnostics.getState().buildings), 'hidden');
  await page.locator('[data-render-category="crops"]').click();
  await page.locator('[data-render-category="vegetation"]').click();
  for (const category of ['crops', 'reeds', 'shrubs', 'groundPlants']) {
    assert.equal(await page.locator(`[data-render-category="${category}"]`).getAttribute('aria-pressed'), 'true');
    assert.ok(await page.locator(`[data-render-category="${category}"]`).isDisabled());
  }
  for (const category of ['trees', 'grass', 'groundScatter']) {
    assert.equal(await page.locator(`[data-render-category="${category}"]`).getAttribute('aria-pressed'), 'false');
  }
  await page.locator('[data-render-category="vegetation"]').click();
  assert.equal(await page.locator('[data-render-category="crops"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-render-category="reeds"]').getAttribute('aria-pressed'), 'false');
  await page.locator('[data-render-reset]').click();
  await page.locator('[data-profile-record]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/development-menu.png` });
  await page.keyboard.press('m');
  assert.ok(await page.locator('.debug-menu-backdrop').isHidden());
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    const { diagnostics, menu, render } = window.__diagnosticProbe;
    const stats = render();
    for (let i = 0; i < 180; i++) diagnostics.recordFrame(i === 179 ? 35 : 16, stats);
    menu.updatePerformance(performance.now() + 500);
  });
  assert.equal(await page.locator('.debug-performance-meter').count(), 0);
  assert.equal(await page.locator('.settlement-hud__perf').count(), 1);
  assert.ok(await page.locator('.settlement-hud__perf').isVisible());
  assert.match(await page.locator('.settlement-hud__perf').innerText(), /FPS.*62.*16\.11 \/ 16\.67 ms/s);
  assert.match(await page.locator('.settlement-hud__perf-shortcut').innerText(), /M.*Development menu/s);
  assert.match(await page.locator('[data-performance-details]').innerText(), /ms P95.*draws.*triangles/s);
  assert.match(await page.locator('[data-performance-details]').innerText(), /Full scene/);
  await page.screenshot({ path: `${output}/merged-performance-hud.png` });
  await page.setViewportSize({ width: 480, height: 800 });
  const hudBounds = await page.locator('.settlement-hud__perf').boundingBox();
  assert.ok(hudBounds.x >= 0 && hudBounds.x + hudBounds.width <= 480);
  assert.ok(hudBounds.y > 600 && hudBounds.y + hudBounds.height <= 800);
  await page.screenshot({ path: `${output}/merged-performance-hud-narrow.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press('m');
  await page.locator('[data-render-meter]').uncheck();
  assert.ok(await page.locator('[data-performance-details]').isHidden());
  assert.ok(await page.locator('[data-stat="fps"]').isVisible());
  await page.locator('[data-render-meter]').check();
  await page.evaluate(() => window.__diagnosticProbe.menu.updatePerformance(performance.now() + 500));
  assert.ok(await page.locator('[data-performance-details]').isVisible());
  await page.keyboard.press('m');
  await page.keyboard.press('Backquote');
  assert.ok(await page.locator('.debug-menu-backdrop').isHidden());
  await page.keyboard.press('Backquote'); // Cancel walk placement before recording.
  await page.keyboard.press('m');
  await page.locator('[data-profile-record]').click();
  await page.locator('.debug-profile-recording').waitFor({ state: 'visible' });
  assert.ok(await page.locator('.debug-menu-backdrop').isHidden());
  await page.waitForFunction(() => window.__diagnosticProbe.diagnostics.profiler.getFrameCount() >= 12);
  await page.keyboard.press('m');
  await page.locator('[data-render-category="trees"]').click();
  for (const category of ['grass', 'crops', 'reeds', 'shrubs', 'groundPlants', 'groundScatter', 'vegetation']) {
    await page.locator(`[data-render-category="${category}"]`).click();
  }
  await page.locator('[data-render-buildings="placeholder"]').click();
  await page.locator('[data-render-buildings="hidden"]').click();
  await page.keyboard.press('m');
  await page.evaluate(() => { window.__diagnosticProbe.move(); return window.__diagnosticProbe.actions.placeBuilding('well'); });
  await page.waitForFunction(() => window.__diagnosticProbe.diagnostics.profiler.getFrameCount() >= 28);
  await page.locator('[data-profile-stop-floating]').click();
  await page.waitForFunction(() => Boolean(window.__copiedProfile));
  const exported = await page.evaluate(() => window.__copiedProfile);
  assert.ok(exported.startsWith('SELO_PROFILE_V1\n'));
  const profile = JSON.parse(exported.slice(exported.indexOf('\n') + 1));
  assert.ok(profile.summary.frames >= 28);
  assert.ok(profile.states.some(state => state.toggles.hidden.includes('trees')));
  assert.ok(profile.states.some(state => state.toggles.buildings === 'placeholder'));
  assert.ok(profile.states.some(state => state.toggles.buildings === 'hidden' && state.toggles.effectiveHidden.includes('buildings')));
  for (const category of ['grass', 'crops', 'reeds', 'shrubs', 'groundPlants', 'groundScatter', 'vegetation']) {
    assert.ok(profile.states.some(state => state.toggles.hidden.includes(category)), `profile records ${category}`);
  }
  assert.ok(profile.events.some(event => event.kind === 'action-request' && event.data.action === 'placeBuilding'));
  assert.ok(profile.cohorts.some(cohort => cohort.key.includes('zoom+pan')));
  assert.ok(await page.evaluate(() => window.__diagnosticProbe.work.update === window.__diagnosticProbe.originalWork));
  await page.locator('[data-profile-copy]').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${output}/recorded-profile-menu.png` });
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Denied for validation'); }; });
  await page.locator('[data-profile-copy]').click();
  await page.locator('[data-profile-export]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-profile-export]').inputValue(), exported);
  assert.match(await page.locator('[data-profile-status]').innerText(), /Clipboard access was blocked/);
  writeFileSync(`${output}/recorded-profile.txt`, exported);
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/browser-validation.json`, JSON.stringify({ ...result, recording: { frames: profile.summary.frames, chars: exported.length, clipboard: 'copied and denied fallback verified' }, errors }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await server.close();
}
