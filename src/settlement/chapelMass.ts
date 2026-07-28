import type { BuildingState, ResidenceState } from '../resources/types.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { PointXZ } from '../utils/pathGeometry.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import { hashStringSeed } from '../utils/random.ts';
import {
  claimResidenceRoutesByNearestSupplier,
  compareStableEntityIds,
  roadPathRoute,
} from '../logistics/roadLogistics.ts';

export const SUNDAY_MASS_START_HOUR = 8;
export const SUNDAY_MASS_END_HOUR = 11.5;

export function isSundayMassTime(
  clock: GameClock,
  staffedChapelAvailable: boolean,
): boolean {
  const hour = clock.hour + clock.minute / 60;
  return clock.isSunday
    && staffedChapelAvailable
    && hour >= SUNDAY_MASS_START_HOUR
    && hour < SUNDAY_MASS_END_HOUR;
}

export function chapelGatheringPoint(
  chapel: Pick<BuildingState, 'x' | 'z'>,
  personIdentity: string,
): PointXZ {
  const seed = hashStringSeed(`mass:${personIdentity}`);
  const angle = (seed % 4096) / 4096 * Math.PI * 2;
  const ring = (seed >>> 12) % 4;
  const radius = 5.4 + ring * 0.9;
  return {
    x: chapel.x + Math.sin(angle) * radius,
    z: chapel.z + Math.cos(angle) * radius,
  };
}

export type MassChapelClaim = {
  chapel: BuildingState;
  roadDistance: number;
};

export function operationalMassChapels(
  buildings: Iterable<BuildingState>,
  fireDisabledBuildingIds: ReadonlySet<string> = new Set(),
): BuildingState[] {
  return [...buildings]
    .filter((building) =>
      building.kind === 'chapel'
      && building.constructionComplete !== false
      && building.assignedLabor > 0
      && !fireDisabledBuildingIds.has(building.id)
    )
    .sort((a, b) => compareStableEntityIds(a.id, b.id));
}

/**
 * Mirrors the authoritative parish claim: one staffed, fire-safe chapel wins
 * by shortest exact road route. There is intentionally no radius cutoff.
 */
export function claimMassChapelForResidence(
  residence: ResidenceState,
  chapels: readonly BuildingState[],
  roadNetwork: RoadNetwork | null,
): MassChapelClaim | null {
  return claimMassChapelsForResidences(
    [residence],
    chapels,
    roadNetwork,
  ).get(residence.id) ?? null;
}

export function claimMassChapelsForResidences(
  residences: readonly ResidenceState[],
  chapels: readonly BuildingState[],
  roadNetwork: RoadNetwork | null,
): Map<string, MassChapelClaim> {
  if (!roadNetwork) return new Map();
  const eligibleResidences = residences.filter(
    (residence) => !residence.abandoned && residence.population > 0,
  );
  const claims = claimResidenceRoutesByNearestSupplier(
    roadNetwork,
    chapels,
    eligibleResidences,
    () => true,
  );
  const chapelsById = new Map(chapels.map((chapel) => [chapel.id, chapel]));
  return new Map(
    [...claims].flatMap(([residenceId, claim]) => {
      const chapel = chapelsById.get(claim.supplierId);
      return chapel
        ? [[residenceId, { chapel, roadDistance: claim.distance }]]
        : [];
    }),
  );
}

/**
 * Unhoused founders have no authoritative parish row or household tithe. They
 * can still attend visually when their camp is road-connected to a chapel.
 */
export function claimMassChapelFromPoint(
  origin: PointXZ,
  chapels: readonly BuildingState[],
  roadNetwork: RoadNetwork | null,
): MassChapelClaim | null {
  if (!roadNetwork) return null;
  let nearest: MassChapelClaim | null = null;
  for (const chapel of chapels) {
    const route = roadPathRoute(
      roadNetwork,
      origin.x,
      origin.z,
      chapel.x,
      chapel.z,
    );
    if (!route) continue;
    if (
      nearest == null
      || route.distance + 1e-6 < nearest.roadDistance
      || (
        Math.abs(route.distance - nearest.roadDistance) <= 1e-6
        && compareStableEntityIds(chapel.id, nearest.chapel.id) < 0
      )
    ) {
      nearest = { chapel, roadDistance: route.distance };
    }
  }
  return nearest;
}

export function chapelAttendancePath(
  origin: PointXZ,
  chapel: BuildingState,
  personIdentity: string,
  roadNetwork: RoadNetwork | null,
): PointXZ[] | null {
  if (!roadNetwork) return null;
  const destination = chapelGatheringPoint(chapel, personIdentity);
  const route = roadPathRoute(
    roadNetwork,
    origin.x,
    origin.z,
    chapel.x,
    chapel.z,
  );
  if (!route || route.polyline.length < 2) return null;
  const approach = route.polyline
    .slice(0, -1)
    .map((point) => ({ x: point.x, z: point.z }));
  return [
    ...approach,
    destination,
  ];
}
