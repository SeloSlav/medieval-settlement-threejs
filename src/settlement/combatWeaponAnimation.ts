import * as THREE from 'three';
import type { WorkerToolKind } from './workerTools.ts';
import type { MilitaryEquipmentCombatStance } from './militaryEquipment.ts';
import { MILITARY_GRIP_BONES, MILITARY_LEFT_GRIP_BONES } from './militaryHandGrip.ts';
import { CROSSBOW_FRAME } from './militaryWeaponGeometry.ts';
import { createWeaponAttackMotion, sampleWeaponAttackMotion, type WeaponAttackMotion } from './weaponAttackMotion.ts';

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
const LEFT_ARM_KEYS = ARM_KEYS.slice(0, 4);
const RIGHT_ARM_KEYS = ARM_KEYS.slice(4);
const RANGED_FALLBACK_DISTANCE = 3.25;

const FIXED_PRESENTATIONS: Partial<Record<WorkerToolKind, CombatWeaponPresentation>> = {
  spear: presentation('spear-pike', 'melee', false, 1.1, null, true),
  'spear-shield': presentation('spear-pike', 'melee', false, 1, null, true),
  'pike-kit': presentation('spear-pike', 'melee', false, 0.94, null, true),
  sidearm: presentation('sword-shield', 'melee', false, 1, null, true),
  'sidearm-shield': presentation('sword-shield', 'melee', false, 0.82, null, true),
  'sword-shield': presentation('sword-shield', 'melee', false, 0.92, null, true),
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
      : presentation('sword-shield', 'melee', false, 0.9, null, true);
  }
  if (tool === 'crossbow') {
    return distantTarget
      ? presentation('crossbow', 'ranged', true, 2.45, 'bolt', true)
      : presentation('sword-shield', 'melee', false, 0.9, null, true);
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
  carryGripMount: THREE.Group | null;
  carryGripBaseQuaternion: THREE.Quaternion;
  carryGripBasePosition: THREE.Vector3;
  carryGripBasis: THREE.Matrix4;
  elbowHandDirection: THREE.Vector3;
  solveWithHandDirection: boolean;
  gripBones: THREE.Bone[];
  leftGripBones: THREE.Bone[];
  headBones: THREE.Bone[];
  twistBones: { left: THREE.Bone[]; right: THREE.Bone[] };
  attackMotion: WeaponAttackMotion;
  attackMatrix: THREE.Matrix4;
  attackOrigin: THREE.Vector3;
  attackOrientation: THREE.Quaternion;
  attackScale: THREE.Vector3;
  bodyCenter: THREE.Vector3;
  bodyOrientation: THREE.Quaternion;
  armLength: number;
  nockedArrow: THREE.Group | null;
  bowString: THREE.Line | null;
  bowStringRestCenter: THREE.Vector3 | null;
  loadedCrossbowBolt: THREE.Group | null;
  crossbowCord: THREE.Line | null;
  equipmentScratch: THREE.Vector3;
  armBones: Record<ArmBoneKey, THREE.Bone>;
  torsoBones: Partial<Record<TorsoBoneKey, THREE.Bone>>;
  referenceQuaternions: Map<THREE.Bone, THREE.Quaternion>;
  referenceModelQuaternions: Map<THREE.Bone, THREE.Quaternion>;
  ownedBones: THREE.Bone[];
  baseQuaternions: THREE.Quaternion[];
  scratchVectors: THREE.Vector3[];
  scratchQuaternions: THREE.Quaternion[];
  scratchEuler: THREE.Euler;
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
  const gripBones = MILITARY_GRIP_BONES.map(name => model.getObjectByName(name))
    .filter((bone): bone is THREE.Bone => bone instanceof THREE.Bone);
  const leftGripBones = MILITARY_LEFT_GRIP_BONES.map(name => model.getObjectByName(name))
    .filter((bone): bone is THREE.Bone => bone instanceof THREE.Bone);
  const headBones = ['Neck', 'NeckTwist01', 'NeckTwist02', 'Head'].map(name => model.getObjectByName(name))
    .filter((bone): bone is THREE.Bone => bone instanceof THREE.Bone);
  const findTwists = (prefix: string) => ['UpperarmTwist01', 'UpperarmTwist02', 'ForearmTwist01', 'ForearmTwist02']
    .map(name => model.getObjectByName(prefix + name)).filter((bone): bone is THREE.Bone => bone instanceof THREE.Bone);
  const twistBones = {left: findTwists('L_'), right: findTwists('R_')};
  const ownedBones = [...Object.values(armBones), ...Object.values(torsoBones), ...gripBones, ...leftGripBones, ...headBones, ...twistBones.left, ...twistBones.right];
  const referenceQuaternions = new Map<THREE.Bone, THREE.Quaternion>();
  const referenceModelQuaternions = new Map<THREE.Bone, THREE.Quaternion>();
  const modelInverse = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const bone of ownedBones) {
    referenceQuaternions.set(bone, bone.quaternion.clone());
    referenceModelQuaternions.set(bone, bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(modelInverse));
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
    const cord = crossbowCord as THREE.Line | null;
    if (cord) cord.geometry = cord.geometry.clone();
  }
  return {
    model,
    tool,
    rangedMount,
    shieldMount: mounts?.find(mount => mount.parent === armBones.leftHand
      && mount.userData.workerToolCombatRole === 'always') ?? null,
    carryGripMount: null,
    carryGripBaseQuaternion: new THREE.Quaternion(),
    carryGripBasePosition: new THREE.Vector3(),
    carryGripBasis: new THREE.Matrix4(),
    elbowHandDirection: new THREE.Vector3(),
    solveWithHandDirection: false,
    gripBones,
    leftGripBones,
    headBones,
    twistBones,
    attackMotion: createWeaponAttackMotion(),
    attackMatrix: new THREE.Matrix4(),
    attackOrigin: new THREE.Vector3(),
    attackOrientation: new THREE.Quaternion(),
    attackScale: new THREE.Vector3(),
    bodyCenter: new THREE.Vector3(),
    bodyOrientation: new THREE.Quaternion(),
    armLength: 0,
    nockedArrow,
    bowString,
    bowStringRestCenter,
    loadedCrossbowBolt,
    crossbowCord,
    equipmentScratch: new THREE.Vector3(),
    armBones,
    torsoBones,
    referenceQuaternions,
    referenceModelQuaternions,
    ownedBones,
    baseQuaternions: ownedBones.map(() => new THREE.Quaternion()),
    scratchVectors: Array.from({ length: 16 }, () => new THREE.Vector3()),
    scratchQuaternions: Array.from({ length: 6 }, () => new THREE.Quaternion()),
    scratchEuler: new THREE.Euler(),
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
  if (rig.carryGripMount) {
    rig.carryGripMount.quaternion.copy(rig.carryGripBaseQuaternion);
    rig.carryGripMount.position.copy(rig.carryGripBasePosition);
    rig.carryGripMount = null;
  }
  for (let index = 0; index < rig.ownedBones.length; index += 1) {
    rig.ownedBones[index]!.quaternion.copy(rig.baseQuaternions[index]!);
  }
  rig.overlayApplied = false;
}

