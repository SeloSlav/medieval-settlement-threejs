import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StaticInstancedShadowBatch } from '../src/scene/StaticInstancedShadowBatch.ts';
import { TREE_SHADOW_CAST_LAYER } from '../src/scene/SceneLayers.ts';

const root = new THREE.Group();
root.position.set(17, -3, 41);
root.rotation.set(0.13, -0.47, 0.08);
root.scale.set(1.2, 0.9, 1.1);

const nested = new THREE.Group();
nested.position.set(-9, 4, 7);
nested.rotation.set(-0.11, 0.28, 0.06);
nested.scale.set(0.7, 1.4, 0.8);
root.add(nested);

const geometry = new THREE.DodecahedronGeometry(2, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x755243 });
const alternateMaterial = new THREE.MeshStandardMaterial({ color: 0x8a7352 });

const first = createSource(geometry, material, 'first');
first.position.set(3, 5, -8);
first.rotation.set(0.4, -0.2, 0.7);
first.scale.set(0.8, 1.3, 0.6);
nested.add(first);

const secondParent = new THREE.Group();
secondParent.position.set(12, -2, -5);
secondParent.rotation.set(0.2, 0.8, -0.1);
root.add(secondParent);
const second = createSource(geometry, material, 'second');
second.position.set(-4, 6, 9);
second.rotation.set(-0.3, 0.5, 0.12);
second.scale.set(1.1, 0.65, 1.5);
secondParent.add(second);

const third = createSource(geometry, alternateMaterial, 'third');
third.position.set(20, 1, -16);
root.add(third);

const sourceWorldMatrices = [first, second, third].map((source) => {
  source.updateWorldMatrix(true, false);
  return source.matrixWorld.clone();
});
const batch = new StaticInstancedShadowBatch(
  root,
  [first, second, third],
  'Exact static shadow test',
);

assert.equal(first.castShadow, false);
assert.equal(second.castShadow, false);
assert.equal(third.castShadow, false);
assert.equal(batch.group.userData.sourceMeshCount, 3);
assert.equal(batch.group.userData.batchCount, 2);

const proxies = batch.group.children as THREE.InstancedMesh[];
const stableProxyIdentities = [...proxies];
assert.equal(proxies.length, 2, 'only identical render state may share a draw');
for (const proxy of proxies) {
  assert.equal(proxy.castShadow, true);
  assert.equal(proxy.receiveShadow, false);
  assert.equal(proxy.layers.mask, 1 << TREE_SHADOW_CAST_LAYER);
  assert.ok(proxy.boundingBox);
  assert.ok(proxy.boundingSphere);
  assert.equal(proxy.geometry, geometry, 'the authored geometry must be reused exactly');
}

const primaryProxy = proxies.find((proxy) => proxy.material === material);
const alternateProxy = proxies.find((proxy) => proxy.material === alternateMaterial);
assert.ok(primaryProxy);
assert.ok(alternateProxy);
assert.equal(primaryProxy.count, 2);
assert.equal(alternateProxy.count, 1);

assertProxyWorldMatrix(primaryProxy, 0, sourceWorldMatrices[0]!);
assertProxyWorldMatrix(primaryProxy, 1, sourceWorldMatrices[1]!);
assertProxyWorldMatrix(alternateProxy, 0, sourceWorldMatrices[2]!);

nested.visible = false;
batch.rebuild();
assert.equal(batch.group.userData.sourceMeshCount, 2);
assert.deepEqual(
  batch.group.children,
  stableProxyIdentities,
  'visibility rebuilds must reuse the same GPU meshes instead of allocating and disposing them',
);
const visiblePrimaryProxy = (batch.group.children as THREE.InstancedMesh[])
  .find((proxy) => proxy.material === material);
assert.ok(visiblePrimaryProxy);
assert.equal(visiblePrimaryProxy.count, 1);
assertProxyWorldMatrix(visiblePrimaryProxy, 0, sourceWorldMatrices[1]!);

nested.visible = true;
batch.rebuild();
assert.equal(batch.group.userData.sourceMeshCount, 3);
assert.equal(batch.group.userData.batchCount, 2);

third.visible = false;
batch.rebuild();
assert.equal(batch.group.userData.sourceMeshCount, 2);
assert.equal(batch.group.userData.batchCount, 1);
assert.equal(alternateProxy.count, 0,
  'an exhausted render-state bucket must stop drawing without destroying its reusable GPU mesh');
assert.deepEqual(batch.group.children, stableProxyIdentities);
third.visible = true;
batch.rebuild();
assert.equal(alternateProxy.count, 1);
assertProxyWorldMatrix(alternateProxy, 0, sourceWorldMatrices[2]!);

batch.dispose();
assert.equal(batch.group.parent, null);
assert.equal(first.castShadow, true);
assert.equal(second.castShadow, true);
assert.equal(third.castShadow, true);

geometry.dispose();
material.dispose();
alternateMaterial.dispose();

console.log('static instanced shadow batch tests passed');

function createSource(
  sourceGeometry: THREE.BufferGeometry,
  sourceMaterial: THREE.Material,
  name: string,
): THREE.Mesh {
  const source = new THREE.Mesh(sourceGeometry, sourceMaterial);
  source.name = name;
  source.castShadow = true;
  return source;
}

function assertProxyWorldMatrix(
  proxy: THREE.InstancedMesh,
  index: number,
  expectedWorld: THREE.Matrix4,
): void {
  const instance = new THREE.Matrix4();
  proxy.getMatrixAt(index, instance);
  proxy.updateWorldMatrix(true, false);
  const actualWorld = new THREE.Matrix4().multiplyMatrices(
    proxy.matrixWorld,
    instance,
  );
  for (let offset = 0; offset < 16; offset += 1) {
    assert.ok(
      Math.abs(actualWorld.elements[offset]! - expectedWorld.elements[offset]!) < 1e-5,
      `world matrix element ${offset} must remain exact`,
    );
  }
}
