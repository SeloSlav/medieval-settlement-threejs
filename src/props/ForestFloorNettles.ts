import * as THREE from 'three';
import { MeshSSSNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  cameraViewMatrix,
  float,
  mix,
  normalMap,
  normalView,
  normalWorldGeometry,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  texture,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { WIND_DIR } from '@seedthree/core/wind.js';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import { supportsNodeMaterials } from '../scene/RendererBackend.ts';
import { applyFoliageDoubleSideNormals } from '../scene/foliageDoubleSideNormals.ts';
import { chainMaterialShaderPatch } from '../scene/materialShaderPatch.ts';
import { SpatialHash2D } from '../utils/SpatialHash2D.ts';
import { mulberry32 } from '../utils/random.ts';
import type { DeciduousFoliagePresentation } from '../world/deciduousFoliagePolicy.ts';
import {
  createGorskiShrubPrototype,
  GORSKI_SHRUB_VARIANT_COUNT,
  type GorskiShrubPrototype,
} from '../vegetation/seedthree/gorskiShrubPrototypes.ts';
import {
  applyRootedGeometryWebGLWind,
  createRootedGeometryWindPosition,
} from '../vegetation/seedthree/seedThreeFoliageWind.ts';
import {
  seedThreeBarkUrl,
  seedThreeLeafUrl,
} from '../vegetation/seedthree/seedThreeTextures.ts';
import { createForestFloorPlacementMask } from './ForestFloorPlacementMask.ts';
import type { ForestTreePlacement } from './forestPlacements.ts';

export const FOREST_FLOOR_NETTLE_SEED = 0x75727469;
/** Safety ceiling only; normal population scales from accepted forest trees. */
export const FOREST_FLOOR_NETTLE_MAX_INSTANCES = 192_000;
export const FOREST_FLOOR_NETTLE_COLONY_CHANCE = 0.8;
export const FOREST_FLOOR_NETTLE_COLONY_MIN_STEMS = 5;
export const FOREST_FLOOR_NETTLE_COLONY_MAX_STEMS = 9;
export const FOREST_FLOOR_NETTLE_COLONY_RADIUS_MIN = 0.68;
export const FOREST_FLOOR_NETTLE_COLONY_RADIUS_MAX = 1.34;
export const FOREST_FLOOR_NETTLE_MIN_SPACING = 0.34;
export const FOREST_FLOOR_NETTLE_CLEAR_RADIUS = 0.34;
export const FOREST_FLOOR_NETTLE_MIN_HEIGHT = 0.82;
export const FOREST_FLOOR_NETTLE_MAX_HEIGHT = 1.18;
export const FOREST_FLOOR_NETTLE_UNDERGROWTH_CLEAR_RADIUS = 0.76;
export const FOREST_FLOOR_NETTLE_STREAM_RADIUS = 104;
export const FOREST_FLOOR_NETTLE_STREAM_REBUILD_DISTANCE = 10;

const FOREST_FLOOR_NETTLE_HEIGHT_REFERENCE = 0.9;
/** Maximum authored blocker sample offset from a nettle placement center. */
export const FOREST_FLOOR_NETTLE_BLOCKER_SAMPLE_REACH =
  FOREST_FLOOR_NETTLE_CLEAR_RADIUS
  * (FOREST_FLOOR_NETTLE_MAX_HEIGHT / FOREST_FLOOR_NETTLE_HEIGHT_REFERENCE)
  * 1.02;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const NETTLE_LEAF_FILES = {
  albedo: 'stinging_nettle_single_albedo.png',
  normal: 'stinging_nettle_single_normal.png',
  roughness: 'stinging_nettle_single_roughness.png',
  translucency: 'stinging_nettle_single_translucency.png',
} as const;

const NETTLE_STEM_FILES = {
  albedo: 'stinging_nettle_stem_albedo.png',
  normal: 'stinging_nettle_stem_normal.png',
  roughness: 'stinging_nettle_stem_roughness.png',
} as const;

const Y_AXIS = new THREE.Vector3(0, 1, 0);

type TslNode = {
  mul(value: unknown): TslNode;
  add(value: unknown): TslNode;
  sub(value: unknown): TslNode;
  div(value: unknown): TslNode;
  max(value: unknown): TslNode;
  clamp(minimum: unknown, maximum: unknown): TslNode;
  r: TslNode;
  g: TslNode;
  b: TslNode;
  a: TslNode;
  rgb: TslNode;
  xyz: TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
};

const tsl = {
  cameraViewMatrix: cameraViewMatrix as unknown as TslNode,
  float: float as (value: number) => TslNode,
  mix: mix as (left: unknown, right: unknown, amount: unknown) => TslNode,
  normalMap: normalMap as (sample: unknown) => TslNode,
  normalView: normalView as unknown as TslNode,
  normalWorldGeometry: normalWorldGeometry as unknown as TslNode,
  normalize: normalize as (value: unknown) => TslNode,
  positionWorld: positionWorld as unknown as TslNode,
  sin: sin as (value: unknown) => TslNode,
  smoothstep: smoothstep as (low: unknown, high: unknown, value: unknown) => TslNode,
  texture: texture as (map: THREE.Texture) => TslNode,
  uniform: uniform as <T>(value: T) => { value: T } & TslNode,
  vec3: vec3 as (x: unknown, y?: unknown, z?: unknown) => TslNode,
  vec4: vec4 as (x: unknown, y?: unknown, z?: unknown, w?: unknown) => TslNode,
};

type NettleTextureSet = {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  translucency?: THREE.Texture;
};

export type ForestFloorNettlePlacement = {
  x: number;
  z: number;
  sourceTreeIndex: number;
  colonyIndex: number;
  colonyX: number;
  colonyZ: number;
  targetHeight: number;
  widthScale: number;
  yaw: number;
  lean: number;
  leanDirection: number;
  prototypeIndex: number;
  meshIndex: number;
};

export type ForestFloorNettleStats = {
  instances: number;
  colonies: number;
  residentInstances: number;
  drawCalls: number;
  trianglesPerPrototype: number[];
  triangles: number;
  seed: number;
  streamRadius: number;
};

export type ForestFloorNettleBlocker = (x: number, z: number) => boolean;

type NettleBucket = {
  mesh: THREE.InstancedMesh;
  placements: ForestFloorNettlePlacement[];
  placementIndices: number[];
  matrixElements: Float32Array;
  anchorElements: Float32Array;
  windElements: Float32Array;
  colorElements: Float32Array;
  anchorAttribute: THREE.InstancedBufferAttribute;
  windAttribute: THREE.InstancedBufferAttribute;
};

export type ForestFloorNettleInstances = {
  group: THREE.Group;
  placements: ForestFloorNettlePlacement[];
  placementIndicesByTree: number[][];
  buckets: NettleBucket[];
  stats: ForestFloorNettleStats;
  setTreeActive(treeIndex: number, active: boolean): boolean;
  setPlacementActive(placementIndex: number, active: boolean): boolean;
  refreshBlockedMask(
    isBlockedAt?: ForestFloorNettleBlocker,
    shouldEvaluate?: (placement: ForestFloorNettlePlacement, placementIndex: number) => boolean,
  ): number;
  setDeciduousFoliage(presentation: DeciduousFoliagePresentation): boolean;
  setSnowCoverage(coverage: number): boolean;
  updateCamera(cameraPosition: Pick<THREE.Vector3, 'x' | 'z'>, closeDetailVisible: boolean): boolean;
  commit(): void;
  dispose(): void;
};

export async function createForestFloorNettleInstances(
  trees: readonly ForestTreePlacement[],
  terrain: Terrain,
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind | undefined,
  seed = FOREST_FLOOR_NETTLE_SEED,
  isBlockedAt?: ForestFloorNettleBlocker,
  providedPlacements?: ForestFloorNettlePlacement[],
): Promise<ForestFloorNettleInstances> {
  const [leafTextures, stemTextures] = await Promise.all([
    loadLeafTextures(maxAnisotropy),
    loadStemTextures(maxAnisotropy),
  ]);
  const useNodeMaterials = supportsNodeMaterials(rendererBackend ?? 'webgl');
  const branchMaterial = createNettleBranchMaterial(stemTextures, useNodeMaterials);
  const foliageMaterial = createNettleFoliageMaterial(leafTextures, useNodeMaterials);
  const prototypes = Array.from(
    { length: GORSKI_SHRUB_VARIANT_COUNT },
    (_, variant) => createGorskiShrubPrototype('nettle', variant),
  );
  const placements = providedPlacements
    ?? createForestFloorNettlePlacements(trees, seed, isBlockedAt);
  const group = new THREE.Group();
  group.name = 'SeedThree young stinging nettles';
  group.visible = false;
  const buckets = prototypes.map((prototype, prototypeIndex) => {
    const placementIndices = placements
      .map((placement, placementIndex) => ({ placement, placementIndex }))
      .filter(({ placement }) => placement.prototypeIndex === prototypeIndex)
      .map(({ placementIndex }) => placementIndex);
    const bucketPlacements = placementIndices.map((placementIndex) => placements[placementIndex]!);
    const bucket = createNettleBucket(
      prototype,
      prototypeIndex,
      bucketPlacements,
      placementIndices,
      terrain,
      branchMaterial,
      foliageMaterial,
      seed,
    );
    group.add(bucket.mesh);
    return bucket;
  });
  const placementVisible = placements.map(() => true);
  let streamDirty = true;
  let seasonalDormancy = 0;
  let lastStreamX = Number.NaN;
  let lastStreamZ = Number.NaN;
  const streamMatrix = new THREE.Matrix4();
  const stats: ForestFloorNettleStats = {
    instances: placements.length,
    colonies: new Set(placements.map((placement) => placement.colonyIndex)).size,
    residentInstances: 0,
    drawCalls: buckets.filter((bucket) => bucket.placements.length > 0).length * 2,
    trianglesPerPrototype: prototypes.map((prototype) => prototype.triangleCount),
    triangles: buckets.reduce(
      (total, bucket, index) => total
        + bucket.placements.length * prototypes[index]!.triangleCount,
      0,
    ),
    seed,
    streamRadius: FOREST_FLOOR_NETTLE_STREAM_RADIUS,
  };

  const rebuildResidentInstances = (cameraX: number, cameraZ: number): void => {
    const radiusSquared = FOREST_FLOOR_NETTLE_STREAM_RADIUS ** 2;
    let residentInstances = 0;
    for (const bucket of buckets) {
      const matrixTarget = bucket.mesh.instanceMatrix.array as Float32Array;
      const anchorTarget = bucket.anchorAttribute.array as Float32Array;
      const windTarget = bucket.windAttribute.array as Float32Array;
      const colorTarget = bucket.mesh.instanceColor!.array as Float32Array;
      let writeIndex = 0;
      for (let sourceIndex = 0; sourceIndex < bucket.placements.length; sourceIndex++) {
        const placementIndex = bucket.placementIndices[sourceIndex]!;
        if (!placementVisible[placementIndex]) continue;
        if (!isNettleSeasonallyRetained(placementIndex, seasonalDormancy)) continue;
        const placement = bucket.placements[sourceIndex]!;
        const dx = placement.x - cameraX;
        const dz = placement.z - cameraZ;
        if (dx * dx + dz * dz > radiusSquared) continue;
        const matrixOffset = sourceIndex * 16;
        streamMatrix.fromArray(bucket.matrixElements, matrixOffset);
        streamMatrix.toArray(matrixTarget, writeIndex * 16);
        const sourceOffset = sourceIndex * 3;
        const targetOffset = writeIndex * 3;
        anchorTarget[targetOffset] = bucket.anchorElements[sourceOffset]!;
        anchorTarget[targetOffset + 1] = bucket.anchorElements[sourceOffset + 1]!;
        anchorTarget[targetOffset + 2] = bucket.anchorElements[sourceOffset + 2]!;
        windTarget[targetOffset] = bucket.windElements[sourceOffset]!;
        windTarget[targetOffset + 1] = bucket.windElements[sourceOffset + 1]!;
        windTarget[targetOffset + 2] = bucket.windElements[sourceOffset + 2]!;
        colorTarget[targetOffset] = bucket.colorElements[sourceOffset]!;
        colorTarget[targetOffset + 1] = bucket.colorElements[sourceOffset + 1]!;
        colorTarget[targetOffset + 2] = bucket.colorElements[sourceOffset + 2]!;
        writeIndex++;
      }
      bucket.mesh.count = writeIndex;
      markResidentAttributeUpdate(bucket.mesh.instanceMatrix, writeIndex, 16);
      markResidentAttributeUpdate(bucket.anchorAttribute, writeIndex, 3);
      markResidentAttributeUpdate(bucket.windAttribute, writeIndex, 3);
      markResidentAttributeUpdate(bucket.mesh.instanceColor!, writeIndex, 3);
      residentInstances += writeIndex;
    }
    stats.residentInstances = residentInstances;
    lastStreamX = cameraX;
    lastStreamZ = cameraZ;
    streamDirty = false;
  };
  const placementMask = createForestFloorPlacementMask(
    placements,
    trees.length,
    (placementIndex, visible) => {
      if (!placements[placementIndex]) return;
      placementVisible[placementIndex] = visible;
      streamDirty = true;
    },
  );
  const textures = [
    leafTextures.albedo,
    leafTextures.normal,
    leafTextures.roughness,
    leafTextures.translucency,
    stemTextures.albedo,
    stemTextures.normal,
    stemTextures.roughness,
  ].filter((candidate): candidate is THREE.Texture => Boolean(candidate));

  return {
    group,
    placements,
    placementIndicesByTree: placementMask.placementIndicesByTree,
    buckets,
    stats,
    setTreeActive: placementMask.setTreeActive,
    setPlacementActive: placementMask.setPlacementActive,
    refreshBlockedMask(
      blocker?: ForestFloorNettleBlocker,
      shouldEvaluate?: (placement: ForestFloorNettlePlacement, placementIndex: number) => boolean,
    ): number {
      return placementMask.refreshBlockedMask(
        (placement) => nettleIntersectsBlocker(placement, blocker),
        shouldEvaluate,
      );
    },
    setDeciduousFoliage(presentation): boolean {
      let changed = setNettleSeason(foliageMaterial, presentation);
      updateNettleStemSeason(branchMaterial, presentation);
      const nextDormancy = clampSeasonAmount(presentation.dormancy);
      if (Math.abs(seasonalDormancy - nextDormancy) > 1e-6) {
        seasonalDormancy = nextDormancy;
        streamDirty = true;
        changed = true;
      }
      return changed;
    },
    setSnowCoverage(coverage): boolean {
      let changed = setSeasonUniform(foliageMaterial, 'forestSnowCoverage', coverage);
      changed = setSeasonUniform(branchMaterial, 'forestSnowCoverage', coverage) || changed;
      return changed;
    },
    updateCamera(cameraPosition, closeDetailVisible): boolean {
      const visibilityChanged = group.visible !== closeDetailVisible;
      group.visible = closeDetailVisible;
      if (!closeDetailVisible) return visibilityChanged;
      const dx = cameraPosition.x - lastStreamX;
      const dz = cameraPosition.z - lastStreamZ;
      const streamMoved = !Number.isFinite(lastStreamX)
        || dx * dx + dz * dz >= FOREST_FLOOR_NETTLE_STREAM_REBUILD_DISTANCE ** 2;
      if (!streamDirty && !streamMoved) return visibilityChanged;
      rebuildResidentInstances(cameraPosition.x, cameraPosition.z);
      return true;
    },
    commit(): void {
      if (!streamDirty || !group.visible || !Number.isFinite(lastStreamX)) return;
      rebuildResidentInstances(lastStreamX, lastStreamZ);
    },
    dispose(): void {
      group.removeFromParent();
      branchMaterial.dispose();
      foliageMaterial.dispose();
      for (const prototype of prototypes) prototype.geometry.dispose();
      for (const item of textures) item.dispose();
    },
  };
}

export function createForestFloorNettlePlacements(
  trees: readonly ForestTreePlacement[],
  seed = FOREST_FLOOR_NETTLE_SEED,
  isBlockedAt?: ForestFloorNettleBlocker,
): ForestFloorNettlePlacement[] {
  const placements: ForestFloorNettlePlacement[] = [];
  const spatial = new SpatialHash2D<ForestFloorNettlePlacement>(0.7);
  // Source shuffling keeps the safety ceiling spatially fair on exceptionally
  // dense custom worlds. Normal maps stay below it and therefore scale from
  // accepted forest area rather than collapsing to one fixed global count.
  const treeIndices = shuffledNettleSourceTreeIndices(trees.length, seed);
  let colonyIndex = 0;
  for (const treeIndex of treeIndices) {
    if (placements.length >= FOREST_FLOOR_NETTLE_MAX_INSTANCES) break;
    const tree = trees[treeIndex]!;
    const rng = mulberry32((seed ^ Math.imul(treeIndex + 1, 0x9e3779b1)) >>> 0);
    if (rng() > FOREST_FLOOR_NETTLE_COLONY_CHANCE) continue;

    const sourceRadius = THREE.MathUtils.lerp(1.05, 4.35, Math.sqrt(rng()));
    const sourceAngle = rng() * Math.PI * 2;
    const colonyX = tree.x + Math.cos(sourceAngle) * sourceRadius;
    const colonyZ = tree.z + Math.sin(sourceAngle) * sourceRadius;
    const colonyRadius = THREE.MathUtils.lerp(
      FOREST_FLOOR_NETTLE_COLONY_RADIUS_MIN,
      FOREST_FLOOR_NETTLE_COLONY_RADIUS_MAX,
      rng(),
    );
    const stemCount = FOREST_FLOOR_NETTLE_COLONY_MIN_STEMS + Math.floor(
      rng() * (FOREST_FLOOR_NETTLE_COLONY_MAX_STEMS - FOREST_FLOOR_NETTLE_COLONY_MIN_STEMS + 1),
    );
    const colonyRotation = rng() * Math.PI * 2;
    let acceptedStems = 0;
    for (let stemIndex = 0; stemIndex < stemCount; stemIndex++) {
      if (placements.length >= FOREST_FLOOR_NETTLE_MAX_INSTANCES) break;
      const radial = stemIndex === 0
        ? 0
        : colonyRadius * Math.sqrt((stemIndex + rng()) / stemCount);
      const angle = colonyRotation
        + stemIndex * GOLDEN_ANGLE
        + THREE.MathUtils.lerp(-0.24, 0.24, rng());
      const x = colonyX + Math.cos(angle) * radial;
      const z = colonyZ + Math.sin(angle) * radial;
      if (spatial.hasPointWithin(x, z, FOREST_FLOOR_NETTLE_MIN_SPACING)) continue;
      const placement: ForestFloorNettlePlacement = {
        x,
        z,
        sourceTreeIndex: treeIndex,
        colonyIndex,
        colonyX,
        colonyZ,
        // Store authored height in metres. Prototype variants differ by about
        // eight centimetres, so raw scalar ranges made some crowns disappear
        // into the 0.48 m ivy layer.
        targetHeight: THREE.MathUtils.lerp(
          FOREST_FLOOR_NETTLE_MIN_HEIGHT,
          FOREST_FLOOR_NETTLE_MAX_HEIGHT,
          Math.pow(rng(), 0.74),
        ),
        widthScale: THREE.MathUtils.lerp(0.88, 1.02, rng()),
        yaw: rng() * Math.PI * 2,
        lean: THREE.MathUtils.lerp(0.015, 0.085, rng()),
        leanDirection: rng() * Math.PI * 2,
        prototypeIndex: Math.floor(rng() * GORSKI_SHRUB_VARIANT_COUNT),
        meshIndex: -1,
      };
      if (nettleIntersectsBlocker(placement, isBlockedAt)) continue;
      placements.push(placement);
      spatial.add(placement);
      acceptedStems++;
    }
    if (acceptedStems > 0) colonyIndex++;
  }
  return placements;
}

function shuffledNettleSourceTreeIndices(count: number, seed: number): number[] {
  const indices = Array.from({ length: count }, (_, index) => index);
  const rng = mulberry32((seed ^ 0x6e657474) >>> 0);
  for (let index = indices.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex]!, indices[index]!];
  }
  return indices;
}

