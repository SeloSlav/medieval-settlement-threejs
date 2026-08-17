import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SpatialHash2D } from '../utils/SpatialHash2D.ts';
import { MeshSSSNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraViewMatrix,
  float,
  modelWorldMatrix,
  normalMap,
  normalView,
  normalize,
  positionLocal,
  sin,
  texture,
  uniform,
  vec4,
} from 'three/tsl';
import { windSpeed, windStrength, WIND_DIR } from '@seedthree/core/wind.js';
import { createRootedGeometryWindPosition } from '../vegetation/seedthree/seedThreeFoliageWind.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { applyFoliageDoubleSideNormals } from '../scene/foliageDoubleSideNormals.ts';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import {
  seedThreeBarkUrl,
  seedThreeFruitUrl,
  seedThreeLeafUrl,
} from '../vegetation/seedthree/seedThreeTextures.ts';
import { sampleBilberryBushScale } from '../vegetation/bilberryBushVisual.ts';
import {
  createGorskiShrubPrototype,
  GORSKI_SHRUB_VARIANT_COUNT,
  type GorskiShrubPrototype,
} from '../vegetation/seedthree/gorskiShrubPrototypes.ts';
import {
  CENTRAL_CLEARING_RADIUS,
  type ForestCore,
  type ForestSpawnConfig,
  forestDensityAt,
  isInsidePlayableExtent,
  pick,
  samplePointInForestCore,
  samplePointInPlayableExtent,
} from './forestField.ts';

type TslNode = {
  mul: (value: unknown) => TslNode;
  add: (value: unknown) => TslNode;
  sub: (value: unknown) => TslNode;
  div: (value: unknown) => TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
  r: TslNode;
  xyz: TslNode;
};

const tsl = {
  attribute: attribute as (name: string, type: string) => TslNode,
  cameraViewMatrix: cameraViewMatrix as TslNode,
  float: float as (value: number) => TslNode,
  modelWorldMatrix: modelWorldMatrix as TslNode,
  normalMap: normalMap as (sample: unknown) => TslNode,
  normalView: normalView as TslNode,
  normalize: normalize as (value: unknown) => TslNode,
  positionLocal: positionLocal as TslNode,
  sin: sin as (value: unknown) => TslNode,
  texture: texture as (map: THREE.Texture) => TslNode,
  uniform: uniform as <T>(value: T) => { value: T },
  vec4: vec4 as (...values: unknown[]) => TslNode,
  windSpeed: windSpeed as unknown as TslNode,
  windStrength: windStrength as unknown as TslNode,
};

const TAU = Math.PI * 2;
const MIN_JUNIPER_BERRIES_PER_SHRUB = 16;
const MAX_JUNIPER_BERRIES_PER_SHRUB = 20;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const windQuat = new THREE.Quaternion();
const windVecScratch = new THREE.Vector3();

export type UndergrowthKind = 'bush' | 'fern' | 'juniper';

export type UndergrowthPlacement = {
  x: number;
  z: number;
  kind: UndergrowthKind;
  scale: number;
  yaw: number;
  prototypeIndex: number;
  meshIndex: number;
};

type UndergrowthTextureSet = {
  albedo: THREE.Texture;
  normal: THREE.Texture | null;
  roughness: THREE.Texture | null;
  translucency: THREE.Texture | null;
};

type UndergrowthTextureFiles = {
  albedo: string;
  normal: string;
  roughness: string;
  translucency: string;
};

type UndergrowthMaterialPair = [branch: THREE.Material, foliage: THREE.Material];

type UndergrowthFruitAsset = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
};

export type UndergrowthMaterials = {
  bush: UndergrowthMaterialPair;
  fern: [foliage: THREE.Material];
  juniper: UndergrowthMaterialPair;
  juniperBerry: UndergrowthFruitAsset;
  prototypes: Record<UndergrowthKind, GorskiShrubPrototype[]>;
  shadowCast: THREE.MeshStandardMaterial;
  bushShadowDepth: THREE.MeshDepthMaterial;
  fernShadowDepth: THREE.MeshDepthMaterial;
  juniperShadowDepth: THREE.MeshDepthMaterial;
  textures: THREE.Texture[];
};

