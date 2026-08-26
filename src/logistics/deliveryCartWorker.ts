import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  pickVillagerColors,
  pickVillagerHairColor,
  pickVillagerModelVariant,
} from '../settlement/villagerPaths.ts';
import type { VillagerModelVariant } from '../settlement/SettlementCrowdRenderer.ts';

const MODEL_URLS = {
  man: '/assets/models/villagers/quaternius-villager-man.glb',
  woman: '/assets/models/villagers/quaternius-villager-woman.glb',
} as const;

const TARGET_HEIGHTS = {
  man: 1.68,
  woman: 1.62,
} as const;

const CART_PULLER_Z = 1.4;
export const DELIVERY_OX_CART_FORMATION = {
  ox: { x: 0, z: 2.15 },
  guide: { x: 1.28, z: 2.15 },
} as const;
const WORKER_LEAN_RADIANS = 0.08;
const HANDLE_TARGETS = {
  left: new THREE.Vector3(0.264, 0.68, 1.225),
  right: new THREE.Vector3(-0.264, 0.68, 1.225),
} as const;
const IK_LEFT_TARGET = new THREE.Vector3();
const IK_RIGHT_TARGET = new THREE.Vector3();
const IK_JOINT_POSITION = new THREE.Vector3();
const IK_END_DIRECTION = new THREE.Vector3();
const IK_TARGET_DIRECTION = new THREE.Vector3();
const IK_WORLD_DELTA = new THREE.Quaternion();
const IK_JOINT_WORLD = new THREE.Quaternion();
const IK_DESIRED_WORLD = new THREE.Quaternion();
const IK_PARENT_WORLD = new THREE.Quaternion();

export const DELIVERY_CART_HANDLE_TARGETS = {
  left: {
    x: HANDLE_TARGETS.left.x,
    y: HANDLE_TARGETS.left.y,
    z: HANDLE_TARGETS.left.z,
  },
  right: {
    x: HANDLE_TARGETS.right.x,
    y: HANDLE_TARGETS.right.y,
    z: HANDLE_TARGETS.right.z,
  },
} as const;

type DeliveryWorkerMode = 'idle' | 'walk';
export type DeliveryCartWorkerRole = 'hauler' | 'guide' | 'companion';

export type DeliveryCartWorkerSource = {
  variant: VillagerModelVariant;
  scene: THREE.Group;
  bounds: THREE.Box3;
  sourceHeight: number;
  targetHeight: number;
  clips: Record<DeliveryWorkerMode, THREE.AnimationClip>;
};

export type DeliveryCartWorkerSources = Record<
  VillagerModelVariant,
  DeliveryCartWorkerSource
>;

type ArmBones = {
  upper: THREE.Bone;
  lower: THREE.Bone;
  palm: THREE.Bone;
};

export type DeliveryCartWorkerVisual = {
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Record<DeliveryWorkerMode, THREE.AnimationAction>;
  mode: DeliveryWorkerMode;
  leftArm: ArmBones;
  rightArm: ArmBones;
  ownedMaterials: THREE.Material[];
  role: DeliveryCartWorkerRole;
  pinsCartHandles: boolean;
};

export async function loadDeliveryCartWorkerSources(): Promise<DeliveryCartWorkerSources> {
  const loader = new GLTFLoader();
  const [man, woman] = await Promise.all([
    loader.loadAsync(MODEL_URLS.man),
    loader.loadAsync(MODEL_URLS.woman),
  ]);
  return {
    man: createDeliveryCartWorkerSource(
      'man',
      man.scene,
      man.animations,
      TARGET_HEIGHTS.man,
    ),
    woman: createDeliveryCartWorkerSource(
      'woman',
      woman.scene,
      woman.animations,
      TARGET_HEIGHTS.woman,
    ),
  };
}

export function createDeliveryCartWorkerSource(
  variant: VillagerModelVariant,
  scene: THREE.Group,
  animations: readonly THREE.AnimationClip[],
  targetHeight = TARGET_HEIGHTS[variant],
): DeliveryCartWorkerSource {
  const bounds = new THREE.Box3().setFromObject(scene);
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
    throw new Error(`Invalid ${variant} delivery worker model bounds.`);
  }
  const idle = findAnimationClip(animations, 'idle');
  const walk = findAnimationClip(animations, 'walk');
  if (!idle || !walk) {
    throw new Error(`Missing idle/walk clips for the ${variant} delivery worker.`);
  }
  return {
    variant,
    scene,
    bounds,
    sourceHeight,
    targetHeight,
    clips: { idle, walk },
  };
}