function nettleIntersectsBlocker(
  placement: ForestFloorNettlePlacement,
  isBlockedAt?: ForestFloorNettleBlocker,
): boolean {
  if (!isBlockedAt) return false;
  if (isBlockedAt(placement.x, placement.z)) return true;
  const radius = FOREST_FLOOR_NETTLE_CLEAR_RADIUS
    * (placement.targetHeight / FOREST_FLOOR_NETTLE_HEIGHT_REFERENCE)
    * placement.widthScale;
  for (let sampleIndex = 0; sampleIndex < 8; sampleIndex++) {
    const angle = sampleIndex / 8 * Math.PI * 2;
    if (isBlockedAt(
      placement.x + Math.cos(angle) * radius,
      placement.z + Math.sin(angle) * radius,
    )) {
      return true;
    }
  }
  return false;
}

function createNettleBucket(
  prototype: GorskiShrubPrototype,
  prototypeIndex: number,
  placements: ForestFloorNettlePlacement[],
  placementIndices: number[],
  terrain: Terrain,
  branchMaterial: THREE.Material,
  foliageMaterial: THREE.Material,
  seed: number,
): NettleBucket {
  const capacity = Math.max(1, placements.length);
  const geometry = prototype.geometry;
  const anchorAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const windAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute('aAnchorPos', anchorAttribute);
  geometry.setAttribute('aWindVec', windAttribute);
  const mesh = new THREE.InstancedMesh(
    geometry,
    [branchMaterial, foliageMaterial],
    capacity,
  );
  mesh.name = `SeedThree stinging nettle prototype ${prototypeIndex + 1}`;
  mesh.count = 0;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.userData.seedThreeGenerator = prototype.geometry.userData.seedThreeGenerator;
  mesh.userData.prototypeTriangleCount = prototype.triangleCount;

  const matrixElements = new Float32Array(capacity * 16);
  const anchorElements = new Float32Array(capacity * 3);
  const windElements = new Float32Array(capacity * 3);
  const colorElements = new Float32Array(capacity * 3);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const wind = new THREE.Vector3();
  const color = new THREE.Color();
  const inverseYaw = new THREE.Quaternion();
  const bounds = geometry.boundingBox;
  const prototypeHeight = Math.max(
    0.001,
    (bounds?.max.y ?? 1) - (bounds?.min.y ?? 0),
  );
  placements.forEach((placement, meshIndex) => {
    placement.meshIndex = meshIndex;
    position.set(
      placement.x,
      terrain.getHeightAt(placement.x, placement.z) + 0.018,
      placement.z,
    );
    quaternion.setFromEuler(new THREE.Euler(
      Math.cos(placement.leanDirection) * placement.lean,
      placement.yaw,
      Math.sin(placement.leanDirection) * placement.lean,
      'YXZ',
    ));
    const heightScale = placement.targetHeight / prototypeHeight;
    const width = heightScale * placement.widthScale;
    scale.set(width, heightScale, width);
    matrix.compose(position, quaternion, scale);
    matrix.toArray(matrixElements, meshIndex * 16);
    anchorElements[meshIndex * 3] = position.x;
    anchorElements[meshIndex * 3 + 1] = position.y;
    anchorElements[meshIndex * 3 + 2] = position.z;
    inverseYaw.setFromAxisAngle(Y_AXIS, -placement.yaw);
    wind.copy(WIND_DIR).applyQuaternion(inverseYaw);
    if (scale.x !== 0) wind.x /= scale.x;
    if (scale.y !== 0) wind.y /= scale.y;
    if (scale.z !== 0) wind.z /= scale.z;
    windElements[meshIndex * 3] = wind.x;
    windElements[meshIndex * 3 + 1] = wind.y;
    windElements[meshIndex * 3 + 2] = wind.z;
    const tintRng = mulberry32(
      (seed ^ Math.imul(placement.sourceTreeIndex + 17, 0x85ebca6b) ^ meshIndex) >>> 0,
    );
    color.setRGB(
      THREE.MathUtils.lerp(0.82, 0.96, tintRng()),
      THREE.MathUtils.lerp(0.88, 1.02, tintRng()),
      THREE.MathUtils.lerp(0.76, 0.92, tintRng()),
    );
    colorElements[meshIndex * 3] = color.r;
    colorElements[meshIndex * 3 + 1] = color.g;
    colorElements[meshIndex * 3 + 2] = color.b;
  });
  return {
    mesh,
    placements,
    placementIndices,
    matrixElements,
    anchorElements,
    windElements,
    colorElements,
    anchorAttribute,
    windAttribute,
  };
}

