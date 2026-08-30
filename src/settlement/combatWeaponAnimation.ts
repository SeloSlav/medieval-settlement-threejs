import * as THREE from 'three';
import type { WorkerToolKind } from './workerTools.ts';
import type { MilitaryEquipmentCombatStance } from './militaryEquipment.ts';

export type CombatWeaponFamily =
  | 'spear-pike'
  | 'sword-shield'
  | 'halberd'
  | 'bow'
  | 'crossbow'
  | 'uskok-arquebus'
  | 'uskok-sidearm';

export type CombatAttackPhase =
  | 'recovery'
  | 'guard'
  | 'wind-up'
  | 'contact'
  | 'reload'
  | 'draw'
  | 'aim'
  | 'release';

export type CombatProjectileKind = 'arrow' | 'bolt' | 'lead-shot';

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
  if (tool === 'uskok-kit') {
    return distantTarget
      ? presentation('uskok-arquebus', 'ranged', true, 2.8, 'lead-shot', true)
      : presentation('uskok-sidearm', 'melee', false, 0.84, null, false);
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
  const reloadEnd = family === 'crossbow'
    ? 0.52
    : family === 'uskok-arquebus' ? 0.58 : 0.34;
  const drawEnd = family === 'crossbow'
    ? 0.74
    : family === 'uskok-arquebus' ? 0.78 : 0.72;
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
  nockedArrow: THREE.Group | null;
  armBones: Record<ArmBoneKey, THREE.Bone>;
  torsoBones: Partial<Record<TorsoBoneKey, THREE.Bone>>;
  referenceQuaternions: Map<THREE.Bone, THREE.Quaternion>;
  baseQuaternions: Map<THREE.Bone, THREE.Quaternion>;
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
  const referenceQuaternions = new Map<THREE.Bone, THREE.Quaternion>();
  for (const bone of [...Object.values(armBones), ...Object.values(torsoBones)]) {
    referenceQuaternions.set(bone, bone.quaternion.clone());
  }
  const mounts = tool?.userData.workerToolMounts as THREE.Group[] | undefined;
  const rangedMount = mounts?.find(
    (mount) => mount.userData.workerToolCombatRole === 'ranged-held',
  ) ?? null;
  const nockedArrow = toolKind === 'bow' && rangedMount
    ? createNockedArrow(rangedMount)
    : null;
  return {
    model,
    tool,
    rangedMount,
    nockedArrow,
    armBones,
    torsoBones,
    referenceQuaternions,
    baseQuaternions: new Map(),
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
  for (const [bone, quaternion] of rig.baseQuaternions) {
    bone.quaternion.copy(quaternion);
  }
  rig.overlayApplied = false;
  rig.baseQuaternions.clear();
}

export function resetCombatWeaponRig(rig: CombatWeaponRig): void {
  restoreCombatWeaponPose(rig);
  if (rig.nockedArrow) rig.nockedArrow.visible = false;
  rig.previousObservedCooldown = null;
  rig.lastObservedCooldown = null;
  rig.estimatedCooldown = 0;
  rig.family = null;
  rig.eventSequence = 0;
}

export function disposeCombatWeaponRig(rig: CombatWeaponRig): void {
  resetCombatWeaponRig(rig);
  if (!rig.nockedArrow) return;
  rig.nockedArrow.removeFromParent();
  rig.nockedArrow.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material.dispose();
    } else {
      mesh.material.dispose();
    }
  });
  rig.nockedArrow = null;
}

