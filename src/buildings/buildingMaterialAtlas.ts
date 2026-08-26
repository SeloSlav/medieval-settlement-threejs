import * as THREE from 'three';
import * as TSL from 'three/tsl';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { loadBitmapTexture } from '../utils/textureLoad.ts';
import { mutatePainterlyMaterialSource } from '../vegetation/painterly/painterlyVegetationMaterial.ts';

/**
 * Three's public WebGPU declaration omits several classic standard-material
 * fields that exist on MeshStandardNodeMaterial at runtime. The intersection
 * keeps both the node recipe and the established building-material API typed.
 */
export type BuildingAtlasMaterial = MeshStandardNodeMaterial & THREE.MeshStandardMaterial;

export type BuildingMaterialAtlasTile =
  | 'lime-plaster'
  | 'limestone-ashlar'
  | 'fieldstone-mortar'
  | 'quarry-stone'
  | 'rough-hewn-timber'
  | 'sawn-planks'
  | 'weathered-planks'
  | 'stacked-log-wall'
  | 'wicker-weave'
  | 'split-shingles'
  | 'clay-roof-tiles'
  | 'thatch-roof'
  | 'slate-roof'
  | 'packed-earth'
  | 'linen-canvas'
  | 'wrought-iron'
  | 'aged-brass'
  | 'fired-clay'
  | 'mossy-surface'
  | 'turf-roof';

export type BuildingMaterialAtlasOptions = {
  tile: BuildingMaterialAtlasTile;
  tintStrength?: number;
  normalStrength?: number;
  roughnessWeight?: number;
  metalnessWeight?: number;
  aoStrength?: number;
};

type TslNode = {
  a: TslNode;
  b: TslNode;
  g: TslNode;
  r: TslNode;
  rgb: TslNode;
  x: TslNode;
  y: TslNode;
  add(value: unknown): TslNode;
  clamp(minimum?: unknown, maximum?: unknown): TslNode;
  mul(value: unknown): TslNode;
};

type AtlasTextureSet = {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  material: THREE.Texture;
};

const tsl = TSL as unknown as {
  float(value: unknown): TslNode;
  fract(value: unknown): TslNode;
  mix(left: unknown, right: unknown, amount: unknown): TslNode;
  normalMap(value: unknown, scale?: unknown): TslNode;
  texture(texture: THREE.Texture, uvNode?: unknown): TslNode;
  uniform<T>(value: T): TslNode;
  uv(): TslNode;
  vec2(x: unknown, y?: unknown): TslNode;
  vec3(x: unknown, y?: unknown, z?: unknown): TslNode;
  vec4(x: unknown, y?: unknown, z?: unknown, w?: unknown): TslNode;
  vertexColor(index?: number): TslNode;
};

const ATLAS_ROOT = '/assets/textures/buildings/gorski_building_atlas_v1';
const ATLAS_COLUMNS = 5;
const ATLAS_ROWS = 4;
const ATLAS_CELL_SIZE = 512;
const ATLAS_GUTTER = 32;
const ATLAS_CONTENT_SIZE = ATLAS_CELL_SIZE - ATLAS_GUTTER * 2;
const ATLAS_WIDTH = ATLAS_COLUMNS * ATLAS_CELL_SIZE;
const ATLAS_HEIGHT = ATLAS_ROWS * ATLAS_CELL_SIZE;

const TILE_ORDER: readonly BuildingMaterialAtlasTile[] = [
  'lime-plaster',
  'limestone-ashlar',
  'fieldstone-mortar',
  'quarry-stone',
  'rough-hewn-timber',
  'sawn-planks',
  'weathered-planks',
  'stacked-log-wall',
  'wicker-weave',
  'split-shingles',
  'clay-roof-tiles',
  'thatch-roof',
  'slate-roof',
  'packed-earth',
  'linen-canvas',
  'wrought-iron',
  'aged-brass',
  'fired-clay',
  'mossy-surface',
  'turf-roof',
] as const;

export const BUILDING_MATERIAL_ATLAS_TILES = Object.freeze([...TILE_ORDER]);

let atlasTextures: AtlasTextureSet | null = null;
let atlasLoadPromise: Promise<void> | null = null;

export async function initializeBuildingMaterialAtlas(
  maxAnisotropy = 8,
  preloadTexture?: (texture: THREE.Texture) => void,
): Promise<void> {
  if (atlasTextures) {
    preloadAtlasTextures(atlasTextures, preloadTexture);
    return;
  }
  if (atlasLoadPromise) {
    await atlasLoadPromise;
    if (atlasTextures) preloadAtlasTextures(atlasTextures, preloadTexture);
    return;
  }
  const anisotropy = Math.max(1, Math.min(8, maxAnisotropy));
  atlasLoadPromise = Promise.all([
    loadBitmapTexture(`${ATLAS_ROOT}/building_albedo_atlas.png`, anisotropy, {
      srgb: true,
      wrapping: THREE.ClampToEdgeWrapping,
      anisotropyLimit: 8,
    }),
    loadBitmapTexture(`${ATLAS_ROOT}/building_normal_atlas.png`, anisotropy, {
      wrapping: THREE.ClampToEdgeWrapping,
      anisotropyLimit: 8,
    }),
    loadBitmapTexture(`${ATLAS_ROOT}/building_material_atlas.png`, anisotropy, {
      wrapping: THREE.ClampToEdgeWrapping,
      anisotropyLimit: 8,
    }),
  ]).then(([albedo, normal, material]) => {
    albedo.name = 'Gorski building atlas v1 albedo';
    normal.name = 'Gorski building atlas v1 normal';
    material.name = 'Gorski building atlas v1 roughness-metalness-AO-height';
    atlasTextures = { albedo, normal, material };
    preloadAtlasTextures(atlasTextures, preloadTexture);
  }).catch((error) => {
    atlasLoadPromise = null;
    throw error;
  });
  await atlasLoadPromise;
}