function markResidentAttributeUpdate(
  attribute: THREE.InstancedBufferAttribute,
  instanceCount: number,
  itemSize: number,
): void {
  attribute.clearUpdateRanges();
  if (instanceCount > 0) attribute.addUpdateRange(0, instanceCount * itemSize);
  attribute.needsUpdate = true;
}

function createNettleFoliageMaterial(
  textures: NettleTextureSet,
  useNodeMaterial: boolean,
): THREE.Material {
  if (!useNodeMaterial) {
    const material = new THREE.MeshStandardMaterial({
      name: 'SeedThree stinging nettle paired leaves',
      map: textures.albedo,
      normalMap: textures.normal,
      roughnessMap: textures.roughness,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
    });
    material.forceSinglePass = true;
    material.normalScale.set(0.52, 0.52);
    applyFoliageDoubleSideNormals(material);
    applyRootedGeometryWebGLWind(material, 0.07);
    applyNettleWebGLSeason(material);
    return material;
  }

  const material = new MeshSSSNodeMaterial({
    map: textures.albedo,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  });
  material.name = 'SeedThree stinging nettle paired leaves';
  material.forceSinglePass = true;
  material.roughnessMap = textures.roughness;
  material.positionNode = createRootedGeometryWindPosition(0.07) as never;
  const texel = tsl.texture(textures.albedo);
  const spring = tsl.uniform(0);
  const autumn = tsl.uniform(0);
  const dormancy = tsl.uniform(0);
  const snowCoverage = tsl.uniform(0);
  const value = texel.r.mul(0.2126)
    .add(texel.g.mul(0.7152))
    .add(texel.b.mul(0.0722));
  const springLeaf = tsl.vec3(0.63, 0.94, 0.26)
    .mul(value.mul(1.34)).clamp(0, 1);
  const autumnLeaf = tsl.vec3(0.9, 0.39, 0.065)
    .mul(value.mul(1.55)).clamp(0, 1);
  const dormantLeaf = tsl.vec3(0.53, 0.31, 0.16)
    .mul(value.mul(1.72)).clamp(0, 1);
  let seasonal = tsl.mix(texel.rgb, springLeaf, spring.mul(0.58));
  seasonal = tsl.mix(seasonal, autumnLeaf, autumn);
  seasonal = tsl.mix(seasonal, dormantLeaf, dormancy.mul(0.86));
  const upwardExposure = tsl.smoothstep(
    tsl.float(0.18),
    tsl.float(0.84),
    tsl.normalWorldGeometry.y,
  );
  const snowVariation = tsl.sin(
    tsl.positionWorld.x.mul(0.81)
      .add(tsl.positionWorld.z.mul(1.13)),
  ).mul(0.12).add(0.88);
  const snowAmount = snowCoverage
    .mul(upwardExposure)
    .mul(snowVariation)
    .mul(0.58);
  material.colorNode = tsl.mix(
    seasonal,
    tsl.vec3(0.92, 0.955, 0.98),
    snowAmount,
  ) as never;
  const retain = tsl.float(1).sub(dormancy.mul(0.78));
  material.opacityNode = texel.a.mul(retain) as never;
  const transmit = tsl.vec3(0.24, 0.43, 0.14);
  material.thicknessColorNode = tsl.texture(textures.translucency!).r
    .mul(transmit)
    .mul(retain)
    .mul(tsl.float(1).sub(snowAmount.mul(0.82))) as never;
  material.thicknessDistortionNode = tsl.uniform(0.3) as never;
  material.thicknessAmbientNode = tsl.uniform(0.026) as never;
  material.thicknessAttenuationNode = tsl.uniform(1) as never;
  material.thicknessPowerNode = tsl.uniform(5) as never;
  material.thicknessScaleNode = tsl.uniform(1.55) as never;
  const upView = tsl.cameraViewMatrix.mul(tsl.vec4(0, 1, 0, 0)).xyz;
  const relief = tsl.normalMap(tsl.texture(textures.normal)).sub(tsl.normalView);
  material.normalNode = tsl.normalize(upView.add(relief.mul(0.52))) as never;
  material.userData.forestSeasonalSpringFlush = spring;
  material.userData.forestSeasonalAutumnColor = autumn;
  material.userData.forestSeasonalDormancy = dormancy;
  material.userData.forestSnowCoverage = snowCoverage;
  return material;
}

