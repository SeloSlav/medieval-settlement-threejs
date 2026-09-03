import * as THREE from 'three';
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { prepareBuildingGeometryUvs } from './buildingMetricUvs.ts';
import {
  applyBuildingMaterialAtlas,
  disposeBuildingMaterialAtlas,
  getBuildingMaterialAtlasStats,
  initializeBuildingMaterialAtlas,
  type BuildingAtlasMaterial,
  type BuildingMaterialAtlasTile,
} from './buildingMaterialAtlas.ts';
import { disposeSharedWellWaterMaterial } from './WellWaterMaterial.ts';
import {
  applyCampHideSurface,
  CAMP_HIDE_METERS_PER_REPEAT,
  disposeCampHideSurface,
  getCampHideSurfaceStats,
  initializeCampHideSurface,
} from './campHideSurface.ts';

export const GORSKI_PALETTE = {
  stoneWhite: 0xe6dfd0,
  stoneWhiteShadow: 0xcbc3b4,
  stoneMortar: 0xb8b0a2,
  timberDark: 0x4f3828,
  timberMid: 0x6b4e38,
  timberLight: 0x8a684c,
  timberWeathered: 0x7a5e46,
  tileRed: 0xa83f32,
  tileRedDark: 0x8a3228,
  tileRedHighlight: 0xc04a3a,
  shingleWood: 0x5c4636,
  shingleAged: 0x4a382c,
  thatch: 0x8f928c,
  moss: 0x4d6b3c,
  grassRoof: 0x5f7a44,
  mossDark: 0x3d5530,
  interiorDark: 0x1a1410,
} as const;

/**
 * Atlas tint ownership for the complete construction-timber vocabulary.
 *
 * The source atlas deliberately carries grain, knots, silvering, and wear,
 * while these shared colours keep every generator inside one regional brown
 * timber family.  Weathered boards need the strongest tint because their
 * source tile is intentionally silver-grey; without it, crates, fences,
 * chests, troughs, and exterior boarding read as painted white wood.
 */
export const GORSKI_TIMBER_TINT_STRENGTHS = {
  dark: 0.72,
  mid: 0.58,
  light: 0.58,
  weathered: 0.9,
  stacked: 0.62,
} as const;

export const RESIDENCE_FACADE_PALETTE = {
  white: 0xe8e2d8,
  yellow: 0xccb860,
  grey: 0x8a8580,
  lightOrange: 0xcc9858,
  orange: 0xbf7038,
} as const;

export const RESIDENCE_ROOF_PALETTE = {
  red: GORSKI_PALETTE.tileRed,
  brown: GORSKI_PALETTE.shingleWood,
  grey: 0x6a6662,
  slate: 0x454a50,
} as const;

export const RESIDENCE_ROOF_SPECS = {
  red: { roughness: 0.82, metalness: 0.02 },
  brown: { roughness: 0.92, metalness: 0 },
  grey: { roughness: 0.92, metalness: 0 },
  slate: { roughness: 0.88, metalness: 0.04 },
} as const;

export type ResidenceFacadeColor = keyof typeof RESIDENCE_FACADE_PALETTE;
export type ResidenceRoofColor = keyof typeof RESIDENCE_ROOF_PALETTE;

/** Weathered grey quarry stone — distinct from bright Gorski limestone on mills/huts. */
export const QUARRY_ROCK_PALETTE = {
  dark: 0x52565c,
  mid: 0x6b7078,
  light: 0x828890,
  cut: 0x5e636a,
  dust: 0x6a6660,
  spoil: 0x5c5854,
} as const;

type TextureFamily = 'plaster' | 'masonry' | 'clayTiles' | 'woodPlanks';

/**
 * The complete shared construction palette. Keeping this list deliberately
 * small lets every building reuse the same renderer programs, material state,
 * and texture objects while tinting a few culturally consistent variants.
 */
export type BuildingMaterialKey =
  | 'plasterWhite'
  | 'plasterYellow'
  | 'plasterGrey'
  | 'plasterOrange'
  | 'masonryLight'
  | 'masonryMid'
  | 'masonryDark'
  | 'timberDark'
  | 'timberMid'
  | 'timberLight'
  | 'timberWeathered'
  | 'stackedTimber'
  | 'clayRed'
  | 'clayDark'
  | 'shingle'
  | 'thatch'
  | 'slate'
  | 'metalIron'
  | 'glass'
  | 'moss'
  | 'grassRoof'
  | 'interiorDark';

type MaterialDefinition = {
  color: number;
  roughness: number;
  metalness: number;
  atlasTile?: BuildingMaterialAtlasTile;
  atlasMetersPerTile?: number;
  atlasTintStrength?: number;
  textureFamily?: TextureFamily;
  normalScale?: number;
  weathering?: BuildingWeatheringProfile;
  useDiffuseMap?: boolean;
  uniformIndirectLight?: boolean;
};