export function applyBuildingMaterialAtlas(
  material: BuildingAtlasMaterial,
  options: BuildingMaterialAtlasOptions,
): void {
  material.userData.buildingMaterialAtlas = 'gorski-building-atlas-v1';
  material.userData.buildingMaterialAtlasTile = options.tile;
  if (!atlasTextures) return;
  const textures = atlasTextures;
  mutatePainterlyMaterialSource(material, () => {
    const index = TILE_ORDER.indexOf(options.tile);
    if (index < 0) throw new Error(`Unknown building material atlas tile: ${options.tile}`);
    const column = index % ATLAS_COLUMNS;
    const rowTopToBottom = Math.floor(index / ATLAS_COLUMNS);
    // TSL texture UVs address v=0 at the bitmap's bottom. The packed manifest
    // is deliberately human-readable top-to-bottom, so invert only the row.
    const textureRow = ATLAS_ROWS - 1 - rowTopToBottom;
    const localUv = tsl.fract(tsl.uv());
    const atlasUv = tsl.vec2(
      localUv.x
        .mul(ATLAS_CONTENT_SIZE / ATLAS_WIDTH)
        .add((column * ATLAS_CELL_SIZE + ATLAS_GUTTER) / ATLAS_WIDTH),
      localUv.y
        .mul(ATLAS_CONTENT_SIZE / ATLAS_HEIGHT)
        .add((textureRow * ATLAS_CELL_SIZE + ATLAS_GUTTER) / ATLAS_HEIGHT),
    );
    const albedo = tsl.texture(textures.albedo, atlasUv);
    const packed = tsl.texture(textures.material, atlasUv);
    const tint = tsl.uniform(material.color.clone());
    const tinted = albedo.rgb.mul(tsl.mix(
      tsl.vec3(1),
      tint,
      THREE.MathUtils.clamp(options.tintStrength ?? 0.25, 0, 1),
    ));
    const vertexTint = material.vertexColors ? tsl.vertexColor().rgb : tsl.vec3(1);
    material.colorNode = tsl.vec4(
      tinted.mul(vertexTint),
      tsl.float(material.opacity),
    ) as never;
    const normalStrength = Math.max(0, options.normalStrength ?? material.normalScale.x);
    material.normalNode = tsl.normalMap(
      tsl.texture(textures.normal, atlasUv),
      tsl.vec2(normalStrength, normalStrength),
    ) as never;
    material.roughnessNode = tsl.mix(
      tsl.float(material.roughness),
      packed.r,
      THREE.MathUtils.clamp(options.roughnessWeight ?? 0.82, 0, 1),
    ).clamp(0.2, 1) as never;
    (material as BuildingAtlasMaterial & { metalnessNode: unknown }).metalnessNode = tsl.mix(
      tsl.float(material.metalness),
      packed.g,
      THREE.MathUtils.clamp(options.metalnessWeight ?? 0.9, 0, 1),
    ).clamp(0, 1) as never;
    material.aoNode = tsl.mix(
      tsl.float(1),
      packed.b,
      THREE.MathUtils.clamp(options.aoStrength ?? 0.56, 0, 1),
    ) as never;
    // The map binding is retained as an asynchronous-hydration signature and
    // a conventional material-inspection breadcrumb. colorNode owns sampling.
    material.map = textures.albedo;
    material.normalMap = textures.normal;
    material.roughnessMap = textures.material;
    material.metalnessMap = textures.material;
    material.aoMap = textures.material;
    material.needsUpdate = true;
  });
}

export function disposeBuildingMaterialAtlas(): void {
  if (atlasTextures) {
    atlasTextures.albedo.dispose();
    atlasTextures.normal.dispose();
    atlasTextures.material.dispose();
  }
  atlasTextures = null;
  atlasLoadPromise = null;
}

export function getBuildingMaterialAtlasStats(): {
  loaded: boolean;
  textures: number;
  tiles: number;
  dimensions: readonly [number, number];
} {
  return {
    loaded: atlasTextures !== null,
    textures: atlasTextures ? 3 : 0,
    tiles: TILE_ORDER.length,
    dimensions: [ATLAS_WIDTH, ATLAS_HEIGHT],
  };
}

function preloadAtlasTextures(
  textures: AtlasTextureSet,
  preloadTexture?: (texture: THREE.Texture) => void,
): void {
  if (!preloadTexture) return;
  preloadTexture(textures.albedo);
  preloadTexture(textures.normal);
  preloadTexture(textures.material);
}
