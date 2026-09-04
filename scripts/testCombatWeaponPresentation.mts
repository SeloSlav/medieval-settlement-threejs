import assert from 'node:assert/strict';
import * as THREE from 'three';
import { banditOnTheftMission } from '../src/security/banditEquipment.ts';
import type { CombatAgentState } from '../src/security/combatAgents.ts';
import {
  applyCompanyStandardBearerPose,
  applyMilitaryCarryPose,
  applyCombatWeaponPose,
  bindCombatWeaponRig,
  disposeCombatWeaponRig,
  resolveCombatWeaponPresentation,
  restoreCombatWeaponPose,
  sampleCombatAttackTimeline,
} from '../src/settlement/combatWeaponAnimation.ts';
import {
  COMBAT_PROJECTILE_DRAW_CALL_BUDGET,
  CombatProjectileRenderer,
  sampleCombatProjectile,
} from '../src/settlement/CombatProjectileRenderer.ts';
import { combatBaseActionMode, type CrowdRenderAgent } from '../src/settlement/SettlementCrowdRenderer.ts';
import {
  attachMilitaryEquipment,
  createMilitaryEquipmentSources,
  disposeMilitaryEquipmentSource,
} from '../src/settlement/militaryEquipment.ts';

const bowPresentation = resolveCombatWeaponPresentation('bow', 12);
const crossbowPresentation = resolveCombatWeaponPresentation('crossbow', 12);
assert.equal(bowPresentation?.family, 'bow');
assert.equal(bowPresentation?.projectile, 'arrow');
assert.equal(crossbowPresentation?.family, 'crossbow');
assert.equal(crossbowPresentation?.projectile, 'bolt');
assert.equal(resolveCombatWeaponPresentation('bow', 2)?.family, 'sword-shield');
assert.equal(resolveCombatWeaponPresentation('crossbow', 2)?.ranged, false);

assert.ok(bowPresentation);
assert.equal(sampleCombatAttackTimeline(bowPresentation, 1.55, null).phase, 'reload');
assert.equal(sampleCombatAttackTimeline(bowPresentation, 0.8, null).phase, 'draw');
assert.equal(sampleCombatAttackTimeline(bowPresentation, 0.2, null).phase, 'aim');
const release = sampleCombatAttackTimeline(bowPresentation, 1.55, 0.04);
assert.equal(release.phase, 'release');
assert.equal(release.releaseEdge, true);

const sources = createMilitaryEquipmentSources();
const campBandit = {faction:'bandit',status:'holding',targetKind:'bandit-camp',x:0,z:0,
  homeX:0,homeZ:0,carryingLoot:false} as CombatAgentState;
assert.equal(banditOnTheftMission(campBandit),false);
assert.equal(banditOnTheftMission({...campBandit,status:'advancing',targetKind:'building'}),true,
  'the thief leaves the spear behind before walking away');
for (const status of ['fighting','returning','downed'] as const) {
  assert.equal(banditOnTheftMission({...campBandit,status,targetKind:'combat-agent'},true),true,
    'retargeting, escape or death must not make a spear reappear during the theft');
}
assert.equal(banditOnTheftMission({...campBandit,status:'fighting',x:40}),true,
  'reconnecting during a fight in town still shows the thief without a spear');
assert.equal(banditOnTheftMission(campBandit,true),false,'only returning to camp restores the spear');
assert.equal(banditOnTheftMission({...campBandit,faction:'spearman',status:'advancing'}),false);