type BuildingWeatheringProfile =
  | 'plaster'
  | 'masonry'
  | 'timber'
  | 'roof'
  | 'shingle'
  | 'thatch';

const MATERIAL_DEFINITIONS: Record<BuildingMaterialKey, MaterialDefinition> = {
  plasterWhite: { color: 0xfff4de, roughness: 0.96, metalness: 0, atlasTile: 'lime-plaster', atlasMetersPerTile: 2.6, atlasTintStrength: 0.18, textureFamily: 'plaster', normalScale: 0.3, weathering: 'plaster', useDiffuseMap: false, uniformIndirectLight: true },
  plasterYellow: { color: 0xeadc9f, roughness: 0.93, metalness: 0, atlasTile: 'lime-plaster', atlasMetersPerTile: 2.6, atlasTintStrength: 0.48, textureFamily: 'plaster', normalScale: 0.42, weathering: 'plaster' },
  plasterGrey: { color: 0xb8b4af, roughness: 0.94, metalness: 0, atlasTile: 'lime-plaster', atlasMetersPerTile: 2.6, atlasTintStrength: 0.42, textureFamily: 'plaster', normalScale: 0.46, weathering: 'plaster' },
  plasterOrange: { color: 0xe6b17e, roughness: 0.93, metalness: 0, atlasTile: 'lime-plaster', atlasMetersPerTile: 2.6, atlasTintStrength: 0.5, textureFamily: 'plaster', normalScale: 0.44, weathering: 'plaster' },
  masonryLight: { color: 0xf3eadb, roughness: 0.96, metalness: 0, atlasTile: 'limestone-ashlar', atlasMetersPerTile: 2.4, atlasTintStrength: 0.16, textureFamily: 'masonry', normalScale: 0.76, weathering: 'masonry', uniformIndirectLight: true },
  masonryMid: { color: 0xd8d0c2, roughness: 0.97, metalness: 0, atlasTile: 'fieldstone-mortar', atlasMetersPerTile: 2.4, atlasTintStrength: 0.2, textureFamily: 'masonry', normalScale: 0.82, weathering: 'masonry', uniformIndirectLight: true },
  masonryDark: { color: 0x858688, roughness: 0.98, metalness: 0, atlasTile: 'quarry-stone', atlasMetersPerTile: 2.4, atlasTintStrength: 0.36, textureFamily: 'masonry', normalScale: 0.82, weathering: 'masonry' },
  timberDark: { color: GORSKI_PALETTE.timberDark, roughness: 0.94, metalness: 0, atlasTile: 'rough-hewn-timber', atlasMetersPerTile: 2, atlasTintStrength: GORSKI_TIMBER_TINT_STRENGTHS.dark, textureFamily: 'woodPlanks', normalScale: 0.76, weathering: 'timber', uniformIndirectLight: true },
  timberMid: { color: GORSKI_PALETTE.timberMid, roughness: 0.9, metalness: 0, atlasTile: 'rough-hewn-timber', atlasMetersPerTile: 2, atlasTintStrength: GORSKI_TIMBER_TINT_STRENGTHS.mid, textureFamily: 'woodPlanks', normalScale: 0.58, weathering: 'timber' },
  timberLight: { color: GORSKI_PALETTE.timberLight, roughness: 0.9, metalness: 0, atlasTile: 'sawn-planks', atlasMetersPerTile: 2, atlasTintStrength: GORSKI_TIMBER_TINT_STRENGTHS.light, textureFamily: 'woodPlanks', normalScale: 0.55, weathering: 'timber' },
  timberWeathered: { color: GORSKI_PALETTE.timberWeathered, roughness: 0.96, metalness: 0, atlasTile: 'weathered-planks', atlasMetersPerTile: 2, atlasTintStrength: GORSKI_TIMBER_TINT_STRENGTHS.weathered, textureFamily: 'woodPlanks', normalScale: 0.86, weathering: 'timber', uniformIndirectLight: true },
  stackedTimber: { color: GORSKI_PALETTE.timberMid, roughness: 0.95, metalness: 0, atlasTile: 'stacked-log-wall', atlasMetersPerTile: 2, atlasTintStrength: GORSKI_TIMBER_TINT_STRENGTHS.stacked, textureFamily: 'woodPlanks', normalScale: 0.76, weathering: 'timber', uniformIndirectLight: true },
  clayRed: { color: 0xffffff, roughness: 0.84, metalness: 0.01, atlasTile: 'clay-roof-tiles', atlasMetersPerTile: 2.2, atlasTintStrength: 0, textureFamily: 'clayTiles', normalScale: 0.74, weathering: 'roof' },
  clayDark: { color: 0xc58f84, roughness: 0.88, metalness: 0.01, atlasTile: 'clay-roof-tiles', atlasMetersPerTile: 2.2, atlasTintStrength: 0.32, textureFamily: 'clayTiles', normalScale: 0.78, weathering: 'roof' },
  shingle: { color: 0x928e85, roughness: 0.99, metalness: 0, atlasTile: 'split-shingles', atlasMetersPerTile: 2.2, atlasTintStrength: 0.28, textureFamily: 'woodPlanks', normalScale: 1.05, weathering: 'shingle', useDiffuseMap: false, uniformIndirectLight: true },
  thatch: { color: GORSKI_PALETTE.thatch, roughness: 1, metalness: 0, atlasTile: 'thatch-roof', atlasMetersPerTile: 1.6, atlasTintStrength: 0.22, normalScale: 0.62, weathering: 'thatch', uniformIndirectLight: true },
  slate: { color: 0x737980, roughness: 0.91, metalness: 0.02, atlasTile: 'slate-roof', atlasMetersPerTile: 2.2, atlasTintStrength: 0.24, textureFamily: 'masonry', normalScale: 0.48, weathering: 'roof' },
  metalIron: { color: 0x4a4846, roughness: 0.55, metalness: 0.72, atlasTile: 'wrought-iron', atlasMetersPerTile: 1.2, atlasTintStrength: 0.18, normalScale: 0.54 },
  glass: { color: 0x3d4747, roughness: 0.4, metalness: 0.03 },
  moss: { color: GORSKI_PALETTE.moss, roughness: 0.98, metalness: 0, atlasTile: 'mossy-surface', atlasMetersPerTile: 1.4, atlasTintStrength: 0.28, normalScale: 0.55 },
  grassRoof: { color: GORSKI_PALETTE.grassRoof, roughness: 0.99, metalness: 0, atlasTile: 'turf-roof', atlasMetersPerTile: 1.4, atlasTintStrength: 0.24, normalScale: 0.54 },
  interiorDark: { color: GORSKI_PALETTE.interiorDark, roughness: 1, metalness: 0, atlasTile: 'rough-hewn-timber', atlasMetersPerTile: 2, atlasTintStrength: 0.82, normalScale: 0.34 },
};

