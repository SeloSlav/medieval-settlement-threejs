import {
  FARM_BASE_GRAIN_PER_SQUARE_METER,
  FARM_CROP_DEFINITIONS,
  FARM_REGIONAL_AFFINITY_FLOOR,
  FARM_REGIONAL_ASPECT_RATIO,
  FARM_REGIONAL_CENTER_RADIUS_RATIO,
  FARM_REGIONAL_CORE_RADIUS_RATIO,
  FARM_REGIONAL_PRIME_CROPS_LARGE,
  FARM_REGIONAL_PRIME_CROPS_MEDIUM,
  FARM_REGIONAL_PRIME_CROPS_SMALL,
  FARM_REGIONAL_UNREPRESENTED_CEILING,
  FARM_REGIONAL_YIELD_FLOOR,
  FARM_SLOPE_PENALTY_PER_DEGREE,
  type FarmCropDefinition,
  type FarmCropProduce,
} from '../generated/gameBalance.ts';
import type { FarmCrop, FarmFieldState } from '../resources/types.ts';
import { getActiveWorldGeneration } from '../world/worldGenerationContext.ts';
import {
  resolveWorldDimensions,
  type WorldMapSize,
} from '../world/worldGenerationSettings.ts';
import {
  cross2,
  isConvexQuad2,
  polygonArea2,
  type Point2,
} from '../utils/polygonGeometry.ts';

export type FarmFieldCorners = [Point2, Point2, Point2, Point2];

export type CropRegionContext = {
  worldSeed: number;
  mapSize: WorldMapSize;
};

export type CropRegionalProfile = {
  /** Crop position in the seed-specific comparative-advantage order. */
  rank: number;
  /** Whether this map size gives the crop a genuinely prime province. */
  represented: boolean;
  centerX: number;
  centerZ: number;
  /** Broad province mask before map-size availability is applied. */
  provinceStrength: number;
  /** Regional affinity consumed by the real yield calculation. */
  affinity: number;
  yieldMultiplier: number;
};

const REGIONAL_CROPS: readonly FarmCrop[] = ['rye', 'oats', 'barley', 'flax', 'wheat'];
const UINT32_RANGE = 0x1_0000_0000;
const FULL_TURN = Math.PI * 2;
const CROP_SUITABILITY_DISPLAY_CURVE = 2.4;

export function rectangleFromBaseline(a: Point2, b: Point2, depthPoint: Point2): FarmFieldCorners | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length <= 1e-6) return null;
  const nx = -dz / length;
  const nz = dx / length;
  const depth = (depthPoint.x - a.x) * nx + (depthPoint.z - a.z) * nz;
  return [
    { x: a.x, z: a.z },
    { x: b.x, z: b.z },
    { x: b.x + nx * depth, z: b.z + nz * depth },
    { x: a.x + nx * depth, z: a.z + nz * depth },
  ];
}

export function fieldCentroid(corners: readonly Point2[]): Point2 {
  let twiceArea = 0;
  let weightedX = 0;
  let weightedZ = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const point = corners[index];
    const next = corners[(index + 1) % corners.length];
    const cross = point.x * next.z - next.x * point.z;
    twiceArea += cross;
    weightedX += (point.x + next.x) * cross;
    weightedZ += (point.z + next.z) * cross;
  }
  if (Math.abs(twiceArea) <= 1e-9) {
    return {
      x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length,
      z: corners.reduce((sum, point) => sum + point.z, 0) / corners.length,
    };
  }
  return {
    x: weightedX / (3 * twiceArea),
    z: weightedZ / (3 * twiceArea),
  };
}

export function fieldEdgeLengths(corners: FarmFieldCorners): [number, number, number, number] {
  return corners.map((point, index) => {
    const next = corners[(index + 1) % 4];
    return Math.hypot(next.x - point.x, next.z - point.z);
  }) as [number, number, number, number];
}

export function fieldArea(corners: FarmFieldCorners): number {
  return polygonArea2(corners);
}

export function fieldShapeEfficiency(corners: FarmFieldCorners): number {
  const edges = fieldEdgeLengths(corners);
  const width = (edges[0] + edges[2]) * 0.5;
  const depth = (edges[1] + edges[3]) * 0.5;
  const aspect = Math.max(width, depth) / Math.max(1e-6, Math.min(width, depth));
  const aspectEfficiency = Math.max(
    0.72,
    Math.min(1, 1 - Math.max(0, aspect - 1) * 0.035),
  );
  const compactness = Math.max(
    0,
    Math.min(1, fieldArea(corners) / Math.max(1e-6, width * depth)),
  );
  const skewEfficiency = 0.85 + compactness * 0.15;
  return Math.max(0.72, Math.min(1, aspectEfficiency * skewEfficiency));
}

