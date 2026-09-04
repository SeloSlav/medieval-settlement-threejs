import * as THREE from 'three';
import type { WorkerToolKind } from './workerTools.ts';
import type { MilitaryEquipmentCombatStance } from './militaryEquipment.ts';

export type CombatWeaponFamily =
  | 'spear-pike'
  | 'sword-shield'
  | 'halberd'
  | 'bow'
  | 'crossbow';

export type CombatAttackPhase =
  | 'recovery'
  | 'guard'
  | 'wind-up'
  | 'contact'
  | 'reload'
  | 'draw'
  | 'aim'
  | 'release';

export type CombatProjectileKind = 'arrow' | 'bolt';

export type CombatWeaponPresentation = {
  family: CombatWeaponFamily;
  stance: MilitaryEquipmentCombatStance;
  ranged: boolean;
  attackSeconds: number;
  projectile: CombatProjectileKind | null;
  neutralBaseClip: boolean;
};

export type CombatAttackTimeline = CombatWeaponPresentation & {
  cycleProgress: number;
  poseProgress: number;
  phase: CombatAttackPhase;
  phaseProgress: number;
  releaseEdge: boolean;
};

export type CombatWeaponPoseInput = {
  tool: WorkerToolKind;
  targetDistance: number;
  attackCooldown: number;
  attackSeconds?: number;
  dtSeconds: number;
  logicalMode: string;
};

export type CombatWeaponAttackEvent = {
  sequence: number;
  family: CombatWeaponFamily;
  type: 'melee-contact' | 'projectile-release';
  projectile: CombatProjectileKind | null;
};

export type CombatWeaponPoseResult = {
  presentation: CombatWeaponPresentation;
  timeline: CombatAttackTimeline;
  event: CombatWeaponAttackEvent | null;
};

type ArmBoneKey =
  | 'leftClavicle'
  | 'leftUpperArm'
  | 'leftForearm'
  | 'leftHand'
  | 'rightClavicle'
  | 'rightUpperArm'
  | 'rightForearm'
  | 'rightHand';

type TorsoBoneKey = 'spineLower' | 'spineUpper';
type OwnedBoneKey = ArmBoneKey | TorsoBoneKey;

export const COMBAT_RIG_BONE_ALIASES = {
  leftClavicle: ['L_Clavicle', 'ClavicleL'],
  leftUpperArm: ['L_Upperarm', 'UpperArmL'],
  leftForearm: ['L_Forearm', 'LowerArmL'],
  leftHand: ['L_Hand', 'PalmL'],
  rightClavicle: ['R_Clavicle', 'ClavicleR'],
  rightUpperArm: ['R_Upperarm', 'UpperArmR'],
  rightForearm: ['R_Forearm', 'LowerArmR'],
  rightHand: ['R_Hand', 'PalmR'],
  spineLower: ['Spine01', 'Abdomen'],
  spineUpper: ['Spine02', 'Torso'],
} as const satisfies Record<OwnedBoneKey, readonly string[]>;

const ARM_KEYS: readonly ArmBoneKey[] = [
  'leftClavicle',
  'leftUpperArm',
  'leftForearm',
  'leftHand',
  'rightClavicle',
  'rightUpperArm',
  'rightForearm',
  'rightHand',
];

const TORSO_KEYS: readonly TorsoBoneKey[] = ['spineLower', 'spineUpper'];
const RANGED_FALLBACK_DISTANCE = 3.25;

const FIXED_PRESENTATIONS: Partial<Record<WorkerToolKind, CombatWeaponPresentation>> = {
  spear: presentation('spear-pike', 'melee', false, 1.1, null, true),
  'spear-shield': presentation('spear-pike', 'melee', false, 1, null, true),
  'pike-kit': presentation('spear-pike', 'melee', false, 0.94, null, true),
  sidearm: presentation('sword-shield', 'melee', false, 1, null, false),
  'sidearm-shield': presentation('sword-shield', 'melee', false, 0.82, null, false),
  'sword-shield': presentation('sword-shield', 'melee', false, 0.92, null, false),
  halberd: presentation('halberd', 'melee', false, 1.08, null, true),
};

function presentation(
  family: CombatWeaponFamily,
  stance: MilitaryEquipmentCombatStance,
  ranged: boolean,
  attackSeconds: number,
  projectile: CombatProjectileKind | null,
  neutralBaseClip: boolean,
): CombatWeaponPresentation {
  return { family, stance, ranged, attackSeconds, projectile, neutralBaseClip };
}

export function resolveCombatWeaponPresentation(
  tool: WorkerToolKind,
  targetDistance: number,
): CombatWeaponPresentation | null {
  const fixed = FIXED_PRESENTATIONS[tool];
  if (fixed) return fixed;
  const distantTarget = !Number.isFinite(targetDistance)
    || targetDistance > RANGED_FALLBACK_DISTANCE;
  if (tool === 'bow') {
    return distantTarget
      ? presentation('bow', 'ranged', true, 1.55, 'arrow', true)
      : presentation('sword-shield', 'melee', false, 0.9, null, false);
  }
  if (tool === 'crossbow') {
    return distantTarget
      ? presentation('crossbow', 'ranged', true, 2.45, 'bolt', true)
      : presentation('sword-shield', 'melee', false, 0.9, null, false);
  }
  return null;
}

