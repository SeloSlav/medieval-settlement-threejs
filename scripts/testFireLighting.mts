import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FireLighting, FireLightsNode } from '../src/fires/FireLighting.ts';
import { createFireEffect, disposeFireEffect, setFireEffectActive, updateFireEffect } from '../src/fires/FireEffect.ts';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
camera.updateProjectionMatrix();
camera.position.set(0, 5, 20);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
const sun = new THREE.DirectionalLight();
sun.castShadow = true;
scene.add(sun);
const lighting = new FireLighting();
const node = lighting.getNode(scene) as FireLightsNode;
const sync = () => {
  scene.updateMatrixWorld(true);
  const visible: THREE.Light[] = [];
  scene.traverseVisible(o => { if (o instanceof THREE.Light) visible.push(o); });
  node.setLights(visible);
  node.updateBefore({ camera } as never);
  return `${node.customCacheKey()}/${node.getCacheKey(true)}`;
};
const signature = sync();
assert.ok(node.hasLights, 'zero fires must still compile the shared loop');
assert.equal(node.data.count, 0);
const effect = createFireEffect({ lightDistance: 23, lightIntensity: 22 });
const root = new THREE.Group();
root.position.set(3, 1, -2);
root.rotation.y = 0.3;
root.scale.setScalar(0.74);
root.add(effect.root);
scene.add(root);
assert.equal(sync(), signature, 'first fire cannot change the shader key');
assert.equal(node.data.count, 1);
const position = effect.light.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse);
const values = node.data.attribute.array as Float32Array;
for (const [index, expected] of [...position.toArray(), 23,
  effect.light.color.r * effect.light.intensity, effect.light.color.g * effect.light.intensity,
  effect.light.color.b * effect.light.intensity, effect.light.decay].entries()) {
  assert.ok(Math.abs(values[index]! - expected) < 1e-5, `authored light component ${index} preserved`);
}
setFireEffectActive(effect, false);
assert.equal(sync(), signature);
assert.equal(node.data.count, 0, 'hidden parent must extinguish without stale data');
setFireEffectActive(effect, true);
updateFireEffect(effect, 0.3);
assert.equal(sync(), signature);
assert.equal(node.data.count, 1);
root.visible = false;
assert.equal(sync(), signature);
assert.equal(node.data.count, 0);
root.visible = true;
scene.remove(root);
assert.equal(sync(), signature, 'destroyed camp must not invalidate other materials');
scene.add(root);
assert.equal(sync(), signature);
root.position.set(1000, 0, 0);
sync();
assert.equal(node.data.count, 0, 'entirely offscreen influence can be culled');
root.position.set(20, 0, 0);
sync();
assert.equal(node.data.count, 1, 'offscreen flame whose range reaches the view must remain');
effect.light.distance = 0;
root.position.x = 1000;
sync();
assert.equal(node.data.count, 1, 'unbounded lights must not be culled as zero-radius spheres');
disposeFireEffect(effect);
scene.remove(root);

const initialAttribute = node.data.attribute;
const disposedAttributes: THREE.BufferAttribute[] = [];
node.data.releaseAttribute = attribute => { disposedAttributes.push(attribute); };
for (let i = 0; i < 257; i++) {
  const light = new THREE.PointLight(0xff7430, 1, 23, 1.7);
  light.userData.runtimeFireLight = true;
  light.position.set(i % 3, 1, 0);
  scene.add(light);
}
assert.equal(sync(), signature, 'growth beyond the initial upload capacity cannot change shaders');
assert.equal(node.data.count, 257, 'dense lights must not be silently capped');
assert.equal(node.data.attribute.count, 1024);
assert.ok(disposedAttributes.includes(initialAttribute), 'replaced GPU buffer must be disposed');
const visible = node.getLights();
node.setLights([...visible, ...visible]);
node.updateBefore({ camera } as never);
assert.equal(node.data.count, 257, 'compile target/scene duplicates must not double illumination');
const other = new THREE.Scene();
assert.notEqual(lighting.getNode(other), node, 'nested scenes cannot share upload data');
const beforeNested = node.getLights();
lighting.beginRender(scene);
node.setLights([]);
lighting.finishRender(scene);
assert.equal(node.getLights(), beforeNested, 'nested render restores the source lights');
lighting.dispose();
assert.ok(disposedAttributes.includes(node.data.attribute));
console.log('Shared fire lighting: stable lifecycle keys, exact values, culling, growth, nested scenes, disposal passed.');
