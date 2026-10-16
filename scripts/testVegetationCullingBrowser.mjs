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
    const capture = async reference => {
      for (const c of compactions) {
        c.draw.visible = !reference;
        c.draw.parent.layers.mask = reference ? c.draw.layers.mask : 0;
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
      const actual = await capture(false), reference = await capture(true);
      let changed = 0, max = 0;
      for (let i = 0; i < actual.pixels.length; i++) {
        const difference = Math.abs(actual.pixels[i] - reference.pixels[i]);
        max = Math.max(max, difference); if (difference > 2) changed++;
      }
      frames.push({ frame, maxDelta: max, channelsOver2: changed, culledTriangles: actual.triangles, referenceTriangles: reference.triangles });
    }
    controller.dispose(); renderer.dispose(); target.dispose();
    return { frames };
  });
  writeFileSync(`${output}/validation.json`, JSON.stringify({ ...result, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(result.frames.every(frame => frame.channelsOver2 === 0), JSON.stringify(result.frames));
  assert.ok(result.frames.some(frame => frame.culledTriangles < frame.referenceTriangles));
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await server.close(); }