export function sampleCombatAttackTimeline(
  combatPresentation: CombatWeaponPresentation,
  attackCooldown: number,
  previousAttackCooldown: number | null,
): CombatAttackTimeline {
  const duration = combatPresentation.attackSeconds;
  const cooldown = THREE.MathUtils.clamp(
    Number.isFinite(attackCooldown) ? attackCooldown : duration,
    0,
    duration,
  );
  const releaseEdge = previousAttackCooldown !== null
    && cooldown > previousAttackCooldown + Math.max(0.08, duration * 0.3)
    && cooldown > duration * 0.55;
  const cycleProgress = THREE.MathUtils.clamp(1 - cooldown / duration, 0, 1);
  const poseProgress = releaseEdge ? 1 : cycleProgress;
  const phaseSample = combatPresentation.ranged
    ? rangedPhase(combatPresentation.family, poseProgress, releaseEdge)
    : meleePhase(poseProgress, releaseEdge);
  return {
    ...combatPresentation,
    cycleProgress,
    poseProgress,
    phase: phaseSample.phase,
    phaseProgress: phaseSample.progress,
    releaseEdge,
  };
}

function meleePhase(
  progress: number,
  releaseEdge: boolean,
): { phase: CombatAttackPhase; progress: number } {
  if (releaseEdge) return { phase: 'contact', progress: 1 };
  if (progress < 0.28) return phaseRange('recovery', progress, 0, 0.28);
  if (progress < 0.56) return phaseRange('guard', progress, 0.28, 0.56);
  if (progress < 0.86) return phaseRange('wind-up', progress, 0.56, 0.86);
  return phaseRange('contact', progress, 0.86, 1);
}

function rangedPhase(
  family: CombatWeaponFamily,
  progress: number,
  releaseEdge: boolean,
): { phase: CombatAttackPhase; progress: number } {
  if (releaseEdge) return { phase: 'release', progress: 1 };
  const reloadEnd = family === 'crossbow' ? 0.52 : 0.34;
  const drawEnd = family === 'crossbow' ? 0.74 : 0.72;
  if (progress < reloadEnd) return phaseRange('reload', progress, 0, reloadEnd);
  if (progress < drawEnd) {
    return phaseRange(family === 'bow' ? 'draw' : 'wind-up', progress, reloadEnd, drawEnd);
  }
  return phaseRange('aim', progress, drawEnd, 1);
}

function phaseRange(
  phase: CombatAttackPhase,
  value: number,
  start: number,
  end: number,
): { phase: CombatAttackPhase; progress: number } {
  return {
    phase,
    progress: THREE.MathUtils.clamp((value - start) / Math.max(1e-6, end - start), 0, 1),
  };
}

export type CombatWeaponRig = {
  model: THREE.Group;
  tool: THREE.Group | null;
  rangedMount: THREE.Group | null;
  shieldMount: THREE.Group | null;
  nockedArrow: THREE.Group | null;
  bowString: THREE.Line | null;
  bowStringRestCenter: THREE.Vector3 | null;
  loadedCrossbowBolt: THREE.Group | null;
  crossbowCord: THREE.Line | null;
  equipmentScratch: THREE.Vector3;
  armBones: Record<ArmBoneKey, THREE.Bone>;
  torsoBones: Partial<Record<TorsoBoneKey, THREE.Bone>>;
  referenceQuaternions: Map<THREE.Bone, THREE.Quaternion>;
  ownedBones: THREE.Bone[];
  baseQuaternions: THREE.Quaternion[];
  scratchVectors: THREE.Vector3[];
  scratchQuaternions: THREE.Quaternion[];
  scratchEuler: THREE.Euler;
  targetScratch: FamilyTargets;
  overlayApplied: boolean;
  previousObservedCooldown: number | null;
  lastObservedCooldown: number | null;
  estimatedCooldown: number;
  family: CombatWeaponFamily | null;
  eventSequence: number;
};

