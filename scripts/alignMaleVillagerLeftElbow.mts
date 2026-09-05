import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Correct the left hinge against the intact right arm. Rebuild from the
// original with --source-ref=b148ae849b71a06b48154aabdf8809f517949202.
// Write to an explicit output so the asset can be reviewed before replacement.
const sourcePath = 'public/assets/models/villagers/worker-male-common-01-v002.glb';
const output = process.argv[2] ?? 'artifacts/worker-left-elbow-aligned.glb';
const sourceRef = process.argv.find(arg => arg.startsWith('--source-ref='))?.slice('--source-ref='.length);
const bytes = sourceRef ? execFileSync('git', ['show', `${sourceRef}:${sourcePath}`], { maxBuffer: 16 * 1024 * 1024 }) : fs.readFileSync(sourcePath);
const jsonLength = bytes.readUInt32LE(12);
const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
const binary = bytes.subarray(28 + jsonLength);
assert.ok(!doc.meshes[0].extras.elbowAlignment, 'Use the original asset when rebuilding the alignment.');
Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const root = gltf.scene;
const bone = (name: string) => root.getObjectByName(name) as THREE.Bone;
const names = ['L_Upperarm', 'L_Forearm', 'L_Hand', 'L_UpperarmTwist01', 'L_UpperarmTwist02', 'L_ForearmTwist01', 'L_ForearmTwist02'];
const before = new Map(names.map(name => { const b = bone(name); return [name, { p: b.position.clone(), q: b.quaternion.clone() }]; }));
root.updateMatrixWorld(true);
const upper = bone('L_Upperarm'), forearm = bone('L_Forearm'), hand = bone('L_Hand');
const shoulder = upper.getWorldPosition(new THREE.Vector3());
const oldElbow = forearm.getWorldPosition(new THREE.Vector3());
const oldWrist = hand.getWorldPosition(new THREE.Vector3());
const elbow = bone('R_Forearm').getWorldPosition(new THREE.Vector3()); elbow.x *= -1;
const wrist = bone('R_Hand').getWorldPosition(new THREE.Vector3()); wrist.x *= -1;
const oldUpperWorld = upper.getWorldQuaternion(new THREE.Quaternion());
const oldForearmWorld = forearm.getWorldQuaternion(new THREE.Quaternion());
const oldHandWorld = hand.getWorldQuaternion(new THREE.Quaternion());
function orient(b: THREE.Bone, oldDirection: THREE.Vector3, newDirection: THREE.Vector3, oldWorld: THREE.Quaternion) {
  const world = new THREE.Quaternion().setFromUnitVectors(oldDirection.normalize(), newDirection.normalize()).multiply(oldWorld);
  b.quaternion.copy(b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(world).normalize();
  b.updateWorldMatrix(true, true);
}
orient(upper, oldElbow.clone().sub(shoulder), elbow.clone().sub(shoulder), oldUpperWorld);
forearm.position.copy(upper.worldToLocal(elbow.clone())); forearm.updateWorldMatrix(true, true);
orient(forearm, oldWrist.clone().sub(oldElbow), wrist.clone().sub(elbow), oldForearmWorld);
hand.position.copy(forearm.worldToLocal(wrist.clone()));
hand.quaternion.copy(forearm.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(oldHandWorld);
const upperRatio = shoulder.distanceTo(elbow) / shoulder.distanceTo(oldElbow);
const lowerRatio = elbow.distanceTo(wrist) / oldElbow.distanceTo(oldWrist);
for (const name of ['L_UpperarmTwist01', 'L_UpperarmTwist02']) bone(name).position.multiplyScalar(upperRatio);
for (const name of ['L_ForearmTwist01', 'L_ForearmTwist02']) bone(name).position.multiplyScalar(lowerRatio);
root.updateMatrixWorld(true);

const replacements = new Map<number, Buffer>();
function values(id: number): Float32Array {
  const accessor = doc.accessors[id], view = doc.bufferViews[accessor.bufferView];
  assert.equal(accessor.componentType, 5126); assert.equal(view.byteStride, undefined);
  const size = { VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type as 'VEC3' | 'VEC4' | 'MAT4'];
  const offset = view.byteOffset + (accessor.byteOffset ?? 0);
  const data = binary.subarray(offset, offset + accessor.count * size * 4);
  return new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}
function appendAccessor(old: number, data: THREE.TypedArray, count = doc.accessors[old].count): number {
  const bufferView = doc.bufferViews.length;
  doc.bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: data.byteLength });
  replacements.set(bufferView, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  const accessor = { ...doc.accessors[old], bufferView, byteOffset: 0, count };
  delete accessor.min; delete accessor.max;
  doc.accessors.push(accessor); return doc.accessors.length - 1;
}
const nodeIds = new Map<string, number>();
doc.nodes.forEach((node: { name?: string }, i: number) => { if (node.name) nodeIds.set(node.name, i); });
for (const name of names) {
  const b = bone(name), node = doc.nodes[nodeIds.get(name)!];
  node.translation = b.position.toArray(); node.rotation = b.quaternion.toArray();
}
// Palm/finger placement belongs to the mesh, not the elbow-to-wrist length.
// Preserve its authored frame when moving the wrist pivot proximally.
const gripOrigin = hand.worldToLocal(oldWrist.clone()).toArray();
doc.nodes[nodeIds.get('L_Hand')!].extras = { ...doc.nodes[nodeIds.get('L_Hand')!].extras, militaryGripOrigin: gripOrigin };
const inverseId = doc.skins[0].inverseBindMatrices, inverse = values(inverseId);
for (let i = 0; i < doc.skins[0].joints.length; i++) {
  const name = doc.nodes[doc.skins[0].joints[i]].name;
  if (names.includes(name)) bone(name).matrixWorld.clone().invert().toArray(inverse, i * 16);
}
doc.skins[0].inverseBindMatrices = appendAccessor(inverseId, inverse);
let retargeted = 0;
for (const animation of doc.animations) for (const channel of animation.channels) {
  const name = doc.nodes[channel.target.node].name, reference = before.get(name);
  if (!reference || channel.target.path === 'scale') continue;
  assert.equal(animation.channels.filter((c: { sampler: number }) => c.sampler === channel.sampler).length, 1);
  const sampler = animation.samplers[channel.sampler], data = values(sampler.output), b = bone(name);
  assert.notEqual(sampler.interpolation, 'CUBICSPLINE');
  if (channel.target.path === 'translation') {
    const delta = b.position.clone().sub(reference.p);
    for (let i = 0; i < data.length; i += 3) new THREE.Vector3().fromArray(data, i).add(delta).toArray(data, i);
  } else if (channel.target.path === 'rotation') {
    const correction = b.quaternion.clone().multiply(reference.q.clone().invert());
    for (let i = 0; i < data.length; i += 4) new THREE.Quaternion().fromArray(data, i).premultiply(correction).normalize().toArray(data, i);
  }
  sampler.output = appendAccessor(sampler.output, data); retargeted++;
}
// Seven source cuff faces carry brown atlas stains. Give only those faces
// their own UVs in the existing linen island; retain skin on the connector.
const linenFaces = [5468, 5469, 5510, 8930, 9901, 9902, 9943];
const primitive = doc.meshes[0].primitives[0];
const mesh = root.getObjectByName(doc.nodes.find((n: { mesh?: number }) => n.mesh === 0).name) as THREE.SkinnedMesh;
const attributes = { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight' } as const;
const arrays = Object.fromEntries(Object.entries(attributes).map(([semantic, attribute]) => {
  const accessor = doc.accessors[primitive.attributes[semantic]], view = doc.bufferViews[accessor.bufferView];
  const Type = accessor.componentType === 5121 ? Uint8Array : accessor.componentType === 5123 ? Uint16Array : Float32Array;
  const start = view.byteOffset + (accessor.byteOffset ?? 0);
  const data = binary.subarray(start, start + accessor.count * mesh.geometry.getAttribute(attribute).itemSize * Type.BYTES_PER_ELEMENT);
  return [semantic, Array.from(new Type(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)))];
}));
const indices = Array.from(mesh.geometry.index!.array);
for (const triangle of linenFaces) for (let corner = 0; corner < 3; corner++) {
  const src = indices[triangle * 3 + corner]!, vertex = arrays.POSITION!.length / 3;
  const p = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), src);
  assert.ok(p.x > .27 && p.x < .305 && p.y > .79, 'Only the left rolled cuff can receive linen UVs.');
  for (const [semantic, attribute] of Object.entries(attributes)) {
    const width = mesh.geometry.getAttribute(attribute).itemSize;
    if (semantic === 'TEXCOORD_0') arrays[semantic]!.push(.446 + (p.z + .02) * .2, .315 + (p.y - .81) * .3);
    else arrays[semantic]!.push(...arrays[semantic]!.slice(src * width, (src + 1) * width));
  }
  indices[triangle * 3 + corner] = vertex;
}
for (const [semantic, attribute] of Object.entries(attributes)) {
  const old = primitive.attributes[semantic], accessor = doc.accessors[old];
  const Type = accessor.componentType === 5121 ? Uint8Array : accessor.componentType === 5123 ? Uint16Array : Float32Array;
  const width = mesh.geometry.getAttribute(attribute).itemSize;
  primitive.attributes[semantic] = appendAccessor(old, new Type(arrays[semantic]!), arrays[semantic]!.length / width);
  if (semantic === 'POSITION') Object.assign(doc.accessors[primitive.attributes[semantic]], { min: accessor.min, max: accessor.max });
}
primitive.indices = appendAccessor(primitive.indices, new Uint16Array(indices), indices.length);
doc.meshes[0].extras.elbowAlignment = { sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  oldElbow: oldElbow.toArray(), elbow: elbow.toArray(), oldWrist: oldWrist.toArray(), wrist: wrist.toArray(), retargeted, linenFaces, gripOrigin };
const chunks: Buffer[] = []; let length = 0;
for (let i = 0; i < doc.bufferViews.length; i++) {
  const view = doc.bufferViews[i], data = replacements.get(i) ?? binary.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  view.byteOffset = length; view.byteLength = data.byteLength; chunks.push(data); length += data.length;
  const pad = (4 - length % 4) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
}
doc.buffers[0].byteLength = length;
const json = Buffer.from(JSON.stringify(doc)), padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + padded.length + length, 8);
header.writeUInt32LE(padded.length, 12); header.write('JSON', 16);
binHeader.writeUInt32LE(length); binHeader.write('BIN\0', 4);
fs.writeFileSync(output, Buffer.concat([header, padded, binHeader, ...chunks]));
console.log(JSON.stringify({ output, upperRatio, lowerRatio, retargeted, elbow: elbow.toArray(), wrist: wrist.toArray() }));