function createNettleBranchMaterial(
  textures: NettleTextureSet,
  useNodeMaterial: boolean,
): THREE.Material {
  if (!useNodeMaterial) {
    const material = new THREE.MeshStandardMaterial({
      name: 'SeedThree living stinging nettle stem',
      map: textures.albedo,
      normalMap: textures.normal,
      roughnessMap: textures.roughness,
      roughness: 1,
      metalness: 0,
    });
    material.normalScale.set(0.38, 0.38);
    applyRootedGeometryWebGLWind(material, 0.07);
    applyNettleWebGLSnow(material);
    return material;
  }
  const material = new MeshStandardNodeMaterial() as unknown as THREE.MeshStandardMaterial & {
    positionNode: unknown;
  };
  material.name = 'SeedThree living stinging nettle stem';
  material.map = textures.albedo;
  material.normalMap = textures.normal;
  material.roughnessMap = textures.roughness;
  material.roughness = 1;
  material.metalness = 0;
  material.positionNode = createRootedGeometryWindPosition(0.07) as never;
  applyNettleNodeSnow(
    material,
    tsl.texture(textures.albedo).rgb.mul(tsl.uniform(material.color)),
  );
  return material;
}

function applyNettleNodeSnow(material: THREE.Material, baseSurface: TslNode): void {
  const target = material as THREE.Material & { colorNode?: unknown };
  const snowCoverage = tsl.uniform(0);
  const upwardExposure = tsl.smoothstep(
    tsl.float(0.18),
    tsl.float(0.84),
    tsl.normalWorldGeometry.y,
  );
  const snowVariation = tsl.sin(
    tsl.positionWorld.x.mul(0.81)
      .add(tsl.positionWorld.z.mul(1.13)),
  ).mul(0.12).add(0.88);
  const snowAmount = snowCoverage
    .mul(upwardExposure)
    .mul(snowVariation)
    .mul(0.54);
  target.colorNode = tsl.mix(
    baseSurface,
    tsl.vec3(0.92, 0.955, 0.98),
    snowAmount,
  );
  material.userData.forestSnowCoverage = snowCoverage;
}

