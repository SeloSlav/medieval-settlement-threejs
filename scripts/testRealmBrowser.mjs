import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fork } from 'node:child_process';
import { build, createServer, preview } from 'vite';
import { createInterface } from 'node:readline';
import { beginGpuPassCosts } from './fixtures/gpuPassCosts.js';
import { measureUiCompositionCosts } from './fixtures/uiCompositionCosts.js';
import { measureRealmTerrainIdle } from './fixtures/realmTerrainIdleCosts.js';
const output = process.env.REALM_BROWSER_OUTPUT || 'artifacts/realm-browser';
const forestBatches = process.env.REALM_BROWSER_FOREST_BATCHES !== '0';
const uniformUploads = process.env.REALM_BROWSER_UNIFORM_UPLOADS !== '0';
const navigationSweeps = process.env.REALM_BROWSER_NAVIGATION_SWEEPS !== '0';
const settleVegetationCache = process.env.REALM_BROWSER_WAIT_FOR_CACHE === '1';
const frameProfiling = process.env.REALM_BROWSER_FRAME_PROFILE !== '0';
const staleVegetationCache = process.env.REALM_BROWSER_STALE_CARD_CACHE === '1';
const productionBuild = process.env.REALM_BROWSER_PRODUCTION === '1';
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
let server;
let startupProfileTimer;
try {
const realmDefine = {
  'import.meta.env.VITE_MULTIPLAYER_DB_NAME': JSON.stringify(database),
  'import.meta.env.VITE_MULTIPLAYER_URI': JSON.stringify(process.env.REALM_TEST_URI || 'http://127.0.0.1:3100'),
};
if (productionBuild) {
  if (!forestBatches || !uniformUploads || !navigationSweeps) throw Error('Production benchmark requires all gameplay optimizations');
  await build({ define: realmDefine, logLevel: 'warn', build: { outDir: `${output}/client` }, plugins: [{
    name: 'local-realm-benchmark-handles', enforce: 'pre', transform(code,id) {
      const file = id.replaceAll('\\','/').split('?')[0];
      if (file.endsWith('/src/main.ts')) return code.replace('const app = new App(root);',
        'await (window.__realmStaleCardCachePromise || Promise.resolve()); const app = new App(root); window.__realmApp = app;');
      if (file.endsWith('/src/vegetation/seedthree/seedThreeBranchCards.ts')) return `${code}\nwindow.__realmBranchCardCache = {
        waitForSeedThreeBranchCardPersistence, getSeedThreeBranchCardStartupTimings
      };`;
    },
  }] });
  server = await preview({ build: { outDir: `${output}/client` }, preview: { host: '127.0.0.1',port: 0 } });
} else if (!process.env.REALM_BROWSER_URL) {
  server = await createServer({
    cacheDir: 'artifacts/realm-browser-vite-cache',
    define: realmDefine,
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await server.listen();
}
const channel = process.env.REALM_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
browser = await chromium.launchPersistentContext(process.env.REALM_BROWSER_CACHE || 'artifacts/realm-browser-cache', {
  channel, headless: true, args: ['--enable-unsafe-webgpu'],
  viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
});
const context = browser;
const page = await context.newPage();
for (const other of context.pages()) if (other !== page) await other.close();
let startupProfileCapture = Promise.resolve();
if (process.env.REALM_BROWSER_STARTUP_PROFILE === '1') {
  const startupProfiler = await context.newCDPSession(page);
  await startupProfiler.send('Profiler.enable');
  await startupProfiler.send('Profiler.start');
  startupProfileCapture = new Promise(resolve => {
    startupProfileTimer = setTimeout(async () => {
      try {
        const { profile } = await startupProfiler.send('Profiler.stop');
        writeFileSync(`${output}/startup-cpu.cpuprofile`, JSON.stringify(profile));
        console.log('Startup CPU profile captured');
      } catch (error) { console.log('Startup CPU capture unavailable', String(error)); }
      finally { resolve(); }
    }, 45000);
  });
}
const errors = [];
const forestStartupRecords = [];
const forestStartupReads = [];
page.on('pageerror', error => { errors.push(error.stack || error.message); console.log('pageerror', error.stack || error.message); });
page.on('console', message => {
  if (message.type() === 'error') { errors.push(message.text()); console.log(message.text().slice(0, 800)); }
  if (message.text().startsWith('[Startup] SeedThree forest stages')) {
    forestStartupReads.push(message.args()[1].jsonValue().then(record => forestStartupRecords.push(record)));
  }
});
// Read the cache module used by the running game. A raw dynamic import can
// create a second Vite module instance after an HMR edit.
await page.route('**/src/vegetation/seedthree/seedThreeBranchCards.ts*', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: `${await response.text()}\nwindow.__realmBranchCardCache = {
    waitForSeedThreeBranchCardPersistence, getSeedThreeBranchCardStartupTimings
  };` });
});
await context.addInitScript(({ token, database }) => {
  localStorage.setItem(`medieval-road-system:spacetime-token:${database}`, token);
}, { token: tokens[0], database });
if (staleVegetationCache) {
  const catalogSource = readFileSync('src/vegetation/seedthree/seedThreeBakedBranchCardCatalog.ts','utf8');
  const catalog = JSON.parse(catalogSource.match(/= (\{[\s\S]*\});/)?.[1] || '{}');
  if (Object.keys(catalog).length !== 7) throw Error('Stale-cache fixture requires the production baked catalog');
  await context.addInitScript(keys => {
    window.__realmStaleCardCachePromise = new Promise((resolve,reject) => {
      const request = indexedDB.open('medieval-road-system-generated-vegetation',1);
      request.onupgradeneeded = ()=>request.result.createObjectStore('branch-cards',{ keyPath: 'key' });
      request.onerror = ()=>reject(request.error);
      request.onsuccess = ()=>{
        const db = request.result,transaction = db.transaction('branch-cards','readwrite');
        for (const key of keys) transaction.objectStore('branch-cards').put({ key,
          sets: [{ key: '2:fol',foliageOnly: true,noFlutter: false,variants: [] }] });
        transaction.oncomplete = ()=>{ db.close(); resolve(); };
        transaction.onerror = ()=>reject(transaction.error);
      };
    });
  },Object.keys(catalog));
}
await page.route('**/src/main.ts*', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: (await response.text()).replace('const app = new App(root);',
    'await (window.__realmStaleCardCachePromise || Promise.resolve()); const app = new App(root); window.__realmApp = app;') });
});
if (!forestBatches) await page.route('**/src/multiplayer/RealmForestStream.ts*', async route => {
  const response = await route.fetch(), source = await response.text();
  const registration = 'batches.add(tile.group);';
  if (!source.includes(registration)) throw Error('Forest reference route no longer matches the production registration');
  await route.fulfill({ response, body: source.replace(registration, '') });
});
if (!uniformUploads) await page.route('**/src/scene/RendererBackend.ts*', async route => {
  const response = await route.fetch(), source = await response.text();
  const installation = 'installUniformUploadCoalescing(renderer);';
  if (!source.includes(installation)) throw Error('Uniform upload reference route no longer matches production');
  await route.fulfill({ response, body: source.replace(installation, '') });
});
if (!navigationSweeps) await page.route('**/src/camera/fp/fpCollisionWorld.ts*', async route => {
  const response = await route.fetch(), source = await response.text();
  const binding = 'const isStaticSegmentClear =';
  const invocation = 'const route = !isNavigationBlocked ?';
  if (!source.includes(binding) || !source.includes(invocation)) throw Error('Navigation reference no longer matches production');
  await route.fulfill({ response, body: source.replace(binding, 'const unusedStaticSegmentClear =')
    .replace(invocation, `const isStaticSegmentClear = undefined; ${invocation}`) });
});
  const address = new URL(productionBuild ? server.resolvedUrls.local[0]
    : process.env.REALM_BROWSER_URL || server.resolvedUrls.local[0]);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) throw Error('Local browser test only');
  address.searchParams.set('mode', 'multiplayer'); address.searchParams.set('visualProfile', frameProfiling ? '1' : '0');
  console.log('Browser address', address.href);
  await page.goto(address.href, { timeout: 120_000, waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 90; i++) {
    const state = await page.evaluate(() => ({
      loading: document.querySelector('[data-loading-label]')?.textContent,
      detail: document.querySelector('[data-loading-detail]')?.textContent,
      ready: !!window.__visualPerf || (window.__medievalRoadStats?.frames > 10
        && (!document.getElementById('app-loading') || !!document.querySelector('#app-loading.is-dismissed'))),
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
  await startupProfileCapture;
  const vegetationCache = await page.evaluate(async settle => {
    const cache = window.__realmBranchCardCache;
    if (!cache) throw Error('Running forest cache module unavailable');
    const started = performance.now();
    if (settle) await cache.waitForSeedThreeBranchCardPersistence();
    return { settledBeforeCohort: settle, waitMs: performance.now()-started,
      timings: cache.getSeedThreeBranchCardStartupTimings() };
  }, settleVegetationCache);
  await Promise.all(forestStartupReads);
  // Replacing the initial forest clears global timings; streamed chunks can
  // reuse prototypes without loading cards again. Preserve the actual initial
  // build evidence instead of treating that empty diagnostics map as a miss.
  vegetationCache.initialBuild = forestStartupRecords.find(record => record.branchCards?.length === 7);
  writeFileSync(`${output}/vegetation-startup.json`, JSON.stringify({ vegetationCache, forestStartupRecords },null,2));
  const initialCards = vegetationCache.initialBuild?.branchCards;
  if (initialCards?.length !== 7 || initialCards.some(t=>t.source!=='asset' || t.persistenceQueued))
    throw Error(`Production forest did not use shipped atlases without background persistence; see ${output}/vegetation-startup.json`);
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
    window.__visualPerf?.deferDomPublicationUntilReady();
    window.__visualPerf?.restartTrace();
  });
  const report = await page.evaluate(async () => {
    const app = window.__realmApp;
    if (!app?.sceneManager) throw new Error('Realm presentation did not become ready');
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
      forest: (() => {
        const root = app.sceneManager.scene.getObjectByName('Streamed realm woodland');
        return { stream: root?.userData.realmStream?.stats, colorBatches: root?.userData.realmInstanceBatches?.stats(),
          shadowBatches: root?.userData.realmInstanceBatches?.stats(true) };
      })(),
      stats: window.__medievalRoadStats, startup: window.__medievalRoadStartup, buildings: app.gameState.buildings.size,
      population: [...app.gameState.residences.values()].reduce((total,home)=>total+home.population,0),
      civilianAgents: app.villagers?.agents?.size,
      carts: app.deliveryAgents?.authoredCartDiagnostics(),
      meshes: meshes.sort((a, b) => b.triangles - a.triangles).slice(0, 25),
      profile: window.__visualPerf?.getReport() ?? null,
      profileStatus: document.documentElement.dataset.visualProfileStatus,
      profileIntegrityError: document.documentElement.dataset.visualProfileIntegrityError,
      camera: app.cameraController.getTargetPosition().toArray() };
  });
  if (frameProfiling) {
  await page.waitForFunction(() => window.__visualPerf.getReport()?.status === 'ready'
    || document.documentElement.dataset.visualProfileIntegrityError, undefined, { timeout: 90000 });
  const completedProfile = await page.evaluate(() => ({ profile: window.__visualPerf.getReport(),
    profileStatus: document.documentElement.dataset.visualProfileStatus,
    profileIntegrityError: document.documentElement.dataset.visualProfileIntegrityError }));
  if (completedProfile.profile?.status !== 'ready' || completedProfile.profileIntegrityError) {
    throw Error(`The performance cohort did not pass integrity checks: ${completedProfile.profileIntegrityError}`);
  }
  Object.assign(report, completedProfile);
  }
  if (load.exitCode !== null) throw Error('Computer load exited before the measured cohort finished');
  report.berryDraws = berryDraws;
  report.clients = loadClients + 1;
  report.forestBatchesEnabled = forestBatches;
  report.uniformUploadsCoalesced = uniformUploads;
  report.terrainBuffers = await page.evaluate(() => window.__realmApp.realmPresentation.terrainStream.stats);
  report.frameBudget = { targetMs: 1000 / 60, passed: report.p95Ms <= 1000 / 60,
    criterion: '95% of measured frame intervals at or below 16.67 ms' };
  report.navigationSweeps = navigationSweeps;
  report.vegetationCache = vegetationCache;
  report.frameProfiling = frameProfiling;
  report.staleVegetationCache = staleVegetationCache;
  report.productionBuild = productionBuild;
  writeFileSync(`${output}/report.json`, JSON.stringify({ ...report, errors }, null, 2));
  console.log(JSON.stringify({ ...report, errors }, null, 2));
  if (process.env.REALM_BROWSER_KEEP === '1') {
    console.log('REALM_LAB_READY');
    for await (const line of createInterface({ input: process.stdin, terminal: false })) {
      if (line === 'quit') break;
      try { console.log('LAB_RESULT', JSON.stringify(await page.evaluate(line))); }
      catch (error) { console.log('LAB_ERROR', String(error)); }
    }
  }
  await page.evaluate(() => {
    const scene = window.__realmApp.sceneManager.scene;
    const renderer = window.__realmApp.sceneManager.renderer;
    const collision = window.__realmApp.firstPersonController?.config.collisionWorld;
    if (!collision) throw Error('Crowd collision world unavailable for navigation diagnostics');
    const navigate = collision.routeAgentPath;
    const legCache = collision.staticAgentLegs;
    const initialLegCache = legCache ? {hits:legCache.hits,misses:legCache.misses} : null;
    const diskIndex = collision.staticIndex;
    const initialDiskCache = {hits:diskIndex.diskQueryHits??0,misses:diskIndex.diskQueryMisses??0};
    const navigation = { calls: 0, ms: 0, longestMs: 0, groups: [] };
    let group;
    collision.routeAgentPath = function(path, radius = 0.28) {
      const dirty = this.staticDirty;
      const start = performance.now();
      const result = navigate.call(this,path,radius);
      const duration = performance.now()-start;
      navigation.calls++; navigation.ms += duration; navigation.longestMs = Math.max(navigation.longestMs,duration);
      if (navigation.calls <= 160 && (!group || dirty)) {
        group = { colliders: [...this.staticIndex.colliders], routes: [] }; navigation.groups.push(group);
      }
      if (navigation.calls <= 160) group.routes.push({ path: path.map(p => ({ x: p.x, z: p.z })), radius });
      return result;
    };
    window.__realmFinishNavigation = () => {
      collision.routeAgentPath = navigate;
      if (legCache && initialLegCache) navigation.staticLegCache = {hits:legCache.hits-initialLegCache.hits,
        misses:legCache.misses-initialLegCache.misses,entries:legCache.size};
      navigation.staticDiskCache = {hits:(diskIndex.diskQueryHits??0)-initialDiskCache.hits,
        misses:(diskIndex.diskQueryMisses??0)-initialDiskCache.misses,entries:diskIndex.diskQueryEntries??0};
      return navigation;
    };
    const backend = renderer.backend, queue = backend.device.queue;
    const uniformCosts = window.__realmUniformCosts = { updates: 0, nativeWrites: 0, actualWrites: 0, ms: 0 };
    const updateBinding = backend.updateBinding, writeBuffer = queue.writeBuffer;
    let inUniformUpload = false;
    backend.updateBinding = function(binding) {
      const uniform = binding.isUniformBuffer && binding.isUniformsGroup;
      if (!uniform) return updateBinding.call(this,binding);
      uniformCosts.updates++;
      const ranges = binding.updateRanges;
      uniformCosts.nativeWrites += ranges.length ? ranges.reduce((count,range,index) =>
        count + Number(index === ranges.length-1 || range.start + range.count !== ranges[index+1].start),0) : 1;
      const start = performance.now(); inUniformUpload = true;
      try { return updateBinding.call(this,binding); }
      finally { inUniformUpload = false; uniformCosts.ms += performance.now()-start; }
    };
    queue.writeBuffer = function(...args) {
      if (inUniformUpload) uniformCosts.actualWrites++;
      return writeBuffer.apply(this,args);
    };
    window.__realmFinishUniformCosts = () => {
      backend.updateBinding = updateBinding; queue.writeBuffer = writeBuffer;
      return uniformCosts;
    };
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
  const uniformCosts = await page.evaluate(() => window.__realmFinishUniformCosts());
  const navigationCosts = await page.evaluate(() => window.__realmFinishNavigation());
  writeFileSync(`${output}/navigation-workload.json`, JSON.stringify(navigationCosts));
  console.log('Navigation',JSON.stringify({ calls: navigationCosts.calls, ms: navigationCosts.ms,
    longestMs: navigationCosts.longestMs, groups: navigationCosts.groups.length, staticLegCache:navigationCosts.staticLegCache,
    staticDiskCache:navigationCosts.staticDiskCache }));
  writeFileSync(`${output}/uniform-costs.json`,JSON.stringify(uniformCosts,null,2));
  console.log('Uniform uploads',JSON.stringify(uniformCosts));
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
  await page.evaluate(`window.__realmFinishGpuPasses = (${beginGpuPassCosts.toString()})(window.__realmApp.sceneManager.renderer);`);
  await page.waitForTimeout(12000);
  const gpuPasses = await page.evaluate(() => window.__realmFinishGpuPasses());
  writeFileSync(`${output}/gpu-passes.json`, JSON.stringify(gpuPasses,null,2));
  console.log('GPU passes',JSON.stringify(gpuPasses.slice(0,20)));
  if (process.env.REALM_BROWSER_TRACE === '1') {
    const { captureBrowserFrameTrace } = await import('./fixtures/browserFrameTrace.mjs');
    await captureBrowserFrameTrace(page, `${output}/browser-frame-trace.json`);
  }
  if (process.env.REALM_BROWSER_UI_DIAGNOSTIC === '1') {
    const costs = await page.evaluate(`(${measureUiCompositionCosts.toString()})()`);
    writeFileSync(`${output}/ui-composition-costs.json`,JSON.stringify(costs,null,2));
    console.log('UI composition',JSON.stringify(costs));
  }
  if (process.env.REALM_BROWSER_TERRAIN_DIAGNOSTIC === '1') {
    const costs = await page.evaluate(`(${measureRealmTerrainIdle.toString()})(window.__realmApp.realmPresentation.terrainStream,
      window.__realmApp.cameraController.getTargetPosition().x, window.__realmApp.cameraController.getTargetPosition().z)`);
    writeFileSync(`${output}/terrain-idle-costs.json`, JSON.stringify(costs, null, 2));
    console.log('Terrain idle', JSON.stringify(costs));
  }
  await page.screenshot({ path: `${output}/camp.png` });
  await page.evaluate(() => {
    const app=window.__realmApp, backend=app.sceneManager.renderer.backend, buffers=window.__realmTerrainGpuBuffers=new Map();
    app.realmPresentation.terrainStream.group.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const vertex=backend.get(mesh.geometry.getAttribute('position').data).buffer,index=backend.get(mesh.geometry.index).buffer;
      if(vertex&&index)buffers.set(mesh,[vertex,index]);
    });
    if(!buffers.size)throw Error('Terrain GPU cache proof requires rendered cells');
  });
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
    terrainBuffers: window.__realmApp.realmPresentation.terrainStream.stats,
    active: window.__realmApp.sceneManager.isIllustratedMapActive() }));
  returned.reusedNativeTerrainBuffers=await page.evaluate(()=>{
    const backend=window.__realmApp.sceneManager.renderer.backend;
    for(const [mesh,[vertex,index]]of window.__realmTerrainGpuBuffers){
      if(backend.get(mesh.geometry.getAttribute('position').data).buffer!==vertex
        ||backend.get(mesh.geometry.index).buffer!==index)throw Error('Returning from the parchment map replaced a terrain GPU buffer');
    }
    return window.__realmTerrainGpuBuffers.size*2;
  });
  writeFileSync(`${output}/returned.json`, JSON.stringify(returned,null,2));
  if (returned.active || returned.terrain.hits <= report.stream.hits || returned.terrain.misses !== report.stream.misses) {
    throw Error('Returning from the parchment map did not reuse the resident terrain cache');
  }
  if (returned.terrainBuffers.draws.allocations !== report.terrainBuffers.draws.allocations
    || returned.terrainBuffers.draws.cacheHits <= report.terrainBuffers.draws.cacheHits) {
    throw Error('Returning from the parchment map did not reuse the consolidated terrain GPU buffers');
  }
  if (errors.length) throw Error(errors.join('\n'));
  await page.screenshot({path:`${output}/returned.png`});
  if (!report.frameBudget.passed) throw Error(`Frame budget missed: P95 ${report.p95Ms.toFixed(2)} ms; target 16.67 ms`);
} finally {
  clearTimeout(startupProfileTimer);
  await browser?.close();
  await server?.close();
  if (load.connected) load.send('stop');
  else load.kill();
}
