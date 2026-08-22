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
export type MonasteryOrchardPlanting = 0;
export type MonasteryCroftPlanting = 0;
export type MonasteryOrchardMaturity = 0 | 1 | 2;

export const MONASTERY_EXTENSION_INFIRMARY = 1;
export const MONASTERY_EXTENSION_SCRIPTORIUM = 2;
export const MONASTERY_EXTENSION_GUESTHOUSE = 4;
export const MONASTERY_EXTENSION_WORKSHOP = 8;
export const MONASTERY_EXTENSION_ALL = 15;
export const MONASTERY_ORCHARD_REPLANT_COST = 12;

export const MONASTERY_EXTENSIONS = [
  { value: MONASTERY_EXTENSION_INFIRMARY, label: 'Infirmary wing', cost: 24, payoff: 'Eight additional funded beds and stronger disease recovery' },
  { value: MONASTERY_EXTENSION_SCRIPTORIUM, label: 'Scriptorium and archive', cost: 28, payoff: 'Larger seed reserve and stronger fire-reconstruction records' },
  { value: MONASTERY_EXTENSION_GUESTHOUSE, label: 'Guesthouse', cost: 20, payoff: 'More pilgrims, gifts, and dependable hospitality' },
  { value: MONASTERY_EXTENSION_WORKSHOP, label: 'Estate workshop', cost: 30, payoff: 'Expanded storage, dairy, craft work, and stronger estate proceeds' },
] as const;

export const MONASTERY_ORCHARD_PLANTINGS = [
  { value: 0, label: 'Mixed apple and pear orchard', output: 'Estate fruit and preserves · folded into abstract proceeds' },
] as const;

