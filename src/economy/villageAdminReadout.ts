import type { ParishPolicyState } from './chapelParish.ts';
import {
  formatParishGoldPerDay,
  parishLedgerTotal,
  sumPayableAutoSweepPerDay,
  sumPayableParishExpensePerDay,
} from './chapelParish.ts';
import { formatProductivityPercent, formatTaxRatePercent } from './villageEconomy.ts';
import {
  estimateVillageChapelTithePerDay,
  summarizeHouseholdWealth,
} from './villageProjections.ts';
import { totalChapelCofferGold } from '../resources/chapelCoffer.ts';
import { hasStaffedChapel } from '../logistics/landmarkAccess.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import type { WorldQueries } from '../resources/WorldQueries.ts';
import {
  TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
} from '../generated/gameBalance.ts';
import { gameClock } from '../world/gameCalendar.ts';
import {
  computeSettlementBackyardEconomyPlan,
  type SettlementBackyardEconomyPlan,
} from './settlementBackyardEconomy.ts';

export type VillageAdminReadout = {
  taxRateLabel: string;
  reserveLabel: string;
  productivityLabel: string;
  gdpLabel: string;
  householdWealthLabel: string;
  householdSavingsLabel: string;
  taxIncomeLabel: string;
  chapelTitheLabel: string;
  parishExpenseLabel: string;
  autoSweepLabel: string;
  cofferBalanceLabel: string;
  parishLedgerLabel: string;
  backyardEconomy: SettlementBackyardEconomyPlan | null;
};

export function buildVillageAdminReadout(input: {
  gameState: GameState | null;
  worldQueries: WorldQueries | null;
  worldHydrology?: number;
  taxRate: number;
  parishPolicy: ParishPolicyState;
}): VillageAdminReadout {
  const {
    gameState,
    worldQueries,
    taxRate,
    parishPolicy,
    worldHydrology = 50,
  } = input;

  if (!gameState) {
    return emptyReadout(taxRate, parishPolicy);
  }

  const residences = [...gameState.residences.values()];
  const buildings = [...gameState.buildings.values()];
  const chapels = buildings.filter((building) => building.kind === 'chapel');
  const wealthSummary = summarizeHouseholdWealth(residences);
  const staffedTownHallAvailable = buildings.some(
    (building) =>
      building.kind === 'town_hall'
      && building.constructionComplete !== false
      && building.assignedLabor > 0,
  );
  const taxCollectionMultiplier = staffedTownHallAvailable
    ? 1
    : TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER;
  const sabbathObserved = parishPolicy.sabbathObservanceEnabled
    && hasStaffedChapel(chapels);
  const roadComponentFor = worldQueries === null
    ? undefined
    : typeof worldQueries.getRoadComponentIds === 'function'
      ? (entity: { x: number; z: number }) =>
          worldQueries.getRoadComponentIds(entity.x, entity.z)
      : typeof worldQueries.getRoadComponentId === 'function'
        ? (entity: { x: number; z: number }) =>
            worldQueries.getRoadComponentId(entity.x, entity.z)
        : undefined;
  const backyardEconomy = computeSettlementBackyardEconomyPlan({
    state: gameState,
    clock: gameClock(gameState.tick),
    hydrology: worldHydrology,
    taxRate,
    taxCollectionMultiplier,
    sabbathObserved,
    roadComponentFor,
  });
  const chapelTithe = worldQueries
    ? estimateVillageChapelTithePerDay(
        residences,
        (residence) => worldQueries.getServingChapelForResidence(residence),
      )
    : 0;
  const cofferBalance = totalChapelCofferGold(buildings);
  const parishExpense = sumPayableParishExpensePerDay(chapels);
  const autoSweep = sumPayableAutoSweepPerDay(
    chapels,
    parishPolicy.cofferReserveGold,
    parishPolicy.autoSweepEnabled,
  );
  const hasStaffedChapelOnMap = hasStaffedChapel(chapels);

  return {
    taxRateLabel: formatTaxRatePercent(taxRate),
    reserveLabel: `${Math.round(parishPolicy.cofferReserveGold)} gold`,
    productivityLabel: formatProductivityPercent(taxRate),
    gdpLabel: `~${backyardEconomy.currentDayRoutedActivity.toFixed(1)} gold today`,
    householdWealthLabel: wealthSummary.occupiedHomes > 0
      ? `${wealthSummary.totalWealth.toFixed(1)} gold (${wealthSummary.homesWithSavings}/${wealthSummary.occupiedHomes} homes)`
      : '0 gold saved',
    householdSavingsLabel: formatBackyardSavings(
      backyardEconomy,
      worldQueries !== null,
    ),
    taxIncomeLabel: formatBackyardTax(backyardEconomy),
    chapelTitheLabel: hasStaffedChapelOnMap && worldQueries
      ? `~${chapelTithe.toFixed(1)} gold / day`
      : hasStaffedChapelOnMap ? '—' : 'Unstaffed chapel',
    parishExpenseLabel: chapels.length > 0
      ? `${formatParishGoldPerDay(parishExpense)} (coffer-limited)`
      : 'No chapel',
    autoSweepLabel: parishPolicy.autoSweepEnabled
      ? `${formatParishGoldPerDay(autoSweep)} (rough est.)`
      : 'Off',
    cofferBalanceLabel: `${cofferBalance.toFixed(1)} gold`,
    parishLedgerLabel: `${parishLedgerTotal(parishPolicy).toFixed(1)} gold moved`,
    backyardEconomy,
  };
}

function formatBackyardSavings(
  plan: SettlementBackyardEconomyPlan,
  topologyKnown: boolean,
): string {
  if (!topologyKnown) return '—';
  const gross = plan.currentDayHouseholdIncome;
  const storable = plan.currentDayStorableHouseholdIncome;
  if (plan.wealthCappedGardens > 0 && storable + 0.05 < gross) {
    return `~${gross.toFixed(1)} gold today; ${storable.toFixed(1)} fits before cap`;
  }
  return `~${gross.toFixed(1)} gold today`;
}

function formatBackyardTax(plan: SettlementBackyardEconomyPlan): string {
  const collected = plan.currentDayCollectedTax;
  const assessed = plan.currentDayAssessedTax;
  if (collected + 0.05 < assessed) {
    return `~${collected.toFixed(1)} gold collected of ${assessed.toFixed(1)} assessed today`;
  }
  return `~${collected.toFixed(1)} gold collected today`;
}

function emptyReadout(taxRate: number, parishPolicy: ParishPolicyState): VillageAdminReadout {
  return {
    taxRateLabel: formatTaxRatePercent(taxRate),
    reserveLabel: `${Math.round(parishPolicy.cofferReserveGold)} gold`,
    productivityLabel: formatProductivityPercent(taxRate),
    gdpLabel: '0 gold / day',
    householdWealthLabel: '0 gold saved',
    householdSavingsLabel: '—',
    taxIncomeLabel: '0 gold / day',
    chapelTitheLabel: 'Unstaffed chapel',
    parishExpenseLabel: 'No chapel',
    autoSweepLabel: 'Off',
    cofferBalanceLabel: '0 gold',
    parishLedgerLabel: `${parishLedgerTotal(parishPolicy).toFixed(1)} gold moved`,
    backyardEconomy: null,
  };
}

export function filterChapels(buildings: Iterable<BuildingState>): BuildingState[] {
  return [...buildings].filter(
    (building) => building.kind === 'chapel' && building.constructionComplete !== false,
  );
}
