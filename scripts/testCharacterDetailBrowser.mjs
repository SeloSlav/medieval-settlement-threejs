import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const output = 'artifacts/city-performance/character-detail';
mkdirSync(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/detail-probe', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('detail-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const { THREE } = await import('/scripts/fixtures/webgpuTestImports.ts');
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const { clone } = await import('/node_modules/three/examples/jsm/utils/SkeletonUtils.js');
    const { createAuthoredCharacterDetail, selectCharacterDetail } = await import('/src/scene/AuthoredCharacterDetail.ts');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { renderer, adapterEvidence: evidence } = await createPreferredRenderer();
    renderer.setSize(480, 480);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x222222);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 3));
    const sun = new THREE.DirectionalLight(0xffffff, 3); sun.position.set(3, 6, 4); scene.add(sun);
    const target = new THREE.RenderTarget(480, 480);
    const camera = new THREE.OrthographicCamera(-4, 4, 4, -4, .01, 1000);
    const reports = [], captures = [];
    for (const file of ['worker-male-common-01-v002.glb', 'worker-female-common-01-v001.glb', 'cleric-monk-common-01-v001.glb', 'ottoman-raider-common-01-v001.glb']) {
      const asset = await new GLTFLoader().loadAsync(`/assets/models/villagers/${file}`);
      const clips = asset.animations.filter(c => /walk|chop|mine|sit|hurt|flee|attack|relax/i.test(c.name)
        && (!file.includes('female') || !/attack|combat/i.test(c.name))).slice(0, 8);
      const started = performance.now();
      const detail = await createAuthoredCharacterDetail(asset.scene, clips,
        /cleric|raider/.test(file) ? [0.002, 0.002] : undefined);
      const generationMs = performance.now() - started;
      const full = clone(asset.scene), reduced = clone(asset.scene);
      const bounds = new THREE.Box3().setFromObject(full), scale = 2 / (bounds.max.y - bounds.min.y);
      for (const model of [full, reduced]) { model.scale.setScalar(scale); model.position.y = -bounds.min.y * scale; scene.add(model); }
      const mixers = [new THREE.AnimationMixer(full), new THREE.AnimationMixer(reduced)];
      const topology = detail.map(map => [...map].map(([original, geometry]) => ({
        sourceTriangles: original.index.count / 3, triangles: geometry.index.count / 3,
        attributesBorrowed: Object.entries(original.attributes).every(([key, value]) => geometry.getAttribute(key) === value),
        materialGroups: geometry.groups.map(g => g.materialIndex),
      })));
      const row = { file, generationMs, topology, cases: [] };
      for (const height of [96, 36, 12]) {
        const level = selectCharacterDetail(height);
        reduced.traverse(mesh => {
          if (!mesh.isSkinnedMesh) return;
          const original = asset.scene.getObjectByName(mesh.name)?.geometry;
          mesh.geometry = level ? detail[level - 1].get(original) ?? original : original;
        });
        camera.left = camera.bottom = -480 / height; camera.right = camera.top = 480 / height; camera.updateProjectionMatrix();
        for (const clip of clips) for (let view = 0; view < 4; view++) {
          for (const mixer of mixers) { mixer.stopAllAction(); const action = mixer.clipAction(clip).play(); action.time = clip.duration * (.17 + view * .19); mixer.update(0); }
          camera.position.set(Math.sin(view * Math.PI / 2) * 100, 25, Math.cos(view * Math.PI / 2) * 100); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true);
          const pixels = async isFull => { full.visible = isFull; reduced.visible = !isFull; renderer.setRenderTarget(target); renderer.render(scene, camera); return renderer.readRenderTargetPixelsAsync(target, 0, 0, 480, 480); };
          await pixels(true); await pixels(false);
          const a = await pixels(true), b = await pixels(false);
          let changed = 0, occupied = 0, silhouetteChanged = 0, absoluteError = 0;
          const background = [...a.slice(0, 3)];
          for (let i = 0; i < a.length; i += 4) {
            const af = [0, 1, 2].some(k => Math.abs(a[i + k] - background[k]) > 8);
            const bf = [0, 1, 2].some(k => Math.abs(b[i + k] - background[k]) > 8);
            if (af || bf) occupied++;
            const error = [0, 1, 2].reduce((sum, k) => sum + Math.abs(a[i + k] - b[i + k]), 0);
            absoluteError += error; if (error > 30) changed++;
          }
          // A separate unlit white pass measures geometry coverage. Textured
          // shading near the dark background must not masquerade as a hole.
          const replacements = [];
          for (const model of [full, reduced]) model.traverse(mesh => {
            if (!mesh.isMesh) return;
            const original = mesh.material;
            const masks = (Array.isArray(original) ? original : [original]).map(m => new THREE.MeshBasicMaterial({ color: 0xffffff, side: m.side }));
            replacements.push({ mesh, original, masks });
            mesh.material = Array.isArray(original) ? masks : masks[0];
          });
          const maskA = await pixels(true), maskB = await pixels(false);
          let silhouettePixels = 0;
          for (let i = 0; i < maskA.length; i += 4) {
            const af = maskA[i] > 128, bf = maskB[i] > 128;
            if (af || bf) silhouettePixels++;
            if (af !== bf) silhouetteChanged++;
          }
          for (const entry of replacements) { entry.mesh.material = entry.original; for (const mask of entry.masks) mask.dispose(); }
          row.cases.push({ height, level, clip: clip.name, view, occupied, changed, silhouetteChanged, silhouettePixels, meanOccupiedError: absoluteError / Math.max(1, occupied) / 3 });
          if (view === 0 && clip === clips[0]) {
            renderer.setRenderTarget(null);
            full.visible = true; reduced.visible = false; renderer.render(scene, camera); const fullCapture = renderer.domElement.toDataURL();
            full.visible = false; reduced.visible = true; renderer.render(scene, camera); const reducedCapture = renderer.domElement.toDataURL();
            captures.push({ file, height, full: fullCapture, reduced: reducedCapture });
          }
        }
      }
      reports.push(row); full.removeFromParent(); reduced.removeFromParent();
    }
    target.dispose(); renderer.dispose(); return { reports, captures, evidence };
  });
  for (const capture of result.captures) for (const kind of ['full', 'reduced']) writeFileSync(`${output}/${capture.file}-${capture.height}-${kind}.png`, Buffer.from(capture[kind].split(',')[1], 'base64'));
  delete result.captures;
  writeFileSync(`${output}/report.json`, JSON.stringify({
    manifest: { viewport: [480, 480], dpr: 1, postEffects: false, camera: 'orthographic, four fixed cardinal views; y=25, radius=100; lookAt(0,1,0)',
      projectedHeights: [96, 36, 12], animationPhases: [.17, .36, .55, .74],
      invariants: ['Original topology and exact pixels in close views', 'Original vertex attributes, materials and authored skeletons at every detail', 'No female combat cases'],
      allowedDivergences: ['Reduced distant topology, <=8% silhouette coverage change with a two-pixel raster allowance', 'Mean occupied RGB-channel error <=8/255'],
    }, ...result, errors }, null, 2));
  console.log(JSON.stringify({ reports: result.reports.map(row => ({ file: row.file, generationMs: row.generationMs, topology: row.topology, cases: row.cases.length, maximumSilhouetteFraction: Math.max(...row.cases.map(c => c.silhouetteChanged / Math.max(1, c.silhouettePixels))), maximumColorError: Math.max(...row.cases.map(c => c.meanOccupiedError)) })), errors }));
  assert.deepEqual(errors, []);
  for (const row of result.reports) {
    for (const level of row.topology) for (const geometry of level) assert.ok(geometry.attributesBorrowed);
    for (const c of row.cases) {
      if (c.level === 0) assert.equal(c.changed, 0, 'Close views retain original topology');
      assert.ok(c.silhouetteChanged <= Math.max(2, c.silhouettePixels * .08), `${row.file} ${c.clip} ${c.height}px silhouette`);
      assert.ok(c.meanOccupiedError <= 8, `${row.file} ${c.clip} ${c.height}px surface`);
    }
  }
} finally { await browser?.close(); await server.close(); }