const TEXTURE_METERS: Record<TextureFamily, number> = {
  plaster: 2.5,
  masonry: 2.4,
  clayTiles: 4,
  woodPlanks: 2,
};

const materialCache = new Map<BuildingMaterialKey, BuildingAtlasMaterial>();
const DEFAULT_BUILDING_INDIRECT_INTENSITY = 0.11;
let buildingIndirectIntensity = DEFAULT_BUILDING_INDIRECT_INTENSITY;
export type BuildingDetailMaterialKey =
  | 'brass'
  | 'firedClay'
  | 'wicker'
  | 'paintRed'
  | 'paintBlue'
  | 'paintOchre'
  | 'water'
  | 'smoke'
  | 'earth'
  | 'canvas'
  | 'hide'
  | 'foliage'
  | 'crop';

type DetailMaterialDefinition = Omit<THREE.MeshStandardMaterialParameters, 'normalScale'> & {
  atlasTile?: BuildingMaterialAtlasTile;
  atlasMetersPerTile?: number;
  atlasTintStrength?: number;
  textureFamily?: TextureFamily;
  buildingNormalScale?: number;
};

const DETAIL_MATERIAL_DEFINITIONS: Record<BuildingDetailMaterialKey, DetailMaterialDefinition> = {
  brass: { color: 0x9b7134, roughness: 0.48, metalness: 0.72, atlasTile: 'aged-brass', atlasMetersPerTile: 1.2, atlasTintStrength: 0.16, buildingNormalScale: 0.5 },
  firedClay: { color: 0xd47d50, roughness: 0.88, metalness: 0, atlasTile: 'fired-clay', atlasMetersPerTile: 1.2, atlasTintStrength: 0.2, buildingNormalScale: 0.55 },
  wicker: { color: 0xc19a69, roughness: 0.94, metalness: 0, atlasTile: 'wicker-weave', atlasMetersPerTile: 1.1, atlasTintStrength: 0.16, buildingNormalScale: 0.58 },
  paintRed: { color: 0xb75a4d, roughness: 0.89, metalness: 0, atlasTile: 'weathered-planks', atlasMetersPerTile: 2, atlasTintStrength: 0.72, textureFamily: 'woodPlanks', buildingNormalScale: 0.22 },
  paintBlue: { color: 0x668996, roughness: 0.9, metalness: 0, atlasTile: 'weathered-planks', atlasMetersPerTile: 2, atlasTintStrength: 0.72, textureFamily: 'woodPlanks', buildingNormalScale: 0.22 },
  paintOchre: { color: 0xd4ae62, roughness: 0.91, metalness: 0, atlasTile: 'weathered-planks', atlasMetersPerTile: 2, atlasTintStrength: 0.68, textureFamily: 'woodPlanks', buildingNormalScale: 0.22 },
  water: { color: 0x315868, roughness: 0.32, metalness: 0.04 },
  smoke: { color: 0x77736d, roughness: 1, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false },
  earth: { color: 0x6d5235, roughness: 1, metalness: 0, atlasTile: 'packed-earth', atlasMetersPerTile: 2, atlasTintStrength: 0.24, buildingNormalScale: 0.52 },
  canvas: { color: 0xc8b58d, roughness: 0.98, metalness: 0, atlasTile: 'linen-canvas', atlasMetersPerTile: 1.2, atlasTintStrength: 0.2, buildingNormalScale: 0.46, side: THREE.DoubleSide },
  hide: { color: 0xd0b395, roughness: 0.94, metalness: 0, atlasMetersPerTile: CAMP_HIDE_METERS_PER_REPEAT, side: THREE.DoubleSide },
  foliage: { color: 0x526f3b, roughness: 1, metalness: 0 },
  crop: { color: 0xb69a48, roughness: 1, metalness: 0 },
};

