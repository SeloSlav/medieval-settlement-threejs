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
  for (const kind of ['spear', 'pike-kit'] as const) {
    const model = clone(gltf.scene) as THREE.Group;
    model.scale.setScalar(1.72 / bounds.getSize(new THREE.Vector3()).y);
    model.updateMatrixWorld(true);
    const equipment = attachMilitaryEquipment(model, sources[kind]);
    const rig = bindCombatWeaponRig(model, kind, equipment)!;
    const duration = resolveCombatWeaponPresentation(kind, 1.5)!.attackSeconds;
    for (const phase of [0, .12, .4, .56, .83, .92]) {
      resetCombatWeaponRig(rig);
      setMilitaryEquipmentCombatStance(equipment, 'melee');
      applyCombatWeaponPose(rig, { tool: kind, targetDistance: 1.5, attackCooldown: (1 - phase) * duration, dtSeconds: 0, logicalMode: 'fight' });
      const shoulder = position(rig.armBones.leftUpperArm), elbow = position(rig.armBones.leftForearm), wrist = position(rig.armBones.leftHand);
      const upper = elbow.clone().sub(shoulder), lower = wrist.clone().sub(elbow);
      const point = (v: THREE.Vector3) => v.toArray().map(v => +v.toFixed(3));
      console.log(name, kind, phase, JSON.stringify({ shoulder: point(shoulder), elbow: point(elbow), wrist: point(wrist), flex: THREE.MathUtils.radToDeg(upper.angleTo(lower)), extension: shoulder.distanceTo(wrist) / (upper.length() + lower.length()), grip: equipment.userData.workerToolSupportGripLocal }));
    }
  }
}
