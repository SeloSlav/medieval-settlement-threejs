import { isChapelStaffed } from '../logistics/landmarkAccess.ts';
import type { BackyardGardenKind } from '../generated/gameBalance.ts';
import { CHAPEL_RECOVERY_NEEDS_REQUIRED } from '../generated/gameBalance.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import { chapelCofferGold } from '../resources/chapelCoffer.ts';
import { RESIDENCE_NEED_KINDS, type ResidenceCommunityContext } from '../residences/residenceNeedState.ts';
import {
  formatChapelAbandonmentGracePercent,
  formatChapelRecoveryStockMultiplierPercent,
  formatChapelSettlementBoostPercent,
  formatChapelTithePerDay,
  recoveryNeedsRequired,
} from './chapelCommunity.ts';
import {
  chapelAttendanceChance,
  formatChapelAttendanceChance,
  formatHouseholdNetIncomePerDay,
  formatHouseholdWealth,
  payableChapelTithePerDay,
} from './householdWealth.ts';
import { backyardGardenEconomyPerDay } from './villageProjections.ts';
import { formatTaxRatePercent } from './villageEconomy.ts';
import {
  formatParishGoldPerDay,
  payableParishExpensePerDay,
  type ParishPolicyState,
} from './chapelParish.ts';
import { chapelTitheMultiplier } from './chapelUpgrade.ts';

export function buildResidenceCommunityContext(
  servingChapel: BuildingState | null,
  parishPolicy: ParishPolicyState,
  hasMonasteryCoverage = false,
): ResidenceCommunityContext {
  const sabbathObservance = servingChapel != null && parishPolicy.sabbathObservanceEnabled;
  return {
    hasChapelAccess: servingChapel != null,
    hasMonasteryCoverage,
    sabbathObservance,
  };
}

export type ResidenceParishEconomyView = {
  hasChapelAccess: boolean;
  tithePerDay: number;
  attendancePercent: number;
  wealthLimited: boolean;
};

export function buildResidenceParishEconomyView(
  residence: ResidenceState,
  servingChapel: BuildingState | null,
  sabbathObservance = false,
  hasMonasteryCoverage = false,
): ResidenceParishEconomyView {
  if (!servingChapel) {
    return {
      hasChapelAccess: false,
      tithePerDay: 0,
      attendancePercent: 0,
      wealthLimited: false,
    };
  }

  const attendance = chapelAttendanceChance(
    servingChapel.assignedLabor,
    sabbathObservance,
    hasMonasteryCoverage,
  );
  const uncapped = residence.population > 0
      ? payableChapelTithePerDay(
          residence.population,
          servingChapel.assignedLabor,
          Number.POSITIVE_INFINITY,
          sabbathObservance,
          hasMonasteryCoverage,
          chapelTitheMultiplier(servingChapel.chapelTier),
        )
      : 0;
  const tithePerDay = payableChapelTithePerDay(
    residence.population,
    servingChapel.assignedLabor,
    residence.householdWealth,
    sabbathObservance,
    hasMonasteryCoverage,
    chapelTitheMultiplier(servingChapel.chapelTier),
  );

  return {
    hasChapelAccess: true,
    tithePerDay,
    attendancePercent: Math.round(attendance * 100),
    wealthLimited: tithePerDay + 0.05 < uncapped,
  };
}

export type BackyardEconomyView = {
  activityPerDay: number;
  selfFoodPerDay: number;
  assessedTaxPerDay: number;
  taxPerDay: number;
  netWealthPerDay: number;
  taxPercent: string;
};