export function bindCombatWeaponRig(
  model: THREE.Group,
  toolKind: WorkerToolKind | null = null,
  tool: THREE.Group | null = null,
): CombatWeaponRig | null {
  const armBones = {} as Record<ArmBoneKey, THREE.Bone>;
  for (const key of ARM_KEYS) {
    const bone = findRigBone(model, COMBAT_RIG_BONE_ALIASES[key]);
    if (!bone) return null;
    armBones[key] = bone;
  }
  const torsoBones: Partial<Record<TorsoBoneKey, THREE.Bone>> = {};
  for (const key of TORSO_KEYS) {
    const bone = findRigBone(model, COMBAT_RIG_BONE_ALIASES[key]);
    if (bone) torsoBones[key] = bone;
  }
  const ownedBones = [...Object.values(armBones), ...Object.values(torsoBones)];
  const referenceQuaternions = new Map<THREE.Bone, THREE.Quaternion>();
  for (const bone of ownedBones) {
    referenceQuaternions.set(bone, bone.quaternion.clone());
  }
  const mounts = tool?.userData.workerToolMounts as THREE.Group[] | undefined;
  const rangedMount = mounts?.find(
    (mount) => mount.userData.workerToolCombatRole === 'ranged-held',
  ) ?? null;
  const nockedArrow = toolKind === 'bow' && rangedMount
    ? createNockedArrow(rangedMount)
    : null;
  let bowString: THREE.Line | null = null;
  let bowStringRestCenter: THREE.Vector3 | null = null;
  if (toolKind === 'bow' && rangedMount) {
    rangedMount.traverse((object) => {
      if (
        !bowString
        && object instanceof THREE.Line
        && String(object.userData.semanticWeaponPart ?? object.name)
          .toLowerCase()
          .includes('hemp string')
      ) bowString = object;
    });
    // Assignment happens inside Object3D.traverse(), so TypeScript cannot
    // narrow the outer variable from the callback mutation on its own.
    const resolvedBowString = bowString as THREE.Line | null;
    if (resolvedBowString) {
      // The nock is per-rig state; the three-point source line otherwise shares
      // immutable geometry with every bow in the company.
      resolvedBowString.geometry = resolvedBowString.geometry.clone();
      const position = resolvedBowString.geometry.getAttribute('position') as
        | THREE.BufferAttribute
        | undefined;
      if (position && position.count >= 3) {
        bowStringRestCenter = new THREE.Vector3(
          position.getX(1),
          position.getY(1),
          position.getZ(1),
        );
      }
    }
  }
  const loadedCrossbowBolt = toolKind === 'crossbow' && rangedMount
    ? createLoadedCrossbowBolt(rangedMount)
    : null;
  let crossbowCord: THREE.Line | null = null;
  if (toolKind === 'crossbow' && rangedMount) {
    rangedMount.traverse((object) => {
      if (
        !crossbowCord
        && object instanceof THREE.Line
        && String(object.userData.semanticWeaponPart ?? object.name)
          .toLowerCase()
          .includes('drawn cord')
      ) crossbowCord = object;
    });
  }
  return {
    model,
    tool,
    rangedMount,
    shieldMount: mounts?.find(mount => mount.parent === armBones.leftHand
      && mount.userData.workerToolCombatRole === 'always') ?? null,
    nockedArrow,
    bowString,
    bowStringRestCenter,
    loadedCrossbowBolt,
    crossbowCord,
    equipmentScratch: new THREE.Vector3(),
    armBones,
    torsoBones,
    referenceQuaternions,
    ownedBones,
    baseQuaternions: ownedBones.map(() => new THREE.Quaternion()),
    scratchVectors: Array.from({ length: 16 }, () => new THREE.Vector3()),
    scratchQuaternions: Array.from({ length: 4 }, () => new THREE.Quaternion()),
    scratchEuler: new THREE.Euler(),
    targetScratch: {
      left: [0, 0, 0],
      right: [0, 0, 0],
      torsoLean: 0,
      torsoTwist: 0,
    },
    overlayApplied: false,
    previousObservedCooldown: null,
    lastObservedCooldown: null,
    estimatedCooldown: 0,
    family: null,
    eventSequence: 0,
  };
}

function findRigBone(model: THREE.Group, aliases: readonly string[]): THREE.Bone | null {
  for (const alias of aliases) {
    const object = model.getObjectByName(alias);
    if (object instanceof THREE.Bone) return object;
  }
  return null;
}

export function restoreCombatWeaponPose(rig: CombatWeaponRig): void {
  if (!rig.overlayApplied) return;
  for (let index = 0; index < rig.ownedBones.length; index += 1) {
    rig.ownedBones[index]!.quaternion.copy(rig.baseQuaternions[index]!);
  }
  rig.overlayApplied = false;
}

const CARRY_RIGHT: ArmTarget = [-0.42, -0.5, 0.18];
const CARRY_LEFT: ArmTarget = [0.42, -0.5, 0.18];
const CARRY_CROSSBOW: ArmTarget = [-0.2, -0.32, 0.52];
const UPRIGHT_CARRY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.06);
const LOW_BLADE_CARRY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 2.7);
const CROSSBOW_CARRY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.25);
const SHIELD_CARRY = new THREE.Quaternion();

/** Like the standard bearer, own only the carrying arm after the base mixer.
 * Keep the wrist relative to the model's facing, so torso sway cannot whip a
 * long pole back and forth. The free arm, torso and legs keep their animation. */
export function applyMilitaryCarryPose(rig: CombatWeaponRig, tool: WorkerToolKind, mode: string): boolean {
  if (!rig.tool || !resolveCombatWeaponPresentation(tool, Infinity)
    || !['walk', 'run', 'flee', 'idle', 'wait', 'relax'].includes(mode)) return false;
  if (!rig.overlayApplied) captureBaseQuaternions(rig);
  const primaryLeft = tool === 'bow';
  const primaryMount = primaryLeft ? rig.rangedMount ?? rig.tool : rig.tool;
  const orientation = tool === 'crossbow' ? CROSSBOW_CARRY
    : tool === 'sidearm' || tool === 'sidearm-shield' || tool === 'sword-shield'
      ? LOW_BLADE_CARRY : UPRIGHT_CARRY;
  poseCarryArm(rig, primaryLeft, tool === 'crossbow' ? CARRY_CROSSBOW
    : primaryLeft ? CARRY_LEFT : CARRY_RIGHT);
  orientCarryGrip(rig, primaryLeft ? rig.armBones.leftHand : rig.armBones.rightHand,
    primaryMount, orientation);
  if (tool === 'crossbow') {
    const grip = primaryMount.userData.workerToolSupportGripLocal as readonly [number, number, number] | undefined;
    if (grip) {
      rig.armBones.leftClavicle.quaternion.copy(rig.referenceQuaternions.get(rig.armBones.leftClavicle)!);
      rig.armBones.leftHand.quaternion.copy(rig.referenceQuaternions.get(rig.armBones.leftHand)!);
      rig.model.updateWorldMatrix(true, true);
      const target = primaryMount.localToWorld(rig.scratchVectors[13]!.set(...grip));
      solveArmToWorld(rig, rig.armBones.leftUpperArm, rig.armBones.leftForearm, rig.armBones.leftHand, target, 1);
    }
  } else if (rig.shieldMount) {
    poseCarryArm(rig, true, CARRY_LEFT);
    orientCarryGrip(rig, rig.armBones.leftHand, rig.shieldMount, SHIELD_CARRY);
  }
  rig.model.updateWorldMatrix(true, true);
  return true;
}

