import type { BuildingKind, BuildingState, BurgageZoneState, FarmFieldState, ForagingNodeState, PastureState, ResidenceState, ResourceNodeState, VineyardParcelState } from '../resources/types.ts';
import type { ResourceTotals } from '../resources/resourceTotals.ts';
import { buildingCostWithCarpenterSupport, hasRoadLinkedCarpenter } from '../economy/carpenterSupport.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import {
  MONASTERY_MIN_FOOTPRINT_SLOPE,
  TOWN_HALL_POPULATION_REQUIRED,
} from '../generated/gameBalance.ts';
import { hasStaffedChapel, MONASTERY_MIN_PARISH_POPULATION, parishPopulation } from '../logistics/specialtyLogistics.ts';
import {
  getBuildingFootprintCorners,
  sampleBuildingFootprintHeights,
  sampleBuildingFootprintPoints,
} from './BuildingTerrainLayout.ts';
import { buildingFootprintPolygon, buildingOverlapsResidenceZone } from '../placement/placementConflicts.ts';
import { convexPolygonsOverlap2 } from '../utils/polygonGeometry.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { isOnRoadSurface } from '../roads/roadConnectivity.ts';
import { getBuildingExtent } from './buildingExtents.ts';
import {
  clayDepositAtCenter,
  type ClayDepositSite,
} from '../clay/ClayDepositLayout.ts';
import {
  BERRY_PATCH_MAX_SPAWN_RADIUS,
  MUSHROOM_PATCH_MAX_SPAWN_RADIUS,
} from '../foraging/foragingYields.ts';
import { berryThicketRadiusScale } from '../foraging/berryPatchPresentation.ts';
import {
  polygonOverlapsCircle,
  RICH_CLAY_DEPOSIT_PROTECTION_RADIUS,
  RICH_MINERAL_DEPOSIT_PROTECTION_RADIUS,
  RICH_STONE_DEPOSIT_PROTECTION_RADIUS,
} from '../resources/physicalDepositProtection.ts';
import { buildingPlacementYaw } from './buildingPlacement.ts';
import { buildingFootprintsTooClose } from './BuildingSpacing.ts';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import {
  monasteryEstateFitsMap,
  monasteryEstateIsNearMapEdge,
  sampleMonasteryEstatePoints,
} from './monasteryEstate.ts';

export type BuildingPlacementFailureReason =
  | 'water'
  | 'requires_shore'
  | 'requires_hillside'
  | 'too_steep'
  | 'too_close'
  | 'overlapping_extent'
  | 'within_residence_zone'
  | 'within_farm_field'
  | 'within_pasture'
  | 'within_vineyard'
  | 'on_resource_deposit'
  | 'no_quarry_in_range'
  | 'requires_rich_deposit'
  | 'requires_mineral_deposit'
  | 'requires_clay_deposit'
  | 'no_game_in_range'
  | 'no_berries_in_range'
  | 'no_fish_in_range'
  | 'no_trees_in_range'
  | 'on_road'
  | 'outside_map'
  | 'requires_map_edge'
  | 'insufficient_resources'
  | 'requires_completed_watchtower'
  | 'requires_completed_guardhouse'
  | 'requires_staffed_chapel'
  | 'requires_parish_population'
  | 'town_hall_exists'
  | 'requires_town_hall_population'
  | 'requires_completed_chapel'
  | 'requires_completed_marketplace'
  | 'requires_civic_road_link'
  | 'requires_remote_worksite'
  | 'outside_remote_worksite_range'
  | 'remote_camp_exists';

export type BuildingPlacementResult =
  | { ok: true }
  | { ok: false; reason: BuildingPlacementFailureReason };

const MAX_FOOTPRINT_HEIGHT_DELTA = 9.5;
type BuildingPlacementContext = {
  buildings: Iterable<BuildingState>;
  residences: Iterable<ResidenceState>;
  burgageZones: Iterable<BurgageZoneState>;
  farmFields?: Iterable<FarmFieldState>;
  pastures?: Iterable<PastureState>;
  vineyardParcels?: Iterable<VineyardParcelState>;
  quarries: Iterable<ResourceNodeState>;
  foragingNodes: Iterable<ForagingNodeState>;
  clayDepositSites?: readonly ClayDepositSite[];
  stockpile: Pick<ResourceTotals, 'timber' | 'stone' | 'ironwork'>;
  isWaterAt: (x: number, z: number) => boolean;
  isResourceDepositAt?: (x: number, z: number) => boolean;
  getNaturalHeightAt: (x: number, z: number) => number;
  countMatureTreesInRadius?: (x: number, z: number, radius: number) => number | null;
  roadNetwork?: RoadNetwork;
  mapBounds?: TerrainBounds;
  fireDisabledBuildingIds?: ReadonlySet<string>;
};

