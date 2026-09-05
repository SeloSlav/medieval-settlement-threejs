import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip, MILITARY_LEFT_GRIP_BONES, offsetMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources } from '../src/settlement/militaryEquipment.ts';
import { bindCombatWeaponRig, applyMilitaryCarryPose } from '../src/settlement/combatWeaponAnimation.ts';

const path = 'public/assets/models/villagers/worker-male-common-01-v002.glb';
const sourceBytes = execFileSync('git', ['show', `b148ae849b71a06b48154aabdf8809f517949202:${path}`], { maxBuffer: 16 * 1024 * 1024 });
const targetBytes = fs.readFileSync(process.argv[2] ?? path);
const unpack = (bytes: Buffer) => { const n = bytes.readUInt32LE(12); return { doc: JSON.parse(bytes.subarray(20, 20 + n).toString()), bin: bytes.subarray(28 + n) }; };
const source = unpack(sourceBytes), target = unpack(targetBytes), alignment = target.doc.meshes[0].extras.elbowAlignment;
assert.equal(alignment.sourceSha256, createHash('sha256').update(sourceBytes).digest('hex'));
const edited = new Set(['L_Upperarm', 'L_Forearm', 'L_Hand', 'L_UpperarmTwist01', 'L_UpperarmTwist02', 'L_ForearmTwist01', 'L_ForearmTwist02']);
source.doc.nodes.forEach((node: { name: string }, i: number) => { if (!edited.has(node.name)) assert.deepEqual(target.doc.nodes[i], node, `${node.name}: unrelated rig node changed`); });
function accessorData(file: typeof source, id: number): Buffer {
  const accessor = file.doc.accessors[id], view = file.doc.bufferViews[accessor.bufferView];
  const size = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[accessor.type]!;
  const width = accessor.componentType === 5121 ? 1 : accessor.componentType === 5123 ? 2 : 4;
  return file.bin.subarray(view.byteOffset + (accessor.byteOffset ?? 0), view.byteOffset + (accessor.byteOffset ?? 0) + accessor.count * size * width);
}
let preservedTracks = 0;
source.doc.animations.forEach((animation: any, i: number) => {
  const updated = target.doc.animations[i]; assert.equal(animation.name, updated.name);
  assert.deepEqual(animation.channels, updated.channels);
  animation.channels.forEach((channel: any) => {
    const oldSampler = animation.samplers[channel.sampler], newSampler = updated.samplers[channel.sampler];
    assert.equal(oldSampler.interpolation, newSampler.interpolation);
    assert.deepEqual(accessorData(source, oldSampler.input), accessorData(target, newSampler.input), 'animation timing changed');
    if (!edited.has(source.doc.nodes[channel.target.node].name) || channel.target.path === 'scale') {
      assert.deepEqual(accessorData(source, oldSampler.output), accessorData(target, newSampler.output), 'unrelated animation channel changed'); preservedTracks++;
    }
  });
});
assert.deepEqual(target.doc.materials, source.doc.materials);
source.doc.images.forEach((image: any, i: number) => {
  const a = source.doc.bufferViews[image.bufferView], b = target.doc.bufferViews[target.doc.images[i].bufferView];
  assert.deepEqual(target.bin.subarray(b.byteOffset, b.byteOffset + b.byteLength), source.bin.subarray(a.byteOffset, a.byteOffset + a.byteLength));
});
const a = source.doc.meshes[0].primitives[0], b = target.doc.meshes[0].primitives[0];
for (const name of Object.keys(a.attributes)) {
  const original = accessorData(source, a.attributes[name]);
  assert.ok(accessorData(target, b.attributes[name]).subarray(0, original.length).equals(original), `authored ${name} values changed`);
}

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string) {} } });
const parse = (bytes: Buffer) => new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const [oldGltf, newGltf] = await Promise.all([parse(sourceBytes), parse(targetBytes)]);
const firstMesh = (model: THREE.Group) => { let mesh!: THREE.SkinnedMesh; model.traverse(o => { if (o instanceof THREE.SkinnedMesh) mesh ??= o; }); return mesh; };
const newMesh = firstMesh(newGltf.scene), oldMesh = firstMesh(oldGltf.scene);
newGltf.scene.updateMatrixWorld(true);
for (let i = 0; i < oldMesh.geometry.getAttribute('position').count; i++) {
  assert.ok(newMesh.getVertexPosition(i, new THREE.Vector3()).distanceTo(oldMesh.getVertexPosition(i, new THREE.Vector3())) < 1e-6, 'neutral mesh shape changed');
}
for (const name of ['Forearm', 'Hand']) {
  const left = newGltf.scene.getObjectByName(`L_${name}`)!.getWorldPosition(new THREE.Vector3());
  const right = newGltf.scene.getObjectByName(`R_${name}`)!.getWorldPosition(new THREE.Vector3()); right.x *= -1;
  assert.ok(left.distanceTo(right) < 1e-6, `${name}: left pivot is not aligned with the mirrored right arm`);
}
installMilitaryHandGrip(oldGltf.scene); installMilitaryHandGrip(newGltf.scene);
for (const name of MILITARY_LEFT_GRIP_BONES) assert.ok(newGltf.scene.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())
  .distanceTo(oldGltf.scene.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())) < 1e-6, `${name}: anatomical correction moved the authored fingers`);
const oldHand = oldGltf.scene.getObjectByName('L_Hand') as THREE.Bone, newHand = newGltf.scene.getObjectByName('L_Hand') as THREE.Bone;
assert.ok(Math.abs(oldHand.userData.militaryGripScale - newHand.userData.militaryGripScale) < 1e-5);
assert.ok(newHand.localToWorld(offsetMilitaryHandGrip(newHand, new THREE.Vector3())).distanceTo(oldHand.getWorldPosition(new THREE.Vector3())) < 1e-6);

const equipment = createMilitaryEquipmentSources();
for (const kind of ['sidearm-shield', 'bow', 'crossbow'] as const) {
  const widths = [];
  for (const gltf of [oldGltf, newGltf]) {
    const model = clone(gltf.scene) as THREE.Group, mesh = firstMesh(model);
    model.scale.setScalar(1.72 / new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y);
    const rig = bindCombatWeaponRig(model, kind, attachMilitaryEquipment(model, equipment[kind]))!;
    applyMilitaryCarryPose(rig, kind, 'walk'); model.updateMatrixWorld(true);
    const repair = source.doc.meshes[0].extras.elbowRepair;
    let maxEdge = 0;
    for (let i = repair.originalTriangles * 3; i < oldMesh.geometry.index!.count; i += 3) {
      const face = [0, 1, 2].map(c => oldMesh.geometry.index!.getX(i + c));
      if (!face.every(v => oldMesh.geometry.getAttribute('position').getX(v) > 0)) continue;
      for (let c = 0; c < 3; c++) maxEdge = Math.max(maxEdge, mesh.getVertexPosition(face[c]!, new THREE.Vector3())
        .distanceTo(mesh.getVertexPosition(face[(c + 1) % 3]!, new THREE.Vector3())) * model.scale.x);
    }
    widths.push(maxEdge);
  }
  assert.ok(widths[1]! < widths[0]! * .6, `${kind}: the stretched elbow gap was not reduced`);
  console.log(`${kind}: longest connector edge ${(widths[0]! * 1000).toFixed(1)} -> ${(widths[1]! * 1000).toFixed(1)} mm`);
}
console.log(`${preservedTracks} unrelated animation tracks, original timing, mesh shape, texture bytes and palm/finger references preserved.`);