export type UndergrowthInstances = {
  group: THREE.Group;
  placements: UndergrowthPlacement[];
  buckets: Record<UndergrowthKind, UndergrowthBucket[]>;
  juniperBerries: THREE.InstancedMesh;
};

export type UndergrowthBucket = {
  placements: UndergrowthPlacement[];
  mesh: THREE.InstancedMesh;
  shadowMesh: THREE.InstancedMesh;
  matrices: THREE.Matrix4[];
  tintAttr: THREE.InstancedBufferAttribute;
  anchorAttr: THREE.InstancedBufferAttribute;
  windVecAttr: THREE.InstancedBufferAttribute;
};

const CARD_FILES: Record<UndergrowthKind, UndergrowthTextureFiles> = {
  bush: {
    albedo: 'bilberry_albedo.png',
    normal: 'bilberry_normal.png',
    roughness: 'bilberry_roughness.png',
    translucency: 'bilberry_translucency.png',
  },
  fern: {
    albedo: 'fern_albedo.png',
    normal: 'fern_normal.png',
    roughness: 'fern_roughness.png',
    translucency: 'fern_translucency.png',
  },
  juniper: {
    albedo: 'juniper_scrub_albedo.png',
    normal: 'juniper_scrub_normal.png',
    roughness: 'juniper_scrub_roughness.png',
    translucency: 'juniper_scrub_translucency.png',
  },
};

const BRANCH_FILES: Record<Exclude<UndergrowthKind, 'fern'>, Omit<UndergrowthTextureFiles, 'translucency'>> = {
  bush: { albedo: 'creosote_branch_albedo.png', normal: 'creosote_branch_normal.png', roughness: 'creosote_branch_roughness.png' },
  juniper: { albedo: 'sagebrush_branch_albedo.png', normal: 'sagebrush_branch_normal.png', roughness: 'sagebrush_branch_roughness.png' },
};

const loader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();

export async function createUndergrowthMaterials(
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind | undefined,
  _sharedTextures: THREE.Texture[],
): Promise<UndergrowthMaterials> {
  const [
    bushTextures,
    fernTextures,
    juniperTextures,
    bushBranch,
    juniperBranch,
    juniperBerry,
  ] = await Promise.all([
    loadUndergrowthTextures(CARD_FILES.bush, maxAnisotropy),
    loadUndergrowthTextures(CARD_FILES.fern, maxAnisotropy),
    loadUndergrowthTextures(CARD_FILES.juniper, maxAnisotropy),
    loadBranchTextures(BRANCH_FILES.bush, maxAnisotropy),
    loadBranchTextures(BRANCH_FILES.juniper, maxAnisotropy),
    loadJuniperBerry(),
  ]);
  const useNodeMaterials = rendererBackend === 'webgpu';
  const textures = collectTextures(
    bushTextures, fernTextures, juniperTextures,
    bushBranch, juniperBranch,
  );
  const prototypes = Object.fromEntries(
    (['bush', 'fern', 'juniper'] as const).map((kind) => [
      kind,
      Array.from({ length: GORSKI_SHRUB_VARIANT_COUNT }, (_, variant) => (
        createGorskiShrubPrototype(kind, variant)
      )),
    ]),
  ) as Record<UndergrowthKind, GorskiShrubPrototype[]>;

  return {
    bush: [
      createUndergrowthBranchMaterial('SeedThree bilberry woody stems', bushBranch, useNodeMaterials),
      createUndergrowthCardMaterial('SeedThree bilberry sprays', bushTextures, useNodeMaterials, [0.3, 0.44, 0.16]),
    ],
    fern: [
      createUndergrowthCardMaterial('SeedThree curved fern fronds', fernTextures, useNodeMaterials, [0.26, 0.5, 0.18]),
    ],
    juniper: [
      createUndergrowthBranchMaterial('SeedThree common juniper stems', juniperBranch, useNodeMaterials),
      createUndergrowthCardMaterial('SeedThree common juniper needle-only sprays', juniperTextures, useNodeMaterials, [0.22, 0.36, 0.14]),
    ],
    juniperBerry,
    prototypes,
    shadowCast: new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    }),
    bushShadowDepth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    fernShadowDepth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    juniperShadowDepth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    textures,
  };
}

