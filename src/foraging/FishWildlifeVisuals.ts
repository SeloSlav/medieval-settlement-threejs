import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mulberry32 } from '../props/forestField.ts';
import type { ForagingNodeState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ForagingSite } from './ForagingLayout.ts';
import {
  FISH_SHOAL_MAX_YIELD,
  FISH_SHOAL_VISUAL_CAPACITY,
  fishShoalVisualCapacity,
  logarithmicPopulationVisualCount,
} from './foragingYields.ts';
import {
  AuthoredAnimalInstanceBatch,
  setAuthoredAnimalEvaluatorOnly,
} from '../scene/AuthoredAnimalInstanceBatch.ts';

export const FISH_MODEL_URL = '/assets/models/fish/quaternius-fish.glb';

const FISH_TARGET_LENGTH = 0.82;
const SMALL_SCHOOL_RADIUS = 7;
const RICH_SCHOOL_RADIUS = 10;
const TAU = Math.PI * 2;

type FishAnimationMode = 'swim' | 'fast' | 'outOfWater';

type FishAnimationSet = {
  swim: THREE.AnimationAction;
  fast: THREE.AnimationAction;
  outOfWater: THREE.AnimationAction;
};

type FishBreach = {
  elapsed: number;
  duration: number;
  height: number;
  horizontalDistance: number;
  originX: number;
  originZ: number;
  heading: number;
  caught: boolean;
  landingSplashTriggered: boolean;
};

type FishVisual = {
  nodeId: string;
  poolIndex: number;
  root: THREE.Group;
  model: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: FishAnimationSet;
  activeMode: FishAnimationMode;
  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  heading: number;
  depth: number;
  speed: number;
  swimPhase: number;
  fastTimer: number;
  populationVisible: boolean;
  breach: FishBreach | null;
};

type FishSchool = {
  nodeId: string;
  homeX: number;
  homeZ: number;
  radius: number;
  fish: FishVisual[];
  ambientBreachTimer: number;
  pendingCatchBreach: boolean;
};

type SplashVisual = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  elapsed: number;
  duration: number;
};

type FishModelSource = {
  scene: THREE.Group;
  clips: {
    swim: THREE.AnimationClip;
    fast: THREE.AnimationClip;
    outOfWater: THREE.AnimationClip;
  };
  center: THREE.Vector3;
  sourceLength: number;
};

export type FishWaterContext = {
  isWaterAt: (x: number, z: number) => boolean;
  getWaterSurfaceY: (x: number, z: number) => number;
};

export type FishWildlifeVisuals = {
  group: THREE.Group;
  fishCount: number;
  update: (dtSeconds: number, cameraDistance: number, firstPersonActive: boolean) => void;
  sync: (nodes: Iterable<ForagingNodeState>) => void;
  diagnostics: () => ReturnType<AuthoredAnimalInstanceBatch['diagnostics']> | null;
  dispose: () => void;
};

export type FishBreachPose = {
  heightOffset: number;
  pitch: number;
  roll: number;
};

/**
 * Fish stock is authoritative; the rendered school follows it on a logarithmic
 * curve so low stocks remain literal without overdraw at large populations.
 */
export function displayedFishSchoolCount(
  remaining: number,
  maxYield: number,
): number {
  return logarithmicPopulationVisualCount(
    remaining,
    maxYield,
    FISH_SHOAL_MAX_YIELD,
    FISH_SHOAL_VISUAL_CAPACITY,
  );
}

/** Whole-body arc layered over the authored out-of-water skeletal animation. */
export function sampleFishBreach(progress: number, height: number): FishBreachPose {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const arc = Math.sin(Math.PI * t);
  return {
    heightOffset: arc * Math.max(0, height),
    pitch: -Math.sin(TAU * t) * 0.52,
    roll: Math.sin(TAU * 3 * t) * arc * 0.32,
  };
}