export const MONASTERY_CROFT_PLANTINGS = [
  { value: 0, label: 'Kitchen gardens', output: 'Household provisions · folded into abstract proceeds' },
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

export function normalizeMonasteryExtensions(extensions: number | null | undefined): number {
  return Math.max(0, Math.floor(extensions ?? 0)) & MONASTERY_EXTENSION_ALL;
}

export function monasteryHasExtension(extensions: number | null | undefined, extension: number): boolean {
  return (normalizeMonasteryExtensions(extensions) & extension) !== 0;
}

export function monasteryExtensionCount(extensions: number | null | undefined): number {
  let remaining = normalizeMonasteryExtensions(extensions);
  let count = 0;
  while (remaining > 0) {
    count += remaining & 1;
    remaining >>= 1;
  }
  return count;
}

export function monasteryVisualEstateLevel(extensions: number | null | undefined): MonasteryEstateLevel {
  return Math.min(3, monasteryExtensionCount(extensions)) as MonasteryEstateLevel;
}

export function monasteryArchetype(
  orchardPlanting: number | null | undefined,
  croftPlanting: number | null | undefined,
): { name: string; payoff: string } {
  void orchardPlanting;
  void croftPlanting;
  return {
    name: 'Pauline monastic estate',
    payoff: 'Abstract estate proceeds, parish services, orchard cider, monastic mead, and physical vineyard wine',
  };
}

export function normalizeMonasteryOrchardPlanting(
  planting: number | null | undefined,
): MonasteryOrchardPlanting {
  void planting;
  return 0;
}

export function normalizeMonasteryCroftPlanting(
  planting: number | null | undefined,
): MonasteryCroftPlanting {
  void planting;
  return 0;
}

export function monasteryOrchardReplantingAllowed(month: number): boolean {
  return month === 11 || month === 12 || month === 1 || month === 2;
}

export function monasteryCroftChoiceAllowed(month: number): boolean {
  void month;
  return false;
}

export const MONASTERY_ESTATE_YIELD_MULTIPLIERS = [1, 1.15, 1.3, 1.5, 1.75] as const;
export const MONASTERY_INFIRMARY_FOOD_PER_BED_DAY = 0.6;

export function monasteryEstateNextInvestmentCost(
  extensions: number | null | undefined,
  nextExtension: number | null | undefined,
): number | null {
  const extension = MONASTERY_EXTENSIONS.find((entry) => entry.value === nextExtension);
  if (!extension || monasteryHasExtension(extensions, extension.value)) return null;
  return extension.cost;
}

export function monasteryEstateYieldMultiplier(extensions: number | null | undefined): number {
  return MONASTERY_ESTATE_YIELD_MULTIPLIERS[monasteryExtensionCount(extensions) as 0 | 1 | 2 | 3 | 4];
}

export function monasteryInfirmaryBeds(extensions: number | null | undefined, funding = 1): number {
  return 2 + (monasteryHasExtension(extensions, MONASTERY_EXTENSION_INFIRMARY)
    ? Math.round(8 * Math.max(0, Math.min(1, funding)))
    : 0);
}

export function monasteryInfirmaryRecoveryMultiplier(extensions: number | null | undefined, funding = 1): number {
  return 1.15 + (monasteryHasExtension(extensions, MONASTERY_EXTENSION_INFIRMARY)
    ? 0.4 * Math.max(0, Math.min(1, funding))
    : 0);
}

export function monasteryInfirmaryMortalityMultiplier(extensions: number | null | undefined, funding = 1): number {
  return 0.88 - (monasteryHasExtension(extensions, MONASTERY_EXTENSION_INFIRMARY)
    ? 0.38 * Math.max(0, Math.min(1, funding))
    : 0);
}

export function monasteryGuesthouseMultiplier(extensions: number | null | undefined, funding = 1): number {
  return 1 + (monasteryHasExtension(extensions, MONASTERY_EXTENSION_GUESTHOUSE)
    ? 0.35 * Math.max(0, Math.min(1, funding))
    : 0);
}

export function monasterySeedArchiveTargetPerCrop(extensions: number | null | undefined, funding = 1): number {
  return 8 + (monasteryHasExtension(extensions, MONASTERY_EXTENSION_SCRIPTORIUM)
    ? 12 * Math.max(0, Math.min(1, funding))
    : 0);
}

export function monasteryScriptoriumRecoveryMultiplier(extensions: number | null | undefined, funding = 1): number {
  return 0.92 - (monasteryHasExtension(extensions, MONASTERY_EXTENSION_SCRIPTORIUM)
    ? 0.2 * Math.max(0, Math.min(1, funding))
    : 0);
}

export function monasteryEstateYields(
  extensions: number | null | undefined,
  orchardPlanting: number | null | undefined = 0,
  croftPlanting: number | null | undefined = 0,
  orchardMaturity: number | null | undefined = 2,
): {
  apples: number;
  pears: number;
  vegetables: number;
  eggs: number;
  milk: number;
  meat: number;
  honey: number;
  ale: number;
  cider: number;
  mead: number;
  wine: number;
  cheese: number;
} {
  const normalizedExtensions = normalizeMonasteryExtensions(extensions);
  const multiplier = monasteryEstateYieldMultiplier(normalizedExtensions);
  const maturity = Math.max(0, Math.min(2, Math.floor(orchardMaturity ?? 2)));
  const orchardMultiplier = maturity === 0 ? 0 : maturity === 1 ? 0.55 : 1;
  const workshop = monasteryHasExtension(normalizedExtensions, MONASTERY_EXTENSION_WORKSHOP);
  void orchardPlanting;
  void croftPlanting;
  return {
    apples: 0.45 * multiplier * orchardMultiplier,
    pears: 0.3 * multiplier * orchardMultiplier,
    vegetables: 0.5 * multiplier,
    eggs: 0.42 * multiplier,
    milk: 0.45 * multiplier,
    meat: 0.16 * multiplier,
    honey: 0.22 * multiplier,
    ale: 0,
    cider: 0.16 * multiplier * orchardMultiplier * (workshop ? 1.25 : 1),
    mead: 0.18 * multiplier * (workshop ? 1.25 : 1),
    wine: 0,
    cheese: 0.18 * multiplier,
  };
}
