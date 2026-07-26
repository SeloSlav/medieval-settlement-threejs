import { RESIDENCE_FIREWOOD_CAPACITY, RESIDENCE_WATER_CAPACITY } from '../generated/gameBalance.ts';
import { getNeedStock, hasNeedStockRoom } from '../residences/residenceNeedState.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import { residenceFirewoodRunwaySeconds } from './firewoodLogistics.ts';
import { isResidenceInWellRange, residenceWaterRunwaySeconds } from './waterLogistics.ts';

type RoadPoint = { x: number; z: number };

/** Mirrors server u64 ordering while preserving deterministic local fixture ids. */
export function compareStableEntityIds(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const numericA = BigInt(a);
    const numericB = BigInt(b);
    return numericA < numericB ? -1 : numericA > numericB ? 1 : 0;
  }
  return a.localeCompare(b);
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

export function isOperationalFirewoodSupplier(building: BuildingState): boolean {
  return building.constructionComplete !== false
    && building.assignedLabor > 0
    && (
      building.kind === 'woodcutters_lodge'
      || (building.kind === 'village_storehouse' && building.storehouseAcceptsFirewood)
    );
}

export function isOperationalWellSupplier(building: BuildingState): boolean {
  return building.kind === 'well'
    && building.constructionComplete !== false
    && building.assignedLabor > 0;
}

export const FOOD_SUPPLIER_KINDS: readonly BuildingState['kind'][] = [
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'granary',
  'apiary',
  'vineyard',
  'pastoral_farmstead',
  'swineherd',
  'monastery',
];

export function isOperationalFoodSupplier(building: BuildingState): boolean {
  return FOOD_SUPPLIER_KINDS.includes(building.kind)
    && building.constructionComplete !== false
    && (building.kind === 'monastery' || building.assignedLabor > 0);
}

export function claimResidencesForFirewoodSuppliers(
  network: RoadNetwork,
  suppliers: readonly BuildingState[],
  residences: readonly ResidenceState[],
): Map<string, string> {
  const claims = new Map<string, string>();
  const distributors = suppliers.filter(isOperationalFirewoodSupplier);

  for (const residence of residences) {
    let bestSupplier: BuildingState | null = null;
    let bestDistance = Infinity;
    for (const supplier of distributors) {
      const pathDistance = roadPathDistance(network, supplier.x, supplier.z, residence.x, residence.z);
      if (pathDistance == null) continue;
      if (
        pathDistance + 1e-6 < bestDistance
        || (
          Math.abs(pathDistance - bestDistance) <= 1e-6
          && bestSupplier
          && compareStableEntityIds(supplier.id, bestSupplier.id) < 0
        )
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && !bestSupplier)
      ) {
        bestDistance = pathDistance;
        bestSupplier = supplier;
      }
    }
    if (bestSupplier) claims.set(residence.id, bestSupplier.id);
  }

  return claims;
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
  const claims = new Map<string, string>();
  const activeWells = wells.filter(isOperationalWellSupplier);

  for (const residence of residences) {
    let bestWell: BuildingState | null = null;
    let bestDistance = Infinity;
    for (const well of activeWells) {
      if (!isResidenceInWellRange(well, residence)) continue;
      const pathDistance = roadPathDistance(network, well.x, well.z, residence.x, residence.z);
      if (pathDistance == null) continue;
      if (
        pathDistance + 1e-6 < bestDistance
        || (
          Math.abs(pathDistance - bestDistance) <= 1e-6
          && bestWell
          && compareStableEntityIds(well.id, bestWell.id) < 0
        )
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && !bestWell)
      ) {
        bestDistance = pathDistance;
        bestWell = well;
      }
    }
    if (bestWell) claims.set(residence.id, bestWell.id);
  }

  return claims;
}