const detailMaterialCache = new Map<BuildingDetailMaterialKey, BuildingAtlasMaterial>();
let textureLoadPromise: Promise<void> | null = null;
let splitWoodShingleMap: THREE.DataTexture | null = null;

export function sharedBuildingMaterial(key: BuildingMaterialKey): BuildingAtlasMaterial {
  const cached = materialCache.get(key);
  if (cached) return cached;

  const definition = MATERIAL_DEFINITIONS[key];
  const material = new MeshStandardNodeMaterial() as BuildingAtlasMaterial;
  material.setValues({
    color: definition.color,
    roughness: definition.roughness,
    metalness: definition.metalness,
  });
  configureBuildingIndirectLight(material);
  material.name = `Shared building material: ${key}`;
  material.userData.sharedBuildingMaterial = true;
  material.userData.buildingMaterialKey = key;
  material.userData.buildingWeatheringProfile = definition.weathering;
  material.userData.buildingTextureFamily = definition.textureFamily;
  material.userData.buildingUsesDiffuseMap = definition.useDiffuseMap !== false;
  material.userData.buildingNormalScale = definition.normalScale ?? 1;
  material.userData.buildingUniformIndirectLight =
    definition.uniformIndirectLight === true;
  material.vertexColors = definition.weathering !== undefined;
  material.normalScale.setScalar(definition.normalScale ?? 1);
  if (definition.atlasMetersPerTile) {
    material.userData.metricUvMeters = definition.atlasMetersPerTile;
  } else if (definition.textureFamily) {
    material.userData.metricUvMeters = TEXTURE_METERS[definition.textureFamily];
  }
  if (key === 'shingle') configureSplitWoodShingleSurface(material);
  materialCache.set(key, material);
  applyTextureSet(material, definition);
  return material;
}

/**
 * Keeps outdoor building faces readable when they fall outside the direct sun.
 * The albedo-matched emissive term approximates broad sky/ground bounce without
 * raising exposure for the already bright terrain and foliage.
 */
export function setBuildingIndirectLightIntensity(intensity: number): void {
  buildingIndirectIntensity = Math.max(0, intensity);
  for (const material of materialCache.values()) {
    material.emissiveIntensity = buildingIndirectIntensity;
  }
}

/** Shared non-structural materials used by building props and painted trim. */
export function sharedBuildingDetailMaterial(key: BuildingDetailMaterialKey): BuildingAtlasMaterial {
  const cached = detailMaterialCache.get(key);
  if (cached) return cached;
  const definition = DETAIL_MATERIAL_DEFINITIONS[key];
  const {
    atlasTile,
    atlasMetersPerTile,
    atlasTintStrength,
    textureFamily,
    buildingNormalScale,
    ...parameters
  } = definition;
  const material = (key === 'hide'
    ? new MeshPhysicalNodeMaterial()
    : new MeshStandardNodeMaterial()) as BuildingAtlasMaterial;
  material.setValues(parameters);
  material.name = `Shared building detail material: ${key}`;
  material.userData.sharedBuildingMaterial = true;
  material.userData.buildingDetailMaterialKey = key;
  if (atlasMetersPerTile) material.userData.metricUvMeters = atlasMetersPerTile;
  else if (textureFamily) material.userData.metricUvMeters = TEXTURE_METERS[textureFamily];
  material.userData.buildingMaterialAtlasTile = atlasTile;
  material.userData.buildingMaterialAtlasTintStrength = atlasTintStrength;
  detailMaterialCache.set(key, material);
  applyDetailTextureSet(material, definition);
  return material;
}

