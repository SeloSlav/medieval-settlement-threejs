import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
} from '../generated/gameBalance.ts';
import { isOnRoadSurface } from '../roads/roadConnectivity.ts';
import {
  PEDESTRIAN_ROAD_SPEED_MULTIPLIER,
  surfaceAdjustedTravelSpeed,
} from '../roads/roadTravel.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { PointXZ } from '../utils/pathGeometry.ts';
import type { GameClock } from '../world/gameCalendar.ts';

export const WORKER_MINIMUM_REST_SECONDS = CALENDAR_SECONDS_PER_DAY * 6 / 24;
export const WORKER_MINIMUM_SHIFT_SECONDS = CALENDAR_SECONDS_PER_DAY * 3 / 24;
export const WORK_START_SECONDS = CALENDAR_SECONDS_PER_DAY
  * CALENDAR_WORK_START_HOUR / CALENDAR_HOURS_PER_DAY;
export const WORK_END_SECONDS = CALENDAR_SECONDS_PER_DAY
  * CALENDAR_WORK_END_HOUR / CALENDAR_HOURS_PER_DAY;
export const WORKDAY_SECONDS = WORK_END_SECONDS - WORK_START_SECONDS;

export type WorkerCommuteBand = 'short' | 'long' | 'severe';

export type WorksiteCommuteSummary = {
  workerCount: number;
  measuredWorkers: number;
  averageOneWayDistance: number;
  longestOneWayDistance: number;
  averageOneWaySeconds: number;
  longestOneWaySeconds: number;
  effectiveShiftRatio: number;
  band: WorkerCommuteBand;
  lodgingMode: 'none' | 'built_in' | 'remote_camp';
};

export function clockElapsedSeconds(clock: GameClock): number {
  return clock.totalDays * CALENDAR_SECONDS_PER_DAY + clockSecondsIntoDay(clock);
}

export function clockSecondsIntoDay(clock: Pick<GameClock, 'hour' | 'minute' | 'preciseHour'>): number {
  const preciseHour = clock.preciseHour
    ?? clock.hour + clock.minute / 60;
  return preciseHour / CALENDAR_HOURS_PER_DAY * CALENDAR_SECONDS_PER_DAY;
}

export function estimatePedestrianTravelSeconds(
  path: readonly PointXZ[],
  baseSpeed: number,
  roadNetwork: RoadNetwork | null,
): number {
  let seconds = 0;
  const safeBaseSpeed = Math.max(0.1, baseSpeed);
  for (let index = 1; index < path.length; index += 1) {
    const a = path[index - 1]!;
    const b = path[index]!;
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance <= 1e-6) continue;
    const onRoad = Boolean(
      roadNetwork
      && isOnRoadSurface((a.x + b.x) * 0.5, (a.z + b.z) * 0.5, roadNetwork),
    );
    const speed = surfaceAdjustedTravelSpeed(
      safeBaseSpeed,
      onRoad,
      PEDESTRIAN_ROAD_SPEED_MULTIPLIER,
    );
    seconds += distance / Math.max(0.1, speed);
  }
  return seconds;
}

export function commuteBandForRatio(roundTripShare: number): WorkerCommuteBand {
  if (roundTripShare <= 0.15) return 'short';
  if (roundTripShare <= 0.35) return 'long';
  return 'severe';
}

export function commuteEffectiveShiftRatio(oneWaySeconds: number): number {
  return Math.max(0, Math.min(1, (WORKDAY_SECONDS - oneWaySeconds * 2) / WORKDAY_SECONDS));
}