export function createUndergrowthPlacements(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ForestSpawnConfig,
  isBlockedAt?: (x: number, z: number) => boolean,
): UndergrowthPlacement[] {
  const placements: UndergrowthPlacement[] = [];
  const placementIndex = new SpatialHash2D<UndergrowthPlacement>(2);
  let attempts = 0;

  while (placements.length < spawnConfig.undergrowthTargetCount && attempts < spawnConfig.undergrowthTargetCount * 36) {
    attempts++;
    const core = rng() < 0.84 ? pick(forestCores, rng) : undefined;
    const sampled = core
      ? samplePointInForestCore(core, rng)
      : samplePointInPlayableExtent(rng, spawnConfig.extent);
    const { x, z } = sampled;

    if (!isInsidePlayableExtent(x, z, spawnConfig.extent)) continue;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS * 0.35 + rng() * 10) continue;

    const density = forestDensityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
    if (density < 0.12 || rng() > density * 1.05) continue;

    const kind = pickUndergrowthKind(rng, density);
    const minDistance =
      kind === 'fern'
        ? THREE.MathUtils.lerp(1.3, 0.8, density)
        : kind === 'juniper'
          ? THREE.MathUtils.lerp(1.85, 1.25, density)
          : THREE.MathUtils.lerp(1.6, 1.0, density);
    if (placementIndex.hasPointWithin(x, z, minDistance)) continue;
    if (isBlockedAt?.(x, z)) continue;

    const placement = {
      x,
      z,
      kind,
      scale: sampleUndergrowthScale(kind, density, rng),
      yaw: rng() * TAU,
      prototypeIndex: Math.floor(rng() * GORSKI_SHRUB_VARIANT_COUNT),
      meshIndex: -1,
    };
    placements.push(placement);
    placementIndex.add(placement);
  }

  return placements;
}

export function buildUndergrowthInstances(
  placements: UndergrowthPlacement[],
  terrain: Terrain,
  materials: UndergrowthMaterials,
  rng: () => number,
): UndergrowthInstances {
  const group = new THREE.Group();
  group.name = 'SeedThree temperate undergrowth';

  const buckets = Object.fromEntries(
    (['bush', 'fern', 'juniper'] as const).map((kind) => {
      const shadowDepth = kind === 'bush'
        ? materials.bushShadowDepth
        : kind === 'fern'
          ? materials.fernShadowDepth
          : materials.juniperShadowDepth;
      const variants = materials.prototypes[kind].map((prototype, prototypeIndex) => {
        const variantPlacements = placements.filter(
          (placement) => placement.kind === kind && placement.prototypeIndex === prototypeIndex,
        );
        const bucket = createUndergrowthBucket(
          kind,
          prototypeIndex,
          prototype,
          variantPlacements,
          materials[kind],
          materials.shadowCast,
          shadowDepth,
        );
        placeUndergrowthBucket(bucket, terrain, rng);
        group.add(bucket.mesh, bucket.shadowMesh);
        return bucket;
      });
      return [kind, variants];
    }),
  ) as Record<UndergrowthKind, UndergrowthBucket[]>;

  const juniperBerries = createJuniperBerryInstances(
    placements,
    buckets.juniper,
    materials.prototypes.juniper,
    materials.juniperBerry,
  );
  group.add(juniperBerries);
  group.userData.juniperBerryModel = 'juniper_berry.glb';
  group.userData.juniperBerryInstances = juniperBerries.count;
  group.userData.juniperBearingShrubs = juniperBerries.userData.bearingShrubCount;

  return {
    group,
    placements,
    buckets,
    juniperBerries,
  };
}

