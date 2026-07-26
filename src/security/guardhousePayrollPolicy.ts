import { GUARDHOUSE_WAGE_PER_GUARD_PER_DAY } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import { armedGuardCount } from './frontierSecurity.ts';

export const GUARDHOUSE_PAY_PRIORITY_LOW = 0;
export const GUARDHOUSE_PAY_PRIORITY_NORMAL = 1;
export const GUARDHOUSE_PAY_PRIORITY_HIGH = 2;

export const GUARDHOUSE_PAY_PRIORITIES = [
  { priority: GUARDHOUSE_PAY_PRIORITY_LOW, label: 'Low' },
  { priority: GUARDHOUSE_PAY_PRIORITY_NORMAL, label: 'Normal' },
  { priority: GUARDHOUSE_PAY_PRIORITY_HIGH, label: 'High' },
] as const;

export type GuardhousePayrollEntry = {
  building: BuildingState;
  priority: number;
  armedGuards: number;
  dailyWage: number;
  fundedGold: number;
  fundedRatio: number;
  claimPosition: number;
  companyCount: number;
};

export function normalizeGuardhousePayPriority(priority: number | undefined): number {
  if (!Number.isFinite(priority)) return GUARDHOUSE_PAY_PRIORITY_NORMAL;
  return Math.max(
    GUARDHOUSE_PAY_PRIORITY_LOW,
    Math.min(GUARDHOUSE_PAY_PRIORITY_HIGH, Math.floor(priority ?? GUARDHOUSE_PAY_PRIORITY_NORMAL)),
  );
}

export function guardhousePayPriorityLabel(priority: number | undefined): string {
  const normalized = normalizeGuardhousePayPriority(priority);
  return GUARDHOUSE_PAY_PRIORITIES.find((candidate) => candidate.priority === normalized)?.label
    ?? 'Normal';
}

/**
 * Projects how today's treasury would fund one day of guard wages if no more
 * income arrived. This mirrors the server's priority buckets and stable
 * within-tier building order; the server applies the same order continuously.
 */
export function guardhousePayrollPlan(
  buildings: Iterable<BuildingState>,
  treasuryGold: number,
): GuardhousePayrollEntry[] {
  const companies = [...buildings]
    .filter((building) =>
      building.kind === 'guardhouse'
      && building.constructionComplete !== false
      && armedGuardCount(building.assignedLabor, building.polearms) > 0
    )
    .sort((left, right) => {
      const priorityOrder = normalizeGuardhousePayPriority(right.guardhousePayPriority)
        - normalizeGuardhousePayPriority(left.guardhousePayPriority);
      return priorityOrder !== 0 ? priorityOrder : compareBuildingIds(left.id, right.id);
    });

  let availableGold = Math.max(0, treasuryGold);
  return companies.map((building, index) => {
    const armedGuards = armedGuardCount(building.assignedLabor, building.polearms);
    const dailyWage = armedGuards * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY;
    const fundedGold = Math.min(dailyWage, availableGold);
    availableGold -= fundedGold;
    return {
      building,
      priority: normalizeGuardhousePayPriority(building.guardhousePayPriority),
      armedGuards,
      dailyWage,
      fundedGold,
      fundedRatio: dailyWage > 1e-9 ? fundedGold / dailyWage : 1,
      claimPosition: index + 1,
      companyCount: companies.length,
    };
  });
}

function compareBuildingIds(left: string, right: string): number {
  const leftMatch = /^building-(\d+)$/.exec(left);
  const rightMatch = /^building-(\d+)$/.exec(right);
  if (leftMatch && rightMatch) {
    const leftId = BigInt(leftMatch[1]);
    const rightId = BigInt(rightMatch[1]);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  }
  return left.localeCompare(right);
}
