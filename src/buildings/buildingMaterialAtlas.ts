import * as THREE from 'three';
import * as TSL from 'three/tsl';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { loadBitmapTexture } from '../utils/textureLoad.ts';

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
  weatheringProfile?: 'tier1-daub' | 'tier1-fieldstone';
};

type TslNode = {
  a: TslNode;
  b: TslNode;
  g: TslNode;
  r: TslNode;
  rgb: TslNode;
  x: TslNode;
  y: TslNode;
  z: TslNode;
  add(value: unknown): TslNode;
  clamp(minimum?: unknown, maximum?: unknown): TslNode;
  mul(value: unknown): TslNode;
  sub(value: unknown): TslNode;
};

export type BuildingMaterialAtlasTextureSet = {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  material: THREE.Texture;
};

const tsl = TSL as unknown as {
  float(value: unknown): TslNode;
  fract(value: unknown): TslNode;
  mix(left: unknown, right: unknown, amount: unknown): TslNode;
  normalMap(value: unknown, scale?: unknown): TslNode;
  positionLocal: TslNode;
  sin(value: unknown): TslNode;
  smoothstep(edge0: unknown, edge1: unknown, value: unknown): TslNode;
  texture(texture: THREE.Texture, uvNode?: unknown): TslNode;
  uniform<T>(value: T): TslNode;
  uv(): TslNode;
  vec2(x: unknown, y?: unknown): TslNode;
  vec3(x: unknown, y?: unknown, z?: unknown): TslNode;
  vec4(x: unknown, y?: unknown, z?: unknown, w?: unknown): TslNode;
  vertexColor(index?: number): TslNode;
};

export const BUILDING_MATERIAL_ATLAS_ROOT =
  '/assets/textures/buildings/gorski_building_atlas_v1';
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

let atlasTextures: BuildingMaterialAtlasTextureSet | null = null;
let atlasLoadPromise: Promise<void> | null = null;
let atlasLoaded = false;

/** Stable handles shared by every material that samples the packed atlas. */
export function getBuildingMaterialAtlasTextures(): BuildingMaterialAtlasTextureSet {
  if (!atlasTextures) {
    atlasTextures = {
      albedo: createAtlasTextureHandle(true),
      normal: createAtlasTextureHandle(false),
      material: createAtlasTextureHandle(false),
    };
  }
  return atlasTextures;
}