export function isValidFarmFieldCorners(corners: FarmFieldCorners): boolean {
  if (
    !corners.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z))
    || !isConvexQuad2(corners[0], corners[1], corners[2], corners[3])
  ) {
    return false;
  }
  const turns = [
    cross2(corners[0], corners[1], corners[2]),
    cross2(corners[1], corners[2], corners[3]),
    cross2(corners[2], corners[3], corners[0]),
    cross2(corners[3], corners[0], corners[1]),
  ];
  return (turns.every((turn) => turn > 1e-8) || turns.every((turn) => turn < -1e-8))
    && fieldArea(corners) > 1e-6;
}

/** Bounded whole-parcel sampling used by both previews and placement checks. */
export function sampleParcelPoints(
  corners: FarmFieldCorners,
  divisions = 4,
): Point2[] {
  const steps = Math.max(1, Math.floor(divisions));
  const points: Point2[] = [];
  for (let vIndex = 0; vIndex <= steps; vIndex += 1) {
    for (let uIndex = 0; uIndex <= steps; uIndex += 1) {
      points.push(bilinearPoint(corners, uIndex / steps, vIndex / steps));
    }
  }
  return points;
}

export type ArableLandConditions = {
  /** 0 = light/gravelly soil, 1 = heavy/clay-rich soil. */
  texture: number;
  /** Persistent depth of workable, nutrient-holding topsoil. */
  depth: number;
};

/**
 * Broad, deterministic soil pockets shared with the authoritative server.
 * These vary independently from rivers so crop choice matters across the map.
 */
export function sampleArableLandConditions(x: number, z: number): ArableLandConditions {
  const worldX = Number.isFinite(x) ? x : 0;
  const worldZ = Number.isFinite(z) ? z : 0;
  const texture = clamp01(
    0.5
      + Math.sin(worldX * 0.0107 + worldZ * 0.0061 + 0.8) * 0.22
      + Math.sin(worldX * -0.0173 + worldZ * 0.0149 - 1.7) * 0.18
      + Math.cos(worldX * 0.0049 - worldZ * 0.0127 + 2.4) * 0.10,
  );
  const depth = clamp01(
    0.56
      + Math.sin(worldX * 0.0063 - worldZ * 0.0091 - 0.4) * 0.21
      + Math.cos(worldX * 0.0151 + worldZ * 0.0057 + 1.1) * 0.16
      + Math.sin(worldX * 0.027 - worldZ * 0.018) * 0.08,
  );
  return { texture, depth };
}

export function effectiveFieldMoisture(
  groundwater: number,
  x: number,
  z: number,
): number {
  const conditions = sampleArableLandConditions(x, z);
  const soilRetention = 0.14 + conditions.texture * 0.16 + conditions.depth * 0.10;
  return clamp01(clamp01(groundwater) * 0.68 + soilRetention);
}

export function moistureSuitability(crop: FarmCrop, moisture: number): number {
  const definition = cropDefinition(crop);
  if (definition.produce === 'none') return 1;
  const ideal = definition.moistureIdeal;
  const tolerance = definition.moistureTolerance;
  const match = 1 - Math.abs(clamp01(moisture) - ideal) / Math.max(1e-6, tolerance);
  return 0.52 + clamp01(match) * 0.48;
}

export function cropSoilSuitability(crop: FarmCrop, x: number, z: number): number {
  const definition = cropDefinition(crop);
  if (definition.produce === 'none') return 1;
  const conditions = sampleArableLandConditions(x, z);
  const textureMatch = 1 - Math.abs(conditions.texture - definition.soilTextureIdeal)
    / Math.max(1e-6, definition.soilTextureTolerance);
  const textureSuitability = 0.45 + clamp01(textureMatch) * 0.55;
  const depthSuitability = 1
    - definition.soilDepthDemand * (1 - conditions.depth) * 0.42;
  return clamp01(textureSuitability * depthSuitability);
}

/**
 * Seeded, map-scale agricultural provinces layered over physical soil causes.
 *
 * Rank zero owns the central province; the remaining crops occupy four broad
 * outer provinces. Map size controls how many of those crops can reach prime
 * affinity (3/4/5), while every crop remains growable at a deliberately
 * inefficient subsistence floor. This is shared with the authoritative server.
 */
