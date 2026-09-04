// @ts-nocheck -- Optional exact GPU readback test, not part of the shipped game.
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { FireLighting } from '../fires/FireLighting.ts';

export async function verifyFireLightingPixels(device, record) {
  const reference = new WebGPURenderer({ device, antialias: false });
  const shared = new WebGPURenderer({ device, antialias: false });
  shared.lighting = new FireLighting();
  const targetA = new THREE.RenderTarget(256, 256);
  const targetB = new THREE.RenderTarget(256, 256);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 150);
  const material = new THREE.MeshStandardMaterial({ color: 0xb5b1a2, roughness: 0.6, metalness: 0.1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), material);
  ground.rotation.x = -Math.PI / 2;
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(2, 32, 24), material);
  sphere.position.y = 2;
  scene.add(ground, sphere, new THREE.AmbientLight(0xffffff, 0.03));
  const fires = new THREE.Group();
  scene.add(fires);
  let failures = 0;
  const compare = async (name, aggregate = null) => {
    const renderRead = async (renderer, target) => {
      renderer.setRenderTarget(target);
      await renderer.compileAsync(scene, camera);
      renderer.render(scene, camera);
      return renderer.readRenderTargetPixelsAsync(target, 0, 0, 256, 256);
    };
    if (aggregate) { fires.visible = false; scene.add(aggregate); }
    const a = await renderRead(reference, targetA);
    if (aggregate) { fires.visible = true; aggregate.removeFromParent(); }
    const b = await renderRead(shared, targetB);
    let max = 0, sum = 0, nonblack = 0;
    for (let i = 0; i < a.length; i++) {
      if (i % 4 === 3) continue;
      const delta = Math.abs(a[i] - b[i]);
      max = Math.max(max, delta); sum += delta;
      if (b[i] > 0) nonblack++;
    }
    const mean = sum / (256 * 256 * 3);
    const passed = max <= 2 && mean < 0.03 && nonblack > 0;
    if (!passed) failures++;
    record('fire-pixel-parity', { name, passed, maxByteDifference: max, meanByteDifference: mean,
      uploadedLights: shared.lighting.getNode(scene).data.count,
      camera: camera.matrixWorld.toArray(), projection: camera.projectionMatrix.toArray(),
      target: '256x256 RGBA8, no post, no tone mapping, seed 17' });
  };
  try {
    await reference.init(); await shared.init();
    reference.toneMapping = shared.toneMapping = THREE.NoToneMapping;
    for (const [name, position] of [['near', [0, 5, 8]], ['design', [0, 12, 18]], ['far', [0, 30, 50]]]) {
      camera.position.set(...position); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      await compare(`${name}-zero`);
      const light = new THREE.PointLight(0xff7430, 22, 23, 1.7);
      light.userData.runtimeFireLight = true;
      light.position.set(3, 1.4, 1);
      fires.add(light);
      await compare(`${name}-one`);
      light.intensity = 3.96;
      await compare(`${name}-day`);
      light.position.set(15, 2, 0);
      await compare(`${name}-edge`);
      fires.clear();
    }
    // Coincident lights add linearly: compare 257 uploaded lights to ONE normal
    // light with summed energy, avoiding a huge 257-light reference compilation.
    // Low intensities prevent clipping from hiding dropped contributions.
    camera.position.set(0, 12, 18); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    let totalIntensity = 0;
    for (let i = 0; i < 257; i++) {
      const light = new THREE.PointLight(0xff7430, 0.015 + (i % 7) * 0.003, 23, 1.7);
      light.userData.runtimeFireLight = true;
      totalIntensity += light.intensity;
      light.position.set(3, 1.4, 1);
      fires.add(light);
    }
    const aggregate = new THREE.PointLight(0xff7430, totalIntensity, 23, 1.7);
    aggregate.position.set(3, 1.4, 1);
    await compare('257-overlapping', aggregate);
    fires.clear();
    await compare('zero-after-growth');
    record('fire-pixel-parity-complete', { failures });
    if (failures) throw new Error(`${failures} fire-light pixel comparisons failed`);
  } finally {
    targetA.dispose(); targetB.dispose(); ground.geometry.dispose(); sphere.geometry.dispose(); material.dispose();
    shared.lighting.dispose(); reference.dispose(); shared.dispose();
  }
}