function applyNettleWebGLSnow(material: THREE.MeshStandardMaterial): void {
  const snowCoverage = { value: 0 };
  material.userData.forestSnowCoverage = snowCoverage;
  chainMaterialShaderPatch(material, 'seedthree-nettle-stem-snow-v1', (shader) => {
    shader.uniforms.uNettleSnowCoverage = snowCoverage;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'varying float vNettleSnowExposure;',
        'varying vec2 vNettleSnowWorldXZ;',
      ].join('\n'),
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <defaultnormal_vertex>',
      [
        '#include <defaultnormal_vertex>',
        'vec3 nettleSnowWorldNormal = normalize(',
        '  inverseTransformDirection( transformedNormal, viewMatrix )',
        ');',
        'vNettleSnowExposure = smoothstep( 0.18, 0.84, nettleSnowWorldNormal.y );',
      ].join('\n'),
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      [
        'vec4 nettleSnowObjectPosition = vec4( transformed, 1.0 );',
        '#ifdef USE_INSTANCING',
        'nettleSnowObjectPosition = instanceMatrix * nettleSnowObjectPosition;',
        '#endif',
        'vNettleSnowWorldXZ = ( modelMatrix * nettleSnowObjectPosition ).xz;',
        '#include <project_vertex>',
      ].join('\n'),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'uniform float uNettleSnowCoverage;',
        'varying float vNettleSnowExposure;',
        'varying vec2 vNettleSnowWorldXZ;',
      ].join('\n'),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      [
        '#include <color_fragment>',
        'float nettleSnowVariation = sin(',
        '  vNettleSnowWorldXZ.x * 0.81 + vNettleSnowWorldXZ.y * 1.13',
        ') * 0.12 + 0.88;',
        'float nettleSnowAmount = uNettleSnowCoverage',
        '  * vNettleSnowExposure * nettleSnowVariation * 0.54;',
        'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.955, 0.98 ), nettleSnowAmount );',
      ].join('\n'),
    );
  });
  material.needsUpdate = true;
}

