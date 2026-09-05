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
const source = createMilitaryEquipmentSources().crossbow;
for (const name of ['worker-male-common-01-v002', 'ottoman-raider-common-01-v001']) {
  const bytes = readFileSync(`public/assets/models/villagers/${name}.glb`);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  installMilitaryHandGrip(gltf.scene);
  let maxWristAngle = 0, maxJointStep = 0;
  for (const mode of ['idle', 'walk', 'run']) {
    const clip = gltf.animations.find(c => c.name.toLowerCase() === mode)
      ?? gltf.animations.find(c => c.name.toLowerCase().includes(mode));
    assert.ok(clip, `${name}: missing ${mode} clip`);
    const model = clone(gltf.scene) as THREE.Group;
    // Exercise facing independence as well as the actual locomotion clip.
    model.rotation.y = .73; model.scale.setScalar(.87);
    const equipment = attachMilitaryEquipment(model, source);
    const rig = bindCombatWeaponRig(model, 'crossbow', equipment)!;
    const mixer = new THREE.AnimationMixer(model); mixer.clipAction(clip).play();
    const { rightUpperArm: upper, rightForearm: forearm, rightHand: hand } = rig.armBones;
    const joints = [upper, forearm, hand, ...rig.twistBones.right];
    let previous: THREE.Quaternion[] | undefined;
    for (let frame = 0; frame <= 120; frame++) {
      restoreCombatWeaponPose(rig); mixer.setTime(frame / 120 * clip.duration);
      const before = rig.ownedBones.map(b => b.quaternion.clone());
      const mountPosition = equipment.position.clone(), mountRotation = equipment.quaternion.clone();
      assert.ok(applyMilitaryCarryPose(rig, 'crossbow', mode));
      const shoulder = upper.getWorldPosition(new THREE.Vector3());
      const elbow = forearm.getWorldPosition(new THREE.Vector3());
      const wrist = hand.getWorldPosition(new THREE.Vector3());
      const upperDirection = elbow.clone().sub(shoulder).normalize();
      const lowerDirection = wrist.clone().sub(elbow).normalize();
      const handWorld = hand.getWorldQuaternion(new THREE.Quaternion());
      const fingers = new THREE.Vector3(0, 1, 0).applyQuaternion(handWorld);
      const wristAngle = lowerDirection.angleTo(fingers);
      maxWristAngle = Math.max(maxWristAngle, wristAngle);
      assert.ok(wristAngle < .02, `${name}/${mode}/${frame}: wrist folds away from forearm`);
      const outward = new THREE.Vector3(-1, 0, 0).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()));
      const palmBack = new THREE.Vector3(1, 0, 0).applyQuaternion(handWorld);
      assert.ok(palmBack.dot(outward) > Math.SQRT1_2, `${name}/${mode}/${frame}: palm flips onto the wrong side of the stock`);
      const bend = lowerDirection.clone().addScaledVector(upperDirection, -lowerDirection.dot(upperDirection)).normalize()
        .applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()).invert());
      assert.ok(bend.z > .99, `${name}/${mode}/${frame}: elbow bends against its anatomical hinge`);
      if (previous) joints.forEach((bone, index) => {
        const step = bone.quaternion.angleTo(previous![index]!);
        maxJointStep = Math.max(maxJointStep, step);
        assert.ok(step < .15, `${name}/${mode}/${frame}/${bone.name}: arm flips between adjacent frames`);
      });
      previous = joints.map(b => b.quaternion.clone());
      restoreCombatWeaponPose(rig);
      rig.ownedBones.forEach((b, i) => assert.deepEqual(b.quaternion.toArray(), before[i]!.toArray(), `${b.name}: carry rotation leaked`));
      assert.deepEqual(equipment.position.toArray(), mountPosition.toArray(), 'carry mount position leaked');
      assert.deepEqual(equipment.quaternion.toArray(), mountRotation.toArray(), 'carry mount rotation leaked');
    }
  }
  console.log(`${name}: 363 idle/walk/run poses; max wrist bend ${THREE.MathUtils.radToDeg(maxWristAngle).toFixed(3)}°, max joint step ${THREE.MathUtils.radToDeg(maxJointStep).toFixed(3)}°; grip side, elbow hinge and restoration passed.`);
}
