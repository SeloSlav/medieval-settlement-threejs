import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import type {
  BuildingKind,
  BuildingState,
  GameState,
  ResidenceState,
} from '../resources/types.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { MONASTERY_COVERAGE_RADIUS } from '../generated/gameBalance.ts';
import { requiredChapelTierForResidence } from '../residences/residenceNeedState.ts';
import {
  claimResidenceRoutesByNearestSupplier,
  compareStableEntityIds,
  type ResidenceSupplierRouteClaim,
} from './roadLogistics.ts';

export type RoadPathProbe = (ax: number, az: number, bx: number, bz: number) => number | null;

export function isRoadPathConnected(
  probe: RoadPathProbe,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  return probe(ax, az, bx, bz) != null;
}

export function isChapelStaffed(building: BuildingState): boolean {
  return building.kind === 'chapel'
    && building.constructionComplete !== false
    && building.assignedLabor > 0;
}

export function hasStaffedChapel(buildings: Iterable<BuildingState>): boolean {
  for (const building of buildings) {
    if (isChapelStaffed(building)) {
      return true;
    }
  }
  return false;
}

export function settlementHasStaffedChapel(
  state: Pick<GameState, 'buildings' | 'fireIncidents'>,
): boolean {
  const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
  for (const building of state.buildings.values()) {
    if (isChapelStaffed(building) && !fireDisabled.has(building.id)) {
      return true;
    }
  }
  return false;
}

/** Player-owned buildings only — mirrors server `owner_has_staffed_chapel` for the active identity. */
export function playerHasStaffedChapel(buildings: Iterable<BuildingState>): boolean {
  return hasStaffedChapel(buildings);
}

export function hasRoadPathToBuildingKind(
  buildings: Iterable<BuildingState>,
  ax: number,
  az: number,
  kind: BuildingKind,
  probe: RoadPathProbe,
  requireStaff = false,
): boolean {
  for (const building of buildings) {
    if (building.kind !== kind || building.constructionComplete === false) {
      continue;
    }
    if (requireStaff && building.assignedLabor <= 0) {
      continue;
    }
    if (isRoadPathConnected(probe, ax, az, building.x, building.z)) {
      return true;
    }
  }
  return false;
}

/** Mirrors `find_serving_chapel` in `server/src/simulation/landmark_access.rs`. */
export function findServingChapel(
  residence: ResidenceState,
  chapels: Iterable<BuildingState>,
  probe: RoadPathProbe,
): BuildingState | null {
  let best: BuildingState | null = null;
  let bestDistance = Infinity;
  for (const chapel of chapels) {
    if (
      !isChapelStaffed(chapel)
      || (chapel.chapelTier ?? 1) < requiredChapelTierForResidence(residence.tier)
    ) {
      continue;
    }
    const distance = probe(residence.x, residence.z, chapel.x, chapel.z);
    if (distance == null || !Number.isFinite(distance)) {
      continue;
    }
    if (
      distance + 1e-6 < bestDistance
      || (
        Math.abs(distance - bestDistance) <= 1e-6
        && (best == null || compareStableEntityIds(chapel.id, best.id) < 0)
      )
    ) {
      best = chapel;
      bestDistance = distance;
    }
  }
  return best;
}

export function isResidenceConnectedToMarketplace(
  residence: ResidenceState,
  buildings: Iterable<BuildingState>,
  probe: RoadPathProbe,
  stallKind: 'food' | 'goods' = 'food',
): boolean {
  const candidates = [...buildings];
  const workplaceKind = stallKind === 'food' ? 'granary' : 'village_storehouse';
  return candidates.some((marketplace) =>
    marketplace.kind === 'marketplace'
    && marketplace.constructionComplete !== false
    && isRoadPathConnected(
      probe,
      residence.x,
      residence.z,
      marketplace.x,
      marketplace.z,
    )
    && candidates.some((workplace) =>
      workplace.kind === workplaceKind
      && workplace.constructionComplete !== false
      && workplace.assignedLabor > 0
      && isRoadPathConnected(
        probe,
        workplace.x,
        workplace.z,
        marketplace.x,
        marketplace.z,
      )
    )
  );
}

export function isResidenceConnectedToChapel(
  residence: ResidenceState,
  buildings: Iterable<BuildingState>,
  probe: RoadPathProbe,
): boolean {
  return findServingChapel(residence, buildings, probe) != null;
}

