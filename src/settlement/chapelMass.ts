import type { BuildingState } from '../resources/types.ts';
import type { PointXZ } from '../utils/pathGeometry.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import { hashStringSeed } from '../utils/random.ts';

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
