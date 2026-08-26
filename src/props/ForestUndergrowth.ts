import * as THREE from 'three';
import { SpatialHash2D } from '../utils/SpatialHash2D.ts';
import { MeshSSSNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraViewMatrix,
  float,
  modelWorldMatrix,
  mix,
  normalMap,
  normalView,
  normalWorldGeometry,
  normalize,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { windSpeed, windStrength, WIND_DIR } from '@seedthree/core/wind.js';
import {
  createRootedDogwoodFoliageWindPosition,
  createRootedGeometryWindPosition,
  DOGWOOD_LEAF_FLUTTER_AMPLITUDE,
  DOGWOOD_LEAF_PHASE_MULTIPLIER,
  DOGWOOD_LEAF_WEIGHT_GATE,
  DOGWOOD_ROOT_SWAY_AMPLITUDE,
} from '../vegetation/seedthree/seedThreeFoliageWind.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { applyFoliageDoubleSideNormals } from '../scene/foliageDoubleSideNormals.ts';
import { chainMaterialShaderPatch } from '../scene/materialShaderPatch.ts';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import { worldAnimationTime } from '../scene/worldAnimationTime.ts';
import {
  supportsNodeMaterials,
  type RendererBackendKind,
} from '../scene/RendererBackend.ts';
import { applyPainterlyVegetationMaterial } from '../vegetation/painterly/painterlyVegetationMaterial.ts';
import type { DeciduousFoliagePresentation } from '../world/deciduousFoliagePolicy.ts';
import {
  seedThreeBarkUrl,
  seedThreeLeafUrl,
} from '../vegetation/seedthree/seedThreeTextures.ts';
import { sampleBilberryBushScale } from '../vegetation/bilberryBushVisual.ts';
import {
  COMMON_DOGWOOD_BRANCH_TEXTURE_FILES,
  COMMON_DOGWOOD_LEAF_TEXTURE_FILES,
} from '../vegetation/seedthree/commonDogwoodPreset.ts';
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
  clamp: (minimum: unknown, maximum: unknown) => TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
  r: TslNode;
  a: TslNode;
  rgb: TslNode;
  xyz: TslNode;
};

const tsl = {
  attribute: attribute as (name: string, type: string) => TslNode,
  cameraViewMatrix: cameraViewMatrix as TslNode,
  float: float as (value: number) => TslNode,
  mix: mix as (a: unknown, b: unknown, t: unknown) => TslNode,
  modelWorldMatrix: modelWorldMatrix as TslNode,
  normalMap: normalMap as (sample: unknown) => TslNode,
  normalView: normalView as TslNode,
  normalWorldGeometry: normalWorldGeometry as TslNode,
  normalize: normalize as (value: unknown) => TslNode,
  positionLocal: positionLocal as TslNode,
  positionWorld: positionWorld as TslNode,
  sin: sin as (value: unknown) => TslNode,
  smoothstep: smoothstep as (low: unknown, high: unknown, value: unknown) => TslNode,
  texture: texture as (map: THREE.Texture) => TslNode,
  uniform: uniform as <T>(value: T) => { value: T } & TslNode,
  vec3: vec3 as (x: unknown, y?: unknown, z?: unknown) => TslNode,
  vec4: vec4 as (...values: unknown[]) => TslNode,
  windSpeed: windSpeed as unknown as TslNode,
  windStrength: windStrength as unknown as TslNode,
};

const TAU = Math.PI * 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const windQuat = new THREE.Quaternion();
const windVecScratch = new THREE.Vector3();

// Project-owned runtime texture contract (values are sourced from the preset):
// common_dogwood_branch_albedo.png
// common_dogwood_branch_normal.png
// common_dogwood_branch_roughness.png
// common_dogwood_single_albedo.png
// common_dogwood_single_normal.png
// common_dogwood_single_roughness.png
// common_dogwood_single_translucency.png

export type UndergrowthKind = 'bush' | 'fern' | 'juniper' | 'dogwood';
export const UNDERGROWTH_KINDS: readonly UndergrowthKind[] = [
  'bush',
  'fern',
  'juniper',
  'dogwood',
];

/**
 * Runtime metre envelopes against the 1.55 m standing eye / 1.78 m body.
 * Width is the complete ground footprint, including rotated asymmetric crowns.
 */
export const UNDERGROWTH_REALISTIC_SIZE_METERS = {
  bush: { height: [0.3, 0.8], width: [0.6, 1.7] },
  fern: { height: [0.45, 1.2], width: [0.85, 2.5] },
  juniper: { height: [0.95, 2.9], width: [1.5, 4.8] },
  dogwood: { height: [1.3, 4.6], width: [0.95, 5.2] },
} as const satisfies Record<
  UndergrowthKind,
  { height: readonly [number, number]; width: readonly [number, number] }
>;

/** Juvenile stools begin below the 1.55 m standing first-person eye line. */
export const DOGWOOD_MIN_SCALE = 0.55;
/** Mature outliers reach the real-world upper envelope without making every stool a thicket. */
export const DOGWOOD_MAX_SCALE = 1.9;
export const DOGWOOD_MAX_HEIGHT_METERS = 4.6;
/** Softens the upper ceiling so the tallest stools do not form one flat tier. */
export const DOGWOOD_MIN_HEIGHT_CEILING_METERS = 4.34;
export const DOGWOOD_MIN_WIDTH_SCALE = 0.64;
export const DOGWOOD_MAX_WIDTH_SCALE = 1.8;
export const DOGWOOD_FOREST_EDGE_SHARE = 0.32;
export const DOGWOOD_FOREST_CORE_SHARE = 0.24;
const DOGWOOD_TREE_TRUNK_CLEARANCE_MIN = 1.05;
const DOGWOOD_COMPANION_CLEARANCE = 2.2;
export const DOGWOOD_MIN_FOOTPRINT_CLEARANCE = 0.9;
export const DOGWOOD_MAX_FOOTPRINT_CLEARANCE = 2.6;
/** Keeps the wind-swaying basal skirt above terrain at the 4.6 m size limit. */
const DOGWOOD_GROUND_OFFSET_METERS = 0.015;
export const DOGWOOD_AUTUMN_STEM_REVEAL = 0.45;
const DOGWOOD_STEM_YOUTH_START = 0.24;
const DOGWOOD_STEM_YOUTH_END = 0.84;
const DOGWOOD_OLD_WINTER_STEM = [0.22, 0.018, 0.008] as const;
const DOGWOOD_YOUNG_WINTER_STEM = [0.96, 0.04, 0.008] as const;