for (const [kind, source] of Object.entries(sources)) {
  const model = createSemanticCombatRig();
  const legs = bone('Legs',0,0,0); model.add(legs);
  const tool = attachMilitaryEquipment(model,source);
  const rig = bindCombatWeaponRig(model,source.kind,tool)!;
  const primaryHand = source.kind === 'bow' ? rig.armBones.leftHand : rig.armBones.rightHand;
  const mountRotations: THREE.Quaternion[] = [];
  for (let frame=0;frame<32;frame++) {
    restoreCombatWeaponPose(rig);
    for (const arm of [rig.armBones.leftUpperArm,rig.armBones.rightUpperArm]) {
      arm.quaternion.setFromEuler(new THREE.Euler(Math.sin(frame)*0.8,0,Math.cos(frame)*0.5));
    }
    rig.torsoBones.spineUpper!.quaternion.setFromEuler(new THREE.Euler(0.04,Math.sin(frame)*0.14,0));
    legs.quaternion.setFromEuler(new THREE.Euler(Math.sin(frame)*0.6,0,0));
    model.rotation.y=frame*0.08;
    const before = rig.ownedBones.map(b=>b.quaternion.clone());
    const legBefore = legs.quaternion.clone();
    assert.equal(applyMilitaryCarryPose(rig,source.kind,frame%2 ? 'run':'walk'),true);
    const orientation = tool.getWorldQuaternion(new THREE.Quaternion());
    orientation.premultiply(model.getWorldQuaternion(new THREE.Quaternion()).invert());
    mountRotations.push(orientation.normalize());
    assert.ok(legs.quaternion.angleTo(legBefore)<1e-7,'carrying must not freeze the legs');
    assert.ok(rig.torsoBones.spineUpper!.quaternion.angleTo(before[9]!)<1e-7,'torso gait stays animated');
    if (source.kind==='spear' || source.kind==='pike-kit' || source.kind==='halberd' || source.kind==='sidearm') {
      assert.ok(rig.armBones.leftUpperArm.quaternion.angleTo(before[1]!)<1e-7,'the free arm keeps swinging');
    }
    assert.ok(primaryHand.position.length()>0,'the wrist remains on its original skeleton');
    restoreCombatWeaponPose(rig);
    rig.ownedBones.forEach((b,i)=>assert.ok(b.quaternion.angleTo(before[i]!)<1e-7,'next frame restores the mixer pose'));
  }
  const carryAngle = Math.max(...mountRotations.map(q=>q.angleTo(mountRotations[0]!)));
  assert.ok(carryAngle<1e-5,`${kind} carry varied by ${carryAngle} radians with the walk/run swing`);
  const resting = rig.ownedBones.map(b=>b.quaternion.clone());
  assert.equal(applyMilitaryCarryPose(rig,source.kind,'fight'),false);
  assert.equal(applyMilitaryCarryPose(rig,source.kind,'fall'),false);
  rig.ownedBones.forEach((b,i)=>assert.ok(b.quaternion.angleTo(resting[i]!)<1e-7,'combat and casualties retain pose ownership'));
  disposeCombatWeaponRig(rig);
}
const bowRigModel = createSemanticCombatRig();
const bowTool = attachMilitaryEquipment(bowRigModel, sources.bow);
const bowRig = bindCombatWeaponRig(bowRigModel, 'bow', bowTool);
assert.ok(bowRig?.nockedArrow, 'bow rigs need a visible per-soldier nocked arrow');
assert.ok(bowRig.bowString, 'bow rigs need an independently deformable string');
assert.ok(bowRig.bowStringRestCenter);
applyCombatWeaponPose(bowRig, {
  tool: 'bow', targetDistance: 12, attackCooldown: 1.55,
  attackSeconds: 1.55, dtSeconds: 0.016, logicalMode: 'fight',
});
assert.equal(bowRig.nockedArrow.visible, false);
const drawResult = applyCombatWeaponPose(bowRig, {
  tool: 'bow', targetDistance: 12, attackCooldown: 0.8,
  attackSeconds: 1.55, dtSeconds: 0.016, logicalMode: 'hurt',
});
assert.equal(drawResult?.timeline.phase, 'draw');
assert.equal(bowRig.nockedArrow.visible, true, 'hit reactions must retain the drawn weapon overlay');
const handInBow = bowRig.rangedMount!.worldToLocal(
  bowRig.armBones.rightHand.getWorldPosition(new THREE.Vector3()),
);
const bowStringPositions = bowRig.bowString.geometry.getAttribute('position') as THREE.BufferAttribute;
assert.ok(new THREE.Vector3(
  bowStringPositions.getX(1),
  bowStringPositions.getY(1),
  bowStringPositions.getZ(1),
).distanceTo(handInBow) < 1e-4, 'bowstring center must follow the drawing hand and nock');
const bowRelease = applyCombatWeaponPose(bowRig, {
  tool: 'bow', targetDistance: 12, attackCooldown: 1.55,
  attackSeconds: 1.55, dtSeconds: 0.016, logicalMode: 'fight',
});
assert.equal(bowRelease?.event?.projectile, 'arrow');
assert.equal(bowRig.nockedArrow.visible, false);

const crossbowRigModel = createSemanticCombatRig();
const crossbowTool = attachMilitaryEquipment(crossbowRigModel, sources.crossbow);
const crossbowRig = bindCombatWeaponRig(crossbowRigModel, 'crossbow', crossbowTool);
assert.ok(crossbowRig?.loadedCrossbowBolt);
applyCombatWeaponPose(crossbowRig, {
  tool: 'crossbow', targetDistance: 12, attackCooldown: 2.45,
  attackSeconds: 2.45, dtSeconds: 0.016, logicalMode: 'fight',
});
assert.equal(crossbowRig.loadedCrossbowBolt.visible, false, 'the bolt must not appear before spanning/reload completes');
applyCombatWeaponPose(crossbowRig, {
  tool: 'crossbow', targetDistance: 12, attackCooldown: 0.3,
  attackSeconds: 2.45, dtSeconds: 0.016, logicalMode: 'fight',
});
assert.equal(crossbowRig.loadedCrossbowBolt.visible, true);
const boltRelease = applyCombatWeaponPose(crossbowRig, {
  tool: 'crossbow', targetDistance: 12, attackCooldown: 2.45,
  attackSeconds: 2.45, dtSeconds: 0.016, logicalMode: 'fight',
});
assert.equal(boltRelease?.event?.projectile, 'bolt');
assert.equal(crossbowRig.loadedCrossbowBolt.visible, false);