export function disposeUndergrowthInstances(instances: UndergrowthInstances, materials: UndergrowthMaterials): void {
  for (const kind of ['bush', 'fern', 'juniper'] as const) {
    for (const bucket of instances.buckets[kind]) {
      bucket.mesh.geometry.dispose();
      bucket.shadowMesh.geometry.dispose();
    }
    for (const material of materials[kind]) material.dispose();
  }
  materials.shadowCast.dispose();
  materials.bushShadowDepth.dispose();
  materials.fernShadowDepth.dispose();
  materials.juniperShadowDepth.dispose();
  instances.juniperBerries.geometry.dispose();
  materials.juniperBerry.material.dispose();
  materials.textures.forEach((texture) => texture.dispose());
}

function createJuniperBerryInstances(
  placements: ReadonlyArray<UndergrowthPlacement>,
  buckets: ReadonlyArray<UndergrowthBucket>,
  prototypes: ReadonlyArray<GorskiShrubPrototype>,
  asset: UndergrowthFruitAsset,
): THREE.InstancedMesh {
  asset.geometry.computeBoundingBox();
  const fruitSize = asset.geometry.boundingBox!.getSize(new THREE.Vector3());
  const sourceDiameter = Math.max(fruitSize.x, fruitSize.z, 0.001);
  const junipers = placements.filter((placement) => placement.kind === 'juniper');
  const capacity = Math.max(junipers.length * MAX_JUNIPER_BERRIES_PER_SHRUB, 1);
  const mesh = new THREE.InstancedMesh(asset.geometry, asset.material, capacity);
  mesh.name = 'Instanced ripe common-juniper berry cones';
  mesh.userData.fruitModel = 'juniper_berry.glb';
  mesh.userData.sourceDiameterM = sourceDiameter;
  mesh.userData.targetDiameterM = [0.0065, 0.009];
  mesh.userData.bearingPolicy = 'all visual common-juniper shrubs';
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const fruitPosition = new THREE.Vector3();
  const fruitQuaternion = new THREE.Quaternion();
  const fruitScale = new THREE.Vector3();
  const fruitMatrix = new THREE.Matrix4();
  let fruitCount = 0;
  let bearingShrubCount = 0;

  for (const placement of junipers) {
    const bucket = buckets[placement.prototypeIndex];
    const shrubMatrix = bucket?.matrices[placement.meshIndex];
    if (!shrubMatrix) continue;
    const densityNoise = undergrowthHash01(
      placement.x * 3.17 + placement.z * 5.83 + placement.prototypeIndex * 11.7 + 1.5,
    );
    const fruitLimit = Math.round(THREE.MathUtils.lerp(
      MIN_JUNIPER_BERRIES_PER_SHRUB,
      MAX_JUNIPER_BERRIES_PER_SHRUB,
      densityNoise,
    ));
    const anchors = prototypes[placement.prototypeIndex]!.fruitAnchors
      .slice(0, fruitLimit);
    if (anchors.length === 0) continue;
    bearingShrubCount++;

    for (let fruitIndex = 0; fruitIndex < anchors.length; fruitIndex++) {
      const seed = fruitCount * 7.13 + fruitIndex * 3.71 + placement.x * 0.19;
      fruitPosition.copy(anchors[fruitIndex]!).applyMatrix4(shrubMatrix);
      fruitQuaternion.setFromEuler(new THREE.Euler(
        (undergrowthHash01(seed + 0.8) - 0.5) * 0.18,
        undergrowthHash01(seed + 2.7) * TAU,
        (undergrowthHash01(seed + 5.1) - 0.5) * 0.18,
        'YXZ',
      ));
      const targetDiameter = THREE.MathUtils.lerp(
        0.0065,
        0.009,
        undergrowthHash01(seed + 8.3),
      );
      fruitScale.setScalar(targetDiameter / sourceDiameter);
      fruitMatrix.compose(fruitPosition, fruitQuaternion, fruitScale);
      mesh.setMatrixAt(fruitCount, fruitMatrix);
      fruitCount++;
    }
  }

  mesh.count = fruitCount;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.capacity = capacity;
  mesh.userData.bearingShrubCount = bearingShrubCount;
  mesh.computeBoundingSphere();
  return mesh;
}

