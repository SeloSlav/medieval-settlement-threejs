import {
  CHAPEL_BASE_ATTENDANCE_CHANCE,
  CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
  CHAPEL_PRIEST_ATTENDANCE_BONUS,
  CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY,
  HOUSEHOLD_MAX_WEALTH,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import { SECONDS_PER_DAY } from './gardenMarketActivity.ts';
import { taxedEconomicActivity } from './villageEconomy.ts';

export { HOUSEHOLD_MAX_WEALTH };

export function chapelAttendanceChance(assignedLabor: number): number {
  if (assignedLabor <= 0) {
    return 0;
  }

  return Math.min(
    1,
    CHAPEL_BASE_ATTENDANCE_CHANCE
      + CHAPEL_PRIEST_ATTENDANCE_BONUS * assignedLabor
      + CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
  );
}

export function formatChapelAttendanceChance(assignedLabor: number): string {
  const chance = chapelAttendanceChance(assignedLabor);
  return `${Math.round(chance * 100)}% per tick`;
}

export function chapelTitheGoldPerTick(population: number): number {
  if (population <= 0) {
    return 0;
  }

  return population * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY * SIM_TICK_SECONDS / SECONDS_PER_DAY;
}

export function chapelTitheGoldPerDay(population: number): number {
  if (population <= 0) {
    return 0;
  }

  return population * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY;
}

/** Expected tithe when attending, before household wealth caps payment. */
export function expectedChapelTithePerDay(population: number, assignedLabor: number): number {
  const chance = chapelAttendanceChance(assignedLabor);
  return chapelTitheGoldPerDay(population) * chance;
}

/** Conservative daily tithe estimate limited by current household wealth. */
export function payableChapelTithePerDay(
  population: number,
  assignedLabor: number,
  householdWealth: number,
): number {
  return Math.min(expectedChapelTithePerDay(population, assignedLabor), householdWealth);
}

export function formatHouseholdWealth(wealth: number): string {
  return `${wealth.toFixed(1)} / ${HOUSEHOLD_MAX_WEALTH} gold`;
}

export function householdNetIncomePerDay(baseActivity: number, taxRate: number): number {
  const { adjusted, tax } = taxedEconomicActivity(baseActivity, taxRate);
  return Math.max(0, adjusted - tax);
}

export function formatHouseholdNetIncomePerDay(amount: number): string {
  return `~${amount.toFixed(1)} gold / day`;
}
