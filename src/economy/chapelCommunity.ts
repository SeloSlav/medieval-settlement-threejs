import {
  CATHEDRAL_BISHOP_SETTLEMENT_TICKS_MULTIPLIER,
  CHAPEL_RECOVERY_NEEDS_REQUIRED,
  CHAPEL_RECOVERY_STOCK_MULTIPLIER,
  CALENDAR_DAYS_PER_WEEK,
  CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS,
  CHAPEL_SETTLEMENT_TICKS_MULTIPLIER,
  MONASTERY_RECOVERY_STOCK_MULTIPLIER,
  MONASTERY_SETTLEMENT_TICKS_MULTIPLIER,
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

export function effectiveResidenceSettleTicks(
  hasChapelAccess: boolean,
  sabbathObservance = false,
  hasMonasteryCoverage = false,
  chapelTier = 1,
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

  if (hasChapelAccess && chapelTier === 4) {
    ticks = Math.ceil(ticks * CATHEDRAL_BISHOP_SETTLEMENT_TICKS_MULTIPLIER);
  }
  return Math.max(1, ticks);
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

export function formatChapelTithePerDay(
  linkedPopulation: number,
  assignedLabor: number,
  sabbathObservance = false,
  hasMonasteryCoverage = false,
  titheMultiplier = 1,
  devotionalCandlesSupplied = false,
): string {
  const expected = expectedChapelTithePerDay(
    linkedPopulation,
    assignedLabor,
    sabbathObservance,
    hasMonasteryCoverage,
    titheMultiplier,
    devotionalCandlesSupplied,
  );
  const chance = Math.round(chapelAttendanceChance(
    assignedLabor,
    sabbathObservance,
    hasMonasteryCoverage,
    devotionalCandlesSupplied,
  ) * 100);
  const flat = chapelTitheGoldPerDay(linkedPopulation, titheMultiplier);
  const titheDays = sabbathObservance
    ? ` × ${CALENDAR_DAYS_PER_WEEK - 1}/${CALENDAR_DAYS_PER_WEEK} tithe days`
    : '';
  return `~${expected.toFixed(1)} gold / day (${chance}% attendance${titheDays} × ${flat.toFixed(1)} flat tithe)`;
}

export function formatChapelSettlementBoostPercent(): string {
  const percent = Math.round((1 - CHAPEL_SETTLEMENT_TICKS_MULTIPLIER) * 100);
  return `${percent}%`;
}

export function formatMonasterySettlementBoostPercent(): string {
  const percent = Math.round((1 - MONASTERY_SETTLEMENT_TICKS_MULTIPLIER) * 100);
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
    case 'savoryPreserves':
      return 4;
    case 'cloth':
      return 2;
    case 'shoes':
      return 2;
    case 'pottery':
      return 2;
    case 'church':
      return 1;
    case 'foodVariety':
      return 2;
    case 'luxury':
      return 1;
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}
