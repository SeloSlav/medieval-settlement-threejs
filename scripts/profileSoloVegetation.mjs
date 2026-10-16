import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const label = process.argv[2] ?? 'current';
if (['--reference','--trees-only','--compare'].some(flag => process.argv.includes(flag))) {
  throw Error('Old stacked-canopy reference modes have been retired. Use --validate-only for current authored LOD parity.');
}
const validateOnly = process.argv.includes('--validate-only');
const output = `artifacts/solo-vegetation/${label}`;
mkdirSync(output, { recursive: true });
const referencePaths = [
  'src/vegetation/seedthree/seedThreeForestBuilder.ts',
  'src/vegetation/seedthree/seedThreeForestLod.ts',
  'src/grass/GrassBladeField.ts',
  'src/props/ForestFloorIvy.ts',
  'src/props/ForestFloorNettles.ts',
  'src/scene/InstanceDrawCompaction.ts',
  'src/scene/InstanceAttributeGather.ts',
  'src/grass/wildflowerPrefixWrites.ts',
  'src/scene/GroupedInstanceDraws.ts',
  'src/scene/SceneManager.ts',
  'src/props/ForestManager.ts',
  'src/props/ForestUndergrowth.ts',
];
const sourceDirectory = `${output}/sources`;
mkdirSync(sourceDirectory, { recursive: true });
for (const path of referencePaths) writeFileSync(`${sourceDirectory}/${path.split('/').at(-1)}`, readFileSync(path));
const server = await createServer({
  cacheDir: 'artifacts/solo-vegetation/vite-cache',
  server: { host: '127.0.0.1', port: 5192, strictPort: true, hmr: false },
  plugins: [{ name: 'solo-vegetation-benchmark', enforce: 'pre', transform(code, id) {
    const path = id.replaceAll('\\', '/').split('?')[0];
    if (path.endsWith('/src/main.ts')) return code.replace('const app = new App(root);', 'const app = new App(root); window.__vegetationApp = app;');
    const original = referencePaths.find(candidate => path.endsWith(`/${candidate}`));
    if (original) {
      let frozen = readFileSync(`${sourceDirectory}/${original.split('/').at(-1)}`, 'utf8');
      if (/src\/scene\/(GroupedInstanceDraws|InstanceDrawCompaction)\.ts$/.test(original)) {
        frozen = frozen.replace('source.add(this.draw);', 'source.add(this.draw); (window.__vegetationCompactions ??= []).push(this);');
      }
      return frozen;
    }
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
  console.log(`Starting ${label}`);
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
  const results = [];
  // Repeat fixed-duration paths, so a faster run does not travel further.
  for (let repeat = 0; repeat < (validateOnly ? 0 : 2); repeat++) for (const scenario of ['close-still', 'close-moving', 'rts-moving']) {
    const variant = 'current';
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
    await page.waitForTimeout(9000);
    await page.evaluate(async () => { await window.__vegetationApp.startDevelopmentProfile(); });
    await page.waitForTimeout(8000);
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
    const name=`${scenario}-${repeat}`;
    writeFileSync(`${output}/${name}.json`, JSON.stringify(data, null, 2));
    await page.screenshot({ path: `${output}/${name}.png` });
    console.log(JSON.stringify({ scenario, repeat, variant, ...data.profile.gameplay }));
  }
  writeFileSync(`${output}/results.json`, JSON.stringify({ label, seed: 1297755661, viewport: [1707,825], results, errors }, null, 2));
  if (validateOnly || process.argv.includes('--validate')) {
    const parity = await page.evaluate(async () => {
      const app = window.__vegetationApp, scene = app.sceneManager;
      window.__vegetationVariant='final';
      const { setRendererAnimationLoop,resetWebGPUCanvasTarget } = await import('/src/scene/RendererBackend.ts');
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { unculledInstanceReference } = await import('/scripts/fixtures/unculledInstanceReference.ts');
      setRendererAnimationLoop(scene.renderer, null);
      scene.resize({width:512,height:288});
      scene.worldAnimationElapsedSeconds = 12.5;
      const presentation = {sky:scene.sky.visible,precipitation:scene.precipitation.group.visible,water:scene.riverSystem.group.visible};
      scene.sky.visible = false; scene.precipitation.group.visible = false;
      scene.riverSystem.group.visible = false;
      const target = new THREE.RenderTarget(512, 288);
      const finalTarget = new THREE.RenderTarget(512,288,{depthBuffer:false});
      scene.camera.aspect = 512 / 288; scene.camera.updateProjectionMatrix();
      let pairs = [];
      const poses = [], images = [];
      const png = pixels => {
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 288;
        canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),512,288),0,0);
        return canvas.toDataURL('image/png').split(',')[1];
      };
      for (const [x, z, yaw, pitch, distance] of [[235,390,.45,.14,8.8], [245,390,2,.3,22], [235,390,1,1.1,240], [570,0,.45,.14,8.8]]) {
        app.cameraController.applyShowcaseView(x,z,yaw,pitch,distance);
        scene.grassField.primeAndFreezeStream(scene.camera.position, scene.cameraTarget, distance, false);
        scene.render(0,distance,false,false,false,false,true);
        for(let step=0;scene.grassField.group.userData.lodFadeVisible&&!scene.grassField.isStreamSettled();step++) {
          if(step>=2000)throw Error('Close vegetation must finish streaming before visual comparison');
          scene.render(0,distance,false,false,false,false,true);
          if(step%32===0)await new Promise(resolve=>setTimeout(resolve,0));
        }
        const stream=scene.grassField.getStreamTelemetry();
        scene.render(0, distance);
        const helpers = window.__vegetationCompactions.filter(helper => !helper.disposed);
        const gpuGround = helpers.filter(helper=>helper.gather);
        if(!gpuGround.length)throw Error('The shared ground-plant GPU path was not exercised');
        // Expose each resident source once before measuring camera-only work.
        // A previously hidden plant category legitimately needs its first upload.
        for(const helper of gpuGround) {helper.prepare(null);helper.prepare(scene.camera);}
        const uploaded = () => gpuGround.reduce((sum,h)=>({source:sum.source+h.gather.stats.sourceUploadBytes,
          selection:sum.selection+h.gather.stats.selectionUploadBytes}),{source:0,selection:0});
        const beforeCamera = uploaded(), probe = scene.camera.clone();
        const direction = new THREE.Vector3(); scene.camera.getWorldDirection(direction);
        direction.applyAxisAngle(new THREE.Vector3(0,1,0),.2);
        probe.lookAt(probe.position.clone().add(direction.multiplyScalar(100)));probe.updateMatrixWorld(true);
        for(const helper of gpuGround) {helper.prepare(probe);helper.prepare(scene.camera);}
        const afterCamera = uploaded();
        const cameraOnlyUploads = {canonicalBytes:afterCamera.source-beforeCamera.source,selectionBytes:afterCamera.selection-beforeCamera.selection};
        if(cameraOnlyUploads.canonicalBytes)throw Error('Camera movement reuploaded canonical ground-plant data');
        const visibleGpuGroundDraws = gpuGround.filter(helper=>{
          if(!helper.draw.count)return false;
          for(let object=helper.draw;object;object=object.parent)if(!object.visible)return false;
          return true;
        }).length;
        const grassDraws = gpuGround.filter(helper=>/^SeedThree grass (meadow|clump)$/.test(helper.source.name));
        const grass = grassDraws.map(helper=>({name:helper.source.name,visible:helper.source.visible,
          canonicalSlots:helper.source.count,submitted:helper.source.visible?helper.draw.count:0}));
        pairs = helpers.map(unculledInstanceReference);
        const owners = new Map(), lodTrees = [new Set(),new Set(),new Set()];
        let edgeNearTrees = 0;
        for (const helper of helpers) {
          const source = helper.source, lod = source.userData.seedThreeLod;
          const origin = source.geometry.getAttribute('aTreeOrigin');
          if (lod === undefined || source.userData.seedThreeShadowOnly || !origin) continue;
          const groups = helper.selected ? Array.from(helper.selected.array.slice(0,helper.draw.count/helper.groupSize))
            : helper.copyRanges.flatMap((_,i,a)=>i%3 ? [] : Array.from({length:a[i+2]},(_,j)=>Math.floor((a[i]+j)/helper.groupSize)));
          for (const group of new Set(groups)) {
            const row = group * helper.groupSize;
            const key = `${origin.getX(row)},${origin.getY(row)},${origin.getZ(row)}`;
            if (owners.has(key) && owners.get(key)!==lod) throw Error('Solo stacked two tree color LODs');
            owners.set(key,lod); lodTrees[lod].add(key);
            if (lod===0 && Math.max(Math.abs(origin.getX(row)),Math.abs(origin.getZ(row))) >= scene.terrain.generationSize*.44) edgeNearTrees++;
          }
        }
        const select = full => {
          for (const {source,draw,reference} of pairs) {
            const raw = typeof full === 'function' ? full(source) : full;
            reference.visible = raw; draw.visible = !raw;
          }
        };
        const capture = async full => {
          select(full);
          scene.renderer._nodes.nodeFrame.update(); scene.renderer.setRenderTarget(target);
          scene.renderer.render(scene.scene, scene.camera);
          const pixels = new Uint8Array(await scene.renderer.readRenderTargetPixelsAsync(target,0,0,512,288));
          scene.renderer.setRenderTarget(null); return pixels;
        };
        // Teleporting and freezing the ground stream changes native instance
        // attributes. Settle both render contexts before comparing, and verify
        // the optimized image stays unchanged through the round trip.
        await capture(false); await capture(false);
        const actual = await capture(false);
        await capture(true);
        const full = await capture(true), recovered = await capture(false);
        let stabilityChannelsOver2 = 0;
        for(let i=0;i<actual.length;i++)if(Math.abs(actual[i]-recovered[i])>2)stabilityChannelsOver2++;
        let changed = 0, max = 0;
        for (let i=0;i<actual.length;i++) { const delta=Math.abs(actual[i]-full[i]);max=Math.max(max,delta);if(delta>2)changed++; }
        const differences = new Uint8Array(actual.length);
        for(let i=0;i<actual.length;i+=4) {
          const delta = Math.max(...[0,1,2].map(c=>Math.abs(actual[i+c]-full[i+c])));
          differences[i] = delta > 2 ? 255 : 0; differences[i+3]=255;
        }
        const imageLabel = `${x}-${z}-${distance}`;
        images.push({ name:`${imageLabel}-optimized`,png:png(actual) }, { name:`${imageLabel}-reference`,png:png(full) },
          { name:`${imageLabel}-difference`,png:png(differences) });
        const isolated = [];
        if(changed) for(const [name,pattern] of [ ['trees',/cards|branches/], ['grass',/^SeedThree grass (meadow|clump)$/], ['flowers',/^SeedThree streamed /],
          ['ivy',/rooted instanced forest-floor ivy/],['nettles',/stinging nettle prototype/],['shrubs',/real (dogwood|bush|fern|juniper) prototype/] ]) {
          const pixels = await capture(source=>pattern.test(source.name));
          let changed=0,max=0;
          for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-pixels[i]);max=Math.max(max,delta);if(delta>2)changed++;}
          isolated.push({name,channelsOver2:changed,maxDelta:max});
          if(changed) isolated.at(-1).attributes = helpers.filter(h=>pattern.test(h.source.name)).map(h=>({
            name:h.source.name, attributes:Object.fromEntries(Object.entries(h.source.geometry.attributes)
              .map(([key,attribute])=>[key,{type:attribute.array.constructor.name,normalized:attribute.normalized,itemSize:attribute.itemSize}]))
          }));
          if(changed)images.push({name:`${distance}-${name}-reference`,png:png(pixels)});
        }
        // Exercise the production HDR, AO, bloom and grading path too. Inputs
        // remain frozen; this comparison includes the normal sky/water layers.
        scene.sky.visible=presentation.sky; scene.precipitation.group.visible=presentation.precipitation;
        scene.riverSystem.group.visible=presentation.water;
        const captureFinal = async full => {
          select(full);
          scene.renderer._nodes.nodeFrame.update();resetWebGPUCanvasTarget(scene.renderer);
          // Keep the production pipeline and redirect only its final output.
          // A swap-chain canvas read after presentation can return blank pixels.
          scene.renderer.setOutputRenderTarget(finalTarget);
          scene.postProcessor.pipeline.render();scene.renderer.setOutputRenderTarget(null);
          return new Uint8Array(await scene.renderer.readRenderTargetPixelsAsync(finalTarget,0,0,512,288));
        };
        await captureFinal(false);await captureFinal(false);
        const finalActual=await captureFinal(false);
        await captureFinal(true);
        const finalReference=await captureFinal(true),finalRecovered=await captureFinal(false);
        let finalChannelsOver2=0,finalMaxDelta=0,finalStabilityChannelsOver2=0,finalColoredPixels=0;
        for(let i=0;i<finalActual.length;i++) {
          const delta=Math.abs(finalActual[i]-finalReference[i]);finalMaxDelta=Math.max(finalMaxDelta,delta);
          if(delta>2)finalChannelsOver2++;
          if(Math.abs(finalActual[i]-finalRecovered[i])>2)finalStabilityChannelsOver2++;
        }
        for(let i=0;i<finalActual.length;i+=4)if(Math.max(finalActual[i],finalActual[i+1],finalActual[i+2])>8)finalColoredPixels++;
        if(finalColoredPixels<1024)throw Error('Final pipeline capture is empty');
        images.push({name:`${imageLabel}-final-optimized`,png:png(finalActual)},{name:`${imageLabel}-final-reference`,png:png(finalReference)});
        scene.sky.visible=false;scene.precipitation.group.visible=false;scene.riverSystem.group.visible=false;
        poses.push({x,z,distance,gpuGroundDraws:visibleGpuGroundDraws,grass,cameraOnlyUploads,lodTrees:lodTrees.map(set=>set.size),edgeNearTrees,channelsOver2:changed,maxDelta:max,stabilityChannelsOver2,isolated,
          stream:{mode:stream.mode,pendingSlots:stream.pendingSlots,liveInstances:stream.liveInstances,wildflowerLiveInstances:stream.wildflowerLiveInstances},
          finalPipeline:{channelsOver2:finalChannelsOver2,maxDelta:finalMaxDelta,stabilityChannelsOver2:finalStabilityChannelsOver2,coloredPixels:finalColoredPixels}});
        for (const pair of pairs) { pair.draw.visible=true; pair.dispose(); }
      }
      target.dispose();finalTarget.dispose();
      return { seed:1297755661,viewport:[512,288],worldTimeSeconds:12.5,sourceDraws:pairs.length,poses,images };
    });
    for(const {name,png} of parity.images)writeFileSync(`${output}/${name}.png`,Buffer.from(png,'base64'));
    delete parity.images;
    writeFileSync(`${output}/image-parity.json`, JSON.stringify(parity,null,2));
    console.log('Live solo image parity', JSON.stringify(parity));
    assert.ok(parity.poses.every(pose => pose.channelsOver2 === 0 && pose.stabilityChannelsOver2 === 0
      && pose.finalPipeline.channelsOver2 === 0 && pose.finalPipeline.stabilityChannelsOver2 === 0), JSON.stringify(parity));
    assert.ok(parity.poses.some(pose => pose.edgeNearTrees > 0), 'Playable edge trees must upgrade to normal nearby detail');
    assert.ok(parity.poses.some(pose => pose.grass.some(draw=>draw.submitted>100)), 'Compare actual grass in the full game');
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(`${output}/errors.json`, JSON.stringify(errors, null, 2));
  await browser?.close();
  await server.close();
}
