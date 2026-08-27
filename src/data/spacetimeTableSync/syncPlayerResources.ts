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
  if (!state.identityHex) return;

  for (const row of rows) {
    if (row.owner.toHexString() !== state.identityHex) continue;
    const leatherRow = row as typeof row & Partial<{
      pelts: number;
      hides: number;
      leather: number;
      shoes: number;
      pears: number;
      aronia: number;
      rosehips: number;
      cabbage: number;
      carrots: number;
      beetroot: number;
      aroniaJam: number;
      rosehipJam: number;
      pearCider: number;
      yarn: number;
      linen: number;
    }>;
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
      ryeSheaves: wholeResourceUnits(row.ryeSheaves),
      oatSheaves: wholeResourceUnits(row.oatSheaves),
      barleySheaves: wholeResourceUnits(row.barleySheaves),
      maslinSheaves: wholeResourceUnits(row.maslinSheaves),
      ryeGrain: wholeResourceUnits(row.ryeGrain),
      oatGrain: wholeResourceUnits(row.oatGrain),
      // Prepared fodder exists only in physical livestock-building stores.
      animalFeed: 0,
      maslinGrain: wholeResourceUnits(row.maslinGrain),
      barley: wholeResourceUnits(row.barley),
      malt: wholeResourceUnits(row.malt),
      flax: wholeResourceUnits(row.flax),
      ryeFlour: wholeResourceUnits(row.ryeFlour),
      maslinFlour: wholeResourceUnits(row.maslinFlour),
      ale: wholeResourceUnits(row.ale),
      cider: wholeResourceUnits(row.cider),
      pearCider: wholeResourceUnits(leatherRow.pearCider),
      mead: wholeResourceUnits(row.mead),
      preservedFood: wholeResourceUnits(row.preservedFood),
      honey: wholeResourceUnits(row.honey),
      wax: wholeResourceUnits(row.wax),
      candles: wholeResourceUnits(row.candles),
      wine: wholeResourceUnits(row.wine),
      wool: wholeResourceUnits(row.wool),
      yarn: wholeResourceUnits(leatherRow.yarn),
      linen: wholeResourceUnits(leatherRow.linen),
      cloth: wholeResourceUnits(row.cloth),
      pelts: wholeResourceUnits(leatherRow.pelts),
      hides: wholeResourceUnits(leatherRow.hides),
      leather: wholeResourceUnits(leatherRow.leather),
      shoes: wholeResourceUnits(leatherRow.shoes),
      ironwork: wholeResourceUnits(row.ironwork),
      polearms: wholeResourceUnits(row.polearms),
      iron: wholeResourceUnits(row.iron),
      clay: wholeResourceUnits(row.clay),
      salt: wholeResourceUnits(row.salt),
      charcoal: wholeResourceUnits(row.charcoal),
      pottery: wholeResourceUnits(row.pottery),
      // These goods are authoritative physical inventories (building/residence
      // stocks), not fields on the legacy aggregate player-resources row.
      manure: 0,
      remedies: 0,
      roofTiles: wholeResourceUnits(
        (row as typeof row & Partial<{ roofTiles: number }>).roofTiles,
      ),
      ryeBread: wholeResourceUnits(row.ryeBread),
      maslinBread: wholeResourceUnits(row.maslinBread),
      meat: wholeResourceUnits(row.meat),
      milk: wholeResourceUnits(row.milk),
      apples: wholeResourceUnits(row.apples),
      pears: wholeResourceUnits(leatherRow.pears),
      cherries: wholeResourceUnits(row.cherries),
      aronia: wholeResourceUnits(leatherRow.aronia),
      rosehips: wholeResourceUnits(leatherRow.rosehips),
      vegetables: wholeResourceUnits(row.vegetables),
      cabbage: wholeResourceUnits(leatherRow.cabbage),
      carrots: wholeResourceUnits(leatherRow.carrots),
      beetroot: wholeResourceUnits(leatherRow.beetroot),
      eggs: wholeResourceUnits(row.eggs),
      grapes: wholeResourceUnits(row.grapes),
      curedMeat: wholeResourceUnits(row.curedMeat),
      smokedFish: wholeResourceUnits(row.smokedFish),
      cheese: wholeResourceUnits(row.cheese),
      aroniaJam: wholeResourceUnits(leatherRow.aroniaJam),
      rosehipJam: wholeResourceUnits(leatherRow.rosehipJam),
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
      cofferReserveGold: wholeResourceUnits(
        row.chapelCofferReserveGold ?? DEFAULT_PARISH_POLICY.cofferReserveGold,
      ),
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
    break;
  }
}