function applyNettleWebGLSeason(material: THREE.MeshStandardMaterial): void {
  const spring = { value: 0 };
  const autumn = { value: 0 };
  const dormancy = { value: 0 };
  const snowCoverage = { value: 0 };
  material.userData.forestSeasonalSpringFlush = spring;
  material.userData.forestSeasonalAutumnColor = autumn;
  material.userData.forestSeasonalDormancy = dormancy;
  material.userData.forestSnowCoverage = snowCoverage;
  chainMaterialShaderPatch(material, 'seedthree-nettle-season-v1', (shader) => {
    shader.uniforms.uNettleSpring = spring;
    shader.uniforms.uNettleAutumn = autumn;
    shader.uniforms.uNettleDormancy = dormancy;
    shader.uniforms.uNettleSnowCoverage = snowCoverage;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'varying float vNettleSnowExposure;',
        'varying vec2 vNettleSnowWorldXZ;',
      ].join('\n'),
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <defaultnormal_vertex>',
      [
        '#include <defaultnormal_vertex>',
        'vec3 nettleSnowWorldNormal = normalize(',
        '  inverseTransformDirection( transformedNormal, viewMatrix )',
        ');',
        'vNettleSnowExposure = smoothstep( 0.18, 0.84, nettleSnowWorldNormal.y );',
      ].join('\n'),
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      [
        'vec4 nettleSnowObjectPosition = vec4( transformed, 1.0 );',
        '#ifdef USE_INSTANCING',
        'nettleSnowObjectPosition = instanceMatrix * nettleSnowObjectPosition;',
        '#endif',
        'vNettleSnowWorldXZ = ( modelMatrix * nettleSnowObjectPosition ).xz;',
        '#include <project_vertex>',
      ].join('\n'),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform float uNettleSpring;
uniform float uNettleAutumn;
uniform float uNettleDormancy;
uniform float uNettleSnowCoverage;
varying float vNettleSnowExposure;
varying vec2 vNettleSnowWorldXZ;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
float nettleValue = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
vec3 nettleSpring = clamp( vec3( 0.63, 0.94, 0.26 ) * nettleValue * 1.34, 0.0, 1.0 );
vec3 nettleAutumn = clamp( vec3( 0.90, 0.39, 0.065 ) * nettleValue * 1.55, 0.0, 1.0 );
vec3 nettleDormant = clamp( vec3( 0.53, 0.31, 0.16 ) * nettleValue * 1.72, 0.0, 1.0 );
diffuseColor.rgb = mix( diffuseColor.rgb, nettleSpring, uNettleSpring * 0.58 );
diffuseColor.rgb = mix( diffuseColor.rgb, nettleAutumn, uNettleAutumn );
diffuseColor.rgb = mix( diffuseColor.rgb, nettleDormant, uNettleDormancy * 0.86 );
diffuseColor.a *= 1.0 - uNettleDormancy * 0.78;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      [
        '#include <color_fragment>',
        'float nettleSnowVariation = sin(',
        '  vNettleSnowWorldXZ.x * 0.81 + vNettleSnowWorldXZ.y * 1.13',
        ') * 0.12 + 0.88;',
        'float nettleSnowAmount = uNettleSnowCoverage',
        '  * vNettleSnowExposure * nettleSnowVariation * 0.58;',
        'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.955, 0.98 ), nettleSnowAmount );',
      ].join('\n'),
    );
  });
  material.needsUpdate = true;
}

