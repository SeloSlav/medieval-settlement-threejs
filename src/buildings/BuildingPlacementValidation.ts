import type { BuildingKind, BuildingState, BurgageZoneState, FarmFieldState, ForagingNodeState, ResidenceState, ResourceNodeState } from '../resources/types.ts';
import type { ResourceTotals } from '../resources/resourceTotals.ts';
import { canAffordBuilding } from '../resources/buildingEconomy.ts';
import { buildingRequiresRoad } from '../resources/buildingPlacementPolicy.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { MONASTERY_MIN_FOOTPRINT_SLOPE } from '../generated/gameBalance.ts';
import { hasStaffedChapel, MONASTERY_MIN_PARISH_POPULATION, parishPopulation } from '../logistics/specialtyLogistics.ts';
import { sampleBuildingFootprintHeights } from './BuildingTerrainLayout.ts';
import { sampleBuildingFootprintPoints } from './BuildingTerrainLayout.ts';
import { buildingFootprintPolygon, buildingOverlapsResidenceZone } from '../placement/placementConflicts.ts';
import { convexPolygonsOverlap2 } from '../utils/polygonGeometry.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { hasRoadAccess, isOnRoadSurface } from '../roads/roadConnectivity.ts';
import { getBuildingExtent } from './buildingExtents.ts';

export type BuildingPlacementFailureReason =
  | 'water'
  | 'requires_shore'
  | 'requires_hillside'
  | 'too_steep'
  | 'too_close'
  | 'overlapping_extent'
  | 'within_residence_zone'
  | 'within_farm_field'
  | 'on_quarry_pit'
  | 'no_quarry_in_range'
  | 'no_game_in_range'
  | 'no_berries_in_range'
  | 'no_trees_in_range'
  | 'no_road_access'
  | 'on_road'
  | 'insufficient_resources'
  | 'requires_staffed_chapel'
  | 'requires_parish_population';

export type BuildingPlacementResult =
  | { ok: true }
  | { ok: false; reason: BuildingPlacementFailureReason };

const MAX_FOOTPRINT_HEIGHT_DELTA = 9.5;

