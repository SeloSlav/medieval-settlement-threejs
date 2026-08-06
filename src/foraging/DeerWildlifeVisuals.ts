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
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
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
  skeleton: THREE.Skeleton;
  mixer: THREE.AnimationMixer;
  actions: DeerAnimationSet;
  activeMode: DeerBehaviorMode;
  motion: DeerMotionState;
};

type DeerCasterLayer = {
  mesh: THREE.SkinnedMesh;
  geometry: THREE.BufferGeometry;
  sourceDrawCount: number;
};

type DeerCasterShard = {
  capacity: number;
  skeleton: THREE.Skeleton;
  layers: DeerCasterLayer[];
};

type AnimatedDeerCasterBatches = {
  group: THREE.Group;
  refreshVisibility: () => void;
  dispose: () => void;
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
 * Eight complete live rigs stay well below WebGPU's minimum 64 KiB uniform
 * binding limit, including the larger 46-bone doe skeleton (23,552 bytes).
 */
export const DEER_CASTER_RIGS_PER_SHARD = 8;
export const MAX_DEER_CASTER_SKELETON_BYTES = 32_768;

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
      const skeleton = requireSharedModelSkeleton(model, sex);

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
        skeleton,
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
  const casterBatches = createAnimatedDeerCasterBatches(
    group,
    deer,
    modelSources,
  );

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
    casterBatches.refreshVisibility();
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
      casterBatches.dispose();
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

function requireSharedModelSkeleton(
  model: THREE.Object3D,
  sex: DeerSex,
): THREE.Skeleton {
  let skeleton: THREE.Skeleton | null = null;
  model.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    if (skeleton === null) skeleton = mesh.skeleton;
    else if (!skeletonsUseSharedRig(mesh.skeleton, skeleton)) {
      throw new Error(`The ${sex} deer layers must share one exact rig.`);
    }
  });
  if (skeleton === null) throw new Error(`The ${sex} deer model has no skinned mesh.`);
  return skeleton;
}

/**
 * SkeletonUtils.clone creates one Skeleton wrapper per skinned material layer,
 * even though those wrappers reference the same cloned bones and bind pose.
 * The shadow batch only requires that exact shared rig, not wrapper identity.
 */
export function skeletonsUseSharedRig(
  left: THREE.Skeleton,
  right: THREE.Skeleton,
): boolean {
  if (
    left.bones.length !== right.bones.length
    || left.boneInverses.length !== right.boneInverses.length
  ) {
    return false;
  }
  for (let index = 0; index < left.bones.length; index += 1) {
    if (
      left.bones[index] !== right.bones[index]
      || !left.boneInverses[index]!.equals(right.boneInverses[index]!)
    ) {
      return false;
    }
  }
  return true;
}

