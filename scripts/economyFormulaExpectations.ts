/**
 * Canonical formula expectations shared by TS tests.
 * Keep in sync with `server/src/simulation/chapel_community.rs` and `chapel_parish.rs`.
 */
import {
  ABANDON_AFTER_DEFICIT_TICKS,
  CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER,
  CHAPEL_AUTO_SWEEP_FRACTION,
  CHAPEL_AUTO_SWEEP_INTERVAL_TICKS,
  CHAPEL_BASE_ATTENDANCE_CHANCE,
  CHAPEL_CHARITY_GOLD_PER_DAY,
  CHAPEL_CHARITY_MIN_COFFER_GOLD,
  CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
  CHAPEL_PRIEST_ATTENDANCE_BONUS,
  CHAPEL_PRIEST_SALARY_GOLD_PER_DAY,
  CHAPEL_SETTLEMENT_TICKS_MULTIPLIER,
  CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY,
  CHAPEL_UNSTAFFED_UPKEEP_FRACTION,
  CHAPEL_UPKEEP_GOLD_PER_DAY,
  RESIDENCE_SETTLE_TICKS,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import { SECONDS_PER_DAY } from '../src/economy/gardenMarketActivity.ts';

export function expectedEffectiveSettleTicks(hasChapelAccess: boolean): number {
  if (!hasChapelAccess) {
    return RESIDENCE_SETTLE_TICKS;
  }
  return Math.ceil(RESIDENCE_SETTLE_TICKS * CHAPEL_SETTLEMENT_TICKS_MULTIPLIER);
}

export function expectedEffectiveAbandonAfterDeficitTicks(hasChapelAccess: boolean): number {
  if (!hasChapelAccess) {
    return ABANDON_AFTER_DEFICIT_TICKS;
  }
  return Math.ceil(ABANDON_AFTER_DEFICIT_TICKS / CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER);
}

export function expectedChapelAttendanceChance(assignedLabor: number): number {
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

export function expectedChapelTitheGoldPerTick(population: number): number {
  if (population <= 0) {
    return 0;
  }
  return population * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY * SIM_TICK_SECONDS / SECONDS_PER_DAY;
}

export function expectedChapelPriestSalaryPerDay(assignedLabor: number): number {
  return assignedLabor > 0 ? CHAPEL_PRIEST_SALARY_GOLD_PER_DAY * assignedLabor : 0;
}

export function expectedChapelUpkeepPerDay(assignedLabor: number): number {
  return assignedLabor > 0
    ? CHAPEL_UPKEEP_GOLD_PER_DAY
    : CHAPEL_UPKEEP_GOLD_PER_DAY * CHAPEL_UNSTAFFED_UPKEEP_FRACTION;
}

export function expectedChapelCharityPerDay(cofferGold: number, assignedLabor: number): number {
  if (assignedLabor <= 0 || cofferGold < CHAPEL_CHARITY_MIN_COFFER_GOLD) {
    return 0;
  }
  return CHAPEL_CHARITY_GOLD_PER_DAY;
}

export type ExpectedParishExpensePerDay = {
  salary: number;
  upkeep: number;
  charity: number;
  total: number;
};

/** Mirrors `payableParishExpensePerDay` / server tick order. */
export function expectedPayableParishExpensePerDay(
  assignedLabor: number,
  cofferGold: number,
): ExpectedParishExpensePerDay {
  let balance = cofferGold;

  const salary = Math.min(expectedChapelPriestSalaryPerDay(assignedLabor), balance);
  balance -= salary;

  const upkeep = Math.min(expectedChapelUpkeepPerDay(assignedLabor), balance);
  balance -= upkeep;

  const charity = assignedLabor > 0 && balance >= CHAPEL_CHARITY_MIN_COFFER_GOLD
    ? Math.min(CHAPEL_CHARITY_GOLD_PER_DAY, balance)
    : 0;

  return { salary, upkeep, charity, total: salary + upkeep + charity };
}

export function expectedPayableAutoSweepPerDay(
  cofferGold: number,
  assignedLabor: number,
  reserveGold: number,
  autoSweepEnabled: boolean,
): number {
  if (!autoSweepEnabled) {
    return 0;
  }

  const expenses = expectedPayableParishExpensePerDay(assignedLabor, cofferGold);
  const cofferAfterExpenses = Math.max(0, cofferGold - expenses.total);
  const excess = Math.max(0, cofferAfterExpenses - reserveGold);
  if (excess <= 0) {
    return 0;
  }

  const sweepPerInterval = excess * CHAPEL_AUTO_SWEEP_FRACTION;
  const intervalsPerDay = SECONDS_PER_DAY / (CHAPEL_AUTO_SWEEP_INTERVAL_TICKS * SIM_TICK_SECONDS);
  return sweepPerInterval * intervalsPerDay;
}