export function validateBuildingPlacement(
  kind: BuildingKind,
  x: number,
  z: number,
  context: BuildingPlacementContext,
): BuildingPlacementResult {
  // Placement performs several independent checks over the same snapshot.
  // Materialize one-shot Map iterators once so prerequisite and separation
  // checks cannot accidentally see an exhausted collection.
  const buildings = [...context.buildings];
  const quarries = [...context.quarries];
  const foragingNodes = [...context.foragingNodes];
  const onClaySite = kind === 'clay_pit'
    && clayDepositAtCenter(context.clayDepositSites ?? [], x, z) !== null;
  const onClayDeposit = onClaySite
    && hasUsableClayDepositAtCenter(x, z, quarries);
  const fishingFootprintTouchesWater = kind === 'fishing_camp'
    && sampleBuildingFootprintPoints(kind, x, z, context.roadNetwork)
      .some((point) => context.isWaterAt(point.x, point.z));
  if (
    kind !== 'large_quarry'
    && !onClaySite
    && (context.isWaterAt(x, z) || fishingFootprintTouchesWater)
  ) {
    return { ok: false, reason: 'water' };
  }

  if (kind === 'monastery' && context.mapBounds) {
    const yaw = buildingPlacementYaw(kind, x, z, context.roadNetwork);
    if (!monasteryEstateFitsMap(x, z, yaw, context.mapBounds)) {
      return { ok: false, reason: 'outside_map' };
    }
    if (!monasteryEstateIsNearMapEdge(x, z, yaw, context.mapBounds)) {
      return { ok: false, reason: 'requires_map_edge' };
    }
  }

  if (
    getBuildingDefinition(kind).requiresWaterShore
    && !onClaySite
    && !isNearOpenWater(x, z, context.isWaterAt)
  ) {
    return { ok: false, reason: 'requires_shore' };
  }

  if (getBuildingDefinition(kind).requiresHillside) {
    const slope = footprintHeightDelta(
      kind,
      x,
      z,
      context.getNaturalHeightAt,
      context.roadNetwork,
    );
    if (slope < MONASTERY_MIN_FOOTPRINT_SLOPE) {
      return { ok: false, reason: 'requires_hillside' };
    }
    if (slope > MAX_FOOTPRINT_HEIGHT_DELTA) {
      return { ok: false, reason: 'too_steep' };
    }
  } else if (
    kind !== 'large_quarry'
    && kind !== 'mine'
    && isFootprintTooUneven(kind, x, z, context.getNaturalHeightAt, context.roadNetwork)
  ) {
    return { ok: false, reason: 'too_steep' };
  }

  if (context.roadNetwork && buildingFootprintOverlapsRoadSurface(kind, x, z, context.roadNetwork)) {
    return { ok: false, reason: 'on_road' };
  }

  if (buildingFootprintOverlapsStaticForagingResource(
    kind,
    x,
    z,
    foragingNodes,
    context.roadNetwork,
  )) {
    return { ok: false, reason: 'on_resource_deposit' };
  }

  if (
    kind !== 'large_quarry'
    && kind !== 'mine'
    && kind !== 'clay_pit'
    && (kind === 'monastery'
      ? monasteryEstateSamples(kind, x, z, context.roadNetwork)
        .some((point) => context.isResourceDepositAt?.(point.x, point.z) === true)
      : context.isResourceDepositAt?.(x, z))
  ) {
    return { ok: false, reason: 'on_resource_deposit' };
  }

  if (buildingOverlapsResidenceZone(
    kind,
    x,
    z,
    context.burgageZones,
    context.roadNetwork,
  )) {
    return { ok: false, reason: 'within_residence_zone' };
  }

  const footprint = buildingFootprintPolygon(x, z, kind, context.roadNetwork);
  for (const field of context.farmFields ?? []) {
    if (convexPolygonsOverlap2(footprint, field.corners)) {
      return { ok: false, reason: 'within_farm_field' };
    }
  }
  for (const pasture of context.pastures ?? []) {
    if (convexPolygonsOverlap2(footprint, pasture.corners)) {
      return { ok: false, reason: 'within_pasture' };
    }
  }

  if (overlapsSameKindFunctionalExtent(kind, x, z, buildings)) {
    return { ok: false, reason: 'overlapping_extent' };
  }

  if (
    kind === 'guardhouse'
    && !hasCompletedBuilding(buildings, 'watchtower')
  ) {
    return { ok: false, reason: 'requires_completed_watchtower' };
  }

  if (
    kind === 'palisaded_refuge'
    && !hasCompletedBuilding(buildings, 'guardhouse')
  ) {
    return { ok: false, reason: 'requires_completed_guardhouse' };
  }

  if (kind === 'monastery') {
    if (!hasStaffedChapel(buildings)) {
      return { ok: false, reason: 'requires_staffed_chapel' };
    }
    if (parishPopulation(context.residences) < MONASTERY_MIN_PARISH_POPULATION) {
      return { ok: false, reason: 'requires_parish_population' };
    }
  }
  for (const vineyard of context.vineyardParcels ?? []) {
    if (convexPolygonsOverlap2(footprint, vineyard.corners)) {
      return { ok: false, reason: 'within_vineyard' };
    }
  }

  if (kind === 'town_hall') {
    if (buildings.some((building) => building.kind === 'town_hall')) {
      return { ok: false, reason: 'town_hall_exists' };
    }
    if (parishPopulation(context.residences) < TOWN_HALL_POPULATION_REQUIRED) {
      return { ok: false, reason: 'requires_town_hall_population' };
    }
    const chapels = buildings.filter(
      (building) => building.kind === 'chapel'
        && building.constructionComplete !== false,
    );
    if (chapels.length === 0) {
      return { ok: false, reason: 'requires_completed_chapel' };
    }
    const marketplaces = buildings.filter(
      (building) => building.kind === 'marketplace'
        && building.constructionComplete !== false,
    );
    if (marketplaces.length === 0) {
      return { ok: false, reason: 'requires_completed_marketplace' };
    }
    const civicLandmarks = [...chapels, ...marketplaces];
    const distances = context.roadNetwork?.getPathfinder().roadPathDistancesFrom(
      x,
      z,
      civicLandmarks,
    );
    let linkedChapel = false;
    let linkedMarketplace = false;
    for (let index = 0; index < (distances?.length ?? 0); index += 1) {
      if (distances?.[index] == null) continue;
      if (index < chapels.length) linkedChapel = true;
      else linkedMarketplace = true;
      if (linkedChapel && linkedMarketplace) break;
    }
    if (!linkedChapel || !linkedMarketplace) {
      return { ok: false, reason: 'requires_civic_road_link' };
    }
  }

  if (kind === 'stone_quarry' && !hasSurfaceDepositInRadius(x, z, getBuildingDefinition(kind).workRadius, quarries)) {
    return { ok: false, reason: 'no_quarry_in_range' };
  }

  if (kind === 'large_quarry' && !hasRichDepositAtCenter(x, z, quarries)) {
    return { ok: false, reason: 'requires_rich_deposit' };
  }

  if (kind === 'mine' && !hasMineralDepositAtCenter(x, z, quarries)) {
    return { ok: false, reason: 'requires_mineral_deposit' };
  }

  if (kind === 'clay_pit' && !onClayDeposit) {
    return { ok: false, reason: 'requires_clay_deposit' };
  }

  if (kind === 'hunters_hall' && !hasForagingInRadius(x, z, getBuildingDefinition(kind).workRadius, 'game', foragingNodes)) {
    return { ok: false, reason: 'no_game_in_range' };
  }

  if (
    kind === 'foragers_shed'
    && !hasAnyForagingInRadius(
      x,
      z,
      getBuildingDefinition(kind).workRadius,
      ['berries', 'mushrooms'],
      foragingNodes,
    )
  ) {
    return { ok: false, reason: 'no_berries_in_range' };
  }

  if (kind === 'fishing_camp' && !hasForagingInRadius(x, z, getBuildingDefinition(kind).workRadius, 'fish', foragingNodes)) {
    return { ok: false, reason: 'no_fish_in_range' };
  }

  if (kind === 'lumber_mill') {
    const workRadius = getBuildingDefinition(kind).workRadius;
    const matureTrees = context.countMatureTreesInRadius?.(x, z, workRadius) ?? 0;
    if (matureTrees <= 0) {
      return { ok: false, reason: 'no_trees_in_range' };
    }
  }

  const carpenterSupported = hasRoadLinkedCarpenter(
    buildings,
    context.roadNetwork,
    { x, z },
    context.fireDisabledBuildingIds,
  );
  const cost = buildingCostWithCarpenterSupport(kind, carpenterSupported);
  if (
    context.stockpile.timber + 1e-6 < cost.timber
    || context.stockpile.stone + 1e-6 < cost.stone
    || context.stockpile.ironwork + 1e-6 < (cost.ironwork ?? 0)
  ) {
    return { ok: false, reason: 'insufficient_resources' };
  }

  for (const building of buildings) {
    if (buildingFootprintsTooClose(kind, x, z, building, context.roadNetwork)) {
      return { ok: false, reason: 'too_close' };
    }
  }

  return { ok: true };
}

