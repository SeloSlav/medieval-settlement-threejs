import * as THREE from 'three';
import { findHuntingTarget, type HuntingTarget, type HuntingTargetQuery } from '../settlement/huntingWork.ts';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mulberry32 } from '../props/forestField.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ForagingSite } from './ForagingLayout.ts';
import type { GameHabitatDisturbanceSource } from './gameHabitatDisturbance.ts';
import {
  GAME_PATCH_MAX_YIELD,
  GAME_PATCH_VISUAL_CAPACITY,
  displayedGameAnimalCount,
  gamePatchVisualCapacity,
  gamePatchSpawnRadius,
  logarithmicPopulationVisualCount,
} from './foragingYields.ts';
import type { ForagingNodeState } from '../resources/types.ts';
import {
  AuthoredAnimalInstanceBatch,
  setAuthoredAnimalEvaluatorOnly,
} from '../scene/AuthoredAnimalInstanceBatch.ts';
import {
  beginDeerMigration,
  chooseInitialDeerMode,
  chooseRestDuration,
  createHerdSexDistribution,
  herdSexCounts,
  snapDeerMigration,
  DEER_ROAM_RADIUS,
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
  huntingTarget: HuntingTarget;
  nodeId: string;
  sex: DeerSex;
  sexIndex: number;
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: DeerAnimationSet;
  activeMode: DeerBehaviorMode;
  motion: DeerMotionState;
  migrationOffsetX: number;
  migrationOffsetZ: number;
};

type DeerModelSource = {
  scene: THREE.Group;
  clips: ReturnType<typeof resolveAnimationClips>;
  bounds: THREE.Box3;
  sourceHeight: number;
  targetHeight: number;
};