function poseCarryArm(rig: CombatWeaponRig, left: boolean, target: ArmTarget): void {
  const clavicle = left ? rig.armBones.leftClavicle : rig.armBones.rightClavicle;
  const hand = left ? rig.armBones.leftHand : rig.armBones.rightHand;
  clavicle.quaternion.copy(rig.referenceQuaternions.get(clavicle)!);
  hand.quaternion.copy(rig.referenceQuaternions.get(hand)!);
  rig.model.updateWorldMatrix(true, true);
  solveArm(rig, left ? rig.armBones.leftUpperArm : rig.armBones.rightUpperArm,
    left ? rig.armBones.leftForearm : rig.armBones.rightForearm, hand, target, left ? 1 : -1);
}

function orientCarryGrip(rig: CombatWeaponRig, hand: THREE.Bone, mount: THREE.Group, orientation: THREE.Quaternion): void {
  const desiredWorld = rig.model.getWorldQuaternion(rig.scratchQuaternions[0]!).multiply(orientation);
  const parentInverse = hand.parent!.getWorldQuaternion(rig.scratchQuaternions[1]!).invert();
  const mountInverse = rig.scratchQuaternions[2]!.copy(mount.quaternion).invert();
  hand.quaternion.copy(parentInverse).multiply(desiredWorld).multiply(mountInverse).normalize();
  hand.updateWorldMatrix(true, true);
}

/**
 * Keeps a company standard in the left hand while the right arm remains free
 * to use its sword timeline. The standard itself is rendered in a shared
 * cloth batch; this overlay gives the authored body a convincing, persistent
 * grip without allowing walk, hurt, attack, or retreat clips to swing the pole
 * through the bearer.
 *
 * Call after applyCombatWeaponPose(). The combat overlay already owns the
 * frame's captured base pose, so replacing only the left-arm solution cannot
 * disturb the right-hand attack or torso motion. Outside combat this function
 * captures the animation pose itself and restoreCombatWeaponPose() releases it
 * cleanly on the next frame.
 */
export function applyCompanyStandardBearerPose(rig: CombatWeaponRig): void {
  if (!rig.overlayApplied) captureBaseQuaternions(rig);
  const { armBones, referenceQuaternions } = rig;
  armBones.leftClavicle.quaternion.copy(
    referenceQuaternions.get(armBones.leftClavicle)!,
  );
  armBones.leftHand.quaternion.copy(
    referenceQuaternions.get(armBones.leftHand)!,
  );
  rig.model.updateWorldMatrix(true, true);
  // Low, slightly forward, and outside the hip: the hand supports a tall
  // standard near its balance point instead of unrealistically lifting it at
  // shoulder height. Values are fractions of the rig's measured arm length.
  solveArm(
    rig,
    armBones.leftUpperArm,
    armBones.leftForearm,
    armBones.leftHand,
    [0.46, -0.48, 0.16],
    1,
  );
  armBones.leftHand.quaternion.copy(
    referenceQuaternions.get(armBones.leftHand)!,
  );
  rig.model.updateWorldMatrix(true, true);
  rig.overlayApplied = true;
}

export function resetCombatWeaponRig(rig: CombatWeaponRig): void {
  restoreCombatWeaponPose(rig);
  if (rig.nockedArrow) rig.nockedArrow.visible = false;
  restoreBowString(rig);
  if (rig.loadedCrossbowBolt) rig.loadedCrossbowBolt.visible = true;
  if (rig.crossbowCord) rig.crossbowCord.visible = true;
  rig.previousObservedCooldown = null;
  rig.lastObservedCooldown = null;
  rig.estimatedCooldown = 0;
  rig.family = null;
  rig.eventSequence = 0;
}

export function disposeCombatWeaponRig(rig: CombatWeaponRig): void {
  resetCombatWeaponRig(rig);
  disposeTransientEquipment(rig.nockedArrow);
  disposeTransientEquipment(rig.loadedCrossbowBolt);
  rig.bowString?.geometry.dispose();
  rig.nockedArrow = null;
  rig.bowString = null;
  rig.bowStringRestCenter = null;
  rig.loadedCrossbowBolt = null;
  rig.crossbowCord = null;
}

function disposeTransientEquipment(equipment: THREE.Group | null): void {
  if (!equipment) return;
  equipment.removeFromParent();
  equipment.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material.dispose();
    } else {
      mesh.material.dispose();
    }
  });
}

