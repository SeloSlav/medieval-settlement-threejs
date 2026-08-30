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
export const SUNDAY_MASS_SERVICE_START_HOUR = 9;
export const SUNDAY_MASS_SERVICE_END_HOUR = 10.5;

export type ChapelMassPhase = 'assembly' | 'service' | 'fellowship';

export function chapelMassPhase(
  clock: Pick<GameClock, 'isSunday' | 'hour' | 'minute'>,
  staffedChapelAvailable: boolean,
): ChapelMassPhase | null {
  if (!clock.isSunday || !staffedChapelAvailable) return null;
  const hour = clock.hour + clock.minute / 60;
  if (hour < SUNDAY_MASS_START_HOUR || hour >= SUNDAY_MASS_END_HOUR) return null;
  if (hour < SUNDAY_MASS_SERVICE_START_HOUR) return 'assembly';
  if (hour < SUNDAY_MASS_SERVICE_END_HOUR) return 'service';
  return 'fellowship';
}

export function isSundayMassTime(
  clock: GameClock,
  staffedChapelAvailable: boolean,
): boolean {
  return chapelMassPhase(clock, staffedChapelAvailable) !== null;
}

export function chapelClergyGatheringPoint(
  chapel: Pick<BuildingState, 'x' | 'z'> & Partial<Pick<BuildingState, 'yaw'>>,
  clergySlot = 0,
): PointXZ {
  const rank = Math.ceil(clergySlot / 2);
  const side = clergySlot === 0 ? 0 : clergySlot % 2 === 1 ? -1 : 1;
  const localX = side * rank * 1.15;
  // The authored parish church entrance is at local Z ~= 8.3 m. Keep the
  // officiant beyond the steps so the outdoor sermon never clips into the nave.
  const localZ = 10.2;
  const yaw = chapel.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: chapel.x + localX * cos + localZ * sin,
    z: chapel.z - localX * sin + localZ * cos,
  };
}

export function chapelGatheringPoint(
  chapel: Pick<BuildingState, 'x' | 'z'> & Partial<Pick<BuildingState, 'yaw'>>,
  personIdentity: string,
): PointXZ {
  const seed = hashStringSeed(`mass:${personIdentity}`);
  const file = seed % 9;
  const rank = (seed >>> 12) % 4;
  const localX = (file - 4) * 1.22 + (rank % 2) * 0.3;
  const localZ = 12.15 + rank * 1.18;
  const yaw = chapel.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: chapel.x + localX * cos + localZ * sin,
    z: chapel.z - localX * sin + localZ * cos,
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