export type DeerWildlifeVisuals = {
  findHuntingTarget: (query: HuntingTargetQuery) => HuntingTarget | null;
  group: THREE.Group;
  deerCount: number;
  doeCount: number;
  stagCount: number;
  update: (
    dtSeconds: number,
    firstPersonObserver: DeerObserver | null,
    _cameraDistance: number,
    loggingSources?: readonly GameHabitatDisturbanceSource[],
  ) => void;
  sync: (nodes: Iterable<ForagingNodeState>) => void;
  diagnostics: () => Partial<Record<DeerSex, ReturnType<AuthoredAnimalInstanceBatch['diagnostics']>>>;
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
const TAU = Math.PI * 2;
/**
 * Adds a representative authored herd to every habitat. Low populations remain
 * literal while larger populations use a logarithmic visual density curve.
 */
export async function createDeerWildlifeVisuals(
  terrain: Terrain,
  sites: ReadonlyArray<ForagingSite>,
  seed: number,
  obstacles: DeerWildlifeObstacleQueries = {},
): Promise<DeerWildlifeVisuals> {
  const gameSites = sites.filter((site) => site.kind === 'game');
  const habitatCenters = new Map<string, { x: number; z: number }>(
    gameSites.map((site, index) => [
      `foraging-game-${index}`,
      { x: site.x, z: site.z },
    ] as const),
  );
  const authoritativeSyncedNodeIds = new Set<string>();
  const loggingSourcesByHabitat = new Map<string, GameHabitatDisturbanceSource[]>(
    Array.from(habitatCenters.keys(), (nodeId) => [
      nodeId,
      [] as GameHabitatDisturbanceSource[],
    ] as const),
  );
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
      findHuntingTarget: () => null,
      update: () => undefined,
      sync: () => undefined,
      diagnostics: () => ({}),
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
  const batches = new Map<DeerSex, AuthoredAnimalInstanceBatch>();
  const initialCapacity = gameSites.reduce(
    (sum, site) => sum + gamePatchVisualCapacity(site.isRich === true),
    0,
  );
  for (const sex of ['doe', 'stag'] as const) {
    try {
      batches.set(sex, new AuthoredAnimalInstanceBatch({
        parent: group,
        sourceRoot: modelSources[sex].scene,
        capacity: initialCapacity,
        name: `${sex} exact-model wildlife instances`,
        castShadow: true,
        receiveShadow: true,
      }));
    } catch (error) {
      console.warn(`[Deer] ${sex} exact-model batching unavailable; retaining exact rigs.`, error);
    }
  }

  const rng = mulberry32(seed ^ 0xd33f51);
  const deer: DeerVisual[] = [];
  const huntingTargets: HuntingTarget[] = [];
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
      setAuthoredAnimalEvaluatorOnly(model, batches.has(sex));
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
        migrationTargetX: null,
        migrationTargetZ: null,
      };

      const firstAction = actions[initialMode];
      firstAction.play();
      firstAction.time = rng() * firstAction.getClip().duration;
      root.position.set(spawn.x, terrain.getHeightAt(spawn.x, spawn.z), spawn.z);
      root.rotation.y = heading;
      const huntingTarget: HuntingTarget = {
        id: `${nodeId}:${sex}:${sexIndex}`, nodeId, active: true,
        x: root.position.x, y: root.position.y + source.targetHeight * sizeVariation * 0.55,
        z: root.position.z,
      };
      huntingTargets.push(huntingTarget);
      deer.push({
        huntingTarget,
        nodeId,
        sex,
        sexIndex,
        root,
        model,
        mixer,
        actions,
        activeMode: initialMode,
        motion,
        migrationOffsetX: spawn.x - site.x,
        migrationOffsetZ: spawn.z - site.z,
      });
      if (sex === 'stag') stagCount++;
      else doeCount++;
    }
  }
  group.userData.herdComposition = { doeCount, stagCount };

  const update = (
    dtSeconds: number,
    firstPersonObserver: DeerObserver | null,
    _cameraDistance: number,
    loggingSources: readonly GameHabitatDisturbanceSource[] = [],
  ): void => {
    group.visible = true;

    for (const sources of loggingSourcesByHabitat.values()) sources.length = 0;
    const radiusSq = DEER_ROAM_RADIUS * DEER_ROAM_RADIUS;
    for (const source of loggingSources) {
      if (!Number.isFinite(source.x) || !Number.isFinite(source.z)) continue;
      for (const [nodeId, center] of habitatCenters) {
        const dx = source.x - center.x;
        const dz = source.z - center.z;
        if (dx * dx + dz * dz > radiusSq) continue;
        loggingSourcesByHabitat.get(nodeId)?.push(source);
      }
    }
    for (const sources of loggingSourcesByHabitat.values()) {
      sources.sort((left, right) => left.id.localeCompare(right.id));
    }

    for (const visual of deer) {
      updateDeerMotion(visual.motion, dtSeconds, {
        observer: firstPersonObserver,
        forcedThreats: loggingSourcesByHabitat.get(visual.nodeId) ?? [],
        random: rng,
        isBlockedAt: obstacles.isMovementBlockedAt,
      });
      if (visual.motion.mode !== visual.activeMode) transitionAnimation(visual, visual.motion.mode);

      syncDeerVisualTransform(visual, terrain);
      if (visual.root.visible) {
        visual.mixer.update(Math.min(Math.max(dtSeconds, 0), 0.1));
      }
    }
    for (const [sex, batch] of batches) {
      const visible = deer.filter((visual) => visual.sex === sex && visual.root.visible);
      batch.beginFrame(visible.length);
      for (const visual of visible) batch.submit(visual.model);
      batch.endFrame();
    }
  };

  const sync = (nodes: Iterable<ForagingNodeState>): void => {
    const byId = new Map(Array.from(nodes, (node) => [node.nodeId, node] as const));
    for (const visual of deer) {
      const node = byId.get(visual.nodeId);
      const visiblePopulation = node && node.remaining > 0
        ? displayedGameHerdCount(node.remaining, node.maxYield)
        : 0;
      const visibleSexCounts = herdSexCounts(visiblePopulation);
      const visible = visual.sex === 'stag'
        ? visual.sexIndex < visibleSexCounts.stagCount
        : visual.sexIndex < visibleSexCounts.doeCount;
      visual.root.visible = visible;
      visual.huntingTarget.active = visible;
    }

    for (const [nodeId, previousCenter] of habitatCenters) {
      const node = byId.get(nodeId);
      if (!node) continue;
      const dx = node.x - previousCenter.x;
      const dz = node.z - previousCenter.z;
      const moved = Math.hypot(dx, dz) > 0.01;
      const firstAuthoritativeSync = !authoritativeSyncedNodeIds.has(nodeId);
      authoritativeSyncedNodeIds.add(nodeId);
      if (!moved) continue;

      for (const visual of deer) {
        if (visual.nodeId !== nodeId) continue;
        if (firstAuthoritativeSync) {
          rebaseDeerMotion(visual.motion, dx, dz);
          continue;
        }

        beginDeerMigration(
          visual.motion,
          node.x + visual.migrationOffsetX,
          node.z + visual.migrationOffsetZ,
          node.x,
          node.z,
        );
        if (!group.visible || !visual.root.visible) {
          snapDeerMigration(visual.motion, rng);
        }
      }
      habitatCenters.set(nodeId, { x: node.x, z: node.z });
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
    get deerCount() {
      return deer.reduce((count, visual) => count + Number(visual.root.visible), 0);
    },
    get doeCount() {
      return deer.reduce(
        (count, visual) => count + Number(visual.sex === 'doe' && visual.root.visible),
        0,
      );
    },
    get stagCount() {
      return deer.reduce(
        (count, visual) => count + Number(visual.sex === 'stag' && visual.root.visible),
        0,
      );
    },
    update,
    sync,
    findHuntingTarget: (query) => group.visible ? findHuntingTarget(huntingTargets, query) : null,
    diagnostics: () => Object.fromEntries(
      [...batches].map(([sex, batch]) => [sex, batch.diagnostics()]),
    ),
    dispose: () => {
      for (const visual of deer) {
        visual.mixer.stopAllAction();
        visual.mixer.uncacheRoot(visual.root.children[0]);
      }
      for (const batch of batches.values()) batch.dispose();
      batches.clear();
      group.clear();
      disposeModelResources(doeSource.scene);
      disposeModelResources(stagSource.scene);
    },
  };
}