/**
 * Adds a logarithmically representative authored school at each authoritative
 * node. Population loss controls school size; a decrease while the shoal is
 * visible causes one fish to break the surface with the authored animation.
 */
export async function createFishWildlifeVisuals(
  terrain: Terrain,
  sites: ReadonlyArray<ForagingSite>,
  seed: number,
  water: FishWaterContext,
): Promise<FishWildlifeVisuals> {
  const fishSites = sites.filter((site) => site.kind === 'fish');
  const group = new THREE.Group();
  group.name = 'Animated fish at shoal resource sites';
  group.visible = false;

  if (fishSites.length === 0) {
    return {
      group,
      fishCount: 0,
      update: () => undefined,
      sync: () => undefined,
      diagnostics: () => null,
      dispose: () => undefined,
    };
  }

  const source = await loadFishModel(FISH_MODEL_URL);
  let batch: AuthoredAnimalInstanceBatch | null = null;
  const totalCapacity = fishSites.reduce(
    (sum, site) => sum + fishShoalVisualCapacity(site.isRich === true),
    0,
  );
  try {
    batch = new AuthoredAnimalInstanceBatch({
      parent: group,
      sourceRoot: source.scene,
      animations: Object.values(source.clips),
      capacity: totalCapacity,
      name: 'Fish exact-model instances',
    });
  } catch (error) {
    // The fallback is the same authored rig, never a procedural fish.
    console.warn('[Fish] Exact-model batching unavailable; retaining exact individual rigs.', error);
  }
  const rng = mulberry32(seed ^ 0xf157ca);
  const schools: FishSchool[] = [];
  const previousRemaining = new Map<string, number>();
  const splashGeometry = new THREE.RingGeometry(0.24, 0.34, 24);
  const splashMaterial = new THREE.MeshBasicMaterial({
    color: 0xdaf7ff,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const splashes = createSplashPool(group, splashGeometry, splashMaterial);

  const addFishToSchool = (school: FishSchool): void => {
    const poolIndex = school.fish.length;
    const spawn = findWaterPoint(
      school.homeX,
      school.homeZ,
      school.radius,
      rng,
      water.isWaterAt,
    );
    const target = findWaterPoint(
      school.homeX,
      school.homeZ,
      school.radius,
      rng,
      water.isWaterAt,
    );
    const model = cloneSkinned(source.scene) as THREE.Group;
    const lengthVariation = THREE.MathUtils.lerp(0.78, 1.13, rng());
    const modelScale = FISH_TARGET_LENGTH * lengthVariation / source.sourceLength;
    model.scale.setScalar(modelScale);
    model.position.copy(source.center).multiplyScalar(-modelScale);
    configureFishMeshes(model);

    const root = new THREE.Group();
    root.name = 'Rigged swimming fish';
    root.userData.nodeId = school.nodeId;
    root.userData.fishPoolIndex = poolIndex;
    root.add(model);
    setAuthoredAnimalEvaluatorOnly(model, batch !== null);
    root.visible = false;
    group.add(root);

    const mixer = new THREE.AnimationMixer(model);
    const actions: FishAnimationSet = {
      swim: mixer.clipAction(source.clips.swim, model),
      fast: mixer.clipAction(source.clips.fast, model),
      outOfWater: mixer.clipAction(source.clips.outOfWater, model),
    };
    configureFishActions(actions);
    actions.swim.play();
    actions.swim.time = rng() * actions.swim.getClip().duration;

    const heading = Math.atan2(target.x - spawn.x, target.z - spawn.z);
    const fish: FishVisual = {
      nodeId: school.nodeId,
      poolIndex,
      root,
      model,
      mixer,
      actions,
      activeMode: 'swim',
      homeX: school.homeX,
      homeZ: school.homeZ,
      x: spawn.x,
      z: spawn.z,
      targetX: target.x,
      targetZ: target.z,
      heading,
      depth: THREE.MathUtils.lerp(0.42, 0.7, rng()),
      speed: THREE.MathUtils.lerp(0.45, 0.72, rng()),
      swimPhase: rng() * TAU,
      fastTimer: 0,
      populationVisible: false,
      breach: null,
    };
    setFishWorldTransform(fish, terrain, water);
    school.fish.push(fish);
  };

  for (let siteIndex = 0; siteIndex < fishSites.length; siteIndex++) {
    const site = fishSites[siteIndex];
    const nodeId = `foraging-fish-${site.isRich ? 'rich' : 'small'}-${siteIndex}`;
    const capacity = fishShoalVisualCapacity(site.isRich === true);
    const radius = site.isRich ? RICH_SCHOOL_RADIUS : SMALL_SCHOOL_RADIUS;
    const school: FishSchool = {
      nodeId,
      homeX: site.x,
      homeZ: site.z,
      radius,
      fish: [],
      ambientBreachTimer: THREE.MathUtils.lerp(7, 13, rng()),
      pendingCatchBreach: false,
    };

    for (let poolIndex = 0; poolIndex < capacity; poolIndex++) addFishToSchool(school);
    schools.push(school);
  }

  group.userData.fishResourceCenters = schools.map((school) => ({
    nodeId: school.nodeId,
    x: school.homeX,
    z: school.homeZ,
  }));

  const update = (
    dtSeconds: number,
    _cameraDistance: number,
    _firstPersonActive: boolean,
  ): void => {
    // Camera zoom never swaps or removes an authored fish actor.
    group.visible = true;

    const dt = Math.min(Math.max(dtSeconds, 0), 0.1);
    updateSplashes(splashes, dt);
    for (const school of schools) {
      maybeStartCatchBreach(school, terrain, water, splashes, rng);
      school.ambientBreachTimer -= dt;
      if (school.ambientBreachTimer <= 0) {
        startSchoolBreach(school, false, terrain, water, splashes, rng);
        school.ambientBreachTimer = THREE.MathUtils.lerp(8, 15, rng());
      }

      for (const fish of school.fish) {
        if (!fish.root.visible) continue;
        if (fish.breach) {
          updateBreach(fish, dt, terrain, water, splashes);
        } else {
          updateSwimming(fish, school, dt, terrain, water, rng);
        }
        if (batch) batch.updateAnimation(fish.model, fish.mixer, dt);
        else fish.mixer.update(dt);
      }
    }
    if (batch) {
      const visibleFish = schools.flatMap((school) => school.fish)
        .filter((fish) => fish.root.visible);
      batch.beginFrame(visibleFish.length);
      for (const fish of visibleFish) batch.submit(fish.model);
      batch.endFrame();
    }
  };

  const sync = (nodes: Iterable<ForagingNodeState>): void => {
    const fishNodes = new Map(
      Array.from(nodes)
        .filter((node) => node.kind === 'fish')
        .map((node) => [node.nodeId, node] as const),
    );

    for (const school of schools) {
      const node = fishNodes.get(school.nodeId);
      const priorRemaining = previousRemaining.get(school.nodeId);
      const visibleCount = node
        ? displayedFishSchoolCount(node.remaining, node.maxYield)
        : 0;

      while (school.fish.length < visibleCount) addFishToSchool(school);

      for (const fish of school.fish) {
        fish.populationVisible = fish.poolIndex < visibleCount;
        fish.root.visible = fish.populationVisible || fish.breach?.caught === true;
      }

      if (node) {
        if (
          group.visible
          && priorRemaining !== undefined
          && node.remaining < priorRemaining - 0.01
        ) {
          school.pendingCatchBreach = true;
        }
        previousRemaining.set(school.nodeId, node.remaining);
        moveSchoolHome(school, node.x, node.z);
      } else {
        previousRemaining.delete(school.nodeId);
      }
    }

    group.userData.fishResourceCenters = schools.map((school) => ({
      nodeId: school.nodeId,
      x: school.homeX,
      z: school.homeZ,
    }));
  };

  return {
    group,
    get fishCount() {
      return schools.reduce(
        (total, school) => total + school.fish.reduce(
          (schoolTotal, fish) => schoolTotal + Number(fish.root.visible),
          0,
        ),
        0,
      );
    },
    update,
    sync,
    diagnostics: () => batch?.diagnostics() ?? null,
    dispose: () => {
      for (const school of schools) {
        for (const fish of school.fish) {
          fish.mixer.stopAllAction();
          fish.mixer.uncacheRoot(fish.model);
        }
      }
      batch?.dispose();
      batch = null;
      group.clear();
      splashGeometry.dispose();
      splashMaterial.dispose();
      disposeModelResources(source.scene);
    },
  };
}

async function loadFishModel(url: string): Promise<FishModelSource> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new THREE.Vector3());
  const sourceLength = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(sourceLength) || sourceLength <= 0.001) {
    throw new Error('The fish model has invalid bounds.');
  }

  const animations = new Map(
    gltf.animations.map((clip) => [clip.name.toLowerCase(), clip] as const),
  );
  const requireClip = (suffix: string): THREE.AnimationClip => {
    const clip = [...animations.entries()]
      .find(([name]) => name.endsWith(suffix.toLowerCase()))?.[1];
    if (!clip) throw new Error(`The fish model is missing its ${suffix} animation.`);
    return clip;
  };

  return {
    scene: gltf.scene,
    clips: {
      swim: requireClip('Swimming_Normal'),
      fast: requireClip('Swimming_Fast'),
      outOfWater: requireClip('Out_Of_Water'),
    },
    center: bounds.getCenter(new THREE.Vector3()),
    sourceLength,
  };
}