const CARRY_RIGHT: ArmTarget = [-0.12, -0.42, 0.5];
const CARRY_LEFT: ArmTarget = [0.12, -0.42, 0.5];
const CARRY_CROSSBOW: ArmTarget = [0.15, -0.45, 0.38];
const CARRY_SWORD: ArmTarget = [-0.08, -0.985, 0.075];
const SWORD_GRIP_CANT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 4);
const POLE_FINGER_AXIS = new THREE.Vector3(0, 0, 1);
const POLE_FINGER_POSES = [[.85, 1.25], [.78, 1.28], [.54, 1.4], [.2, 1.58]]
  .flatMap(pair => pair.map(angle => new THREE.Quaternion().setFromAxisAngle(POLE_FINGER_AXIS, angle)));
// The low-poly source has no authored finger articulation. Distribute curl
// across the diagonal grip to retain the continuous knuckle silhouette.
const SWORD_FINGER_AXIS = new THREE.Vector3(0, Math.SQRT1_2, Math.SQRT1_2);
const SWORD_FINGER_POSES = [[.15, 1.4], [.42, 1.35], [.75, 1.4], [1.03, 1.35]]
  .flatMap(pair => pair.map(angle => new THREE.Quaternion().setFromAxisAngle(SWORD_FINGER_AXIS, angle)));
const STRING_FINGER_POSES = [[1.05, 1.65], [1.05, 1.65], [1.05, 1.65], [1.5, 1.45]]
  .flatMap(pair => pair.map(angle => new THREE.Quaternion().setFromAxisAngle(POLE_FINGER_AXIS, angle)));
const STRING_GRIP_LOCAL = [-.026, .056, -.0071] as const;
const CLOSED_THUMB_POSE = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -.55, -.6, 'ZYX'));
const UPRIGHT_CARRY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.06);
const LOW_BLADE_CARRY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 2.1);
const PALM_WEAPON_FRAME = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
const CROSSBOW_CARRY = PALM_WEAPON_FRAME.clone()
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.12))
  .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.65));
const CROSSBOW_SUPPORT_HAND = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
const SHIELD_CARRY = new THREE.Quaternion();

/** Like the standard bearer, own only the carrying arm after the base mixer.
 * Keep the wrist relative to the model's facing, so torso sway cannot whip a
 * long pole back and forth. The free arm, torso and legs keep their animation. */