/**
 * Selects one stable herd-wide logging threat. Distance wins first and source
 * id resolves an exact tie, so retained source arrays and subscription order
 * cannot change the direction in which a herd initially breaks.
 */
export function nearestGameHabitatDisturbanceSource(
  habitat: Readonly<{ x: number; z: number }>,
  sources: readonly GameHabitatDisturbanceSource[],
): GameHabitatDisturbanceSource | null {
  const radiusSq = DEER_ROAM_RADIUS * DEER_ROAM_RADIUS;
  let nearest: GameHabitatDisturbanceSource | null = null;
  let nearestDistanceSq = Number.POSITIVE_INFINITY;
  for (const source of sources) {
    if (!Number.isFinite(source.x) || !Number.isFinite(source.z)) continue;
    const dx = source.x - habitat.x;
    const dz = source.z - habitat.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq > radiusSq) continue;
    if (
      distanceSq < nearestDistanceSq
      || (
        distanceSq === nearestDistanceSq
        && nearest !== null
        && source.id.localeCompare(nearest.id) < 0
      )
    ) {
      nearest = source;
      nearestDistanceSq = distanceSq;
    }
  }
  return nearest;
}

function rebaseDeerMotion(state: DeerMotionState, dx: number, dz: number): void {
  state.x += dx;
  state.z += dz;
  state.homeX += dx;
  state.homeZ += dz;
  state.targetX += dx;
  state.targetZ += dz;
  if (state.migrationTargetX !== null) state.migrationTargetX += dx;
  if (state.migrationTargetZ !== null) state.migrationTargetZ += dz;
}

function syncDeerVisualTransform(visual: DeerVisual, terrain: Terrain): void {
  const bodyHeight = visual.huntingTarget.y - visual.root.position.y;
  visual.root.position.set(
    visual.motion.x,
    terrain.getHeightAt(visual.motion.x, visual.motion.z),
    visual.motion.z,
  );
  visual.root.rotation.y = visual.motion.heading;
  visual.huntingTarget.x = visual.root.position.x;
  visual.huntingTarget.y = visual.root.position.y + bodyHeight;
  visual.huntingTarget.z = visual.root.position.z;
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
  const herdSize = gamePatchVisualCapacity(site.isRich === true);
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

  // Try a deterministic spiral when random placement could not fill the herd.
  // These candidates must obey the same blocker: preserving the actor count is
  // less important than never materializing wildlife inside a physical deposit.
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  let fallbackIndex = 0;
  while (points.length < herdSize && fallbackIndex < herdSize * 60) {
    const index = fallbackIndex++;
    const radius = index === 0
      ? 2.5
      : Math.min(spawnRadius, 3 + Math.sqrt(index) * 3.35);
    const angle = index * goldenAngle;
    const x = site.x + Math.sin(angle) * radius;
    const z = site.z + Math.cos(angle) * radius;
    if (isBlockedAt?.(x, z)) continue;
    if (points.some((point) => Math.hypot(point.x - x, point.z - z) < 2.7)) continue;
    points.push({ x, z });
  }
  return points;
}

export function displayedGameHerdCount(
  remaining: number,
  maxYield: number,
): number {
  return logarithmicPopulationVisualCount(
    displayedGameAnimalCount(remaining),
    maxYield,
    GAME_PATCH_MAX_YIELD,
    GAME_PATCH_VISUAL_CAPACITY,
  );
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
