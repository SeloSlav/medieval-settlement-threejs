import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'artifacts/city-performance/uniform-dispatch-probe';
mkdirSync(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.route('**/uniform-probe', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('uniform-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE, TSL } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { prepareTypedUniformUpdates } = await import('/scripts/fixtures/typedUniformUpdates.js');
    const { renderer, adapterEvidence } = await createPreferredRenderer();
    renderer.setSize(400, 280); renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x20242a);
    scene.fog = new THREE.FogExp2(0x677584, .002);
    const wind = TSL.uniform(0);
    const geometry = new THREE.BoxGeometry(1.4, 2.6, 1.4);
    const materials = Array.from({ length: 32 }, (_, i) => {
      const material = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color().setHSL(i / 32, .4, .5),
        metalness: (i % 7) / 10, roughness: .25 + (i % 5) / 10 });
      material.positionNode = TSL.positionLocal.add(TSL.vec3(wind.mul(TSL.positionLocal.y), 0, 0));
      return material;
    });
    const meshes = [];
    for (let i = 0; i < 400; i++) {
      const mesh = new THREE.Mesh(geometry, materials[i % materials.length]);
      mesh.position.set((i % 20 - 9.5) * 2.5, 1.3, (Math.floor(i / 20) - 9.5) * 2.5);
      mesh.castShadow = mesh.receiveShadow = true; meshes.push(mesh); scene.add(mesh);
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), materials[3]);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(15, 30, 10); sun.castShadow = true; sun.shadow.mapSize.set(512, 512);
    Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: .1, far: 100 });
    sun.shadow.camera.updateProjectionMatrix(); scene.add(sun, new THREE.HemisphereLight(0x9dabba, 0x594b3d, 1));
    const camera = new THREE.PerspectiveCamera(48, 400 / 280, .1, 200);
    camera.position.set(40, 32, 45); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    const target = new THREE.RenderTarget(400, 280); renderer.setRenderTarget(target);
    const bindings = new Set(), backend = renderer.backend, create = backend.createUniformBuffer;
    backend.createUniformBuffer = function(binding) { bindings.add(binding); return create.call(this, binding); };
    for (let i = 0; i < 20; i++) { renderer.render(scene, camera); await new Promise(requestAnimationFrame); }
    const prepared = [...bindings].map(prepareTypedUniformUpdates).filter(Boolean);
    const pixels = async () => renderer.readRenderTargetPixelsAsync(target, 0, 0, 400, 280);
    const parity = [];
    for (let frame = 0; frame < 8; frame++) {
      wind.value = Math.sin(frame * .6) * .2; sun.intensity = 1.4 + frame * .05;
      scene.fog.density = .002 + frame * .0003; materials[4].roughness = .2 + frame * .06;
      meshes[7].position.y = 1.3 + frame * .1;
      camera.position.x = 40 - frame * 4; camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      prepared.forEach(p => p.disable()); renderer.render(scene, camera); const reference = await pixels();
      prepared.forEach(p => p.enable()); renderer.render(scene, camera); const actual = await pixels();
      let changedPixels = 0, maximumDifference = 0;
      for (let i = 0; i < actual.length; i += 4) {
        const diff = Math.abs(actual[i] - reference[i]) + Math.abs(actual[i+1] - reference[i+1]) + Math.abs(actual[i+2] - reference[i+2]);
        maximumDifference = Math.max(maximumDifference, diff); if (diff > 6) changedPixels++;
      }
      parity.push({ frame, changedPixels, maximumDifference });
    }
    const arms = [];
    for (let cycle = 0; cycle < 4; cycle++) {
      const typed = cycle % 2 === 1; prepared.forEach(p => typed ? p.enable() : p.disable());
      const times = [];
      for (let frame = 0; frame < 100; frame++) {
        await new Promise(requestAnimationFrame); wind.value = Math.sin(frame * .01) * .2;
        const begin = performance.now(); renderer.render(scene, camera);
        if (frame >= 20) times.push(performance.now() - begin);
      }
      times.sort((a,b) => a-b);
      arms.push({ cycle, typed, samples: times.length, meanCpuMs: times.reduce((a,b) => a+b, 0) / times.length,
        medianCpuMs: times[Math.floor(times.length / 2)], p95CpuMs: times[Math.floor(times.length * .95)] });
    }
    backend.createUniformBuffer = create; prepared.forEach(p => p.disable());
    target.dispose(); geometry.dispose(); materials.forEach(m => m.dispose()); renderer.dispose();
    return { adapterEvidence, bindings: prepared.length, uniforms: prepared.reduce((sum,p) => sum+p.count,0), parity, arms };
  });
  writeFileSync(`${output}/report.json`, JSON.stringify({ result, errors }, null, 2));
  console.log(JSON.stringify({ result, errors }));
  assert.deepEqual(errors, []); assert(result.bindings > 100);
  assert(result.parity.every(frame => frame.changedPixels <= 10), 'Native renderer parity failed');
} finally { await browser?.close(); await server.close(); }
