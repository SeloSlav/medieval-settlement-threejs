import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beginCloseGroundGpuPrewarm } from '../src/scene/CloseGroundGpuPrewarm.ts';

const scene = new THREE.Scene();
const root = new THREE.Group();
const nested = new THREE.Group();
scene.add(root);
root.add(nested);
root.visible = false;
const material = new THREE.MeshStandardMaterial({ opacity: 0, alphaToCoverage: true });
const geometry = new THREE.PlaneGeometry();
geometry.setAttribute('aAnchorPos', new THREE.InstancedBufferAttribute(new Float32Array(12), 3));
const emptyGrass = new THREE.InstancedMesh(geometry, material, 4);
emptyGrass.count = 0;
emptyGrass.visible = false;
const populatedShrub = new THREE.InstancedMesh(geometry, material, 4);
populatedShrub.count = 3;
populatedShrub.frustumCulled = false;
populatedShrub.castShadow = true;
populatedShrub.layers.set(7);
nested.add(emptyGrass, populatedShrub);
const before = [emptyGrass, populatedShrub].map(mesh => ({
  data: mesh.instanceMatrix.array.slice(), version: mesh.instanceMatrix.version,
  materialVersion: material.version, geometry: mesh.geometry, material: mesh.material,
}));
const warmup = beginCloseGroundGpuPrewarm([root, root, nested]);
assert.equal(warmup.objects.length, 2);
assert.equal(root.visible, true);
for (const mesh of [emptyGrass, populatedShrub]) {
  assert.equal(mesh.visible, true);
  assert.equal(mesh.frustumCulled, false);
  assert.equal(mesh.count, 1, 'upload full backing buffers with only one covered instance');
}
assert.equal(populatedShrub.layers.mask, 1 << 7, 'keep the dedicated shadow pass');
assert.equal(populatedShrub.castShadow, true);
warmup.restore();
assert.equal(root.visible, false);
assert.equal(emptyGrass.visible, false);
assert.equal(emptyGrass.count, 0);
assert.equal(emptyGrass.frustumCulled, true);
assert.equal(populatedShrub.count, 3);
assert.equal(populatedShrub.frustumCulled, false);
for (const [index, mesh] of [emptyGrass, populatedShrub].entries()) {
  assert.deepEqual(mesh.instanceMatrix.array, before[index].data);
  assert.equal(mesh.instanceMatrix.version, before[index].version);
  assert.equal(mesh.geometry, before[index].geometry);
  assert.equal(mesh.material, before[index].material);
  assert.equal(material.version, before[index].materialVersion);
}
emptyGrass.count = 2;
warmup.restore();
assert.equal(emptyGrass.count, 2, 'restore is idempotent and cannot roll back live streaming');

const app = readFileSync(new URL('../src/app/App.ts', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../src/scene/SceneManager.ts', import.meta.url), 'utf8');
const forest = readFileSync(new URL('../src/props/ForestManager.ts', import.meta.url), 'utf8');
assert.match(app, /const closeGroundPrewarm = session.sceneManager.beginCloseGroundGpuPrewarm\(\)/);
assert.match(app, /\.\.\.closeGroundPrewarm.objects/);
assert.match(app, /const restorePrewarmObjects[\s\S]*?closeGroundPrewarm.restore\(\)/);
assert.match(app, /finally \{\s*restorePrewarmObjects\(\);\s*\}[\s\S]*?sceneManager.render\(0,[\s\S]*?waitForFirstPlayableGpuWork\(\)/,
  'clear the covered framebuffer before the loading screen fades');
assert.match(manager, /this.riverSystem.reedsGroup,[\s\S]*?getCloseGroundGpuPrewarmRoots/);
for (const layer of ['undergrowth', 'forestFloorIvy', 'forestFloorNettles', 'forestFloorTwigs']) {
  assert.ok(forest.slice(forest.indexOf('getCloseGroundGpuPrewarmRoots')).split('updateCameraState')[0].includes(`this.${layer}`));
}
assert.match(manager, /if \(!this.closeGroundGpuPrewarmActive\) \{\s*this.grassField\?\.updateCameraState/);
assert.match(manager, /if \(!this.closeGroundGpuPrewarmActive\) \{\s*this.riverSystem.updateCameraState/);
assert.match(forest, /if \(closeGroundGpuPrewarmActive\) \{\s*return shadowCastersChanged/);
console.log('Close-ground GPU warmup: exact meshes, buffers, materials, counts, shadow layers, and restoration verified.');
