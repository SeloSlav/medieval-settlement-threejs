import { CALENDAR_DAYS_PER_MONTH } from '../generated/gameBalance.ts';
import type { GameClock } from './gameCalendar.ts';
import type { Season } from './seasonPolicy.ts';

export type DeciduousFoliagePresentation = {
  /** Pale new-leaf treatment; zero is the mature summer color. */
  springFlush: number;
  /** Species-specific warm autumn treatment. */
  autumnColor: number;
  /** Fraction of deciduous leaf pixels that have dropped. */
  dormancy: number;
};

export const MATURE_DECIDUOUS_FOLIAGE: Readonly<DeciduousFoliagePresentation> =
  Object.freeze({
    springFlush: 0,
    autumnColor: 0,
    dormancy: 0,
  });

function smooth(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

function monthProgress(clock: GameClock): number {
  return Math.max(
    0,
    Math.min(
      1,
      (
        clock.monthDay
        - 1
        + (clock.preciseHour ?? clock.hour) / 24
      ) / CALENDAR_DAYS_PER_MONTH,
    ),
  );
}

/**
 * Calendar presentation for broadleaf trees and European larch.
 *
 * Late-February leaf-out reaches a full, welcoming green canopy by the new
 * world's March opening. The pale spring flush matures during April, autumn
 * color starts in late September, and foliage sheds progressively during
 * November.
 */
export function deciduousFoliageForClock(
  clock: GameClock,
): DeciduousFoliagePresentation {
  const progress = monthProgress(clock);

  if (clock.month === 2) {
    const leafOut = smooth((progress - 0.72) / 0.28);
    return {
      springFlush: leafOut,
      autumnColor: 0,
      dormancy: 1 - leafOut,
    };
  }
  if (clock.month === 3) {
    return {
      springFlush: 1,
      autumnColor: 0,
      dormancy: 0,
    };
  }
  if (clock.month === 4) {
    return {
      springFlush: 1 - smooth(progress),
      autumnColor: 0,
      dormancy: 0,
    };
  }
  if (clock.month === 9) {
    const color = smooth((progress - 0.32) / 0.68);
    return {
      springFlush: 0,
      autumnColor: color * 0.35,
      dormancy: 0,
    };
  }
  if (clock.month === 10) {
    return {
      springFlush: 0,
      autumnColor: 0.35 + smooth(progress) * 0.65,
      dormancy: 0,
    };
  }
  if (clock.month === 11) {
    return {
      springFlush: 0,
      autumnColor: 1,
      dormancy: smooth(progress),
    };
  }
  if (clock.month === 12 || clock.month === 1) {
    return {
      springFlush: 0,
      autumnColor: 0,
      dormancy: 1,
    };
  }
  return { ...MATURE_DECIDUOUS_FOLIAGE };
}

/** Deterministic representative state for development art presets. */
export function deciduousFoliageForSeasonPreview(
  season: Season,
): DeciduousFoliagePresentation {
  if (season === 'spring') {
    return { springFlush: 0.85, autumnColor: 0, dormancy: 0.15 };
  }
  if (season === 'autumn') {
    return { springFlush: 0, autumnColor: 1, dormancy: 0.18 };
  }
  if (season === 'winter') {
    return { springFlush: 0, autumnColor: 0, dormancy: 1 };
  }
  return { ...MATURE_DECIDUOUS_FOLIAGE };
}
