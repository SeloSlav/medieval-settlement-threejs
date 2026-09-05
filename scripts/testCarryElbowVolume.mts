import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { applyMilitaryCarryPose, bindCombatWeaponRig, restoreCombatWeaponPose } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources } from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string) {} } });
const bytes = readFileSync('public/assets/models/villagers/worker-male-common-01-v002.glb');
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
installMilitaryHandGrip(gltf.scene);
const sources = createMilitaryEquipmentSources();
const generated = new Set<THREE.BufferGeometry>();
let checks = 0, maxGap = 0;
for (const kind of ['sidearm-shield', 'spear-shield', 'sword-shield', 'bow'] as const) {
  const model = clone(gltf.scene) as THREE.Group;
  model.scale.setScalar(1.7); model.rotation.y = .72;
  const rig = bindCombatWeaponRig(model, kind, attachMilitaryEquipment(model, sources[kind]))!;
  const surface = rig.carryElbowSurfaces[0]!;
  assert.ok(surface);
  const mesh = surface.mesh, source = surface.source, position = source.getAttribute('position');
  const index = source.index!;
  const key = (i: number) => new THREE.Vector3().fromBufferAttribute(position, i).toArray().map(v => v.toFixed(7)).join(',');
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < index.count; i += 3) {
    const face = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    if (!face.every(v => v >= surface.originalVertices && position.getX(v) > 0)) continue;
    for (let j = 0; j < 3; j++) {
      const a = face[j]!, b = face[(j + 1) % 3]!, id = [key(a), key(b)].sort().join('/');
      const edge = edges.get(id) ?? { a, b, count: 0 }; edge.count++; edges.set(id, edge);
    }
  }
  const boundary = [...edges.values()].filter(e => e.count === 1);
  assert.equal(boundary.length, 25);
  const borderVertices: number[] = [];
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(gltf.animations.find(c => c.name === 'walk')!).play();
  for (let frame = 0; frame <= 60; frame++) {
    restoreCombatWeaponPose(rig); mixer.setTime(frame / 60);
    applyMilitaryCarryPose(rig, kind, frame % 2 ? 'walk' : 'idle'); model.updateMatrixWorld(true);
    const rounded = mesh.geometry;
    assert.notEqual(rounded, source);
    generated.add(rounded);
    assert.equal(mesh.material, surface.mesh.material);
    const rim = boundary.map(e => new THREE.Line3(mesh.getVertexPosition(e.a, new THREE.Vector3()), mesh.getVertexPosition(e.b, new THREE.Vector3())));
    const nearestRim = (p: THREE.Vector3) => Math.min(...rim.map(edge => edge.closestPointToPoint(p, true, new THREE.Vector3()).distanceTo(p)));
    if (frame === 0) {
      for (const [name, attribute] of Object.entries(source.attributes)) assert.deepEqual(
        rounded.getAttribute(name).array.slice(0, attribute.array.length), attribute.array,
        `${kind}: source ${name} changed outside the added surface`);
      const normal = rounded.getAttribute('normal');
      for (let v = position.count; v < normal.count; v++) {
        const p = mesh.getVertexPosition(v, new THREE.Vector3());
        assert.ok(p.toArray().every(Number.isFinite));
        assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(normal, v).length() - 1) < 1e-6);
        if (nearestRim(p) < 1e-6) borderVertices.push(v);
      }
      assert.ok(borderVertices.length >= 50, 'subdivided patch retains its rim');
      const finalIndex = rounded.index!;
      let area = 0;
      for (let i = finalIndex.count - 336 * 3; i < finalIndex.count; i += 3) {
        const a = mesh.getVertexPosition(finalIndex.getX(i), new THREE.Vector3());
        const b = mesh.getVertexPosition(finalIndex.getX(i + 1), new THREE.Vector3());
        const c = mesh.getVertexPosition(finalIndex.getX(i + 2), new THREE.Vector3());
        const triangleArea = b.sub(a).cross(c.sub(a)).length() / 2;
        assert.ok(triangleArea > 1e-13, 'rounded patch has no degenerate triangles'); area += triangleArea;
      }
      assert.ok(area > 0);
      console.log(`${kind}: ${rounded.userData.carryElbowVolume.addedVertices} added vertices, 315 extra triangles, ${(rounded.userData.carryElbowVolume.depth * 1.7 * 1000).toFixed(1)} mm maximum profile depth`);
    }
    for (const v of borderVertices) {
      const gap = nearestRim(mesh.getVertexPosition(v, new THREE.Vector3())); maxGap = Math.max(maxGap, gap);
      assert.ok(gap < 1e-5, `${kind}/${frame}: patch separated from cuff or bracer by ${gap}`);
    }
    restoreCombatWeaponPose(rig); assert.equal(mesh.geometry, source); checks++;
  }
}
assert.equal(generated.size, 2, 'shield variants share one surface; bow carry has its own');
console.log(`${checks} walking/idle surface checks passed; maximum rim gap ${(maxGap * 1000).toFixed(5)} mm in model coordinates.`);
