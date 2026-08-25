import { MAIN_HOUSE_DEPTH } from '../residences/burgageLayout.ts';
import type { ResidenceState } from '../resources/types.ts';
import { hashStringSeed } from '../utils/random.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import type { HolidayObservance } from '../world/holidayCalendar.ts';

export type HolidayChapelActivity = 'service' | 'congregation';

/**
 * Gives every named observance a deterministic physical rhythm. Most people
 * attend the morning service; later gatherings vary between processions,
 * bonfires, fairs, and quieter household feasts. The unselected households
 * remain visibly at home rather than disappearing indoors during the holy day.
 */
export function holidayChapelActivity(
  clock: Pick<GameClock, 'hour' | 'minute'>,
  holiday: HolidayObservance,
  personIdentity: string,
): HolidayChapelActivity | null {
  const hour = clock.hour + clock.minute / 60;
  const cohort = hashStringSeed(
    `holiday:${holiday.id}:${holiday.historicalYear}:${personIdentity}`,
  ) % 100;

  if (hour >= 8 && hour < 11.5) {
    const serviceShare = holiday.kind === 'carnival'
      ? 42
      : holiday.kind === 'fair'
        ? 58
        : holiday.kind === 'household'
          ? 66
          : 82;
    return cohort < serviceShare ? 'service' : null;
  }

  const gathering = holidayGatheringWindow(holiday, hour);
  if (!gathering) return null;
  return cohort < gathering.share ? 'congregation' : null;
}

/** Stable household-group positions behind the front door and main house. */
export function holidayBackyardPosition(
  residence: Pick<ResidenceState, 'x' | 'z' | 'yaw'>,
  personIdentity: string,
): { x: number; z: number; yaw: number } {
  const seed = hashStringSeed(`holiday-backyard:${personIdentity}`);
  const acrossUnit = ((seed & 0xffff) / 0xffff) * 2 - 1;
  const depthUnit = (((seed >>> 16) & 0xff) / 0xff);
  const behind = MAIN_HOUSE_DEPTH * 0.5 + 1.35 + depthUnit * 1.65;
  const across = acrossUnit * 2.25;
  const sin = Math.sin(residence.yaw);
  const cos = Math.cos(residence.yaw);
  const x = residence.x - sin * behind + cos * across;
  const z = residence.z - cos * behind - sin * across;
  return {
    x,
    z,
    yaw: Math.atan2(residence.x - x, residence.z - z),
  };
}

function holidayGatheringWindow(
  holiday: HolidayObservance,
  hour: number,
): { share: number } | null {
  switch (holiday.kind) {
    case 'bonfire':
      return hour >= 16 && hour < 20 ? { share: 82 } : null;
    case 'fair':
      return hour >= 12 && hour < 19 ? { share: 78 } : null;
    case 'carnival':
      return hour >= 13 && hour < 20 ? { share: 74 } : null;
    case 'procession':
      return hour >= 13 && hour < 17.5 ? { share: 68 } : null;
    case 'solemn':
      return hour >= 14 && hour < 16.5 ? { share: 42 } : null;
    case 'household':
      return hour >= 14 && hour < 16 ? { share: 28 } : null;
  }
}