export function buildBackyardEconomyView(
  kind: BackyardGardenKind,
  population: number,
  taxRate: number,
  hasMarketAccess: boolean,
  options: {
    seasonalMultiplier?: number;
    taxCollectionMultiplier?: number;
    serviceMultiplier?: number;
  } = {},
): BackyardEconomyView {
  const taxPercent = formatTaxRatePercent(taxRate);
  const economy = backyardGardenEconomyPerDay(kind, population, taxRate, {
    seasonalMultiplier: options.seasonalMultiplier,
    hasMarketAccess,
    taxCollectionMultiplier: options.taxCollectionMultiplier,
    serviceMultiplier: options.serviceMultiplier,
  });
  return {
    activityPerDay: economy.activity,
    selfFoodPerDay: economy.selfFood,
    assessedTaxPerDay: economy.assessedTax,
    taxPerDay: economy.tax,
    netWealthPerDay: economy.net,
    taxPercent,
  };
}

export type ChapelInspectorEconomyView = {
  cofferGold: number;
  cofferCapacity: number;
  cofferFull: boolean;
  titheLabel: string;
  attendanceLabel: string;
  recoveryLabel: string;
  expense: {
    salary: number;
    upkeep: number;
    charity: number;
    total: number;
    cofferLimited: boolean;
  };
  collectAction: string;
};

export function buildChapelInspectorEconomyView(
  building: BuildingState,
  linkedPopulation: number,
  cofferCapacity: number,
  collectAction: string,
  sabbathObservance = false,
): ChapelInspectorEconomyView {
  const staffed = isChapelStaffed(building);
  const cofferGold = chapelCofferGold(building);
  const cofferFull = cofferGold >= cofferCapacity - 0.05;
  const uncapped = payableParishExpensePerDay(building.assignedLabor, cofferGold);
  const uncappedAtInfinity = payableParishExpensePerDay(building.assignedLabor, Number.POSITIVE_INFINITY);
  const needsRequired = recoveryNeedsRequired(true);
  const needsTotal = RESIDENCE_NEED_KINDS.length;

  return {
    cofferGold,
    cofferCapacity,
    cofferFull,
    titheLabel: staffed
      ? `${formatChapelTithePerDay(
          linkedPopulation,
          building.assignedLabor,
          sabbathObservance,
          false,
          chapelTitheMultiplier(building.chapelTier),
        )} → coffer`
      : '—',
    attendanceLabel: staffed ? formatChapelAttendanceChance(building.assignedLabor) : '—',
    recoveryLabel: `${needsRequired} of ${needsTotal} needs · ${formatChapelRecoveryStockMultiplierPercent()} lower restock thresholds`,
    expense: {
      salary: uncapped.salary,
      upkeep: uncapped.upkeep,
      charity: uncapped.charity,
      total: uncapped.total,
      cofferLimited: uncapped.total + 0.05 < uncappedAtInfinity.total,
    },
    collectAction,
  };
}

export function formatChapelCommunityBoosts(): {
  settlementBoost: string;
  abandonmentGrace: string;
} {
  return {
    settlementBoost: formatChapelSettlementBoostPercent(),
    abandonmentGrace: formatChapelAbandonmentGracePercent(),
  };
}

export function formatBackyardSavingsLabel(netWealthPerDay: number, hasMarketAccess: boolean): string {
  return hasMarketAccess ? formatHouseholdNetIncomePerDay(netWealthPerDay) : '0 gold / day';
}

export function formatResidenceWealthLabel(wealth: number): string {
  return formatHouseholdWealth(wealth);
}

export function formatChapelExpenseLabel(
  expense: ChapelInspectorEconomyView['expense'],
  staffed: boolean,
): string {
  const limitedSuffix = expense.cofferLimited ? ', coffer-limited' : '';
  if (staffed) {
    return `${formatParishGoldPerDay(expense.total)} (salary ${expense.salary.toFixed(1)}, upkeep ${expense.upkeep.toFixed(1)}, charity ${expense.charity.toFixed(1)}${limitedSuffix})`;
  }
  return `${formatParishGoldPerDay(expense.upkeep)} upkeep only${limitedSuffix}`;
}

export { CHAPEL_RECOVERY_NEEDS_REQUIRED };