export function applyMilitaryCarryPose(rig: CombatWeaponRig, tool: WorkerToolKind, mode: string): boolean {
  if (!rig.tool || !resolveCombatWeaponPresentation(tool, Infinity)
    || !['walk', 'run', 'flee', 'idle', 'wait', 'relax', 'hurt'].includes(mode)) return false;
  if (!rig.overlayApplied) captureBaseQuaternions(rig);
  const primaryLeft = tool === 'bow';
  const primaryMount = primaryLeft ? rig.rangedMount ?? rig.tool : rig.tool;
  const orientation = tool === 'crossbow' ? CROSSBOW_CARRY
    : tool === 'sidearm' || tool === 'sidearm-shield' || tool === 'sword-shield'
      ? LOW_BLADE_CARRY : UPRIGHT_CARRY;
  poseCarryArm(rig, primaryLeft, tool === 'crossbow' ? CARRY_CROSSBOW
    : orientation === LOW_BLADE_CARRY ? CARRY_SWORD
    : primaryLeft ? CARRY_LEFT : CARRY_RIGHT);
  orientCarryPalm(rig, primaryLeft, primaryMount, orientation);
  if (!primaryLeft) {
    const poses = orientation === LOW_BLADE_CARRY || tool === 'crossbow' ? SWORD_FINGER_POSES : POLE_FINGER_POSES;
    for (let i = 0; i < 8; i++) rig.gripBones[i]?.quaternion.copy(poses[i]!);
    rig.gripBones[8]?.quaternion.copy(CLOSED_THUMB_POSE);
  } else closeSupportFingers(rig);
  if (tool === 'crossbow') {
    const grip = primaryMount.userData.workerToolSupportGripLocal as readonly [number, number, number] | undefined;
    if (grip) {
      rig.armBones.leftClavicle.quaternion.copy(rig.referenceQuaternions.get(rig.armBones.leftClavicle)!);
      rig.armBones.leftUpperArm.quaternion.copy(rig.referenceQuaternions.get(rig.armBones.leftUpperArm)!);
      rig.armBones.leftForearm.quaternion.copy(rig.referenceQuaternions.get(rig.armBones.leftForearm)!);
      rig.armBones.leftHand.quaternion.copy(rig.referenceQuaternions.get(rig.armBones.leftHand)!);
      rig.model.updateWorldMatrix(true, true);
      const target = primaryMount.localToWorld(rig.scratchVectors[13]!.set(...grip));
      const handScale = rig.armBones.leftHand.getWorldScale(rig.scratchVectors[15]!);
      const palmOffset = rig.scratchVectors[14]!.set(0.006, 0.038, 0).multiply(handScale)
        .applyQuaternion(CROSSBOW_SUPPORT_HAND)
        .applyQuaternion(rig.model.getWorldQuaternion(rig.scratchQuaternions[0]!));
      target.sub(palmOffset);
      solveArmToWorld(rig, rig.armBones.leftUpperArm, rig.armBones.leftForearm, rig.armBones.leftHand, target, 1, 'upright');
      const handWorld = rig.model.getWorldQuaternion(rig.scratchQuaternions[0]!).multiply(CROSSBOW_SUPPORT_HAND);
      const parentInverse = rig.armBones.leftHand.parent!.getWorldQuaternion(rig.scratchQuaternions[1]!).invert();
      rig.armBones.leftHand.quaternion.copy(parentInverse).multiply(handWorld).normalize();
    }
  } else if (rig.shieldMount) {
    poseCarryArm(rig, true, CARRY_LEFT);
    orientCarryGrip(rig, rig.armBones.leftHand, rig.shieldMount, SHIELD_CARRY);
  }
  updateArmTwist(rig, primaryLeft);
  if (!primaryLeft && (tool === 'crossbow' || rig.shieldMount)) updateArmTwist(rig, true);
  rig.model.updateWorldMatrix(true, true);
  return true;
}

function poseCarryArm(rig: CombatWeaponRig, left: boolean, target: ArmTarget): void {
  resetArm(rig, left);
  solveArm(rig, left ? rig.armBones.leftUpperArm : rig.armBones.rightUpperArm,
    left ? rig.armBones.leftForearm : rig.armBones.rightForearm,
    left ? rig.armBones.leftHand : rig.armBones.rightHand, target, left ? 1 : -1,
    target[1] < -.8 ? 'low' : 'upright');
}
function orientCarryGrip(rig: CombatWeaponRig, hand: THREE.Bone, mount: THREE.Group, orientation: THREE.Quaternion): void {
  const desiredWorld = rig.model.getWorldQuaternion(rig.scratchQuaternions[0]!).multiply(orientation);
  const parentInverse = hand.parent!.getWorldQuaternion(rig.scratchQuaternions[1]!).invert();
  const mountInverse = rig.scratchQuaternions[2]!.copy(mount.quaternion).invert();
  hand.quaternion.copy(parentInverse).multiply(desiredWorld).multiply(mountInverse).normalize();
  hand.updateWorldMatrix(true, false);
}

/** The worker mesh's right palm faces local -X (left +X), fingers extend +Y,
 * and the thumb extends +Z. Pose this anatomical frame
 * first; compensate the weapon mount instead of letting its old rotation
 * turn the palm outward. The handle then sits inside the palm, not at the guard. */
