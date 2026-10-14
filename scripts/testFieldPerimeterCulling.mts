import assert from 'node:assert/strict';
import * as THREE from 'three';
import { windStrength } from '../vendor/seedthree/src/core/wind.js';
import { createFieldPerimeterShrubGroup } from '../src/farming/FarmFieldPerimeterShrubs.ts';
import { FieldPerimeterView } from '../src/farming/FieldPerimeterView.ts';
import { createGorskiShrubPrototype } from '../src/vegetation/seedthree/gorskiShrubPrototypes.ts';
import type { FarmFieldState } from '../src/resources/types.ts';

const materials = [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()] as const;
const prototypes = [0, 1, 2].map(i => createGorskiShrubPrototype('field-hornbeam', i));
const fields = Array.from({ length: 100 }, (_, i) => ({ id: `cull-${i}`, farmsteadId: 'barn',
  corners: [{ x: i % 10 * 48, z: Math.floor(i / 10) * 48 }, { x: i % 10 * 48 + 36, z: Math.floor(i / 10) * 48 },
    { x: i % 10 * 48 + 36, z: Math.floor(i / 10) * 48 + 36 }, { x: i % 10 * 48, z: Math.floor(i / 10) * 48 + 36 }],
} as FarmFieldState));
const root = createFieldPerimeterShrubGroup(fields, () => 0, { prototypes, materials: [...materials], textures: [], dispose() {} }) as FieldPerimeterView;
const snapshots = root.children.map(o => {
  const mesh = o as THREE.InstancedMesh;
  const attributes = [mesh.instanceMatrix, mesh.instanceColor!, ...['aTint', 'aAnchorPos', 'aWindVec'].map(n => mesh.geometry.getAttribute(n) as THREE.InstancedBufferAttribute)];
  return { mesh, count: mesh.count, attributes, arrays: attributes.map(a => (a.array as Float32Array).slice()) };
});
const camera = new THREE.PerspectiveCamera(45, 1.4, .1, 2000);
const frustum = new THREE.Frustum(), projection = new THREE.Matrix4(), matrix = new THREE.Matrix4(), bounds = new THREE.Box3();
let checkedSlots = 0, minimumCount = Infinity;
for (let step = 0; step < 12; step++) {
  if (step === 4) { root.position.set(20, 3, -10); root.rotation.y = .2; root.scale.set(1.4, .8, 1.1); }
  windStrength.value = [0, 1, 3][step % 3]!;
  if (step === 8) { camera.position.set(1000, 100, 1000); camera.lookAt(1600, 100, 1600); }
  else if (step === 9 || step === 11) { camera.position.set(240, 900, 500); camera.lookAt(240, 0, 240); }
  else { camera.position.set(step * 32 + 20, 14, step * 16 + 40); camera.lookAt(step * 32 + 20, 0, step * 16); }
  camera.updateMatrixWorld(true); root.updateMatrixWorld(true);
  root.prepare(camera);
  projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(root.matrixWorld);
  frustum.setFromProjectionMatrix(projection, camera.coordinateSystem, camera.reversedDepth);
  let count = 0;
  for (const snapshot of snapshots) {
    const { mesh, attributes, arrays } = snapshot;
    const anchor = mesh.geometry.getAttribute('aAnchorPos');
    const retained = new Set<number>(); let previous = -1;
    for (let slot = 0; slot < mesh.count; slot++) {
      const source = arrays[3]!;
      let index = -1;
      for (let i = previous + 1; i < snapshot.count; i++) if (source[i * 3] === anchor.getX(slot) && source[i * 3 + 2] === anchor.getZ(slot)) { index = i; break; }
      assert(index > previous, 'Packed instances preserve the original order');
      for (let a = 0; a < attributes.length; a++) {
        const stride = attributes[a]!.itemSize;
        assert.deepEqual(attributes[a]!.array.slice(slot * stride, (slot + 1) * stride), arrays[a]!.slice(index * stride, (index + 1) * stride));
      }
      retained.add(index); previous = index; checkedSlots++;
    }
    for (let i = 0; i < snapshot.count; i++) {
      matrix.fromArray(arrays[0]!, i * 16);
      // Individual geometry is a strict subset of each conservative cell.
      bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(matrix).expandByScalar(.112 * windStrength.value + 1e-4);
      if (frustum.intersectsBox(bounds)) assert(retained.has(i), `Visible authored shrub ${i} omitted at step ${step}`);
    }
    const versions = attributes.map(a => a.version);
    root.prepare(camera);
    assert.deepEqual(attributes.map(a => a.version), versions, 'Unchanged views perform no buffer upload');
    count += mesh.count;
  }
  if (step === 8) assert.equal(count, 0, 'Looking away clears every active draw');
  if (step === 9 || step === 11) assert(count > 10000, 'Wide view restores the original sources after empty or close views');
  minimumCount = Math.min(minimumCount, count);
}
assert.equal(root.children.length, 3, 'Spatial selection must retain three prototype meshes');
assert(minimumCount < 1000);
console.log(JSON.stringify({ sourceInstances: snapshots.reduce((n, s) => n + s.count, 0), checkedSlots, views: 12, meshes: root.children.length }));
for (const s of snapshots) s.mesh.dispose();
for (const p of prototypes) p.geometry.dispose();
for (const m of materials) m.dispose();