function createUndergrowthBucket(
  kind: UndergrowthKind,
  prototypeIndex: number,
  prototype: GorskiShrubPrototype,
  placements: UndergrowthPlacement[],
  material: THREE.Material[],
  shadowCast: THREE.MeshStandardMaterial,
  shadowDepth: THREE.MeshDepthMaterial,
): UndergrowthBucket {
  const capacity = Math.max(placements.length, 1);
  const geometry = prototype.geometry;
  const tintAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const anchorAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const windVecAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  geometry.setAttribute('aTint', tintAttr);
  geometry.setAttribute('aAnchorPos', anchorAttr);
  geometry.setAttribute('aWindVec', windVecAttr);

  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = `SeedThree real ${kind} prototype ${prototypeIndex + 1}`;
  mesh.userData.prototypeTriangleCount = prototype.triangleCount;
  mesh.userData.seedThreeGenerator = geometry.userData.seedThreeGenerator;
  mesh.count = placements.length;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;

  const shadowMesh = createShadowInstancedMesh(
    createUndergrowthShadowGeometry(kind),
    shadowCast,
    shadowDepth,
    capacity,
    `SeedThree ${kind} prototype ${prototypeIndex + 1} shadows`,
  );
  shadowMesh.count = placements.length;

  return {
    placements,
    mesh,
    shadowMesh,
    matrices: placements.map(() => new THREE.Matrix4()),
    tintAttr,
    anchorAttr,
    windVecAttr,
  };
}

function placeUndergrowthBucket(bucket: UndergrowthBucket, terrain: Terrain, rng: () => number): void {
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scaleVector = new THREE.Vector3();
  const color = new THREE.Color();

  bucket.placements.forEach((placement, index) => {
    placement.meshIndex = index;
    const yaw = composeUndergrowthMatrix(placement, terrain, rng, matrix, quaternion, position, scaleVector);
    bucket.mesh.setMatrixAt(index, matrix);
    bucket.shadowMesh.setMatrixAt(index, matrix);
    bucket.matrices[index].copy(matrix);

    const tint = sampleUndergrowthTint(placement.kind, rng);
    bucket.tintAttr.setXYZ(index, tint.x, tint.y, tint.z);
    bucket.anchorAttr.setXYZ(index, position.x, position.y, position.z);
    const windVec = undergrowthWindVecForYaw(yaw, scaleVector);
    bucket.windVecAttr.setXYZ(index, windVec.x, windVec.y, windVec.z);
    color.setRGB(tint.x, tint.y, tint.z);
    bucket.mesh.setColorAt(index, color);
  });

  bucket.mesh.instanceMatrix.needsUpdate = true;
  bucket.shadowMesh.instanceMatrix.needsUpdate = true;
  bucket.tintAttr.needsUpdate = true;
  bucket.anchorAttr.needsUpdate = true;
  bucket.windVecAttr.needsUpdate = true;
  if (bucket.mesh.instanceColor) bucket.mesh.instanceColor.needsUpdate = true;
}

export function undergrowthBucketForPlacement(
  instances: UndergrowthInstances,
  placement: UndergrowthPlacement,
): UndergrowthBucket {
  const bucket = instances.buckets[placement.kind][placement.prototypeIndex];
  if (!bucket) {
    throw new Error(`Missing ${placement.kind} undergrowth prototype ${placement.prototypeIndex}`);
  }
  return bucket;
}

