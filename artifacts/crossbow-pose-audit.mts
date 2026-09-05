import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { applyCombatWeaponPose, applyMilitaryCarryPose, bindCombatWeaponRig, resetCombatWeaponRig, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources, setMilitaryEquipmentCombatStance } from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string) {} } });
const sources = createMilitaryEquipmentSources();
const snapshots: Record<string, number[]> = {};
for (const name of ['worker-male-common-01-v002', 'ottoman-raider-common-01-v001']) {
  const bytes = readFileSync(`public/assets/models/villagers/${name}.glb`);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  installMilitaryHandGrip(gltf.scene);
  const height = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
  for (const kind of Object.keys(sources) as (keyof typeof sources)[]) {
    const model = clone(gltf.scene) as THREE.Group;
    model.scale.setScalar(1.72 / height); model.updateMatrixWorld(true);
    const equipment = attachMilitaryEquipment(model, sources[kind]);
    const rig = bindCombatWeaponRig(model, kind, equipment)!;
    for (const mode of ['fight', 'fallback', 'hurt', 'walk', 'run', 'idle', 'flee', 'fall']) {
      const distance = mode === 'fallback' ? 1.5 : 8;
      const presentation = resolveCombatWeaponPresentation(kind, distance)!;
      for (let frame = 0; frame <= 100; frame++) {
        resetCombatWeaponRig(rig);
        setMilitaryEquipmentCombatStance(equipment, presentation.stance);
        if (['fight', 'fallback', 'hurt', 'fall'].includes(mode)) {
          applyCombatWeaponPose(rig, { tool: kind, targetDistance: distance, attackCooldown: (1 - frame / 100) * presentation.attackSeconds,
            dtSeconds: 0, logicalMode: mode === 'fallback' ? 'fight' : mode });
        } else applyMilitaryCarryPose(rig, kind, mode);
        model.updateMatrixWorld(true);
        // The crossbow attack owns the right arm only. Preserve all remaining
        // bones and world-space weapon/support transforms in that case, too.
        const changedArm = kind === 'crossbow' && (mode === 'fight' || mode === 'hurt');
        const bones = rig.ownedBones.filter(b => !changedArm || !(b.name.startsWith('R_') && b !== rig.armBones.rightClavicle));
        const mounts = equipment.userData.workerToolMounts as THREE.Group[];
        snapshots[`${name}/${kind}/${mode}/${frame}`] = [...bones.flatMap(b => [...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()]),
          ...mounts.flatMap(m => [...m.getWorldPosition(new THREE.Vector3()).toArray(), ...m.getWorldQuaternion(new THREE.Quaternion()).toArray()])];
        if (kind === 'crossbow' && mode === 'fight' && [0, 18, 50, 66, 72, 78, 82, 86, 95].includes(frame)) {
          const { rightUpperArm: upper, rightForearm: fore, rightHand: hand } = rig.armBones;
          const u = fore.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).normalize();
          const f = hand.getWorldPosition(new THREE.Vector3()).sub(fore.getWorldPosition(new THREE.Vector3())).normalize();
          const bend = f.clone().addScaledVector(u, -f.dot(u)).normalize().applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()).invert());
          const twist = fore.quaternion.clone().multiply(rig.referenceQuaternions.get(fore)!.clone().invert());
          console.log(name, frame, 'hinge', bend.toArray().map(n => +n.toFixed(3)), 'forearm twist', +(2 * Math.atan2(twist.y, twist.w) * 180 / Math.PI).toFixed(1));
        }
      }
    }
  }
}
const baselinePath = 'artifacts/crossbow-pose-baseline.json';
if (process.argv.includes('--record')) writeFileSync(baselinePath, JSON.stringify(snapshots));
else {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  let maxError = 0;
  for (const [key, values] of Object.entries(snapshots)) {
    const error = Math.max(...values.map((v, i) => Math.abs(v - baseline[key][i])));
    maxError = Math.max(error, maxError);
    assert.ok(error < 1e-10, `${key}: unrelated pose changed by ${error}`);
  }
  console.log(`${Object.keys(snapshots).length} poses preserve unrelated bones and weapon transforms; maximum numeric error ${maxError}.`);
}