export function cropRegionalProfile(
  crop: FarmCrop,
  x: number,
  z: number,
  context: CropRegionContext = activeCropRegionContext(),
): CropRegionalProfile {
  const cropIndex = REGIONAL_CROPS.indexOf(crop);
  if (cropIndex < 0) {
    return {
      rank: -1,
      represented: true,
      centerX: 0,
      centerZ: 0,
      provinceStrength: 1,
      affinity: 1,
      yieldMultiplier: 1,
    };
  }

  const layoutHash = regionalSeedHash(context.worldSeed, 0xa511_e9b3);
  const rotation = layoutHash % REGIONAL_CROPS.length;
  const direction = (layoutHash & 0x100) === 0 ? 1 : -1;
  const rank = positiveModulo(
    direction * (cropIndex - rotation),
    REGIONAL_CROPS.length,
  );
  const dimensions = resolveWorldDimensions(context.mapSize);
  const generationHalf = dimensions.generationHalf;
  const baseAngle = regionalSeedHash(context.worldSeed, 0x63d8_35f1)
    / UINT32_RANGE * FULL_TURN;
  const provinceAngle = rank === 0
    ? baseAngle
    : baseAngle + (rank - 1) * Math.PI * 0.5;
  const centerDistance = rank === 0
    ? 0
    : generationHalf * FARM_REGIONAL_CENTER_RADIUS_RATIO;
  const centerX = Math.cos(provinceAngle) * centerDistance;
  const centerZ = Math.sin(provinceAngle) * centerDistance;
  const longAxisAngle = rank === 0 ? baseAngle : provinceAngle + Math.PI * 0.5;
  const dx = (Number.isFinite(x) ? x : 0) - centerX;
  const dz = (Number.isFinite(z) ? z : 0) - centerZ;
  const along = dx * Math.cos(longAxisAngle) + dz * Math.sin(longAxisAngle);
  const across = -dx * Math.sin(longAxisAngle) + dz * Math.cos(longAxisAngle);
  const coreRadius = Math.max(1, generationHalf * FARM_REGIONAL_CORE_RADIUS_RATIO);
  const scaledDistance = Math.hypot(
    along / (coreRadius * FARM_REGIONAL_ASPECT_RATIO),
    across / coreRadius,
  );
  const provinceStrength = 1 - smoothstep(0.22, 1.15, scaledDistance);
  const represented = rank < regionalPrimeCropCount(context.mapSize);
  const affinityCeiling = represented ? 1 : FARM_REGIONAL_UNREPRESENTED_CEILING;
  const affinity = FARM_REGIONAL_AFFINITY_FLOOR
    + (affinityCeiling - FARM_REGIONAL_AFFINITY_FLOOR) * provinceStrength;
  const yieldMultiplier = FARM_REGIONAL_YIELD_FLOOR
    + (1 - FARM_REGIONAL_YIELD_FLOOR) * affinity;

  return {
    rank,
    represented,
    centerX,
    centerZ,
    provinceStrength,
    affinity,
    yieldMultiplier,
  };
}

export function cropRegionalSuitability(
  crop: FarmCrop,
  x: number,
  z: number,
  context: CropRegionContext = activeCropRegionContext(),
): number {
  return cropRegionalProfile(crop, x, z, context).affinity;
}

export function cropSlopeSuitability(
  crop: FarmCrop,
  averageSlopeDegrees: number,
): number {
  return Math.max(
    0.35,
    Math.min(
      1,
      1
        - Math.max(0, averageSlopeDegrees)
          * FARM_SLOPE_PENALTY_PER_DEGREE
          * cropDefinition(crop).slopePenaltyMultiplier,
    ),
  );
}

export function cropEnvironmentalSuitability(
  crop: FarmCrop,
  groundwater: number,
  x: number,
  z: number,
  regionContext: CropRegionContext = activeCropRegionContext(),
): number {
  if (cropProduce(crop) === 'none') return 1;
  const moisture = moistureSuitability(crop, effectiveFieldMoisture(groundwater, x, z));
  const soil = cropSoilSuitability(crop, x, z);
  const localSuitability = moisture * 0.42 + soil * 0.58;
  return localSuitability * cropRegionalProfile(crop, x, z, regionContext).yieldMultiplier;
}

/** Mirrors the authoritative starting-fertility rule used when a field is placed. */
export function initialFieldFertility(
  groundwater: number,
  averageSlopeDegrees: number,
  x: number,
  z: number,
): number {
  const conditions = sampleArableLandConditions(x, z);
  const loamQuality = clamp01(1 - Math.abs(conditions.texture - 0.5) * 1.6);
  return Math.max(
    0.35,
    Math.min(
      0.95,
      0.50
        + clamp01(groundwater) * 0.13
        + conditions.depth * 0.20
        + loamQuality * 0.12
        - Math.max(0, averageSlopeDegrees) * 0.006,
    ),
  );
}

