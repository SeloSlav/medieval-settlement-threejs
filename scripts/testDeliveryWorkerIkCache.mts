import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as actual from '../src/logistics/deliveryCartWorker.ts';
import type { VillagerModelVariant } from '../src/settlement/SettlementCrowdRenderer.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
if (!globalThis.ProgressEvent) Object.defineProperty(globalThis, 'ProgressEvent', { value: class {
  constructor(readonly type: string, init: object = {}) { Object.assign(this, init); }
} });
const path = new URL('../src/logistics/.tmp-delivery-worker-ik-reference.ts', import.meta.url);
writeFileSync(path, execFileSync('git', ['show', '83887b25:src/logistics/deliveryCartWorker.ts'], { encoding: 'utf8', windowsHide: true }));
try {
  const reference: typeof actual = await import(path.href);
  const load = async (variant: VillagerModelVariant, file: string) => {
    const bytes = readFileSync(file);
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    return actual.createDeliveryCartWorkerSource(variant, gltf.scene, gltf.animations);
  };
  const sources = { man: await load('man', 'public/assets/models/villagers/worker-male-common-01-v002.glb'),
    woman: await load('woman', 'public/assets/models/villagers/worker-female-common-01-v001.glb') };
  const parents = [new THREE.Group(), new THREE.Group()];
  const workers = Array.from({ length: 48 }, (_, i) => {
    const pair = [actual, reference].map((module, side) => {
      const cart = new THREE.Group(); cart.position.set(i % 8 * 3, 0, Math.floor(i / 8) * 3); parents[side]!.add(cart);
      const worker = module.createDeliveryCartWorkerVisual(i * 523 + 47, sources, i % 3, i % 2 === 0);
      cart.add(worker.root); return worker;
    });
    return pair;
  });
  const objects = parents.map(parent => { const result = new Set<THREE.Object3D>(); parent.traverse(o => result.add(o)); return result; });
  const worldUpdates = [0, 0], matrixUpdates = [0, 0], updateWorld = THREE.Object3D.prototype.updateWorldMatrix,
    updateMatrix = THREE.Object3D.prototype.updateMatrixWorld;
  THREE.Object3D.prototype.updateWorldMatrix = function(...args) {
    for (let side = 0; side < 2; side++) if (objects[side]!.has(this)) worldUpdates[side]!++;
    return updateWorld.apply(this, args);
  };
  THREE.Object3D.prototype.updateMatrixWorld = function(...args) {
    for (let side = 0; side < 2; side++) if (objects[side]!.has(this)) matrixUpdates[side]!++;
    return updateMatrix.apply(this, args);
  };
  let paletteFloats = 0;
  const variants = new Set<string>(), roles = new Set<string>();
  try {
    for (let frame = 0; frame < 24; frame++) {
      for (let side = 0; side < 2; side++) {
        // Parent transforms deliberately change without a prior scene update.
        parents[side]!.position.set(frame >= 12 ? 10000 + frame : frame, 3 + frame * .03, -7);
        parents[side]!.rotation.set(frame * .003, frame * .03, frame * -.002);
        parents[side]!.scale.set(frame >= 8 ? 1.4 : 1, .8 + frame * .01, 1.1);
      }
      for (const pair of workers) {
        for (let side = 0; side < 2; side++) {
          const worker = pair[side]!, cart = worker.root.parent!;
          cart.position.x += .02; cart.rotation.y += .013;
          (side === 0 ? actual : reference).updateDeliveryCartWorkerVisual(worker, frame % 5 === 0 ? 0 : 1 / 60, frame % 8 < 4, frame % 4 * .8);
        }
        const a = pair[0]!, b = pair[1]!;
        variants.add(a.root.userData.villagerGender); roles.add(a.role); assert.equal(a.mode, b.mode);
        a.model.updateWorldMatrix(true, true); b.model.updateWorldMatrix(true, true);
        const nodes: THREE.Object3D[][] = [[], []]; a.model.traverse(o => nodes[0]!.push(o)); b.model.traverse(o => nodes[1]!.push(o));
        assert.equal(nodes[0]!.length, nodes[1]!.length);
        for (let i = 0; i < nodes[0]!.length; i++) {
          const x = nodes[0]![i]!, y = nodes[1]![i]!;
          for (let c = 0; c < 4; c++) assert(Math.abs(x.quaternion.toArray()[c]! - y.quaternion.toArray()[c]!) < 1e-12, `IK quaternion ${x.name}, frame ${frame}`);
          const mesh = x as THREE.SkinnedMesh, other = y as THREE.SkinnedMesh;
          if (!mesh.isSkinnedMesh) continue;
          const inverse = mesh.matrixWorld.clone().invert(), otherInverse = other.matrixWorld.clone().invert();
          for (let bone = 0; bone < mesh.skeleton.bones.length; bone++) {
            const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.skeleton.bones[bone]!.matrixWorld).multiply(mesh.skeleton.boneInverses[bone]!);
            const expected = new THREE.Matrix4().multiplyMatrices(otherInverse, other.skeleton.bones[bone]!.matrixWorld).multiply(other.skeleton.boneInverses[bone]!);
            assert.deepEqual(new Float32Array(matrix.elements), new Float32Array(expected.elements), `GPU palette ${mesh.skeleton.bones[bone]!.name}, frame ${frame}`);
            paletteFloats += 16;
          }
        }
      }
    }
  } finally { THREE.Object3D.prototype.updateWorldMatrix = updateWorld; THREE.Object3D.prototype.updateMatrixWorld = updateMatrix; }
  assert.deepEqual([...variants].sort(), ['man', 'woman']); assert.deepEqual([...roles].sort(), ['companion', 'guide', 'hauler']);
  assert(worldUpdates[0]! + matrixUpdates[0]! < (worldUpdates[1]! + matrixUpdates[1]!) / 2,
    'IK must remove repeated ancestor and unrelated-branch traversals');
  for (const pair of workers) pair.forEach(worker => actual.disposeDeliveryCartWorkerVisual(worker));
  actual.disposeDeliveryCartWorkerSources(sources);
  console.log(JSON.stringify({ workers: 48, frames: 24, variants: [...variants], roles: [...roles], paletteFloats,
    optimizedWorldUpdates: worldUpdates[0], referenceWorldUpdates: worldUpdates[1], optimizedMatrixUpdates: matrixUpdates[0],
    referenceMatrixUpdates: matrixUpdates[1], exactGpuPalettes: true }));
} finally { unlinkSync(path); }
