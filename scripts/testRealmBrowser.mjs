import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fork } from 'node:child_process';
const output = 'artifacts/realm-browser';
mkdirSync(output, { recursive: true });
const { tokens } = JSON.parse(readFileSync('.tmp-realm-test-clients.json', 'utf8'));
const database = process.env.REALM_TEST_DB || 'city-builder-realm-loadtest';
const load = fork('scripts/realmClientLoad.mts', [], { execArgv: ['--import', 'tsx'],
  stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
load.stderr.on('data', data => console.error(String(data)));
const loadClients = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { load.kill(); reject(Error('Computer client setup timed out')); }, 90_000);
  load.once('message', message => {
    clearTimeout(timeout);
    if (message.ready) resolve(message.clients); else reject(Error('Computer client setup failed'));
  });
  load.once('exit', () => { clearTimeout(timeout); reject(Error('Computer load exited during setup')); });
});
console.log(`Browser load: ${loadClients} computer clients plus the measured browser`);
let browser;
try {
const channel = process.env.REALM_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
browser = await chromium.launch({ channel, headless: true, args: ['--enable-unsafe-webgpu'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => { errors.push(error.stack || error.message); console.log('pageerror', error.stack || error.message); });
page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); console.log(message.text().slice(0, 800)); } });
await context.addInitScript(({ token, database }) => {
  localStorage.setItem(`medieval-road-system:spacetime-token:${database}`, token);
}, { token: tokens[0], database });
await page.route('**/src/main.ts*', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: (await response.text()).replace('const app = new App(root);', 'const app = new App(root); window.__realmApp = app;') });
});
  const address = new URL(process.env.REALM_BROWSER_URL || 'http://127.0.0.1:5190/');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) throw Error('Local browser test only');
  address.searchParams.set('mode', 'multiplayer'); address.searchParams.set('visualProfile', '1');
  await page.goto(address.href, { timeout: 120_000 });
  for (let i = 0; i < 90; i++) {
    const state = await page.evaluate(() => ({
      loading: document.querySelector('[data-loading-label]')?.textContent,
      detail: document.querySelector('[data-loading-detail]')?.textContent,
      ready: !!window.__visualPerf,
    }));
    if (i % 5 === 0) console.log('Startup', JSON.stringify(state));
    if (state.ready) break;
    if (errors.length) throw new Error(errors.join('\n'));
    if (/failed/i.test(state.loading || '')) throw new Error(state.detail || state.loading);
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: `${output}/initial.png` });
  await page.waitForFunction(() => {
    const realm = window.__realmApp?.realmPresentation;
    const terrain = realm?.terrainStream.stream.stats;
    const forest = window.__realmApp?.sceneManager.scene.getObjectByName('Streamed realm woodland')?.userData.realmStream?.stats;
    return terrain?.resident > 0 && terrain.loading === 0 && terrain.queued === 0
      && forest?.resident > 0 && forest.loading === 0 && forest.queued === 0;
  }, undefined, { timeout: 120000 });
  await page.waitForTimeout(5000);
  const berryDraws = await page.evaluate(() => {
    const root = window.__realmApp.sceneManager.getBerryPatchRoot();
    const sources = [], draws = [];
    root?.traverse(o => {
      if (!o.isInstancedMesh || !o.name.startsWith('SeedThree real raspberry prototype')) return;
      if (o.userData.instanceCompactionSource) sources.push(o.count);
      if (o.userData.instanceCompactionDraw) draws.push(o.count);
    });
    return { sources, draws };
  });
  if (berryDraws.sources.length !== 3 || berryDraws.draws.length !== 3
    || berryDraws.draws.reduce((a,b) => a+b, 0) >= berryDraws.sources.reduce((a,b) => a+b, 0) / 3) {
    throw Error(`Late-loaded world berry instances were not compacted: ${JSON.stringify(berryDraws)}`);
  }
  await page.evaluate(() => {
    window.__visualPerf.deferDomPublicationUntilReady();
    window.__visualPerf.restartTrace();
  });
  const report = await page.evaluate(async () => {
    const app = window.__realmApp;
    if (!app?.sceneManager || !window.__visualPerf) throw new Error('Realm presentation did not become ready');
    const samples = [];
    let previous = performance.now();
    await new Promise(resolve => {
      const tick = time => { samples.push(time - previous); previous = time; if (samples.length < 300) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    });
    const sorted = samples.slice(1).sort((a, b) => a - b);
    const meshes = [];
    app.sceneManager.scene.traverseVisible(o => {
      if (!o.isMesh || !o.geometry) return;
      meshes.push({ name: o.name, instances: o.count ?? o.geometry.instanceCount ?? 1,
        triangles: (o.geometry.index?.count ?? o.geometry.attributes.position?.count ?? 0) / 3 * (o.count ?? o.geometry.instanceCount ?? 1),
        casts: o.castShadow });
    });
    return { viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      frames: sorted.length, meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)], p99Ms: sorted[Math.floor(sorted.length * 0.99)],
      stream: app.realmPresentation.terrainStream.stream.stats,
      stats: window.__medievalRoadStats, buildings: app.gameState.buildings.size,
      meshes: meshes.sort((a, b) => b.triangles - a.triangles).slice(0, 25),
      profile: window.__visualPerf.getReport(),
      profileStatus: document.documentElement.dataset.visualProfileStatus,
      profileIntegrityError: document.documentElement.dataset.visualProfileIntegrityError,
      camera: app.cameraController.getTargetPosition().toArray() };
  });
  await page.waitForFunction(() => window.__visualPerf.getReport()?.status === 'ready'
    || document.documentElement.dataset.visualProfileIntegrityError, undefined, { timeout: 90000 });
  const completedProfile = await page.evaluate(() => ({ profile: window.__visualPerf.getReport(),
    profileStatus: document.documentElement.dataset.visualProfileStatus,
    profileIntegrityError: document.documentElement.dataset.visualProfileIntegrityError }));
  if (completedProfile.profile?.status !== 'ready' || completedProfile.profileIntegrityError) {
    throw Error(`The performance cohort did not pass integrity checks: ${completedProfile.profileIntegrityError}`);
  }
  if (load.exitCode !== null) throw Error('Computer load exited before the measured cohort finished');
  Object.assign(report, completedProfile);
  report.berryDraws = berryDraws;
  report.clients = loadClients + 1;
  report.terrainBuffers = await page.evaluate(() => window.__realmApp.realmPresentation.terrainStream.stats);
  report.frameBudget = { targetMs: 1000 / 60, passed: report.p95Ms <= 1000 / 60,
    criterion: '95% of measured frame intervals at or below 16.67 ms' };
  writeFileSync(`${output}/report.json`, JSON.stringify({ ...report, errors }, null, 2));
  console.log(JSON.stringify({ ...report, errors }, null, 2));
  await page.evaluate(() => {
    const scene = window.__realmApp.sceneManager.scene;
    const renderer = window.__realmApp.sceneManager.renderer;
    const drawCosts = window.__realmDrawCosts = new Map();
    const draw = renderer._renderObjectDirect;
    renderer._renderObjectDirect = function(object, ...args) {
      const name = object.name || object.parent?.name || object.type;
      let entry = drawCosts.get(name);
      if (!entry) drawCosts.set(name, entry = { name, ms: 0, calls: 0 });
      const start = performance.now();
      const result = draw.call(this, object, ...args);
      entry.ms += performance.now() - start; entry.calls++;
      return result;
    };
    const costs = window.__realmMatrixCosts = new Map();
    const roots = [...scene.children, ...window.__realmApp.sceneManager.selectionGroup.children];
    for (const child of roots) {
      const original = child.updateMatrixWorld;
      const entry = { name: child.name || child.type, ms: 0, calls: 0, descendants: 0 };
      child.traverse(() => entry.descendants++); costs.set(child.uuid, entry);
      child.updateMatrixWorld = function(...args) {
        const start = performance.now(); const result = original.apply(this, args);
        entry.ms += performance.now() - start; entry.calls++; return result;
      };
    }
  });
  const profiler = await context.newCDPSession(page);
  await profiler.send('Profiler.enable'); await profiler.send('Profiler.start');
  await page.waitForTimeout(12000);
  const { profile } = await profiler.send('Profiler.stop');
  writeFileSync(`${output}/cpu.cpuprofile`, JSON.stringify(profile));
  const counts = new Map();
  for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
  const hot = profile.nodes.map(n => ({name:n.callFrame.functionName, file:n.callFrame.url.split('?')[0], line:n.callFrame.lineNumber+1, samples:counts.get(n.id)||0}))
    .sort((a,b)=>b.samples-a.samples).slice(0,35);
  writeFileSync(`${output}/cpu-hot.json`, JSON.stringify(hot,null,2)); console.log('CPU hot',JSON.stringify(hot));
  const matrixCosts = await page.evaluate(() => [...window.__realmMatrixCosts.values()].sort((a,b)=>b.ms-a.ms));
  writeFileSync(`${output}/matrix-costs.json`, JSON.stringify(matrixCosts,null,2));
  console.log('Matrix hot',JSON.stringify(matrixCosts.slice(0,15)));
  const drawCosts = await page.evaluate(() => [...window.__realmDrawCosts.values()].sort((a,b)=>b.ms-a.ms));
  writeFileSync(`${output}/draw-costs.json`, JSON.stringify(drawCosts,null,2));
  console.log('Draw hot',JSON.stringify(drawCosts.slice(0,20)));
  // Pass-local timestamps measure GPU execution without the queue-idle gaps
  // included by the formal profile's whole-render bookends. This separate
  // diagnostic runs only after the uncontaminated frame and CPU captures.
  await page.evaluate(() => {
    const renderer = window.__realmApp.sceneManager.renderer, backend = renderer.backend;
    if (!backend.device.features.has('timestamp-query')) throw Error('Pass timestamps unavailable');
    const labels = new Map(), costs = new Map();
    const begin = backend.beginRender;
    backend.beginRender = function(context) {
      const uid = this.getTimestampUID(context);
      labels.set(uid, `context ${context.id}: ${context.textures?.map(t => t.name || t.uuid).join(',') || 'canvas'} (${context.width}x${context.height})`);
      return begin.call(this, context);
    };
    backend.trackTimestamp = true;
    let pending = null;
    const collect = async () => {
      if (pending) return pending;
      pending = Promise.all(['render','compute'].map(type => renderer.resolveTimestampsAsync(type))).then(() => {
        for (const [type, pool] of Object.entries(backend.timestampQueryPool)) {
          if (!pool) continue;
          for (const [uid, ms] of pool.timestamps) {
            const name = labels.get(uid) || `${type} ${uid.replace(/:f\d+$/, '')}`;
            let cost = costs.get(name);
            if (!cost) costs.set(name, cost = { name, ms: 0, calls: 0, maxMs: 0 });
            cost.ms += ms; cost.calls++; cost.maxMs = Math.max(cost.maxMs, ms);
            labels.delete(uid);
          }
          pool.timestamps.clear();
        }
      }).finally(() => { pending = null; });
      return pending;
    };
    const timer = setInterval(() => { void collect(); }, 250);
    window.__realmFinishGpuPasses = async () => {
      clearInterval(timer); if (pending) await pending; await collect();
      backend.trackTimestamp = false; backend.beginRender = begin;
      return [...costs.values()].map(c => ({ ...c, meanMs: c.ms / c.calls })).sort((a,b) => b.ms-a.ms);
    };
  });
  await page.waitForTimeout(12000);
  const gpuPasses = await page.evaluate(() => window.__realmFinishGpuPasses());
  writeFileSync(`${output}/gpu-passes.json`, JSON.stringify(gpuPasses,null,2));
  console.log('GPU passes',JSON.stringify(gpuPasses.slice(0,20)));
  await page.screenshot({ path: `${output}/camp.png` });
  await page.evaluate(() => window.__realmApp.cameraController.enterIllustratedMap());
  await page.waitForFunction(() => window.__realmApp.sceneManager.isIllustratedMapActive(), undefined, { timeout: 30000 });
  await page.evaluate(() => {
    const camera = window.__realmApp.cameraController;
    for (let i=0;i<12;i++) camera.stepIllustratedMapZoom(1);
  });
  await page.waitForTimeout(3000);
  const parchment = await page.evaluate(() => {
    const app = window.__realmApp, realm = app.realmPresentation;
    const alpha = { unknown: 0, remembered: 0, visible: 0 };
    for(let i=3;i<realm.rgba.length;i+=4) {
      if(realm.rgba[i]===255)alpha.unknown++;else if(realm.rgba[i]===115)alpha.remembered++;else alpha.visible++;
    }
    return { active: app.sceneManager.isIllustratedMapActive(), alpha,
      worldSize: realm.veil.geometry.parameters.width,
      terrain: realm.terrainStream.stream.stats,
      fpsLabel: document.querySelector('[data-stat="fps"]')?.textContent };
  });
  writeFileSync(`${output}/parchment.json`, JSON.stringify(parchment,null,2));
  await page.screenshot({path:`${output}/parchment.png`});
  if(!parchment.active||parchment.worldSize!==12288||parchment.alpha.unknown===0||parchment.alpha.visible===0)throw Error('Parchment fog contract failed');
  await page.evaluate(() => window.__realmApp.cameraController.exitIllustratedMap(true));
  await page.waitForFunction(() => {
    const stream = window.__realmApp.realmPresentation.terrainStream.stream.stats;
    return stream.resident > 0 && stream.loading === 0 && stream.queued === 0;
  }, undefined, { timeout: 30000 });
  const returned = await page.evaluate(() => ({ terrain: window.__realmApp.realmPresentation.terrainStream.stream.stats,
    active: window.__realmApp.sceneManager.isIllustratedMapActive() }));
  writeFileSync(`${output}/returned.json`, JSON.stringify(returned,null,2));
  if (returned.active || returned.terrain.hits <= report.stream.hits || returned.terrain.misses !== report.stream.misses) {
    throw Error('Returning from the parchment map did not reuse the resident terrain cache');
  }
  if (errors.length) throw Error(errors.join('\n'));
  await page.screenshot({path:`${output}/returned.png`});
  if (!report.frameBudget.passed) throw Error(`Frame budget missed: P95 ${report.p95Ms.toFixed(2)} ms; target 16.67 ms`);
} finally {
  await browser?.close();
  if (load.connected) load.send('stop');
  else load.kill();
}
