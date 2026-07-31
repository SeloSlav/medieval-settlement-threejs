import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  BatchedBuildingShadowProxies,
  isBuildingShadowProxy,
} from '../src/buildings/buildingShadowProxy.ts';
import { TREE_SHADOW_CAST_LAYER } from '../src/scene/sceneLayers.ts';

const parent = new THREE.Group();
const batch = new BatchedBuildingShadowProxies(
  parent,
  'Shadow batch test',
  true,
);

const startedAt = performance.now();
for (let index = 0; index < 1_000; index += 1) {
  const marker = new THREE.Group();
  marker.position.set(index % 40 * 13, index % 5 * 0.08, Math.floor(index / 40) * 15);
  marker.rotation.y = index * 0.17;
  marker.scale.setScalar(0.94 + index % 7 * 0.01);
  batch.upsertResidence(`residence:${index}`, index % 3 === 0 ? 3 : index % 2 === 0 ? 2 : 1, marker);
}

const townHall = new THREE.Group();
townHall.position.set(-20, 0.4, 16);
townHall.rotation.y = Math.PI * 0.25;
batch.upsertBuilding('building:town-hall', 'town_hall', townHall);

const quarry = new THREE.Group();
quarry.position.set(42, -0.6, -28);
batch.upsertBuilding('building:quarry', 'stone_quarry', quarry);

assert.equal(batch.flush(), true);
const elapsedMs = performance.now() - startedAt;
const stats = batch.getStats();
assert.deepEqual(stats, {
  proxies: 1_002,
  boxInstances: 1_001,
  cylinderInstances: 1,
  shadowDraws: 2,
});
assert.ok(
  elapsedMs < 1_500,
  `1,002 proxy matrix updates should stay comfortably sub-frame-batch; took ${elapsedMs.toFixed(1)}ms`,
);

const meshes = batch.group.children.filter(
  (child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh,
);
assert.equal(meshes.length, 2, 'the batch should own one box and one cylinder submission');
for (const mesh of meshes) {
  assert.equal(isBuildingShadowProxy(mesh), true);
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.layers.isEnabled(TREE_SHADOW_CAST_LAYER), true);
  assert.ok(mesh.customDepthMaterial instanceof THREE.MeshDepthMaterial);
  assert.ok(mesh.boundingBox, 'populated instance batches need culling bounds');
  assert.ok(mesh.boundingSphere, 'populated instance batches need culling bounds');
}

assert.equal(
  batch.upsertBuilding('building:town-hall', 'town_hall', townHall),
  false,
  'an unchanged transform must not dirty the GPU batch',
);
assert.equal(batch.flush(), false, 'an unchanged snapshot must not upload matrices again');

townHall.position.x += 3;
assert.equal(batch.upsertBuilding('building:town-hall', 'town_hall', townHall), true);
assert.equal(batch.flush(), true);
assert.deepEqual(batch.getStats(), stats);

assert.equal(batch.remove('building:quarry'), true);
assert.equal(batch.flush(), true);
assert.deepEqual(batch.getStats(), {
  proxies: 1_001,
  boxInstances: 1_001,
  cylinderInstances: 0,
  shadowDraws: 1,
});
const emptyCylinderBatch = meshes.find(
  (mesh) => mesh.userData.batchedShadowProxyShape === 'cylinder',
);
assert.ok(emptyCylinderBatch);
assert.equal(emptyCylinderBatch.count, 0);
assert.equal(emptyCylinderBatch.boundingBox, null);
assert.equal(emptyCylinderBatch.boundingSphere, null);

batch.dispose();
assert.equal(parent.children.length, 0);

console.log(
  `Building shadow batching tests passed (${stats.proxies} structures -> ${stats.shadowDraws} shadow draws, ${elapsedMs.toFixed(1)}ms rebuild).`,
);
