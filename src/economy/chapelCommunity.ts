import {
  ABANDON_AFTER_DEFICIT_TICKS,
  CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER,
  CHAPEL_RECOVERY_NEEDS_REQUIRED,
  CHAPEL_RECOVERY_STOCK_MULTIPLIER,
  CHAPEL_SETTLEMENT_TICKS_MULTIPLIER,
  RESIDENCE_RECOVERY_FIREWOOD_MIN,
  RESIDENCE_RECOVERY_FOOD_MIN,
  RESIDENCE_RECOVERY_WATER_MIN,
  RESIDENCE_SETTLE_TICKS,
} from '../generated/gameBalance.ts';
import type { ResidenceNeedKind } from '../residences/residenceNeedState.ts';
import { RESIDENCE_NEED_KINDS } from '../residences/residenceNeedState.ts';
import {
  chapelAttendanceChance,
  chapelTitheGoldPerDay,
  expectedChapelTithePerDay,
} from './householdWealth.ts';

export function effectiveResidenceSettleTicks(hasChapelAccess: boolean): number {
  if (!hasChapelAccess) {
    return RESIDENCE_SETTLE_TICKS;
  }

  return Math.ceil(RESIDENCE_SETTLE_TICKS * CHAPEL_SETTLEMENT_TICKS_MULTIPLIER);
}

export function effectiveAbandonAfterDeficitTicks(hasChapelAccess: boolean): number {
  if (!hasChapelAccess) {
    return ABANDON_AFTER_DEFICIT_TICKS;
  }

  return Math.ceil(ABANDON_AFTER_DEFICIT_TICKS / CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER);
}

export function recoveryStockMin(kind: ResidenceNeedKind, hasChapelAccess: boolean): number {
  const base = recoveryStockBase(kind);
  if (!hasChapelAccess) {
    return base;
  }
  return base * CHAPEL_RECOVERY_STOCK_MULTIPLIER;
}

export function recoveryNeedsRequired(hasChapelAccess: boolean): number {
  return hasChapelAccess ? CHAPEL_RECOVERY_NEEDS_REQUIRED : RESIDENCE_NEED_KINDS.length;
}

export function formatChapelTithePerDay(linkedPopulation: number, assignedLabor: number): string {
  const expected = expectedChapelTithePerDay(linkedPopulation, assignedLabor);
  const chance = Math.round(chapelAttendanceChance(assignedLabor) * 100);
  const flat = chapelTitheGoldPerDay(linkedPopulation);
  return `~${expected.toFixed(1)} gold / day (${chance}% attendance × ${flat.toFixed(1)} flat tithe)`;
}

export function formatChapelSettlementBoostPercent(): string {
  const percent = Math.round((1 - CHAPEL_SETTLEMENT_TICKS_MULTIPLIER) * 100);
  return `${percent}%`;
}

export function formatChapelAbandonmentGracePercent(): string {
  const percent = Math.round((1 / CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER - 1) * 100);
  return `${percent}%`;
}

export function formatChapelRecoveryStockMultiplierPercent(): string {
  const percent = Math.round((1 - CHAPEL_RECOVERY_STOCK_MULTIPLIER) * 100);
  return `${percent}%`;
}

function recoveryStockBase(kind: ResidenceNeedKind): number {
  switch (kind) {
    case 'firewood':
      return RESIDENCE_RECOVERY_FIREWOOD_MIN;
    case 'water':
      return RESIDENCE_RECOVERY_WATER_MIN;
    case 'food':
      return RESIDENCE_RECOVERY_FOOD_MIN;
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}
