import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mulberry32 } from '../props/forestField.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ForagingSite } from './ForagingLayout.ts';
import {
  displayedGameAnimalCount,
  gamePatchMaxYield,
  gamePatchSpawnRadius,
} from './foragingYields.ts';
import type { ForagingNodeState } from '../resources/types.ts';
import {
  chooseInitialDeerMode,
  chooseRestDuration,
  createHerdSexDistribution,
  herdSexCounts,
  type DeerBehaviorMode,
  type DeerMotionState,
  type DeerObserver,
  type DeerSex,
  updateDeerMotion,
} from './DeerWildlifeBehavior.ts';

type DeerAnimationSet = {
  idle: THREE.AnimationAction;
  graze: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  flee: THREE.AnimationAction;
};

type DeerVisual = {
  nodeId: string;
  sex: DeerSex;
  sexIndex: number;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: DeerAnimationSet;
  activeMode: DeerBehaviorMode;
  motion: DeerMotionState;
};

type DeerModelSource = {
  scene: THREE.Group;
  clips: ReturnType<typeof resolveAnimationClips>;
  bounds: THREE.Box3;
  sourceHeight: number;
  targetHeight: number;
};

export type DeerWildlifeVisuals = {
  group: THREE.Group;
  deerCount: number;
  doeCount: number;
  stagCount: number;
  update: (
    dtSeconds: number,
    firstPersonObserver: DeerObserver | null,
    cameraDistance: number,
  ) => void;
  sync: (nodes: Iterable<ForagingNodeState>) => void;
  dispose: () => void;
};

export type DeerWildlifeObstacleQueries = {
  /** Keeps the initial visual herd off water and solid terrain obstacles. */
  isSpawnBlockedAt?: (x: number, z: number) => boolean;
  /** Deer may wade across water, but still steer around solid terrain obstacles. */
  isMovementBlockedAt?: (x: number, z: number) => boolean;
};

const DOE_MODEL_URL = '/assets/models/deer/quaternius-deer.glb';
const STAG_MODEL_URL = '/assets/models/deer/quaternius-stag.glb';
const DOE_TARGET_HEIGHT = 1.7;
const STAG_TARGET_HEIGHT = 2;
const CLOSE_WORLD_MAX_CAMERA_DISTANCE = 210;
const TAU = Math.PI * 2;

/**
 * Adds a small animated herd to each authoritative game-resource site. The static
 * map marker remains owned by ForagingMapIcons; this is only its close-world form.
 */
