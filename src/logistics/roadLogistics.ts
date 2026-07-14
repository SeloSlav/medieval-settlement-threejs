import { RESIDENCE_FIREWOOD_CAPACITY, RESIDENCE_WATER_CAPACITY } from '../generated/gameBalance.ts';
import { getNeedStock, hasNeedStockRoom } from '../residences/residenceNeedState.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import { residenceFirewoodRunwaySeconds } from './firewoodLogistics.ts';
import { isResidenceInWellRange, residenceWaterRunwaySeconds } from './waterLogistics.ts';

type RoadPoint = { x: number; z: number };

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

export function claimResidencesForLodges(
  network: RoadNetwork,
  lodges: readonly BuildingState[],
  residences: readonly ResidenceState[],
): Map<string, string> {
  const claims = new Map<string, string>();
  const woodcutters = lodges.filter((building) => building.kind === 'woodcutters_lodge');

  for (const residence of residences) {
    let bestLodge: BuildingState | null = null;
    let bestDistance = Infinity;
    for (const lodge of woodcutters) {
      const pathDistance = roadPathDistance(network, lodge.x, lodge.z, residence.x, residence.z);
      if (pathDistance == null) continue;
      if (
        pathDistance + 1e-6 < bestDistance
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && bestLodge && lodge.id < bestLodge.id)
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && !bestLodge)
      ) {
        bestDistance = pathDistance;
        bestLodge = lodge;
      }
    }
    if (bestLodge) claims.set(residence.id, bestLodge.id);
  }

  return claims;
}

export function claimResidencesForWells(
  network: RoadNetwork,
  wells: readonly BuildingState[],
  residences: readonly ResidenceState[],
): Map<string, string> {
  const claims = new Map<string, string>();
  const activeWells = wells.filter((building) => building.kind === 'well');

  for (const residence of residences) {
    let bestWell: BuildingState | null = null;
    let bestDistance = Infinity;
    for (const well of activeWells) {
      if (!isResidenceInWellRange(well, residence)) continue;
      const pathDistance = roadPathDistance(network, well.x, well.z, residence.x, residence.z);
      if (pathDistance == null) continue;
      if (
        pathDistance + 1e-6 < bestDistance
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && bestWell && well.id < bestWell.id)
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
): Map<string, string> {
  const claims = new Map<string, string>();
  const foodSuppliers = suppliers.filter(
    (building) => building.kind === 'hunters_hall' || building.kind === 'foragers_shed',
  );

  for (const residence of residences) {
    let bestSupplier: BuildingState | null = null;
    let bestDistance = Infinity;
    for (const supplier of foodSuppliers) {
      const pathDistance = roadPathDistance(network, supplier.x, supplier.z, residence.x, residence.z);
      if (pathDistance == null) continue;
      if (
        pathDistance + 1e-6 < bestDistance
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && bestSupplier && supplier.id < bestSupplier.id)
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
  return a.id.localeCompare(b.id);
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
  return a.id.localeCompare(b.id);
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