export function applyCombatWeaponPose(
  rig: CombatWeaponRig,
  input: CombatWeaponPoseInput,
): CombatWeaponPoseResult | null {
  const resolvedPresentation = resolveCombatWeaponPresentation(
    input.tool,
    input.targetDistance,
  );
  if (!resolvedPresentation || input.logicalMode === 'fall') {
    if (rig.nockedArrow) rig.nockedArrow.visible = false;
    restoreBowString(rig);
    if (input.logicalMode === 'fall' && rig.loadedCrossbowBolt) {
      rig.loadedCrossbowBolt.visible = false;
    }
    rig.previousObservedCooldown = null;
    rig.lastObservedCooldown = null;
    rig.family = null;
    return null;
  }
  const combatPresentation = input.attackSeconds !== undefined
    && Number.isFinite(input.attackSeconds)
    && input.attackSeconds > 0.2
    ? { ...resolvedPresentation, attackSeconds: input.attackSeconds }
    : resolvedPresentation;

  const observedCooldown = Math.max(0, Number.isFinite(input.attackCooldown)
    ? input.attackCooldown
    : combatPresentation.attackSeconds);
  const familyChanged = rig.family !== combatPresentation.family;
  const observedChanged = rig.lastObservedCooldown === null
    || Math.abs(observedCooldown - rig.lastObservedCooldown) > 1e-5;
  if (familyChanged || observedChanged) rig.estimatedCooldown = observedCooldown;
  else {
    rig.estimatedCooldown = Math.max(
      0,
      rig.estimatedCooldown - THREE.MathUtils.clamp(input.dtSeconds, 0, 0.08),
    );
  }
  const edgeTimeline = sampleCombatAttackTimeline(
    combatPresentation,
    observedCooldown,
    familyChanged ? null : rig.previousObservedCooldown,
  );
  const poseTimeline = sampleCombatAttackTimeline(
    combatPresentation,
    rig.estimatedCooldown,
    null,
  );
  const timeline = edgeTimeline.releaseEdge
    ? edgeTimeline
    : { ...poseTimeline, releaseEdge: false };
  rig.previousObservedCooldown = observedCooldown;
  rig.lastObservedCooldown = observedCooldown;
  rig.family = combatPresentation.family;

  captureBaseQuaternions(rig);
  applyTimelinePose(rig, timeline, input.logicalMode);
  updateRangedAmmoVisuals(rig, timeline);

  const event = timeline.releaseEdge
    ? {
        sequence: ++rig.eventSequence,
        family: combatPresentation.family,
        type: combatPresentation.ranged ? 'projectile-release' : 'melee-contact',
        projectile: combatPresentation.projectile,
      } satisfies CombatWeaponAttackEvent
    : null;
  return { presentation: combatPresentation, timeline, event };
}

/** World-space release point used by the pooled projectile/muzzle VFX layer. */
export function combatWeaponReleaseOrigin(
  rig: CombatWeaponRig,
  target: THREE.Vector3,
): THREE.Vector3 {
  rig.model.updateWorldMatrix(true, true);
  if (rig.family === 'bow' && rig.nockedArrow) {
    return rig.nockedArrow.localToWorld(target.set(0, 0, 0.64));
  }
  if (rig.rangedMount) {
    const muzzle = rig.rangedMount.userData.workerToolMuzzleLocal as
      | readonly [number, number, number]
      | undefined;
    const localMuzzle = muzzle
      ? target.set(...muzzle)
      : target.set(0, 0.46, 0.052);
    return rig.rangedMount.localToWorld(localMuzzle);
  }
  return rig.armBones.rightHand.getWorldPosition(target);
}

function createNockedArrow(parent: THREE.Group): THREE.Group {
  const arrow = new THREE.Group();
  arrow.name = 'Combat bow · nocked arrow';
  const shaftMaterial = new THREE.MeshStandardMaterial({
    color: 0x8c6335,
    roughness: 0.86,
    metalness: 0,
  });
  const ironMaterial = new THREE.MeshStandardMaterial({
    color: 0xaab0b3,
    roughness: 0.38,
    metalness: 0.72,
  });
  const featherMaterial = new THREE.MeshStandardMaterial({
    color: 0xd7d0bc,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0045, 0.0045, 0.82, 6),
    shaftMaterial,
  );
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = 0.2;
  const point = new THREE.Mesh(
    new THREE.ConeGeometry(0.014, 0.045, 6),
    ironMaterial,
  );
  point.rotation.x = Math.PI / 2;
  point.position.z = 0.632;
  const fletching = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.0025, 0.085),
    featherMaterial,
  );
  fletching.position.z = -0.19;
  for (const mesh of [shaft, point, fletching]) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    arrow.add(mesh);
  }
  arrow.position.set(0, 0.01, -0.035);
  arrow.visible = false;
  parent.add(arrow);
  return arrow;
}

function createLoadedCrossbowBolt(parent: THREE.Group): THREE.Group {
  const bolt = new THREE.Group();
  bolt.name = 'Combat crossbow · loaded bolt';
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 0.56, 7),
    new THREE.MeshStandardMaterial({
      color: 0x8c6335,
      roughness: 0.86,
      metalness: 0,
    }),
  );
  shaft.position.set(0, 0.12, 0.052);
  const point = new THREE.Mesh(
    new THREE.ConeGeometry(0.018, 0.05, 6),
    new THREE.MeshStandardMaterial({
      color: 0xaab0b3,
      roughness: 0.38,
      metalness: 0.72,
    }),
  );
  point.position.set(0, 0.425, 0.052);
  for (const mesh of [shaft, point]) {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    bolt.add(mesh);
  }
  parent.add(bolt);
  return bolt;
}

