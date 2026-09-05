import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { applyCombatWeaponPose, bindCombatWeaponRig, resetCombatWeaponRig, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources, setMilitaryEquipmentCombatStance } from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string) {} } });
const sources = createMilitaryEquipmentSources();
const position = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3());
let poses = 0;
for (const name of ['worker-male-common-01-v002', 'ottoman-raider-common-01-v001']) {
  const bytes = readFileSync(`public/assets/models/villagers/${name}.glb`);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  installMilitaryHandGrip(gltf.scene);
  const height = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
  for (const kind of ['sidearm', 'sidearm-shield', 'sword-shield', 'halberd'] as const) {
    for (const [scale, yaw] of [[.96, .7], [1, 0], [1.04, 2.5]]) for (const mounted of kind === 'halberd' ? [false] : [false, true]) {
      const model = clone(gltf.scene) as THREE.Group;
      model.scale.setScalar(1.72 * scale / height); model.rotation.y = yaw; model.updateMatrixWorld(true);
      const equipment = attachMilitaryEquipment(model, sources[kind]);
      const rig = bindCombatWeaponRig(model, kind, equipment)!;
      const duration = resolveCombatWeaponPresentation(kind, 1.5)!.attackSeconds;
      const inverse = model.getWorldQuaternion(new THREE.Quaternion()).invert();
      for (const defensive of kind.endsWith('shield') ? [false, true] : [false]) {
        let previousEdge: THREE.Vector3 | undefined;
        let previous: THREE.Quaternion[] = [];
        let shieldAtContact: THREE.Vector3 | undefined;
        for (let frame = 0; frame <= 200; frame++) {
          resetCombatWeaponRig(rig); setMilitaryEquipmentCombatStance(equipment, 'melee');
          const phase = frame / 200, label = `${name}/${kind}/${scale}/${mounted}/${defensive}/${phase}`;
          applyCombatWeaponPose(rig, { tool: kind, targetDistance: 1.5, attackCooldown: (1 - phase) * duration, logicalMode: 'fight', dtSeconds: 0, mounted, defensive });
          const shoulder = position(rig.armBones.rightUpperArm), elbow = position(rig.armBones.rightForearm), wrist = position(rig.armBones.rightHand);
          const upper = elbow.clone().sub(shoulder), lower = wrist.clone().sub(elbow);
          const handForward = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.armBones.rightHand.getWorldQuaternion(new THREE.Quaternion()));
          assert.ok(handForward.angleTo(lower) < .26, `${label}: the weapon wrist must stay aligned`);
          if (!defensive && kind !== 'halberd') {
            const reachDirection = wrist.clone().sub(shoulder).normalize().applyQuaternion(inverse);
            if (reachDirection.y > .45 && phase >= .76 && phase <= .87) {
              const hand = rig.armBones.rightHand.quaternion;
              const roll = 2 * Math.atan2(hand.y, hand.w);
              assert.ok(Math.abs(Math.atan2(Math.sin(roll), Math.cos(roll))) < .05,
                `${label}: the raised arm must turn with its palm, without winding up the wrist`);
            }
            if (upper.angleTo(lower) > .01) {
              const u = upper.clone().normalize(), f = lower.clone().normalize();
              const bend = f.addScaledVector(u, -f.dot(u)).normalize()
                .applyQuaternion(rig.armBones.rightUpperArm.getWorldQuaternion(new THREE.Quaternion()).invert());
              assert.ok(bend.z > .99, `${label}: the elbow must bend through its anatomical hinge`);
            }
            if (kind.endsWith('shield')) {
              const shieldReach = position(rig.armBones.leftHand).sub(position(rig.armBones.leftUpperArm)).applyQuaternion(inverse);
              if (frame === 0) shieldAtContact = shieldReach;
              if (frame === 100) {
                const displacement = shieldAtContact!.clone().sub(shieldReach);
                assert.ok(displacement.x > .08 * scale && displacement.x < .15 * scale,
                  `${label}: the shield hand must move modestly toward the soldier's left during the cut`);
                assert.ok(displacement.y < -.07 * scale && displacement.y > -.14 * scale,
                  `${label}: the shield hand must lower during the cut and return in recovery`);
                assert.ok(Math.abs(displacement.z) < .001, `${label}: keep the shield in front of the body`);
              }
            }
          }
          if (defensive) {
            const palm = new THREE.Vector3(-1, 0, 0).applyQuaternion(rig.armBones.rightHand.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(inverse);
            assert.ok(palm.x > .65, `${label}: lowered weapon palm must face inward`);
            assert.ok(lower.clone().applyQuaternion(inverse).z > 0, `${label}: lowered forearm must flex forward from its elbow`);
            assert.ok(upper.clone().applyQuaternion(inverse).y < -.7 * upper.length(), `${label}: defensive upper arm hangs down`);
            const blade = new THREE.Vector3(0, 1, 0).transformDirection(equipment.matrixWorld).applyQuaternion(inverse);
            assert.ok(blade.y < -.35, `${label}: defensive blade must be lowered`);
          } else if (kind !== 'halberd' && (phase >= .82 || phase <= .15)) {
            const extension = shoulder.distanceTo(wrist) / (upper.length() + lower.length());
            assert.ok(extension > 1 - 1e-6, `${label}: the shoulder drives the cut with a straight elbow (${extension})`);
          }
          if (kind === 'halberd') {
            const leftElbow = position(rig.armBones.leftForearm).sub(rig.bodyCenter).applyQuaternion(inverse);
            assert.ok(leftElbow.x > .01, `${label}: support elbow must remain on its own side of the chest`);
            const leftLower = position(rig.armBones.leftHand).sub(position(rig.armBones.leftForearm));
            const leftForward = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.armBones.leftHand.getWorldQuaternion(new THREE.Quaternion()));
            assert.ok(leftForward.angleTo(leftLower) < .46, `${label}: support wrist cannot invert around the shaft`);
            const edge = equipment.localToWorld(new THREE.Vector3(.35, 1.37, 0));
            if (frame === 164) assert.ok(edge.y > position(model.getObjectByName('Head')!).y + .6 * scale, `${label}: the axe must start overhead`);
            if (previousEdge && (phase >= .88 || (phase > 0 && phase <= .10))) {
              const velocity = edge.clone().sub(previousEdge);
              const cuttingDirection = new THREE.Vector3(1, 0, 0).transformDirection(equipment.matrixWorld);
              const flatNormal = new THREE.Vector3(0, 0, 1).transformDirection(equipment.matrixWorld);
              assert.ok(velocity.y < 0, `${label}: the strike must travel downward`);
              assert.ok(cuttingDirection.dot(velocity.clone().normalize()) > .8, `${label}: lead with the axe edge`);
              assert.ok(Math.abs(flatNormal.dot(velocity.clone().normalize())) < .10, `${label}: do not strike with the flat of the axe`);
            }
            previousEdge = edge;
          }
          const rotations = rig.ownedBones.map(b => b.getWorldQuaternion(new THREE.Quaternion()));
          if (previous.length) rotations.forEach((q, i) => assert.ok(q.angleTo(previous[i]!) < .23, `${label}/${rig.ownedBones[i]!.name}: no joint inversion`));
          previous = rotations; poses++;
        }
      }
    }
  }
}
console.log(`${poses} melee poses passed: raised sword arm/palm alignment, straight downstrokes, outward/lowered shields, natural defensive elbows/palms, overhead edge-first halberd chops.`);