/** Loads the shared building atlas and the specialty sewn-hide surface once. */
export function initializeBuildingMaterialLibrary(
  maxAnisotropy = 8,
  preloadTexture?: (texture: THREE.Texture) => void,
): Promise<void> {
  if (textureLoadPromise) {
    return textureLoadPromise.then(async () => {
      await Promise.all([
        initializeBuildingMaterialAtlas(maxAnisotropy, preloadTexture),
        initializeCampHideSurface(maxAnisotropy, preloadTexture),
      ]);
    });
  }
  textureLoadPromise = Promise.all([
    initializeBuildingMaterialAtlas(maxAnisotropy, preloadTexture),
    initializeCampHideSurface(maxAnisotropy, preloadTexture),
  ]).then(() => {
    for (const [key, material] of materialCache) {
      applyTextureSet(material, MATERIAL_DEFINITIONS[key]);
    }
    for (const [key, material] of detailMaterialCache) {
      applyDetailTextureSet(material, DETAIL_MATERIAL_DEFINITIONS[key]);
    }
    // The deterministic startup fallbacks have been superseded by the atlas.
    // Release them immediately; only the atlas and specialty hide maps remain.
    splitWoodShingleMap?.dispose();
    splitWoodShingleMap = null;
  }).catch((error: unknown) => {
    textureLoadPromise = null;
    throw error;
  });
  return textureLoadPromise;
}

export function disposeBuildingMaterialLibrary(): void {
  for (const material of materialCache.values()) material.dispose();
  for (const material of detailMaterialCache.values()) material.dispose();
  materialCache.clear();
  detailMaterialCache.clear();
  disposeSharedWellWaterMaterial();
  disposeBuildingMaterialAtlas();
  disposeCampHideSurface();
  splitWoodShingleMap?.dispose();
  splitWoodShingleMap = null;
  textureLoadPromise = null;
}

export function getBuildingMaterialLibraryStats(): { constructionMaterials: number; detailMaterials: number; textures: number; loaded: boolean } {
  const atlas = getBuildingMaterialAtlasStats();
  const hide = getCampHideSurfaceStats();
  return {
    constructionMaterials: materialCache.size,
    detailMaterials: detailMaterialCache.size,
    textures: atlas.textures + hide.textures + (splitWoodShingleMap ? 1 : 0),
    loaded: atlas.loaded && hide.loaded,
  };
}

function applyTextureSet(material: BuildingAtlasMaterial, definition: MaterialDefinition): void {
  if (!definition.atlasTile) return;
  applyBuildingMaterialAtlas(material, {
    tile: definition.atlasTile,
    tintStrength: definition.atlasTintStrength,
    normalStrength: definition.normalScale,
  });
}

const SPLIT_SHINGLE_TEXTURE_SIZE = 256;
const SPLIT_SHINGLE_TILE_METERS = 2.2;
const SPLIT_SHINGLE_COURSES_PER_TILE = 6;
const SPLIT_SHINGLE_WIDTH_METERS = 0.4;
const SPLIT_SHINGLE_BUTT_LENGTH_VARIATION = 0.1;

function configureSplitWoodShingleSurface(
  material: BuildingAtlasMaterial,
): void {
  material.map = getSplitWoodShingleMap();
  material.userData.buildingUsesProceduralShingleMap = true;
  material.userData.splitShinglePattern = {
    tileMeters: SPLIT_SHINGLE_TILE_METERS,
    courseExposureMeters:
      SPLIT_SHINGLE_TILE_METERS / SPLIT_SHINGLE_COURSES_PER_TILE,
    shingleWidthMeters: SPLIT_SHINGLE_WIDTH_METERS,
    buttLengthVariation: SPLIT_SHINGLE_BUTT_LENGTH_VARIATION,
    stagger: 'alternating-half-width',
    details: [
      'butt-joints',
      'irregular-lower-edges',
      'longitudinal-split-grain',
    ],
  };
}

/**
 * A small, deterministic albedo tile makes short split shingles legible on
 * both WebGL and WebGPU without adding a material permutation or draw call.
 * Metric UVs keep the 0.37 m courses and 0.4 m butts consistent on roof
 * planes, merged course boards, ridge caps, and porch roofs.
 */
