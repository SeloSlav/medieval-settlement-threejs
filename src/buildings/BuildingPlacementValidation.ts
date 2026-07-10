import type { BuildingKind, BuildingState, ResourceStockpile } from '../resources/types.ts';
import { canAffordBuilding } from '../resources/buildingEconomy.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { sampleBuildingFootprintHeights } from './BuildingTerrainLayout.ts';

export type BuildingPlacementFailureReason =
  | 'water'
  | 'too_steep'
  | 'too_close'
  | 'within_reforester_radius'
  | 'insufficient_resources';

export type BuildingPlacementResult =
  | { ok: true }
  | { ok: false; reason: BuildingPlacementFailureReason };

const MAX_FOOTPRINT_HEIGHT_DELTA = 9.5;

type BuildingPlacementContext = {
  buildings: Iterable<BuildingState>;
  stockpile: ResourceStockpile;
  isWaterAt: (x: number, z: number) => boolean;
  getNaturalHeightAt: (x: number, z: number) => number;
};

export function validateBuildingPlacement(
  kind: BuildingKind,
  x: number,
  z: number,
  context: BuildingPlacementContext,
): BuildingPlacementResult {
  if (context.isWaterAt(x, z)) {
    return { ok: false, reason: 'water' };
  }

  if (isFootprintTooUneven(kind, x, z, context.getNaturalHeightAt)) {
    return { ok: false, reason: 'too_steep' };
  }

  if (kind === 'reforester' && isWithinExistingReforesterRadius(x, z, context.buildings)) {
    return { ok: false, reason: 'within_reforester_radius' };
  }

  if (!canAffordBuilding(context.stockpile, kind)) {
    return { ok: false, reason: 'insufficient_resources' };
  }

  const definition = getBuildingDefinition(kind);
  const minSeparation = definition.pickRadius * 1.85;

  for (const building of context.buildings) {
    const other = getBuildingDefinition(building.kind);
    const required = Math.max(minSeparation, (definition.pickRadius + other.pickRadius) * 0.9);
    if (Math.hypot(building.x - x, building.z - z) < required) {
      return { ok: false, reason: 'too_close' };
    }
  }

  return { ok: true };
}

export function isBuildingPlacementValid(
  kind: BuildingKind,
  x: number,
  z: number,
  context: BuildingPlacementContext,
): boolean {
  return validateBuildingPlacement(kind, x, z, context).ok;
}

function isFootprintTooUneven(
  kind: BuildingKind,
  x: number,
  z: number,
  getNaturalHeightAt: (x: number, z: number) => number,
): boolean {
  const heights = sampleBuildingFootprintHeights(kind, x, z, getNaturalHeightAt);
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (const height of heights) {
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
  }
  return maxHeight - minHeight > MAX_FOOTPRINT_HEIGHT_DELTA;
}

function isWithinExistingReforesterRadius(
  x: number,
  z: number,
  buildings: Iterable<BuildingState>,
): boolean {
  for (const building of buildings) {
    if (building.kind !== 'reforester') continue;
    const distance = Math.hypot(building.x - x, building.z - z);
    if (distance < building.workRadius) {
      return true;
    }
  }
  return false;
}
