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
  estimateVillageGdpPerDay,
  estimateVillageHouseholdSavingsPerDay,
  estimateVillageTaxPerDay,
  summarizeHouseholdWealth,
} from './villageProjections.ts';
import { totalChapelCofferGold } from '../resources/chapelCoffer.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import type { WorldQueries } from '../resources/WorldQueries.ts';

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
};

export function buildVillageAdminReadout(input: {
  gameState: GameState | null;
  worldQueries: WorldQueries | null;
  taxRate: number;
  parishPolicy: ParishPolicyState;
}): VillageAdminReadout {
  const { gameState, worldQueries, taxRate, parishPolicy } = input;

  if (!gameState) {
    return emptyReadout(taxRate, parishPolicy);
  }

  const gardens = gameState.backyardGardens.values();
  const residences = gameState.residences.values();
  const buildings = [...gameState.buildings.values()];
  const chapels = buildings.filter((building) => building.kind === 'chapel');
  const getResidence = (id: string) => gameState.residences.get(id);

  const gdp = estimateVillageGdpPerDay(gardens, getResidence);
  const taxIncome = estimateVillageTaxPerDay(gardens, getResidence, taxRate);
  const wealthSummary = summarizeHouseholdWealth(residences);
  const householdSavings = worldQueries
    ? estimateVillageHouseholdSavingsPerDay(
        gardens,
        (id) => gameState.residences.get(id),
        taxRate,
        (residence) => worldQueries.isResidenceConnectedToMarketplace(residence),
      )
    : 0;
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
  const hasStaffedChapel = chapels.some((building) => building.assignedLabor > 0);

  return {
    taxRateLabel: formatTaxRatePercent(taxRate),
    reserveLabel: `${Math.round(parishPolicy.cofferReserveGold)} gold`,
    productivityLabel: formatProductivityPercent(taxRate),
    gdpLabel: `${gdp.toFixed(1)} gold / day`,
    householdWealthLabel: wealthSummary.occupiedHomes > 0
      ? `${wealthSummary.totalWealth.toFixed(1)} gold (${wealthSummary.homesWithSavings}/${wealthSummary.occupiedHomes} homes)`
      : '0 gold saved',
    householdSavingsLabel: worldQueries
      ? `~${householdSavings.toFixed(1)} gold / day`
      : '—',
    taxIncomeLabel: `~${taxIncome.toFixed(1)} gold / day`,
    chapelTitheLabel: hasStaffedChapel && worldQueries
      ? `~${chapelTithe.toFixed(1)} gold / day`
      : hasStaffedChapel ? '—' : 'Unstaffed chapel',
    parishExpenseLabel: chapels.length > 0
      ? `${formatParishGoldPerDay(parishExpense)} (coffer-limited)`
      : 'No chapel',
    autoSweepLabel: parishPolicy.autoSweepEnabled
      ? `${formatParishGoldPerDay(autoSweep)} (rough est.)`
      : 'Off',
    cofferBalanceLabel: `${cofferBalance.toFixed(1)} gold`,
    parishLedgerLabel: `${parishLedgerTotal(parishPolicy).toFixed(1)} gold moved`,
  };
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
  };
}

export function filterChapels(buildings: Iterable<BuildingState>): BuildingState[] {
  return [...buildings].filter((building) => building.kind === 'chapel');
}