function getSplitWoodShingleMap(): THREE.DataTexture {
  if (splitWoodShingleMap) return splitWoodShingleMap;

  const size = SPLIT_SHINGLE_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const courseMeters =
    SPLIT_SHINGLE_TILE_METERS / SPLIT_SHINGLE_COURSES_PER_TILE;
  const shinglesPerTile =
    SPLIT_SHINGLE_TILE_METERS / SPLIT_SHINGLE_WIDTH_METERS;

  for (let pixelV = 0; pixelV < size; pixelV += 1) {
    const ridgeMeters =
      (pixelV + 0.5) / size * SPLIT_SHINGLE_TILE_METERS;
    for (let pixelU = 0; pixelU < size; pixelU += 1) {
      const slopeMeters =
        (pixelU + 0.5) / size * SPLIT_SHINGLE_TILE_METERS;
      const courseCoordinate = slopeMeters / courseMeters;
      const course = Math.floor(courseCoordinate);
      const courseT = courseCoordinate - course;
      const courseIndex =
        ((course % SPLIT_SHINGLE_COURSES_PER_TILE)
          + SPLIT_SHINGLE_COURSES_PER_TILE)
        % SPLIT_SHINGLE_COURSES_PER_TILE;
      const courseOffset =
        (courseIndex % 2) * 0.5
        + (stableShingleHash(courseIndex, 17) - 0.5) * 0.14;
      const splitWobble =
        Math.sin(
          courseT * Math.PI * 2
            + stableShingleHash(courseIndex, 29) * Math.PI * 2,
        ) * 0.018;
      const shingleCoordinate =
        ridgeMeters / SPLIT_SHINGLE_WIDTH_METERS
        + courseOffset
        + splitWobble;
      const shingle = Math.floor(shingleCoordinate);
      const shingleT = shingleCoordinate - shingle;
      const shingleIndex =
        ((shingle % shinglesPerTile) + shinglesPerTile) % shinglesPerTile;
      const boardTone = stableShingleHash(courseIndex, shingleIndex);
      const edgeJitter =
        (stableShingleHash(shingleIndex, courseIndex + 41) - 0.5)
        * 2
        * SPLIT_SHINGLE_BUTT_LENGTH_VARIATION;
      const lowerEdgeAt = 0.045 + edgeJitter;
      const edgeDelta = Math.abs(courseT - lowerEdgeAt);
      const wrappedEdgeDistance = Math.min(edgeDelta, 1 - edgeDelta);
      const lowerEdge =
        1 - smoothStep01((wrappedEdgeDistance - 0.008) / 0.055);
      const jointDistanceMeters =
        Math.min(shingleT, 1 - shingleT) * SPLIT_SHINGLE_WIDTH_METERS;
      const buttJoint =
        1 - smoothStep01((jointDistanceMeters - 0.006) / 0.022);
      const grainFrequency = 3 + Math.floor(boardTone * 4);
      const grain =
        Math.sin(
          shingleT * Math.PI * 2 * grainFrequency
            + courseT * 0.85
            + boardTone * Math.PI * 2,
        ) * 0.025;
      const splitCenter =
        0.24 + stableShingleHash(courseIndex + 73, shingleIndex) * 0.52;
      const splitDistance = Math.abs(shingleT - splitCenter);
      const splitEnd =
        (1 - smoothStep01((splitDistance - 0.004) / 0.018))
        * (1 - smoothStep01((wrappedEdgeDistance - 0.01) / 0.13));
      const age = (boardTone - 0.5) * 0.085;
      const darkness =
        1
        - lowerEdge * 0.34
        - buttJoint * 0.43
        - splitEnd * 0.23
        + grain;
      const warmth = stableShingleHash(shingleIndex + 11, courseIndex + 97);
      const baseRed = 226 + age * 100 + warmth * 5;
      const baseGreen = 224 + age * 92 + warmth * 2;
      const baseBlue = 218 + age * 84 - warmth * 5;
      const dataIndex = (pixelV * size + pixelU) * 4;
      data[dataIndex] = Math.round(
        THREE.MathUtils.clamp(baseRed * darkness, 50, 242),
      );
      data[dataIndex + 1] = Math.round(
        THREE.MathUtils.clamp(baseGreen * darkness, 48, 239),
      );
      data[dataIndex + 2] = Math.round(
        THREE.MathUtils.clamp(baseBlue * darkness, 44, 232),
      );
      data[dataIndex + 3] = 255;
    }
  }

  splitWoodShingleMap = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
  );
  splitWoodShingleMap.name = 'Procedural split-wood shingles';
  splitWoodShingleMap.colorSpace = THREE.SRGBColorSpace;
  splitWoodShingleMap.wrapS = THREE.RepeatWrapping;
  splitWoodShingleMap.wrapT = THREE.RepeatWrapping;
  splitWoodShingleMap.magFilter = THREE.LinearFilter;
  splitWoodShingleMap.minFilter = THREE.LinearMipmapLinearFilter;
  splitWoodShingleMap.generateMipmaps = true;
  splitWoodShingleMap.anisotropy = 8;
  splitWoodShingleMap.needsUpdate = true;
  return splitWoodShingleMap;
}

function stableShingleHash(first: number, second: number): number {
  const value =
    Math.sin(first * 12.9898 + second * 78.233 + 0.137) * 43758.5453;
  return value - Math.floor(value);
}