function configureFishMeshes(model: THREE.Object3D): void {
  model.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
  });
}

function configureFishActions(actions: FishAnimationSet): void {
  actions.swim.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
  actions.fast.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
  actions.outOfWater.setLoop(THREE.LoopOnce, 1);
  actions.outOfWater.clampWhenFinished = true;
  for (const action of Object.values(actions)) action.enabled = true;
  actions.swim.setEffectiveTimeScale(0.92);
  actions.fast.setEffectiveTimeScale(1.08);
}

function updateSwimming(
  fish: FishVisual,
  school: FishSchool,
  dt: number,
  terrain: Terrain,
  water: FishWaterContext,
  rng: () => number,
): void {
  let dx = fish.targetX - fish.x;
  let dz = fish.targetZ - fish.z;
  let distance = Math.hypot(dx, dz);
  if (distance < 0.6) {
    const target = findWaterPoint(
      school.homeX,
      school.homeZ,
      school.radius,
      rng,
      water.isWaterAt,
    );
    fish.targetX = target.x;
    fish.targetZ = target.z;
    dx = fish.targetX - fish.x;
    dz = fish.targetZ - fish.z;
    distance = Math.hypot(dx, dz);
    if (rng() < 0.22) fish.fastTimer = THREE.MathUtils.lerp(0.7, 1.4, rng());
  }

  const desiredHeading = distance > 0.001 ? Math.atan2(dx, dz) : fish.heading;
  fish.heading = turnAngleToward(fish.heading, desiredHeading, dt * 1.7);
  fish.fastTimer = Math.max(0, fish.fastTimer - dt);
  const nextMode: FishAnimationMode = fish.fastTimer > 0 ? 'fast' : 'swim';
  transitionFishAnimation(fish, nextMode);

  const speed = fish.speed * (fish.fastTimer > 0 ? 1.65 : 1);
  const nextX = fish.x + Math.sin(fish.heading) * speed * dt;
  const nextZ = fish.z + Math.cos(fish.heading) * speed * dt;
  if (water.isWaterAt(nextX, nextZ)) {
    fish.x = nextX;
    fish.z = nextZ;
  } else {
    fish.heading += Math.PI * 0.65;
    const target = findWaterPoint(
      school.homeX,
      school.homeZ,
      school.radius,
      rng,
      water.isWaterAt,
    );
    fish.targetX = target.x;
    fish.targetZ = target.z;
  }

  fish.swimPhase += dt * (fish.fastTimer > 0 ? 2.1 : 1.35);
  setFishWorldTransform(fish, terrain, water);
}