export async function initializeBuildingMaterialAtlas(
  maxAnisotropy = 8,
  preloadTexture?: (texture: THREE.Texture) => void,
): Promise<void> {
  if (atlasLoaded) {
    preloadAtlasTextures(getBuildingMaterialAtlasTextures(), preloadTexture);
    return;
  }
  if (atlasLoadPromise) {
    await atlasLoadPromise;
    if (atlasLoaded) {
      preloadAtlasTextures(getBuildingMaterialAtlasTextures(), preloadTexture);
    }
    return;
  }
  const sharedTextures = getBuildingMaterialAtlasTextures();
  const anisotropy = Math.max(1, Math.min(8, maxAnisotropy));
  atlasLoadPromise = Promise.all([
    loadBitmapTexture(`${BUILDING_MATERIAL_ATLAS_ROOT}/building_albedo_atlas.png`, anisotropy, {
      srgb: true,
      wrapping: THREE.ClampToEdgeWrapping,
      anisotropyLimit: 8,
    }),
    loadBitmapTexture(`${BUILDING_MATERIAL_ATLAS_ROOT}/building_normal_atlas.png`, anisotropy, {
      wrapping: THREE.ClampToEdgeWrapping,
      anisotropyLimit: 8,
    }),
    loadBitmapTexture(`${BUILDING_MATERIAL_ATLAS_ROOT}/building_material_atlas.png`, anisotropy, {
      wrapping: THREE.ClampToEdgeWrapping,
      anisotropyLimit: 8,
    }),
  ]).then(([albedo, normal, material]) => {
    hydrateAtlasTexture(sharedTextures.albedo, albedo, 'Gorski building atlas v1 albedo');
    hydrateAtlasTexture(sharedTextures.normal, normal, 'Gorski building atlas v1 normal');
    hydrateAtlasTexture(
      sharedTextures.material,
      material,
      'Gorski building atlas v1 roughness-metalness-AO-height',
    );
    atlasLoaded = true;
    preloadAtlasTextures(sharedTextures, preloadTexture);
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
  const textures = getBuildingMaterialAtlasTextures();
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
  const weathered = applyAtlasWeathering(tinted, options);
  const vertexTint = material.vertexColors ? tsl.vertexColor().rgb : tsl.vec3(1);
  material.colorNode = tsl.vec4(
    weathered.mul(vertexTint),
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
}

/** Samples authored UVs that already point at their final atlas pixels. */
export function applyBuildingMaterialAtlasDirectUv(
  material: BuildingAtlasMaterial,
  options: BuildingMaterialAtlasOptions,
): void {
  material.userData.buildingMaterialAtlas = 'gorski-building-atlas-v1';
  material.userData.buildingMaterialAtlasTile = options.tile;
  material.userData.buildingMaterialAtlasUvMode = 'direct';
  const textures = getBuildingMaterialAtlasTextures();
  // The source UVs are baked in Blender's bottom-up convention, while the
  // shared Three texture retains flipY=true during bitmap hydration. Mirror
  // direct coordinates once so the live sampler reaches split-shingles.
  const authoredUv = tsl.uv();
  const atlasUv = tsl.vec2(authoredUv.x, tsl.float(1).sub(authoredUv.y));
  const albedo = tsl.texture(textures.albedo, atlasUv);
  const packed = tsl.texture(textures.material, atlasUv);
  const tint = tsl.uniform(material.color.clone());
  const tinted = albedo.rgb.mul(tsl.mix(
    tsl.vec3(1),
    tint,
    THREE.MathUtils.clamp(options.tintStrength ?? 0.25, 0, 1),
  ));
  const weathered = applyAtlasWeathering(tinted, options);
  const vertexTint = material.vertexColors ? tsl.vertexColor().rgb : tsl.vec3(1);
  material.colorNode = tsl.vec4(
    weathered.mul(vertexTint),
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
  material.map = textures.albedo;
  material.normalMap = textures.normal;
  material.roughnessMap = textures.material;
  material.metalnessMap = textures.material;
  material.aoMap = textures.material;
  material.needsUpdate = true;
}

function applyAtlasWeathering(
  baseColor: TslNode,
  options: BuildingMaterialAtlasOptions,
): TslNode {
  const profile = options.weatheringProfile;
  if (!profile) return baseColor;

  // A stable object-local field recreates the broad, bottom-biased staining
  // used by the Blender preview without allocating another texture per house.
  const position = tsl.positionLocal;
  const broad = tsl.sin(
    position.x.mul(1.73)
      .add(position.z.mul(1.19))
      .add(position.y.mul(0.47)),
  ).mul(0.5).add(0.5);
  const detail = tsl.sin(
    position.x.mul(3.91)
      .sub(position.z.mul(2.37))
      .add(position.y.mul(1.11))
      .add(1.7),
  ).mul(0.5).add(0.5);
  const mottling = broad.mul(0.72).add(detail.mul(0.28)).clamp(0, 1);
  const lowerWall = tsl.float(1).sub(tsl.smoothstep(
    profile === 'tier1-daub' ? 0.18 : 0.02,
    profile === 'tier1-daub' ? 1.85 : 0.46,
    position.y,
  ));
  const mask = mottling.mul(
    lowerWall.mul(profile === 'tier1-daub' ? 0.58 : 0.66)
      .add(profile === 'tier1-daub' ? 0.08 : 0.14),
  ).clamp(0, profile === 'tier1-daub' ? 0.52 : 0.64);
  const stain = profile === 'tier1-daub'
    ? tsl.vec3(0.24, 0.15, 0.08)
    : tsl.vec3(0.13, 0.12, 0.095);
  return baseColor.mul(tsl.mix(tsl.vec3(1), stain, mask));
}

export function disposeBuildingMaterialAtlas(): void {
  if (atlasTextures) {
    atlasTextures.albedo.dispose();
    atlasTextures.normal.dispose();
    atlasTextures.material.dispose();
  }
  atlasTextures = null;
  atlasLoadPromise = null;
  atlasLoaded = false;
}

export function getBuildingMaterialAtlasStats(): {
  loaded: boolean;
  textures: number;
  tiles: number;
  dimensions: readonly [number, number];
} {
  return {
    loaded: atlasLoaded,
    textures: atlasLoaded ? 3 : 0,
    tiles: TILE_ORDER.length,
    dimensions: [ATLAS_WIDTH, ATLAS_HEIGHT],
  };
}

function preloadAtlasTextures(
  textures: BuildingMaterialAtlasTextureSet,
  preloadTexture?: (texture: THREE.Texture) => void,
): void {
  if (!preloadTexture) return;
  preloadTexture(textures.albedo);
  preloadTexture(textures.normal);
  preloadTexture(textures.material);
}

function createAtlasTextureHandle(srgb: boolean): THREE.Texture {
  const texture = new THREE.Texture();
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function hydrateAtlasTexture(
  target: THREE.Texture,
  source: THREE.Texture,
  name: string,
): void {
  target.copy(source);
  target.name = name;
  target.needsUpdate = true;
  source.dispose();
}
