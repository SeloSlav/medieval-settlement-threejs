import {
  CHAPEL_BASE_ATTENDANCE_CHANCE,
  CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
  CHAPEL_PRIEST_ATTENDANCE_BONUS,
  CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS,
  CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY,
  CALENDAR_DAYS_PER_WEEK,
  HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE,
  HOUSEHOLD_MAX_WEALTH,
  HOUSEHOLD_PROJECT_WEALTH_RESERVE,
  MONASTERY_ATTENDANCE_BONUS,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import { GAME_DAY_SECONDS } from '../world/gameCalendar.ts';
import { taxedEconomicActivity } from './villageEconomy.ts';

export { HOUSEHOLD_MAX_WEALTH };

export function chapelAttendanceChance(
  assignedLabor: number,
  sabbathObservance = false,
  hasMonasteryCoverage = false,
): number {
  if (assignedLabor <= 0) {
    return 0;
  }

  let chance = CHAPEL_BASE_ATTENDANCE_CHANCE
    + CHAPEL_PRIEST_ATTENDANCE_BONUS * assignedLabor
    + CHAPEL_COMMUNITY_ATTENDANCE_BONUS;

  if (sabbathObservance) {
    chance += CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS;
  }

  if (hasMonasteryCoverage) {
    chance += MONASTERY_ATTENDANCE_BONUS;
  }

  return Math.min(1, chance);
}

export function formatChapelAttendanceChance(assignedLabor: number): string {
  const chance = chapelAttendanceChance(assignedLabor);
  return `${Math.round(chance * 100)}% per tick`;
}

export function chapelTitheGoldPerTick(population: number, titheMultiplier = 1): number {
  if (population <= 0) {
    return 0;
  }

  return population
    * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY
    * titheMultiplier
    * SIM_TICK_SECONDS
    / GAME_DAY_SECONDS;
}

export function chapelTitheGoldPerDay(population: number, titheMultiplier = 1): number {
  if (population <= 0) {
    return 0;
  }

  return population * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY * titheMultiplier;
}

/** Expected tithe when attending, before household wealth caps payment. */
export function expectedChapelTithePerDay(
  population: number,
  assignedLabor: number,
  sabbathObservance = false,
  hasMonasteryCoverage = false,
  titheMultiplier = 1,
): number {
  const chance = chapelAttendanceChance(
    assignedLabor,
    sabbathObservance,
    hasMonasteryCoverage,
  );
  const titheDayShare = sabbathObservance
    ? (CALENDAR_DAYS_PER_WEEK - 1) / CALENDAR_DAYS_PER_WEEK
    : 1;
  return chapelTitheGoldPerDay(population, titheMultiplier) * chance * titheDayShare;
}

/** Conservative daily tithe estimate limited by current household wealth. */
export function payableChapelTithePerDay(
  population: number,
  assignedLabor: number,
  householdWealth: number,
  sabbathObservance = false,
  hasMonasteryCoverage = false,
  titheMultiplier = 1,
): number {
  return Math.min(
    expectedChapelTithePerDay(
      population,
      assignedLabor,
      sabbathObservance,
      hasMonasteryCoverage,
      titheMultiplier,
    ),
    householdWealth,
  );
}

export type HouseholdProsperityBand = 'limited' | 'stable' | 'prosperous';

/**
 * A deliberately broad public signal. Exact household purses remain part of
 * the simulation, while players get enough information to understand whether
 * a home is likely to contribute to a discretionary project.
 */
export function householdProsperityBand(wealth: number): HouseholdProsperityBand {
  const savings = Math.max(0, wealth);
  if (savings < HOUSEHOLD_PROJECT_WEALTH_RESERVE) return 'limited';
  if (savings < HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE) return 'stable';
  return 'prosperous';
}

export function formatHouseholdProsperity(wealth: number): string {
  switch (householdProsperityBand(wealth)) {
    case 'limited': return 'Limited · treasury-backed projects';
    case 'stable': return 'Stable · may co-fund projects';
    case 'prosperous': return 'Prosperous · strong private savings';
  }
}

export function formatSettlementHouseholdProsperity(
  households: Iterable<{ population: number; householdWealth: number }>,
): string {
  const counts: Record<HouseholdProsperityBand, number> = {
    limited: 0,
    stable: 0,
    prosperous: 0,
  };
  let occupied = 0;
  for (const household of households) {
    if (household.population <= 0) continue;
    occupied += 1;
    counts[householdProsperityBand(household.householdWealth)] += 1;
  }
  if (occupied === 0) return 'No occupied households';
  return `${counts.prosperous} prosperous · ${counts.stable} stable · ${counts.limited} limited`;
}

export function householdNetIncomePerDay(baseActivity: number, taxRate: number): number {
  const { adjusted, tax } = taxedEconomicActivity(baseActivity, taxRate);
  return Math.max(0, adjusted - tax);
}

export function formatHouseholdNetIncomePerDay(amount: number): string {
  return `~${amount.toFixed(1)} gold / day`;
}