export async function createDeerWildlifeVisuals(
  terrain: Terrain,
  sites: ReadonlyArray<ForagingSite>,
  seed: number,
  obstacles: DeerWildlifeObstacleQueries = {},
): Promise<DeerWildlifeVisuals> {
  const gameSites = sites.filter((site) => site.kind === 'game');
  const group = new THREE.Group();
  group.name = 'Animated deer at game resource sites';
  group.userData.gameResourceCenters = gameSites.map((site, index) => ({
    nodeId: `foraging-game-${index}`,
    x: site.x,
    z: site.z,
  }));

  if (gameSites.length === 0) {
    return {
      group,
      deerCount: 0,
      doeCount: 0,
      stagCount: 0,
      update: () => undefined,
      sync: () => undefined,
      dispose: () => undefined,
    };
  }

  const [doeSource, stagSource] = await Promise.all([
    loadDeerModel(DOE_MODEL_URL, DOE_TARGET_HEIGHT, 'doe'),
    loadDeerModel(STAG_MODEL_URL, STAG_TARGET_HEIGHT, 'stag'),
  ]);
  const modelSources: Record<DeerSex, DeerModelSource> = {
    doe: doeSource,
    stag: stagSource,
  };

  const rng = mulberry32(seed ^ 0xd33f51);
  const deer: DeerVisual[] = [];
  let doeCount = 0;
  let stagCount = 0;

  for (let siteIndex = 0; siteIndex < gameSites.length; siteIndex++) {
    const site = gameSites[siteIndex];
    const nodeId = `foraging-game-${siteIndex}`;
    const spawnPoints = createGameHerdSpawnPoints(site, rng, obstacles.isSpawnBlockedAt);
    const distribution = createHerdSexDistribution(spawnPoints.length, rng);
    let siteDoeCount = 0;
    let siteStagCount = 0;
    for (let index = 0; index < spawnPoints.length; index++) {
      const spawn = spawnPoints[index];
      const sex = distribution[index];
      const sexIndex = sex === 'stag' ? siteStagCount++ : siteDoeCount++;
      const source = modelSources[sex];
      const model = cloneSkinned(source.scene) as THREE.Group;
      const sizeVariation = THREE.MathUtils.lerp(0.9, 1.08, rng());
      const modelScale = (source.targetHeight / source.sourceHeight) * sizeVariation;
      model.scale.setScalar(modelScale);
      model.position.y = -source.bounds.min.y * modelScale + 0.025;
      configureModelMeshes(model);

      const root = new THREE.Group();
      root.name = sex === 'stag' ? 'Rigged roaming stag' : 'Rigged roaming doe';
      root.userData.deerSex = sex;
      root.add(model);
      group.add(root);

      const mixer = new THREE.AnimationMixer(model);
      const actions: DeerAnimationSet = {
        idle: mixer.clipAction(source.clips.idle, model),
        graze: mixer.clipAction(source.clips.graze, model),
        walk: mixer.clipAction(source.clips.walk, model),
        flee: mixer.clipAction(source.clips.flee, model),
      };
      configureActions(actions);

      const initialMode = chooseInitialDeerMode(rng);
      const heading = rng() * TAU;
      const motion: DeerMotionState = {
        x: spawn.x,
        z: spawn.z,
        homeX: site.x,
        homeZ: site.z,
        targetX: spawn.x,
        targetZ: spawn.z,
        heading,
        speed: 0,
        mode: initialMode,
        modeTimer: chooseRestDuration(rng),
        fleeBias: THREE.MathUtils.lerp(-0.2, 0.2, rng()),
      };

      const firstAction = actions[initialMode];
      firstAction.play();
      firstAction.time = rng() * firstAction.getClip().duration;
      root.position.set(spawn.x, terrain.getHeightAt(spawn.x, spawn.z), spawn.z);
      root.rotation.y = heading;
      deer.push({
        nodeId,
        sex,
        sexIndex,
        root,
        mixer,
        actions,
        activeMode: initialMode,
        motion,
      });
      if (sex === 'stag') stagCount++;
      else doeCount++;
    }
  }
  group.userData.herdComposition = { doeCount, stagCount };

  const update = (
    dtSeconds: number,
    firstPersonObserver: DeerObserver | null,
    cameraDistance: number,
  ): void => {
    const shouldShow = firstPersonObserver !== null || cameraDistance <= CLOSE_WORLD_MAX_CAMERA_DISTANCE;
    group.visible = shouldShow;
    if (!shouldShow) return;

    for (const visual of deer) {
      if (!visual.root.visible) continue;
      updateDeerMotion(visual.motion, dtSeconds, {
        observer: firstPersonObserver,
        random: rng,
        isBlockedAt: obstacles.isMovementBlockedAt,
      });
      if (visual.motion.mode !== visual.activeMode) transitionAnimation(visual, visual.motion.mode);

      visual.root.position.set(
        visual.motion.x,
        terrain.getHeightAt(visual.motion.x, visual.motion.z),
        visual.motion.z,
      );
      visual.root.rotation.y = visual.motion.heading;
      visual.mixer.update(Math.min(Math.max(dtSeconds, 0), 0.1));
    }
  };

  const sync = (nodes: Iterable<ForagingNodeState>): void => {
    const byId = new Map(Array.from(nodes, (node) => [node.nodeId, node] as const));
    for (const visual of deer) {
      const node = byId.get(visual.nodeId);
      const visiblePopulation = node && node.remaining > 0
        ? displayedGameAnimalCount(node.remaining)
        : 0;
      const visibleSexCounts = herdSexCounts(visiblePopulation);
      visual.root.visible = visual.sex === 'stag'
        ? visual.sexIndex < visibleSexCounts.stagCount
        : visual.sexIndex < visibleSexCounts.doeCount;
      if (!node) continue;
      const dx = node.x - visual.motion.homeX;
      const dz = node.z - visual.motion.homeZ;
      if (Math.hypot(dx, dz) <= 0.01) continue;
      visual.motion.x += dx;
      visual.motion.z += dz;
      visual.motion.homeX = node.x;
      visual.motion.homeZ = node.z;
      visual.motion.targetX += dx;
      visual.motion.targetZ += dz;
    }
    group.userData.gameResourceCenters = gameSites.map((site, index) => {
      const nodeId = `foraging-game-${index}`;
      const node = byId.get(nodeId);
      return {
        nodeId,
        x: node?.x ?? site.x,
        z: node?.z ?? site.z,
      };
    });
  };

  return {
    group,
    deerCount: deer.length,
    doeCount,
    stagCount,
    update,
    sync,
    dispose: () => {
      for (const visual of deer) {
        visual.mixer.stopAllAction();
        visual.mixer.uncacheRoot(visual.root.children[0]);
      }
      group.clear();
      disposeModelResources(doeSource.scene);
      disposeModelResources(stagSource.scene);
    },
  };
}

