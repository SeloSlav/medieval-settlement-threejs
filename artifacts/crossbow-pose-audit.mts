import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import * as animation from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources, setMilitaryEquipmentCombatStance } from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string) {} } });
const sources = createMilitaryEquipmentSources();
const carryReferenceIndex = process.argv.indexOf('--carry-reference');
const carryReference = carryReferenceIndex >= 0 ? process.argv[carryReferenceIndex + 1] : undefined;
async function capture(api: typeof animation) {
const { applyCombatWeaponPose, applyMilitaryCarryPose, bindCombatWeaponRig, resetCombatWeaponRig, resolveCombatWeaponPresentation } = api;
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
        // Only the accepted crossbow arm corrections can differ. With a
        // pre-carry reference, firing is compared in full as well.
        const changedArm = kind === 'crossbow' && (carryReference
          ? ['walk', 'run', 'idle', 'flee'].includes(mode)
          : ['fight', 'hurt', 'walk', 'run', 'idle', 'flee'].includes(mode));
        const bones = rig.ownedBones.filter(b => !changedArm || !/^[RL]_/.test(b.name)
          || b === rig.armBones.rightClavicle || b === rig.armBones.leftClavicle);
        const mounts = equipment.userData.workerToolMounts as THREE.Group[];
        snapshots[`${name}/${kind}/${mode}/${frame}`] = [...bones.flatMap(b => [...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()]),
          ...mounts.filter(() => !changedArm)
            .flatMap(m => [...m.getWorldPosition(new THREE.Vector3()).toArray(), ...m.getWorldQuaternion(new THREE.Quaternion()).toArray()])];
        if (process.argv.includes('--diagnose') && kind === 'crossbow' && mode === 'fight' && [0, 18, 50, 66, 72, 78, 82, 86, 95].includes(frame)) {
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
return snapshots;
}
// Freeze the pre-correction implementation in an isolated module while both
// versions use the same current equipment/assets. Never replace live source.
const referenceSource = (carryReference ? readFileSync(carryReference, 'utf8')
  : execFileSync('git', ['show', '5474228e:src/settlement/combatWeaponAnimation.ts'], { encoding: 'utf8' }))
  .replaceAll("from './", "from '../src/settlement/");
const referencePath = resolve('artifacts/crossbow-reference.mts');
writeFileSync(referencePath, referenceSource);
try {
  const reference = await import(pathToFileURL(referencePath).href);
  const baseline = await capture(reference);
  const snapshots = await capture(animation);
  let maxError = 0;
  for (const [key, values] of Object.entries(snapshots)) {
    const error = Math.max(...values.map((v, i) => Math.abs(v - baseline[key][i])));
    maxError = Math.max(error, maxError);
    assert.ok(error < 1e-10, `${key}: unrelated pose changed by ${error}`);
  }
  console.log(`${Object.keys(snapshots).length} poses preserve unrelated bones and weapon transforms; maximum numeric error ${maxError}.`);
} finally { unlinkSync(referencePath); }