function hasCompletedBuilding(
  buildings: Iterable<BuildingState>,
  kind: BuildingKind,
): boolean {
  for (const building of buildings) {
    if (
      building.kind === kind
      && building.constructionComplete !== false
    ) {
      return true;
    }
  }
  return false;
}

const RESOURCE_CENTER_TOLERANCE = 2.5;

export function resolveBuildingPlacementPoint(
  kind: BuildingKind,
  x: number,
  z: number,
  quarries: Iterable<ResourceNodeState>,
): { x: number; z: number } {
  if (kind !== 'large_quarry' && kind !== 'mine') return { x, z };
  let nearest: ResourceNodeState | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const deposit of quarries) {
    if (
      kind === 'mine'
        ? deposit.resource !== 'iron' && deposit.resource !== 'salt'
        : deposit.isRich !== true
    ) continue;
    const distance = Math.hypot(deposit.x - x, deposit.z - z);
    if (distance >= nearestDistance) continue;
    nearest = deposit;
    nearestDistance = distance;
  }
  const snapRadius = nearest?.resource === 'stone'
    ? RICH_STONE_DEPOSIT_PROTECTION_RADIUS
    : nearest?.resource === 'clay'
      ? RICH_CLAY_DEPOSIT_PROTECTION_RADIUS
      : RICH_MINERAL_DEPOSIT_PROTECTION_RADIUS;
  return nearest?.isRich === true
    && nearestDistance <= snapRadius
    ? { x: nearest.x, z: nearest.z }
    : { x, z };
}

