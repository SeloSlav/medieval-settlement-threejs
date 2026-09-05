import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { applyCombatWeaponPose, applyMilitaryCarryPose, bindCombatWeaponRig, restoreCombatWeaponPose, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources } from '../src/settlement/militaryEquipment.ts';
import { createShieldArmStrap, shieldHandFit, SHIELD_HANDLE_RADII } from '../src/settlement/shieldGrip.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string) {} } });
const sources = createMilitaryEquipmentSources();
let poses = 0, surfaceSamples = 0;
for (const name of ['worker-male-common-01-v002', 'ottoman-raider-common-01-v001']) {
  const bytes = readFileSync(`public/assets/models/villagers/${name}.glb`);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  installMilitaryHandGrip(gltf.scene);
  const height = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
  for (const kind of ['spear-shield', 'sidearm-shield', 'sword-shield'] as const) {
    const model = clone(gltf.scene) as THREE.Group;
    model.scale.setScalar(1.72 / height); model.updateMatrixWorld(true);
    const equipment = attachMilitaryEquipment(model, sources[kind]);
    const rig = bindCombatWeaponRig(model, kind, equipment)!;
    const shield = rig.shieldMount!;
    assert.ok(shield);
    const mountPosition = shield.position.clone(), mountRotation = shield.quaternion.clone();
    const skins: { mesh: THREE.SkinnedMesh; vertices: Map<number, number>; faces: number[][] }[] = [];
    model.traverse(object => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const joints = object.geometry.getAttribute('skinIndex'), weights = object.geometry.getAttribute('skinWeight');
      const vertices = new Map<number, number>();
      for (let i = 0; i < joints.count; i++) for (let slot = 0; slot < 4; slot++) {
        const finger = rig.leftGripBones.indexOf(object.skeleton.bones[joints.getComponent(i, slot)]!);
        if (finger >= 0 && weights.getComponent(i, slot) > .35) vertices.set(i, Math.floor(finger / 2));
      }
      const index = object.geometry.index!, faces: number[][] = [];
      for (let i = 0; i < index.count; i += 3) {
        const face = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        if (face.every(v => vertices.has(v))) faces.push(face);
      }
      skins.push({ mesh: object, vertices, faces });
    });
    let worstOverlap = 0, worstGap = 0, minPalm = 1, maxWrist = 0;
    const duration = resolveCombatWeaponPresentation(kind, 8)!.attackSeconds;
    for (const mode of ['attack', 'idle', 'walk', 'run', 'flee', 'hurt']) for (let frame = 0; frame <= (mode === 'attack' ? 100 : 0); frame++) {
      const before = rig.ownedBones.map(b => b.quaternion.toArray());
      if (mode === 'attack') applyCombatWeaponPose(rig, { tool: kind, targetDistance: 8, attackCooldown: (1 - frame / 100) * duration, dtSeconds: 0, logicalMode: 'fight' });
      else applyMilitaryCarryPose(rig, kind, mode);
      model.updateWorldMatrix(true, true);
      const hand = rig.armBones.leftHand;
      const handRotation = hand.getWorldQuaternion(new THREE.Quaternion());
      const elbow = rig.armBones.leftForearm.getWorldPosition(new THREE.Vector3());
      const wrist = hand.getWorldPosition(new THREE.Vector3());
      const forearm = wrist.clone().sub(elbow).normalize();
      const wristAngle = forearm.angleTo(new THREE.Vector3(0, 1, 0).applyQuaternion(handRotation));
      maxWrist = Math.max(maxWrist, wristAngle);
      assert.ok(wristAngle < .001, `${kind}/${mode}: shield wrist folds instead of following the forearm`);
      const palm = new THREE.Vector3(1, 0, 0).applyQuaternion(handRotation);
      minPalm = Math.min(minPalm, palm.dot(new THREE.Vector3(0, 0, -1).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()))));
      assert.ok(minPalm > .85, 'shield palm faces inward while the shield covers the front quarter');
      const grip = shield.localToWorld(new THREE.Vector3(...shield.userData.shieldGripLocal));
      assert.ok(grip.distanceTo(hand.localToWorld(new THREE.Vector3(...shieldHandFit(hand).palm))) < 1e-6, 'hand stays on the authored rear grip');
      assert.ok(elbow.y < rig.armBones.leftUpperArm.getWorldPosition(new THREE.Vector3()).y - .1, 'elbow stays below the shoulder');
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(shield.matrixWorld);
      assert.ok(Math.abs(forearm.dot(normal)) < .001, 'forearm lies across the shield plane');
      if (mode !== 'attack' || frame % 50 === 0) {
        const inverse = shield.matrixWorld.clone().invert(), center = new THREE.Vector3(...shield.userData.shieldGripLocal);
        const contacts = [Infinity, Infinity, Infinity, Infinity, Infinity];
        const inspect = (p: THREE.Vector3, finger: number) => {
          surfaceSamples++;
          p.applyMatrix4(inverse).sub(center);
          if (Math.abs(p.y) > .06) return;
          const radius = Math.hypot(p.x / SHIELD_HANDLE_RADII[0], p.z / SHIELD_HANDLE_RADII[1]);
          const gap = (radius - 1) * Math.min(...SHIELD_HANDLE_RADII);
          worstOverlap = Math.max(worstOverlap, -gap);
          contacts[finger] = Math.min(contacts[finger]!, Math.abs(gap));
        };
        for (const skin of skins) {
          const deformed = new Map<number, THREE.Vector3>();
          for (const [i, finger] of skin.vertices) {
            const p = skin.mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(skin.mesh.matrixWorld);
            deformed.set(i, p); inspect(p.clone(), finger);
          }
          for (const face of skin.faces) inspect(deformed.get(face[0]!)!.clone().add(deformed.get(face[1]!)!).add(deformed.get(face[2]!)!).divideScalar(3), skin.vertices.get(face[0]!)!);
        }
        worstGap = Math.max(worstGap, ...contacts.slice(0, 4));
      }
      restoreCombatWeaponPose(rig);
      assert.deepEqual(shield.position.toArray(), mountPosition.toArray(), 'restore shield position when overlay exits');
      assert.deepEqual(shield.quaternion.toArray(), mountRotation.toArray(), 'restore shield orientation when overlay exits');
      rig.ownedBones.forEach((bone, i) => assert.deepEqual(bone.quaternion.toArray(), before[i], 'restore the civilian/base animation pose'));
      poses++;
    }
    console.log(`${name}/${kind}: wrist ${(maxWrist * 180 / Math.PI).toFixed(3)}deg; finger gap ${(worstGap * 1000).toFixed(2)}mm; overlap ${(worstOverlap * 1000).toFixed(2)}mm`);
  }
}
const strap = createShieldArmStrap(), position = strap.getAttribute('position'), index = strap.index!;
let volume = 0;
for (let i = 0; i < index.count; i += 3) {
  const [a, b, c] = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(position, index.getX(i + j)));
  volume += a!.dot(b!.clone().cross(c!)) / 6;
}
assert.ok(volume > 0, 'leather strap must have outward faces and positive closed volume');
assert.ok(index.count / 3 < 60, 'strap keeps a small geometry budget');
strap.dispose();
console.log(`Shield poses verified: ${poses} poses, ${surfaceSamples} hand surface samples.`);
