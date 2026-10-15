import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import os from 'node:os';
import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import { beginGpuPassCosts } from './fixtures/gpuPassCosts.js';
import { measureSinglePlayerLayerCosts } from './fixtures/singlePlayerLayerCosts.js';

// Local-only staging uses the existing trailer server feature. No trailer clock,
// recording mode, visual-QA fixture, or debug frame profiler is used in the run.
const label = process.argv[2] || 'singleplayer-journey-1080p';
const mapSize = process.argv.includes('--small') ? 'small' : 'large';
const matched = process.argv.includes('--matched');
const compareLayers = process.argv.includes('--layers');
const quick = process.argv.includes('--comparison');
const resumeComplex = process.argv.includes('--resume-complex');
const preset = matched ? 'mrkopalj_polje' : 'delnice_meadow';
// Both map sizes keep the authored residential blocks clear of protected
// deposits with this variation; normal placement validation remains enabled.
const seedHex = matched ? '4D50A473' : '4310A350';
assert(/^[a-z0-9-]+$/.test(label));
const output = `artifacts/city-performance/${label}`;
const uri = process.env.SP_PROFILE_URI || 'http://127.0.0.1:3200';
const database = process.env.SP_PROFILE_DB || 'selo-trailer-sp-performance';
assert(['localhost', '127.0.0.1'].includes(new URL(uri).hostname));
assert(database.startsWith('selo-trailer-sp-'));
const seconds = Number(process.env.SP_PROFILE_SECONDS || 25);
const warmSeconds = Number(process.env.SP_PROFILE_WARM_SECONDS || 20);
mkdirSync(output, { recursive: true });
const errors = [], consoleErrors = [], results = [];
const manifest = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  startedAt: new Date().toISOString(), viewport: [1920, 1080], deviceScaleFactor: 1,
  client: 'production Vite build; native Edge WebGPU; headless; normal gameplay HUD',
  mode: 'singleplayer', uri, database, frameProfiler: false,
  mapSize, preset, seedHex, quick, compareLayers,
  setup: 'Successive camp/hamlet/complex stages created with existing local-only trailer_author. Real server rows; normal 1x scheduler throughout measured cohorts. Finite cheated initial stocks/population; no claim of an organically grown or indefinitely sustainable economy.',
  lighting: 'Summer 14:00 presentation override; economy clock advances normally.',
  seconds, warmSeconds,
  host: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length, memoryGiB: os.totalmem() / 2 ** 30 },
};
if (resumeComplex && existsSync(`${output}/report.json`)) {
  const prior = JSON.parse(readFileSync(`${output}/report.json`, 'utf8'));
  const raw = JSON.parse(readFileSync(`${output}/samples.json`, 'utf8'));
  for (const row of prior.results.filter(row => /^0[12]-/.test(row.name)))
    results.push({ ...row, samples: raw.find(r => r.name === row.name)?.samples || [] });
  manifest.resumedPrefix = { startedAt: prior.manifest.startedAt, errors: prior.errors,
    note: 'Previously completed camp/hamlet cohorts retained. Failed complex cohort was rejected because its authoritative clock did not advance. Reload the persisted completed village before continuing.' };
}
let server, browser, page;
function save() {
  writeFileSync(`${output}/report.json`, JSON.stringify({ manifest, results: results.map(({ samples, ...rest }) => rest), errors, consoleErrors }, null, 2));
  writeFileSync(`${output}/samples.json`, JSON.stringify(results.map(({ name, samples }) => ({ name, samples }))));
}
async function serverClock() {
  const { token } = JSON.parse(readFileSync('.tmp-realm-publisher/identity.json', 'utf8'));
  const response = await fetch(`${uri}/v1/database/${database}/sql`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: 'SELECT sim_tick,game_speed FROM world_config', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error(`Clock read failed: ${response.status}`);
  const row = (await response.json())[0].rows[0];
  return { tick: String(row[0]), speed: row[1] };
}
try {
  await build({
    logLevel: 'warn', cacheDir: 'artifacts/sp-journey-vite-cache',
    define: { 'import.meta.env.VITE_SPACETIME_URI': JSON.stringify(uri),
      'import.meta.env.VITE_SPACETIME_DB_NAME': JSON.stringify(database) },
    build: { outDir: `${output}/client` },
    plugins: [{ name: 'isolated-singleplayer-profile-handles', enforce: 'pre', transform(code, id) {
      const file = id.replaceAll('\\', '/').split('?')[0];
      if (file.endsWith('/src/app/trailerDirector.ts')) return `${code}\nexport { makePlan };`;
      if (!file.endsWith('/src/main.ts')) return;
      assert(code.includes('const app = new App(root);'));
      return `import { getConnection, getConnectionToken, getSpacetimeConfig } from './network/spacetimedbClient.ts';
        import { makePlan } from './app/trailerDirector.ts';
        import { gameClock } from './world/gameCalendar.ts';
        import { computeDayNightState } from './world/dayNightPresentation.ts';
        window.__spProfile = { getConnection, getConnectionToken, getSpacetimeConfig, makePlan,
          daylight(scene) { const clock=gameClock(0); clock.hour=14; clock.minute=0; clock.preciseHour=14;
            scene.setLightingReviewEnvironment('summer'); scene.setLightingReviewState(computeDayNightState(clock,false)); } };
        ${code.replace('const app = new App(root);', 'const app = new App(root); window.__spApp = app;')}`;
    } }],
  });
  server = await preview({ build: { outDir: `${output}/client` }, preview: { host: '127.0.0.1', port: 5193, strictPort: true } });
  browser = await chromium.launchPersistentContext('artifacts/sp-journey-browser-cache', {
    channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu', '--remote-debugging-port=9227'],
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  });
  page = await browser.newPage();
  for (const other of browser.pages()) if (other !== page) await other.close();
  page.on('pageerror', e => { errors.push(e.stack || e.message); console.log('pageerror', e.message); });
  page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
  await page.exposeFunction('__spLayerProgress', row => console.log('layer', JSON.stringify(row)));
  await page.goto('http://127.0.0.1:5193/?mode=singleplayer&visualProfile=0', { timeout: 180000, waitUntil: 'domcontentloaded' });
  let configured = false;
  for (let i = 0; i < 150; i++) {
    for (const name of [/Continue to Heraldry/, /Continue to Map Generation/]) {
      const button = page.getByRole('button', { name });
      if (await button.isVisible()) await button.click();
    }
    if (await page.locator('[data-map-size-value]').isVisible()) {
      for (let j = 0; j < 3 && await page.locator('[data-map-size-value]').getAttribute('data-value') !== mapSize; j++)
        await page.getByRole('button', { name: 'Next map size', exact: true }).click();
      await page.locator(`[data-terrain-preset="${preset}"]`).click();
      await page.getByRole('textbox', { name: 'World seed', exact: true }).fill(seedHex);
      await page.getByRole('textbox', { name: 'World seed', exact: true }).dispatchEvent('change');
      for (let j = 0; j < 3 && !(await page.locator('[data-difficulty-preset-value]').textContent()).includes('(Normal)'); j++)
        await page.locator('[data-world-selector="difficulty-preset"] [data-selector-step="1"]').evaluate(button => button.click());
      await page.getByRole('button', { name: /^Start world$/ }).click();
      configured = true;
    }
    const state = await page.evaluate(() => ({ app: !!window.__spApp?.sceneManager,
      connected: !!window.__spProfile?.getConnection()?.identity,
      config: Number(window.__spProfile?.getConnection()?.db.world_config.count() || 0),
      text: document.querySelector('[data-loading-label]')?.textContent }));
    if (i % 10 === 0) console.log('startup', JSON.stringify(state));
    if (state.app && state.connected && state.config) break;
    if (errors.length || /failed/i.test(state.text || '')) throw Error(`Startup failed: ${JSON.stringify(state)}`);
    await page.waitForTimeout(2000);
  }
  console.log('authoring camp', { configured });
  let fixtureToken;
  const call = async (name, args) => {
    fixtureToken ||= await page.evaluate(() => window.__spProfile.getConnectionToken()
      || localStorage.getItem(`medieval-road-system:spacetime-token:${window.__spProfile.getSpacetimeConfig().dbName}`));
    return page.evaluate(async ({ name, args, fixtureToken }) => {
    const p = window.__spProfile, config = p.getSpacetimeConfig();
    const response = await fetch(`${config.uri}/v1/database/${config.dbName}/call/${name}`, {
      method: 'POST', headers: { Authorization: `Bearer ${fixtureToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw Error(`${name}: ${response.status} ${await response.text()}`);
    }, { name, args, fixtureToken });
  };
  const author = async stage => {
    const plan = await page.evaluate(stage => window.__spProfile.makePlan(window.__spApp.sceneManager, stage), stage);
    plan.profile_clear_build_budget = true;
    writeFileSync(`${output}/plan-stage-${stage}.json`, JSON.stringify(plan, null, 2));
    await call('trailer_author', [JSON.stringify(plan)]);
    await call('set_game_speed', [1]);
    await page.waitForFunction(stage => {
      const s = window.__spApp?.gameState;
      return s?.buildings.size >= (stage === 0 ? 1 : stage === 1 ? 7 : 40)
        && s.residences.size >= (stage === 0 ? 0 : stage === 1 ? 12 : 72);
    }, stage, { timeout: 60000 });
  };
  if (!resumeComplex) await author(0);
  else await call('set_game_speed', [1]);
  for (let i = 0; i < 90; i++) {
    const skip = page.locator('[data-tutorial-skip]');
    if (await skip.isVisible()) {
      await skip.check({ force: true }); await page.locator('[data-tutorial-confirm]').click();
    }
    if (await page.evaluate(() => window.__medievalRoadStartup?.firstPlayableMs !== undefined
      && window.__spApp?.spacetimeStore?.isConnected === true
      && window.__spApp.gameState.buildings.size > 0)) break;
    if (i % 10 === 0) console.log('waiting for first playable');
    await page.waitForTimeout(1000);
  }
  manifest.runtime = await page.evaluate(mapSize => {
    const a = window.__spApp, p = window.__spProfile, c = p.getConnection()?.db.world_config.iter().next().value;
    if (a.sceneManager.worldLayout.settings.mapSize !== mapSize) throw Error(`Expected ${mapSize} map`);
    if (c && (c.foodSpoilageRate !== 100 || c.approvalDeclineRate !== 100)) throw Error('Normal household rates are required');
    p.daylight(a.sceneManager);
    const canvas = a.sceneManager.renderer.domElement;
    return { adapter: a.sceneManager.getRendererAdapterEvidence(), world: a.sceneManager.worldLayout.settings,
      config: c ? JSON.parse(JSON.stringify(c, (_, v) => typeof v === 'bigint' ? String(v) : v)) : null,
      connected: a.spacetimeStore.isConnected,
      canvas: [canvas.width, canvas.height], stats: a.sceneManager.getPerformanceStats(),
      startup: window.__medievalRoadStartup, treeCount: a.treeRegistry?.entries.length };
  }, mapSize);
  assert.deepEqual(manifest.runtime.canvas, [1920, 1080]);
  assert.equal(manifest.runtime.stats.backend, 'webgpu');
  console.log('live world ready', JSON.stringify({ adapter: manifest.runtime.adapter,
    world: manifest.runtime.world, canvas: manifest.runtime.canvas,
    firstPlayableMs: manifest.runtime.startup?.firstPlayableMs, treeCount: manifest.runtime.treeCount }));
  // Bookmarks are deterministic for this seed. Select a dense remote forest and
  // a sparse distant region from the actual accepted tree registry.
  const views = await page.evaluate(() => {
    const a = window.__spApp, trees = a.treeRegistry.entries;
    const half = a.sceneManager.terrain.size / 2;
    let forest = { x: 0, z: 0, count: -1 }, open = { x: 0, z: 0, count: Infinity };
    const small = half < 500, margin = small ? 75 : 240, step = small ? 90 : 240;
    for (let x = -half + margin; x <= half - margin; x += step) for (let z = -half + margin; z <= half - margin; z += step) {
      if (Math.hypot(x, z) < (small ? 390 : 650) || a.sceneManager.riverField.isRenderedWetAt(x, z)) continue;
      const count = trees.reduce((n, t) => n + (Math.hypot(t.x - x, t.z - z) < (small ? 80 : 140) ? 1 : 0), 0);
      if (count > forest.count) forest = { x, z, count };
      if (count < open.count) open = { x, z, count };
    }
    return { camp: [-55, 28, -.65, .7, 140], town: [-60, -20, -.7, .7, 260],
      wide: [-60, -20, -.7, .75, 440], near: [-85, -30, -.7, .58, 115],
      farms: [-110, -225, -.7, .7, 250],
      forest: [forest.x, forest.z, -.7, .7, 220], region: [open.x, open.z, -.7, .7, 260],
      selected: { forest, open, terrainSize: a.sceneManager.terrain.size } };
  });
  manifest.views = views;
  async function measure(name, pose, route = null, duration = seconds, warm = warmSeconds) {
    console.log('cohort', name, 'warming', warm);
    await page.evaluate(pose => window.__spApp.cameraController.applyShowcaseView(...pose), pose);
    await page.evaluate(() => document.querySelector('.noble-hud__reports-clear')?.click());
    await page.waitForTimeout(warm * 1000);
    // Instant fixture expansion can exceed the transport idle limit while new
    // models compile. Reacquire a real gameplay session; never benchmark a
    // frozen economy or substitute manually stepped simulation for live time.
    try {
      await page.evaluate(async () => {
        const c = window.__spProfile.getConnection();
        if (!c) throw Error('Gameplay transport unavailable');
        await Promise.race([c.reducers.enterWorld({}), new Promise((_, reject) => setTimeout(() => reject(Error('Gameplay admission timeout')), 5000))]);
      });
    } catch (error) {
      (manifest.admissionWarnings ||= []).push({ name, error: String(error) });
    }
    const backendBefore = await serverClock();
    const data = await page.evaluate(async ({ duration, route }) => {
      const a = window.__spApp, p = window.__spProfile;
      const snapshot = () => {
        const s = a.gameState, c = p.getConnection()?.db.world_config.iter().next().value;
        const inventory = [...s.buildings.values()].map(b => [b.id, b.water, b.firewood, b.timber, b.ryeBread, b.actionCooldown]);
        return { connected: a.spacetimeStore.isConnected, tick: String(c?.simTick ?? s.tick), speed: c?.gameSpeed ?? null,
          buildings: s.buildings.size, homes: s.residences.size,
          population: [...s.residences.values()].reduce((n, r) => n + r.population, 0),
          fields: s.farmFields.size, pastures: s.pastures.size, herds: s.livestockHerds.size,
          buildingKinds: [...s.buildings.values()].reduce((counts, b) => { counts[b.kind]=(counts[b.kind]||0)+1; return counts; }, {}),
          deliveries: s.deliveryTrips.size, oxen: s.stableOxen.size,
          inventory, render: a.sceneManager.getPerformanceStats(),
          carts: a.deliveryAgents.authoredCartDiagnostics(), crowd: a.villagers.authoredCrowdDiagnostics?.() };
      };
      const before = snapshot(), samples = [], start = performance.now();
      let last = await new Promise(requestAnimationFrame), lastRender = a.sceneManager.getPerformanceStats().frames;
      while (performance.now() - start < duration * 1000) {
        if (route) {
          const progress = Math.min(1, (performance.now() - start) / (duration * 1000));
          const segment = Math.min(route.length - 2, Math.floor(progress * (route.length - 1)));
          const t = progress * (route.length - 1) - segment;
          const p0 = route[segment], p1 = route[segment + 1];
          a.cameraController.applyShowcaseView(...p0.map((v, i) => v + (p1[i] - v) * t));
        }
        const time = await new Promise(requestAnimationFrame);
        const frames = a.sceneManager.getPerformanceStats().frames;
        samples.push({ intervalMs: time - last, rendered: frames - lastRender });
        last = time; lastRender = frames;
      }
      return { before, after: snapshot(), samples, elapsedMs: performance.now() - start };
    }, { duration, route });
    const backendAfter = await serverClock();
    const times = data.samples.map(s => s.intervalMs).sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const percentile = q => times[Math.min(times.length - 1, Math.ceil(times.length * q) - 1)];
    const row = { name, pose, route, ...data, backendBefore, backendAfter,
      meanFrameMs: mean, averageFps: 1000 / mean, medianFrameMs: percentile(.5),
      p95FrameMs: percentile(.95), p99FrameMs: percentile(.99), worstFrameMs: times.at(-1),
      framesOver33ms: times.filter(t => t > 33.4).length, framesOver50ms: times.filter(t => t > 50).length,
      framesWithinBudgetPct: times.filter(t => t <= 16.67).length / times.length * 100,
      frameCount: times.length, actualRenderedFrames: data.after.render.frames - data.before.render.frames,
      inventoryChanged: JSON.stringify(data.before.inventory) !== JSON.stringify(data.after.inventory) };
    row.health = { clientConnected: data.before.connected && data.after.connected,
      clientClockAdvanced: BigInt(data.after.tick) > BigInt(data.before.tick),
      serverClockAdvanced: BigInt(backendAfter.tick) > BigInt(backendBefore.tick),
      normalSpeed: data.before.speed === 1 && data.after.speed === 1 && backendAfter.speed === 1,
      renderedMostFrames: row.actualRenderedFrames >= row.frameCount * .9 };
    row.liveValidationPassed = Object.values(row.health).every(Boolean);
    delete row.before.inventory; delete row.after.inventory;
    results.push(row); save();
    try { await page.screenshot({ path: `${output}/${name}.png`, timeout: 10000 }); }
    catch (error) { (manifest.screenshotWarnings ||= []).push({ name, error: String(error) }); save(); }
    console.log('result', JSON.stringify({ name, fps: row.averageFps, mean: mean, p95: row.p95FrameMs,
      p99: row.p99FrameMs, worst: row.worstFrameMs, frames: row.frameCount,
      population: row.after.population, buildings: row.after.buildings, deliveries: row.after.deliveries,
      inventoryChanged: row.inventoryChanged, health: row.health }));
  }
  if (process.argv.includes('--lab')) {
    console.log('SP_LAB_READY');
    for await (const line of createInterface({ input: process.stdin, terminal: false })) {
      if (line === 'quit') break;
      try {
        if (line === 'village') await measure('03-complex-village', views.town);
        else if (line === 'layers') {
          const layers = await page.evaluate(`(${measureSinglePlayerLayerCosts.toString()})(window.__spApp)`);
          writeFileSync(`${output}/layer-costs.json`, JSON.stringify(layers, null, 2));
          manifest.layerCosts = layers; save();
        } else console.log('LAB_RESULT', JSON.stringify(await page.evaluate(line), (_,v)=>typeof v==='bigint'?String(v):v));
      } catch (error) { console.log('LAB_ERROR', String(error)); }
    }
    process.stdin.pause();
  } else {
  if (!resumeComplex) {
    await measure('01-starting-camp', views.camp, null, seconds, 30);
    await author(1);
    await measure('02-hamlet', views.town, null, seconds, quick ? 15 : 35);
    await author(2);
    // A load through the ordinary startup gate fully hydrates the completed
    // settlement before measuring it, as when opening a developed SP save.
    await page.reload({ timeout: 180000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__medievalRoadStartup?.firstPlayableMs !== undefined
      && window.__spApp?.gameState?.residences.size >= 72 && window.__spApp.spacetimeStore?.isConnected,
      null, { timeout: 180000 });
    await page.evaluate(() => window.__spProfile.daylight(window.__spApp.sceneManager));
    await call('set_game_speed', [1]);
  }
  // Ordinary purchases add draft animals without inventing extra workers.
  const stableId = await page.evaluate(() => [...window.__spApp.gameState.buildings.values()].find(b => b.kind === 'stable')?.id.replace('building-',''));
  const existingOxen = await page.evaluate(() => window.__spApp.gameState.stableOxen.size);
  if (stableId) for (let i = existingOxen; i < 3; i++) await call('purchase_stable_ox', [Number(stableId)]);
  await measure('03-complex-village', views.town, null, seconds, quick ? 30 : 60);
  if (!quick) {
    await measure('04-village-close', views.near);
    await measure('05-village-overview', views.wide);
    await measure('06-farm-production', views.farms);
  }
  await measure('07-dense-forest-first-visit', views.forest, null, seconds, 0);
  await measure('08-dense-forest-settled', views.forest);
  await measure('09-distant-region-first-visit', views.region, null, seconds, 0);
  const route = [views.town, views.forest, views.region, views.town];
  await measure('10-regional-pan-first-pass', views.town, route, quick ? 30 : 60, 5);
  await measure('11-regional-pan-repeat', views.town, route, quick ? 30 : 60, 5);
  await measure('12-village-return', views.town);
  manifest.gardenInventory = await page.evaluate(() => {
    const rows = new Map();
    for (const child of window.__spApp.backyardGardenMarkers.root.children) {
      let row = rows.get(child.name); if (!row) rows.set(child.name, row = { name: child.name, meshes: 0, triangles: 0 });
      child.traverse(object => { if (!object.isMesh) return; row.meshes++;
        row.triangles += (object.geometry.index?.count || object.geometry.attributes.position?.count || 0) / 3 * (object.count || 1); });
    }
    return [...rows.values()].sort((a,b)=>b.meshes-a.meshes);
  });
  if (compareLayers) {
    console.log('separate layer diagnostic');
    await page.evaluate(pose => window.__spApp.cameraController.applyShowcaseView(...pose), views.town);
    const layers = await page.evaluate(`(${measureSinglePlayerLayerCosts.toString()})(window.__spApp)`);
    writeFileSync(`${output}/layer-costs.json`, JSON.stringify(layers, null, 2));
    manifest.layerCosts = layers;
  }
  // Diagnostic instrumentation is installed only AFTER ordinary FPS cohorts.
  console.log('separate CPU diagnostic');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  await page.waitForTimeout(10000);
  const { profile } = await cdp.send('Profiler.stop');
  writeFileSync(`${output}/village-cpu.cpuprofile`, JSON.stringify(profile));
  for (const [name, pose] of [['village', views.town], ['forest', views.forest]]) {
    console.log('separate GPU diagnostic', name);
    await page.evaluate(pose => window.__spApp.cameraController.applyShowcaseView(...pose), pose);
    await page.waitForTimeout(5000);
    await page.evaluate(`window.__spFinishGpu = (${beginGpuPassCosts.toString()})(window.__spApp.sceneManager.renderer)`);
    await page.waitForTimeout(8000);
    const costs = await page.evaluate(() => window.__spFinishGpu());
    writeFileSync(`${output}/${name}-gpu-passes.json`, JSON.stringify(costs, null, 2));
  }
  manifest.finishedAt = new Date().toISOString();
  save();
  assert.deepEqual(errors, [], 'No uncaught game errors');
  assert.deepEqual(consoleErrors, [], 'No browser console errors');
  }
} catch (error) {
  errors.push(String(error)); save();
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => {
    server.httpServer.close(error => error ? reject(error) : resolve());
    server.httpServer.closeAllConnections();
  });
}