export function markUndergrowthMatricesUpdated(instances: UndergrowthInstances): void {
  for (const kind of ['bush', 'fern', 'juniper'] as const) {
    for (const bucket of instances.buckets[kind]) {
      bucket.mesh.instanceMatrix.needsUpdate = true;
      bucket.shadowMesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function createShadowInstancedMesh(
  geometry: THREE.BufferGeometry,
  shadowCast: THREE.MeshStandardMaterial,
  shadowDepth: THREE.MeshDepthMaterial,
  count: number,
  name: string,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, shadowCast, count);
  mesh.name = name;
  mesh.layers.set(TREE_SHADOW_CAST_LAYER);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.customDepthMaterial = shadowDepth;
  return mesh;
}

function composeUndergrowthMatrix(
  placement: UndergrowthPlacement,
  terrain: Terrain,
  rng: () => number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
): number {
  const y = terrain.getHeightAt(placement.x, placement.z) + 0.08;
  const yaw = placement.yaw + (rng() - 0.5) * 0.24;
  const leanDirection = rng() * TAU;
  const lean = placement.kind === 'fern'
    ? THREE.MathUtils.lerp(0.1, 0.28, rng())
    : THREE.MathUtils.lerp(0.04, 0.16, rng());
  position.set(placement.x, y, placement.z);
  quaternion.setFromEuler(
    new THREE.Euler(
      Math.cos(leanDirection) * lean,
      yaw,
      Math.sin(leanDirection) * lean * 0.7,
      'YXZ',
    ),
  );
  const widthFactor = placement.kind === 'fern'
    ? 1.15
    : placement.kind === 'juniper'
      ? 1.12
      : 1.0;
  const widthScale = placement.scale * widthFactor * THREE.MathUtils.lerp(0.9, 1.14, rng());
  const heightScale = placement.scale * THREE.MathUtils.lerp(0.92, 1.14, rng());
  scaleVector.set(widthScale, heightScale, widthScale);
  matrix.compose(position, quaternion, scaleVector);
  return yaw;
}

function pickUndergrowthKind(rng: () => number, density: number): UndergrowthKind {
  const juniperChance = THREE.MathUtils.lerp(0.18, 0.055, density);
  const fernChance = THREE.MathUtils.lerp(0.26, 0.42, density);
  const roll = rng();
  if (roll < juniperChance) return 'juniper';
  if (roll < juniperChance + fernChance) return 'fern';
  return 'bush';
}

function sampleUndergrowthScale(kind: UndergrowthKind, density: number, rng: () => number): number {
  switch (kind) {
    case 'bush':
      return sampleBilberryBushScale(density, rng);
    case 'fern':
      return THREE.MathUtils.lerp(0.82, 1.36, Math.pow(rng(), 0.7)) * THREE.MathUtils.lerp(0.96, 1.16, density);
    case 'juniper':
      return THREE.MathUtils.lerp(0.66, 1.18, Math.pow(rng(), 0.84)) * THREE.MathUtils.lerp(1.08, 0.96, density);
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function sampleUndergrowthTint(kind: UndergrowthKind, rng: () => number): THREE.Vector3 {
  switch (kind) {
    case 'bush':
      return new THREE.Vector3(
        rngRange(rng, 0.58, 0.76),
        rngRange(rng, 0.64, 0.84),
        rngRange(rng, 0.56, 0.74),
      );
    case 'fern':
      return new THREE.Vector3(
        rngRange(rng, 0.58, 0.74),
        rngRange(rng, 0.7, 0.88),
        rngRange(rng, 0.52, 0.72),
      );
    case 'juniper':
      return new THREE.Vector3(
        rngRange(rng, 0.54, 0.72),
        rngRange(rng, 0.62, 0.8),
        rngRange(rng, 0.62, 0.82),
      );
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function createUndergrowthCardMaterial(
  name: string,
  textures: UndergrowthTextureSet,
  useNodeMaterial: boolean,
  transmitRGB: [number, number, number],
): THREE.Material {
  if (!useNodeMaterial) {
    const material = new THREE.MeshStandardMaterial({
      name,
      map: textures.albedo,
      normalMap: textures.normal,
      roughnessMap: textures.roughness,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.96,
      metalness: 0,
      vertexColors: true,
    });
    material.forceSinglePass = true;
    material.normalScale.set(0.45, 0.45);
    applyFoliageDoubleSideNormals(material);
    return material;
  }

  const material = new MeshSSSNodeMaterial({
    map: textures.albedo,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.96,
    metalness: 0,
  });
  material.name = name;
  material.forceSinglePass = true;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  material.roughnessMap = textures.roughness;
  if (textures.roughness) material.roughness = 1.0;

  const transmit = tsl.uniform(new THREE.Color().setRGB(...transmitRGB));
  const edge = textures.translucency ? tsl.texture(textures.translucency).r : tsl.float(1);
  material.thicknessColorNode = edge.mul(tsl.attribute('aTint', 'vec3').y).mul(transmit);
  material.thicknessDistortionNode = tsl.uniform(0.3);
  material.thicknessAmbientNode = tsl.uniform(0.026);
  material.thicknessAttenuationNode = tsl.uniform(1.0);
  material.thicknessPowerNode = tsl.uniform(5.0);
  material.thicknessScaleNode = tsl.uniform(1.5);
  material.colorNode = tsl.texture(textures.albedo).mul(tsl.vec4(tsl.attribute('aTint', 'vec3'), tsl.float(1)));
  material.positionNode = createRootedGeometryWindPosition(0.1);

  const upView = tsl.cameraViewMatrix.mul(tsl.vec4(0, 1, 0, 0)).xyz;
  const relief = textures.normal ? tsl.normalMap(tsl.texture(textures.normal)).sub(tsl.normalView) : null;
  material.normalNode = relief ? tsl.normalize(upView.add(relief.mul(0.4))) : tsl.normalize(upView);
  return material;
}

function createUndergrowthBranchMaterial(
  name: string,
  textures: UndergrowthTextureSet,
  useNodeMaterial: boolean,
): THREE.Material {
  if (!useNodeMaterial) {
    const material = new THREE.MeshStandardMaterial({
      name,
      map: textures.albedo,
      normalMap: textures.normal,
      roughnessMap: textures.roughness,
      roughness: 0.94,
      metalness: 0,
    });
    material.normalScale.set(0.36, 0.36);
    return material;
  }
  const material = new MeshStandardNodeMaterial() as unknown as THREE.MeshStandardMaterial & {
    positionNode: unknown;
  };
  material.name = name;
  material.map = textures.albedo;
  material.normalMap = textures.normal;
  material.roughnessMap = textures.roughness;
  material.roughness = textures.roughness ? 1 : 0.94;
  material.metalness = 0;
  material.positionNode = createRootedGeometryWindPosition(0.075) as never;
  return material;
}

function undergrowthWindVecForYaw(yaw: number, scale: THREE.Vector3, out = windVecScratch): THREE.Vector3 {
  windQuat.setFromAxisAngle(Y_AXIS, -yaw);
  out.copy(WIND_DIR).applyQuaternion(windQuat);
  if (scale.x !== 0) out.x /= scale.x;
  if (scale.y !== 0) out.y /= scale.y;
  if (scale.z !== 0) out.z /= scale.z;
  return out;
}

function createUndergrowthShadowGeometry(kind: UndergrowthKind): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 10, 6, 0, TAU, 0, Math.PI * 0.52);
  switch (kind) {
    case 'fern':
      geometry.scale(0.82, 0.22, 0.82);
      geometry.translate(0, 0.05, 0);
      break;
    case 'juniper':
      geometry.scale(0.9, 0.36, 0.9);
      geometry.translate(0, 0.12, 0);
      break;
    case 'bush':
      geometry.scale(1.14, 0.48, 1.14);
      geometry.translate(0, 0.14, 0);
      break;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

async function loadJuniperBerry(): Promise<UndergrowthFruitAsset> {
  const url = seedThreeFruitUrl('juniper_berry.glb');
  if (!url) throw new Error('Missing SeedThree common-juniper berry GLB');
  const gltf = await gltfLoader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  if (meshes.length !== 1) {
    throw new Error(`juniper_berry.glb must contain one mesh (found ${meshes.length})`);
  }
  const source = meshes[0]!;
  const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  geometry.translate(
    -(box.min.x + box.max.x) * 0.5,
    -box.max.y,
    -(box.min.z + box.max.z) * 0.5,
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const sourceMaterial = Array.isArray(source.material) ? source.material[0]! : source.material;
  const material = sourceMaterial.clone();
  material.name = 'Generated juniper_berry.glb material';
  source.geometry.dispose();
  sourceMaterial.dispose();
  return { geometry, material };
}

async function loadUndergrowthTextures(files: UndergrowthTextureFiles, maxAnisotropy: number): Promise<UndergrowthTextureSet> {
  const [albedo, normal, roughness, translucency] = await Promise.all([
    loadRequiredLeafTexture(files.albedo, true, maxAnisotropy),
    loadOptionalLeafTexture(files.normal, false, maxAnisotropy),
    loadOptionalLeafTexture(files.roughness, false, maxAnisotropy),
    loadOptionalLeafTexture(files.translucency, false, maxAnisotropy),
  ]);
  return { albedo, normal, roughness, translucency };
}

async function loadBranchTextures(
  files: Omit<UndergrowthTextureFiles, 'translucency'>,
  maxAnisotropy: number,
): Promise<UndergrowthTextureSet> {
  const [albedo, normal, roughness] = await Promise.all([
    loadRequiredBarkTexture(files.albedo, true, maxAnisotropy),
    loadOptionalBarkTexture(files.normal, false, maxAnisotropy),
    loadOptionalBarkTexture(files.roughness, false, maxAnisotropy),
  ]);
  return { albedo, normal, roughness, translucency: null };
}

async function loadRequiredLeafTexture(name: string, srgb: boolean, maxAnisotropy: number): Promise<THREE.Texture> {
  const texture = await loadOptionalLeafTexture(name, srgb, maxAnisotropy);
  if (!texture) throw new Error(`SeedThree undergrowth texture missing (${name})`);
  return texture;
}

async function loadOptionalLeafTexture(name: string, srgb: boolean, maxAnisotropy: number): Promise<THREE.Texture | null> {
  const url = seedThreeLeafUrl(name);
  if (!url) return null;
  const texture = await loader.loadAsync(url);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  return texture;
}

async function loadRequiredBarkTexture(name: string, srgb: boolean, maxAnisotropy: number): Promise<THREE.Texture> {
  const texture = await loadOptionalBarkTexture(name, srgb, maxAnisotropy);
  if (!texture) throw new Error(`SeedThree undergrowth bark texture missing (${name})`);
  return texture;
}

async function loadOptionalBarkTexture(name: string, srgb: boolean, maxAnisotropy: number): Promise<THREE.Texture | null> {
  const url = seedThreeBarkUrl(name);
  if (!url) return null;
  const texture = await loader.loadAsync(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  return texture;
}

function collectTextures(...sets: UndergrowthTextureSet[]): THREE.Texture[] {
  const textures: THREE.Texture[] = [];
  for (const set of sets) {
    textures.push(set.albedo);
    if (set.normal) textures.push(set.normal);
    if (set.roughness) textures.push(set.roughness);
    if (set.translucency) textures.push(set.translucency);
  }
  return textures;
}

function rngRange(rng: () => number, min: number, max: number): number {
  return THREE.MathUtils.lerp(min, max, rng());
}

function undergrowthHash01(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}
