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
import {
  DEFAULT_NIGHT_POLICY,
  normalizeNightPolicyCode,
} from '../../economy/nightPolicy.ts';
import type { GameTableSyncState } from './gameTableSyncState.ts';
import { DEFAULT_FISCAL_POLICY } from '../../economy/fiscalPolicy.ts';

export function syncPlayerResources(rows: Iterable<PlayerResources>, state: GameTableSyncState): void {
  state.stockpile = createEmptyStockpile();
  state.physicalFoundingSiteEnabled = false;
  state.legacyUnhousedPopulationBonusEnabled = true;
  state.economicActivityTaxRate = ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
  state.fiscalPolicy = { ...DEFAULT_FISCAL_POLICY };
  state.seasonalLaborStewardEnabled = DEFAULT_SEASONAL_LABOR_STEWARD_ENABLED;
  state.constructionLaborStewardEnabled = DEFAULT_CONSTRUCTION_LABOR_STEWARD_ENABLED;
  state.productionLaborStewardEnabled = DEFAULT_PRODUCTION_LABOR_STEWARD_ENABLED;
  state.laborStewardReserve = DEFAULT_LABOR_STEWARD_RESERVE;
  state.parishPolicy = { ...DEFAULT_PARISH_POLICY };
  state.monasteryPolicy = { ...DEFAULT_MONASTERY_POLICY };
  state.nightPolicy = { ...DEFAULT_NIGHT_POLICY };
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
      berries: row.berries ?? 0,
      mushrooms: row.mushrooms ?? 0,
      fish: row.fish ?? 0,
      food: row.food ?? 0,
      grain: row.grain ?? 0,
      barley: row.barley ?? 0,
      malt: row.malt ?? 0,
      flax: row.flax ?? 0,
      flour: row.flour ?? 0,
      ale: row.ale ?? 0,
      preservedFood: row.preservedFood ?? 0,
      honey: row.honey ?? 0,
      wine: row.wine ?? 0,
      wool: row.wool ?? 0,
      cloth: row.cloth ?? 0,
      ironwork: row.ironwork ?? 0,
      polearms: row.polearms ?? 0,
      iron: row.iron ?? 0,
      clay: row.clay ?? 0,
      salt: row.salt ?? 0,
      charcoal: row.charcoal ?? 0,
      pottery: row.pottery ?? 0,
      roofTiles: Number(
        (row as typeof row & Partial<{ roofTiles: number }>).roofTiles ?? 0,
      ),
      bread: row.bread ?? 0,
      meat: row.meat ?? 0,
      milk: row.milk ?? 0,
      apples: row.apples ?? 0,
      cherries: row.cherries ?? 0,
      vegetables: row.vegetables ?? 0,
      eggs: row.eggs ?? 0,
      grapes: row.grapes ?? 0,
      porridge: row.porridge ?? 0,
      curedMeat: row.curedMeat ?? 0,
      smokedFish: row.smokedFish ?? 0,
      cheese: row.cheese ?? 0,
    };
    state.physicalFoundingSiteEnabled = row.physicalFoundingSiteEnabled ?? false;
    state.legacyUnhousedPopulationBonusEnabled =
      row.legacyUnhousedPopulationBonusEnabled ?? true;
    state.economicActivityTaxRate = row.economicActivityTaxRate ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
    state.fiscalPolicy = {
      landLevyRate: row.landLevyRate ?? DEFAULT_FISCAL_POLICY.landLevyRate,
      importDutyRate: row.importDutyRate ?? DEFAULT_FISCAL_POLICY.importDutyRate,
      exportDutyRate: row.exportDutyRate ?? DEFAULT_FISCAL_POLICY.exportDutyRate,
      landLevyAssessedTotal: row.landLevyAssessedTotal ?? 0,
      landLevyCollectedTotal: row.landLevyCollectedTotal ?? 0,
      importDutyCollectedTotal: row.importDutyCollectedTotal ?? 0,
      exportDutyCollectedTotal: row.exportDutyCollectedTotal ?? 0,
      privateExportIncomeTotal: row.privateExportIncomeTotal ?? 0,
    };
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
      autoSweepEnabled: false,
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
    state.nightPolicy = {
      watch: normalizeNightPolicyCode(row.nightWatchPolicy),
      gathering: normalizeNightPolicyCode(row.nightGatheringPolicy),
      work: normalizeNightPolicyCode(row.nightWorkPolicy),
      lighting: normalizeNightPolicyCode(row.nightLightingPolicy),
      curfew: normalizeNightPolicyCode(row.nightCurfewPolicy),
      lastReportDay: Number(row.lastNightReportDay ?? 0),
      lastHouseholds: Number(row.lastNightHouseholds ?? 0),
      lastWellRestedHouseholds: Number(row.lastNightWellRestedHouseholds ?? 0),
      lastColdHouseholds: Number(row.lastNightColdHouseholds ?? 0),
      lastSocialHouseholds: Number(row.lastNightSocialHouseholds ?? 0),
      lastWorkers: Number(row.lastNightWorkers ?? 0),
      lastWatchStrength: row.lastNightWatchStrength ?? 0,
      lastIncidents: Number(row.lastNightIncidents ?? 0),
      lastTheftGold: row.lastNightTheftGold ?? 0,
      lastWildlifeSightings: Number(row.lastNightWildlifeSightings ?? 0),
      lastLightingFuelUsed: row.lastNightLightingFuelUsed ?? 0,
      lastLightingFuelShortfall: row.lastNightLightingFuelShortfall ?? 0,
      communityCohesion: row.nightCommunityCohesion ?? DEFAULT_NIGHT_POLICY.communityCohesion,
      laborFatigue: row.nightLaborFatigue ?? 0,
    };
    break;
  }
}