async function loadDeerModel(
  url: string,
  targetHeight: number,
  label: DeerSex,
): Promise<DeerModelSource> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const sourceHeight = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0.001) {
    throw new Error(`The ${label} model has invalid bounds.`);
  }
  return {
    scene: gltf.scene,
    clips: resolveAnimationClips(gltf.animations),
    bounds,
    sourceHeight,
    targetHeight,
  };
}

function resolveAnimationClips(animations: ReadonlyArray<THREE.AnimationClip>): {
  idle: THREE.AnimationClip;
  graze: THREE.AnimationClip;
  walk: THREE.AnimationClip;
  flee: THREE.AnimationClip;
} {
  const directClips = new Map(
    animations
      .filter((clip) => !clip.name.includes('|'))
      .map((clip) => [clip.name.toLowerCase(), clip]),
  );
  const requireClip = (name: string): THREE.AnimationClip => {
    const clip = directClips.get(name.toLowerCase());
    if (!clip) throw new Error(`The deer model is missing its ${name} animation.`);
    return clip;
  };

  return {
    idle: requireClip('Idle'),
    graze: requireClip('Eating'),
    walk: requireClip('Walk'),
    flee: requireClip('Gallop'),
  };
}

export function createGameHerdSpawnPoints(
  site: ForagingSite,
  random: () => number,
  isBlockedAt?: (x: number, z: number) => boolean,
): Array<{ x: number; z: number }> {
  const herdSize = gamePatchMaxYield(site.isRich === true);
  const spawnRadius = gamePatchSpawnRadius(site.isRich === true);
  const points: Array<{ x: number; z: number }> = [];
  let attempts = 0;
  while (points.length < herdSize && attempts < herdSize * 30) {
    attempts++;
    const radius = points.length === 0 ? 2.5 : Math.sqrt(random()) * spawnRadius;
    const angle = random() * TAU;
    const x = site.x + Math.sin(angle) * radius;
    const z = site.z + Math.cos(angle) * radius;
    if (isBlockedAt?.(x, z)) continue;
    if (points.some((point) => Math.hypot(point.x - x, point.z - z) < 2.7)) continue;
    points.push({ x, z });
  }

  // Keep the visual actor pool equal to the authoritative habitat capacity.
  // This deterministic spiral is only needed when water/quarry blocking rejects
  // too many random placements.
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  while (points.length < herdSize) {
    const index = points.length;
    const radius = index === 0
      ? 2.5
      : Math.min(spawnRadius, 3 + Math.sqrt(index) * 3.35);
    const angle = index * goldenAngle;
    points.push({
      x: site.x + Math.sin(angle) * radius,
      z: site.z + Math.cos(angle) * radius,
    });
  }
  return points;
}

function configureModelMeshes(model: THREE.Object3D): void {
  model.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  });
}

function configureActions(actions: DeerAnimationSet): void {
  for (const action of Object.values(actions)) {
    action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    action.enabled = true;
    action.clampWhenFinished = false;
  }
  actions.walk.setEffectiveTimeScale(1.05);
  actions.flee.setEffectiveTimeScale(1.12);
}

function transitionAnimation(visual: DeerVisual, nextMode: DeerBehaviorMode): void {
  const previous = visual.actions[visual.activeMode];
  const next = visual.actions[nextMode];
  previous.fadeOut(0.22);
  next.reset().fadeIn(0.22).play();
  visual.activeMode = nextMode;
}

function disposeModelResources(source: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  source.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
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
