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

export const MONASTERY_ESTATE_INVESTMENT_COSTS = [18, 42, 78] as const;
export const MONASTERY_ESTATE_YIELD_MULTIPLIERS = [1, 1.25, 1.55, 1.9] as const;

export function monasteryEstateNextInvestmentCost(
  level: number | null | undefined,
): number | null {
  return MONASTERY_ESTATE_INVESTMENT_COSTS[normalizeMonasteryEstateLevel(level)] ?? null;
}

export function monasteryEstateYieldMultiplier(level: number | null | undefined): number {
  return MONASTERY_ESTATE_YIELD_MULTIPLIERS[normalizeMonasteryEstateLevel(level)];
}