function configureBuildingIndirectLight(
  material: THREE.MeshStandardMaterial,
): void {
  material.emissive.copy(material.color);
  material.emissiveIntensity = buildingIndirectIntensity;
  material.userData.buildingIndirectLight = true;
}

function applyDetailTextureSet(
  material: BuildingAtlasMaterial,
  definition: DetailMaterialDefinition,
): void {
  if (material.userData.buildingDetailMaterialKey === 'hide') {
    applyCampHideSurface(material);
    return;
  }
  if (!definition.atlasTile) return;
  applyBuildingMaterialAtlas(material, {
    tile: definition.atlasTile,
    tintStrength: definition.atlasTintStrength,
    normalStrength: definition.buildingNormalScale,
  });
}

export function quarryRockMaterial(
  shade: keyof typeof QUARRY_ROCK_PALETTE = 'mid',
): BuildingAtlasMaterial {
  // Quarry faces are raw regional stone, never dressed limestone ashlar. The
  // light/cut labels describe value variation, not a change of construction
  // material role.
  if (shade === 'light' || shade === 'cut' || shade === 'dust') return sharedBuildingMaterial('masonryMid');
  if (shade === 'dark' || shade === 'spoil') return sharedBuildingMaterial('masonryDark');
  return sharedBuildingMaterial('masonryMid');
}

export function stoneMaterial(shade: 'light' | 'mid' | 'mortar' = 'mid'): BuildingAtlasMaterial {
  if (shade === 'light') return sharedBuildingMaterial('masonryLight');
  if (shade === 'mortar') return sharedBuildingMaterial('masonryDark');
  return sharedBuildingMaterial('masonryMid');
}

export function timberMaterial(shade: 'dark' | 'mid' | 'light' | 'weathered' = 'mid'): BuildingAtlasMaterial {
  if (shade === 'dark') return sharedBuildingMaterial('timberDark');
  if (shade === 'light') return sharedBuildingMaterial('timberLight');
  if (shade === 'weathered') return sharedBuildingMaterial('timberWeathered');
  return sharedBuildingMaterial('timberMid');
}

/** Horizontal log courses for authored wall volumes, never individual beams. */
export function stackedTimberWallMaterial(): BuildingAtlasMaterial {
  return sharedBuildingMaterial('stackedTimber');
}

export function tileMaterial(variant: 0 | 1 | 2 = 0): BuildingAtlasMaterial {
  return sharedBuildingMaterial(variant === 1 ? 'clayDark' : 'clayRed');
}

export function shingleMaterial(): BuildingAtlasMaterial {
  return sharedBuildingMaterial('shingle');
}

export function residenceFacadeMaterial(facade: ResidenceFacadeColor): BuildingAtlasMaterial {
  if (facade === 'yellow') return sharedBuildingMaterial('plasterYellow');
  if (facade === 'grey') return sharedBuildingMaterial('plasterGrey');
  if (facade === 'lightOrange' || facade === 'orange') return sharedBuildingMaterial('plasterOrange');
  return sharedBuildingMaterial('plasterWhite');
}

export function residenceRoofMaterial(roof: ResidenceRoofColor): BuildingAtlasMaterial {
  if (roof === 'red') return sharedBuildingMaterial('clayRed');
  if (roof === 'brown') return sharedBuildingMaterial('shingle');
  return sharedBuildingMaterial('slate');
}

export function mossMaterial(kind: 'moss' | 'grass' = 'moss'): BuildingAtlasMaterial {
  return sharedBuildingMaterial(kind === 'grass' ? 'grassRoof' : 'moss');
}

export function metalMaterial(shade: 'iron' | 'steel' = 'iron'): BuildingAtlasMaterial {
  void shade;
  return sharedBuildingMaterial('metalIron');
}

