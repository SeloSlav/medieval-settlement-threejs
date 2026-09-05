import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { meleePalmLocal } from '../src/settlement/meleeHandGrip.ts';
import { applyCombatWeaponPose, bindCombatWeaponRig, resetCombatWeaponRig, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources, setMilitaryEquipmentCombatStance } from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string) {} } });
const sources = createMilitaryEquipmentSources();
const position = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3());
for (const name of ['worker-male-common-01-v002', 'ottoman-raider-common-01-v001']) {
  const bytes = readFileSync(`public/assets/models/villagers/${name}.glb`);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  installMilitaryHandGrip(gltf.scene);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  for (const kind of ['spear', 'pike-kit'] as const) for (const [height, yaw] of [[1.65, .7], [1.72, 0], [1.79, 2.5]]) {
    const model = clone(gltf.scene) as THREE.Group;
    model.scale.setScalar(height / bounds.getSize(new THREE.Vector3()).y);
    model.rotation.y = yaw;
    model.updateMatrixWorld(true);
    const equipment = attachMilitaryEquipment(model, sources[kind]);
    const rig = bindCombatWeaponRig(model, kind, equipment)!;
    const duration = resolveCombatWeaponPresentation(kind, 1.5)!.attackSeconds;
    const inverse = model.getWorldQuaternion(new THREE.Quaternion()).invert();
    let maxWrist = 0, maxContactError = 0, minExtension = 1;
    let previous: THREE.Quaternion[] = [];
    const apply = (phase: number) => {
      resetCombatWeaponRig(rig);
      setMilitaryEquipmentCombatStance(equipment, 'melee');
      applyCombatWeaponPose(rig, { tool: kind, targetDistance: 1.5, attackCooldown: (1 - phase) * duration, dtSeconds: 0, logicalMode: 'fight' });
    };
    for (let frame = 0; frame <= 200; frame++) {
      const phase = frame / 200, label = `${name}/${kind}/${height}/${phase}`;
      apply(phase);
      const shoulder = position(rig.armBones.leftUpperArm), elbow = position(rig.armBones.leftForearm), wrist = position(rig.armBones.leftHand);
      const upper = elbow.clone().sub(shoulder), lower = wrist.clone().sub(elbow);
      const extension = shoulder.distanceTo(wrist) / (upper.length() + lower.length());
      minExtension = Math.min(minExtension, extension);
      assert.ok(extension > .985 && extension < 1, `${label}: the guiding arm stays long with a soft elbow`);
      const bodyUpper = upper.clone().applyQuaternion(inverse);
      assert.ok(bodyUpper.y < -.22 * upper.length(), `${label}: the upper arm must slope down from the shoulder, not across the chest`);
      assert.ok(bodyUpper.z > .15 * upper.length(), `${label}: the elbow must stay in front of the shoulder`);
      const reach = wrist.clone().sub(shoulder).normalize();
      const bend = upper.clone().addScaledVector(reach, -upper.dot(reach)).applyQuaternion(inverse);
      assert.ok(bend.y < 0, `${label}: the elbow must bend below the reach line`);
      const hand = rig.armBones.leftHand;
      const handForward = new THREE.Vector3(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
      maxWrist = Math.max(maxWrist, handForward.angleTo(lower));
      assert.ok(handForward.angleTo(lower) < .25, `${label}: wrist must follow the forearm without folding inward`);
      const palm = hand.localToWorld(meleePalmLocal(hand, true, new THREE.Vector3()));
      const local = equipment.worldToLocal(palm.clone());
      const contact = equipment.localToWorld(new THREE.Vector3(0, local.y, 0));
      maxContactError = Math.max(maxContactError, contact.distanceTo(palm));
      assert.ok(contact.distanceTo(palm) < .001, `${label}: palm must contact the actual shaft within 1 mm`);
      const drivingHand = equipment.localToWorld(new THREE.Vector3(...equipment.userData.workerToolGripLocal));
      assert.ok(contact.distanceTo(drivingHand) > .15 && local.y < 1.2, `${label}: guiding hand must be ahead of the driving hand on the wood`);
      const rotations = rig.ownedBones.map(b => b.getWorldQuaternion(new THREE.Quaternion()));
      if (previous.length) rotations.forEach((q, i) => assert.ok(q.angleTo(previous[i]!) < .22, `${label}/${rig.ownedBones[i]!.name}: joint must not invert`));
      previous = rotations;
      if ([0, 80, 166, 200].includes(frame)) {
        const rightBones = [rig.armBones.rightClavicle, rig.armBones.rightUpperArm, rig.armBones.rightForearm, rig.armBones.rightHand];
        const rightPose = rightBones.map(b => b.matrixWorld.clone());
        const weaponPose = equipment.matrixWorld.clone();
        const support = equipment.userData.workerToolSupportGripLocal;
        delete equipment.userData.workerToolSupportGripLocal;
        apply(phase);
        const same = (a: THREE.Matrix4, b: THREE.Matrix4) => a.elements.every((v, i) => Math.abs(v - b.elements[i]!) < 1e-6);
        rightBones.forEach((b, i) => assert.ok(same(b.matrixWorld, rightPose[i]!), `${label}: support solve must preserve the driving arm`));
        assert.ok(same(equipment.matrixWorld, weaponPose), `${label}: support solve must preserve the weapon trajectory`);
        equipment.userData.workerToolSupportGripLocal = support;
      }
    }
    console.log(`${name}/${kind}/${height}: 201 poses; extension ${(minExtension * 100).toFixed(2)}%, wrist ${(maxWrist * 180 / Math.PI).toFixed(2)}°, contact ${(maxContactError * 1000).toFixed(3)} mm`);
  }
}
