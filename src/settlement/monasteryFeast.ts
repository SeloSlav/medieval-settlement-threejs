import { MONASTERY_COVERAGE_RADIUS } from '../generated/gameBalance.ts';
import {
  claimResidenceCommunityLandmarks,
} from '../logistics/landmarkAccess.ts';
import {
  compareStableEntityIds,
  roadPathRoute,
} from '../logistics/roadLogistics.ts';
import { MONASTERY_FEASTS } from '../economy/monasteryHospitality.ts';
import type {
  BuildingState,
  ResidenceState,
} from '../resources/types.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { hashStringSeed } from '../utils/random.ts';
import type { PointXZ } from '../utils/pathGeometry.ts';
import type { GameClock } from '../world/gameCalendar.ts';

export const MONASTERY_FEAST_GATHERING_START_HOUR = 11.5;
export const MONASTERY_FEAST_GATHERING_END_HOUR = 15.5;

export type FeastMonasteryClaim = {
  monastery: BuildingState;
  roadDistance: number;
};

export function isMonasteryFeastGatheringTime(
  clock: Pick<GameClock, 'month' | 'monthDay' | 'hour' | 'minute'>,
  feastsEnabled: boolean,
  monasteryAvailable: boolean,
): boolean {
  if (!feastsEnabled || !monasteryAvailable) return false;
  const scheduled = MONASTERY_FEASTS.some(
    (feast) => feast.month === clock.month && feast.monthDay === clock.monthDay,
  );
  const hour = clock.hour + clock.minute / 60;
  return scheduled
    && hour >= MONASTERY_FEAST_GATHERING_START_HOUR
    && hour < MONASTERY_FEAST_GATHERING_END_HOUR;
}

export function operationalFeastMonasteries(
  buildings: Iterable<BuildingState>,
  fireDisabledBuildingIds: ReadonlySet<string> = new Set(),
): BuildingState[] {
  return [...buildings]
    .filter((building) =>
      building.kind === 'monastery'
      && building.constructionComplete !== false
      && !fireDisabledBuildingIds.has(building.id)
    )
    .sort((a, b) => compareStableEntityIds(a.id, b.id));
}

/**
 * Mirrors the authoritative parish-monastery territory in one batched road
 * query. Households outside the physical road radius never appear to attend.
 */
export function claimFeastMonasteriesForResidences(
  residences: readonly ResidenceState[],
  chapels: readonly BuildingState[],
  monasteries: readonly BuildingState[],
  roadNetwork: RoadNetwork | null,
): Map<string, FeastMonasteryClaim> {
  if (!roadNetwork || chapels.length === 0 || monasteries.length === 0) {
    return new Map();
  }
  const eligibleResidences = residences.filter(
    (residence) => !residence.abandoned && residence.population > 0,
  );
  const claims = claimResidenceCommunityLandmarks(
    roadNetwork,
    eligibleResidences,
    chapels,
    monasteries,
  ).monasteries;
  const monasteriesById = new Map(
    monasteries.map((monastery) => [monastery.id, monastery]),
  );
  return new Map(
    [...claims].flatMap(([residenceId, claim]) => {
      const monastery = monasteriesById.get(claim.supplierId);
      return monastery
        ? [[residenceId, { monastery, roadDistance: claim.distance }]]
        : [];
    }),
  );
}

export function monasteryFeastGatheringPoint(
  monastery: Pick<BuildingState, 'x' | 'z'>,
  personIdentity: string,
): PointXZ {
  const seed = hashStringSeed(`monastery-feast:${personIdentity}`);
  const angle = (seed % 4096) / 4096 * Math.PI * 2;
  const radius = 10.8 + ((seed >>> 12) % 4) * 0.8;
  return {
    x: monastery.x + Math.sin(angle) * radius,
    z: monastery.z + Math.cos(angle) * radius,
  };
}

export function monasteryFeastAttendancePath(
  origin: PointXZ,
  monastery: BuildingState,
  personIdentity: string,
  roadNetwork: RoadNetwork | null,
): PointXZ[] | null {
  if (!roadNetwork) return null;
  const route = roadPathRoute(
    roadNetwork,
    origin.x,
    origin.z,
    monastery.x,
    monastery.z,
  );
  if (
    !route
    || route.distance > MONASTERY_COVERAGE_RADIUS + 1e-6
    || route.polyline.length < 2
  ) {
    return null;
  }
  const destination = monasteryFeastGatheringPoint(
    monastery,
    personIdentity,
  );
  return [
    ...route.polyline.slice(0, -1).map((point) => ({ x: point.x, z: point.z })),
    destination,
  ];
}