function setNettleSeason(
  material: THREE.Material,
  presentation: DeciduousFoliagePresentation,
): boolean {
  let changed = false;
  changed = setSeasonUniform(material, 'forestSeasonalSpringFlush', presentation.springFlush) || changed;
  changed = setSeasonUniform(material, 'forestSeasonalAutumnColor', presentation.autumnColor) || changed;
  changed = setSeasonUniform(material, 'forestSeasonalDormancy', presentation.dormancy) || changed;
  return changed;
}

function setSeasonUniform(material: THREE.Material, key: string, amount: number): boolean {
  const target = material.userData[key] as { value: number } | undefined;
  if (!target) return false;
  const next = clampSeasonAmount(amount);
  if (target.value === next) return false;
  target.value = next;
  return true;
}

function clampSeasonAmount(amount: number): number {
  return THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
}

/**
 * Frost removes most above-ground nettle growth while retaining a stable,
 * sparse cohort of dry stalks. The source placement index supplies the
 * dropout pattern, so the same stems disappear in color and shadow passes
 * without another instance attribute or a seasonal buffer rebuild.
 */
function isNettleSeasonallyRetained(
  placementIndex: number,
  dormancy: number,
): boolean {
  const onset = THREE.MathUtils.smoothstep(clampSeasonAmount(dormancy), 0.34, 1);
  const retention = THREE.MathUtils.lerp(1, 0.14, onset);
  const hash = Math.imul((placementIndex + 1) >>> 0, 0x9e37_79b1) >>> 0;
  return hash / 0x1_0000_0000 < retention;
}