export function monasteryLinkedToChapel(
  monastery: BuildingState,
  chapels: Iterable<BuildingState>,
  probe: RoadPathProbe,
): boolean {
  if (
    monastery.kind !== 'monastery'
    || monastery.constructionComplete === false
    || monastery.assignedLabor <= 0
  ) {
    return false;
  }
  for (const chapel of chapels) {
    if (!isChapelStaffed(chapel)) {
      continue;
    }
    if (isRoadPathConnected(probe, monastery.x, monastery.z, chapel.x, chapel.z)) {
      return true;
    }
  }
  return false;
}

/** Mirrors `find_linked_monastery_in_coverage` in `server/src/simulation/landmark_access.rs`. */
export function findLinkedMonasteryInCoverage(
  residence: ResidenceState,
  monasteries: Iterable<BuildingState>,
  chapels: Iterable<BuildingState>,
  probe: RoadPathProbe,
): BuildingState | null {
  if (!isResidenceConnectedToChapel(residence, chapels, probe)) {
    return null;
  }

  let best: BuildingState | null = null;
  let bestDistance = Infinity;
  for (const monastery of monasteries) {
    if (
      monastery.kind !== 'monastery'
      || monastery.constructionComplete === false
      || monastery.assignedLabor <= 0
    ) {
      continue;
    }
    if (!monasteryLinkedToChapel(monastery, chapels, probe)) {
      continue;
    }
    const distance = probe(residence.x, residence.z, monastery.x, monastery.z);
    if (distance == null || distance > MONASTERY_COVERAGE_RADIUS) {
      continue;
    }
    if (
      distance + 1e-6 < bestDistance
      || (
        Math.abs(distance - bestDistance) <= 1e-6
        && (!best || compareStableEntityIds(monastery.id, best.id) < 0)
      )
    ) {
      best = monastery;
      bestDistance = distance;
    }
  }
  return best;
}

export type ResidenceCommunityLandmarkClaims = {
  chapels: Map<string, ResidenceSupplierRouteClaim>;
  monasteries: Map<string, ResidenceSupplierRouteClaim>;
};

/**
 * Builds the client community territory with the same batched topology rule as
 * the authority: every eligible home belongs to its nearest staffed chapel,
 * then to its nearest completed chapel-linked monastery inside road coverage.
 *
 * Callers should pass only fire-safe buildings and residences. One Dijkstra
 * tree per landmark replaces pairwise route searches for every household.
 */
export function claimResidenceCommunityLandmarks(
  network: RoadNetwork,
  residences: readonly ResidenceState[],
  chapels: readonly BuildingState[],
  monasteries: readonly BuildingState[],
): ResidenceCommunityLandmarkClaims {
  const staffedChapels = chapels.filter(isChapelStaffed);
  const chapelClaims = claimResidenceRoutesByNearestSupplier(
    network,
    staffedChapels,
    residences,
    (chapel, residence) =>
      (chapel.chapelTier ?? 1) >= requiredChapelTierForResidence(residence.tier),
  );
  if (chapelClaims.size === 0 || staffedChapels.length === 0) {
    return {
      chapels: chapelClaims,
      monasteries: new Map(),
    };
  }

  const pathfinder = network.getPathfinder();
  const linkedMonasteries = monasteries.filter(
    (monastery) =>
      monastery.kind === 'monastery'
      && monastery.constructionComplete !== false
      && monastery.assignedLabor > 0
      && staffedChapels.some((chapel) =>
        pathfinder.roadConnected(
          monastery.x,
          monastery.z,
          chapel.x,
          chapel.z,
        )),
  );
  const monasteryClaims = claimResidenceRoutesByNearestSupplier(
    network,
    linkedMonasteries,
    residences,
    (_monastery, residence, distance) =>
      chapelClaims.has(residence.id)
      && distance <= MONASTERY_COVERAGE_RADIUS,
  );
  return {
    chapels: chapelClaims,
    monasteries: monasteryClaims,
  };
}

export function isResidenceInMonasteryCoverage(
  residence: ResidenceState,
  monasteries: Iterable<BuildingState>,
  chapels: Iterable<BuildingState>,
  probe: RoadPathProbe,
): boolean {
  return findLinkedMonasteryInCoverage(residence, monasteries, chapels, probe) != null;
}