export function addMesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: THREE.Vector3,
  rotation = new THREE.Euler(),
  scale = new THREE.Vector3(1, 1, 1),
): THREE.Mesh {
  const hasScale = scale.x !== 1 || scale.y !== 1 || scale.z !== 1;
  // Metric UVs must see final world dimensions. Baking the authored scale into
  // a private geometry copy prevents a six-metre member made from a unit box
  // from receiving one-metre texture density, while preserving reusable source
  // geometries and leaving later runtime scale animation available.
  const dimensionedGeometry = hasScale ? geometry.clone() : geometry;
  if (hasScale) dimensionedGeometry.scale(scale.x, scale.y, scale.z);
  const preparedGeometry = prepareBuildingGeometryUvs(dimensionedGeometry, material);
  const mesh = new THREE.Mesh(
    applyBuildingWeatheringVertexColors(preparedGeometry, material),
    material,
  );
  mesh.position.copy(position);
  mesh.rotation.copy(rotation);
  mesh.userData.metricUvScaleBaked = hasScale;
  // Detailed meshes stay off the shadow pass. Coarse footprint proxies were
  // retired because their solid silhouettes read as black ground slabs.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/**
 * Adds stable, geometry-local age variation without another texture fetch or
 * material permutation. The tint is carried by the existing vertex-color
 * channel, so every shared wall/roof material keeps batching while foundations
 * gain damp staining and roofs/wood stop reading as perfectly uniform blocks.
 */
function applyBuildingWeatheringVertexColors(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.BufferGeometry {
  const profile = material.userData.buildingWeatheringProfile as BuildingWeatheringProfile | undefined;
  if (!profile) return geometry;

  const previousProfile = geometry.userData.buildingWeatheringProfile;
  if (previousProfile === profile && geometry.hasAttribute('color')) return geometry;
  const target = typeof previousProfile === 'string' ? geometry.clone() : geometry;
  const position = target.getAttribute('position');
  const normal = target.getAttribute('normal');
  if (!position || !normal) return target;

  target.computeBoundingBox();
  const bounds = target.boundingBox;
  if (!bounds) return target;
  const height = Math.max(0.05, bounds.max.y - bounds.min.y);
  const colors = new Float32Array(position.count * 3);

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const up = Math.max(0, normal.getY(i));
    const heightT = THREE.MathUtils.clamp((y - bounds.min.y) / height, 0, 1);
    const lowBand = 1 - smoothStep01(heightT / 0.34);
    const broadNoise = 0.5 + 0.5 * Math.sin(x * 1.73 + z * 2.19 + y * 0.41);
    const fineNoise = 0.5 + 0.5 * Math.sin(x * 7.91 - z * 5.37 + y * 3.17);
    const variation = (broadNoise * 0.68 + fineNoise * 0.32 - 0.5) * 0.12;

    let red = 1 + variation;
    let green = 1 + variation;
    let blue = 1 + variation;

    if (profile === 'plaster') {
      const rainStain = lowBand * (0.48 + broadNoise * 0.52);
      red *= 1 - rainStain * 0.2;
      green *= 1 - rainStain * 0.15;
      blue *= 1 - rainStain * 0.23;
    } else if (profile === 'masonry') {
      const damp = lowBand * (0.58 + fineNoise * 0.42);
      red *= 1 - damp * 0.25;
      green *= 1 - damp * 0.2;
      blue *= 1 - damp * 0.27;
    } else if (profile === 'timber') {
      const silvering = 0.06 * broadNoise + 0.08 * up;
      red *= 1 - silvering * 0.55;
      green *= 1 - silvering * 0.28;
      blue *= 1 + silvering * 0.12;
    } else if (profile === 'shingle') {
      const componentVertexCount =
        target.userData.buildingWeatheringComponentVertexCount;
      const componentIndex =
        typeof componentVertexCount === 'number' && componentVertexCount > 0
          ? Math.floor(i / componentVertexCount)
          : 0;
      const splitTone =
        0.5
        + 0.5
          * Math.sin(
            componentIndex * 12.9898
              + Math.floor(x * 1.3) * 3.17
              + Math.floor(z * 1.7) * 5.71,
          );
      const silvering = 0.04 + splitTone * 0.1 + up * 0.035;
      const warmAge = (1 - splitTone) * 0.08;
      const lichen = up * fineNoise * broadNoise * 0.055;
      red *= 0.96 + warmAge - silvering * 0.32 - lichen * 0.42;
      green *= 0.95 + warmAge * 0.38 + silvering * 0.06 + lichen * 0.08;
      blue *= 0.92 - warmAge * 0.22 + silvering * 0.2 - lichen * 0.28;
    } else if (profile === 'thatch') {
      const bundle = 0.5 + 0.5 * Math.sin(x * 18.3 + z * 14.7 + y * 4.2);
      const eaveDarkening = lowBand * 0.14;
      red *= 0.88 + bundle * 0.12 - eaveDarkening * 0.82;
      green *= 0.9 + bundle * 0.11 - eaveDarkening * 0.78;
      blue *= 0.86 + bundle * 0.1 - eaveDarkening * 0.7;
    } else {
      const roofExposure = up * (0.55 + broadNoise * 0.45);
      const lichen = roofExposure * fineNoise * 0.1;
      red *= 1 - lichen * 0.7;
      green *= 1 - lichen * 0.18;
      blue *= 1 - lichen * 0.78;
    }

    colors[i * 3] = THREE.MathUtils.clamp(red, 0.58, 1.08);
    colors[i * 3 + 1] = THREE.MathUtils.clamp(green, 0.58, 1.08);
    colors[i * 3 + 2] = THREE.MathUtils.clamp(blue, 0.58, 1.08);
  }

  target.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  target.userData.buildingWeatheringProfile = profile;
  return target;
}

function smoothStep01(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}
