import type { ForagingNodeKind } from './ForagingLayout.ts';
import { MUSHROOM_AUTUMN_REGROWTH_MULTIPLIER } from '../generated/gameBalance.ts';

export type ForagingSeason = 'winter' | 'spring' | 'summer' | 'autumn';

export function foragingSeason(month: number): ForagingSeason {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export function isForagingHarvestAvailable(
  kind: ForagingNodeKind,
  month: number,
): boolean {
  if (kind === 'game') return true;
  return foragingSeason(month) !== 'winter';
}

export function isForagingRegrowthSeason(
  kind: ForagingNodeKind,
  month: number,
): boolean {
  return foragingRegrowthMultiplier(kind, month) > 0;
}

/** Seasonal growth only; weather modifiers remain authoritative server-side. */
export function foragingRegrowthMultiplier(
  kind: ForagingNodeKind,
  month: number,
): number {
  const season = foragingSeason(month);
  if (kind === 'berries') {
    return season === 'spring' || season === 'summer' ? 1 : 0;
  }
  if (kind === 'mushrooms') {
    if (season === 'autumn') return MUSHROOM_AUTUMN_REGROWTH_MULTIPLIER;
    return season === 'spring' || season === 'summer' ? 1 : 0;
  }
  if (kind === 'fish') return season === 'spring' ? 1 : 0;
  return 1;
}
