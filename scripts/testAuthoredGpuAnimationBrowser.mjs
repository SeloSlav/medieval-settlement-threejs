import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/gpu-pose-probe', r => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('gpu-pose-probe', server.resolvedUrls.local[0]).href);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const { clone } = await import('/node_modules/three/examples/jsm/utils/SkeletonUtils.js');
    const { createPreferredRenderer } = await import('/src/scene/RendererBackend.ts');
    const { AuthoredSkinnedInstanceBatch } = await import('/src/scene/AuthoredSkinnedInstanceBatch.ts');
    const backend = await createPreferredRenderer(), renderer = backend.renderer;
    renderer.setSize(640, 480); renderer.setPixelRatio(1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 640/480, .01, 1000);
    camera.position.set(3, 2, 4); camera.lookAt(0, 1, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 3));
    const reports = [];
    for (const path of [
      '/assets/models/villagers/worker-male-common-01-v002.glb',
      '/assets/models/villagers/worker-female-common-01-v001.glb',
      '/assets/models/wild-animals/quaternius-husky.gltf',
    ]) {
      const asset = await new GLTFLoader().loadAsync(path);
      const root = new THREE.Group(); scene.add(root);
      const gpu = new AuthoredSkinnedInstanceBatch({ parent: root, sourceRoot: asset.scene, animations: asset.animations, capacity: 1 });
      const cpu = new AuthoredSkinnedInstanceBatch({ parent: root, sourceRoot: asset.scene, capacity: 1 });
      cpu.group.visible = false;
      const actual = clone(asset.scene), expected = clone(asset.scene);
      for (const model of [actual, expected]) {
        const parent = new THREE.Group(); parent.position.set(4, -2, 7); parent.rotation.y = .37;
        parent.add(model); root.add(parent); parent.visible = false;
        model.scale.set(.012, .011, .013);
      }
      const gm = new THREE.AnimationMixer(actual), cm = new THREE.AnimationMixer(expected);
      let boneName;
      actual.traverse(node => { if(node.isBone && (!boneName || node.name==='PalmR'))boneName=node.name; });
      const toolActual=new THREE.Group(),toolExpected=new THREE.Group();
      for(const [model,tool] of [[actual,toolActual],[expected,toolExpected]]) {
        tool.position.set(.3,.5,-.2);tool.rotation.set(.3,-.1,.7);
        model.getObjectByName(boneName).add(tool);
      }
      gpu.registerAnimationAttachments(actual,toolActual);
      let maxPaletteError = 0, maxWorldVertexError = 0, maxAttachmentError = 0, samples = 0, blendGpuSamples = 0;
      // Female clips are limited to civilian movement/work/hurt; no combat preview.
      const selected = asset.animations.filter(clip => !/female/.test(path) || /walk|idle|standing|work|hurt|run|sit/i.test(clip.name));
      for (const clip of selected) {
        gm.stopAllAction(); cm.stopAllAction();
        const ga = gm.clipAction(clip).setLoop(THREE.LoopOnce, 1); ga.clampWhenFinished = true; ga.play();
        const ca = cm.clipAction(clip).setLoop(THREE.LoopOnce, 1); ca.clampWhenFinished = true; ca.play();
        for (const fraction of [.17, .51, .91]) {
          ga.time = ca.time = clip.duration * fraction;
          gpu.updateAnimation(actual, gm, 0, samples%7!==0); cm.update(0);
          // Grow after first use to exercise output buffer rebinding.
          if (samples === 1) {
            const retired = [gpu.posePalette, gpu.instanceMatrices, gpu.instanceColors];
            gpu.reserve(16); cpu.reserve(16);
            if (retired.some(attribute => renderer._attributes.has(attribute))) throw new Error('Capacity growth retained an owned GPU storage buffer');
          }
          await checkPose();
        }
      }
      const channels = clip => clip.tracks.map(track=>track.name).sort().join('\n');
      const first = selected[0], second = selected.find(clip=>clip!==first&&channels(clip)===channels(first));
      if(!second)throw new Error(`No authored matching-channel crossfade in ${path}`);
      gm.stopAllAction();cm.stopAllAction();
      for(const mixer of [gm,cm]) {
        mixer.clipAction(first).reset().setLoop(THREE.LoopRepeat,Infinity).setEffectiveWeight(1).play().fadeOut(.18);
        mixer.clipAction(second).reset().setLoop(THREE.LoopRepeat,Infinity).setEffectiveWeight(1).play().fadeIn(.18);
      }
      for(let frame=0;frame<36;frame++) {
        gpu.updateAnimation(actual,gm,1/120,frame!==10);cm.update(1/120);
        await checkPose();
        if(gpu.diagnostics().gpuEvaluatedInstances&&frame<20)blendGpuSamples++;
      }
      if(blendGpuSamples<10)throw new Error(`Crossfade stayed on the CPU in ${path}`);
      async function checkPose() {
          gpu.setCount(1); cpu.setCount(1);
          gpu.setFromCloneAt(0, actual); cpu.setFromCloneAt(0, expected);
          for(let i=0;i<16;i++)maxAttachmentError=Math.max(maxAttachmentError,Math.abs(toolActual.matrixWorld.elements[i]-toolExpected.matrixWorld.elements[i]));
          gpu.commit(); cpu.commit();
          renderer.render(scene, camera);
          const values = new Float32Array(await renderer.getArrayBufferAsync(gpu.posePalette));
          const reference = cpu.posePalette.array;
          for (let i = 0; i < gpu.boneCount * 16; i++) maxPaletteError = Math.max(maxPaletteError, Math.abs(values[i] - reference[i]));
          const matrix = new THREE.Matrix4().fromArray(gpu.instanceMatrices.array);
          const bind = gpu.sourceLayers[0].bindMatrix;
          const geometry = gpu.sourceLayers[0].geometry;
          const p = geometry.attributes.position, indices = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
          const value = new THREE.Vector3(), bone = new THREE.Matrix4(), a = new THREE.Vector3(), b = new THREE.Vector3(), vertex = new THREE.Vector3();
          for (let v = 0; v < p.count; v += 13) {
            vertex.fromBufferAttribute(p, v).applyMatrix4(bind); a.set(0,0,0); b.set(0,0,0);
            for (let j = 0; j < 4; j++) {
              const index = indices.getComponent(v,j), weight = weights.getComponent(v,j);
              if (!weight) continue;
              a.addScaledVector(value.copy(vertex).applyMatrix4(bone.fromArray(values, index*16)), weight);
              b.addScaledVector(value.copy(vertex).applyMatrix4(bone.fromArray(reference, index*16)), weight);
            }
            maxWorldVertexError = Math.max(maxWorldVertexError, a.applyMatrix4(matrix).distanceTo(b.applyMatrix4(matrix)));
          }
          samples++;
      }
      reports.push({ path, samples, blendGpuSamples, maxPaletteError, maxWorldVertexError, maxAttachmentError, diagnostics: gpu.diagnostics() });
      const retired = [gpu.posePalette, gpu.instanceMatrices, gpu.instanceColors];
      gpu.dispose(); cpu.dispose(); root.removeFromParent();
      if (retired.some(attribute => renderer._attributes.has(attribute))) throw new Error('Disposal retained an owned GPU storage buffer');
    }
    renderer.dispose();
    return { adapter: backend.adapterEvidence, reports };
  });
  mkdirSync('artifacts/city-performance', { recursive: true });
  writeFileSync('artifacts/city-performance/gpu-animation-parity.json', JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ reports: result.reports.map(({path,samples,blendGpuSamples,maxPaletteError,maxWorldVertexError,maxAttachmentError})=>({path,samples,blendGpuSamples,maxPaletteError,maxWorldVertexError,maxAttachmentError})), errors }));
  assert.deepEqual(errors, []);
  for (const report of result.reports) {
    assert.ok(report.samples >= 3);
    assert.ok(report.maxAttachmentError < .0001, `${report.path}: exact attachment bone observers`);
    assert.ok(report.maxWorldVertexError < .0001, `${report.path}: posed vertices must agree within 0.1 mm`);
  }
} finally { await browser?.close(); await server.close(); }
