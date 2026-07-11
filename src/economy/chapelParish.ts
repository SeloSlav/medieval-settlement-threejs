import {
  CHAPEL_AUTO_SWEEP_FRACTION,
  CHAPEL_AUTO_SWEEP_INTERVAL_TICKS,
  CHAPEL_CHARITY_GOLD_PER_DAY,
  CHAPEL_CHARITY_MIN_COFFER_GOLD,
  CHAPEL_COFFER_RESERVE_DEFAULT,
  CHAPEL_COFFER_RESERVE_MAX,
  CHAPEL_COFFER_RESERVE_MIN,
  CHAPEL_PRIEST_SALARY_GOLD_PER_DAY,
  CHAPEL_UNSTAFFED_UPKEEP_FRACTION,
  CHAPEL_UPKEEP_GOLD_PER_DAY,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import { chapelCofferGold } from '../resources/chapelCoffer.ts';

export type ParishPolicyState = {
  autoSweepEnabled: boolean;
  cofferReserveGold: number;
  manualCollectTotal: number;
  autoSweepTotal: number;
  salaryPaidTotal: number;
  upkeepPaidTotal: number;
  charityPaidTotal: number;
};

export const DEFAULT_PARISH_POLICY: ParishPolicyState = {
  autoSweepEnabled: false,
  cofferReserveGold: CHAPEL_COFFER_RESERVE_DEFAULT,
  manualCollectTotal: 0,
  autoSweepTotal: 0,
  salaryPaidTotal: 0,
  upkeepPaidTotal: 0,
  charityPaidTotal: 0,
};

export function clampChapelCofferReserveGold(value: number): number {
  return Math.min(CHAPEL_COFFER_RESERVE_MAX, Math.max(CHAPEL_COFFER_RESERVE_MIN, value));
}

export function chapelPriestSalaryPerDay(assignedLabor: number): number {
  return assignedLabor > 0 ? CHAPEL_PRIEST_SALARY_GOLD_PER_DAY * assignedLabor : 0;
}

export function chapelUpkeepPerDay(assignedLabor: number): number {
  return assignedLabor > 0
    ? CHAPEL_UPKEEP_GOLD_PER_DAY
    : CHAPEL_UPKEEP_GOLD_PER_DAY * CHAPEL_UNSTAFFED_UPKEEP_FRACTION;
}

export function chapelCharityPerDay(cofferGold: number, assignedLabor: number): number {
  if (assignedLabor <= 0 || cofferGold < CHAPEL_CHARITY_MIN_COFFER_GOLD) {
    return 0;
  }
  return CHAPEL_CHARITY_GOLD_PER_DAY;
}

export type ChapelParishExpensePerDay = {
  salary: number;
  upkeep: number;
  charity: number;
  total: number;
};

/** Uncapped daily parish expenses when the coffer can fully fund them. */
export function chapelParishExpensePerDay(
  assignedLabor: number,
  cofferGold: number,
): ChapelParishExpensePerDay {
  const salary = chapelPriestSalaryPerDay(assignedLabor);
  const upkeep = chapelUpkeepPerDay(assignedLabor);
  const charity = chapelCharityPerDay(cofferGold, assignedLabor);
  return { salary, upkeep, charity, total: salary + upkeep + charity };
}

/**
 * Coffer-aware daily expenses mirroring server tick order:
 * salary → upkeep → charity (gate checked on post-expense balance).
 */
export function payableParishExpensePerDay(
  assignedLabor: number,
  cofferGold: number,
): ChapelParishExpensePerDay {
  let balance = cofferGold;

  const salary = Math.min(chapelPriestSalaryPerDay(assignedLabor), balance);
  balance -= salary;

  const upkeep = Math.min(chapelUpkeepPerDay(assignedLabor), balance);
  balance -= upkeep;

  const charity = assignedLabor > 0 && balance >= CHAPEL_CHARITY_MIN_COFFER_GOLD
    ? Math.min(CHAPEL_CHARITY_GOLD_PER_DAY, balance)
    : 0;

  return { salary, upkeep, charity, total: salary + upkeep + charity };
}

export function sumPayableParishExpensePerDay(chapels: Iterable<BuildingState>): number {
  let total = 0;
  for (const chapel of chapels) {
    if (chapel.kind !== 'chapel') {
      continue;
    }
    total += payableParishExpensePerDay(chapel.assignedLabor, chapelCofferGold(chapel)).total;
  }
  return total;
}

export function payableAutoSweepPerDay(
  cofferGold: number,
  assignedLabor: number,
  reserveGold: number,
  autoSweepEnabled: boolean,
): number {
  if (!autoSweepEnabled) {
    return 0;
  }

  const expenses = payableParishExpensePerDay(assignedLabor, cofferGold);
  const cofferAfterExpenses = Math.max(0, cofferGold - expenses.total);
  const excess = Math.max(0, cofferAfterExpenses - reserveGold);
  if (excess <= 0) {
    return 0;
  }

  const sweepPerInterval = excess * CHAPEL_AUTO_SWEEP_FRACTION;
  const intervalsPerDay = 86_400 / (CHAPEL_AUTO_SWEEP_INTERVAL_TICKS * SIM_TICK_SECONDS);
  return sweepPerInterval * intervalsPerDay;
}

export function sumPayableAutoSweepPerDay(
  chapels: Iterable<BuildingState>,
  reserveGold: number,
  autoSweepEnabled: boolean,
): number {
  if (!autoSweepEnabled) {
    return 0;
  }

  let total = 0;
  for (const chapel of chapels) {
    if (chapel.kind !== 'chapel') {
      continue;
    }
    total += payableAutoSweepPerDay(
      chapelCofferGold(chapel),
      chapel.assignedLabor,
      reserveGold,
      true,
    );
  }
  return total;
}

export function formatParishGoldPerDay(amount: number, approximate = true): string {
  const prefix = approximate ? '~' : '';
  return `${prefix}${amount.toFixed(1)} gold / day`;
}

export function parishLedgerTotal(policy: ParishPolicyState): number {
  return policy.manualCollectTotal
    + policy.autoSweepTotal
    + policy.salaryPaidTotal
    + policy.upkeepPaidTotal
    + policy.charityPaidTotal;
}
