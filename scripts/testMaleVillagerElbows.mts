import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { applyCombatWeaponPose, bindCombatWeaponRig, resetCombatWeaponRig, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources } from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
const bytes = fs.readFileSync('public/assets/models/villagers/worker-male-common-01-v002.glb');
const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
const repair = doc.meshes[0].extras.elbowRepair;
assert.equal(repair.repairs.length, 2);
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const meshes: THREE.SkinnedMesh[] = [];
gltf.scene.traverse(object => { if (object instanceof THREE.SkinnedMesh) meshes.push(object); });
assert.equal(meshes.length, 1, 'The patches must stay in the existing draw submission.');
assert.equal(meshes[0]!.skeleton.bones.length, 41, 'The authored rig must be retained.');
assert.equal(doc.materials.length, 1, 'The elbow skin must use the existing material and atlas.');
const mesh = meshes[0]!, geometry = mesh.geometry;
const positions = geometry.getAttribute('position');
const normals = geometry.getAttribute('normal');
const key = (i: number) => new THREE.Vector3().fromBufferAttribute(positions, i).toArray().map(n => Math.round(n * 1e5)).join(',');
const edges = new Map<string, { count: number; a: number; b: number }>();
const index = geometry.index!;
for (let i = 0; i < index.count; i += 3) {
  for (let j = 0; j < 3; j++) {
    const a = index.getX(i + j), b = index.getX(i + (j + 1) % 3);
    const id = [key(a), key(b)].sort().join('/');
    const edge = edges.get(id) ?? { count: 0, a, b }; edge.count++; edges.set(id, edge);
  }
}
const atElbow = (i: number) => Math.abs(positions.getX(i)) > .275 && Math.abs(positions.getX(i)) < .305
  && positions.getY(i) > .76 && positions.getY(i) < .82 && positions.getZ(i) > -.045 && positions.getZ(i) < .012;
for (const edge of edges.values()) {
  if (atElbow(edge.a) && atElbow(edge.b)) assert.equal(edge.count, 2, 'Every elbow edge must have two neighboring faces.');
}
const originals = new Map<string, number>();
for (let i = 0; i < repair.originalVertices; i++) originals.set(key(i), i);
const matches: Array<[number, number]> = [];
for (let i = repair.originalVertices; i < positions.count; i++) {
  const source = originals.get(key(i));
  assert.notEqual(source, undefined, 'The repair must follow the exact authored rim.');
  assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(normals, i).length() - 1) < 1e-6);
  matches.push([i, source!]);
}
assert.ok(matches.length > 0);
installMilitaryHandGrip(gltf.scene);
const sources = createMilitaryEquipmentSources();
let samples = 0;
for (const kind of ['bow', 'sidearm', 'spear', 'crossbow'] as const) {
  const equipment = attachMilitaryEquipment(gltf.scene, sources[kind]);
  const rig = bindCombatWeaponRig(gltf.scene, kind, equipment)!;
  const presentation = resolveCombatWeaponPresentation(kind, 8)!;
  for (let frame = 0; frame <= 100; frame++) {
    resetCombatWeaponRig(rig);
    applyCombatWeaponPose(rig, { tool: kind, targetDistance: 8, attackCooldown: (1 - frame / 100) * presentation.attackSeconds, dtSeconds: 0, logicalMode: 'fight' });
    gltf.scene.updateMatrixWorld(true); mesh.skeleton.update();
    for (const [added, original] of matches) {
      const point = mesh.getVertexPosition(added, new THREE.Vector3());
      const rim = mesh.getVertexPosition(original, new THREE.Vector3());
      assert.ok(point.toArray().every(Number.isFinite));
      assert.ok(point.distanceTo(rim) < 1e-6, `${kind}/${frame}: the elbow patch separated from its authored rim.`);
    }
    samples++;
  }
  resetCombatWeaponRig(rig);
  equipment.removeFromParent();
}
console.log(`Male villager elbows verified: closed topology, smooth normals, one material, and connected skin over ${samples} attack poses.`);
