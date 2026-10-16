import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const label = process.argv[2] ?? 'current';
const reference = process.argv.includes('--reference');
const treesOnly = process.argv.includes('--trees-only');
const compare = process.argv.includes('--compare');
const output = `artifacts/solo-vegetation/${label}`;
mkdirSync(output, { recursive: true });
const referencePaths = [
  'src/vegetation/seedthree/seedThreeForestBuilder.ts',
  'src/grass/GrassBladeField.ts',
  'src/props/ForestFloorIvy.ts',
  'src/props/ForestFloorNettles.ts',
  'src/scene/InstanceDrawCompaction.ts',
  'src/scene/GroupedInstanceDraws.ts',
  'src/scene/SceneManager.ts',
  'src/props/ForestManager.ts',
  'src/props/ForestUndergrowth.ts',
];
const sourceDirectory = reference || label === 'baseline'
  ? 'artifacts/solo-vegetation/reference' : `${output}/sources`;
if (!reference) {
  mkdirSync(sourceDirectory, { recursive: true });
  for (const path of referencePaths) {
    const original = treesOnly && !['seedThreeForestBuilder.ts', 'InstanceDrawCompaction.ts', 'GroupedInstanceDraws.ts'].includes(path.split('/').at(-1))
      ? `artifacts/solo-vegetation/reference/${path.split('/').at(-1)}` : path;
    writeFileSync(`${sourceDirectory}/${path.split('/').at(-1)}`, readFileSync(original));
  }
}
const server = await createServer({
  cacheDir: 'artifacts/solo-vegetation/vite-cache',
  server: { host: '127.0.0.1', port: 5192, strictPort: true, hmr: false },
  plugins: [{ name: 'solo-vegetation-benchmark', enforce: 'pre', transform(code, id) {
    const path = id.replaceAll('\\', '/').split('?')[0];
    if (path.endsWith('/src/main.ts')) return code.replace('const app = new App(root);', 'const app = new App(root); window.__vegetationApp = app;');
    const original = referencePaths.find(candidate => path.endsWith(`/${candidate}`));
    if (original) return readFileSync(`${sourceDirectory}/${original.split('/').at(-1)}`, 'utf8');
  } }],
});
await server.listen();
let browser;
const errors = [];
try {
  browser = await chromium.launchPersistentContext('artifacts/solo-vegetation/browser-cache', {
    channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'],
    viewport: { width: 1707, height: 825 }, deviceScaleFactor: 1,
  });
  const page = await browser.newPage();
  for (const other of browser.pages()) if (other !== page) await other.close();
  page.on('pageerror', e => { errors.push(e.message); console.log('pageerror', e.message); });
  page.on('console', e => { if (e.type() === 'error') { errors.push(e.text()); console.log('browser error', e.text()); } });
  await page.addInitScript(() => {
    localStorage.setItem('medieval-road-system:world-generation', JSON.stringify({ seed: 1297755661, mapSize: 'medium' }));
  });
  console.log(`Starting ${label}${reference ? ' (saved reference sources)' : ''}`);
  await page.goto(`${server.resolvedUrls.local[0]}?mode=singleplayer&visualQa=daylight`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    for (const name of [/Continue to Heraldry/, /Continue to Map Generation/, /^Start world$/]) {
      const button = page.getByRole('button', { name });
      if (await button.isVisible()) await button.click();
    }
    ready = await page.evaluate(() => window.__medievalRoadStartup?.firstPlayableMs !== undefined && window.__medievalRoadStats?.frames > 10);
    if (ready) break;
    if (i % 10 === 0) console.log('Loading', await page.locator('[data-loading-label]').textContent().catch(() => 'setup'));
    await page.waitForTimeout(2000);
  }
  assert.ok(ready, 'solo must become playable');
  if (await page.locator('[data-tutorial-skip]').isVisible()) {
    await page.locator('[data-tutorial-skip]').check({ force: true });
    await page.locator('[data-tutorial-confirm]').click();
  }
  await page.locator('[data-tutorial-confirm]').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => {
    const scene = window.__vegetationApp.sceneManager;
    return scene.grassField && scene.forestManager && scene.mushroomPatchVisuals;
  }, undefined, { timeout: 180000 });
  await page.evaluate(() => {
    const app = window.__vegetationApp;
    app.sceneManager.renderDiagnostics.reset();
    app.debugMenu.close();
    app.cameraController.setInputEnabled(false);
    window.__vegetationOriginalCameraUpdate = app.cameraController.update;
    window.__vegetationMotion = null;
    app.cameraController.update = function(dt) {
      window.__vegetationOriginalCameraUpdate.call(this, dt);
      window.__vegetationMotion?.(performance.now());
    };
  });
  if (compare) await page.evaluate(async () => {
    const { GroupedInstanceDraws } = await import('/src/scene/GroupedInstanceDraws.ts');
    const { InstanceDrawCompaction } = await import('/src/scene/InstanceDrawCompaction.ts');
    window.__vegetationVariant = 'final';
    // Test-only A/B switch: retain original source data and skip optimization work.
    // Branch and exact shadow selection stay identical in every arm.
    for (const [constructor, tree] of [[GroupedInstanceDraws,true],[InstanceDrawCompaction,false]]) {
      const original = constructor.prototype.prepare;
      constructor.prototype.prepare = function(camera) {
        const ground = /^SeedThree (streamed |rooted instanced forest-floor ivy|stinging nettle prototype|real (dogwood|bush|fern|juniper) prototype)/.test(this.source.name);
        if (!tree && !ground) return original.call(this,camera);
        const enabled = tree ? window.__vegetationVariant !== 'reference' : window.__vegetationVariant === 'final';
        this.source.layers.mask = enabled ? 0 : this.draw.layers.mask;
        this.draw.visible = enabled;
        if (enabled) return original.call(this,camera);
        this.source.userData.compactedInstanceCount = this.source.count;
      };
    }
  });
  const results = [];
  // Repeat fixed-duration paths, so a faster run does not travel further.
  for (let repeat = 0; repeat < 2; repeat++) for (const scenario of ['close-still', 'close-moving', 'rts-moving']) for (const variant of compare
    ? repeat === 0 ? ['reference','trees','final'] : ['final','trees','reference'] : ['current']) {
    await page.evaluate(variant => { window.__vegetationVariant=variant; },variant);
    await page.evaluate(({ scenario }) => {
      const app = window.__vegetationApp;
      const start = performance.now();
      window.__vegetationMotion = now => {
        const t = (now - start) / 1000;
        const moving = scenario !== 'close-still';
        const rts = scenario === 'rts-moving';
        app.cameraController.applyShowcaseView(
          235 + (moving ? 18 * Math.sin(t * .8) : 0),
          390 + (moving ? 18 * Math.cos(t * .8) : 0),
          .45 + (moving ? .65 * Math.sin(t * .7) : 0),
          rts ? 1.1 : .14, rts ? 240 : 8.8,
        );
      };
      app.cameraController.isNavigationActive = () => scenario !== 'close-still';
    }, { scenario });
    // Complete one full path cycle before measuring; this also converges streams.
    await page.waitForTimeout(compare ? 5000 : 9000);
    await page.evaluate(async () => { await window.__vegetationApp.startDevelopmentProfile(); });
    await page.waitForTimeout(compare ? 7000 : 8000);
    const data = await page.evaluate(() => {
      const app = window.__vegetationApp;
      const scene = app.sceneManager;
      const raw = scene.renderDiagnostics.profiler.stop();
      const profile = JSON.parse(raw.slice(raw.indexOf('\n') + 1));
      const layers = [];
      let gatherBytes=0;
      scene.scene.traverse(object => { gatherBytes+=Number(object.userData.instanceGatherBytes)||0; });
      scene.scene.traverseVisible(object => {
        if (!object.isMesh || !object.layers.test(scene.camera.layers)) return;
        const triangles = ((object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0) / 3) * (object.isInstancedMesh ? object.count : 1);
        layers.push({ name: object.name, triangles, instances: object.isInstancedMesh ? object.count : 1,
          compactionSource: !!object.userData.instanceCompactionSource });
      });
      return { profile, gatherBytes, layers: layers.sort((a, b) => b.triangles - a.triangles).slice(0, 30),
        forest: scene.forestManager.getSeedThreeProfileBreakdown(),
        wildflowers: scene.grassField.group.userData.wildflowerStream };
    });
    assert.equal(data.profile.metadata.mode, 'single');
    assert.equal(data.profile.metadata.seed, 1297755661);
    assert.deepEqual(data.profile.states[0].toggles.hidden, []);
    data.profile.metadata.benchmarkVariant=variant;
    results.push({ scenario, repeat, variant, ...data });
    const name=`${scenario}-${repeat}${compare ? `-${variant}` : ''}`;
    writeFileSync(`${output}/${name}.json`, JSON.stringify(data, null, 2));
    await page.screenshot({ path: `${output}/${name}.png` });
    console.log(JSON.stringify({ scenario, repeat, variant, ...data.profile.gameplay }));
  }
  writeFileSync(`${output}/results.json`, JSON.stringify({ label, reference, seed: 1297755661, viewport: [1707,825], results, errors }, null, 2));
  if (process.argv.includes('--validate')) {
    const parity = await page.evaluate(async () => {
      const app = window.__vegetationApp, scene = app.sceneManager;
      window.__vegetationVariant='final';
      const { setRendererAnimationLoop } = await import('/src/scene/RendererBackend.ts');
      const THREE = await import('/node_modules/three/build/three.module.js');
      setRendererAnimationLoop(scene.renderer, null);
      scene.sky.visible = false; scene.precipitation.group.visible = false;
      scene.riverSystem.group.visible = false;
      const target = new THREE.RenderTarget(512, 288);
      scene.camera.aspect = 512 / 288; scene.camera.updateProjectionMatrix();
      const pairs = [];
      scene.scene.traverse(source => {
        if (!source.userData.instanceCompactionSource) return;
        for (const draw of source.children) if (draw.userData.instanceCompactionDraw) pairs.push({ source, draw });
      });
      const poses = [];
      for (const [x, z, yaw, pitch, distance] of [[235,390,.45,.14,8.8], [245,390,2,.3,22], [235,390,1,1.1,240]]) {
        app.cameraController.applyShowcaseView(x,z,yaw,pitch,distance);
        scene.grassField.primeAndFreezeStream(scene.camera.position, scene.cameraTarget, distance, false);
        scene.render(0, distance);
        const capture = async full => {
          for (const {source,draw} of pairs) { source.layers.mask = full ? draw.layers.mask : 0; draw.visible = !full; }
          scene.renderer._nodes.nodeFrame.update(); scene.renderer.setRenderTarget(target);
          scene.renderer.render(scene.scene, scene.camera);
          const pixels = new Uint8Array(await scene.renderer.readRenderTargetPixelsAsync(target,0,0,512,288));
          scene.renderer.setRenderTarget(null); return pixels;
        };
        const actual = await capture(false), full = await capture(true);
        let changed = 0, max = 0;
        for (let i=0;i<actual.length;i++) { const delta=Math.abs(actual[i]-full[i]);max=Math.max(max,delta);if(delta>2)changed++; }
        poses.push({distance,channelsOver2:changed,maxDelta:max});
        for (const {source,draw} of pairs) { source.layers.mask=0;draw.visible=true; }
      }
      target.dispose();
      return { sourceDraws:pairs.length,poses };
    });
    writeFileSync(`${output}/image-parity.json`, JSON.stringify(parity,null,2));
    console.log('Live solo image parity', JSON.stringify(parity));
    assert.ok(parity.poses.every(pose => pose.channelsOver2 === 0), JSON.stringify(parity));
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(`${output}/errors.json`, JSON.stringify(errors, null, 2));
  await browser?.close();
  await server.close();
}