function orientCarryPalm(rig: CombatWeaponRig, left: boolean, mount: THREE.Group, orientation: THREE.Quaternion, diagonal = orientation === LOW_BLADE_CARRY || orientation === CROSSBOW_CARRY): void {
  if (!rig.carryGripMount) {
    rig.carryGripMount = mount;
    rig.carryGripBaseQuaternion.copy(mount.quaternion);
    rig.carryGripBasePosition.copy(mount.position);
  }
  const handModel = rig.scratchQuaternions[3]!.copy(orientation).multiply(PALM_WEAPON_FRAME);
  if (diagonal) handModel.multiply(SWORD_GRIP_CANT);
  const hand = left ? rig.armBones.leftHand : rig.armBones.rightHand;
  const handWorld = rig.model.getWorldQuaternion(rig.scratchQuaternions[0]!).multiply(handModel);
  const parentInverse = hand.parent!.getWorldQuaternion(rig.scratchQuaternions[1]!).invert();
  hand.quaternion.copy(parentInverse).multiply(handWorld).normalize();
  mount.quaternion.copy(handModel).invert().multiply(orientation).normalize();
  const grip = mount.userData.workerToolGripLocal as readonly [number, number, number] | undefined;
  const offset = rig.scratchVectors[14]!.set(...(grip ?? [0, 0, 0] as const))
    .multiply(mount.scale).applyQuaternion(mount.quaternion);
  const handSize = left ? 1 : Number(hand.userData.militaryGripScale ?? 1);
  mount.position.set(left ? 0.005 : -0.01, left ? 0.0383 : 0.044, -0.0071).multiplyScalar(handSize).sub(offset);
  hand.updateWorldMatrix(true, false);
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
  poseCarryArm(rig, true, [.46, -.48, .16]);
  const hand = rig.armBones.leftHand;
  const world = rig.model.getWorldQuaternion(rig.scratchQuaternions[3]!).multiply(PALM_WEAPON_FRAME);
  hand.quaternion.copy(hand.parent!.getWorldQuaternion(rig.scratchQuaternions[1]!).invert()).multiply(world).normalize();
  closeSupportFingers(rig);
  updateArmTwist(rig, true);
  rig.model.updateWorldMatrix(true, true);
}
export function resetCombatWeaponRig(rig: CombatWeaponRig): void {
  restoreCombatWeaponPose(rig);
  if (rig.nockedArrow) rig.nockedArrow.visible = false;
  restoreBowString(rig);
  if (rig.loadedCrossbowBolt) rig.loadedCrossbowBolt.visible = true;
  updateCrossbowCord(rig, 1);
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
  rig.crossbowCord?.geometry.dispose();
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
    new THREE.CylinderGeometry(0.004, 0.004, 0.36, 7),
    new THREE.MeshStandardMaterial({
      color: 0x8c6335,
      roughness: 0.86,
      metalness: 0,
    }),
  );
  shaft.position.set(0, CROSSBOW_FRAME.nutY + 0.18, CROSSBOW_FRAME.muzzle[2]);
  const point = new THREE.Mesh(
    new THREE.ConeGeometry(0.009, 0.025, 6),
    new THREE.MeshStandardMaterial({
      color: 0xaab0b3,
      roughness: 0.38,
      metalness: 0.72,
    }),
  );
  point.position.set(0, CROSSBOW_FRAME.nutY + 0.3725, CROSSBOW_FRAME.muzzle[2]);
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
      const hand = rig.armBones.rightHand;
      hand.localToWorld(rig.equipmentScratch.set(...STRING_GRIP_LOCAL)
        .multiplyScalar(Number(hand.userData.militaryGripScale ?? 1)));
      rig.rangedMount.worldToLocal(rig.equipmentScratch);
      // Aim from the string fingers across the upper edge of the bow hand.
      // A fixed +Z arrow went straight through the middle of the leather grip.
      const direction = rig.scratchVectors[14]!.set(.027, .068, 0)
        .sub(rig.equipmentScratch).normalize();
      arrow.quaternion.setFromUnitVectors(rig.scratchVectors[13]!.set(0, 0, 1), direction);
      // The modeled nock is 0.21 m behind the arrow's origin.
      arrow.position.copy(rig.equipmentScratch).addScaledVector(direction, .21);
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
  updateCrossbowCord(rig, timeline.releaseEdge ? 0 : rig.attackMotion.reload);
}