function hasUsableClayDepositAtCenter(
  x: number,
  z: number,
  deposits: Iterable<ResourceNodeState>,
): boolean {
  for (const deposit of deposits) {
    if (deposit.resource !== 'clay') continue;
    if (deposit.isRich !== true && deposit.remaining <= 0) continue;
    if (Math.hypot(deposit.x - x, deposit.z - z) <= RESOURCE_CENTER_TOLERANCE) {
      return true;
    }
  }
  return false;
}

function hasRichDepositAtCenter(
  x: number,
  z: number,
  quarries: Iterable<ResourceNodeState>,
): boolean {
  for (const quarry of quarries) {
    if (!quarry.isRich) continue;
    if (Math.hypot(quarry.x - x, quarry.z - z) <= RESOURCE_CENTER_TOLERANCE) {
      return true;
    }
  }
  return false;
}

function hasMineralDepositAtCenter(
  x: number,
  z: number,
  quarries: Iterable<ResourceNodeState>,
): boolean {
  for (const deposit of quarries) {
    if (
      deposit.resource !== 'iron'
      && deposit.resource !== 'salt'
    ) {
      continue;
    }
    if (!deposit.isRich && deposit.remaining <= 0) continue;
    if (Math.hypot(deposit.x - x, deposit.z - z) <= RESOURCE_CENTER_TOLERANCE) {
      return true;
    }
  }
  return false;
}

const SHORE_RADIAL_SAMPLE_STEP = 2;
const SHORE_ARC_SAMPLE_SPACING = 4;