function updateNettleStemSeason(
  material: THREE.Material,
  presentation: DeciduousFoliagePresentation,
): void {
  if (!('color' in material) || !(material.color instanceof THREE.Color)) return;
  material.color.setRGB(1, 1, 1);
  material.color.lerp(new THREE.Color(0xd8ffae), presentation.springFlush * 0.28);
  material.color.lerp(new THREE.Color(0xd7a454), presentation.autumnColor * 0.62);
  material.color.lerp(new THREE.Color(0x9b795b), presentation.dormancy * 0.8);
}

async function loadLeafTextures(maxAnisotropy: number): Promise<NettleTextureSet> {
  const [albedo, normal, roughness, translucency] = await Promise.all([
    loadSeedThreeTexture(seedThreeLeafUrl(NETTLE_LEAF_FILES.albedo), true, false, maxAnisotropy),
    loadSeedThreeTexture(seedThreeLeafUrl(NETTLE_LEAF_FILES.normal), false, false, maxAnisotropy),
    loadSeedThreeTexture(seedThreeLeafUrl(NETTLE_LEAF_FILES.roughness), false, false, maxAnisotropy),
    loadSeedThreeTexture(seedThreeLeafUrl(NETTLE_LEAF_FILES.translucency), false, false, maxAnisotropy),
  ]);
  return { albedo, normal, roughness, translucency };
}

async function loadStemTextures(maxAnisotropy: number): Promise<NettleTextureSet> {
  const [albedo, normal, roughness] = await Promise.all([
    loadSeedThreeTexture(seedThreeBarkUrl(NETTLE_STEM_FILES.albedo), true, true, maxAnisotropy),
    loadSeedThreeTexture(seedThreeBarkUrl(NETTLE_STEM_FILES.normal), false, true, maxAnisotropy),
    loadSeedThreeTexture(seedThreeBarkUrl(NETTLE_STEM_FILES.roughness), false, true, maxAnisotropy),
  ]);
  return { albedo, normal, roughness };
}

async function loadSeedThreeTexture(
  source: string | undefined,
  srgb: boolean,
  repeat: boolean,
  maxAnisotropy: number,
): Promise<THREE.Texture> {
  if (!source) throw new Error('A dedicated stinging-nettle PBR map is missing');
  const loaded = await new THREE.TextureLoader().loadAsync(source);
  loaded.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  loaded.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  loaded.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  loaded.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  return loaded;
}