function updateCrossbowCord(rig: CombatWeaponRig, drawn: number): void {
  if (rig.crossbowCord) {
    rig.crossbowCord.visible = true;
    const position = rig.crossbowCord.geometry.getAttribute('position') as THREE.BufferAttribute;
    position.setY(1, THREE.MathUtils.lerp(CROSSBOW_FRAME.stringTipY, CROSSBOW_FRAME.nutY, drawn));
    position.needsUpdate = true;
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
function closeSupportFingers(rig: CombatWeaponRig, diagonal = false): void {
  for (let i = 0; i < 8; i++) {
    const bone = rig.leftGripBones[i];
    if (diagonal) bone?.quaternion.copy(SWORD_FINGER_POSES[i]!).invert();
    else bone?.quaternion.copy(POLE_FINGER_POSES[i]!).invert();
  }
  rig.leftGripBones[8]?.quaternion.setFromEuler(rig.scratchEuler.set(0, .25, .3));
}

function closeWeaponHand(rig: CombatWeaponRig, diagonal: boolean): void {
  const poses = diagonal ? SWORD_FINGER_POSES : POLE_FINGER_POSES;
  for (let i = 0; i < 8; i++) rig.gripBones[i]?.quaternion.copy(poses[i]!);
  rig.gripBones[8]?.quaternion.copy(CLOSED_THUMB_POSE);
}
function resetArm(rig: CombatWeaponRig, left: boolean): void {
  for (const bone of left ? rig.twistBones.left : rig.twistBones.right) bone.quaternion.copy(rig.referenceQuaternions.get(bone)!);
  for (const key of left ? LEFT_ARM_KEYS : RIGHT_ARM_KEYS) {
    const bone = rig.armBones[key];
    bone.quaternion.copy(rig.referenceQuaternions.get(bone)!);
  }
  // The IK reads update their ancestor chains. Descendant skin and equipment
  // matrices are propagated once, after the complete pose is solved.
}

function updateArmTwist(rig: CombatWeaponRig, left: boolean): void {
  const bones = left ? rig.twistBones.left : rig.twistBones.right;
  if (bones.length !== 4) return;
  for (let i = 0; i < 2; i++) {
    const joint = left ? i === 0 ? rig.armBones.leftForearm : rig.armBones.leftHand
      : i === 0 ? rig.armBones.rightForearm : rig.armBones.rightHand;
    const delta = rig.scratchQuaternions[0]!.copy(joint.quaternion)
      .multiply(rig.scratchQuaternions[1]!.copy(rig.referenceQuaternions.get(joint)!).invert());
    const length = Math.hypot(delta.y, delta.w);
    const twist = rig.scratchQuaternions[2]!.set(0, length > 1e-6 ? delta.y / length : 0, 0, length > 1e-6 ? delta.w / length : 1);
    if (twist.w < 0) twist.set(-twist.x, -twist.y, -twist.z, -twist.w);
    for (let j = 0; j < 2; j++) {
      const bone = bones[i * 2 + j]!;
      bone.quaternion.copy(rig.referenceQuaternions.get(bone)!)
        .multiply(rig.scratchQuaternions[3]!.identity().slerp(twist, 1 / 3));
    }
  }
}

/** Convert a body-relative point to world space without borrowing solver scratch. */
function bodyPoint(rig: CombatWeaponRig, point: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(point).multiplyScalar(rig.armLength).applyQuaternion(rig.bodyOrientation).add(rig.bodyCenter);
}

const BOW_CHEEK_ANCHOR = new THREE.Vector3(-.22, .28, .06);
const STOCK_HAND_FRAME = PALM_WEAPON_FRAME.clone().invert().multiply(CROSSBOW_SUPPORT_HAND);
const THRUST_HAND_FRAME = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2)
  .multiply(PALM_WEAPON_FRAME).multiply(SWORD_GRIP_CANT);
const THRUST_SUPPORT_FRAME = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
  .multiply(PALM_WEAPON_FRAME).multiply(SWORD_GRIP_CANT);

/** A hand reaches a physical contact point. The wrist is behind that point by
 * the actual palm offset; the weapon never derives its aim from an elbow. */
function solveAttackHand(rig: CombatWeaponRig, left: boolean, contact: THREE.Vector3,
  handWorld: THREE.Quaternion, drawing = false, supportStock = false, spanningAmount = 0): void {
  const hand = left ? rig.armBones.leftHand : rig.armBones.rightHand;
  const size = left ? 1 : Number(hand.userData.militaryGripScale ?? 1);
  const offset = rig.scratchVectors[14]!;
  if (drawing) offset.set(...STRING_GRIP_LOCAL);
  else offset.set(left ? supportStock ? .014 : .005 : -.01, left ? .0383 : .044, -.0071);
  offset.multiplyScalar(size).multiply(hand.getWorldScale(rig.scratchVectors[15]!)).applyQuaternion(handWorld);
  const wristTarget = rig.scratchVectors[13]!.copy(contact).sub(offset);
  if (drawing) rig.elbowHandDirection.set(1, .5, 1).applyQuaternion(rig.bodyOrientation);
  else rig.elbowHandDirection.set(0, 1, 0).applyQuaternion(handWorld);
  if (spanningAmount > 0) rig.elbowHandDirection.lerp(rig.scratchVectors[14]!.set(0, 1, 0).applyQuaternion(rig.bodyOrientation), spanningAmount).normalize();
  rig.solveWithHandDirection = true;
  solveArmToWorld(rig, left ? rig.armBones.leftUpperArm : rig.armBones.rightUpperArm,
    left ? rig.armBones.leftForearm : rig.armBones.rightForearm, hand, wristTarget, left ? 1 : -1, 'upright');
  rig.solveWithHandDirection = false;
  hand.quaternion.copy(hand.parent!.getWorldQuaternion(rig.scratchQuaternions[1]!).invert()).multiply(handWorld).normalize();
  hand.updateWorldMatrix(true, false);
}

function attackContact(rig: CombatWeaponRig, local: readonly [number, number, number]): THREE.Vector3 {
  return rig.equipmentScratch.set(...local).applyMatrix4(rig.attackMatrix);
}

/** Rotate around the handle, keeping its axis fixed through the palm. The
 * cosine rule gives the forearm's cone about shoulder-to-wrist. Intersect
 * that cone with the grip's cone instead of folding the wrist to a guessed
 * roll. Two cheap refinements account for the wrist-to-contact offset. */
function alignAttackGrip(rig: CombatWeaponRig, left: boolean, contact: THREE.Vector3, handWorld: THREE.Quaternion): void {
  const hand = left ? rig.armBones.leftHand : rig.armBones.rightHand;
  const upper = left ? rig.armBones.leftUpperArm : rig.armBones.rightUpperArm;
  const forearm = left ? rig.armBones.leftForearm : rig.armBones.rightForearm;
  const shoulder = upper.getWorldPosition(rig.scratchVectors[0]!);
  const elbow = forearm.getWorldPosition(rig.scratchVectors[1]!);
  const wrist = hand.getWorldPosition(rig.scratchVectors[2]!);
  const upperLength = shoulder.distanceTo(elbow), lowerLength = elbow.distanceTo(wrist);
  const axis = rig.scratchVectors[3]!.set(0, 1, 0).applyQuaternion(rig.attackOrientation);
  const scale = hand.getWorldScale(rig.scratchVectors[4]!);
  const size = left ? 1 : Number(hand.userData.militaryGripScale ?? 1);
  for (let iteration = 0; iteration < 2; iteration++) {
    const offset = rig.scratchVectors[5]!.set(left ? .005 : -.01, left ? .0383 : .044, -.0071)
      .multiplyScalar(size).multiply(scale).applyQuaternion(handWorld);
    const direction = rig.scratchVectors[6]!.copy(contact).sub(offset).sub(shoulder);
    const distance = Math.max(1e-5, direction.length()); direction.divideScalar(distance);
    const fingers = rig.scratchVectors[7]!.set(0, 1, 0).applyQuaternion(handWorld);
    const axial = fingers.dot(axis), projectedDirection = direction.dot(axis);
    const handPlane = rig.scratchVectors[8]!.copy(fingers).addScaledVector(axis, -axial);
    const targetPlane = rig.scratchVectors[9]!.copy(direction).addScaledVector(axis, -projectedDirection);
    const denominator = handPlane.length() * targetPlane.length();
    if (denominator < 1e-5) return;
    const forearmCosine = THREE.MathUtils.clamp((lowerLength * lowerLength + distance * distance - upperLength * upperLength)
      / (2 * lowerLength * distance), -1, 1);
    const around = Math.acos(THREE.MathUtils.clamp((forearmCosine - axial * projectedDirection) / denominator, -1, 1));
    handPlane.normalize(); targetPlane.normalize();
    const align = Math.atan2(rig.scratchVectors[10]!.crossVectors(handPlane, targetPlane).dot(axis), handPlane.dot(targetPlane));
    const a = Math.atan2(Math.sin(align + around), Math.cos(align + around));
    const b = Math.atan2(Math.sin(align - around), Math.cos(align - around));
    // Keep one anatomical branch for the complete cycle. Selecting whichever
    // roll is momentarily closest flips the elbow when the two costs cross.
    const roll = left ? b : a;
    handWorld.premultiply(rig.scratchQuaternions[3]!.setFromAxisAngle(axis, roll)).normalize();
  }
}

/** The bow arm has one bend plane and a neutral wrist. Turning the shoulder
 * carries the palm inward; asking the wrist alone to do that twists the cuff.
 * Resolve the limb first, then place the bow at the resulting palm contact. */
function poseBowHoldingArm(rig: CombatWeaponRig, grip: readonly [number, number, number], handWorld: THREE.Quaternion): void {
  const { leftUpperArm: upper, leftForearm: forearm, leftHand: hand } = rig.armBones;
  const shoulder = upper.getWorldPosition(rig.scratchVectors[0]!);
  const elbow = forearm.getWorldPosition(rig.scratchVectors[1]!);
  const wrist = hand.getWorldPosition(rig.scratchVectors[2]!);
  const upperLength = shoulder.distanceTo(elbow), lowerLength = elbow.distanceTo(wrist);
  const offset = rig.scratchVectors[3]!.set(.005, .0383, -.0071)
    .multiply(hand.getWorldScale(rig.scratchVectors[4]!)).applyQuaternion(handWorld);
  const target = rig.scratchVectors[13]!.copy(attackContact(rig, grip)).sub(offset).sub(shoulder);
  // Aim forward from the leading shoulder rather than across the chest.
  const aim = rig.scratchVectors[4]!.set(0, .1, 1).normalize().applyQuaternion(rig.bodyOrientation);
  target.normalize().lerp(aim, rig.attackMotion.extension).normalize();
  // Author the hinge angle directly. It reaches exactly zero at aim without
  // an IK clamp or the square-root snap of a distance approaching full reach.
  const flex = (1 - rig.attackMotion.extension) * .55;
  const reach = Math.sqrt(upperLength * upperLength + lowerLength * lowerLength + 2 * upperLength * lowerLength * Math.cos(flex));
  const along = (upperLength * upperLength - lowerLength * lowerLength + reach * reach) / (2 * reach);
  const bendDistance = upperLength * lowerLength * Math.sin(flex) / reach;
  const bend = rig.scratchVectors[3]!.set(0, -1, 0).applyQuaternion(rig.attackOrientation);
  bend.addScaledVector(target, -bend.dot(target)).normalize();
  const upperDirection = rig.scratchVectors[14]!.copy(target).multiplyScalar(along).addScaledVector(bend, bendDistance).divideScalar(upperLength);
  const lowerDirection = rig.scratchVectors[15]!.copy(target).multiplyScalar(reach)
    .addScaledVector(upperDirection, -upperLength).divideScalar(lowerLength);
  alignBowArmFrame(rig, upper, upperDirection);
  alignBowArmFrame(rig, forearm, lowerDirection);
  hand.quaternion.identity();
  hand.updateWorldMatrix(true, false);
  rig.attackOrigin.set(.005, .0383, -.0071);
  hand.localToWorld(rig.attackOrigin);
  rig.attackOrigin.sub(rig.scratchVectors[0]!.set(...grip).multiply(rig.attackScale).applyQuaternion(rig.attackOrientation));
  rig.attackMatrix.compose(rig.attackOrigin, rig.attackOrientation, rig.attackScale);
}

function alignBowArmFrame(rig: CombatWeaponRig, bone: THREE.Bone, direction: THREE.Vector3): void {
  const up = rig.scratchVectors[0]!.set(0, 1, 0).applyQuaternion(rig.attackOrientation);
  const side = rig.scratchVectors[1]!.crossVectors(direction, up).normalize();
  up.crossVectors(side, direction).normalize();
  const world = rig.scratchQuaternions[0]!.setFromRotationMatrix(rig.carryGripBasis.makeBasis(side, direction, up));
  bone.quaternion.copy(bone.parent!.getWorldQuaternion(rig.scratchQuaternions[1]!).invert()).multiply(world).normalize();
  bone.updateWorldMatrix(true, false);
}

function applyTimelinePose(rig: CombatWeaponRig, timeline: CombatAttackTimeline, logicalMode: string): void {
  const motion = sampleWeaponAttackMotion(timeline.family, timeline.poseProgress, rig.attackMotion);
  if (logicalMode === 'fight') {
    for (const key of TORSO_KEYS) {
      const bone = rig.torsoBones[key];
      if (bone) bone.quaternion.copy(rig.referenceQuaternions.get(bone)!);
    }
    for (const bone of rig.headBones) bone.quaternion.copy(rig.referenceQuaternions.get(bone)!);
    applyTorsoOffset(rig, motion.lean, motion.turn);
  }
  resetArm(rig, false); resetArm(rig, true);
  const arms = rig.armBones;
  const rightShoulder = arms.rightUpperArm.getWorldPosition(rig.scratchVectors[13]!);
  const rightElbow = arms.rightForearm.getWorldPosition(rig.scratchVectors[14]!);
  const rightWrist = arms.rightHand.getWorldPosition(rig.scratchVectors[15]!);
  rig.armLength = rightShoulder.distanceTo(rightElbow) + rightElbow.distanceTo(rightWrist);
  rig.bodyCenter.copy(rightShoulder).add(arms.leftUpperArm.getWorldPosition(rig.scratchVectors[14]!)).multiplyScalar(.5);
  rig.model.getWorldQuaternion(rig.bodyOrientation);
  const mounts = rig.tool?.userData.workerToolMounts as THREE.Group[] | undefined;
  const mount = timeline.ranged ? rig.rangedMount : mounts?.find(m => m.userData.workerToolCombatRole === 'melee-held') ?? rig.tool;
  if (!mount) return;
  const primaryGrip = mount.userData.workerToolGripLocal as [number, number, number] ?? [0, 0, 0];
  const supportGrip = mount.userData.workerToolSupportGripLocal as [number, number, number] | undefined;
  mount.getWorldScale(rig.attackScale);
  rig.attackOrientation.copy(rig.bodyOrientation).multiply(motion.orientation);
  bodyPoint(rig, motion.grip, rig.attackOrigin);
  if (rig.shieldMount) rig.attackOrigin.add(rig.scratchVectors[14]!.set(timeline.family === 'spear-pike' ? -.4 : -.24, 0, 0)
    .multiplyScalar(rig.armLength).applyQuaternion(rig.bodyOrientation));
  rig.attackOrigin.sub(rig.scratchVectors[14]!.set(...primaryGrip).multiply(rig.attackScale).applyQuaternion(rig.attackOrientation));
  rig.attackMatrix.compose(rig.attackOrigin, rig.attackOrientation, rig.attackScale);
  const handWorld = rig.scratchQuaternions[4]!;
  if (timeline.family === 'bow') {
    handWorld.copy(rig.attackOrientation).multiply(PALM_WEAPON_FRAME);
    poseBowHoldingArm(rig, primaryGrip, handWorld);
    closeSupportFingers(rig);
    const restNock = attackContact(rig, [0, .068, -.135]);
    const cheek = bodyPoint(rig, BOW_CHEEK_ANCHOR, rig.scratchVectors[15]!);
    restNock.lerp(cheek, motion.draw);
    handWorld.copy(rig.bodyOrientation).multiply(PALM_WEAPON_FRAME);
    solveAttackHand(rig, false, restNock, handWorld, true);
    // String fingers stay vertical while the wrist follows the forearm in
    // the horizontal draw plane. A fixed forward wrist folds back on itself
    // when the drawing elbow moves behind the cheek.
    for (let iteration = 0; iteration < 3; iteration++) {
      const fingers = arms.rightHand.getWorldPosition(rig.scratchVectors[15]!)
        .sub(arms.rightForearm.getWorldPosition(rig.scratchVectors[14]!));
      const stringAxis = rig.scratchVectors[14]!.set(0, 1, 0).applyQuaternion(rig.bodyOrientation);
      fingers.addScaledVector(stringAxis, -fingers.dot(stringAxis) * motion.draw).normalize();
      const side = rig.scratchVectors[13]!.crossVectors(fingers, stringAxis).normalize();
      stringAxis.crossVectors(side, fingers).normalize();
      handWorld.setFromRotationMatrix(rig.carryGripBasis.makeBasis(side, fingers, stringAxis));
      solveAttackHand(rig, false, restNock, handWorld, true);
    }
    for (let i = 0; i < 8; i++) rig.gripBones[i]?.quaternion.copy(STRING_FINGER_POSES[i]!);
    rig.gripBones[8]?.quaternion.copy(CLOSED_THUMB_POSE);
  } else {
    const diagonal = timeline.family === 'sword-shield' || timeline.family === 'crossbow' || timeline.family === 'spear-pike';
    handWorld.copy(rig.attackOrientation).multiply(PALM_WEAPON_FRAME);
    if (diagonal) handWorld.multiply(SWORD_GRIP_CANT);
    if (timeline.family === 'spear-pike') handWorld.copy(rig.attackOrientation).multiply(THRUST_HAND_FRAME);
    const contact = attackContact(rig, primaryGrip);
    alignAttackGrip(rig, false, contact, handWorld);
    let handOff = 0;
    if (timeline.family === 'crossbow' && timeline.poseProgress > .14 && timeline.poseProgress < .72) {
      handOff = smoothstep(timeline.poseProgress, .14, .34) * (1 - smoothstep(timeline.poseProgress, .52, .72));
      const spanning = rig.scratchVectors[15]!.set(0, THREE.MathUtils.lerp(CROSSBOW_FRAME.stringTipY, CROSSBOW_FRAME.nutY, motion.reload), CROSSBOW_FRAME.stringZ)
        .applyMatrix4(rig.attackMatrix);
      contact.lerp(spanning, handOff);
    }
    solveAttackHand(rig, false, contact, handWorld, false, false, handOff);
    if (handOff > 0) {
      const carrying = rig.scratchQuaternions[5]!.copy(handWorld);
      for (let iteration = 0; iteration < 2; iteration++) {
        const forward = arms.rightHand.getWorldPosition(rig.scratchVectors[15]!)
          .sub(arms.rightForearm.getWorldPosition(rig.scratchVectors[14]!)).normalize();
        const palmBack = rig.scratchVectors[14]!.set(-1, 0, 0).applyQuaternion(rig.bodyOrientation);
        palmBack.addScaledVector(forward, -palmBack.dot(forward)).normalize();
        const thumb = rig.scratchVectors[13]!.crossVectors(palmBack, forward).normalize();
        const spanning = rig.scratchQuaternions[3]!.setFromRotationMatrix(rig.carryGripBasis.makeBasis(palmBack, forward, thumb));
        handWorld.copy(carrying).slerp(spanning, handOff);
        solveAttackHand(rig, false, contact, handWorld, false, false, handOff);
      }
    }
    closeWeaponHand(rig, diagonal);
    if (supportGrip) {
      handWorld.copy(rig.attackOrientation).multiply(timeline.family === 'crossbow' ? STOCK_HAND_FRAME : PALM_WEAPON_FRAME);
      if (timeline.family === 'spear-pike') handWorld.copy(rig.attackOrientation).multiply(THRUST_SUPPORT_FRAME);
      if (timeline.family === 'halberd') handWorld.multiply(SWORD_GRIP_CANT);
      if (timeline.family !== 'crossbow') alignAttackGrip(rig, true, attackContact(rig, supportGrip), handWorld);
      solveAttackHand(rig, true, attackContact(rig, supportGrip), handWorld, false, timeline.family === 'crossbow');
      if (timeline.family !== 'crossbow') closeSupportFingers(rig, timeline.family === 'spear-pike' || timeline.family === 'halberd');
    } else if (rig.shieldMount) {
      poseCarryArm(rig, true, [.28, -.26, .58]);
      orientCarryGrip(rig, arms.leftHand, rig.shieldMount, SHIELD_CARRY);
    } else poseCarryArm(rig, true, CARRY_SWORD);
  }
  // Attachment still belongs to its original hand for shared batching/drop
  // ownership. Compensate that parent after both anatomical arm solutions.
  if (!rig.carryGripMount) {
    rig.carryGripMount = mount;
    rig.carryGripBaseQuaternion.copy(mount.quaternion);
    rig.carryGripBasePosition.copy(mount.position);
  }
  mount.position.copy(rig.attackOrigin); mount.parent!.worldToLocal(mount.position);
  mount.quaternion.copy(mount.parent!.getWorldQuaternion(rig.scratchQuaternions[0]!).invert()).multiply(rig.attackOrientation).normalize();
  updateArmTwist(rig, false); updateArmTwist(rig, true);
  rig.model.updateWorldMatrix(true, true);
}
function applyTorsoOffset(rig: CombatWeaponRig, lean: number, twist: number): void {
  // Work in the fighter's facing frame. Adding local Euler rotations on top
  // of an idle clip inherited its backward pelvis lean and upward gaze.
  const modelWorld = rig.model.getWorldQuaternion(rig.bodyOrientation);
  for (const key of TORSO_KEYS) {
    const bone = rig.torsoBones[key];
    if (!bone) continue;
    const weight = key === 'spineLower' ? .45 : 1;
    const world = rig.scratchQuaternions[3]!.copy(modelWorld)
      .multiply(rig.scratchQuaternions[0]!.setFromEuler(rig.scratchEuler.set(lean * weight, twist * weight, 0)))
      .multiply(rig.referenceModelQuaternions.get(bone)!);
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(rig.scratchQuaternions[1]!).invert()).multiply(world).normalize();
    bone.updateWorldMatrix(true, false);
  }
  for (const bone of rig.headBones) {
    const world = rig.scratchQuaternions[3]!.copy(modelWorld).multiply(rig.referenceModelQuaternions.get(bone)!);
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(rig.scratchQuaternions[1]!).invert()).multiply(world).normalize();
    bone.updateWorldMatrix(true, false);
  }
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
  carrying: 'upright' | 'low' | false = false,
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
  solveArmToWorld(rig, upper, forearm, hand, handTarget, sideSign, carrying);
}