export type UndergrowthPlacement = {
  x: number;
  z: number;
  kind: UndergrowthKind;
  scale: number;
  yaw: number;
  prototypeIndex: number;
  meshIndex: number;
  finalHeight?: number;
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

export type UndergrowthMaterialPair = [branch: THREE.Material, foliage: THREE.Material];

export type UndergrowthMaterials = {
  bush: UndergrowthMaterialPair;
  fern: [foliage: THREE.Material];
  juniper: UndergrowthMaterialPair;
  dogwood: UndergrowthMaterialPair;
  prototypes: Record<UndergrowthKind, GorskiShrubPrototype[]>;
  shadowCast: THREE.MeshStandardMaterial;
  bushShadowDepth: THREE.MeshDepthMaterial;
  fernShadowDepth: THREE.MeshDepthMaterial;
  juniperShadowDepth: THREE.MeshDepthMaterial;
  dogwoodShadowDepth: THREE.MeshDepthMaterial;
  textures: THREE.Texture[];
};

/**
 * A small, independently owned slice of the undergrowth catalog for authored
 * field-edge planting. It keeps farm markers on the same SeedThree geometry,
 * texture, and wind path as the forest floor without loading fern, juniper,
 * or shadow-proxy resources that the field perimeter never uses.
 */
export type FieldPerimeterShrubCatalog = {
  materials: UndergrowthMaterialPair;
  prototypes: GorskiShrubPrototype[];
  textures: THREE.Texture[];
  dispose: () => void;
};

export type UndergrowthInstances = {
  group: THREE.Group;
  placements: UndergrowthPlacement[];
  buckets: Record<UndergrowthKind, UndergrowthBucket[]>;
  stats: UndergrowthStats;
  setDeciduousFoliage: (presentation: DeciduousFoliagePresentation) => boolean;
  setSnowCoverage: (coverage: number) => boolean;
};

export type UndergrowthStats = {
  instances: number;
  instancesByKind: Record<UndergrowthKind, number>;
  renderDrawCalls: number;
  shadowDrawCalls: number;
  maximumDrawCalls: number;
  dogwood: {
    instances: number;
    minimumHeight: number;
    maximumHeight: number;
    leafyDrawCalls: number;
    bareDrawCalls: number;
  };
};

export type UndergrowthBucket = {
  placements: UndergrowthPlacement[];
  mesh: THREE.InstancedMesh;
  shadowMesh: THREE.InstancedMesh;
  matrices: THREE.Matrix4[];
  anchorAttr: THREE.InstancedBufferAttribute;
  windVecAttr: THREE.InstancedBufferAttribute;
  prototypeHeight: number;
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
  dogwood: {
    ...COMMON_DOGWOOD_LEAF_TEXTURE_FILES,
  },
};

const BRANCH_FILES: Record<Exclude<UndergrowthKind, 'fern'>, Omit<UndergrowthTextureFiles, 'translucency'>> = {
  bush: { albedo: 'bilberry_branch_albedo.png', normal: 'bilberry_branch_normal.png', roughness: 'bilberry_branch_roughness.png' },
  juniper: { albedo: 'common_juniper_branch_albedo.png', normal: 'common_juniper_branch_normal.png', roughness: 'common_juniper_branch_roughness.png' },
  dogwood: { ...COMMON_DOGWOOD_BRANCH_TEXTURE_FILES },
};

const loader = new THREE.TextureLoader();

export async function createUndergrowthMaterials(
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind | undefined,
  _sharedTextures: THREE.Texture[],
): Promise<UndergrowthMaterials> {
  const [
    bushTextures,
    fernTextures,
    juniperTextures,
    dogwoodTextures,
    bushBranch,
    juniperBranch,
    dogwoodBranch,
  ] = await Promise.all([
    loadUndergrowthTextures(CARD_FILES.bush, maxAnisotropy),
    loadUndergrowthTextures(CARD_FILES.fern, maxAnisotropy),
    loadUndergrowthTextures(CARD_FILES.juniper, maxAnisotropy),
    loadUndergrowthTextures(CARD_FILES.dogwood, maxAnisotropy),
    loadBranchTextures(BRANCH_FILES.bush, maxAnisotropy),
    loadBranchTextures(BRANCH_FILES.juniper, maxAnisotropy),
    loadBranchTextures(BRANCH_FILES.dogwood, maxAnisotropy),
  ]);
  const useNodeMaterials = supportsNodeMaterials(rendererBackend ?? 'webgl');
  const textures = collectTextures(
    bushTextures, fernTextures, juniperTextures, dogwoodTextures,
    bushBranch, juniperBranch, dogwoodBranch,
  );
  const prototypes = Object.fromEntries(
    UNDERGROWTH_KINDS.map((kind) => [
      kind,
      Array.from({ length: GORSKI_SHRUB_VARIANT_COUNT }, (_, variant) => (
        createGorskiShrubPrototype(kind, variant)
      )),
    ]),
  ) as Record<UndergrowthKind, GorskiShrubPrototype[]>;

  return {
    bush: [
      createUndergrowthBranchMaterial('SeedThree bilberry woody stems', bushBranch, useNodeMaterials),
      createUndergrowthCardMaterial(
        'SeedThree bilberry sprays',
        bushTextures,
        useNodeMaterials,
        [0.3, 0.44, 0.16],
        { seasonalRole: 'bilberry' },
      ),
    ],
    fern: [
      createUndergrowthCardMaterial(
        'SeedThree curved fern fronds',
        fernTextures,
        useNodeMaterials,
        [0.26, 0.5, 0.18],
        {
          albedoTint: [0.58, 0.66, 0.52],
          seasonalRole: 'fern',
          transmissionAmbient: 0,
          transmissionAlbedoWeight: 1,
          transmissionScale: 0.9,
        },
      ),
    ],
    juniper: [
      createUndergrowthBranchMaterial('SeedThree common juniper stems', juniperBranch, useNodeMaterials),
      createUndergrowthCardMaterial(
        'SeedThree common juniper needle-only sprays',
        juniperTextures,
        useNodeMaterials,
        [0.22, 0.36, 0.14],
        { seasonalRole: 'juniper' },
      ),
    ],
    dogwood: [
      createUndergrowthBranchMaterial(
        'SeedThree common dogwood basal stems',
        dogwoodBranch,
        useNodeMaterials,
        {
          seasonalDogwoodStem: true,
          webglWindAmplitude: DOGWOOD_ROOT_SWAY_AMPLITUDE,
        },
      ),
      createUndergrowthCardMaterial(
        'SeedThree common dogwood opposite leaves',
        dogwoodTextures,
        useNodeMaterials,
        [0.27, 0.43, 0.15],
        {
          seasonalRole: 'dogwood',
          webglWindAmplitude: DOGWOOD_ROOT_SWAY_AMPLITUDE,
          leafFlutterAmplitude: DOGWOOD_LEAF_FLUTTER_AMPLITUDE,
        },
      ),
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
    dogwoodShadowDepth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
    textures,
  };
}

export async function createFieldPerimeterShrubCatalog(
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind | undefined,
): Promise<FieldPerimeterShrubCatalog> {
  const [bushTextures, bushBranch] = await Promise.all([
    loadUndergrowthTextures({
      albedo: 'hornbeam_hedge_spray_albedo.png',
      normal: 'hornbeam_hedge_spray_normal.png',
      roughness: 'hornbeam_hedge_spray_roughness.png',
      translucency: 'hornbeam_hedge_spray_translucency.png',
    }, maxAnisotropy),
    loadBranchTextures({
      albedo: 'hornbeam_hedge_branch_albedo.png',
      normal: 'hornbeam_hedge_branch_normal.png',
      roughness: 'hornbeam_hedge_branch_roughness.png',
    }, maxAnisotropy),
  ]);
  const textures = collectTextures(bushTextures, bushBranch);
  const foliageMaterial = createUndergrowthCardMaterial(
    'SeedThree field-hedge hornbeam leaves',
    bushTextures,
    rendererBackend === 'webgpu',
    [0.3, 0.44, 0.16],
  );
  if (rendererBackend !== 'webgpu' && foliageMaterial instanceof THREE.MeshStandardMaterial) {
    // The forest's legacy double-side patch intentionally preserves card-face
    // normals, but this low hedge is viewed from both sides and needs the
    // stock r185 back-face normal flip. Reset the patch for the WebGL QA path;
    // the live WebGPU path owns its normals through the TSL material above.
    foliageMaterial.onBeforeCompile = () => undefined;
    foliageMaterial.customProgramCacheKey = () => 'field-hornbeam-standard-double-sided-v1';
    foliageMaterial.emissive.setHex(0x829b69);
    foliageMaterial.emissiveMap = bushTextures.albedo;
    foliageMaterial.emissiveIntensity = 0.85;
    foliageMaterial.needsUpdate = true;
  }
  const branchMaterial = createUndergrowthBranchMaterial(
    'SeedThree field-hedge hornbeam stems',
    bushBranch,
    rendererBackend === 'webgpu',
  );
  if ('color' in branchMaterial && branchMaterial.color instanceof THREE.Color) {
    branchMaterial.color.setHex(0xc9c3b5);
  }
  const materials: UndergrowthMaterialPair = [
    branchMaterial,
    foliageMaterial,
  ];
  const prototypes = Array.from(
    { length: GORSKI_SHRUB_VARIANT_COUNT },
    (_, variant) => createGorskiShrubPrototype('field-hornbeam', variant),
  );
  let disposed = false;

  return {
    materials,
    prototypes,
    textures,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of materials) material.dispose();
      for (const prototype of prototypes) prototype.geometry.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}

export function createUndergrowthPlacements(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ForestSpawnConfig,
  isBlockedAt?: (x: number, z: number) => boolean,
  treePlacements: ReadonlyArray<{ x: number; z: number }> = [],
): UndergrowthPlacement[] {
  const placements: UndergrowthPlacement[] = [];
  const placementIndex = new SpatialHash2D<UndergrowthPlacement>(2);
  const dogwoodIndex = new SpatialHash2D<UndergrowthPlacement>(DOGWOOD_COMPANION_CLEARANCE);
  const treeIndex = new SpatialHash2D(DOGWOOD_MAX_FOOTPRINT_CLEARANCE, treePlacements);
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
    const scale = sampleUndergrowthScale(kind, density, rng);
    const footprintClearance = undergrowthPlacementClearanceRadius({ kind, scale });
    const minDistance =
      kind === 'fern'
        ? THREE.MathUtils.lerp(1.3, 0.8, density)
        : kind === 'juniper'
          ? THREE.MathUtils.lerp(2.8, 1.9, density)
          : kind === 'dogwood'
            ? THREE.MathUtils.lerp(3.6, 2.75, density)
            : THREE.MathUtils.lerp(1.6, 1.0, density);
    if (placementIndex.hasPointWithin(x, z, minDistance)) continue;
    if (kind !== 'dogwood' && dogwoodIndex.hasPointWithin(x, z, DOGWOOD_COMPANION_CLEARANCE)) continue;
    if (
      kind === 'dogwood'
      && treeIndex.hasPointWithin(
        x,
        z,
        Math.max(DOGWOOD_TREE_TRUNK_CLEARANCE_MIN, footprintClearance * 0.82),
      )
    ) continue;
    if (isUndergrowthFootprintBlocked(x, z, footprintClearance, isBlockedAt)) continue;

    const placement = {
      x,
      z,
      kind,
      scale,
      yaw: rng() * TAU,
      prototypeIndex: Math.floor(rng() * GORSKI_SHRUB_VARIANT_COUNT),
      meshIndex: -1,
    };
    placements.push(placement);
    placementIndex.add(placement);
    if (kind === 'dogwood') dogwoodIndex.add(placement);
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
    UNDERGROWTH_KINDS.map((kind) => {
      const shadowDepth = kind === 'bush'
        ? materials.bushShadowDepth
        : kind === 'fern'
          ? materials.fernShadowDepth
          : kind === 'juniper'
            ? materials.juniperShadowDepth
            : materials.dogwoodShadowDepth;
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

  const stats = createUndergrowthStats(placements, buckets);

  return {
    group,
    placements,
    buckets,
    stats,
    setDeciduousFoliage(presentation): boolean {
      const dormancy = clampSeasonAmount(presentation.dormancy);
      let changed = false;
      changed = setUndergrowthSeason(materials.dogwood[0], presentation) || changed;
      for (const kind of UNDERGROWTH_KINDS) {
        changed = setUndergrowthSeason(materials[kind].at(-1)!, presentation) || changed;
      }
      changed = setUndergrowthShadowDormancy(buckets.dogwood, dormancy, 0.16) || changed;
      changed = setUndergrowthShadowDormancy(buckets.bush, dormancy, 0.28) || changed;
      changed = setUndergrowthShadowDormancy(buckets.fern, dormancy, 0.42) || changed;
      changed = setSeasonalFoliageVisibility(materials.dogwood[1], dormancy < 1) || changed;
      changed = setSeasonalFoliageVisibility(materials.bush[1], dormancy < 1) || changed;
      return changed;
    },
    setSnowCoverage(coverage): boolean {
      let changed = false;
      for (const kind of UNDERGROWTH_KINDS) {
        for (const material of materials[kind]) {
          changed = setSeasonUniform(material, 'forestSnowCoverage', coverage) || changed;
        }
      }
      return changed;
    },
  };
}

export function disposeUndergrowthInstances(instances: UndergrowthInstances, materials: UndergrowthMaterials): void {
  for (const kind of UNDERGROWTH_KINDS) {
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
  materials.dogwoodShadowDepth.dispose();
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
  geometry.computeBoundingBox();
  const prototypeHeight = Math.max(
    0.001,
    (geometry.boundingBox?.max.y ?? 1) - (geometry.boundingBox?.min.y ?? 0),
  );
  const anchorAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const windVecAttr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
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
    anchorAttr,
    windVecAttr,
    prototypeHeight,
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
    const yaw = composeUndergrowthMatrix(
      placement,
      bucket.prototypeHeight,
      terrain,
      rng,
      matrix,
      quaternion,
      position,
      scaleVector,
    );
    bucket.mesh.setMatrixAt(index, matrix);
    bucket.shadowMesh.setMatrixAt(index, matrix);
    bucket.matrices[index].copy(matrix);

    const tint = sampleUndergrowthTint(placement.kind, rng);
    bucket.anchorAttr.setXYZ(index, position.x, position.y, position.z);
    const windVec = undergrowthWindVecForYaw(yaw, scaleVector);
    bucket.windVecAttr.setXYZ(index, windVec.x, windVec.y, windVec.z);
    color.setRGB(tint.x, tint.y, tint.z);
    bucket.mesh.setColorAt(index, color);
  });

  bucket.mesh.instanceMatrix.needsUpdate = true;
  bucket.shadowMesh.instanceMatrix.needsUpdate = true;
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
  for (const kind of UNDERGROWTH_KINDS) {
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
  prototypeHeight: number,
  terrain: Terrain,
  rng: () => number,
  matrix: THREE.Matrix4,
  quaternion: THREE.Quaternion,
  position: THREE.Vector3,
  scaleVector: THREE.Vector3,
): number {
  const y = terrain.getHeightAt(placement.x, placement.z) + (
    placement.kind === 'dogwood' ? DOGWOOD_GROUND_OFFSET_METERS : 0.08
  );
  const yaw = placement.yaw + (rng() - 0.5) * 0.24;
  position.set(placement.x, y, placement.z);
  if (placement.kind === 'dogwood') {
    // The authored variants already carry natural basal-stem asymmetry. Keep
    // the runtime transform upright so juvenile-to-mature height remains a
    // strict metre contract rather than gaining Y extent from a rotated crown.
    quaternion.setFromAxisAngle(Y_AXIS, yaw);
  } else {
    const leanDirection = rng() * TAU;
    const lean = placement.kind === 'fern'
      ? THREE.MathUtils.lerp(0.1, 0.28, rng())
      : THREE.MathUtils.lerp(0.04, 0.16, rng());
    quaternion.setFromEuler(
      new THREE.Euler(
        Math.cos(leanDirection) * lean,
        yaw,
        Math.sin(leanDirection) * lean * 0.7,
        'YXZ',
      ),
    );
  }
  const widthFactor = placement.kind === 'bush'
    ? 1.3
    : placement.kind === 'fern'
      ? 1.15
      : placement.kind === 'juniper'
        ? 1.08
        : 1.0;
  const widthVariation = placement.kind === 'bush'
    ? THREE.MathUtils.lerp(0.94, 1.16, rng())
    : placement.kind === 'fern'
      ? THREE.MathUtils.lerp(0.94, 1.1, rng())
      : placement.kind === 'juniper'
        ? THREE.MathUtils.lerp(0.94, 1.08, rng())
        : THREE.MathUtils.lerp(0.95, 1.05, rng());
  const dogwoodMaturity = placement.kind === 'dogwood'
    ? THREE.MathUtils.clamp(
      (placement.scale - DOGWOOD_MIN_SCALE) / (DOGWOOD_MAX_SCALE - DOGWOOD_MIN_SCALE),
      0,
      1,
    )
    : 0;
  const widthScale = placement.kind === 'dogwood'
    ? THREE.MathUtils.lerp(
      DOGWOOD_MIN_WIDTH_SCALE,
      DOGWOOD_MAX_WIDTH_SCALE,
      Math.pow(dogwoodMaturity, 0.84),
    ) * widthVariation
    : placement.scale * widthFactor * widthVariation;
  const dogwoodHeightCeilingPosition = placement.kind === 'dogwood'
    ? THREE.MathUtils.clamp(
      placement.prototypeIndex / Math.max(1, GORSKI_SHRUB_VARIANT_COUNT - 1)
        + THREE.MathUtils.lerp(-0.08, 0.08, rng()),
      0,
      1,
    )
    : 0;
  const dogwoodHeightCeiling = placement.kind === 'dogwood'
    ? THREE.MathUtils.lerp(
      DOGWOOD_MIN_HEIGHT_CEILING_METERS,
      DOGWOOD_MAX_HEIGHT_METERS,
      dogwoodHeightCeilingPosition,
    )
    : DOGWOOD_MAX_HEIGHT_METERS;
  const heightScale = placement.kind === 'dogwood'
    ? Math.min(placement.scale, dogwoodHeightCeiling / prototypeHeight)
    : placement.scale * (
      placement.kind === 'bush'
        ? THREE.MathUtils.lerp(0.94, 1.06, rng())
        : placement.kind === 'fern'
          ? THREE.MathUtils.lerp(0.94, 1.1, rng())
          : THREE.MathUtils.lerp(0.94, 1.1, rng())
    );
  placement.finalHeight = prototypeHeight * heightScale;
  scaleVector.set(widthScale, heightScale, widthScale);
  matrix.compose(position, quaternion, scaleVector);
  return yaw;
}

function pickUndergrowthKind(rng: () => number, density: number): UndergrowthKind {
  // Common dogwood favors brighter woodland edges while retaining a visible
  // midstory share inside the darker fern-heavy core interiors.
  const dogwoodChance = THREE.MathUtils.lerp(
    DOGWOOD_FOREST_EDGE_SHARE,
    DOGWOOD_FOREST_CORE_SHARE,
    density,
  );
  const juniperChance = THREE.MathUtils.lerp(0.18, 0.055, density);
  const fernChance = THREE.MathUtils.lerp(0.26, 0.42, density);
  const roll = rng();
  if (roll < dogwoodChance) return 'dogwood';
  if (roll < dogwoodChance + juniperChance) return 'juniper';
  if (roll < dogwoodChance + juniperChance + fernChance) return 'fern';
  return 'bush';
}

export function sampleUndergrowthScale(kind: UndergrowthKind, density: number, rng: () => number): number {
  switch (kind) {
    case 'bush':
      return sampleBilberryBushScale(density, rng);
    case 'fern':
      return THREE.MathUtils.lerp(0.82, 1.36, Math.pow(rng(), 0.7)) * THREE.MathUtils.lerp(0.98, 1.1, density);
    case 'juniper':
      return THREE.MathUtils.lerp(0.78, 1.52, Math.pow(rng(), 0.82)) * THREE.MathUtils.lerp(1.08, 0.96, density);
    case 'dogwood':
      return THREE.MathUtils.lerp(DOGWOOD_MIN_SCALE, DOGWOOD_MAX_SCALE, Math.pow(rng(), 1.18));
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
    case 'dogwood':
      return new THREE.Vector3(
        rngRange(rng, 0.7, 0.9),
        rngRange(rng, 0.78, 0.96),
        rngRange(rng, 0.64, 0.84),
      );
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

type UndergrowthMaterialOptions = {
  albedoTint?: [number, number, number];
  seasonalRole?: UndergrowthSeasonalRole;
  seasonalDogwoodStem?: boolean;
  webglWindAmplitude?: number;
  leafFlutterAmplitude?: number;
  transmissionAmbient?: number;
  transmissionAlbedoWeight?: number;
  transmissionScale?: number;
};

type UndergrowthSeasonalRole = 'bilberry' | 'fern' | 'juniper' | 'dogwood';

type UndergrowthSeasonalPalette = {
  spring: readonly [number, number, number];
  autumn: readonly [number, number, number];
  dormant: readonly [number, number, number];
  springBlend: number;
  autumnBlend: number;
  dormantBlend: number;
  winterRetention: number;
  snowBlend: number;
};

const UNDERGROWTH_SEASONAL_PALETTES: Readonly<Record<UndergrowthSeasonalRole, UndergrowthSeasonalPalette>> = {
  bilberry: {
    spring: [0.59, 0.94, 0.24],
    autumn: [0.74, 0.13, 0.035],
    dormant: [0.31, 0.19, 0.105],
    springBlend: 0.54,
    autumnBlend: 0.92,
    dormantBlend: 0.82,
    winterRetention: 0,
    snowBlend: 0.56,
  },
  fern: {
    spring: [0.55, 0.9, 0.22],
    autumn: [0.78, 0.38, 0.055],
    dormant: [0.43, 0.27, 0.12],
    springBlend: 0.52,
    autumnBlend: 0.82,
    dormantBlend: 0.92,
    winterRetention: 0.22,
    snowBlend: 0.62,
  },
  juniper: {
    spring: [0.28, 0.46, 0.17],
    autumn: [0.2, 0.32, 0.12],
    dormant: [0.13, 0.24, 0.13],
    springBlend: 0.2,
    autumnBlend: 0.08,
    dormantBlend: 0.26,
    winterRetention: 1,
    snowBlend: 0.64,
  },
  dogwood: {
    spring: [0.66, 0.96, 0.24],
    autumn: [0.79, 0.075, 0.028],
    dormant: [0.42, 0.22, 0.1],
    springBlend: 0.58,
    autumnBlend: 1,
    dormantBlend: 0.72,
    winterRetention: 0,
    snowBlend: 0.56,
  },
};

function createUndergrowthCardMaterial(
  name: string,
  textures: UndergrowthTextureSet,
  useNodeMaterial: boolean,
  transmitRGB: [number, number, number],
  options: UndergrowthMaterialOptions = {},
): THREE.Material {
  const albedoTint = new THREE.Color().setRGB(...(options.albedoTint ?? [1, 1, 1]));
  if (!useNodeMaterial) {
    const material = new THREE.MeshStandardMaterial({
      name,
      color: albedoTint,
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
    if (options.webglWindAmplitude !== undefined) {
      applyUndergrowthWebGLWind(
        material,
        options.webglWindAmplitude,
        options.leafFlutterAmplitude,
      );
    }
    if (options.seasonalRole) {
      applyUndergrowthWebGLSeasonAndSnow(
        material,
        UNDERGROWTH_SEASONAL_PALETTES[options.seasonalRole],
      );
    } else {
      applyUndergrowthWebGLSnow(material);
    }
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

  const texel = tsl.texture(textures.albedo);
  const albedoTintNode = tsl.uniform(albedoTint);
  const transmit = tsl.uniform(new THREE.Color().setRGB(...transmitRGB));
  const edge = textures.translucency ? tsl.texture(textures.translucency).r : tsl.float(1);
  const untintedTransmission = edge.mul(transmit);
  let thicknessColor = tsl.mix(
    untintedTransmission,
    untintedTransmission.mul(texel.rgb),
    options.transmissionAlbedoWeight ?? 0,
  );
  material.thicknessColorNode = thicknessColor;
  material.thicknessDistortionNode = tsl.uniform(0.3);
  material.thicknessAmbientNode = tsl.uniform(options.transmissionAmbient ?? 0.026);
  material.thicknessAttenuationNode = tsl.uniform(1.0);
  material.thicknessPowerNode = tsl.uniform(5.0);
  material.thicknessScaleNode = tsl.uniform(options.transmissionScale ?? 1.5);
  // NodeMaterial applies InstancedMesh.instanceColor after colorNode. Keeping
  // tint on that built-in path avoids a duplicate per-instance vertex buffer.
  const baseSurface = options.albedoTint === undefined
    ? texel.rgb
    : texel.rgb.mul(albedoTintNode);
  material.colorNode = tsl.vec4(baseSurface, texel.a);
  material.positionNode = options.leafFlutterAmplitude === undefined
    ? createRootedGeometryWindPosition(options.webglWindAmplitude ?? 0.1)
    : createRootedDogwoodFoliageWindPosition(
      options.webglWindAmplitude ?? DOGWOOD_ROOT_SWAY_AMPLITUDE,
      options.leafFlutterAmplitude,
    );

  if (options.seasonalRole) {
    const palette = UNDERGROWTH_SEASONAL_PALETTES[options.seasonalRole];
    const spring = tsl.uniform(0);
    const autumn = tsl.uniform(0);
    const dormancy = tsl.uniform(0);
    const snowCoverage = tsl.uniform(0);
    const value = texel.r.mul(0.2126)
      .add(texel.rgb.y.mul(0.7152))
      .add(texel.rgb.z.mul(0.0722));
    const springLeaf = tsl.vec3(...palette.spring)
      .mul(value.mul(1.34)).clamp(0, 1);
    const autumnLeaf = tsl.vec3(...palette.autumn)
      .mul(value.mul(1.62)).clamp(0, 1);
    const dormantLeaf = tsl.vec3(...palette.dormant)
      .mul(value.mul(1.68)).clamp(0, 1);
    let seasonal = tsl.mix(
      baseSurface,
      springLeaf,
      spring.mul(palette.springBlend),
    );
    seasonal = tsl.mix(seasonal, autumnLeaf, autumn.mul(palette.autumnBlend));
    seasonal = tsl.mix(seasonal, dormantLeaf, dormancy.mul(palette.dormantBlend));
    const retain = tsl.float(1).sub(
      dormancy.mul(1 - palette.winterRetention),
    );
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
      .mul(palette.snowBlend);
    const snowColor = tsl.vec3(0.92, 0.955, 0.98);
    material.colorNode = tsl.vec4(
      tsl.mix(seasonal, snowColor, snowAmount),
      texel.a,
    );
    material.opacityNode = texel.a.mul(retain) as never;
    thicknessColor = thicknessColor
      .mul(retain)
      .mul(tsl.float(1).sub(snowAmount.mul(0.82)));
    material.thicknessColorNode = thicknessColor;
    material.userData.forestSeasonalSpringFlush = spring;
    material.userData.forestSeasonalAutumnColor = autumn;
    material.userData.forestSeasonalDormancy = dormancy;
    material.userData.forestSnowCoverage = snowCoverage;
  } else {
    applyUndergrowthNodeSnow(material, baseSurface, texel.a);
  }

  const upView = tsl.cameraViewMatrix.mul(tsl.vec4(0, 1, 0, 0)).xyz;
  const relief = textures.normal ? tsl.normalMap(tsl.texture(textures.normal)).sub(tsl.normalView) : null;
  material.normalNode = relief ? tsl.normalize(upView.add(relief.mul(0.4))) : tsl.normalize(upView);
  applyPainterlyVegetationMaterial(material, 'shrub-leaf');
  return material;
}

function createUndergrowthBranchMaterial(
  name: string,
  textures: UndergrowthTextureSet,
  useNodeMaterial: boolean,
  options: UndergrowthMaterialOptions = {},
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
    if (options.webglWindAmplitude !== undefined) {
      applyUndergrowthWebGLWind(material, options.webglWindAmplitude);
    }
    if (options.seasonalDogwoodStem) applyDogwoodWebGLStemSeason(material);
    applyUndergrowthWebGLSnow(material);
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
  material.positionNode = createRootedGeometryWindPosition(options.webglWindAmplitude ?? 0.075) as never;
  const baseSurface = tsl.texture(textures.albedo).rgb.mul(tsl.uniform(material.color));
  let seasonalSurface = baseSurface;
  if (options.seasonalDogwoodStem) {
    const autumn = tsl.uniform(0);
    const dormancy = tsl.uniform(0);
    const youth = tsl.smoothstep(
      tsl.float(DOGWOOD_STEM_YOUTH_START),
      tsl.float(DOGWOOD_STEM_YOUTH_END),
      tsl.attribute('aRootWeight', 'float'),
    );
    const barkValue = baseSurface.x.mul(0.2126)
      .add(baseSurface.y.mul(0.7152))
      .add(baseSurface.z.mul(0.0722));
    const winterStem = tsl.mix(
      tsl.vec3(...DOGWOOD_OLD_WINTER_STEM),
      tsl.vec3(...DOGWOOD_YOUNG_WINTER_STEM),
      youth,
    ).mul(barkValue.mul(0.48).add(0.64)).clamp(0, 1);
    const redReveal = dormancy
      .add(autumn.mul(DOGWOOD_AUTUMN_STEM_REVEAL))
      .clamp(0, 1);
    seasonalSurface = tsl.mix(baseSurface, winterStem, redReveal);
    material.userData.forestSeasonalAutumnColor = autumn;
    material.userData.forestSeasonalDormancy = dormancy;
    material.userData.dogwoodStemSeasonStrategy = 'age-aware-autumn-to-winter-red';
  }
  applyUndergrowthNodeSnow(
    material,
    seasonalSurface,
    tsl.float(1),
  );
  applyPainterlyVegetationMaterial(material, 'bark');
  return material;
}

function applyDogwoodWebGLStemSeason(material: THREE.MeshStandardMaterial): void {
  const autumn = { value: 0 };
  const dormancy = { value: 0 };
  material.userData.forestSeasonalAutumnColor = autumn;
  material.userData.forestSeasonalDormancy = dormancy;
  material.userData.dogwoodStemSeasonStrategy = 'age-aware-autumn-to-winter-red';
  chainMaterialShaderPatch(material, 'seedthree-dogwood-age-aware-winter-stems-v1', (shader) => {
    shader.uniforms.uDogwoodStemAutumn = autumn;
    shader.uniforms.uDogwoodStemDormancy = dormancy;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'varying float vDogwoodStemYouth;',
      ].join('\n'),
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        `vDogwoodStemYouth = smoothstep( ${DOGWOOD_STEM_YOUTH_START.toFixed(2)}, ${DOGWOOD_STEM_YOUTH_END.toFixed(2)}, aRootWeight );`,
      ].join('\n'),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'uniform float uDogwoodStemAutumn;',
        'uniform float uDogwoodStemDormancy;',
        'varying float vDogwoodStemYouth;',
      ].join('\n'),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      [
        '#include <map_fragment>',
        'float dogwoodStemValue = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );',
        `vec3 dogwoodOldWinterStem = vec3( ${DOGWOOD_OLD_WINTER_STEM.join(', ')} );`,
        `vec3 dogwoodYoungWinterStem = vec3( ${DOGWOOD_YOUNG_WINTER_STEM.join(', ')} );`,
        'vec3 dogwoodWinterStem = mix( dogwoodOldWinterStem, dogwoodYoungWinterStem, vDogwoodStemYouth );',
        'dogwoodWinterStem *= 0.64 + dogwoodStemValue * 0.48;',
        `float dogwoodStemRedReveal = clamp( uDogwoodStemDormancy + uDogwoodStemAutumn * ${DOGWOOD_AUTUMN_STEM_REVEAL.toFixed(2)}, 0.0, 1.0 );`,
        'diffuseColor.rgb = mix( diffuseColor.rgb, clamp( dogwoodWinterStem, 0.0, 1.0 ), dogwoodStemRedReveal );',
      ].join('\n'),
    );
  });
  material.needsUpdate = true;
}

function applyUndergrowthWebGLWind(
  material: THREE.Material,
  amplitude: number,
  leafFlutterAmplitude?: number,
): void {
  const cacheAmplitude = amplitude.toFixed(3);
  const cacheFlutter = leafFlutterAmplitude?.toFixed(3) ?? 'none';
  chainMaterialShaderPatch(material, `seedthree-undergrowth-rooted-wind-${cacheAmplitude}-${cacheFlutter}`, (shader) => {
    shader.uniforms.uUndergrowthTime = worldAnimationTime as unknown as THREE.IUniform;
    shader.uniforms.uUndergrowthWindSpeed = windSpeed as unknown as THREE.IUniform;
    shader.uniforms.uUndergrowthWindStrength = windStrength as unknown as THREE.IUniform;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
attribute float aRootWeight;
attribute vec3 aAnchorPos;
attribute vec3 aWindVec;${leafFlutterAmplitude === undefined ? '' : '\nattribute float aLeafPhase;'}
uniform float uUndergrowthTime;
uniform float uUndergrowthWindSpeed;
uniform float uUndergrowthWindStrength;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
float undergrowthWindTime = uUndergrowthTime * uUndergrowthWindSpeed;
float undergrowthWindPhase = aAnchorPos.x * 0.70 + aAnchorPos.z * 0.54;
float undergrowthWindGust = sin( undergrowthWindTime * 1.15 + undergrowthWindPhase ) * 0.72
  + sin( undergrowthWindTime * 2.63 + undergrowthWindPhase * 1.9 ) * 0.28;
float undergrowthWindJitter = sin(
  undergrowthWindTime * 2.7 + aAnchorPos.z * 1.7 + aAnchorPos.x * 1.3
) * 0.12;
float undergrowthWindBend = ( undergrowthWindGust + undergrowthWindJitter )
  * uUndergrowthWindStrength * ${cacheAmplitude} * aRootWeight;
${leafFlutterAmplitude === undefined ? `
transformed.x += aWindVec.x * undergrowthWindBend;
transformed.z += aWindVec.z * undergrowthWindBend;` : `
float undergrowthLeafFlutterTime = undergrowthWindTime * 5.2
  + aLeafPhase * ${DOGWOOD_LEAF_PHASE_MULTIPLIER.toFixed(1)};
float undergrowthLeafTip = uv.y * uv.y;
float undergrowthLeafGate = clamp( aRootWeight * ${DOGWOOD_LEAF_WEIGHT_GATE.toFixed(1)}, 0.0, 1.0 );
float undergrowthLeafScale = uUndergrowthWindStrength
  * ${leafFlutterAmplitude.toFixed(3)} * aLeafPhase
  * undergrowthLeafTip * undergrowthLeafGate;
float undergrowthLeafLongitudinal = sin( undergrowthLeafFlutterTime )
  * undergrowthLeafScale;
float undergrowthLeafVertical = sin( undergrowthLeafFlutterTime * 1.31 )
  * 0.6 * undergrowthLeafScale;
float undergrowthLeafLateral = sin( undergrowthLeafFlutterTime * 0.77 )
  * undergrowthLeafScale;
float undergrowthLeafAlong = undergrowthWindBend + undergrowthLeafLongitudinal;
transformed.x += aWindVec.x * undergrowthLeafAlong
  - aWindVec.z * undergrowthLeafLateral;
transformed.y += undergrowthLeafVertical
  / max( length( instanceMatrix[1].xyz ), 0.0001 );
transformed.z += aWindVec.z * undergrowthLeafAlong
  + aWindVec.x * undergrowthLeafLateral;`}`,
    );
  });
  material.needsUpdate = true;
}

function applyUndergrowthNodeSnow(
  material: THREE.Material,
  baseSurface: TslNode,
  baseAlpha: TslNode,
): void {
  const target = material as THREE.Material & {
    colorNode?: unknown;
    thicknessColorNode?: TslNode;
  };
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
    .mul(0.58);
  target.colorNode = tsl.vec4(
    tsl.mix(baseSurface, tsl.vec3(0.92, 0.955, 0.98), snowAmount),
    baseAlpha,
  );
  if (target.thicknessColorNode) {
    target.thicknessColorNode = target.thicknessColorNode.mul(
      tsl.float(1).sub(snowAmount.mul(0.82)),
    );
  }
  material.userData.forestSnowCoverage = snowCoverage;
}

function applyUndergrowthWebGLSeasonAndSnow(
  material: THREE.MeshStandardMaterial,
  palette: UndergrowthSeasonalPalette,
): void {
  const spring = { value: 0 };
  const autumn = { value: 0 };
  const dormancy = { value: 0 };
  const snowCoverage = { value: 0 };
  material.userData.forestSeasonalSpringFlush = spring;
  material.userData.forestSeasonalAutumnColor = autumn;
  material.userData.forestSeasonalDormancy = dormancy;
  material.userData.forestSnowCoverage = snowCoverage;
  const paletteKey = [
    ...palette.spring,
    ...palette.autumn,
    ...palette.dormant,
    palette.springBlend,
    palette.autumnBlend,
    palette.dormantBlend,
    palette.winterRetention,
    palette.snowBlend,
  ].map((value) => value.toFixed(3)).join('-');
  chainMaterialShaderPatch(material, `seedthree-undergrowth-season-snow-v2-${paletteKey}`, (shader) => {
    shader.uniforms.uUndergrowthSpring = spring;
    shader.uniforms.uUndergrowthAutumn = autumn;
    shader.uniforms.uUndergrowthDormancy = dormancy;
    shader.uniforms.uUndergrowthSnowCoverage = snowCoverage;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'varying float vUndergrowthSnowExposure;',
        'varying vec2 vUndergrowthSnowWorldXZ;',
      ].join('\n'),
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <defaultnormal_vertex>',
      [
        '#include <defaultnormal_vertex>',
        'vec3 undergrowthSnowWorldNormal = normalize(',
        '  inverseTransformDirection( transformedNormal, viewMatrix )',
        ');',
        'vUndergrowthSnowExposure = smoothstep( 0.18, 0.84, undergrowthSnowWorldNormal.y );',
      ].join('\n'),
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      [
        'vec4 undergrowthSnowObjectPosition = vec4( transformed, 1.0 );',
        '#ifdef USE_INSTANCING',
        'undergrowthSnowObjectPosition = instanceMatrix * undergrowthSnowObjectPosition;',
        '#endif',
        'vUndergrowthSnowWorldXZ = ( modelMatrix * undergrowthSnowObjectPosition ).xz;',
        '#include <project_vertex>',
      ].join('\n'),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'uniform float uUndergrowthSpring;',
        'uniform float uUndergrowthAutumn;',
        'uniform float uUndergrowthDormancy;',
        'uniform float uUndergrowthSnowCoverage;',
        'varying float vUndergrowthSnowExposure;',
        'varying vec2 vUndergrowthSnowWorldXZ;',
      ].join('\n'),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      [
        '#include <map_fragment>',
        'float undergrowthValue = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );',
        `vec3 undergrowthSpring = clamp( vec3( ${palette.spring.join(', ')} ) * undergrowthValue * 1.34, 0.0, 1.0 );`,
        `vec3 undergrowthAutumn = clamp( vec3( ${palette.autumn.join(', ')} ) * undergrowthValue * 1.62, 0.0, 1.0 );`,
        `vec3 undergrowthDormant = clamp( vec3( ${palette.dormant.join(', ')} ) * undergrowthValue * 1.68, 0.0, 1.0 );`,
        `diffuseColor.rgb = mix( diffuseColor.rgb, undergrowthSpring, uUndergrowthSpring * ${palette.springBlend.toFixed(3)} );`,
        `diffuseColor.rgb = mix( diffuseColor.rgb, undergrowthAutumn, uUndergrowthAutumn * ${palette.autumnBlend.toFixed(3)} );`,
        `diffuseColor.rgb = mix( diffuseColor.rgb, undergrowthDormant, uUndergrowthDormancy * ${palette.dormantBlend.toFixed(3)} );`,
        `diffuseColor.a *= 1.0 - uUndergrowthDormancy * ${(1 - palette.winterRetention).toFixed(3)};`,
      ].join('\n'),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      [
        '#include <color_fragment>',
        'float undergrowthSnowVariation = sin(',
        '  vUndergrowthSnowWorldXZ.x * 0.81 + vUndergrowthSnowWorldXZ.y * 1.13',
        ') * 0.12 + 0.88;',
        'float undergrowthSnowAmount = uUndergrowthSnowCoverage',
        `  * vUndergrowthSnowExposure * undergrowthSnowVariation * ${palette.snowBlend.toFixed(3)};`,
        'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.955, 0.98 ), undergrowthSnowAmount );',
      ].join('\n'),
    );
  });
  material.needsUpdate = true;
}

function applyUndergrowthWebGLSnow(material: THREE.MeshStandardMaterial): void {
  const snowCoverage = { value: 0 };
  material.userData.forestSnowCoverage = snowCoverage;
  chainMaterialShaderPatch(material, 'seedthree-undergrowth-snow-v1', (shader) => {
    shader.uniforms.uUndergrowthSnowCoverage = snowCoverage;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'varying float vUndergrowthSnowExposure;',
        'varying vec2 vUndergrowthSnowWorldXZ;',
      ].join('\n'),
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <defaultnormal_vertex>',
      [
        '#include <defaultnormal_vertex>',
        'vec3 undergrowthSnowWorldNormal = normalize(',
        '  inverseTransformDirection( transformedNormal, viewMatrix )',
        ');',
        'vUndergrowthSnowExposure = smoothstep( 0.18, 0.84, undergrowthSnowWorldNormal.y );',
      ].join('\n'),
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      [
        'vec4 undergrowthSnowObjectPosition = vec4( transformed, 1.0 );',
        '#ifdef USE_INSTANCING',
        'undergrowthSnowObjectPosition = instanceMatrix * undergrowthSnowObjectPosition;',
        '#endif',
        'vUndergrowthSnowWorldXZ = ( modelMatrix * undergrowthSnowObjectPosition ).xz;',
        '#include <project_vertex>',
      ].join('\n'),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'uniform float uUndergrowthSnowCoverage;',
        'varying float vUndergrowthSnowExposure;',
        'varying vec2 vUndergrowthSnowWorldXZ;',
      ].join('\n'),
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      [
        '#include <color_fragment>',
        'float undergrowthSnowVariation = sin(',
        '  vUndergrowthSnowWorldXZ.x * 0.81 + vUndergrowthSnowWorldXZ.y * 1.13',
        ') * 0.12 + 0.88;',
        'float undergrowthSnowAmount = uUndergrowthSnowCoverage',
        '  * vUndergrowthSnowExposure * undergrowthSnowVariation * 0.58;',
        'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.955, 0.98 ), undergrowthSnowAmount );',
      ].join('\n'),
    );
  });
  material.needsUpdate = true;
}

function setUndergrowthSeason(
  material: THREE.Material,
  presentation: DeciduousFoliagePresentation,
): boolean {
  let changed = false;
  changed = setSeasonUniform(material, 'forestSeasonalSpringFlush', presentation.springFlush) || changed;
  changed = setSeasonUniform(material, 'forestSeasonalAutumnColor', presentation.autumnColor) || changed;
  changed = setSeasonUniform(material, 'forestSeasonalDormancy', presentation.dormancy) || changed;
  return changed;
}

function setSeasonalFoliageVisibility(
  material: THREE.Material,
  visible: boolean,
): boolean {
  if (material.visible === visible) return false;
  material.visible = visible;
  return true;
}

function setUndergrowthShadowDormancy(
  buckets: ReadonlyArray<UndergrowthBucket>,
  dormancy: number,
  winterWidth: number,
): boolean {
  const width = THREE.MathUtils.lerp(1, winterWidth, dormancy);
  let changed = false;
  for (const bucket of buckets) {
    const geometry = bucket.shadowMesh.geometry;
    const previousWidth = Number(geometry.userData.seasonalShadowWidth ?? 1);
    if (Math.abs(previousWidth - width) <= 1e-6) continue;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const base = geometry.userData.seasonalShadowBasePositions as Float32Array | undefined;
    if (!base || base.length !== position.array.length) continue;
    for (let index = 0; index < position.count; index++) {
      const offset = index * 3;
      position.setXYZ(index, base[offset] * width, base[offset + 1], base[offset + 2] * width);
    }
    position.needsUpdate = true;
    geometry.userData.seasonalShadowWidth = width;
    geometry.computeBoundingSphere();
    changed = true;
  }
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

export function undergrowthPlacementClearanceRadius(
  placement: Pick<UndergrowthPlacement, 'kind' | 'scale'>,
): number {
  switch (placement.kind) {
    case 'bush':
      return THREE.MathUtils.clamp(placement.scale * 0.8, 0.65, 0.95);
    case 'fern':
      return THREE.MathUtils.clamp(placement.scale * 0.85, 0.75, 1.25);
    case 'juniper':
      return THREE.MathUtils.clamp(placement.scale * 1.55, 1.1, 2.5);
    case 'dogwood':
      return dogwoodFootprintClearanceForScale(placement.scale);
    default: {
      const exhaustive: never = placement.kind;
      return exhaustive;
    }
  }
}

export function dogwoodFootprintClearanceForScale(scale: number): number {
  const maturity = THREE.MathUtils.clamp(
    (scale - DOGWOOD_MIN_SCALE) / (DOGWOOD_MAX_SCALE - DOGWOOD_MIN_SCALE),
    0,
    1,
  );
  return THREE.MathUtils.lerp(
    DOGWOOD_MIN_FOOTPRINT_CLEARANCE,
    DOGWOOD_MAX_FOOTPRINT_CLEARANCE,
    Math.pow(maturity, 0.84),
  );
}

function isUndergrowthFootprintBlocked(
  x: number,
  z: number,
  footprintClearance: number,
  isBlockedAt: ((x: number, z: number) => boolean) | undefined,
): boolean {
  if (!isBlockedAt) return false;
  if (isBlockedAt(x, z)) return true;
  for (let sample = 0; sample < 8; sample++) {
    const angle = sample / 8 * TAU;
    if (isBlockedAt(
      x + Math.cos(angle) * footprintClearance,
      z + Math.sin(angle) * footprintClearance,
    )) return true;
  }
  return false;
}

function createUndergrowthStats(
  placements: UndergrowthPlacement[],
  buckets: Record<UndergrowthKind, UndergrowthBucket[]>,
): UndergrowthStats {
  const instancesByKind = Object.fromEntries(
    UNDERGROWTH_KINDS.map((kind) => [
      kind,
      placements.reduce((count, placement) => count + +(placement.kind === kind), 0),
    ]),
  ) as Record<UndergrowthKind, number>;
  let renderDrawCalls = 0;
  let shadowDrawCalls = 0;
  for (const kind of UNDERGROWTH_KINDS) {
    for (const bucket of buckets[kind]) {
      if (bucket.placements.length === 0) continue;
      renderDrawCalls += Math.max(1, bucket.mesh.geometry.groups.length);
      shadowDrawCalls += 1;
    }
  }
  const dogwoodHeights = placements
    .filter((placement) => placement.kind === 'dogwood')
    .map((placement) => placement.finalHeight ?? 0)
    .filter((height) => height > 0);
  const dogwoodBuckets = buckets.dogwood.filter((bucket) => bucket.placements.length > 0);
  const dogwoodLeafyDrawCalls = dogwoodBuckets.reduce(
    (sum, bucket) => sum + Math.max(1, bucket.mesh.geometry.groups.length) + 1,
    0,
  );
  return {
    instances: placements.length,
    instancesByKind,
    renderDrawCalls,
    shadowDrawCalls,
    maximumDrawCalls: renderDrawCalls + shadowDrawCalls,
    dogwood: {
      instances: instancesByKind.dogwood,
      minimumHeight: dogwoodHeights.length > 0 ? Math.min(...dogwoodHeights) : 0,
      maximumHeight: dogwoodHeights.length > 0 ? Math.max(...dogwoodHeights) : 0,
      leafyDrawCalls: dogwoodLeafyDrawCalls,
      // At full dormancy the leaf group is hidden, while the woody-stem group
      // and its narrowed seasonal shadow proxy remain.
      bareDrawCalls: dogwoodBuckets.length * 2,
    },
  };
}

export function undergrowthWindVecForYaw(yaw: number, scale: THREE.Vector3, out = windVecScratch): THREE.Vector3 {
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
    case 'dogwood':
      geometry.scale(1.12, 1.32, 1.12);
      geometry.translate(0, 0.78, 0);
      break;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
  if (kind !== 'juniper') {
    geometry.userData.seasonalShadowBasePositions = Float32Array.from(
      geometry.getAttribute('position').array,
    );
    geometry.userData.seasonalShadowWidth = 1;
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
