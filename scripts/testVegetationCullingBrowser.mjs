import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const output = 'artifacts/vegetation-culling';
mkdirSync(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/vegetation-culling-probe?*', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('/vegetation-culling-probe?mode=singleplayer', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { createSeedThreeForest, createSeedThreeForestController } = await import('/src/vegetation/seedthree/seedThreeForestBuilder.ts');
    const { TREE_SHADOW_CAST_LAYER } = await import('/src/scene/SceneLayers.ts');
    const { setWorldAnimationTime } = await import('/src/scene/worldAnimationTime.ts');
    const { windStrength } = await import('/vendor/seedthree/src/core/wind.js');
    const { unculledInstanceReference } = await import('/scripts/fixtures/unculledInstanceReference.ts');
    const { renderer } = await createPreferredRenderer();
    renderer.setSize(400, 280); renderer.shadowMap.enabled = true; renderer.info.autoReset = false;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(.15, .19, .23);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardNodeMaterial({ color: 0x7c8063 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.15; ground.receiveShadow = true;
    const sun = new THREE.DirectionalLight(0xffe5c4, 2.5); sun.position.set(70, 120, 40); sun.castShadow = true;
    sun.shadow.mapSize.set(1024,1024); sun.shadow.camera.layers.enable(TREE_SHADOW_CAST_LAYER);
    Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: .1, far: 350 });
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(ground, sun, new THREE.AmbientLight(0xbecedf, .8));
    const camera = new THREE.PerspectiveCamera(48, 400 / 280, .1, 2000);
    const target = new THREE.RenderTarget(400, 280);
    const placements = ['beech','sessileOak','sycamoreMaple','ash','silverFir','norwaySpruce','scotsPine']
      .flatMap((species, i) => [0, 1, 2, 3].map(row => ({ x: (i - 3) * 22, z: (row - 1.5) * 42,
        species, form: 'broad', scale: .8 + row * .08 })));
    const forest = await createSeedThreeForest(placements, { generationSize: 1240, getHeightAt: () => 0 }, 4, 4193, renderer);
    const controller = createSeedThreeForestController(forest); scene.add(forest.group);
    const compactions = forest.compactedDraws;
    assertCompactedCards();
    function assertCompactedCards() {
      if (!compactions.some(c => c.draw.name.includes('cards'))) throw Error('Solo must cull foliage cards through the shared forest path');
    }
    let references = [];
    const capture = async reference => {
      for (const c of references) {
        c.draw.visible = !reference;
        c.reference.visible = reference;
      }
      renderer._nodes.nodeFrame.update(); sun.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true;
      renderer.info.reset(); renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixels = new Uint8Array(await renderer.readRenderTargetPixelsAsync(target, 0, 0, 400, 280));
      return { pixels, triangles: renderer.info.render.triangles };
    };
    const frames = [];
    for (let frame = 0; frame < 15; frame++) {
      const view = frame % 3;
      camera.position.set(...[[12, 7, 35], [80, 70, 120], [-140, 150, 220]][view]);
      camera.lookAt(frame < 12 ? 0 : -35, 8, 0); camera.updateMatrixWorld(true);
      windStrength.value = frame % 2 ? 2 : 0; setWorldAnimationTime(frame * .73);
      controller.setDeciduousFoliage({ springFlush: frame < 3 ? 1 : 0, autumnColor: frame >= 3 && frame < 6 ? .9 : 0, dormancy: frame >= 9 && frame < 12 ? 1 : 0 });
      controller.setSnowCoverage(frame >= 6 && frame < 9 ? .8 : 0);
      if (frame === 12) controller.hideTree(0);
      if (frame === 13) controller.showTree(0);
      if (frame === 14) controller.setTreeTransform(1, new THREE.Matrix4().makeRotationZ(.9));
      controller.commit(); controller.updateCamera(camera, [12, 185, 580][view], view === 0,
        { minX: -130, maxX: 130, minZ: -130, maxZ: 130 }, true, 1 / 60);
      scene.updateMatrixWorld(true);
      references = compactions.map(unculledInstanceReference);
      // Distinct rungs may contain several authored card draws, but no tree
      // may be submitted by two color rungs in the same frame.
      const owners = new Map(), lodTrees = [new Set(),new Set(),new Set()];
      for (const c of compactions) {
        const lod = c.source.userData.seedThreeLod;
        if (lod === undefined || c.source.userData.seedThreeShadowOnly) continue;
        const bucket = forest.buckets.find(b => [b.nearSet,b.overviewSet,b.farSet][lod].cards.includes(c.source)
          || [b.nearSet,b.overviewSet,b.farSet][lod].branches === c.source);
        const slots = [bucket.nearViewSlotIndices,bucket.overviewViewSlotIndices,bucket.farSlotIndices][lod];
        const rows = c.selected ? Array.from(c.selected.array.slice(0,c.draw.count/c.groupSize))
          : c.copyRanges.flatMap((_,i,a)=>i%3 ? [] : Array.from({length:a[i+2]},(_,j)=>a[i]+j));
        for (const row of rows) {
          const slot = bucket.slots[slots[row]];
          if (!slot.enabled) continue;
          if (owners.has(slot.layoutIndex) && owners.get(slot.layoutIndex)!==lod) throw Error('Stacked color LODs');
          owners.set(slot.layoutIndex,lod); lodTrees[lod].add(slot.layoutIndex);
        }
      }
      const actual = await capture(false), reference = await capture(true);
      let verifiedComponents = 0;
      for (const c of compactions) if (c.draw.userData.gpuInstanceGather) {
        for (const pair of c.pairs) {
          if (pair.input.array !== pair.source.array) throw Error('GPU gather must retain the canonical input array');
          if (pair.input.itemSize !== (pair.name === 'instanceMatrix' ? 16 : 1)) throw Error('GPU input storage stride changed on upload');
          if (pair.output.itemSize !== (pair.source.itemSize === 3 ? 4 : pair.source.itemSize)) throw Error('GPU output storage stride changed on upload');
          if (![0,12,13,14].includes(frame) || !c.draw.count) continue;
          const data = new Uint32Array(await renderer.getArrayBufferAsync(pair.output));
          const canonical = new Uint32Array(pair.source.array.buffer,pair.source.array.byteOffset,pair.source.array.length);
          for (let row=0;row<c.draw.count;row++) {
            const sourceRow = c.selected.array[Math.floor(row/c.groupSize)]*c.groupSize + row%c.groupSize;
            for(let component=0;component<pair.source.itemSize;component++) {
              if(data[row*pair.output.itemSize+component]!==canonical[sourceRow*pair.source.itemSize+component]) {
                throw Error(`GPU gather changed authored ${pair.name}: frame ${frame}, row ${row}, component ${component}`);
              }
              verifiedComponents++;
            }
          }
        }
      }
      let changed = 0, max = 0;
      for (let i = 0; i < actual.pixels.length; i++) {
        const difference = Math.abs(actual.pixels[i] - reference.pixels[i]);
        max = Math.max(max, difference); if (difference > 2) changed++;
      }
      frames.push({ frame, lodTrees:lodTrees.map(set=>set.size), maxDelta: max, channelsOver2: changed, verifiedComponents, culledTriangles: actual.triangles, referenceTriangles: reference.triangles });
      for (const ref of references) { ref.draw.visible=true; ref.dispose(); }
    }
    // Multiple edits while a crown is entirely offscreen must survive the
    // skipped dispatches. Exercise sparse+sparse and full+sparse uploads.
    const gather = compactions.find(c => c.draw.userData.gpuInstanceGather && c.source.count >= c.groupSize*2);
    if(!gather)throw Error('No crown draw for deferred-upload regression');
    // This independent upload test deliberately exposes all canonical groups.
    gather.groupVisible = undefined;
    const away = camera.clone(); away.position.set(10000,20,10000); away.lookAt(20000,20,10000); away.updateMatrixWorld(true);
    let deferredComponents = 0;
    for(const fullFirst of [false,true]) {
      gather.prepare(away);
      if(gather.draw.count)throw Error('Deferred-upload camera must cull every crown');
      for(const row of [0,gather.groupSize]) {
        for(const pair of gather.pairs.filter(pair=>pair.name==='instanceMatrix'||pair.source.itemSize===3)) {
          const offset=row*pair.source.itemSize+(pair.name==='instanceMatrix'?12:0);
          pair.source.array[offset]+=.125;
          pair.source.clearUpdateRanges();
          if(!(fullFirst&&row===0))pair.source.addUpdateRange(offset,1);
          pair.source.needsUpdate=true;
        }
        gather.prepare(away);
      }
      gather.prepare(null);
      for(const pair of gather.pairs) {
        const data=new Uint32Array(await renderer.getArrayBufferAsync(pair.output));
        const canonical=new Uint32Array(pair.source.array.buffer,pair.source.array.byteOffset,pair.source.array.length);
        for(let row=0;row<gather.draw.count;row++) {
          const sourceRow=gather.selected.array[Math.floor(row/gather.groupSize)]*gather.groupSize+row%gather.groupSize;
          for(let component=0;component<pair.source.itemSize;component++) {
            if(data[row*pair.output.itemSize+component]!==canonical[sourceRow*pair.source.itemSize+component])throw Error(`Deferred GPU upload lost ${pair.name} edit`);
            deferredComponents++;
          }
        }
      }
    }
    controller.dispose(); renderer.dispose(); target.dispose();
    return { seed:4193,viewport:[400,280],species:['beech','sessileOak','sycamoreMaple','ash','silverFir','norwaySpruce','scotsPine'],frames,deferredComponents };
  });
  writeFileSync(`${output}/validation.json`, JSON.stringify({ ...result, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(result.frames.every(frame => frame.channelsOver2 === 0), JSON.stringify(result.frames));
  assert.ok(result.frames.some(frame => frame.culledTriangles < frame.referenceTriangles));
  assert.ok(result.frames[0].verifiedComponents > 0, 'Read back the GPU-produced authored attributes');
  assert.ok(result.deferredComponents > 0, 'Verify edits accumulated while crowns are offscreen');
  for(let lod=0;lod<3;lod++)assert.ok(result.frames.some(frame=>frame.lodTrees[lod]>0), `Exercise LOD ${lod}`);
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await server.close(); }