export function claimResidencesForFoodSuppliers(
  network: RoadNetwork,
  suppliers: readonly BuildingState[],
  residences: readonly ResidenceState[],
  eligible: (
    supplier: BuildingState,
    residence: ResidenceState,
    roadDistance: number,
  ) => boolean = () => true,
): Map<string, string> {
  const claims = new Map<string, string>();
  // A staffed but empty seasonal producer must not strand nearby homes while a
  // stocked granary or holding can serve the same road branch.
  const foodSuppliers = suppliers.filter(
    (supplier) => isOperationalFoodSupplier(supplier) && supplier.food > 1e-6,
  );

  for (const residence of residences) {
    if (residence.abandoned || residence.population <= 0) continue;
    let bestSupplier: BuildingState | null = null;
    let bestDistance = Infinity;
    for (const supplier of foodSuppliers) {
      const pathDistance = roadPathDistance(network, supplier.x, supplier.z, residence.x, residence.z);
      if (pathDistance == null) continue;
      if (!eligible(supplier, residence, pathDistance)) continue;
      if (
        pathDistance + 1e-6 < bestDistance
        || (
          Math.abs(pathDistance - bestDistance) <= 1e-6
          && bestSupplier
          && compareStableEntityIds(supplier.id, bestSupplier.id) < 0
        )
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && !bestSupplier)
      ) {
        bestDistance = pathDistance;
        bestSupplier = supplier;
      }
    }
    if (bestSupplier) claims.set(residence.id, bestSupplier.id);
  }

  return claims;
}

export function sortByRoadPathDistance<T extends { x: number; z: number }>(
  network: RoadNetwork,
  origin: { x: number; z: number },
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const da = roadPathDistance(network, origin.x, origin.z, a.x, a.z) ?? Infinity;
    const db = roadPathDistance(network, origin.x, origin.z, b.x, b.z) ?? Infinity;
    return da - db;
  });
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
  const distanceA = roadPathDistance(network, lodge.x, lodge.z, a.x, a.z) ?? Infinity;
  const distanceB = roadPathDistance(network, lodge.x, lodge.z, b.x, b.z) ?? Infinity;
  if (Math.abs(distanceA - distanceB) > 1e-6) return distanceA - distanceB;
  return compareStableEntityIds(a.id, b.id);
}

export function sortResidencesForDelivery(
  network: RoadNetwork,
  lodge: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState[] {
  return [...residences].sort((a, b) => compareResidencesForDelivery(network, lodge, a, b));
}

/** O(n) peek at the next needy residence without sorting the full branch. */
export function peekNextDeliveryTarget(
  network: RoadNetwork,
  lodge: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState | null {
  let best: ResidenceState | null = null;
  for (const residence of residences) {
    if (!hasNeedStockRoom(getNeedStock(residence.needs, 'firewood'), RESIDENCE_FIREWOOD_CAPACITY)) continue;
    if (best == null || compareResidencesForDelivery(network, lodge, residence, best) < 0) {
      best = residence;
    }
  }
  return best;
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
  const distanceA = roadPathDistance(network, well.x, well.z, a.x, a.z) ?? Infinity;
  const distanceB = roadPathDistance(network, well.x, well.z, b.x, b.z) ?? Infinity;
  if (Math.abs(distanceA - distanceB) > 1e-6) return distanceA - distanceB;
  return compareStableEntityIds(a.id, b.id);
}

export function sortResidencesForWaterDelivery(
  network: RoadNetwork,
  well: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState[] {
  return [...residences].sort((a, b) => compareResidencesForWaterDelivery(network, well, a, b));
}

export function peekNextWaterDeliveryTarget(
  network: RoadNetwork,
  well: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState | null {
  let best: ResidenceState | null = null;
  for (const residence of residences) {
    if (!hasNeedStockRoom(getNeedStock(residence.needs, 'water'), RESIDENCE_WATER_CAPACITY)) continue;
    if (best == null || compareResidencesForWaterDelivery(network, well, residence, best) < 0) {
      best = residence;
    }
  }
  return best;
}
