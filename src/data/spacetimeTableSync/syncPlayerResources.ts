import type { PlayerResources } from '../../generated/types.ts';
import { ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT } from '../../economy/villageEconomy.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import { DEFAULT_MONASTERY_POLICY } from '../../economy/monasteryPolicy.ts';
import {
  DEFAULT_CONSTRUCTION_LABOR_STEWARD_ENABLED,
  DEFAULT_LABOR_STEWARD_RESERVE,
  DEFAULT_PRODUCTION_LABOR_STEWARD_ENABLED,
  DEFAULT_SEASONAL_LABOR_STEWARD_ENABLED,
  normalizeLaborStewardReserve,
} from '../../economy/laborSteward.ts';
import { createEmptyStockpile } from '../../resources/types.ts';
import type { GameTableSyncState } from './gameTableSyncState.ts';

export function syncPlayerResources(rows: Iterable<PlayerResources>, state: GameTableSyncState): void {
  state.stockpile = createEmptyStockpile();
  state.physicalFoundingSiteEnabled = false;
  state.legacyUnhousedPopulationBonusEnabled = true;
  state.economicActivityTaxRate = ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
  state.seasonalLaborStewardEnabled = DEFAULT_SEASONAL_LABOR_STEWARD_ENABLED;
  state.constructionLaborStewardEnabled = DEFAULT_CONSTRUCTION_LABOR_STEWARD_ENABLED;
  state.productionLaborStewardEnabled = DEFAULT_PRODUCTION_LABOR_STEWARD_ENABLED;
  state.laborStewardReserve = DEFAULT_LABOR_STEWARD_RESERVE;
  state.parishPolicy = { ...DEFAULT_PARISH_POLICY };
  state.monasteryPolicy = { ...DEFAULT_MONASTERY_POLICY };
  if (!state.identityHex) return;

  for (const row of rows) {
    if (row.owner.toHexString() !== state.identityHex) continue;
    state.stockpile = {
      timber: row.timber,
      stone: row.stone,
      firewood: row.firewood,
      water: row.water,
      gold: row.gold ?? 0,
      game: 0,
      berries: 0,
      mushrooms: 0,
      fish: 0,
      food: row.food ?? 0,
      grain: row.grain ?? 0,
      flour: row.flour ?? 0,
      ale: row.ale ?? 0,
      preservedFood: row.preservedFood ?? 0,
      honey: row.honey ?? 0,
      wine: row.wine ?? 0,
      wool: row.wool ?? 0,
      cloth: row.cloth ?? 0,
      ironwork: row.ironwork ?? 0,
      polearms: row.polearms ?? 0,
    };
    state.physicalFoundingSiteEnabled = row.physicalFoundingSiteEnabled ?? false;
    state.legacyUnhousedPopulationBonusEnabled =
      row.legacyUnhousedPopulationBonusEnabled ?? true;
    state.economicActivityTaxRate = row.economicActivityTaxRate ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
    state.seasonalLaborStewardEnabled = row.seasonalLaborStewardEnabled
      ?? DEFAULT_SEASONAL_LABOR_STEWARD_ENABLED;
    state.constructionLaborStewardEnabled = row.constructionLaborStewardEnabled
      ?? DEFAULT_CONSTRUCTION_LABOR_STEWARD_ENABLED;
    state.productionLaborStewardEnabled = row.productionLaborStewardEnabled
      ?? DEFAULT_PRODUCTION_LABOR_STEWARD_ENABLED;
    state.laborStewardReserve = normalizeLaborStewardReserve(
      row.laborStewardReserve ?? DEFAULT_LABOR_STEWARD_RESERVE,
    );
    state.parishPolicy = {
      autoSweepEnabled: row.chapelAutoSweepEnabled ?? DEFAULT_PARISH_POLICY.autoSweepEnabled,
      cofferReserveGold: row.chapelCofferReserveGold ?? DEFAULT_PARISH_POLICY.cofferReserveGold,
      sabbathObservanceEnabled: row.sabbathObservanceEnabled ?? DEFAULT_PARISH_POLICY.sabbathObservanceEnabled,
      manualCollectTotal: row.parishManualCollectTotal ?? 0,
      autoSweepTotal: row.parishAutoSweepTotal ?? 0,
      salaryPaidTotal: row.parishSalaryPaidTotal ?? 0,
      upkeepPaidTotal: row.parishUpkeepPaidTotal ?? 0,
      charityPaidTotal: row.parishCharityPaidTotal ?? 0,
    };
    state.monasteryPolicy = {
      titheShare: row.monasteryTitheShare ?? DEFAULT_MONASTERY_POLICY.titheShare,
      feastsEnabled: row.monasteryFeastsEnabled ?? DEFAULT_MONASTERY_POLICY.feastsEnabled,
      tithePaidTotal: row.monasteryTithePaidTotal ?? 0,
      pilgrimageGoldTotal: row.monasteryPilgrimageGoldTotal ?? 0,
      foodCharityTotal: row.monasteryFoodCharityTotal ?? 0,
    };
    break;
  }
}