export function createDeliveryCartWorkerVisual(
  appearanceSeed: number,
  sources: DeliveryCartWorkerSources,
  crewIndex = 0,
  oxDrawn = false,
): DeliveryCartWorkerVisual {
  const variant = pickVillagerModelVariant(appearanceSeed);
  const source = sources[variant];
  const colors = pickVillagerColors(appearanceSeed);
  const hairColor = pickVillagerHairColor(appearanceSeed);
  const model = cloneSkinned(source.scene) as THREE.Group;
  const heightJitter =
    0.97 + ((appearanceSeed >>> 8) & 0xff) / 0xff * 0.06;
  const scale = source.targetHeight / source.sourceHeight * heightJitter;
  model.scale.setScalar(scale);
  model.position.y = -source.bounds.min.y * scale + 0.012;
  const role: DeliveryCartWorkerRole = crewIndex > 0
    ? 'companion'
    : oxDrawn
      ? 'guide'
      : 'hauler';
  const pinsCartHandles = role === 'hauler';
  model.rotation.x = pinsCartHandles ? WORKER_LEAN_RADIANS : 0;

  const ownedMaterials: THREE.Material[] = [];
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    const sourceMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    const materials = sourceMaterials.map((material) => {
      const clone = material.clone();
      const standard = clone as THREE.MeshStandardMaterial;
      if (standard.color) {
        standard.color.setHex(resolvePartColor(
          material.name,
          colors.tunic,
          colors.skin,
          hairColor,
        ));
        standard.roughness = 0.9;
        standard.metalness = 0;
      }
      ownedMaterials.push(clone);
      return clone;
    });
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0]!;
  });

  const root = new THREE.Group();
  root.name = role === 'guide'
    ? `Delivery cart guide (${variant})`
    : `Delivery cart worker (${variant})`;
  if (role === 'guide') {
    root.position.set(
      DELIVERY_OX_CART_FORMATION.guide.x,
      0,
      DELIVERY_OX_CART_FORMATION.guide.z,
    );
  } else if (pinsCartHandles) {
    root.position.z = CART_PULLER_Z;
  } else {
    const companionIndex = crewIndex - 1;
    root.position.set(
      companionIndex % 2 === 0 ? 0.86 : -0.86,
      0,
      0.48 - Math.floor(companionIndex / 2) * 0.68,
    );
  }
  root.userData.deliveryCartWorker = true;
  root.userData.deliveryCartCrewIndex = crewIndex;
  root.userData.deliveryCartRole = role;
  root.userData.villagerGender = variant;
  root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions: Record<DeliveryWorkerMode, THREE.AnimationAction> = {
    idle: mixer.clipAction(source.clips.idle, model),
    walk: mixer.clipAction(source.clips.walk, model),
  };
  for (const action of Object.values(actions)) {
    action.enabled = true;
    action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
  }
  actions.walk.play();
  actions.walk.time =
    Math.abs(appearanceSeed % 997) / 997 * actions.walk.getClip().duration;

  return {
    root,
    model,
    mixer,
    actions,
    mode: 'walk',
    leftArm: findArmBones(model, 'L'),
    rightArm: findArmBones(model, 'R'),
    ownedMaterials,
    role,
    pinsCartHandles,
  };
}

export function updateDeliveryCartWorkerVisual(
  visual: DeliveryCartWorkerVisual,
  dt: number,
  moving: boolean,
  travelSpeed: number,
): void {
  const nextMode: DeliveryWorkerMode = moving ? 'walk' : 'idle';
  if (visual.mode !== nextMode) {
    visual.actions[visual.mode].fadeOut(0.18);
    visual.actions[nextMode].reset().fadeIn(0.18).play();
    visual.mode = nextMode;
  }

  visual.actions.walk.setEffectiveTimeScale(
    THREE.MathUtils.clamp(travelSpeed / 1.05, 0.78, 1.65),
  );
  visual.mixer.update(Math.min(0.08, Math.max(0, dt)));
  if (visual.pinsCartHandles) pinHandsToCartHandles(visual);
}

export function disposeDeliveryCartWorkerVisual(
  visual: DeliveryCartWorkerVisual,
): void {
  visual.mixer.stopAllAction();
  visual.mixer.uncacheRoot(visual.model);
  for (const material of visual.ownedMaterials) material.dispose();
  visual.root.removeFromParent();
}

