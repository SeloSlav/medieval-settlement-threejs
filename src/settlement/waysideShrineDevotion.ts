import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';
import {
  claimResidenceRoutesByNearestSupplier,
  compareStableEntityIds,
  roadPathRoute,
} from '../logistics/roadLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import { hashStringSeed } from '../utils/random.ts';
import type { PointXZ } from '../utils/pathGeometry.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import type { HolidayObservance } from '../world/holidayCalendar.ts';

export const MAX_WAYSIDE_SHRINE_VISITORS = 3;
const PRAYER_SLOT_HOURS = 1.25;
const PRAYER_ACTIVE_HOURS = 1.08;

export type WaysideShrineClaim = {
  shrine: BuildingState;
  roadDistance: number;
};

export function operationalWaysideShrines(
  buildings: Iterable<BuildingState>,
  fireDisabledBuildingIds: ReadonlySet<string> = new Set(),
): BuildingState[] {
  return [...buildings]
    .filter((building) =>
      building.kind === 'wayside_shrine'
      && building.constructionComplete !== false
      && !fireDisabledBuildingIds.has(building.id)
    )
    .sort((a, b) => compareStableEntityIds(a.id, b.id));
}

/** Claims the nearest shrine on the same physical road graph. */
export function claimWaysideShrinesForResidences(
  residences: readonly ResidenceState[],
  shrines: readonly BuildingState[],
  roadNetwork: RoadNetwork | null,
): Map<string, WaysideShrineClaim> {
  if (!roadNetwork) return new Map();
  const eligibleResidences = residences.filter(
    (residence) => !residence.abandoned && residence.population > 0,
  );
  const claims = claimResidenceRoutesByNearestSupplier(
    roadNetwork,
    shrines,
    eligibleResidences,
    () => true,
    true,
  );
  const shrinesById = new Map(shrines.map((shrine) => [shrine.id, shrine]));
  return new Map(
    [...claims].flatMap(([residenceId, claim]) => {
      const shrine = shrinesById.get(claim.supplierId);
      return shrine
        ? [[residenceId, { shrine, roadDistance: claim.distance }]]
        : [];
    }),
  );
}

export function claimWaysideShrineFromPoint(
  origin: PointXZ,
  shrines: readonly BuildingState[],
  roadNetwork: RoadNetwork | null,
): WaysideShrineClaim | null {
  if (!roadNetwork) return null;
  let nearest: WaysideShrineClaim | null = null;
  for (const shrine of shrines) {
    const route = roadPathRoute(
      roadNetwork,
      origin.x,
      origin.z,
      shrine.x,
      shrine.z,
    );
    if (!route) continue;
    if (
      nearest == null
      || route.distance + 1e-6 < nearest.roadDistance
      || (
        Math.abs(route.distance - nearest.roadDistance) <= 1e-6
        && compareStableEntityIds(shrine.id, nearest.shrine.id) < 0
      )
    ) {
      nearest = { shrine, roadDistance: route.distance };
    }
  }
  return nearest;
}

/**
 * Stable rotating cohorts make only a few villagers eligible at once. The
 * renderer applies a per-shrine cap after ranking the eligible cohort.
 */
export function isWaysideShrinePrayerTime(
  clock: Pick<GameClock, 'hour' | 'minute' | 'totalDays' | 'isSunday'>,
  sabbathObservedToday: boolean,
  holiday: HolidayObservance | null,
  personIdentity: string,
): boolean {
  const isFeastDay = holiday !== null;
  const isSabbath = clock.isSunday && sabbathObservedToday;
  if (!isFeastDay && !isSabbath) return false;

  const startHour = isFeastDay ? 11.5 : 12;
  const endHour = isFeastDay ? 18.5 : 17;
  const hour = clock.hour + clock.minute / 60;
  if (hour < startHour || hour >= endHour) return false;

  const observanceId = holiday
    ? `${holiday.historicalYear}:${holiday.id}`
    : `sabbath:${clock.totalDays}`;
  const seed = hashStringSeed(
    `wayside-shrine-prayer:${observanceId}:${personIdentity}`,
  );
  const dailyShare = isFeastDay ? 68 : 52;
  if (seed % 100 >= dailyShare) return false;

  const slotCount = Math.max(1, Math.floor((endHour - startHour) / PRAYER_SLOT_HOURS));
  const slot = (seed >>> 8) % slotCount;
  const slotStart = startHour + slot * PRAYER_SLOT_HOURS;
  return hour >= slotStart && hour < slotStart + PRAYER_ACTIVE_HOURS;
}

export function waysideShrineVisitorPriority(
  clock: Pick<GameClock, 'totalDays'>,
  holiday: HolidayObservance | null,
  personIdentity: string,
): number {
  const observanceId = holiday
    ? `${holiday.historicalYear}:${holiday.id}`
    : `sabbath:${clock.totalDays}`;
  return hashStringSeed(
    `wayside-shrine-priority:${observanceId}:${personIdentity}`,
  );
}

export function waysideShrinePrayerPoint(
  shrine: Pick<BuildingState, 'x' | 'z'>,
  visitorSlot: number,
  roadNetwork: RoadNetwork | null,
): PointXZ & { yaw: number } {
  const shrineYaw = buildingPlacementYaw(
    'wayside_shrine',
    shrine.x,
    shrine.z,
    roadNetwork,
  );
  const slot = Math.max(0, Math.min(MAX_WAYSIDE_SHRINE_VISITORS - 1, visitorSlot));
  const lateral = (slot - (MAX_WAYSIDE_SHRINE_VISITORS - 1) * 0.5) * 0.58;
  const forward = 1.72;
  const sin = Math.sin(shrineYaw);
  const cos = Math.cos(shrineYaw);
  const x = shrine.x + sin * forward + cos * lateral;
  const z = shrine.z + cos * forward - sin * lateral;
  return {
    x,
    z,
    yaw: Math.atan2(shrine.x - x, shrine.z - z),
  };
}

export function waysideShrinePrayerPath(
  origin: PointXZ,
  shrine: BuildingState,
  visitorSlot: number,
  roadNetwork: RoadNetwork | null,
): PointXZ[] | null {
  if (!roadNetwork) return null;
  const route = roadPathRoute(
    roadNetwork,
    origin.x,
    origin.z,
    shrine.x,
    shrine.z,
  );
  if (!route || route.polyline.length < 2) return null;
  const prayerPoint = waysideShrinePrayerPoint(
    shrine,
    visitorSlot,
    roadNetwork,
  );
  return [
    ...route.polyline.slice(0, -1).map((point) => ({ x: point.x, z: point.z })),
    prayerPoint,
  ];
}