function setFishWorldTransform(
  fish: FishVisual,
  terrain: Terrain,
  water: FishWaterContext,
): void {
  const bedY = terrain.getHeightAt(fish.x, fish.z);
  const surfaceY = water.getWaterSurfaceY(fish.x, fish.z);
  const swimY = surfaceY - fish.depth + Math.sin(fish.swimPhase) * 0.055;
  fish.root.position.set(
    fish.x,
    THREE.MathUtils.clamp(swimY, bedY + 0.2, surfaceY - 0.18),
    fish.z,
  );
  fish.root.rotation.set(0, fish.heading, 0);
}

function startSchoolBreach(
  school: FishSchool,
  caught: boolean,
  terrain: Terrain,
  water: FishWaterContext,
  splashes: SplashVisual[],
  rng: () => number,
): boolean {
  const candidates = school.fish.filter((fish) =>
    fish.breach === null && (fish.populationVisible || caught)
  );
  if (candidates.length === 0) return false;
  const fish = candidates[Math.floor(rng() * candidates.length)];
  fish.root.visible = true;
  const duration = caught
    ? THREE.MathUtils.lerp(1.35, 1.6, rng())
    : THREE.MathUtils.lerp(1.05, 1.3, rng());
  fish.breach = {
    elapsed: 0,
    duration,
    height: caught
      ? THREE.MathUtils.lerp(0.82, 1.05, rng())
      : THREE.MathUtils.lerp(0.58, 0.76, rng()),
    horizontalDistance: caught
      ? THREE.MathUtils.lerp(0.7, 1.15, rng())
      : THREE.MathUtils.lerp(0.45, 0.85, rng()),
    originX: fish.x,
    originZ: fish.z,
    heading: fish.heading,
    caught,
    landingSplashTriggered: false,
  };
  transitionFishAnimation(fish, 'outOfWater', duration);
  triggerSplash(
    splashes,
    fish.x,
    fish.z,
    water.getWaterSurfaceY(fish.x, fish.z) + 0.018,
  );
  setFishWorldTransform(fish, terrain, water);
  return true;
}