function isNearOpenWater(
  x: number,
  z: number,
  isWaterAt: (x: number, z: number) => boolean,
  maxDistance = 24,
): boolean {
  const ringCount = Math.ceil(maxDistance / SHORE_RADIAL_SAMPLE_STEP);
  for (let ring = 1; ring <= ringCount; ring++) {
    const radius = Math.min(maxDistance, ring * SHORE_RADIAL_SAMPLE_STEP);
    const sampleCount = Math.max(12, Math.ceil(Math.PI * 2 * radius / SHORE_ARC_SAMPLE_SPACING));
    for (let i = 0; i < sampleCount; i++) {
      const angle = i * Math.PI * 2 / sampleCount;
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
  roadNetwork?: RoadNetwork,
): boolean {
  return footprintHeightDelta(kind, x, z, getNaturalHeightAt, roadNetwork)
    > MAX_FOOTPRINT_HEIGHT_DELTA;
}

function footprintHeightDelta(
  kind: BuildingKind,
  x: number,
  z: number,
  getNaturalHeightAt: (x: number, z: number) => number,
  roadNetwork?: RoadNetwork,
): number {
  const heights = sampleBuildingFootprintHeights(kind, x, z, getNaturalHeightAt, roadNetwork);
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

function hasSurfaceDepositInRadius(
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
  nodeKind: 'game' | 'berries' | 'mushrooms' | 'fish',
  nodes: Iterable<ForagingNodeState>,
  includeDepleted = false,
): boolean {
  for (const node of nodes) {
    if (node.kind !== nodeKind || (!includeDepleted && node.remaining <= 0)) continue;
    if (Math.hypot(node.x - x, node.z - z) <= radius) {
      return true;
    }
  }
  return false;
}

function hasAnyForagingInRadius(
  x: number,
  z: number,
  radius: number,
  nodeKinds: ReadonlyArray<'game' | 'berries' | 'mushrooms' | 'fish'>,
  nodes: Iterable<ForagingNodeState>,
): boolean {
  const acceptedKinds = new Set(nodeKinds);
  for (const node of nodes) {
    if (!acceptedKinds.has(node.kind)) continue;
    if (Math.hypot(node.x - x, node.z - z) <= radius) {
      return true;
    }
  }
  return false;
}

export function buildingFootprintOverlapsRoadSurface(
  kind: BuildingKind,
  x: number,
  z: number,
  roadNetwork: RoadNetwork,
): boolean {
  for (const point of monasteryEstateSamples(kind, x, z, roadNetwork)) {
    if (isOnRoadSurface(point.x, point.z, roadNetwork)) return true;
  }
  return false;
}

function monasteryEstateSamples(
  kind: BuildingKind,
  x: number,
  z: number,
  roadNetwork?: RoadNetwork | null,
): Array<{ x: number; z: number }> {
  if (kind !== 'monastery') return sampleBuildingFootprintPoints(kind, x, z, roadNetwork);
  const yaw = buildingPlacementYaw(kind, x, z, roadNetwork);
  return sampleMonasteryEstatePoints(x, z, yaw);
}

function buildingFootprintOverlapsStaticForagingResource(
  kind: BuildingKind,
  x: number,
  z: number,
  nodes: Iterable<ForagingNodeState>,
  roadNetwork?: RoadNetwork | null,
): boolean {
  const yaw = buildingPlacementYaw(kind, x, z, roadNetwork);
  const footprint = getBuildingFootprintCorners(kind, x, z, yaw);
  for (const node of nodes) {
    const radius = node.kind === 'berries'
      ? BERRY_PATCH_MAX_SPAWN_RADIUS * berryThicketRadiusScale(node.isRich === true)
      : node.kind === 'mushrooms'
        ? MUSHROOM_PATCH_MAX_SPAWN_RADIUS
        : 0;
    if (radius <= 0) continue;
    if (polygonOverlapsCircle(footprint, node.x, node.z, radius)) return true;
  }
  return false;
}

/** Pick the first cursor-ordered verge whose complete footprint clears roads. */
export function chooseRoadClearBuildingPlacement(
  kind: BuildingKind,
  candidates: ReadonlyArray<{ x: number; z: number }>,
  roadNetwork: RoadNetwork,
): { x: number; z: number } | null {
  return candidates.find((candidate) =>
    !buildingFootprintOverlapsRoadSurface(kind, candidate.x, candidate.z, roadNetwork)
  ) ?? null;
}
