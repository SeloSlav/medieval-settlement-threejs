import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DeliveryWorkerBatches } from '../src/logistics/DeliveryWorkerBatches.ts';
import { createDeliveryCartWorkerSource, createDeliveryCartWorkerVisual, updateDeliveryCartWorkerVisual,
  disposeDeliveryCartWorkerVisual, disposeDeliveryCartWorkerSources } from '../src/logistics/deliveryCartWorker.ts';
import type { AuthoredSkinnedInstanceBatch } from '../src/scene/AuthoredSkinnedInstanceBatch.ts';
import type { VillagerModelVariant } from '../src/settlement/SettlementCrowdRenderer.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
if (!globalThis.ProgressEvent) Object.defineProperty(globalThis, 'ProgressEvent', { value: class {
  constructor(readonly type: string, init: object = {}) { Object.assign(this, init); }
} });
async function load(variant: VillagerModelVariant, file: string) {
  const bytes = readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return createDeliveryCartWorkerSource(variant, gltf.scene, gltf.animations);
}
const sources = {
  man: await load('man', 'public/assets/models/villagers/worker-male-common-01-v002.glb'),
  woman: await load('woman', 'public/assets/models/villagers/worker-female-common-01-v001.glb'),
};
const parent = new THREE.Group(); parent.position.set(18, 3, -8); parent.rotation.y = 0.21;
const batches = new DeliveryWorkerBatches(parent, sources);
const workers = Array.from({ length: 48 }, (_, index) => {
  const cart = new THREE.Group(); cart.position.set(index * 3, 0, index % 5); cart.rotation.y = index * 0.14; parent.add(cart);
  const worker = createDeliveryCartWorkerVisual(index * 523 + 47, sources, index % 3, index % 2 === 0);
  cart.add(worker.root); batches.register(worker); return worker;
});
batches.reserve(workers.length);
const byVariant = batches as unknown as { batches: Record<VillagerModelVariant, AuthoredSkinnedInstanceBatch> };
for (let frame = 0; frame < 4; frame++) {
  batches.begin();
  const expected: Record<VillagerModelVariant, typeof workers> = { man: [], woman: [] };
  const order = frame % 2 ? workers.slice().reverse() : workers;
  for (const [index, worker] of order.entries()) {
    worker.root.parent!.rotation.y += 0.03; worker.root.parent!.position.x += 0.2;
    updateDeliveryCartWorkerVisual(worker, 1 / 60, frame !== 2, 2.1);
    if (frame === 1 && index % 3 === 0) continue;
    batches.add(worker); expected[worker.root.userData.villagerGender as VillagerModelVariant].push(worker);
    assert.equal(worker.model.visible, false, 'The pose rig must not duplicate body rendering');
  }
  batches.finish(); parent.updateMatrixWorld(true);
  for (const variant of ['man', 'woman'] as const) {
    const batch = byVariant.batches[variant];
    const internals = batch as unknown as { posePalette: { array: Float32Array }; instanceColors: { array: Float32Array } };
    const layers = batch.group.children.filter(o => (o as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
    assert.equal(batch.count, expected[variant].length); assert(batch.count > 0, 'Both civilian model variants must be covered');
    const sourceLayers: THREE.SkinnedMesh[] = [];
    sources[variant].scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) sourceLayers.push(o as THREE.SkinnedMesh); });
    for (const [slot, worker] of expected[variant].entries()) {
      const posedLayers: THREE.SkinnedMesh[] = [];
      worker.model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) posedLayers.push(o as THREE.SkinnedMesh); });
      for (const [layerIndex, posed] of posedLayers.entries()) {
        const layer = layers[layerIndex]; assert.equal(layer.geometry, sourceLayers[layerIndex].geometry);
        assert(layer.castShadow && layer.receiveShadow);
        const matrix = new THREE.Matrix4().fromArray(layer.instanceMatrix.array, slot * 16).premultiply(layer.matrixWorld);
        const offset = slot * batch.boneCount * 16;
        const inverseWorld = posed.matrixWorld.clone().invert();
        for (const [boneIndex, bone] of posed.skeleton.bones.entries()) {
          const expectedBone = new THREE.Matrix4().multiplyMatrices(inverseWorld, bone.matrixWorld).multiply(posed.skeleton.boneInverses[boneIndex]);
          for (let c = 0; c < 16; c++) assert(Math.abs(internals.posePalette.array[offset + boneIndex * 16 + c] - expectedBone.elements[c]) < 0.001,
            `${variant} worker ${slot} keeps exact animation and hand-IK bone ${bone.name}`);
        }
        // Reconstruct weighted GLB vertices through the uploaded palette and
        // transform, checking actor motion, the model's authored basis and IK.
        for (let vertex = 0; vertex < posed.geometry.getAttribute('position').count; vertex += 401) {
          const p = new THREE.Vector3().fromBufferAttribute(posed.geometry.getAttribute('position'), vertex);
          const native = posed.applyBoneTransform(vertex, p.clone()).applyMatrix4(posed.matrixWorld);
          const bindVertex = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(posed.bindMatrix);
          const index = posed.geometry.getAttribute('skinIndex'), weight = posed.geometry.getAttribute('skinWeight');
          const output = new THREE.Vector4(0, 0, 0, 0);
          for (let i = 0; i < 4; i++) {
            const bone = new THREE.Matrix4().fromArray(internals.posePalette.array, offset + index.getComponent(vertex, i) * 16);
            output.add(bindVertex.clone().applyMatrix4(bone).multiplyScalar(weight.getComponent(vertex, i)));
          }
          const actual = new THREE.Vector3(output.x, output.y, output.z).applyMatrix4(matrix);
          assert(actual.distanceTo(native) < 0.002, `${variant} exact weighted world vertex, frame ${frame}`);
        }
        const submittedMaterials = Array.isArray(layer.material) ? layer.material : [layer.material];
        const posedMaterials = Array.isArray(posed.material) ? posed.material : [posed.material];
        for (const [i, material] of submittedMaterials.entries()) {
          const actual = material as THREE.MeshStandardMaterial, original = posedMaterials[i] as THREE.MeshStandardMaterial;
          assert.equal(actual.map, original.map); assert.equal(actual.emissiveMap, original.emissiveMap);
          assert.equal(actual.roughness, original.roughness); assert.equal(actual.metalness, original.metalness);
          assert(actual.emissive.equals(original.emissive)); assert.equal(actual.emissiveIntensity, original.emissiveIntensity);
        }
      }
    }
    const diagnostic = batch.diagnostics();
    assert(diagnostic.sourceGeometryIdentityPreserved && diagnostic.sourcePbrMapIdentityPreserved && diagnostic.sourceBoneLayoutValidated);
    assert(diagnostic.drawCalls <= 2, 'Every worker of a variant must share the authored body draws');
  }
}
for (const worker of workers) { batches.unregister(worker); assert.equal(worker.model.visible, true); disposeDeliveryCartWorkerVisual(worker); }
batches.begin(); batches.finish(); assert.equal(batches.diagnostics().man.count + batches.diagnostics().woman.count, 0);
batches.dispose(); disposeDeliveryCartWorkerSources(sources);
console.log('48 civilian cart workers: male/female exact GLB vertices, AnimationMixer + hand IK, palette reorder, visibility, PBR textures, shadows and disposal passed');
