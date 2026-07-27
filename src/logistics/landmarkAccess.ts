import type { BuildingKind, BuildingState, ResidenceState } from '../resources/types.ts';
import { MONASTERY_COVERAGE_RADIUS } from '../generated/gameBalance.ts';
import { compareStableEntityIds } from './roadLogistics.ts';

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
    if (!isChapelStaffed(chapel)) {
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
): boolean {
  return hasRoadPathToBuildingKind(buildings, residence.x, residence.z, 'marketplace', probe);
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
  for (const monastery of monasteries) {
    if (monastery.kind !== 'monastery' || monastery.constructionComplete === false) {
      continue;
    }
    if (!monasteryLinkedToChapel(monastery, chapels, probe)) {
      continue;
    }
    const distance = probe(residence.x, residence.z, monastery.x, monastery.z);
    if (distance == null || distance > MONASTERY_COVERAGE_RADIUS) {
      continue;
    }
    if (!best || compareStableEntityIds(monastery.id, best.id) < 0) {
      best = monastery;
    }
  }
  return best;
}

export function isResidenceInMonasteryCoverage(
  residence: ResidenceState,
  monasteries: Iterable<BuildingState>,
  chapels: Iterable<BuildingState>,
  probe: RoadPathProbe,
): boolean {
  return findLinkedMonasteryInCoverage(residence, monasteries, chapels, probe) != null;
}
