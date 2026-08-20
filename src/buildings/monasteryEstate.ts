import type { TerrainBounds } from '../terrain/Terrain.ts';

/**
 * The monastery owns a real enclosed estate, not merely the abbey's central pad.
 * Local +Z is the road-facing front used by the building placement yaw.
 */
export const MONASTERY_ESTATE_HALF_WIDTH = 34;
export const MONASTERY_ESTATE_REAR_DEPTH = 45.5;
export const MONASTERY_ESTATE_FRONT_DEPTH = 7.5;
export const MONASTERY_ESTATE_WIDTH = MONASTERY_ESTATE_HALF_WIDTH * 2;
export const MONASTERY_ESTATE_DEPTH = MONASTERY_ESTATE_REAR_DEPTH + MONASTERY_ESTATE_FRONT_DEPTH;
export const MONASTERY_ESTATE_MAP_INSET = 8;
export const MONASTERY_ESTATE_EDGE_BAND = 60;

export type MonasteryEstateLevel = 0 | 1 | 2 | 3;
export type MonasteryEstatePoint = { x: number; z: number };
export type MonasteryOrchardPlanting = 0 | 1;
export type MonasteryCroftPlanting = 0 | 1;

export const MONASTERY_ORCHARD_PLANTINGS = [
  { value: 0, label: 'Apple orchard', output: 'Apples · cider after the fruit press is built' },
  { value: 1, label: 'Grapevines', output: 'Wine' },
] as const;

export const MONASTERY_CROFT_PLANTINGS = [
  { value: 0, label: 'Kitchen vegetables', output: 'Vegetables' },
  { value: 1, label: 'Brewing barley', output: 'Ale' },
] as const;

function estateWorldPoint(
  x: number,
  z: number,
  yaw: number,
  localX: number,
  localZ: number,
): MonasteryEstatePoint {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: x + localX * cos + localZ * sin,
    z: z - localX * sin + localZ * cos,
  };
}

export function monasteryEstateFootprintCorners(
  x: number,
  z: number,
  yaw: number,
): [MonasteryEstatePoint, MonasteryEstatePoint, MonasteryEstatePoint, MonasteryEstatePoint] {
  return [
    estateWorldPoint(x, z, yaw, -MONASTERY_ESTATE_HALF_WIDTH, -MONASTERY_ESTATE_REAR_DEPTH),
    estateWorldPoint(x, z, yaw, MONASTERY_ESTATE_HALF_WIDTH, -MONASTERY_ESTATE_REAR_DEPTH),
    estateWorldPoint(x, z, yaw, MONASTERY_ESTATE_HALF_WIDTH, MONASTERY_ESTATE_FRONT_DEPTH),
    estateWorldPoint(x, z, yaw, -MONASTERY_ESTATE_HALF_WIDTH, MONASTERY_ESTATE_FRONT_DEPTH),
  ];
}

/** Dense samples used for road, water, and physical-deposit exclusion. */
export function sampleMonasteryEstatePoints(
  x: number,
  z: number,
  yaw: number,
  spacing = 5.5,
): MonasteryEstatePoint[] {
  const points: MonasteryEstatePoint[] = [];
  const columns = Math.ceil(MONASTERY_ESTATE_WIDTH / spacing);
  const rows = Math.ceil(MONASTERY_ESTATE_DEPTH / spacing);
  for (let column = 0; column <= columns; column += 1) {
    const localX = -MONASTERY_ESTATE_HALF_WIDTH
      + MONASTERY_ESTATE_WIDTH * column / columns;
    for (let row = 0; row <= rows; row += 1) {
      const localZ = -MONASTERY_ESTATE_REAR_DEPTH
        + MONASTERY_ESTATE_DEPTH * row / rows;
      points.push(estateWorldPoint(x, z, yaw, localX, localZ));
    }
  }
  return points;
}

export function monasteryEstateFitsMap(
  x: number,
  z: number,
  yaw: number,
  bounds: TerrainBounds,
): boolean {
  return monasteryEstateFootprintCorners(x, z, yaw).every((corner) =>
    corner.x >= bounds.minX + MONASTERY_ESTATE_MAP_INSET
    && corner.x <= bounds.maxX - MONASTERY_ESTATE_MAP_INSET
    && corner.z >= bounds.minZ + MONASTERY_ESTATE_MAP_INSET
    && corner.z <= bounds.maxZ - MONASTERY_ESTATE_MAP_INSET
  );
}

/** The complete fenced parcel, rather than the abbey centre, must sit in the frontier band. */
export function monasteryEstateIsNearMapEdge(
  x: number,
  z: number,
  yaw: number,
  bounds: TerrainBounds,
): boolean {
  const corners = monasteryEstateFootprintCorners(x, z, yaw);
  const minX = Math.min(...corners.map((corner) => corner.x));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const minZ = Math.min(...corners.map((corner) => corner.z));
  const maxZ = Math.max(...corners.map((corner) => corner.z));
  const nearestBoundaryGap = Math.min(
    minX - bounds.minX,
    bounds.maxX - maxX,
    minZ - bounds.minZ,
    bounds.maxZ - maxZ,
  );
  return nearestBoundaryGap <= MONASTERY_ESTATE_EDGE_BAND;
}

