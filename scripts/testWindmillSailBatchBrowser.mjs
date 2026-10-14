import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'artifacts/city-performance/windmill-sail-batch';
mkdirSync(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen(); let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
  await page.route('**/windmill-sail-batch', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('windmill-sail-batch', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { createWindmillMesh } = await import('/src/buildings/meshes/expandedBuildingMeshes.ts');
    const { batchWindmillSails } = await import('/src/buildings/windmillSailBatch.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { renderer } = await createPreferredRenderer(); renderer.setSize(640, 480); renderer.shadowMap.enabled = true;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x334455);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2.5));
    const sun = new THREE.DirectionalLight(0xfff0d4, 4); sun.position.set(10, 14, 8); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(32, 32), new THREE.MeshStandardMaterial({ color: 0x5d7550 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const source = createWindmillMesh(), batched = createWindmillMesh();
    for (const root of [source, batched]) root.traverse(object => { if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    const sails = batched.getObjectByName('Windmill sails'); batchWindmillSails(sails);
    scene.add(source, batched);
    const camera = new THREE.PerspectiveCamera(48, 640 / 480, .1, 60), target = new THREE.RenderTarget(640, 480), reports = [];
    const render = async visible => { source.visible = visible; batched.visible = !visible; renderer.setRenderTarget(target); renderer.render(scene, camera); return renderer.readRenderTargetPixelsAsync(target, 0, 0, 640, 480); };
    for (const angle of [0, Math.PI / 3, Math.PI * 2 / 3, Math.PI]) for (const spin of [0.12, 1.13, 2.42]) {
      for (const root of [source, batched]) root.getObjectByName('Windmill sails').rotation.z = spin;
      camera.position.set(Math.sin(angle) * 19, 11, Math.cos(angle) * 19); camera.lookAt(0, 5, 0); camera.updateMatrixWorld(true);
      await render(true); await render(false); const a = await render(true), b = await render(false);
      let changed = 0, maxError = 0;
      for (let i = 0; i < a.length; i += 4) { const error = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); maxError = Math.max(maxError, error); if (error > 12) changed++; }
      reports.push({ angle, spin, changed, maxError });
    }
    target.dispose(); renderer.dispose(); return reports;
  });
  writeFileSync(`${output}/report.json`, JSON.stringify({ viewport: [640, 480], finalAndShadowedViews: true, result, errors }, null, 2));
  console.log(JSON.stringify({ result, errors }));
  assert.deepEqual(errors, []); for (const row of result) assert.ok(row.changed <= 12, `Windmill sail batch changed ${row.changed} pixels`);
} finally { await browser?.close(); await server.close(); }