function maybeStartCatchBreach(
  school: FishSchool,
  terrain: Terrain,
  water: FishWaterContext,
  splashes: SplashVisual[],
  rng: () => number,
): void {
  if (!school.pendingCatchBreach) return;
  if (startSchoolBreach(school, true, terrain, water, splashes, rng)) {
    school.pendingCatchBreach = false;
  }
}

function updateBreach(
  fish: FishVisual,
  dt: number,
  terrain: Terrain,
  water: FishWaterContext,
  splashes: SplashVisual[],
): void {
  const breach = fish.breach;
  if (!breach) return;
  breach.elapsed += dt;
  const progress = THREE.MathUtils.clamp(breach.elapsed / breach.duration, 0, 1);
  const pose = sampleFishBreach(progress, breach.height);
  const travel = breach.horizontalDistance * progress;
  const x = breach.originX + Math.sin(breach.heading) * travel;
  const z = breach.originZ + Math.cos(breach.heading) * travel;
  const surfaceY = water.getWaterSurfaceY(x, z);

  fish.root.position.set(x, surfaceY - 0.27 + pose.heightOffset, z);
  fish.root.rotation.set(pose.pitch, breach.heading, pose.roll);

  if (!breach.landingSplashTriggered && progress >= 0.82) {
    breach.landingSplashTriggered = true;
    triggerSplash(splashes, x, z, surfaceY + 0.018);
  }
  if (progress < 1) return;

  fish.x = water.isWaterAt(x, z) ? x : breach.originX;
  fish.z = water.isWaterAt(x, z) ? z : breach.originZ;
  fish.breach = null;
  fish.fastTimer = 0.85;
  transitionFishAnimation(fish, 'fast');
  fish.root.visible = fish.populationVisible;
  setFishWorldTransform(fish, terrain, water);
}