const standardRigModel = createSemanticCombatRig();
const standardTool = attachMilitaryEquipment(standardRigModel, sources.sidearm);
const standardRig = bindCombatWeaponRig(standardRigModel, 'sidearm', standardTool);
assert.ok(standardRig);
const standardBase = standardRig.ownedBones.map((bone) => bone.quaternion.clone());
applyCombatWeaponPose(standardRig, {
  tool: 'sidearm', targetDistance: 1.6, attackCooldown: 0.18,
  attackSeconds: 1, dtSeconds: 0.016, logicalMode: 'fight',
});
const attackingRightHand = standardRig.armBones.rightHand.quaternion.clone();
applyCompanyStandardBearerPose(standardRig);
assert.ok(
  standardRig.armBones.rightHand.quaternion.angleTo(attackingRightHand) < 1e-7,
  'standard grip must not replace the bearer\'s right-hand sword attack',
);
const shoulder = standardRig.armBones.leftUpperArm.getWorldPosition(new THREE.Vector3());
const grip = standardRig.armBones.leftHand.getWorldPosition(new THREE.Vector3());
assert.ok(grip.x > shoulder.x, 'the standard grip should stay outside the bearer\'s left hip');
assert.ok(grip.y < shoulder.y, 'the standard grip should remain below the shoulder');
restoreCombatWeaponPose(standardRig);
for (let index = 0; index < standardRig.ownedBones.length; index += 1) {
  assert.ok(
    standardRig.ownedBones[index]!.quaternion.angleTo(standardBase[index]!) < 1e-7,
    'releasing the standard overlay must restore the authored animation pose',
  );
}

assert.equal(combatBaseActionMode({
  mode: 'fight', tool: 'bow', combatAttackCooldown: 0.5, combatTargetDistance: 12,
  combatLocomotion: 'run',
} as CrowdRenderAgent), 'run', 'moving ranged soldiers need locomoting legs under the upper-body weapon pose');
assert.equal(combatBaseActionMode({
  mode: 'fight', tool: 'halberd', combatAttackCooldown: 0.5, combatTargetDistance: 2,
  combatLocomotion: 'idle',
} as CrowdRenderAgent), 'wait', 'stationary polearms should not inherit a generic slash clip');

const projectileSample = {
  position: new THREE.Vector3(),
  direction: new THREE.Vector3(),
};
sampleCombatProjectile(
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(10, 1, 0),
  0.5,
  1,
  projectileSample,
);
assert.ok(Math.abs(projectileSample.position.x - 5) < 1e-6);
assert.ok(Math.abs(projectileSample.position.y - 2) < 1e-6);
assert.ok(Math.abs(projectileSample.direction.length() - 1) < 1e-6);
assert.equal(COMBAT_PROJECTILE_DRAW_CALL_BUDGET, 2);

const projectileParent = new THREE.Group();
projectileParent.position.set(17, 3, -9);
const projectileRenderer = new CombatProjectileRenderer(projectileParent);
projectileParent.updateWorldMatrix(true, true);
for (let index = 0; index < 140; index += 1) {
  projectileRenderer.spawnRelease(
    index % 2 === 0 ? 'arrow' : 'bolt',
    new THREE.Vector3(17, 4, -9),
    new THREE.Vector3(29, 4.2, -7),
    index,
  );
}
projectileRenderer.update(0.2);
const effectGroup = projectileParent.children[0] as THREE.Group;
const effectCounts = effectGroup.children.map((child) => (child as THREE.InstancedMesh).count);
assert.ok(effectCounts[0]! + effectCounts[1]! <= 96, 'projectiles must remain in the bounded shared pool');
assert.equal(effectGroup.children.length, COMBAT_PROJECTILE_DRAW_CALL_BUDGET);

projectileRenderer.dispose();
disposeCombatWeaponRig(bowRig);
disposeCombatWeaponRig(crossbowRig);
disposeCombatWeaponRig(standardRig);
for (const source of Object.values(sources)) disposeMilitaryEquipmentSource(source);

console.log('Combat weapon poses, ranged loading/release, persistent hit-reaction ownership, and pooled projectiles passed.');

function createSemanticCombatRig(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'Synthetic combat rig';
  const waist = bone('Waist', 0, 0.9, 0);
  const spineLower = bone('Spine01', 0, 0.24, 0);
  const spineUpper = bone('Spine02', 0, 0.24, 0);
  root.add(waist);
  waist.add(spineLower);
  spineLower.add(spineUpper);
  addArm(spineUpper, 'L', 1);
  addArm(spineUpper, 'R', -1);
  root.updateWorldMatrix(true, true);
  return root;
}

function addArm(parent: THREE.Bone, prefix: 'L' | 'R', side: 1 | -1): void {
  const clavicle = bone(`${prefix}_Clavicle`, side * 0.08, 0.12, 0);
  const upper = bone(`${prefix}_Upperarm`, side * 0.14, 0, 0);
  const forearm = bone(`${prefix}_Forearm`, side * 0.28, 0, 0);
  const hand = bone(`${prefix}_Hand`, side * 0.25, 0, 0);
  parent.add(clavicle);
  clavicle.add(upper);
  upper.add(forearm);
  forearm.add(hand);
}

function bone(name: string, x: number, y: number, z: number): THREE.Bone {
  const value = new THREE.Bone();
  value.name = name;
  value.position.set(x, y, z);
  return value;
}
