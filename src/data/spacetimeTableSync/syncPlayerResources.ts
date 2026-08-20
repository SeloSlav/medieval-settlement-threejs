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
import { wholeResourceUnits } from '../../resources/resourceUnits.ts';
import {
  DEFAULT_PANTRY_SAFEGUARD_POLICY,
  normalizePantrySafeguardPolicy,
} from '../../economy/pantrySafeguardPolicy.ts';

export function syncPlayerResources(rows: Iterable<PlayerResources>, state: GameTableSyncState): void {
  state.stockpile = createEmptyStockpile();
  state.physicalFoundingSiteEnabled = false;
  state.legacyUnhousedPopulationBonusEnabled = true;
  state.economicActivityTaxRate = ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
  state.pantrySafeguardPolicy = DEFAULT_PANTRY_SAFEGUARD_POLICY;
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
      timber: wholeResourceUnits(row.timber),
      stone: wholeResourceUnits(row.stone),
      firewood: wholeResourceUnits(row.firewood),
      water: wholeResourceUnits(row.water),
      gold: wholeResourceUnits(row.gold),
      game: 0,
      berries: wholeResourceUnits(row.berries),
      mushrooms: wholeResourceUnits(row.mushrooms),
      fish: wholeResourceUnits(row.fish),
      food: wholeResourceUnits(row.food),
      ryeSheaves: wholeResourceUnits(row.ryeSheaves),
      oatSheaves: wholeResourceUnits(row.oatSheaves),
      barleySheaves: wholeResourceUnits(row.barleySheaves),
      maslinSheaves: wholeResourceUnits(row.maslinSheaves),
      ryeGrain: wholeResourceUnits(row.ryeGrain),
      oatGrain: wholeResourceUnits(row.oatGrain),
      maslinGrain: wholeResourceUnits(row.maslinGrain),
      barley: wholeResourceUnits(row.barley),
      malt: wholeResourceUnits(row.malt),
      flax: wholeResourceUnits(row.flax),
      ryeFlour: wholeResourceUnits(row.ryeFlour),
      maslinFlour: wholeResourceUnits(row.maslinFlour),
      ale: wholeResourceUnits(row.ale),
      cider: wholeResourceUnits(row.cider),
      mead: wholeResourceUnits(row.mead),
      preservedFood: wholeResourceUnits(row.preservedFood),
      honey: wholeResourceUnits(row.honey),
      wine: wholeResourceUnits(row.wine),
      wool: wholeResourceUnits(row.wool),
      cloth: wholeResourceUnits(row.cloth),
      ironwork: wholeResourceUnits(row.ironwork),
      polearms: wholeResourceUnits(row.polearms),
      iron: wholeResourceUnits(row.iron),
      clay: wholeResourceUnits(row.clay),
      salt: wholeResourceUnits(row.salt),
      charcoal: wholeResourceUnits(row.charcoal),
      pottery: wholeResourceUnits(row.pottery),
      roofTiles: wholeResourceUnits(
        (row as typeof row & Partial<{ roofTiles: number }>).roofTiles,
      ),
      ryeBread: wholeResourceUnits(row.ryeBread),
      maslinBread: wholeResourceUnits(row.maslinBread),
      meat: wholeResourceUnits(row.meat),
      milk: wholeResourceUnits(row.milk),
      apples: wholeResourceUnits(row.apples),
      cherries: wholeResourceUnits(row.cherries),
      vegetables: wholeResourceUnits(row.vegetables),
      eggs: wholeResourceUnits(row.eggs),
      grapes: wholeResourceUnits(row.grapes),
      curedMeat: wholeResourceUnits(row.curedMeat),
      smokedFish: wholeResourceUnits(row.smokedFish),
      cheese: wholeResourceUnits(row.cheese),
    };
    state.physicalFoundingSiteEnabled = row.physicalFoundingSiteEnabled ?? false;
    state.legacyUnhousedPopulationBonusEnabled =
      row.legacyUnhousedPopulationBonusEnabled ?? true;
    state.economicActivityTaxRate = row.economicActivityTaxRate ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
    state.pantrySafeguardPolicy = normalizePantrySafeguardPolicy(
      row.pantrySafeguardPolicy,
    );
    state.fiscalPolicy = {
      landLevyRate: row.landLevyRate ?? DEFAULT_FISCAL_POLICY.landLevyRate,
      importDutyRate: row.importDutyRate ?? DEFAULT_FISCAL_POLICY.importDutyRate,
      exportDutyRate: row.exportDutyRate ?? DEFAULT_FISCAL_POLICY.exportDutyRate,
      landLevyAssessedTotal: wholeResourceUnits(row.landLevyAssessedTotal),
      landLevyCollectedTotal: wholeResourceUnits(row.landLevyCollectedTotal),
      importDutyCollectedTotal: wholeResourceUnits(row.importDutyCollectedTotal),
      exportDutyCollectedTotal: wholeResourceUnits(row.exportDutyCollectedTotal),
      privateExportIncomeTotal: wholeResourceUnits(row.privateExportIncomeTotal),
      localDiscretionarySpendTotal: wholeResourceUnits(row.localDiscretionarySpendTotal),
      localProducerIncomeTotal: wholeResourceUnits(row.localProducerIncomeTotal),
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
      manualCollectTotal: wholeResourceUnits(row.parishManualCollectTotal),
      autoSweepTotal: wholeResourceUnits(row.parishAutoSweepTotal),
      salaryPaidTotal: wholeResourceUnits(row.parishSalaryPaidTotal),
      upkeepPaidTotal: wholeResourceUnits(row.parishUpkeepPaidTotal),
      charityPaidTotal: wholeResourceUnits(row.parishCharityPaidTotal),
    };
    state.monasteryPolicy = {
      titheShare: row.monasteryTitheShare ?? DEFAULT_MONASTERY_POLICY.titheShare,
      feastsEnabled: row.monasteryFeastsEnabled ?? DEFAULT_MONASTERY_POLICY.feastsEnabled,
      levyRate: row.monasteryLevyRate ?? DEFAULT_MONASTERY_POLICY.levyRate,
      levyCollectedTotal: wholeResourceUnits(row.monasteryLevyCollectedTotal),
      tithePaidTotal: wholeResourceUnits(row.monasteryTithePaidTotal),
      pilgrimageGoldTotal: wholeResourceUnits(row.monasteryPilgrimageGoldTotal),
      foodCharityTotal: wholeResourceUnits(row.monasteryFoodCharityTotal),
      feastsHeldTotal: Number(row.monasteryFeastsHeldTotal ?? 0),
      seedRescueTotal: wholeResourceUnits(row.monasterySeedRescueTotal),
      scriptoriumTimberSavedTotal: wholeResourceUnits(row.monasteryScriptoriumTimberSavedTotal),
      scriptoriumStoneSavedTotal: wholeResourceUnits(row.monasteryScriptoriumStoneSavedTotal),
      scriptoriumIronworkSavedTotal: wholeResourceUnits(row.monasteryScriptoriumIronworkSavedTotal),
      scriptoriumRoofTilesSavedTotal: wholeResourceUnits(row.monasteryScriptoriumRoofTilesSavedTotal),
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
      lastTheftGold: wholeResourceUnits(row.lastNightTheftGold),
      lastWildlifeSightings: Number(row.lastNightWildlifeSightings ?? 0),
      lastLightingFuelUsed: wholeResourceUnits(row.lastNightLightingFuelUsed),
      lastLightingFuelShortfall: wholeResourceUnits(row.lastNightLightingFuelShortfall),
      communityCohesion: row.nightCommunityCohesion ?? DEFAULT_NIGHT_POLICY.communityCohesion,
      laborFatigue: row.nightLaborFatigue ?? 0,
    };
    break;
  }
}