function transitionFishAnimation(
  fish: FishVisual,
  nextMode: FishAnimationMode,
  eventDuration?: number,
): void {
  if (fish.activeMode === nextMode && nextMode !== 'outOfWater') return;
  const previous = fish.actions[fish.activeMode];
  const next = fish.actions[nextMode];
  previous.fadeOut(0.12);
  next.reset();
  if (nextMode === 'outOfWater' && eventDuration) {
    next.setEffectiveTimeScale(next.getClip().duration / eventDuration);
  }
  next.fadeIn(0.12).play();
  fish.activeMode = nextMode;
}

function moveSchoolHome(school: FishSchool, nextX: number, nextZ: number): void {
  const dx = nextX - school.homeX;
  const dz = nextZ - school.homeZ;
  if (Math.hypot(dx, dz) <= 0.01) return;
  school.homeX = nextX;
  school.homeZ = nextZ;
  for (const fish of school.fish) {
    fish.homeX = nextX;
    fish.homeZ = nextZ;
    fish.x += dx;
    fish.z += dz;
    fish.targetX += dx;
    fish.targetZ += dz;
    if (fish.breach) {
      fish.breach.originX += dx;
      fish.breach.originZ += dz;
    }
  }
}

function findWaterPoint(
  centerX: number,
  centerZ: number,
  radius: number,
  rng: () => number,
  isWaterAt: (x: number, z: number) => boolean,
): { x: number; z: number } {
  for (let attempt = 0; attempt < 24; attempt++) {
    const sampleRadius = Math.sqrt(rng()) * radius;
    const angle = rng() * TAU;
    const x = centerX + Math.sin(angle) * sampleRadius;
    const z = centerZ + Math.cos(angle) * sampleRadius;
    if (isWaterAt(x, z)) return { x, z };
  }
  return { x: centerX, z: centerZ };
}

function turnAngleToward(current: number, target: number, maxStep: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + THREE.MathUtils.clamp(delta, -maxStep, maxStep);
}

function createSplashPool(
  group: THREE.Group,
  geometry: THREE.RingGeometry,
  material: THREE.MeshBasicMaterial,
): SplashVisual[] {
  const splashes: SplashVisual[] = [];
  for (let index = 0; index < 8; index++) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'Fish surface splash ring';
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.renderOrder = 5;
    mesh.visible = false;
    group.add(mesh);
    splashes.push({ mesh, elapsed: 0, duration: 0.68 });
  }
  return splashes;
}

function triggerSplash(
  splashes: SplashVisual[],
  x: number,
  z: number,
  y: number,
): void {
  const splash = splashes.find((entry) => !entry.mesh.visible) ?? splashes[0];
  splash.elapsed = 0;
  splash.mesh.position.set(x, y, z);
  splash.mesh.scale.setScalar(0.55);
  splash.mesh.visible = true;
}

function updateSplashes(splashes: SplashVisual[], dt: number): void {
  for (const splash of splashes) {
    if (!splash.mesh.visible) continue;
    splash.elapsed += dt;
    const progress = splash.elapsed / splash.duration;
    if (progress >= 1) {
      splash.mesh.visible = false;
      continue;
    }
    splash.mesh.scale.setScalar(THREE.MathUtils.lerp(0.55, 2.4, progress));
    splash.mesh.material.opacity = (1 - progress) * 0.72;
  }
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
