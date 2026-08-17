import * as THREE from 'three';
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
import { seedThreeBarkUrl, seedThreeLeafUrl } from '../vegetation/seedthree/seedThreeTextures.ts';
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

export type UndergrowthMaterials = {
  bush: UndergrowthMaterialPair;
  fern: [foliage: THREE.Material];
  juniper: UndergrowthMaterialPair;
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

export async function createUndergrowthMaterials(
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind | undefined,
  _sharedTextures: THREE.Texture[],
): Promise<UndergrowthMaterials> {
  const [bushTextures, fernTextures, juniperTextures, bushBranch, juniperBranch] = await Promise.all([
    loadUndergrowthTextures(CARD_FILES.bush, maxAnisotropy),
    loadUndergrowthTextures(CARD_FILES.fern, maxAnisotropy),
    loadUndergrowthTextures(CARD_FILES.juniper, maxAnisotropy),
    loadBranchTextures(BRANCH_FILES.bush, maxAnisotropy),
    loadBranchTextures(BRANCH_FILES.juniper, maxAnisotropy),
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
      createUndergrowthCardMaterial('SeedThree common juniper sprays', juniperTextures, useNodeMaterials, [0.22, 0.36, 0.14]),
    ],
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

  return {
    group,
    placements,
    buckets,
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
  materials.textures.forEach((texture) => texture.dispose());
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
