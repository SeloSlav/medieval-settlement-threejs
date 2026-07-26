import {
  ABANDON_AFTER_DEFICIT_TICKS,
  CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER,
  CHAPEL_RECOVERY_NEEDS_REQUIRED,
  CHAPEL_RECOVERY_STOCK_MULTIPLIER,
  CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS,
  CHAPEL_SETTLEMENT_TICKS_MULTIPLIER,
  MONASTERY_ABANDONMENT_DEFICIT_MULTIPLIER,
  MONASTERY_RECOVERY_STOCK_MULTIPLIER,
  MONASTERY_SETTLEMENT_TICKS_MULTIPLIER,
  RESIDENCE_RECOVERY_FIREWOOD_MIN,
  RESIDENCE_RECOVERY_FOOD_MIN,
  RESIDENCE_RECOVERY_WATER_MIN,
  RESIDENCE_SETTLE_TICKS,
  RESIDENCE_TIER1_ABANDONMENT_GRACE_MULTIPLIER,
  RESIDENCE_TIER2_ABANDONMENT_GRACE_MULTIPLIER,
  RESIDENCE_TIER3_ABANDONMENT_GRACE_MULTIPLIER,
} from '../generated/gameBalance.ts';
import type { ResidenceNeedKind } from '../residences/residenceNeedState.ts';
import { RESIDENCE_NEED_KINDS } from '../residences/residenceNeedState.ts';
import {
  chapelAttendanceChance,
  chapelTitheGoldPerDay,
  expectedChapelTithePerDay,
} from './householdWealth.ts';

export function effectiveResidenceSettleTicks(
  hasChapelAccess: boolean,
  sabbathObservance = false,
  hasMonasteryCoverage = false,
): number {
  let ticks = hasChapelAccess
    ? Math.ceil(RESIDENCE_SETTLE_TICKS * CHAPEL_SETTLEMENT_TICKS_MULTIPLIER)
    : RESIDENCE_SETTLE_TICKS;

  if (hasChapelAccess && hasMonasteryCoverage) {
    ticks = Math.ceil(ticks * MONASTERY_SETTLEMENT_TICKS_MULTIPLIER);
  }

  if (hasChapelAccess && sabbathObservance) {
    ticks = Math.ceil(ticks * (1 - CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS));
  }

  return Math.max(1, ticks);
}

export function effectiveAbandonAfterDeficitTicks(
  hasChapelAccess: boolean,
  hasMonasteryCoverage = false,
  residenceTier: 1 | 2 | 3 = 3,
): number {
  const tierGrace = residenceTier === 1
    ? RESIDENCE_TIER1_ABANDONMENT_GRACE_MULTIPLIER
    : residenceTier === 2
      ? RESIDENCE_TIER2_ABANDONMENT_GRACE_MULTIPLIER
      : RESIDENCE_TIER3_ABANDONMENT_GRACE_MULTIPLIER;
  const baseTicks = ABANDON_AFTER_DEFICIT_TICKS * tierGrace;
  if (!hasChapelAccess) {
    return Math.ceil(baseTicks);
  }

  let ticks = baseTicks / CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER;
  if (hasMonasteryCoverage) {
    ticks /= MONASTERY_ABANDONMENT_DEFICIT_MULTIPLIER;
  }
  return Math.ceil(ticks);
}

export function recoveryStockMin(
  kind: ResidenceNeedKind,
  hasChapelAccess: boolean,
  hasMonasteryCoverage = false,
): number {
  const base = recoveryStockBase(kind);
  let threshold = base;
  if (hasChapelAccess) {
    threshold *= CHAPEL_RECOVERY_STOCK_MULTIPLIER;
  }
  if (hasChapelAccess && hasMonasteryCoverage) {
    threshold *= MONASTERY_RECOVERY_STOCK_MULTIPLIER;
  }
  return threshold;
}

export function recoveryNeedsRequired(
  hasChapelAccess: boolean,
  activeNeedCount = RESIDENCE_NEED_KINDS.length,
): number {
  const policyRequired = hasChapelAccess
    ? CHAPEL_RECOVERY_NEEDS_REQUIRED
    : RESIDENCE_NEED_KINDS.length;
  return Math.min(policyRequired, activeNeedCount);
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

export function formatMonasterySettlementBoostPercent(): string {
  const percent = Math.round((1 - MONASTERY_SETTLEMENT_TICKS_MULTIPLIER) * 100);
  return `${percent}%`;
}

export function formatChapelAbandonmentGracePercent(): string {
  const percent = Math.round((1 / CHAPEL_ABANDONMENT_DEFICIT_MULTIPLIER - 1) * 100);
  return `${percent}%`;
}

export function formatMonasteryAbandonmentGracePercent(): string {
  const percent = Math.round((1 / MONASTERY_ABANDONMENT_DEFICIT_MULTIPLIER - 1) * 100);
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
    case 'ale':
      return 3;
    case 'preservedFood':
      return 4;
    case 'cloth':
      return 2;
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}
