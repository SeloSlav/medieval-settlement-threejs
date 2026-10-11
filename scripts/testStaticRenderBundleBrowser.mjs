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
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/bundle-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('bundle-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE, TSL } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { StaticRenderBundle } = await import('/src/scene/StaticRenderBundle.ts');
    const { StorageInstancedBufferAttribute } = THREE;
    const { renderer } = await createPreferredRenderer();
    renderer.setSize(400, 280);
    renderer.shadowMap.enabled = true;
    renderer.info.autoReset = false;
    const roots = [new StaticRenderBundle(), new THREE.Group()];
    const scenes = roots.map(root => { const scene = new THREE.Scene(); scene.add(root); return scene; });
    const wind = TSL.uniform(0);
    const material = new THREE.MeshStandardNodeMaterial({ color: 0x479333, roughness: .85, side: THREE.DoubleSide });
    material.positionNode = TSL.positionLocal.add(TSL.vec3(wind.mul(TSL.positionLocal.y), 0, 0));
    const alternate = new THREE.MeshStandardNodeMaterial({ color: 0xb39655, roughness: .8 });
    const geometry = new THREE.ConeGeometry(.65, 2, 6);
    const meshPairs = [];
    const matrix = new THREE.Matrix4();
    for (let bucket = 0; bucket < 12; bucket++) {
      const pair = roots.map(root => {
        const mesh = new THREE.InstancedMesh(geometry, material, 16);
        mesh.instanceMatrix = new StorageInstancedBufferAttribute(16, 16);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        for (let slot = 0; slot < 16; slot++) {
          matrix.makeTranslation((bucket % 4 - 1.5) * 7 + slot % 4 * 1.3,
            1, (Math.floor(bucket / 4) - 1) * 7 + Math.floor(slot / 4) * 1.3);
          mesh.setMatrixAt(slot, matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        root.add(mesh);
        return mesh;
      });
      meshPairs.push(pair);
    }
    for (const scene of scenes) {
      scene.background = new THREE.Color(0x222831);
      scene.fog = new THREE.FogExp2(0x777788, .01);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardNodeMaterial({ color: 0x887c67 }));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
      scene.add(ground, new THREE.AmbientLight(0xffffff, .6));
      const sun = new THREE.DirectionalLight(0xffffff, 2);
      sun.position.set(15, 30, 10); sun.castShadow = true;
      sun.shadow.mapSize.set(512, 512);
      Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: .1, far: 100 });
      sun.shadow.camera.updateProjectionMatrix(); scene.add(sun);
    }
    const camera = new THREE.PerspectiveCamera(48, 400 / 280, .1, 160);
    camera.position.set(23, 21, 32); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const target = new THREE.RenderTarget(400, 280);
    const backend = renderer.backend;
    const originalBegin = backend.beginBundle;
    let recordings = 0;
    backend.beginBundle = function(...args) { recordings++; return originalBegin.apply(this, args); };
    const render = async scene => {
      renderer.info.reset(); renderer.setRenderTarget(target); renderer.render(scene, camera);
      const calls = renderer.info.render.drawCalls;
      return { calls, pixels: await renderer.readRenderTargetPixelsAsync(target, 0, 0, 400, 280) };
    };
    const frames = [];
    for (let frame = 0; frame < 14; frame++) {
      // Frames 1-3 reuse commands while the exact deformation uniform changes.
      wind.value = Math.sin(frame * .7) * .3;
      if (frame === 4) for (const mesh of meshPairs[0]) mesh.count = 3;
      if (frame === 5) for (const mesh of meshPairs[0]) mesh.count = 16;
      if (frame === 6) for (const mesh of meshPairs[1]) {
        matrix.makeTranslation(2, 5, 1); mesh.setMatrixAt(2, matrix); mesh.instanceMatrix.needsUpdate = true;
      }
      if (frame === 7) for (const mesh of meshPairs[2]) mesh.visible = false;
      if (frame === 8) for (const mesh of meshPairs[2]) mesh.visible = true;
      if (frame === 9) for (const mesh of meshPairs[3]) mesh.material = alternate;
      if (frame === 10) {
        roots[0].position.set(1, 0, -2); roots[1].position.copy(roots[0].position);
        camera.position.set(-24, 19, 28); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      }
      if (frame === 11) for (const mesh of meshPairs[4]) mesh.castShadow = false;
      if (frame === 12) for (const mesh of meshPairs[5]) mesh.count = 0;
      if (frame === 13) for (const mesh of meshPairs[5]) mesh.count = 16;
      const before = recordings;
      const actual = await render(scenes[0]), reference = await render(scenes[1]);
      let changedPixels = 0, maxDifference = 0;
      for (let index = 0; index < actual.pixels.length; index += 4) {
        const difference = Math.abs(actual.pixels[index] - reference.pixels[index])
          + Math.abs(actual.pixels[index + 1] - reference.pixels[index + 1])
          + Math.abs(actual.pixels[index + 2] - reference.pixels[index + 2]);
        maxDifference = Math.max(maxDifference, difference);
        if (difference > 6) changedPixels++;
      }
      frames.push({ frame, changedPixels, maxDifference, recordings: recordings - before,
        actualDraws: actual.calls, referenceDraws: reference.calls });
    }
    backend.beginBundle = originalBegin;
    target.dispose(); geometry.dispose(); material.dispose(); alternate.dispose(); renderer.dispose();
    return frames;
  });
  mkdirSync('artifacts/city-performance', { recursive: true });
  writeFileSync('artifacts/city-performance/static-render-bundle-parity.json', JSON.stringify({ result, errors }, null, 2));
  console.log(JSON.stringify({ result, errors }));
  assert.deepEqual(errors, []);
  for (const frame of result) {
    assert.ok(frame.changedPixels <= 10, `Frame ${frame.frame}: cached draws changed the rendered image`);
    assert.equal(frame.actualDraws, frame.referenceDraws, `Frame ${frame.frame}: cached draw telemetry`);
  }
  assert.ok(result[0].recordings > 0);
  assert.ok(result.slice(1, 4).every(frame => frame.recordings === 0), 'Changing wind must reuse draw commands');
  assert.equal(result[6].recordings, 0, 'Storage matrix edits reuse command handles');
} finally {
  await browser?.close(); await server.close();
}