/**
 * Perceptually normalized first-crop productivity before parcel shape and size.
 * The real harvest keeps the underlying multiplicative penalties, while this
 * planning score expands their compressed upper range so broad viable land is
 * legible instead of nearly every site reading as poor. Fallow shows predicted
 * starting soil because it has no crop yield.
 */
export function cropSiteSuitability(
  crop: FarmCrop,
  groundwater: number,
  averageSlopeDegrees: number,
  x: number,
  z: number,
  regionContext: CropRegionContext = activeCropRegionContext(),
): number {
  const fertility = initialFieldFertility(groundwater, averageSlopeDegrees, x, z);
  if (cropProduce(crop) === 'none') return fertility / 0.95;
  const rawProductivity = Math.max(
    0,
    Math.min(
      1,
      cropEnvironmentalSuitability(crop, groundwater, x, z, regionContext)
        * (fertility / 0.95)
        * cropSlopeSuitability(crop, averageSlopeDegrees),
    ),
  );
  return 1 - Math.pow(1 - rawProductivity, CROP_SUITABILITY_DISPLAY_CURVE);
}

export function expectedFieldYield(
  field: Pick<FarmFieldState, 'area' | 'crop' | 'moisture' | 'fertility' | 'averageSlopeDegrees' | 'corners'>,
  regionContext: CropRegionContext = activeCropRegionContext(),
): number {
  const definition = cropDefinition(field.crop);
  if (definition.produce === 'none') return 0;
  const center = fieldCentroid(field.corners);
  return field.area
    * FARM_BASE_GRAIN_PER_SQUARE_METER
    * definition.yieldMultiplier
    * cropEnvironmentalSuitability(
      field.crop,
      field.moisture,
      center.x,
      center.z,
      regionContext,
    )
    * Math.max(0.2, Math.min(1, field.fertility))
    * cropSlopeSuitability(field.crop, field.averageSlopeDegrees)
    * fieldShapeEfficiency(field.corners);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function activeCropRegionContext(): CropRegionContext {
  const settings = getActiveWorldGeneration();
  return { worldSeed: settings.seed, mapSize: settings.mapSize };
}

function regionalPrimeCropCount(mapSize: WorldMapSize): number {
  switch (mapSize) {
    case 'small': return FARM_REGIONAL_PRIME_CROPS_SMALL;
    case 'large': return FARM_REGIONAL_PRIME_CROPS_LARGE;
    default: return FARM_REGIONAL_PRIME_CROPS_MEDIUM;
  }
}

function regionalSeedHash(seed: number, salt: number): number {
  let hash = ((Number.isFinite(seed) ? Math.trunc(seed) : 0) >>> 0) ^ (salt >>> 0);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb_352d) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x846c_a68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function sampleAverageSlopeDegrees(
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
): number {
  const samples = 4;
  const slopes: number[] = [];
  for (let zIndex = 0; zIndex <= samples; zIndex++) {
    for (let xIndex = 0; xIndex <= samples; xIndex++) {
      const u = xIndex / samples;
      const v = zIndex / samples;
      const point = bilinearPoint(corners, u, v);
      const hx = getHeightAt(point.x + 0.5, point.z) - getHeightAt(point.x - 0.5, point.z);
      const hz = getHeightAt(point.x, point.z + 0.5) - getHeightAt(point.x, point.z - 0.5);
      slopes.push(Math.atan(Math.hypot(hx, hz)) * 180 / Math.PI);
    }
  }
  return slopes.reduce((sum, value) => sum + value, 0) / Math.max(1, slopes.length);
}

export function bilinearPoint(corners: FarmFieldCorners, u: number, v: number): Point2 {
  const topX = corners[0].x + (corners[1].x - corners[0].x) * u;
  const topZ = corners[0].z + (corners[1].z - corners[0].z) * u;
  const bottomX = corners[3].x + (corners[2].x - corners[3].x) * u;
  const bottomZ = corners[3].z + (corners[2].z - corners[3].z) * u;
  return { x: topX + (bottomX - topX) * v, z: topZ + (bottomZ - topZ) * v };
}

export function cropLabel(crop: FarmCrop): string {
  return cropDefinition(crop).label;
}

export function cropDefinition(crop: FarmCrop): FarmCropDefinition {
  return FARM_CROP_DEFINITIONS[crop];
}

export function cropProduce(crop: FarmCrop): FarmCropProduce {
  return cropDefinition(crop).produce;
}

export function cropHarvestUnit(crop: FarmCrop): string {
  switch (crop) {
    case 'rye': return 'rye sheaves';
    case 'oats': return 'oat sheaves';
    case 'barley': return 'barley sheaves';
    case 'wheat': return 'maslin sheaves';
    case 'flax': return 'flax fibre';
    case 'fallow': return 'fertility';
  }
}