function updateRangedAmmoVisuals(
  rig: CombatWeaponRig,
  timeline: CombatAttackTimeline,
): void {
  const arrow = rig.nockedArrow;
  if (arrow) {
    const nocked = timeline.family === 'bow'
      && !timeline.releaseEdge
      && (timeline.phase === 'draw' || timeline.phase === 'aim');
    arrow.visible = nocked;
    if (nocked && rig.rangedMount) {
      rig.armBones.rightHand.getWorldPosition(rig.equipmentScratch);
      rig.rangedMount.worldToLocal(rig.equipmentScratch);
      // The arrow's modeled nock is 0.21 m behind its local origin. Projecting
      // the drawing hand into bow space keeps string hand, nock and shaft one
      // continuous visual instead of sliding an unrelated prop.
      arrow.position.set(
        rig.equipmentScratch.x,
        rig.equipmentScratch.y,
        rig.equipmentScratch.z + 0.21,
      );
      updateBowStringCenter(rig, rig.equipmentScratch);
    } else {
      restoreBowString(rig);
    }
  }
  const crossbowLoaded = timeline.family === 'crossbow'
    && !timeline.releaseEdge
    && (
      timeline.phase === 'aim'
      || (timeline.phase === 'wind-up' && timeline.phaseProgress > 0.55)
    );
  if (rig.loadedCrossbowBolt) rig.loadedCrossbowBolt.visible = crossbowLoaded;
  if (rig.crossbowCord) {
    rig.crossbowCord.visible = timeline.family !== 'crossbow'
      || (
        !timeline.releaseEdge
        && (
          timeline.phase === 'aim'
          || (timeline.phase === 'wind-up' && timeline.phaseProgress > 0.35)
        )
      );
  }
}

function updateBowStringCenter(rig: CombatWeaponRig, center: THREE.Vector3): void {
  const position = rig.bowString?.geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  if (!position || position.count < 3) return;
  position.setXYZ(1, center.x, center.y, center.z);
  position.needsUpdate = true;
}

function restoreBowString(rig: CombatWeaponRig): void {
  const rest = rig.bowStringRestCenter;
  if (!rest) return;
  updateBowStringCenter(rig, rest);
}

function captureBaseQuaternions(rig: CombatWeaponRig): void {
  for (let index = 0; index < rig.ownedBones.length; index += 1) {
    rig.baseQuaternions[index]!.copy(rig.ownedBones[index]!.quaternion);
  }
  rig.overlayApplied = true;
}

type ArmTarget = [lateral: number, vertical: number, forward: number];
type FamilyTargets = {
  left: ArmTarget;
  right: ArmTarget;
  torsoLean: number;
  torsoTwist: number;
};

function applyTimelinePose(
  rig: CombatWeaponRig,
  timeline: CombatAttackTimeline,
  logicalMode: string,
): void {
  const targets = targetsForTimeline(timeline, rig.targetScratch);
  const { armBones, referenceQuaternions } = rig;
  armBones.leftClavicle.quaternion.copy(referenceQuaternions.get(armBones.leftClavicle)!);
  armBones.rightClavicle.quaternion.copy(referenceQuaternions.get(armBones.rightClavicle)!);
  armBones.leftHand.quaternion.copy(referenceQuaternions.get(armBones.leftHand)!);
  armBones.rightHand.quaternion.copy(referenceQuaternions.get(armBones.rightHand)!);

  if (logicalMode === 'fight') {
    applyTorsoOffset(rig, targets.torsoLean, targets.torsoTwist);
  }
  rig.model.updateWorldMatrix(true, true);
  if (timeline.family === 'bow') {
    solveArm(
      rig,
      armBones.leftUpperArm,
      armBones.leftForearm,
      armBones.leftHand,
      targets.left,
      1,
    );
    rig.model.updateWorldMatrix(true, true);
    if (
      rig.rangedMount
      && (timeline.phase === 'draw' || timeline.phase === 'aim')
    ) {
      const draw = timeline.phase === 'draw' ? timeline.phaseProgress : 1;
      const nockTarget = rig.scratchVectors[13]!.set(
        0,
        0,
        THREE.MathUtils.lerp(-0.06, -0.42, draw),
      );
      rig.rangedMount.localToWorld(nockTarget);
      solveArmToWorld(
        rig,
        armBones.rightUpperArm,
        armBones.rightForearm,
        armBones.rightHand,
        nockTarget,
        -1,
      );
    } else {
      solveArm(
        rig,
        armBones.rightUpperArm,
        armBones.rightForearm,
        armBones.rightHand,
        targets.right,
        -1,
      );
    }
  } else {
    solveArm(
      rig,
      armBones.rightUpperArm,
      armBones.rightForearm,
      armBones.rightHand,
      targets.right,
      -1,
    );
    rig.model.updateWorldMatrix(true, true);
    const supportMount = timeline.ranged ? rig.rangedMount : rig.tool;
    const supportGrip = supportMount?.userData.workerToolSupportGripLocal as
      | readonly [number, number, number]
      | undefined;
    if (supportMount && supportGrip) {
      const supportTarget = rig.scratchVectors[13]!.set(...supportGrip);
      supportMount.localToWorld(supportTarget);
      solveArmToWorld(
        rig,
        armBones.leftUpperArm,
        armBones.leftForearm,
        armBones.leftHand,
        supportTarget,
        1,
      );
    } else {
      solveArm(
        rig,
        armBones.leftUpperArm,
        armBones.leftForearm,
        armBones.leftHand,
        targets.left,
        1,
      );
    }
  }
  armBones.leftHand.quaternion.copy(referenceQuaternions.get(armBones.leftHand)!);
  armBones.rightHand.quaternion.copy(referenceQuaternions.get(armBones.rightHand)!);
  rig.model.updateWorldMatrix(true, true);
}

function applyTorsoOffset(
  rig: CombatWeaponRig,
  lean: number,
  twist: number,
): void {
  const lower = rig.torsoBones.spineLower;
  const upper = rig.torsoBones.spineUpper;
  const offset = rig.scratchQuaternions[0]!;
  const euler = rig.scratchEuler;
  if (lower) {
    euler.set(lean * 0.45, twist * 0.42, 0, 'XYZ');
    lower.quaternion.multiply(offset.setFromEuler(euler)).normalize();
  }
  if (upper) {
    euler.set(lean * 0.55, twist * 0.58, -twist * 0.08, 'XYZ');
    upper.quaternion.multiply(offset.setFromEuler(euler)).normalize();
  }
}

