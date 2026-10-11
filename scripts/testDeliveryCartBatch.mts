import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createDeliveryCartMesh, disposeDeliveryCartMesh, disposeDeliveryCartModelSource } from '../src/logistics/deliveryCartMesh.ts';
import { ExactMountedAttachmentBatch } from '../src/settlement/ExactMountedAttachmentBatch.ts';

const bytes = readFileSync('public/assets/models/delivery-cart/quaternius-medieval-cart.glb');
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const bounds = new THREE.Box3().setFromObject(gltf.scene);
const source = { scene: gltf.scene, bounds, sourceHeight: bounds.max.y - bounds.min.y };
const parent = new THREE.Group();
parent.position.set(13, 2, -7); parent.rotation.y = .3;
const batch = new ExactMountedAttachmentBatch(parent, { initialCapacity: 2, name: 'Cart contract' });
const carts: THREE.Group[] = [];
const geometries = new Set<THREE.BufferGeometry>();
let geometryDisposals = 0, materialDisposals = 0;
gltf.scene.traverse(o => {
  if (!(o instanceof THREE.Mesh)) return;
  if (!geometries.has(o.geometry)) o.geometry.addEventListener('dispose', () => geometryDisposals++);
  geometries.add(o.geometry);
});
const materialKey = (m: THREE.Material | THREE.Material[]) => (Array.isArray(m) ? m : [m]).map(m => m.uuid).join(',');
const borrowedMaterials = new Set<THREE.Material>();
for (let i = 0; i < 128; i++) {
  const cart = createDeliveryCartMesh('stone', { source, appearanceSeed: i, loaded: false });
  cart.position.set(i * 3, Math.sin(i), i % 7 * 4); cart.rotation.y = i * .11;
  parent.add(cart); carts.push(cart);
  const model = cart.userData.deliveryCartModel as THREE.Group;
  model.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    assert(geometries.has(o.geometry), 'Cart must borrow the unchanged authored geometry');
    assert(o.castShadow && o.receiveShadow);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!borrowedMaterials.has(m)) m.addEventListener('dispose', () => materialDisposals++);
      borrowedMaterials.add(m);
    }
  });
  batch.registerTool(model);
}
assert.equal(borrowedMaterials.size, 11, 'Four canopy palettes must share all uncoloured materials');
for (let step = 0; step < 3; step++) {
  carts[0].position.x += 1; carts[1].rotation.y += .2;
  const expected = new Map<string, THREE.Matrix4[]>();
  parent.updateWorldMatrix(true, true);
  const inverse = batch.group.matrixWorld.clone().invert();
  for (const cart of carts) {
    const model = cart.userData.deliveryCartModel as THREE.Group;
    model.visible = step !== 1 || cart !== carts[0];
    if (!model.visible) continue;
    model.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const key = o.geometry.uuid + '|' + materialKey(o.material);
      const values = expected.get(key) ?? []; expected.set(key, values);
      values.push(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
    });
  }
  batch.update();
  for (const o of batch.group.children) {
    if (!(o instanceof THREE.InstancedMesh)) continue;
    const values = expected.get(o.geometry.uuid + '|' + materialKey(o.material))!;
    assert.equal(o.count, values.length);
    for (let i = 0; i < o.count; i++) {
      const actual = new THREE.Matrix4(); o.getMatrixAt(i, actual);
      for (let j = 0; j < 16; j++) assert(Math.abs(actual.elements[j]! - values[i]!.elements[j]!) < 0.0001);
    }
  }
  const diagnostic = batch.diagnostics();
  assert(diagnostic.activeDrawCalls <= 11, '128 rigid cart bodies must use at most 11 geometry/palette batches');
  assert.equal(diagnostic.omittedRenderableCount, 0);
  assert.equal(diagnostic.visibleMeshInstances, (step === 1 ? 127 : 128) * 5);
  assert(diagnostic.sourceGeometryIdentityPreserved && diagnostic.sourceMaterialIdentityPreserved);
}
for (const cart of carts) {
  batch.unregisterTool(cart.userData.deliveryCartModel); disposeDeliveryCartMesh(cart); cart.removeFromParent();
}
batch.update(); assert.equal(batch.diagnostics().activeDrawCalls, 0);
batch.dispose();
assert.equal(geometryDisposals, 0); assert.equal(materialDisposals, 0);
disposeDeliveryCartModelSource(source);
assert.equal(geometryDisposals, geometries.size);
assert.equal(materialDisposals, borrowedMaterials.size);
console.log('128 authored carts: exact moving transforms, 11 body batches, visibility, palettes, shadows and lifetime ownership passed');