export function disposeDeliveryCartWorkerSources(
  sources: DeliveryCartWorkerSources,
): void {
  for (const source of Object.values(sources)) {
    disposeModelResources(source.scene);
  }
}

function findArmBones(model: THREE.Object3D, side: 'L' | 'R'): ArmBones {
  const upper = model.getObjectByName(`UpperArm${side}`);
  const lower = model.getObjectByName(`LowerArm${side}`);
  const palm = model.getObjectByName(`Palm${side}`);
  if (
    !(upper instanceof THREE.Bone)
    || !(lower instanceof THREE.Bone)
    || !(palm instanceof THREE.Bone)
  ) {
    throw new Error(`Delivery worker rig is missing its ${side} arm chain.`);
  }
  return { upper, lower, palm };
}

function pinHandsToCartHandles(visual: DeliveryCartWorkerVisual): void {
  const cartRoot = visual.root.parent;
  if (!cartRoot) return;
  cartRoot.updateWorldMatrix(true, false);
  visual.model.updateMatrixWorld(true);

  IK_LEFT_TARGET.copy(HANDLE_TARGETS.left);
  IK_RIGHT_TARGET.copy(HANDLE_TARGETS.right);
  cartRoot.localToWorld(IK_LEFT_TARGET);
  cartRoot.localToWorld(IK_RIGHT_TARGET);
  solveArmIk(visual.leftArm, IK_LEFT_TARGET);
  solveArmIk(visual.rightArm, IK_RIGHT_TARGET);
}

function solveArmIk(arm: ArmBones, target: THREE.Vector3): void {
  for (let iteration = 0; iteration < 4; iteration++) {
    rotateJointToward(arm.lower, arm.palm, target);
    rotateJointToward(arm.upper, arm.palm, target);
  }
}

function rotateJointToward(
  joint: THREE.Bone,
  end: THREE.Bone,
  target: THREE.Vector3,
): void {
  joint.getWorldPosition(IK_JOINT_POSITION);
  end.getWorldPosition(IK_END_DIRECTION).sub(IK_JOINT_POSITION);
  IK_TARGET_DIRECTION.copy(target).sub(IK_JOINT_POSITION);
  if (
    IK_END_DIRECTION.lengthSq() <= 1e-8
    || IK_TARGET_DIRECTION.lengthSq() <= 1e-8
  ) {
    return;
  }

  IK_END_DIRECTION.normalize();
  IK_TARGET_DIRECTION.normalize();
  IK_WORLD_DELTA.setFromUnitVectors(
    IK_END_DIRECTION,
    IK_TARGET_DIRECTION,
  );
  joint.getWorldQuaternion(IK_JOINT_WORLD);
  IK_DESIRED_WORLD.copy(IK_WORLD_DELTA).multiply(IK_JOINT_WORLD);
  if (!joint.parent) return;
  joint.parent.getWorldQuaternion(IK_PARENT_WORLD);
  joint.quaternion
    .copy(IK_PARENT_WORLD.invert())
    .multiply(IK_DESIRED_WORLD)
    .normalize();
  joint.updateMatrixWorld(true);
}

function findAnimationClip(
  animations: readonly THREE.AnimationClip[],
  name: string,
): THREE.AnimationClip | undefined {
  return animations.find((clip) => {
    const normalized = clip.name.toLowerCase();
    return normalized === name
      || normalized.endsWith(`|${name}`)
      || normalized.endsWith(`_${name}`);
  });
}

function resolvePartColor(
  materialName: string,
  tunicColor: number,
  skinColor: number,
  hairColor: number,
): number {
  const normalized = materialName.toLowerCase();
  if (normalized.includes('skin')) return skinColor;
  if (normalized.includes('hair')) {
    return normalized.endsWith('2') ? darkenHex(hairColor, 0.82) : hairColor;
  }
  if (normalized.includes('dress') || normalized === 'shirt') return tunicColor;
  if (normalized.includes('shirt')) return darkenHex(tunicColor, 0.78);
  if (normalized.includes('pants')) return darkenHex(tunicColor, 0.56);
  if (normalized.includes('socks')) return 0x776d61;
  if (normalized.includes('shoes')) return 0x3d2b22;
  if (normalized.includes('eyes')) return 0x241e1a;
  return 0xffffff;
}

function darkenHex(hex: number, factor: number): number {
  const r = Math.round(((hex >> 16) & 0xff) * factor);
  const g = Math.round(((hex >> 8) & 0xff) * factor);
  const b = Math.round((hex & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

function disposeModelResources(source: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  source.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of meshMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