type BuildingPlacementContext = {
  buildings: Iterable<BuildingState>;
  residences: Iterable<ResidenceState>;
  burgageZones: Iterable<BurgageZoneState>;
  farmFields?: Iterable<FarmFieldState>;
  quarries: Iterable<ResourceNodeState>;
  foragingNodes: Iterable<ForagingNodeState>;
  stockpile: Pick<ResourceTotals, 'timber' | 'stone'>;
  isWaterAt: (x: number, z: number) => boolean;
  isQuarryPitAt?: (x: number, z: number) => boolean;
  getNaturalHeightAt: (x: number, z: number) => number;
  countMatureTreesInRadius?: (x: number, z: number, radius: number) => number;
  roadNetwork?: RoadNetwork;
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

  if (getBuildingDefinition(kind).requiresWaterShore && !isNearOpenWater(x, z, context.isWaterAt)) {
    return { ok: false, reason: 'requires_shore' };
  }

  if (getBuildingDefinition(kind).requiresHillside) {
    const slope = footprintHeightDelta(kind, x, z, context.getNaturalHeightAt);
    if (slope < MONASTERY_MIN_FOOTPRINT_SLOPE) {
      return { ok: false, reason: 'requires_hillside' };
    }
    if (slope > MAX_FOOTPRINT_HEIGHT_DELTA) {
      return { ok: false, reason: 'too_steep' };
    }
  } else if (isFootprintTooUneven(kind, x, z, context.getNaturalHeightAt)) {
    return { ok: false, reason: 'too_steep' };
  }

  if (context.roadNetwork && buildingFootprintOverlapsRoadSurface(kind, x, z, context.roadNetwork)) {
    return { ok: false, reason: 'on_road' };
  }

  if (kind !== 'stone_quarry' && context.isQuarryPitAt?.(x, z)) {
    return { ok: false, reason: 'on_quarry_pit' };
  }

  if (buildingOverlapsResidenceZone(kind, x, z, context.burgageZones)) {
    return { ok: false, reason: 'within_residence_zone' };
  }

  const footprint = buildingFootprintPolygon(x, z, kind);
  for (const field of context.farmFields ?? []) {
    if (convexPolygonsOverlap2(footprint, field.corners)) {
      return { ok: false, reason: 'within_farm_field' };
    }
  }

  if (overlapsSameKindFunctionalExtent(kind, x, z, context.buildings)) {
    return { ok: false, reason: 'overlapping_extent' };
  }

  if (kind === 'stone_quarry' && !hasQuarryStoneInRadius(x, z, getBuildingDefinition(kind).workRadius, context.quarries)) {
    return { ok: false, reason: 'no_quarry_in_range' };
  }

  if (kind === 'hunters_hall' && !hasForagingInRadius(x, z, getBuildingDefinition(kind).workRadius, 'game', context.foragingNodes)) {
    return { ok: false, reason: 'no_game_in_range' };
  }

  if (kind === 'foragers_shed' && !hasForagingInRadius(x, z, getBuildingDefinition(kind).workRadius, 'berries', context.foragingNodes)) {
    return { ok: false, reason: 'no_berries_in_range' };
  }

  if (kind === 'lumber_mill') {
    const workRadius = getBuildingDefinition(kind).workRadius;
    const matureTrees = context.countMatureTreesInRadius?.(x, z, workRadius) ?? 0;
    if (matureTrees <= 0) {
      return { ok: false, reason: 'no_trees_in_range' };
    }
  }

  if (kind === 'monastery') {
    if (!hasStaffedChapel(context.buildings)) {
      return { ok: false, reason: 'requires_staffed_chapel' };
    }
    if (parishPopulation(context.residences) < MONASTERY_MIN_PARISH_POPULATION) {
      return { ok: false, reason: 'requires_parish_population' };
    }
  }

  if (
    buildingRequiresRoad(kind)
    && context.roadNetwork
    && !hasRoadAccess(x, z, context.roadNetwork)
  ) {
    return { ok: false, reason: 'no_road_access' };
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

function isNearOpenWater(x: number, z: number, isWaterAt: (x: number, z: number) => boolean): boolean {
  for (const radius of [10, 17, 24]) {
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI * 2 / 16;
      if (isWaterAt(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius)) return true;
    }
  }
  return false;
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
  return footprintHeightDelta(kind, x, z, getNaturalHeightAt) > MAX_FOOTPRINT_HEIGHT_DELTA;
}

function footprintHeightDelta(
  kind: BuildingKind,
  x: number,
  z: number,
  getNaturalHeightAt: (x: number, z: number) => number,
): number {
  const heights = sampleBuildingFootprintHeights(kind, x, z, getNaturalHeightAt);
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (const height of heights) {
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
  }
  return maxHeight - minHeight;
}

function overlapsSameKindFunctionalExtent(
  kind: BuildingKind,
  x: number,
  z: number,
  buildings: Iterable<BuildingState>,
): boolean {
  const definition = getBuildingDefinition(kind);
  const extent = getBuildingExtent(kind, definition.workRadius);
  if (!extent || extent.type === 'coverage') return false;

  for (const building of buildings) {
    if (building.kind !== kind) continue;
    const distance = Math.hypot(building.x - x, building.z - z);
    if (distance < extent.radius) {
      return true;
    }
  }
  return false;
}

function hasQuarryStoneInRadius(
  x: number,
  z: number,
  radius: number,
  quarries: Iterable<ResourceNodeState>,
): boolean {
  for (const quarry of quarries) {
    if (quarry.remaining <= 0) continue;
    if (Math.hypot(quarry.x - x, quarry.z - z) <= radius) {
      return true;
    }
  }
  return false;
}

function hasForagingInRadius(
  x: number,
  z: number,
  radius: number,
  nodeKind: 'game' | 'berries',
  nodes: Iterable<ForagingNodeState>,
): boolean {
  for (const node of nodes) {
    if (node.kind !== nodeKind || node.remaining <= 0) continue;
    if (Math.hypot(node.x - x, node.z - z) <= radius) {
      return true;
    }
  }
  return false;
}

function buildingFootprintOverlapsRoadSurface(
  kind: BuildingKind,
  x: number,
  z: number,
  roadNetwork: RoadNetwork,
): boolean {
  for (const point of sampleBuildingFootprintPoints(kind, x, z)) {
    if (isOnRoadSurface(point.x, point.z, roadNetwork)) return true;
  }
  return false;
}