export function applyCombatWeaponPose(
  rig: CombatWeaponRig,
  input: CombatWeaponPoseInput,
): CombatWeaponPoseResult | null {
  const combatPresentation = resolveCombatWeaponPresentation(
    input.tool,
    input.targetDistance,
  );
  if (!combatPresentation || input.logicalMode === 'fall') {
    rig.previousObservedCooldown = null;
    rig.lastObservedCooldown = null;
    rig.family = null;
    return null;
  }

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
  updateNockedArrow(rig, timeline);

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
    const localMuzzle = rig.family === 'crossbow'
      ? target.set(0, 0.45, 0.052)
      : target.set(0, 0.58, 0.015);
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

function updateNockedArrow(
  rig: CombatWeaponRig,
  timeline: CombatAttackTimeline,
): void {
  const arrow = rig.nockedArrow;
  if (!arrow) return;
  const nocked = timeline.family === 'bow'
    && !timeline.releaseEdge
    && (timeline.phase === 'draw' || timeline.phase === 'aim');
  arrow.visible = nocked;
  if (!nocked) return;
  const draw = timeline.phase === 'draw'
    ? timeline.phaseProgress
    : 1;
  arrow.position.z = THREE.MathUtils.lerp(-0.035, -0.13, draw);
}

function captureBaseQuaternions(rig: CombatWeaponRig): void {
  rig.baseQuaternions.clear();
  for (const bone of [
    ...Object.values(rig.armBones),
    ...Object.values(rig.torsoBones),
  ]) {
    rig.baseQuaternions.set(bone, bone.quaternion.clone());
  }
  rig.overlayApplied = true;
}

type ArmTarget = readonly [lateral: number, vertical: number, forward: number];
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
  const targets = targetsForTimeline(timeline);
  const { armBones, referenceQuaternions } = rig;
  armBones.leftClavicle.quaternion.copy(referenceQuaternions.get(armBones.leftClavicle)!);
  armBones.rightClavicle.quaternion.copy(referenceQuaternions.get(armBones.rightClavicle)!);
  armBones.leftHand.quaternion.copy(referenceQuaternions.get(armBones.leftHand)!);
  armBones.rightHand.quaternion.copy(referenceQuaternions.get(armBones.rightHand)!);

  if (logicalMode === 'fight') {
    applyTorsoOffset(rig, targets.torsoLean, targets.torsoTwist);
  }
  rig.model.updateWorldMatrix(true, true);
  solveArm(
    rig,
    armBones.leftUpperArm,
    armBones.leftForearm,
    armBones.leftHand,
    targets.left,
    1,
  );
  solveArm(
    rig,
    armBones.rightUpperArm,
    armBones.rightForearm,
    armBones.rightHand,
    targets.right,
    -1,
  );
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
  if (lower) {
    lower.quaternion.multiply(new THREE.Quaternion().setFromEuler(
      new THREE.Euler(lean * 0.45, twist * 0.42, 0, 'XYZ'),
    )).normalize();
  }
  if (upper) {
    upper.quaternion.multiply(new THREE.Quaternion().setFromEuler(
      new THREE.Euler(lean * 0.55, twist * 0.58, -twist * 0.08, 'XYZ'),
    )).normalize();
  }
}

function targetsForTimeline(timeline: CombatAttackTimeline): FamilyTargets {
  const p = timeline.poseProgress;
  switch (timeline.family) {
    case 'spear-pike':
      return meleeTargets(p,
        { left: [0.12, 0.04, 0.62], right: [-0.18, -0.2, 0.4], lean: 0.02, twist: 0 },
        { left: [0.02, 0.2, 0.22], right: [-0.4, 0.08, 0.04], lean: -0.04, twist: -0.28 },
        { left: [0.04, 0.08, 0.98], right: [-0.08, -0.04, 0.92], lean: 0.12, twist: 0.12 },
      );
    case 'halberd':
      return meleeTargets(p,
        { left: [0.18, 0.08, 0.58], right: [-0.24, -0.2, 0.36], lean: 0.02, twist: 0 },
        { left: [0.12, 0.44, 0.26], right: [-0.42, 0.58, 0.12], lean: -0.08, twist: -0.34 },
        { left: [0.06, -0.02, 0.94], right: [0.16, -0.12, 0.88], lean: 0.15, twist: 0.3 },
      );
    case 'sword-shield':
    case 'uskok-sidearm':
      return meleeTargets(p,
        { left: [0.2, -0.08, 0.62], right: [-0.22, -0.1, 0.68], lean: 0.01, twist: 0 },
        { left: [0.22, 0.02, 0.64], right: [-0.5, 0.48, 0.1], lean: -0.04, twist: -0.42 },
        { left: [0.08, 0.02, 0.82], right: [0.1, 0.04, 0.92], lean: 0.12, twist: 0.38 },
      );
    case 'bow':
      return rangedTargets(p, 0.34, 0.72,
        { left: [0.22, -0.26, 0.3], right: [-0.14, -0.18, 0.42], lean: 0.04, twist: 0 },
        { left: [0.08, 0.12, 0.12], right: [-0.12, 0.04, 0.9], lean: -0.01, twist: -0.08 },
        { left: [0.08, 0.14, 0.08], right: [-0.1, 0.06, 0.94], lean: -0.02, twist: -0.1 },
      );
    case 'crossbow':
      return rangedTargets(p, 0.52, 0.74,
        { left: [0.18, -0.3, 0.28], right: [-0.18, -0.34, 0.28], lean: 0.13, twist: 0 },
        { left: [0.1, -0.02, 0.72], right: [-0.16, -0.04, 0.76], lean: 0.01, twist: 0 },
        { left: [0.08, 0.02, 0.84], right: [-0.1, 0.04, 0.9], lean: -0.02, twist: 0 },
      );
    case 'uskok-arquebus':
      return rangedTargets(p, 0.58, 0.78,
        { left: [0.18, -0.28, 0.3], right: [-0.2, -0.3, 0.28], lean: 0.12, twist: 0 },
        { left: [0.08, 0, 0.72], right: [-0.2, 0.04, 0.7], lean: 0, twist: -0.04 },
        { left: [0.04, 0.02, 0.84], right: [-0.16, 0.1, 0.78], lean: -0.03, twist: -0.06 },
      );
  }
}