function solveArmToWorld(
  rig: CombatWeaponRig,
  upper: THREE.Bone,
  forearm: THREE.Bone,
  hand: THREE.Bone,
  handTarget: THREE.Vector3,
  sideSign: 1 | -1,
  carrying: 'upright' | 'low' | false = false,
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
  const preferredBend = rig.scratchVectors[8]!.copy(right).multiplyScalar(sideSign * (carrying ? 0.12 : 0.76))
    .addScaledVector(up, carrying ? -1 : -0.58)
    .addScaledVector(forward, carrying === 'low' ? 0.45 : carrying ? -0.1 : 0.18);
  if (rig.solveWithHandDirection) preferredBend.copy(rig.elbowHandDirection).negate();
  preferredBend.addScaledVector(direction, -preferredBend.dot(direction));
  if (preferredBend.lengthSq() < 1e-6) preferredBend.copy(right).multiplyScalar(sideSign);
  preferredBend.normalize();
  const elbowTarget = rig.scratchVectors[9]!.copy(shoulder)
    .addScaledVector(direction, along)
    .addScaledVector(preferredBend, bendDistance);
  aimBoneAt(rig, upper, forearm, elbowTarget, Boolean(carrying));
  upper.updateWorldMatrix(true, false);
  const reachableTarget = rig.scratchVectors[6]!.copy(shoulder).addScaledVector(direction, distance);
  aimBoneAt(rig, forearm, hand, reachableTarget, Boolean(carrying));
  forearm.updateWorldMatrix(true, false);
}

function aimBoneAt(
  rig: CombatWeaponRig,
  bone: THREE.Bone,
  child: THREE.Bone,
  targetWorld: THREE.Vector3,
  preserveRoll = false,
): void {
  const origin = bone.getWorldPosition(rig.scratchVectors[10]!);
  const desiredWorld = rig.scratchVectors[11]!.copy(targetWorld).sub(origin).normalize();
  const parentWorld = bone.parent!.getWorldQuaternion(rig.scratchQuaternions[2]!);
  const desiredParent = desiredWorld.applyQuaternion(parentWorld.invert());
  const boneAxis = rig.scratchVectors[12]!.copy(child.position).normalize();
  if (preserveRoll) {
    boneAxis.applyQuaternion(bone.quaternion);
    const swing = rig.scratchQuaternions[0]!.setFromUnitVectors(boneAxis, desiredParent);
    bone.quaternion.premultiply(swing).normalize();
  } else {
    bone.quaternion.setFromUnitVectors(boneAxis, desiredParent).normalize();
  }
}
