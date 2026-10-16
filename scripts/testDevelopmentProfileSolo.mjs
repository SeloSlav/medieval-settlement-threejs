import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const output = 'artifacts/render-diagnostics/solo-recording';
mkdirSync(output, { recursive: true });
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [{ name: 'development-profile-test-handle', enforce: 'pre', transform(code, id) {
    if (id.replaceAll('\\', '/').split('?')[0].endsWith('/src/main.ts')) {
      return code.replace('const app = new App(root);', 'const app = new App(root); window.__profileTestApp = app;');
    }
  } }],
});
await server.listen();
let browser;
const errors = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => { errors.push(error.message); console.log('pageerror', error.message); });
  page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.log('browser error', message.text()); } });
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async text => { window.__copiedProfile = text; } }, configurable: true,
  }));
  console.log('Starting solo world for profile validation');
  await page.goto(`${server.resolvedUrls.local[0]}?mode=singleplayer&visualQa=daylight`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    for (const name of [/Continue to Heraldry/, /Continue to Map Generation/, /^Start world$/]) {
      const button = page.getByRole('button', { name });
      if (await button.isVisible()) await button.click();
    }
    ready = await page.evaluate(() => window.__medievalRoadStartup?.firstPlayableMs !== undefined && window.__medievalRoadStats?.frames > 10);
    if (ready) break;
    if (i % 10 === 0) console.log('Loading:', await page.locator('[data-loading-label]').textContent().catch(() => 'world setup'));
    await page.waitForTimeout(2000);
  }
  assert.ok(ready, 'solo game must reach first playable');
  if (await page.locator('[data-tutorial-skip]').isVisible()) {
    await page.locator('[data-tutorial-skip]').check({ force: true });
    await page.locator('[data-tutorial-confirm]').click();
  }
  await page.locator('[data-tutorial-confirm]').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => {
    const scene = window.__profileTestApp.sceneManager;
    return scene.grassField && scene.forestManager && scene.berryPatchVisuals && scene.mushroomPatchVisuals;
  }, undefined, { timeout: 180000 });
  console.log('Checking live grass, vegetation and scatter separation');
  const layerChecks = await page.evaluate(() => {
    const scene = window.__profileTestApp.sceneManager;
    const diagnostics = scene.renderDiagnostics;
    const forest = scene.forestManager;
    const layers = {
      grass: scene.grassField.group.children.filter(child => child.name.startsWith('SeedThree grass ')),
      reeds: [scene.riverSystem.reedsGroup],
      shrubs: [scene.berryPatchVisuals.group, forest.undergrowth.group],
      groundPlants: [scene.mushroomPatchVisuals.group, forest.forestFloorIvy.group, forest.forestFloorNettles.group,
        ...scene.grassField.group.children.filter(child => child.userData.wildflowerVariant !== undefined)],
      groundScatter: [forest.forestFloorTwigs.group, forest.harvestStumps.group, forest.timberLogs.group,
        forest.group.getObjectByName('Instanced woodland and meadow boulder field')],
    };
    const visibility = Object.values(layers).flat().map(root => [root, root.visible]);
    const results = [];
    try {
      for (const selected of [...Object.keys(layers), 'vegetation']) {
        for (const [root] of visibility) root.visible = true;
        diagnostics.setHidden(selected, true);
        diagnostics.beginRender();
        try {
          for (const [category, roots] of Object.entries(layers)) {
            const off = selected === category || selected === 'vegetation' && ['reeds', 'shrubs', 'groundPlants'].includes(category);
            results.push({ selected, category, roots: roots.length, correct: roots.length > 0 && roots.every(root => root.visible === !off) });
          }
        } finally { diagnostics.endRender(); }
        diagnostics.setHidden(selected, false);
      }
    } finally {
      diagnostics.reset();
      for (const [root, visible] of visibility) root.visible = visible;
    }
    return results;
  });
  assert.ok(layerChecks.every(check => check.correct), JSON.stringify(layerChecks));
  await page.evaluate(() => { window.__originalSceneRender = window.__profileTestApp.sceneManager.render; });
  await page.keyboard.press('m');
  await page.locator('[data-profile-record]').click();
  await page.locator('.debug-profile-recording').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => window.__profileTestApp.sceneManager.renderDiagnostics.profiler.getFrameCount() >= 12);
  // The real placement preview keeps updating; M must remain available to change switches or stop.
  await page.evaluate(() => window.__profileTestApp.buildingTool.setMode('well'));
  await page.keyboard.press('m');
  await page.locator('[data-render-category="trees"]').click();
  for (const category of ['grass', 'crops', 'reeds', 'shrubs', 'groundPlants', 'groundScatter', 'vegetation']) {
    await page.locator(`[data-render-category="${category}"]`).click();
  }
  await page.locator('[data-render-buildings="placeholder"]').click();
  await page.getByRole('button', { name: 'Hide all buildings', exact: true }).click();
  await page.keyboard.press('m');
  await page.mouse.move(580, 340);
  await page.mouse.wheel(0, -420);
  await page.keyboard.down('w');
  await page.waitForTimeout(800);
  await page.keyboard.up('w');
  await page.waitForFunction(() => window.__profileTestApp.sceneManager.renderDiagnostics.profiler.getFrameCount() >= 40);
  await page.locator('[data-profile-stop-floating]').click();
  await page.waitForFunction(() => Boolean(window.__copiedProfile));
  const text = await page.evaluate(() => window.__copiedProfile);
  const profile = JSON.parse(text.slice(text.indexOf('\n') + 1));
  writeFileSync(`${output}/profile.txt`, text);
  assert.ok(profile.summary.frames >= 40);
  assert.equal(profile.metadata.mode, 'single');
  assert.ok(profile.states.some(state => state.toggles.hidden.includes('trees')));
  assert.ok(profile.states.some(state => state.toggles.buildings === 'placeholder'));
  assert.ok(profile.states.some(state => state.toggles.buildings === 'hidden'));
  for (const category of ['grass', 'crops', 'reeds', 'shrubs', 'groundPlants', 'groundScatter', 'vegetation']) {
    assert.ok(profile.states.some(state => state.toggles.hidden.includes(category)), `solo profile records ${category}`);
  }
  assert.ok(profile.cohorts.some(cohort => /zoom|pan|input/.test(cohort.key)));
  assert.ok(profile.cohorts.some(cohort => cohort.key.includes('building:well')));
  assert.ok(Object.hasOwn(profile.summary.meanCpuMsInclusive, 'scene.prepare+render'));
  assert.ok(Object.hasOwn(profile.summary.meanCpuMsInclusive, 'preview.building'));
  assert.ok(await page.evaluate(() => window.__profileTestApp.sceneManager.render === window.__originalSceneRender));
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/validation.json`, JSON.stringify({ frames: profile.summary.frames, bytes: text.length, gpu: profile.gpu, layerChecks, errors }, null, 2));
  await page.screenshot({ path: `${output}/profile-copied.png` });
  console.log(JSON.stringify({ frames: profile.summary.frames, bytes: text.length, gpuSamples: profile.gpu.samples, errors }));
} finally {
  writeFileSync(`${output}/browser-errors.json`, JSON.stringify(errors, null, 2));
  await browser?.close();
  await server.close();
}