function createAnimatedDeerCasterBatches(
  parent: THREE.Group,
  deer: readonly DeerVisual[],
  sources: Readonly<Record<DeerSex, DeerModelSource>>,
): AnimatedDeerCasterBatches {
  const group = new THREE.Group();
  group.name = 'Animated deer exact caster batches';
  group.userData.animatedDeerCasterBatch = true;
  parent.add(group);

  const bySex: Record<DeerSex, DeerVisual[]> = { doe: [], stag: [] };
  for (const visual of deer) bySex[visual.sex].push(visual);
  const shardsBySex: Record<DeerSex, DeerCasterShard[]> = { doe: [], stag: [] };
  let sourceMeshCount = 0;
  let sourceTriangleCount = 0;
  let batchMeshCount = 0;
  let replicatedGeometryBytes = 0;
  let maximumSkeletonBytes = 0;

  try {
    for (const sex of ['doe', 'stag'] as const) {
      const visuals = bySex[sex];
      if (visuals.length === 0) continue;
      const sourceMeshes = collectSkinnedMeshes(sources[sex].scene);
      const sourceSkeleton = sourceMeshes[0]?.skeleton;
      if (!sourceSkeleton) throw new Error(`The ${sex} deer source has no skeleton.`);
      for (const sourceMesh of sourceMeshes) {
        if (!skeletonsUseSharedRig(sourceMesh.skeleton, sourceSkeleton)) {
          throw new Error(`The ${sex} deer source layers must share one rig.`);
        }
        if (Object.keys(sourceMesh.geometry.morphAttributes).length > 0) {
          throw new Error(`The ${sex}/${sourceMesh.name} caster cannot merge morph targets.`);
        }
        if (sourceMesh.geometry.drawRange.start !== 0) {
          throw new Error(`The ${sex}/${sourceMesh.name} caster requires a zero draw start.`);
        }
      }
      const bonesPerRig = sourceSkeleton.bones.length;
      for (
        let shardStart = 0;
        shardStart < visuals.length;
        shardStart += DEER_CASTER_RIGS_PER_SHARD
      ) {
        const capacity = Math.min(
          DEER_CASTER_RIGS_PER_SHARD,
          visuals.length - shardStart,
        );
        const skeletonBytes = bonesPerRig * capacity * 16
          * Float32Array.BYTES_PER_ELEMENT;
        if (skeletonBytes > MAX_DEER_CASTER_SKELETON_BYTES) {
          throw new Error(
            `${sex} deer caster skeleton requires ${skeletonBytes} bytes; `
              + `the exact shard limit is ${MAX_DEER_CASTER_SKELETON_BYTES}.`,
          );
        }
        maximumSkeletonBytes = Math.max(maximumSkeletonBytes, skeletonBytes);
        const initialVisual = visuals[shardStart]!;
        const bones: THREE.Bone[] = [];
        const inverses: THREE.Matrix4[] = [];
        for (let slot = 0; slot < capacity; slot += 1) {
          bones.push(...initialVisual.skeleton.bones);
          inverses.push(...initialVisual.skeleton.boneInverses);
        }
        const skeleton = new THREE.Skeleton(bones, inverses);
        const layers = sourceMeshes.map((sourceMesh, layerIndex) => {
          const geometry = createReplicatedDeerCasterGeometry(
            sourceMesh.geometry,
            bonesPerRig,
            capacity,
          );
          replicatedGeometryBytes += geometryByteLength(geometry);
          const mesh = new THREE.SkinnedMesh(geometry, sourceMesh.material);
          mesh.name = `${sex} animated deer exact caster batch ${
            Math.floor(shardStart / DEER_CASTER_RIGS_PER_SHARD) + 1
          }:${layerIndex + 1}`;
          mesh.bindMode = sourceMesh.bindMode;
          mesh.bind(skeleton, sourceMesh.bindMatrix);
          mesh.layers.set(TREE_SHADOW_CAST_LAYER);
          mesh.castShadow = true;
          mesh.receiveShadow = false;
          mesh.frustumCulled = false;
          mesh.renderOrder = sourceMesh.renderOrder;
          mesh.customDepthMaterial = sourceMesh.customDepthMaterial;
          mesh.customDistanceMaterial = sourceMesh.customDistanceMaterial;
          mesh.userData.animatedDeerCasterBatch = true;
          mesh.userData.sourceDeerCapacity = capacity;
          const sourceDrawCount = sourceMesh.geometry.index?.count
            ?? sourceMesh.geometry.getAttribute('position').count;
          mesh.userData.sourceDrawCount = sourceDrawCount;
          mesh.userData.sourceTriangleCount = sourceDrawCount / 3;
          group.add(mesh);
          batchMeshCount += 1;
          return { mesh, geometry, sourceDrawCount };
        });
        shardsBySex[sex].push({ capacity, skeleton, layers });
      }
      sourceMeshCount += sourceMeshes.length * visuals.length;
      sourceTriangleCount += sourceMeshes.reduce(
        (sum, mesh) => sum + (
          mesh.geometry.index?.count
            ?? mesh.geometry.getAttribute('position').count
        ) / 3,
        0,
      ) * visuals.length;
    }

    // Color remains on the authored meshes. Only their duplicate shadow
    // submissions move to the exact aggregate caster layer.
    for (const visual of deer) {
      visual.root.traverse((object) => {
        const mesh = object as THREE.SkinnedMesh;
        if (mesh.isSkinnedMesh) mesh.castShadow = false;
      });
    }
  } catch (error) {
    for (const shards of Object.values(shardsBySex)) {
      for (const shard of shards) {
        for (const layer of shard.layers) layer.geometry.dispose();
        shard.skeleton.dispose();
      }
    }
    group.removeFromParent();
    throw error;
  }

  const refreshVisibility = (): void => {
    let activeMeshCount = 0;
    let visibleDeerCount = 0;
    let visibleTriangleCount = 0;
    for (const sex of ['doe', 'stag'] as const) {
      const visuals = bySex[sex];
      let nextVisual = 0;
      for (const shard of shardsBySex[sex]) {
        let shardCount = 0;
        while (shardCount < shard.capacity) {
          let visual: DeerVisual | undefined;
          while (nextVisual < visuals.length) {
            const candidate = visuals[nextVisual++]!;
            if (candidate.root.visible) {
              visual = candidate;
              break;
            }
          }
          if (!visual) break;
          const boneOffset = shardCount * visual.skeleton.bones.length;
          for (let bone = 0; bone < visual.skeleton.bones.length; bone += 1) {
            shard.skeleton.bones[boneOffset + bone] = visual.skeleton.bones[bone]!;
            shard.skeleton.boneInverses[boneOffset + bone] =
              visual.skeleton.boneInverses[bone]!;
          }
          shardCount += 1;
        }
        visibleDeerCount += shardCount;
        for (const layer of shard.layers) {
          const drawCount = shardCount * layer.sourceDrawCount;
          layer.geometry.setDrawRange(0, drawCount);
          layer.mesh.visible = shardCount > 0;
          layer.mesh.userData.sourceDeerCount = shardCount;
          if (shardCount > 0) activeMeshCount += 1;
          visibleTriangleCount += drawCount / 3;
        }
      }
    }
    group.userData.visibleDeerCount = visibleDeerCount;
    group.userData.activeBatchMeshCount = activeMeshCount;
    group.userData.visibleTriangleCount = visibleTriangleCount;
  };

  group.userData.sourceMeshCount = sourceMeshCount;
  group.userData.batchMeshCount = batchMeshCount;
  group.userData.sourceTriangleCount = sourceTriangleCount;
  group.userData.replicatedGeometryBytes = replicatedGeometryBytes;
  group.userData.maximumSkeletonBytes = maximumSkeletonBytes;
  refreshVisibility();

  return {
    group,
    refreshVisibility,
    dispose: () => {
      for (const shards of Object.values(shardsBySex)) {
        for (const shard of shards) {
          for (const layer of shard.layers) {
            layer.mesh.removeFromParent();
            layer.geometry.dispose();
          }
          shard.skeleton.dispose();
        }
      }
      group.removeFromParent();
    },
  };
}

function collectSkinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) meshes.push(mesh);
  });
  return meshes;
}

/** Exact indexed/attribute replication with a disjoint bone range per live rig. */
export function createReplicatedDeerCasterGeometry(
  source: THREE.BufferGeometry,
  bonesPerRig: number,
  rigCount: number,
): THREE.BufferGeometry {
  if (!Number.isInteger(rigCount) || rigCount < 1) {
    throw new Error('A deer caster shard requires at least one rig.');
  }
  const merged = new THREE.BufferGeometry();
  const sourceVertexCount = source.getAttribute('position').count;
  for (const [name, sourceAttribute] of Object.entries(source.attributes)) {
    if (sourceAttribute instanceof THREE.InterleavedBufferAttribute) {
      throw new Error(`Deer ${name} attribute must remain non-interleaved.`);
    }
    const attribute = sourceAttribute as THREE.BufferAttribute;
    const itemCount = attribute.array.length;
    const ArrayType = attribute.array.constructor as {
      new(length: number): typeof attribute.array;
    };
    const values = new ArrayType(itemCount * rigCount);
    for (let slot = 0; slot < rigCount; slot += 1) {
      const targetOffset = slot * itemCount;
      values.set(attribute.array, targetOffset);
      if (name !== 'skinIndex') continue;
      const boneOffset = slot * bonesPerRig;
      for (let index = 0; index < itemCount; index += 1) {
        values[targetOffset + index] += boneOffset;
      }
    }
    const replicated = new THREE.BufferAttribute(
      values,
      attribute.itemSize,
      attribute.normalized,
    );
    replicated.setUsage(attribute.usage);
    replicated.gpuType = attribute.gpuType;
    merged.setAttribute(name, replicated);
  }
  const morphAttributeNames = Object.keys(source.morphAttributes) as Array<
    keyof THREE.BufferGeometry['morphAttributes']
  >;
  for (const name of morphAttributeNames) {
    const morphTargets = source.morphAttributes[name];
    if (!morphTargets) continue;
    merged.morphAttributes[name] = morphTargets.map((sourceAttribute) => {
      if (sourceAttribute instanceof THREE.InterleavedBufferAttribute) {
        throw new Error(`Deer ${name} morph attribute must remain non-interleaved.`);
      }
      const attribute = sourceAttribute as THREE.BufferAttribute;
      const ArrayType = attribute.array.constructor as {
        new(length: number): typeof attribute.array;
      };
      const values = new ArrayType(attribute.array.length * rigCount);
      for (let slot = 0; slot < rigCount; slot += 1) {
        values.set(attribute.array, slot * attribute.array.length);
      }
      const replicated = new THREE.BufferAttribute(
        values,
        attribute.itemSize,
        attribute.normalized,
      );
      replicated.setUsage(attribute.usage);
      replicated.gpuType = attribute.gpuType;
      return replicated;
    });
  }
  merged.morphTargetsRelative = source.morphTargetsRelative;

  const sourceIndex = source.index;
  const sourceDrawCount = sourceIndex?.count ?? sourceVertexCount;
  if (sourceIndex) {
    const useUint32 = sourceIndex.array instanceof Uint32Array
      || sourceVertexCount * rigCount > 65_535;
    const values = useUint32
      ? new Uint32Array(sourceIndex.count * rigCount)
      : new Uint16Array(sourceIndex.count * rigCount);
    for (let slot = 0; slot < rigCount; slot += 1) {
      const vertexOffset = slot * sourceVertexCount;
      const targetOffset = slot * sourceIndex.count;
      for (let index = 0; index < sourceIndex.count; index += 1) {
        values[targetOffset + index] = sourceIndex.getX(index) + vertexOffset;
      }
    }
    const replicatedIndex = new THREE.BufferAttribute(values, 1);
    replicatedIndex.setUsage(sourceIndex.usage);
    replicatedIndex.gpuType = sourceIndex.gpuType;
    merged.setIndex(replicatedIndex);
  }
  for (let slot = 0; slot < rigCount; slot += 1) {
    const drawOffset = slot * sourceDrawCount;
    for (const sourceGroup of source.groups) {
      merged.addGroup(
        drawOffset + sourceGroup.start,
        sourceGroup.count,
        sourceGroup.materialIndex,
      );
    }
  }
  merged.name = `${source.name}: exact deer caster x${rigCount}`;
  return merged;
}

function geometryByteLength(geometry: THREE.BufferGeometry): number {
  let bytes = geometry.index?.array.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += (attribute as THREE.BufferAttribute).array.byteLength;
  }
  for (const attributes of Object.values(geometry.morphAttributes)) {
    for (const attribute of attributes) {
      bytes += (attribute as THREE.BufferAttribute).array.byteLength;
    }
  }
  return bytes;
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
