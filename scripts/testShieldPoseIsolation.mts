import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as current from '../src/settlement/combatWeaponAnimation.ts';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources, setMilitaryEquipmentCombatStance } from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string) {} } });
const fixturePath = resolve('scripts/fixtures/shield-pose-isolation.json');
const sources = createMilitaryEquipmentSources();
const recordIndex = process.argv.indexOf('--record-reference');
const reference = recordIndex < 0 ? null : process.argv[recordIndex + 1];
const temporaryPath = resolve('src/settlement/.shield-pose-reference.ts');
let api = current;
try {
  if (reference) {
    writeFileSync(temporaryPath, execFileSync('git', ['show', `${reference}:src/settlement/combatWeaponAnimation.ts`], { encoding: 'utf8' }));
    api = await import(pathToFileURL(temporaryPath).href);
  }
  const hashes: Record<string, string> = {};
  let poses = 0;
  for (const name of ['worker-male-common-01-v002', 'ottoman-raider-common-01-v001']) {
    const bytes = readFileSync(`public/assets/models/villagers/${name}.glb`);
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    installMilitaryHandGrip(gltf.scene);
    const height = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
    for (const kind of Object.keys(sources) as (keyof typeof sources)[]) {
      const model = clone(gltf.scene) as THREE.Group;
      model.scale.setScalar(1.72 / height); model.rotation.y = .37; model.updateMatrixWorld(true);
      const equipment = attachMilitaryEquipment(model, sources[kind]);
      const rig = api.bindCombatWeaponRig(model, kind, equipment)!;
      const allBones: THREE.Bone[] = [];
      model.traverse(b => { if (b instanceof THREE.Bone) allBones.push(b); });
      const originalGeometry = new Map<THREE.SkinnedMesh, THREE.BufferGeometry>();
      model.traverse(mesh => { if (mesh instanceof THREE.SkinnedMesh) originalGeometry.set(mesh, mesh.geometry); });
      const mixer = new THREE.AnimationMixer(model);
      for (const mode of ['idle', 'walk', 'run', 'flee', 'hurt', 'fall', 'attack', 'hit', 'fallback', 'standard-walk', 'standard-attack']) {
        const standard = mode.startsWith('standard-');
        const combat = ['attack', 'hit', 'fallback', 'standard-attack'].includes(mode);
        const clipName = combat ? 'slash' : mode === 'hurt' ? 'hit_to_body_01' : mode === 'flee' ? 'flee_01' : standard ? 'walk' : mode;
        const clip = gltf.animations.find(c => c.name === clipName)!;
        assert.ok(clip, `${name}: ${clipName}`);
        mixer.stopAllAction(); mixer.clipAction(clip).reset().play();
        const presentation = api.resolveCombatWeaponPresentation(kind, mode === 'fallback' ? 1.5 : 8)!;
        const hash = createHash('sha256');
        for (let frame = 0; frame <= 40; frame++) {
          api.restoreCombatWeaponPose(rig); mixer.setTime(frame / 40 * clip.duration);
          setMilitaryEquipmentCombatStance(equipment, presentation.stance);
          if (combat) api.applyCombatWeaponPose(rig, { tool: kind, targetDistance: mode === 'fallback' ? 1.5 : 8,
            attackCooldown: (1 - frame / 40) * presentation.attackSeconds, dtSeconds: 0, logicalMode: mode === 'hit' ? 'hurt' : 'fight' });
          else api.applyMilitaryCarryPose(rig, kind, standard ? 'walk' : mode);
          if (standard) api.applyCompanyStandardBearerPose(rig);
          model.updateMatrixWorld(true);
          // The user approved the mirrored shield pose before requesting
          // fuller elbow surfaces. Every bone and mount is now locked too.
          const roundedCarry = !standard && (Boolean(rig.shieldMount) && mode !== 'fall'
            || kind === 'bow' && ['idle', 'walk'].includes(mode));
          if (!roundedCarry) for (const [mesh, geometry] of originalGeometry) assert.equal(mesh.geometry, geometry,
            `${kind}/${mode}: a carry surface leaked into a protected animation`);
          const mounts = equipment.userData.workerToolMounts as THREE.Group[];
          const values = [...allBones.flatMap(b => [...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()]),
            ...mounts.flatMap(m => [...m.matrixWorld.elements, Number(m.visible)])];
          // Ignore floating-point noise below a hundred-millionth of a unit.
          hash.update(values.map(v => (Math.round(v * 1e8) / 1e8).toString()).join(',')); hash.update('\n');
          poses++;
        }
        api.restoreCombatWeaponPose(rig);
        hashes[`${name}/${kind}/${mode}`] = hash.digest('hex');
      }
    }
  }
  if (reference) {
    writeFileSync(fixturePath, JSON.stringify({ reference, poses, hashes }, null, 2) + '\n');
    console.log(`Recorded ${poses} protected poses from ${reference}.`);
  } else {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    assert.equal(poses, fixture.poses);
    for (const [key, hash] of Object.entries(hashes)) assert.equal(hash, fixture.hashes[key], `${key}: a pose outside the shield arm changed`);
    assert.equal(Object.keys(hashes).length, Object.keys(fixture.hashes).length);
    console.log(`${poses} complete poses match the approved baseline: all bones and mounts, including shield arms, bow/crossbow cycles, falls, melee fallback and standards. Geometry overrides remain confined to their requested carries.`);
  }
} finally { if (reference) unlinkSync(temporaryPath); }