function targetsForTimeline(
  timeline: CombatAttackTimeline,
  target: FamilyTargets,
): FamilyTargets {
  const p = timeline.poseProgress;
  switch (timeline.family) {
    case 'spear-pike':
      return meleeTargets(p, SPEAR_GUARD, SPEAR_WIND_UP, SPEAR_CONTACT, target);
    case 'halberd':
      return meleeTargets(p, HALBERD_GUARD, HALBERD_WIND_UP, HALBERD_CONTACT, target);
    case 'sword-shield':
      return meleeTargets(p, SWORD_GUARD, SWORD_WIND_UP, SWORD_CONTACT, target);
    case 'bow':
      return rangedTargets(p, 0.34, 0.72,
        BOW_RELOAD,
        BOW_RAISED,
        BOW_AIM,
        target,
      );
    case 'crossbow':
      return rangedTargets(p, 0.52, 0.74,
        CROSSBOW_RELOAD,
        CROSSBOW_RAISED,
        CROSSBOW_AIM,
        target,
      );
  }
}

type KeyTargets = {
  left: ArmTarget;
  right: ArmTarget;
  lean: number;
  twist: number;
};

const SPEAR_GUARD = keyTarget([0.12, 0.04, 0.62], [-0.18, -0.2, 0.4], 0.02, 0);
const SPEAR_WIND_UP = keyTarget([0.02, 0.2, 0.22], [-0.4, 0.08, 0.04], -0.04, -0.28);
const SPEAR_CONTACT = keyTarget([0.04, 0.08, 0.98], [-0.08, -0.04, 0.92], 0.12, 0.12);
const HALBERD_GUARD = keyTarget([0.18, 0.08, 0.58], [-0.24, -0.2, 0.36], 0.02, 0);
const HALBERD_WIND_UP = keyTarget([0.12, 0.44, 0.26], [-0.42, 0.58, 0.12], -0.08, -0.34);
const HALBERD_CONTACT = keyTarget([0.06, -0.02, 0.94], [0.16, -0.12, 0.88], 0.15, 0.3);
const SWORD_GUARD = keyTarget([0.2, -0.08, 0.62], [-0.22, -0.1, 0.68], 0.01, 0);
const SWORD_WIND_UP = keyTarget([0.22, 0.02, 0.64], [-0.5, 0.48, 0.1], -0.04, -0.42);
const SWORD_CONTACT = keyTarget([0.08, 0.02, 0.82], [0.1, 0.04, 0.92], 0.12, 0.38);
const BOW_RELOAD = keyTarget([0.22, -0.26, 0.3], [-0.14, -0.18, 0.42], 0.04, 0);
const BOW_RAISED = keyTarget([0.08, 0.04, 0.88], [-0.32, 0.14, 0.28], -0.01, -0.08);
const BOW_AIM = keyTarget([0.06, 0.08, 0.94], [-0.38, 0.16, 0.18], -0.02, -0.1);
const CROSSBOW_RELOAD = keyTarget([0.18, -0.3, 0.28], [-0.18, -0.34, 0.28], 0.13, 0);
const CROSSBOW_RAISED = keyTarget([0.1, -0.02, 0.72], [-0.16, -0.04, 0.76], 0.01, 0);
const CROSSBOW_AIM = keyTarget([0.08, 0.02, 0.84], [-0.1, 0.04, 0.9], -0.02, 0);

function keyTarget(
  left: ArmTarget,
  right: ArmTarget,
  lean: number,
  twist: number,
): KeyTargets {
  return { left, right, lean, twist };
}

function meleeTargets(
  progress: number,
  guard: KeyTargets,
  windUp: KeyTargets,
  contact: KeyTargets,
  target: FamilyTargets,
): FamilyTargets {
  if (progress < 0.28) {
    return mixTargets(contact, guard, smoothstep(progress, 0, 0.28), target);
  }
  if (progress < 0.56) return copyKeyTargets(guard, target);
  if (progress < 0.86) {
    return mixTargets(guard, windUp, smoothstep(progress, 0.56, 0.86), target);
  }
  return mixTargets(windUp, contact, smoothstep(progress, 0.86, 1), target);
}

function rangedTargets(
  progress: number,
  reloadEnd: number,
  aimStart: number,
  reload: KeyTargets,
  raised: KeyTargets,
  aim: KeyTargets,
  target: FamilyTargets,
): FamilyTargets {
  if (progress < reloadEnd) {
    return mixTargets(reload, raised, smoothstep(progress, 0, reloadEnd) * 0.35, target);
  }
  if (progress < aimStart) {
    return mixTargets(reload, raised, smoothstep(progress, reloadEnd, aimStart), target);
  }
  return mixTargets(raised, aim, smoothstep(progress, aimStart, 1), target);
}

function copyKeyTargets(value: KeyTargets, target: FamilyTargets): FamilyTargets {
  copyArmTarget(value.left, target.left);
  copyArmTarget(value.right, target.right);
  target.torsoLean = value.lean;
  target.torsoTwist = value.twist;
  return target;
}