export function normalizeMonasteryEstateLevel(level: number | null | undefined): MonasteryEstateLevel {
  return Math.max(0, Math.min(3, Math.floor(level ?? 0))) as MonasteryEstateLevel;
}

export function normalizeMonasteryOrchardPlanting(
  planting: number | null | undefined,
): MonasteryOrchardPlanting {
  return planting === 1 ? 1 : 0;
}

export function normalizeMonasteryCroftPlanting(
  planting: number | null | undefined,
): MonasteryCroftPlanting {
  return planting === 1 ? 1 : 0;
}

export const MONASTERY_ESTATE_INVESTMENT_COSTS = [18, 42, 78] as const;
export const MONASTERY_ESTATE_YIELD_MULTIPLIERS = [1, 1.25, 1.55, 1.9] as const;
export const MONASTERY_INFIRMARY_BEDS = [4, 6, 8, 10] as const;
export const MONASTERY_INFIRMARY_RECOVERY_MULTIPLIERS = [1.25, 1.35, 1.45, 1.55] as const;
export const MONASTERY_INFIRMARY_MORTALITY_MULTIPLIERS = [0.8, 0.7, 0.6, 0.5] as const;
export const MONASTERY_SEED_ARCHIVE_TARGET_PER_CROP = [8, 12, 16, 20] as const;
export const MONASTERY_SCRIPTORIUM_RECOVERY_MULTIPLIERS = [0.9, 0.84, 0.78, 0.72] as const;
export const MONASTERY_INFIRMARY_FOOD_PER_BED_DAY = 0.6;

export function monasteryEstateNextInvestmentCost(
  level: number | null | undefined,
): number | null {
  const normalized = normalizeMonasteryEstateLevel(level);
  if (normalized >= 3) return null;
  return MONASTERY_ESTATE_INVESTMENT_COSTS[normalized as 0 | 1 | 2];
}

export function monasteryEstateYieldMultiplier(level: number | null | undefined): number {
  return MONASTERY_ESTATE_YIELD_MULTIPLIERS[normalizeMonasteryEstateLevel(level)];
}

export function monasteryInfirmaryBeds(level: number | null | undefined): number {
  return MONASTERY_INFIRMARY_BEDS[normalizeMonasteryEstateLevel(level)];
}

export function monasteryInfirmaryRecoveryMultiplier(level: number | null | undefined): number {
  return MONASTERY_INFIRMARY_RECOVERY_MULTIPLIERS[normalizeMonasteryEstateLevel(level)];
}

export function monasteryInfirmaryMortalityMultiplier(level: number | null | undefined): number {
  return MONASTERY_INFIRMARY_MORTALITY_MULTIPLIERS[normalizeMonasteryEstateLevel(level)];
}

export function monasterySeedArchiveTargetPerCrop(level: number | null | undefined): number {
  return MONASTERY_SEED_ARCHIVE_TARGET_PER_CROP[normalizeMonasteryEstateLevel(level)];
}

export function monasteryScriptoriumRecoveryMultiplier(level: number | null | undefined): number {
  return MONASTERY_SCRIPTORIUM_RECOVERY_MULTIPLIERS[normalizeMonasteryEstateLevel(level)];
}

export function monasteryEstateYields(
  level: number | null | undefined,
  orchardPlanting: number | null | undefined = 0,
  croftPlanting: number | null | undefined = 0,
): {
  apples: number;
  vegetables: number;
  eggs: number;
  milk: number;
  meat: number;
  honey: number;
  ale: number;
  cider: number;
  wine: number;
  cheese: number;
} {
  const normalized = normalizeMonasteryEstateLevel(level);
  const multiplier = monasteryEstateYieldMultiplier(normalized);
  const applesPlanted = normalizeMonasteryOrchardPlanting(orchardPlanting) === 0;
  const vegetablesPlanted = normalizeMonasteryCroftPlanting(croftPlanting) === 0;
  return {
    apples: applesPlanted ? 0.75 * multiplier : 0,
    vegetables: vegetablesPlanted ? 0.5 * multiplier : 0,
    eggs: 0.42 * multiplier,
    milk: 0.45 * multiplier,
    meat: 0.16 * multiplier,
    honey: 0.22 * multiplier,
    ale: vegetablesPlanted ? 0 : 0.32 * multiplier,
    cider: applesPlanted && normalized >= 3 ? 0.16 * multiplier : 0,
    wine: applesPlanted ? 0 : 0.14 * multiplier,
    cheese: normalized >= 1 ? 0.18 * multiplier : 0,
  };
}
