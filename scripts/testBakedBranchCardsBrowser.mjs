import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync,writeFileSync } from 'node:fs';

const server = await createServer({ server: { host: '127.0.0.1',port: 0,hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage(),errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{ if (message.type()==='error') errors.push(message.text()); });
  await page.route('**/baked-card-parity?*',route=>route.fulfill({ contentType: 'text/html',
    body: '<html><body></body></html>' }));
  await page.goto(new URL('baked-card-parity?mode=singleplayer',server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { createSeedThreeForest,createSeedThreeForestController } = await import('/src/vegetation/seedthree/seedThreeForestBuilder.ts');
    const { BAKED_BRANCH_CARD_ASSETS } = await import('/src/vegetation/seedthree/seedThreeBakedBranchCardCatalog.ts');
    const { disposeSeedThreeBranchCardCache,waitForSeedThreeBranchCardPersistence,getSeedThreeBranchCardStartupTimings } =
      await import('/src/vegetation/seedthree/seedThreeBranchCards.ts');
    const { TREE_SHADOW_CAST_LAYER } = await import('/src/scene/SceneLayers.ts');
    const { setWorldAnimationTime } = await import('/src/scene/worldAnimationTime.ts');
    const { windStrength } = await import('/vendor/seedthree/src/core/wind.js');
    const catalog = { ...BAKED_BRANCH_CARD_ASSETS };
    if (Object.keys(catalog).length !== 7) throw Error('Production baked catalog must cover all seven presets');
    for (const key of Object.keys(catalog)) delete BAKED_BRANCH_CARD_ASSETS[key];
    const { renderer,kind,adapterEvidence } = await createPreferredRenderer();
    renderer.setSize(400,280); renderer.shadowMap.enabled = true; renderer.info.autoReset = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(.13,.17,.21); scene.fog = new THREE.FogExp2(0x8c9eab,.002);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300,300),new THREE.MeshStandardNodeMaterial({ color: 0x7c8063,roughness: .95 }));
    ground.rotation.x = -Math.PI/2; ground.position.y = -.2; ground.receiveShadow = true;
    const sun = new THREE.DirectionalLight(0xffe5c4,2.5); sun.position.set(70,120,40); sun.castShadow = true;
    sun.shadow.mapSize.set(1024,1024); sun.shadow.camera.layers.enable(TREE_SHADOW_CAST_LAYER);
    Object.assign(sun.shadow.camera,{ left: -100,right: 100,top: 100,bottom: -100,near: .1,far: 300 });
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(ground,sun,new THREE.AmbientLight(0xbecedf,.8));
    const camera = new THREE.PerspectiveCamera(48,400/280,.1,2000);
    const target = new THREE.RenderTarget(400,280);
    const placements = ['beech','sessileOak','sycamoreMaple','ash','silverFir','norwaySpruce','scotsPine']
      .flatMap((species,index)=>[0,1].map(row=>({ x: (index-3)*16,z: (row-.5)*22,species,form: 'broad',scale: .8+row*.12 })));
    const build = async () => {
      const started = performance.now();
      const forest = await createSeedThreeForest(placements,{ generationSize: 1024,getHeightAt: ()=>0 },4,4193,renderer);
      scene.add(forest.group);
      return { forest,controller: createSeedThreeForestController(forest),ms: performance.now()-started };
    };
    const capture = async pair => {
      const captures = [];
      for (let frame=0; frame<12; frame++) {
        const view = frame%3;
        const distance = [32,185,580][view];
        camera.position.set(...[[20,20,65],[90,85,110],[160,250,330]][view]); camera.lookAt(0,10,0);
        const season = Math.floor(frame/3);
        setWorldAnimationTime(frame*.7); windStrength.value = frame === 0 ? 0 : .8;
        pair.controller.setDeciduousFoliage({ springFlush: season===0 ? 1 : 0,
          autumnColor: season===1 ? .9 : season===3 ? 1 : 0,dormancy: season===3 ? 1 : 0 });
        pair.controller.setSnowCoverage(season===2 || season===3 ? .7 : 0);
        pair.controller.commit(); camera.updateMatrixWorld(true);
        pair.controller.updateCamera(camera,distance,view===0,{ minX: -100,maxX: 100,minZ: -100,maxZ: 100 },false,1/60);
        scene.updateMatrixWorld(true); renderer._nodes.nodeFrame.update();
        sun.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true;
        renderer.info.reset(); renderer.setRenderTarget(target); renderer.render(scene,camera);
        const pixels = new Uint8Array(await renderer.readRenderTargetPixelsAsync(target,0,0,400,280));
        captures.push({ pixels,draws: renderer.info.render.drawCalls,triangles: renderer.info.render.triangles });
      }
      return captures;
    };
    const live = await build(),nativeCaptures = await capture(live);
    await waitForSeedThreeBranchCardPersistence();
    // Bark assets retain live weather uniforms across forest instances. Reset
    // those handles before comparing the next forest's initial summer state.
    live.controller.setSnowCoverage(0);
    live.controller.setDeciduousFoliage({ springFlush: 0,autumnColor: 0,dormancy: 0 });
    live.forest.group.removeFromParent(); live.controller.dispose();
    disposeSeedThreeBranchCardCache();
    const database = await new Promise((resolve,reject)=>{
      const request = indexedDB.open('medieval-road-system-generated-vegetation',1);
      request.onsuccess = ()=>resolve(request.result); request.onerror = ()=>reject(request.error);
    });
    await new Promise((resolve,reject)=>{
      const transaction = database.transaction('branch-cards','readwrite');
      // A browser snapshot must never replace a shipped current asset.
      for (const key of Object.keys(catalog)) transaction.objectStore('branch-cards').put({ key,
        sets: [{ key: '2:fol',foliageOnly: true,noFlutter: false,variants: [] }] });
      transaction.oncomplete = resolve; transaction.onerror = ()=>reject(transaction.error);
    });
    database.close(); Object.assign(BAKED_BRANCH_CARD_ASSETS,catalog);
    const assets = await build(),assetCaptures = await capture(assets);
    const timings = getSeedThreeBranchCardStartupTimings();
    if (timings.length !== 7 || timings.some(t=>t.source!=='asset' || t.persistenceQueued))
      throw Error(`Shipped cards were not used without a cache write: ${JSON.stringify(timings)}`);
    const cases = assetCaptures.map((actual,index)=>{
      const expected = nativeCaptures[index];
      let changed = 0,maxDifference = 0;
      for (let i=0; i<actual.pixels.length; i++) {
        const difference = Math.abs(actual.pixels[i]-expected.pixels[i]);
        if (difference) changed++; maxDifference = Math.max(maxDifference,difference);
      }
      return { frame: index,changedChannels: changed,maxDifference,
        nativeDraws: expected.draws,assetDraws: actual.draws,
        nativeTriangles: expected.triangles,assetTriangles: actual.triangles };
    });
    assets.forest.group.removeFromParent(); assets.controller.dispose();
    disposeSeedThreeBranchCardCache(); target.dispose(); ground.geometry.dispose(); ground.material.dispose(); renderer.dispose();
    return { kind,adapterEvidence,liveBuildMs: live.ms,assetBuildMs: assets.ms,cases,timings };
  });
  mkdirSync('artifacts/vegetation',{ recursive: true });
  writeFileSync('artifacts/vegetation/baked-branch-card-parity.json',JSON.stringify({ ...result,errors },null,2));
  assert.deepEqual(errors,[]);
  assert(result.cases.every(c=>c.changedChannels===0 && c.nativeDraws===c.assetDraws && c.nativeTriangles===c.assetTriangles),
    'shipped atlases must preserve every native pixel and draw');
  console.log('test:baked-branch-cards-browser passed',JSON.stringify({ cases: result.cases.length,
    liveBuildMs: result.liveBuildMs,assetBuildMs: result.assetBuildMs }));
} finally { await browser?.close(); await server.close(); }