type KeyTargets = {
  left: ArmTarget;
  right: ArmTarget;
  lean: number;
  twist: number;
};

function meleeTargets(
  progress: number,
  guard: KeyTargets,
  windUp: KeyTargets,
  contact: KeyTargets,
): FamilyTargets {
  if (progress < 0.28) {
    return mixTargets(contact, guard, smoothstep(progress, 0, 0.28));
  }
  if (progress < 0.56) return keyTargets(guard);
  if (progress < 0.86) {
    return mixTargets(guard, windUp, smoothstep(progress, 0.56, 0.86));
  }
  return mixTargets(windUp, contact, smoothstep(progress, 0.86, 1));
}

function rangedTargets(
  progress: number,
  reloadEnd: number,
  aimStart: number,
  reload: KeyTargets,
  raised: KeyTargets,
  aim: KeyTargets,
): FamilyTargets {
  if (progress < reloadEnd) {
    return mixTargets(reload, raised, smoothstep(progress, 0, reloadEnd) * 0.35);
  }
  if (progress < aimStart) {
    return mixTargets(reload, raised, smoothstep(progress, reloadEnd, aimStart));
  }
  return mixTargets(raised, aim, smoothstep(progress, aimStart, 1));
}

function keyTargets(value: KeyTargets): FamilyTargets {
  return {
    left: value.left,
    right: value.right,
    torsoLean: value.lean,
    torsoTwist: value.twist,
  };
}

function mixTargets(a: KeyTargets, b: KeyTargets, t: number): FamilyTargets {
  return {
    left: mixArmTarget(a.left, b.left, t),
    right: mixArmTarget(a.right, b.right, t),
    torsoLean: THREE.MathUtils.lerp(a.lean, b.lean, t),
    torsoTwist: THREE.MathUtils.lerp(a.twist, b.twist, t),
  };
}

function mixArmTarget(a: ArmTarget, b: ArmTarget, t: number): ArmTarget {
  return [
    THREE.MathUtils.lerp(a[0], b[0], t),
    THREE.MathUtils.lerp(a[1], b[1], t),
    THREE.MathUtils.lerp(a[2], b[2], t),
  ];
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
  const shoulder = upper.getWorldPosition(new THREE.Vector3());
  const elbow = forearm.getWorldPosition(new THREE.Vector3());
  const palm = hand.getWorldPosition(new THREE.Vector3());
  const upperLength = Math.max(1e-4, shoulder.distanceTo(elbow));
  const lowerLength = Math.max(1e-4, elbow.distanceTo(palm));
  const totalLength = upperLength + lowerLength;
  const modelWorldQuaternion = rig.model.getWorldQuaternion(new THREE.Quaternion());
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(modelWorldQuaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(modelWorldQuaternion);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(modelWorldQuaternion);
  const handTarget = shoulder.clone()
    .addScaledVector(right, target[0] * totalLength)
    .addScaledVector(up, target[1] * totalLength)
    .addScaledVector(forward, target[2] * totalLength);
  const shoulderToHand = handTarget.clone().sub(shoulder);
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
  const preferredBend = right.clone().multiplyScalar(sideSign * 0.76)
    .addScaledVector(up, -0.58)
    .addScaledVector(forward, 0.18);
  preferredBend.addScaledVector(direction, -preferredBend.dot(direction)).normalize();
  const elbowTarget = shoulder.clone()
    .addScaledVector(direction, along)
    .addScaledVector(preferredBend, bendDistance);
  aimBoneAt(upper, forearm, elbowTarget);
  upper.updateWorldMatrix(true, true);
  aimBoneAt(forearm, hand, handTarget);
  forearm.updateWorldMatrix(true, true);
}

function aimBoneAt(
  bone: THREE.Bone,
  child: THREE.Bone,
  targetWorld: THREE.Vector3,
): void {
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const desiredWorld = targetWorld.clone().sub(origin).normalize();
  const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  const desiredParent = desiredWorld.applyQuaternion(parentWorld.invert());
  const boneAxis = child.position.clone().normalize();
  bone.quaternion.setFromUnitVectors(boneAxis, desiredParent).normalize();
}
