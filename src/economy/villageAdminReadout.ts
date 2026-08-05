import type { ParishPolicyState } from './chapelParish.ts';
import {
  formatParishGoldPerDay,
  parishLedgerTotal,
  sumPayableParishExpensePerDay,
} from './chapelParish.ts';
import { formatProductivityPercent, formatTaxRatePercent } from './villageEconomy.ts';
import {
  estimateVillageChapelTithePerDay,
  summarizeHouseholdWealth,
} from './villageProjections.ts';
import { totalChapelCofferGold } from '../resources/chapelCoffer.ts';
import {
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
} from '../fires/fireIncident.ts';
import { hasStaffedChapel } from '../logistics/landmarkAccess.ts';
import { claimResidenceRoutesByNearestSupplier } from '../logistics/roadLogistics.ts';
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
  productivityLabel: string;
  gdpLabel: string;
  householdWealthLabel: string;
  householdSavingsLabel: string;
  taxIncomeLabel: string;
  chapelTitheLabel: string;
  parishExpenseLabel: string;
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
  const fireDisabled = fireDisabledBuildingIds(gameState.fireIncidents.values());
  const fireDisabledHomes = fireDisabledResidenceIds(
    gameState.fireIncidents.values(),
  );
  const operationalResidences = residences.filter(
    (residence) => !fireDisabledHomes.has(residence.id),
  );
  const chapels = buildings.filter(
    (building) => building.kind === 'chapel' && !fireDisabled.has(building.id),
  );
  const activeChapels = chapels.filter(
    (chapel) =>
      chapel.constructionComplete !== false
      && chapel.assignedLabor > 0,
  );
  const wealthSummary = summarizeHouseholdWealth(residences);
  const staffedTownHallAvailable = buildings.some(
    (building) =>
      building.kind === 'town_hall'
      && building.constructionComplete !== false
      && building.assignedLabor > 0
      && !fireDisabled.has(building.id),
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
  let chapelTithe = 0;
  if (worldQueries) {
    const roadNetwork = typeof worldQueries.getRoadNetworkSnapshot === 'function'
      ? worldQueries.getRoadNetworkSnapshot()
      : null;
    if (roadNetwork) {
      const claims = claimResidenceRoutesByNearestSupplier(
        roadNetwork,
        activeChapels,
        operationalResidences,
        () => true,
      );
      const chapelsById = new Map(
        activeChapels.map((chapel) => [chapel.id, chapel]),
      );
      chapelTithe = estimateVillageChapelTithePerDay(
        operationalResidences,
        (residence) => {
          const claim = claims.get(residence.id);
          return claim == null
            ? null
            : chapelsById.get(claim.supplierId) ?? null;
        },
        parishPolicy.sabbathObservanceEnabled,
      );
    } else {
      chapelTithe = estimateVillageChapelTithePerDay(
        operationalResidences,
        (residence) => worldQueries.getServingChapelForResidence(residence),
        parishPolicy.sabbathObservanceEnabled,
      );
    }
  }
  const cofferBalance = totalChapelCofferGold(buildings);
  const structurallyQuarantinedCoffer = totalChapelCofferGold(
    buildings.filter((building) =>
      fireDisabled.has(building.id)
      || building.constructionComplete === false),
  );
  const activeCoffer = Math.max(
    0,
    cofferBalance - structurallyQuarantinedCoffer,
  );
  const parishExpense = sumPayableParishExpensePerDay(chapels);
  const hasStaffedChapelOnMap = hasStaffedChapel(chapels);

  return {
    taxRateLabel: formatTaxRatePercent(taxRate),
    productivityLabel: formatProductivityPercent(taxRate),
    gdpLabel: `~${backyardEconomy.currentDayRoutedActivity.toFixed(1)} gold local trade today`,
    householdWealthLabel: wealthSummary.occupiedHomes > 0
      ? `${wealthSummary.totalWealth.toFixed(1)} gold (${wealthSummary.homesWithSavings}/${wealthSummary.occupiedHomes} homes)`
      : '0 gold saved',
    householdSavingsLabel: formatBackyardSavings(
      backyardEconomy,
      worldQueries !== null,
    ),
    taxIncomeLabel: formatBackyardTax(backyardEconomy),
    chapelTitheLabel: hasStaffedChapelOnMap && worldQueries
      ? `~${chapelTithe.toFixed(1)} gold / day${parishPolicy.sabbathObservanceEnabled ? ' (7-day average)' : ''}`
      : hasStaffedChapelOnMap ? '—' : 'Unstaffed church',
    parishExpenseLabel: chapels.length > 0
      ? `${formatParishGoldPerDay(parishExpense)} (coffer-limited)`
      : 'No chapel',
    cofferBalanceLabel: structurallyQuarantinedCoffer > 0.05
      ? `${activeCoffer.toFixed(1)} gold active / ${cofferBalance.toFixed(1)} church-owned · ${structurallyQuarantinedCoffer.toFixed(1)} sealed pending structural recovery`
      : `${cofferBalance.toFixed(1)} gold`,
    parishLedgerLabel: `${parishLedgerTotal(parishPolicy).toFixed(1)} gold spent on clergy, upkeep, and charity`,
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
    return `~${collected.toFixed(1)} gold levied into market lockboxes of ${assessed.toFixed(1)} assessed today`;
  }
  return `~${collected.toFixed(1)} gold levied into market lockboxes today`;
}

function emptyReadout(taxRate: number, parishPolicy: ParishPolicyState): VillageAdminReadout {
  return {
    taxRateLabel: formatTaxRatePercent(taxRate),
    productivityLabel: formatProductivityPercent(taxRate),
    gdpLabel: '0 gold / day',
    householdWealthLabel: '0 gold saved',
    householdSavingsLabel: '—',
    taxIncomeLabel: '0 gold / day',
    chapelTitheLabel: 'Unstaffed chapel',
    parishExpenseLabel: 'No chapel',
    cofferBalanceLabel: '0 gold',
    parishLedgerLabel: `${parishLedgerTotal(parishPolicy).toFixed(1)} gold spent on clergy, upkeep, and charity`,
    backyardEconomy: null,
  };
}

export function filterChapels(buildings: Iterable<BuildingState>): BuildingState[] {
  return [...buildings].filter(
    (building) => building.kind === 'chapel' && building.constructionComplete !== false,
  );
}
