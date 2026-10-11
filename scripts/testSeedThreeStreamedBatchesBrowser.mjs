import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/seedthree-batch-probe?*', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('seedthree-batch-probe?mode=multiplayer', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { StreamedInstanceBatches } = await import('/src/scene/StreamedInstanceBatches.ts');
    const { createSeedThreeForest, createSeedThreeForestController } = await import('/src/vegetation/seedthree/seedThreeForestBuilder.ts');
    const { setWorldAnimationTime } = await import('/src/scene/worldAnimationTime.ts');
    const { windStrength } = await import('/vendor/seedthree/src/core/wind.js');
    const { TREE_SHADOW_CAST_LAYER } = await import('/src/scene/SceneLayers.ts');
    const { renderer, kind, adapterEvidence } = await createPreferredRenderer();
    renderer.setSize(400, 280); renderer.shadowMap.enabled = true; renderer.info.autoReset = false;
    const batches = new StreamedInstanceBatches();
    const scenes = [new THREE.Scene(), new THREE.Scene()];
    scenes[0].add(batches.root);
    const terrain = { generationSize: 12288, getHeightAt: () => 0 };
    const species = ['beech', 'sessileOak', 'sycamoreMaple', 'ash', 'silverFir', 'norwaySpruce', 'scotsPine', 'larch'];
    const placements = Array.from({ length: 4 }, (_, chunk) => Array.from({ length: 32 }, (_, i) => ({
      x: ((chunk === 3 ? 1 : chunk) - 1) * 54 + (i % 4 - 1.5) * 8,
      z: (Math.floor(i / 4) - 3.5) * 8 + (chunk === 3 ? 60 : 0),
      species: species[i % species.length], form: 'broad', scale: .8 + (i % 4) * .06,
    })));
    const chunks = [];
    const build = async chunk => {
      const pair = [];
      for (let side = 0; side < 2; side++) {
        const forest = await createSeedThreeForest(placements[chunk], terrain, 4, 4193, renderer);
        const controller = createSeedThreeForestController(forest);
        scenes[side].add(forest.group);
        pair.push({ forest, controller });
      }
      batches.add(pair[0].forest.group);
      return pair;
    };
    for (let chunk = 0; chunk < 3; chunk++) chunks.push(await build(chunk));
    for (const scene of scenes) {
      scene.background = new THREE.Color(.13, .17, .21); scene.fog = new THREE.FogExp2(0x8c9eab, .002);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardNodeMaterial({ color: 0x7c8063, roughness: .95 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -.2; ground.receiveShadow = true;
      const sun = new THREE.DirectionalLight(0xffe5c4, 2.5); sun.position.set(70, 120, 40); sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.layers.enable(TREE_SHADOW_CAST_LAYER);
      Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: .1, far: 300 });
      sun.shadow.camera.updateProjectionMatrix();
      scene.add(ground, sun, new THREE.AmbientLight(0xbecedf, .8));
    }
    const camera = new THREE.PerspectiveCamera(48, 400 / 280, .1, 2000);
    const target = new THREE.RenderTarget(400, 280), frames = [];
    const render = async scene => {
      renderer.info.reset(); renderer.setRenderTarget(target); renderer.render(scene, camera);
      return { draws: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles,
        pixels: await renderer.readRenderTargetPixelsAsync(target, 0, 0, 400, 280) };
    };
    const each = fn => { for (const pair of chunks) if (pair) for (const { controller } of pair) fn(controller); };
    for (let frame = 0; frame < 21; frame++) {
      setWorldAnimationTime(frame * .8); windStrength.value = frame === 1 ? 0 : .9;
      let distance = 185, firstPerson = false;
      camera.position.set(115, 90, 120); camera.lookAt(0, 14, 0);
      if (frame === 3) each(c => c.setDeciduousFoliage({ springFlush: 1, autumnColor: 0, dormancy: 0 }));
      if (frame === 4) each(c => c.setDeciduousFoliage({ springFlush: 0, autumnColor: .9, dormancy: .1 }));
      if (frame === 5) each(c => c.setSnowCoverage(.7));
      if (frame === 6) for (const { controller } of chunks[0]) controller.hideTree(3);
      if (frame === 7) for (const { controller } of chunks[0]) controller.showTree(3);
      if (frame === 8) for (const { controller } of chunks[1]) controller.setTreeTransform(7, new THREE.Matrix4().makeRotationZ(.8));
      if (frame === 9) { distance = 32; firstPerson = true; camera.position.set(0, 12, 38); camera.lookAt(0, 17, 0); }
      if (frame === 10) { distance = 580; camera.position.set(240, 350, 370); camera.lookAt(0, 0, 0); }
      if (frame === 11) each(c => c.setDistantCanopyCardsEnabled(false));
      if (frame === 12) each(c => c.setDistantCanopyCardsEnabled(true));
      if (frame === 13) {
        batches.remove(chunks[2][0].forest.group);
        for (const { forest, controller } of chunks[2]) { forest.group.removeFromParent(); controller.dispose(); }
        chunks[2] = null;
      }
      if (frame === 14) {
        chunks[2] = await build(2);
        for (const { controller } of chunks[2]) {
          controller.setDeciduousFoliage({ springFlush: 0, autumnColor: .9, dormancy: .1 }); controller.setSnowCoverage(.7);
        }
      }
      if (frame === 15) each(c => c.setShadows(false));
      if (frame === 16) each(c => c.setShadows(true));
      if (frame === 17) each(c => c.setDeciduousFoliage({ springFlush: 0, autumnColor: 1, dormancy: 1 }));
      if (frame === 18) each(c => { c.setSnowCoverage(0); c.setDeciduousFoliage({ springFlush: 0, autumnColor: 0, dormancy: 0 }); });
      if (frame === 19) chunks.push(await build(3));
      if (frame === 20) {
        batches.remove(chunks[3][0].forest.group);
        for (const { forest, controller } of chunks[3]) { forest.group.removeFromParent(); controller.dispose(); }
        chunks[3] = null;
      }
      camera.updateMatrixWorld(true); scenes.forEach(s => s.updateMatrixWorld(true));
      each(c => { c.commit(); c.updateCamera(camera, distance, firstPerson, { minX: -110, maxX: 110, minZ: -100, maxZ: 100 }, false, 1 / 60); });
      const before = batches.stats().uploads;
      const state = batches.prepare();
      const actual = await render(scenes[0]), reference = await render(scenes[1]);
      let changedPixels = 0, maxDifference = 0, totalDifference = 0;
      for (let i = 0; i < actual.pixels.length; i += 4) {
        const difference = Math.abs(actual.pixels[i] - reference.pixels[i]) + Math.abs(actual.pixels[i + 1] - reference.pixels[i + 1]) + Math.abs(actual.pixels[i + 2] - reference.pixels[i + 2]);
        totalDifference += difference; maxDifference = Math.max(maxDifference, difference); if (difference > 6) changedPixels++;
      }
      frames.push({ frame, changedPixels, maxDifference, totalDifference, actualDraws: actual.draws, referenceDraws: reference.draws,
        actualTriangles: actual.triangles, referenceTriangles: reference.triangles, uploads: batches.stats().uploads - before,
        state, color: batches.stats(), shadow: batches.stats(true) });
    }
    batches.dispose(); each(c => c.dispose()); target.dispose(); renderer.dispose();
    return { backend: kind, adapterEvidence, species, trees: placements.flat().length, frames };
  });
  mkdirSync('artifacts/city-performance', { recursive: true });
  writeFileSync('artifacts/city-performance/seedthree-streamed-batch-parity.json', JSON.stringify({ result, errors }, null, 2));
  console.log(JSON.stringify({ result, errors }));
  assert.deepEqual(errors, []);
  for (const frame of result.frames) {
    assert(frame.changedPixels <= 10, `Frame ${frame.frame}: combined authored trees changed pixels`);
    assert.equal(frame.actualTriangles, frame.referenceTriangles, `Frame ${frame.frame}: exact authored tree workload`);
    assert(frame.actualDraws < frame.referenceDraws, `Frame ${frame.frame}: authored chunk draws were not combined`);
  }
  assert(result.frames.slice(1, 6).every(f => f.uploads === 0), 'Wind, seasons and snow must reuse authored instance buffers');
  assert(result.frames[0].color.sourceDraws > result.frames[0].color.draws);
  assert(result.frames[0].shadow.sourceDraws > result.frames[0].shadow.draws);
  assert(result.frames[19].shadow.capacityInstances > result.frames[18].shadow.capacityInstances,
    'Loading another authored chunk must exercise growth of a shared GPU allocation');
} finally { await browser?.close(); await server.close(); }
