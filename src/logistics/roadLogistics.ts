import {
  OFFROAD_DELIVERY_SPEED_MULTIPLIER,
  RESIDENCE_WATER_CAPACITY,
} from '../generated/gameBalance.ts';
import { getNeedStock, hasNeedStockRoom } from '../residences/residenceNeedState.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import { edibleFoodStock } from '../economy/foodInventory.ts';
import {
  residenceFirewoodRunwaySeconds,
  residenceNeedsPriorityFirewood,
} from './firewoodLogistics.ts';
import { isResidenceInWellRange, residenceWaterRunwaySeconds } from './waterLogistics.ts';

type RoadPoint = { x: number; z: number };

/** Mirrors server u64 ordering while preserving deterministic local fixture ids. */
export function compareStableEntityIds(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const numericA = BigInt(a);
    const numericB = BigInt(b);
    return numericA < numericB ? -1 : numericA > numericB ? 1 : 0;
  }
  // Entity ids are ASCII protocol identifiers. Ordinal comparison is both
  // deterministic across host locales and much cheaper inside 100k-pair
  // logistics candidate sorts than repeatedly constructing collation state.
  return a < b ? -1 : a > b ? 1 : 0;
}

export function roadPathRoute(
  network: RoadNetwork,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { distance: number; polyline: RoadPoint[] } | null {
  return network.getPathfinder().roadPathRoute(ax, az, bx, bz);
}

/** Travel distance along the road graph polyline (matches server trip movement). */
export function roadPathDistance(
  network: RoadNetwork,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number | null {
  return network.getPathfinder().roadPathDistance(ax, az, bx, bz);
}

/** Exact one-to-many distances with a pairwise fallback for lightweight test networks. */
export function roadPathDistancesFrom(
  network: RoadNetwork,
  ax: number,
  az: number,
  targets: readonly RoadPoint[],
): Array<number | null> {
  const pathfinder = network.getPathfinder();
  if (typeof pathfinder.roadPathDistancesFrom === 'function') {
    return pathfinder.roadPathDistancesFrom(ax, az, targets);
  }
  return targets.map((target) =>
    pathfinder.roadPathDistance(ax, az, target.x, target.z));
}

function effectiveDeliveryDistance(
  roadDistance: number | null,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number | null {
  if (roadDistance != null && Number.isFinite(roadDistance)) return roadDistance;
  const directDistance = Math.hypot(bx - ax, bz - az);
  if (!Number.isFinite(directDistance)) return null;
  return directDistance / Math.max(OFFROAD_DELIVERY_SPEED_MULTIPLIER, 1e-6);
}

function directLocalRouteAllowed(
  network: RoadNetwork,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  return typeof network.segmentAvoidsOpenWater !== 'function'
    || network.segmentAvoidsOpenWater(ax, az, bx, bz);
}

/**
 * Time-weighted local delivery distance. Disconnected destinations remain
 * reachable across open ground, while road routes are substantially faster.
 */
export function localDeliveryDistance(
  network: RoadNetwork,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number | null {
  const roadDistance = roadPathDistance(network, ax, az, bx, bz);
  if (roadDistance != null && Number.isFinite(roadDistance)) return roadDistance;
  if (!directLocalRouteAllowed(network, ax, az, bx, bz)) return null;
  return effectiveDeliveryDistance(null, ax, az, bx, bz);
}

export type LocalDeliveryRoute = {
  distance: number;
  polyline: RoadPoint[];
  speedMultiplier: number;
  offroad: boolean;
};

export function localDeliveryRoute(
  network: RoadNetwork,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): LocalDeliveryRoute | null {
  const roadRoute = roadPathRoute(network, ax, az, bx, bz);
  if (roadRoute && Number.isFinite(roadRoute.distance) && roadRoute.distance > 1e-6) {
    return { ...roadRoute, speedMultiplier: 1, offroad: false };
  }
  if (!directLocalRouteAllowed(network, ax, az, bx, bz)) return null;
  const distance = Math.hypot(bx - ax, bz - az);
  if (!Number.isFinite(distance) || distance <= 1e-6) return null;
  return {
    distance,
    polyline: [{ x: ax, z: az }, { x: bx, z: bz }],
    speedMultiplier: OFFROAD_DELIVERY_SPEED_MULTIPLIER,
    offroad: true,
  };
}

export function localDeliveryDistancesFrom(
  network: RoadNetwork,
  ax: number,
  az: number,
  targets: readonly RoadPoint[],
): Array<number | null> {
  const roadDistances = roadPathDistancesFrom(network, ax, az, targets);
  return targets.map((target, index) => {
    const roadDistance = roadDistances[index];
    if (roadDistance != null && Number.isFinite(roadDistance)) return roadDistance;
    if (!directLocalRouteAllowed(network, ax, az, target.x, target.z)) return null;
    return effectiveDeliveryDistance(null, ax, az, target.x, target.z);
  });
}

export function isOperationalFirewoodSupplier(building: BuildingState): boolean {
  return building.kind === 'marketplace'
    && building.constructionComplete !== false;
}

export function isOperationalWellSupplier(building: BuildingState): boolean {
  return building.kind === 'well'
    && building.constructionComplete !== false;
}

export const FOOD_SUPPLIER_KINDS: readonly BuildingState['kind'][] = [
  'marketplace',
];

export function isOperationalFoodSupplier(building: BuildingState): boolean {
  return FOOD_SUPPLIER_KINDS.includes(building.kind)
    && building.constructionComplete !== false;
}

export type ResidenceSupplierRouteClaim = {
  supplierId: string;
  distance: number;
};

export function claimResidenceRoutesByNearestSupplier(
  network: RoadNetwork,
  suppliers: readonly BuildingState[],
  residences: readonly ResidenceState[],
  candidateAllowed: (
    supplier: BuildingState,
    residence: ResidenceState,
    effectiveDistance: number,
  ) => boolean,
  requireConnectedRoad = false,
): Map<string, ResidenceSupplierRouteClaim> {
  const bestByResidence = new Map<string, ResidenceSupplierRouteClaim>();
  const targets = residences.map((residence) => ({
    x: residence.x,
    z: residence.z,
  }));

  for (const supplier of suppliers) {
    const distances = requireConnectedRoad
      ? roadPathDistancesFrom(network, supplier.x, supplier.z, targets)
      : localDeliveryDistancesFrom(network, supplier.x, supplier.z, targets);
    for (let index = 0; index < residences.length; index += 1) {
      const distance = distances[index];
      if (distance == null || !Number.isFinite(distance)) continue;
      const residence = residences[index];
      if (!candidateAllowed(supplier, residence, distance)) continue;
      const current = bestByResidence.get(residence.id);
      if (
        current == null
        || distance + 1e-6 < current.distance
        || (
          Math.abs(distance - current.distance) <= 1e-6
          && compareStableEntityIds(supplier.id, current.supplierId) < 0
        )
      ) {
        bestByResidence.set(residence.id, {
          supplierId: supplier.id,
          distance,
        });
      }
    }
  }

  return bestByResidence;
}

export function claimResidencesByNearestSupplier(
  network: RoadNetwork,
  suppliers: readonly BuildingState[],
  residences: readonly ResidenceState[],
  candidateAllowed: (
    supplier: BuildingState,
    residence: ResidenceState,
    effectiveDistance: number,
  ) => boolean,
  requireConnectedRoad = false,
): Map<string, string> {
  return new Map(
    [...claimResidenceRoutesByNearestSupplier(
      network,
      suppliers,
      residences,
      candidateAllowed,
      requireConnectedRoad,
    )].map(([residenceId, claim]) => [
      residenceId,
      claim.supplierId,
    ]),
  );
}

export function claimResidencesForFirewoodSuppliers(
  network: RoadNetwork,
  suppliers: readonly BuildingState[],
  residences: readonly ResidenceState[],
): Map<string, string> {
  const distributors = suppliers.filter(
    (supplier) => isOperationalFirewoodSupplier(supplier)
      && supplier.firewood + Math.max(0, supplier.charcoal ?? 0) > 1e-6,
  );
  return claimResidencesByNearestSupplier(
    network,
    distributors,
    residences,
    () => true,
    true,
  );
}

/** Compatibility wrapper for callers written before storehouse distribution. */
export function claimResidencesForLodges(
  network: RoadNetwork,
  suppliers: readonly BuildingState[],
  residences: readonly ResidenceState[],
): Map<string, string> {
  return claimResidencesForFirewoodSuppliers(network, suppliers, residences);
}

export function claimResidencesForWells(
  network: RoadNetwork,
  wells: readonly BuildingState[],
  residences: readonly ResidenceState[],
): Map<string, string> {
  const activeWells = wells.filter(isOperationalWellSupplier);
  return claimResidencesByNearestSupplier(
    network,
    activeWells,
    residences,
    (well, residence) => isResidenceInWellRange(well, residence),
    true,
  );
}

export function claimResidencesForFoodSuppliers(
  network: RoadNetwork,
  suppliers: readonly BuildingState[],
  residences: readonly ResidenceState[],
  eligible: (
    supplier: BuildingState,
    residence: ResidenceState,
    effectiveDistance: number,
  ) => boolean = () => true,
): Map<string, string> {
  // An empty seasonal producer must not strand nearby homes while a stocked
  // granary or holding can serve the same road branch.
  const foodSuppliers = suppliers.filter(
    (supplier) => isOperationalFoodSupplier(supplier) && edibleFoodStock(supplier) > 1e-6,
  );
  const occupiedResidences = residences.filter(
    (residence) =>
      residence.abandoned !== true
      && (residence.population == null || residence.population > 0),
  );
  return claimResidencesByNearestSupplier(
    network,
    foodSuppliers,
    occupiedResidences,
    eligible,
    true,
  );
}

export function sortByRoadPathDistance<T extends { x: number; z: number }>(
  network: RoadNetwork,
  origin: { x: number; z: number },
  items: T[],
): T[] {
  const routed = items.map((item, index) => ({ item, index, distance: Infinity }));
  const distances = localDeliveryDistancesFrom(network, origin.x, origin.z, items);
  for (let index = 0; index < routed.length; index += 1) {
    routed[index].distance = distances[index] ?? Infinity;
  }
  routed.sort((a, b) => a.distance - b.distance || a.index - b.index);
  return routed.map(({ item }) => item);
}

/** Lowest firewood runway first; tie-break by road-path distance, then residence id. */
export function compareResidencesForDelivery(
  network: RoadNetwork,
  lodge: { x: number; z: number },
  a: ResidenceState,
  b: ResidenceState,
): number {
  if (a.abandoned !== b.abandoned) {
    return a.abandoned ? 1 : -1;
  }
  const runwayA = residenceFirewoodRunwaySeconds(a) ?? Infinity;
  const runwayB = residenceFirewoodRunwaySeconds(b) ?? Infinity;
  if (Math.abs(runwayA - runwayB) > 1e-6) return runwayA - runwayB;
  const distanceA = localDeliveryDistance(network, lodge.x, lodge.z, a.x, a.z) ?? Infinity;
  const distanceB = localDeliveryDistance(network, lodge.x, lodge.z, b.x, b.z) ?? Infinity;
  if (Math.abs(distanceA - distanceB) > 1e-6) return distanceA - distanceB;
  return compareStableEntityIds(a.id, b.id);
}

export function sortResidencesForDelivery(
  network: RoadNetwork,
  lodge: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState[] {
  return sortResidencesByRunwayAndDistance(
    network,
    lodge,
    residences,
    residenceFirewoodRunwaySeconds,
  );
}

/** O(n) peek at the next needy residence without sorting the full branch. */
export function peekNextDeliveryTarget(
  network: RoadNetwork,
  lodge: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState | null {
  const eligible = residences.filter(residenceNeedsPriorityFirewood);
  const distances = localDeliveryDistancesFrom(network, lodge.x, lodge.z, eligible);
  let bestIndex = -1;
  for (let index = 0; index < eligible.length; index += 1) {
    if (distances[index] == null) continue;
    if (
      bestIndex < 0
      || compareDeliveryCandidates(
        eligible[index],
        distances[index]!,
        residenceFirewoodRunwaySeconds(eligible[index]),
        eligible[bestIndex],
        distances[bestIndex]!,
        residenceFirewoodRunwaySeconds(eligible[bestIndex]),
      ) < 0
    ) {
      bestIndex = index;
    }
  }
  return bestIndex < 0 ? null : eligible[bestIndex];
}

export function compareResidencesForWaterDelivery(
  network: RoadNetwork,
  well: { x: number; z: number },
  a: ResidenceState,
  b: ResidenceState,
): number {
  if (a.abandoned !== b.abandoned) {
    return a.abandoned ? 1 : -1;
  }
  const runwayA = residenceWaterRunwaySeconds(a) ?? Infinity;
  const runwayB = residenceWaterRunwaySeconds(b) ?? Infinity;
  if (Math.abs(runwayA - runwayB) > 1e-6) return runwayA - runwayB;
  const distanceA = localDeliveryDistance(network, well.x, well.z, a.x, a.z) ?? Infinity;
  const distanceB = localDeliveryDistance(network, well.x, well.z, b.x, b.z) ?? Infinity;
  if (Math.abs(distanceA - distanceB) > 1e-6) return distanceA - distanceB;
  return compareStableEntityIds(a.id, b.id);
}

export function sortResidencesForWaterDelivery(
  network: RoadNetwork,
  well: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState[] {
  return sortResidencesByRunwayAndDistance(
    network,
    well,
    residences,
    residenceWaterRunwaySeconds,
  );
}

export function peekNextWaterDeliveryTarget(
  network: RoadNetwork,
  well: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState | null {
  const eligible = residences.filter((residence) =>
    hasNeedStockRoom(
      getNeedStock(residence.needs, 'water'),
      RESIDENCE_WATER_CAPACITY,
    ));
  const distances = localDeliveryDistancesFrom(network, well.x, well.z, eligible);
  let bestIndex = -1;
  for (let index = 0; index < eligible.length; index += 1) {
    if (distances[index] == null) continue;
    if (
      bestIndex < 0
      || compareDeliveryCandidates(
        eligible[index],
        distances[index]!,
        residenceWaterRunwaySeconds(eligible[index]),
        eligible[bestIndex],
        distances[bestIndex]!,
        residenceWaterRunwaySeconds(eligible[bestIndex]),
      ) < 0
    ) {
      bestIndex = index;
    }
  }
  return bestIndex < 0 ? null : eligible[bestIndex];
}

function compareDeliveryCandidates(
  a: ResidenceState,
  distanceA: number,
  runwayA: number | null,
  b: ResidenceState,
  distanceB: number,
  runwayB: number | null,
): number {
  if (a.abandoned !== b.abandoned) return a.abandoned ? 1 : -1;
  const runwayOrder = (runwayA ?? Infinity) - (runwayB ?? Infinity);
  if (Math.abs(runwayOrder) > 1e-6) return runwayOrder;
  const distanceOrder = distanceA - distanceB;
  if (Math.abs(distanceOrder) > 1e-6) return distanceOrder;
  return compareStableEntityIds(a.id, b.id);
}

function sortResidencesByRunwayAndDistance(
  network: RoadNetwork,
  origin: { x: number; z: number },
  residences: readonly ResidenceState[],
  runwayFor: (residence: ResidenceState) => number | null,
): ResidenceState[] {
  const distances = localDeliveryDistancesFrom(network, origin.x, origin.z, residences);
  return residences
    .map((residence, index) => ({
      residence,
      distance: distances[index] ?? Infinity,
      runway: runwayFor(residence),
    }))
    .sort((a, b) =>
      compareDeliveryCandidates(
        a.residence,
        a.distance,
        a.runway,
        b.residence,
        b.distance,
        b.runway,
      ))
    .map(({ residence }) => residence);
}