function mixTargets(
  a: KeyTargets,
  b: KeyTargets,
  t: number,
  target: FamilyTargets,
): FamilyTargets {
  mixArmTarget(a.left, b.left, t, target.left);
  mixArmTarget(a.right, b.right, t, target.right);
  target.torsoLean = THREE.MathUtils.lerp(a.lean, b.lean, t);
  target.torsoTwist = THREE.MathUtils.lerp(a.twist, b.twist, t);
  return target;
}

function mixArmTarget(a: ArmTarget, b: ArmTarget, t: number, target: ArmTarget): void {
  target[0] = THREE.MathUtils.lerp(a[0], b[0], t);
  target[1] = THREE.MathUtils.lerp(a[1], b[1], t);
  target[2] = THREE.MathUtils.lerp(a[2], b[2], t);
}

function copyArmTarget(source: ArmTarget, target: ArmTarget): void {
  target[0] = source[0];
  target[1] = source[1];
  target[2] = source[2];
}

function smoothstep(value: number, min: number, max: number): number {
  return THREE.MathUtils.smoothstep(value, min, max);
}

function solveArm(
  rig: CombatWeaponRig,
  upper: THREE.Bone,
  forearm: THREE.Bone,
  hand: THREE.Bone,
  target: ArmTarget,
  sideSign: 1 | -1,
): void {
  const shoulder = upper.getWorldPosition(rig.scratchVectors[0]!);
  const elbow = forearm.getWorldPosition(rig.scratchVectors[1]!);
  const palm = hand.getWorldPosition(rig.scratchVectors[2]!);
  const upperLength = Math.max(1e-4, shoulder.distanceTo(elbow));
  const lowerLength = Math.max(1e-4, elbow.distanceTo(palm));
  const totalLength = upperLength + lowerLength;
  const modelWorldQuaternion = rig.model.getWorldQuaternion(rig.scratchQuaternions[1]!);
  const right = rig.scratchVectors[3]!.set(1, 0, 0).applyQuaternion(modelWorldQuaternion);
  const up = rig.scratchVectors[4]!.set(0, 1, 0).applyQuaternion(modelWorldQuaternion);
  const forward = rig.scratchVectors[5]!.set(0, 0, 1).applyQuaternion(modelWorldQuaternion);
  const handTarget = rig.scratchVectors[6]!.copy(shoulder)
    .addScaledVector(right, target[0] * totalLength)
    .addScaledVector(up, target[1] * totalLength)
    .addScaledVector(forward, target[2] * totalLength);
  solveArmToWorld(rig, upper, forearm, hand, handTarget, sideSign);
}

function solveArmToWorld(
  rig: CombatWeaponRig,
  upper: THREE.Bone,
  forearm: THREE.Bone,
  hand: THREE.Bone,
  handTarget: THREE.Vector3,
  sideSign: 1 | -1,
): void {
  const shoulder = upper.getWorldPosition(rig.scratchVectors[0]!);
  const elbow = forearm.getWorldPosition(rig.scratchVectors[1]!);
  const palm = hand.getWorldPosition(rig.scratchVectors[2]!);
  const upperLength = Math.max(1e-4, shoulder.distanceTo(elbow));
  const lowerLength = Math.max(1e-4, elbow.distanceTo(palm));
  const totalLength = upperLength + lowerLength;
  const modelWorldQuaternion = rig.model.getWorldQuaternion(rig.scratchQuaternions[1]!);
  const right = rig.scratchVectors[3]!.set(1, 0, 0).applyQuaternion(modelWorldQuaternion);
  const up = rig.scratchVectors[4]!.set(0, 1, 0).applyQuaternion(modelWorldQuaternion);
  const forward = rig.scratchVectors[5]!.set(0, 0, 1).applyQuaternion(modelWorldQuaternion);
  const shoulderToHand = rig.scratchVectors[7]!.copy(handTarget).sub(shoulder);
  const distance = THREE.MathUtils.clamp(
    shoulderToHand.length(),
    1e-4,
    totalLength - 1e-4,
  );
  const direction = shoulderToHand.normalize();
  const along = (
    upperLength * upperLength
    - lowerLength * lowerLength
    + distance * distance
  ) / (2 * distance);
  const bendDistance = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const preferredBend = rig.scratchVectors[8]!.copy(right).multiplyScalar(sideSign * 0.76)
    .addScaledVector(up, -0.58)
    .addScaledVector(forward, 0.18);
  preferredBend.addScaledVector(direction, -preferredBend.dot(direction)).normalize();
  const elbowTarget = rig.scratchVectors[9]!.copy(shoulder)
    .addScaledVector(direction, along)
    .addScaledVector(preferredBend, bendDistance);
  aimBoneAt(rig, upper, forearm, elbowTarget);
  upper.updateWorldMatrix(true, true);
  aimBoneAt(rig, forearm, hand, handTarget);
  forearm.updateWorldMatrix(true, true);
}

function aimBoneAt(
  rig: CombatWeaponRig,
  bone: THREE.Bone,
  child: THREE.Bone,
  targetWorld: THREE.Vector3,
): void {
  const origin = bone.getWorldPosition(rig.scratchVectors[10]!);
  const desiredWorld = rig.scratchVectors[11]!.copy(targetWorld).sub(origin).normalize();
  const parentWorld = bone.parent!.getWorldQuaternion(rig.scratchQuaternions[2]!);
  const desiredParent = desiredWorld.applyQuaternion(parentWorld.invert());
  const boneAxis = rig.scratchVectors[12]!.copy(child.position).normalize();
  bone.quaternion.setFromUnitVectors(boneAxis, desiredParent).normalize();
}
