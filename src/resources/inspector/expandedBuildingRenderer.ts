import { getBuildingDefinition } from '../buildings.ts';
import {
  CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP,
  CARPENTER_CART_SERVICE_TIMBER_PER_TRIP,
  CARPENTER_DELIVERY_SPEED_MULTIPLIER,
  CARPENTER_IRONWORK_PER_POLEARM,
  CARPENTER_TIMBER_COST_MULTIPLIER,
  CARPENTER_TIMBER_PER_POLEARM,
  APIARY_POLLINATION_BONUS_MAX,
  APIARY_WINTER_HONEY_REQUIRED,
  BREWERY_ALE_PER_CYCLE,
  BREWERY_APPLES_PER_CIDER_CYCLE,
  BREWERY_BARLEY_PER_MALT_CYCLE,
  BREWERY_BREWING_FIREWOOD_PER_CYCLE,
  BREWERY_BREWING_WATER_PER_CYCLE,
  BREWERY_CIDER_PER_CYCLE,
  BREWERY_HONEY_PER_MEAD_CYCLE,
  BREWERY_MALTING_FIREWOOD_PER_CYCLE,
  BREWERY_MALTING_WATER_PER_CYCLE,
  BREWERY_MEAD_PER_CYCLE,
  CANDLE_TRANSFER_PER_TRIP,
  FOOD_DELIVERY_SPEED_MPS,
  FOOD_DELIVERY_UNLOAD_SEC,
  FRESH_FOOD_STORAGE_GRANARY_FACTOR,
  GRAIN_TRANSFER_PER_TRIP,
  MONASTERY_FEAST_DRINK,
  MONASTERY_FEAST_FOOD,
  MONASTERY_FEAST_HONEY,
  MONASTERY_HOSPITALITY_HONEY_PER_DAY,
  MONASTERY_HOSPITALITY_DRINK_PER_DAY,
  MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
  POTTER_CLAY_PER_CYCLE,
  POTTER_FIREWOOD_PER_CYCLE,
  POTTER_POTTERY_PER_CYCLE,
  POTTER_ROOF_TILES_PER_CYCLE,
  POTTER_WATER_PER_CYCLE,
  SPINNING_RETTING_FLAX_PER_CYCLE,
  SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
  SPINNING_RETTING_LINEN_PER_CYCLE,
  SPINNING_RETTING_WOOL_PER_CYCLE,
  SPINNING_RETTING_YARN_PER_CYCLE,
  TIMBER_DELIVERY_SPEED_MPS,
  TIMBER_DELIVERY_UNLOAD_SEC,
  TEXTILE_TRANSFER_PER_TRIP,
  WEAVER_CLOTH_PER_CYCLE,
  WEAVER_LINEN_PER_CYCLE,
  WEAVER_YARN_PER_CYCLE,
  VINEYARD_FERMENTATION_SECONDS,
  VINEYARD_GRAPES_PER_FERMENTATION_BATCH,
  VINEYARD_WINE_PER_FERMENTATION_BATCH,
} from '../../generated/gameBalance.ts';
import {
  CARPENTER_CART_SERVICE_TARGET_PRESETS,
  carpenterCartServiceIronworkTarget,
  carpenterCartServiceTripsAvailable,
  carpenterCartServiceTimberTarget,
  normalizeCarpenterCartServiceTargetTrips,
} from '../../economy/carpenterSupport.ts';
import { roadDeliveryTripSeconds } from '../../logistics/deliveryLogistics.ts';
import {
  institutionalFoodDutyLabel,
  institutionalFoodSurplus,
} from '../../logistics/foodLogistics.ts';
import { compareStableEntityIds } from '../../logistics/roadLogistics.ts';
import {
  formatGrainWorkingBuffer,
  GRAIN_CRITICAL_RUNWAY_CYCLES,
} from '../../logistics/grainLogistics.ts';
import {
  windSiteThroughputMultiplier,
  windWeatherThroughputMultiplier,
} from '../../wind/windField.ts';
import { FARM_CROPS, type BuildingKind, type BuildingState, type InspectableTarget } from '../types.ts';
import { buildingDemolishHint, buildingExtentRow, buildingLaborView, buildingRoadAccessRow, civilianToolRows } from './buildingCommon.ts';
import { getBuildingProcessorStatus } from './buildingProcessorStatus.ts';
import { renderInboundSupplyRow, renderOutboundDeliveryRows, type DeliveryStatusContext } from './deliveryStatusRows.ts';
import {
  onsiteBuildingLabor,
  type DeliveryCargoKind,
  type DeliveryTripState,
} from '../../logistics/deliveryTrips.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import {
  DEFAULT_MONASTERY_POLICY,
  formatMonasteryFoodCharityTotal,
  formatMonasteryPilgrimageTotal,
  formatMonasteryTithePaidTotal,
  monasteryCharterLabel,
} from '../../economy/monasteryPolicy.ts';
import {
  formatHospitalityRunway,
  formatMonasteryFeastReadiness,
  formatNextMonasteryFeast,
  monasteryFeastReadiness,
  monasteryHospitalityPlan,
  monasteryHospitalityStatusLabel,
  nextMonasteryFeast,
} from '../../economy/monasteryHospitality.ts';
import {
  MONASTERY_CANDLE_CAPACITY,
  MONASTERY_CANDLE_USE_INTERVAL_DAYS,
  MONASTERY_LITURGY_PRESTIGE_MULTIPLIER,
  devotionalCandleContractLabel,
  devotionalCandlesSupplied,
} from '../../economy/devotionalCandles.ts';
import {
  MONASTERY_INFIRMARY_FOOD_PER_BED_DAY,
  MONASTERY_EXTENSIONS,
  monasteryArchetype,
  monasteryExtensionCount,
  monasteryEstateNextInvestmentCost,
  monasteryEstateYieldMultiplier,
  monasteryHasExtension,
  monasteryInfirmaryBeds,
  monasteryInfirmaryMortalityMultiplier,
  monasteryInfirmaryRecoveryMultiplier,
  monasteryScriptoriumRecoveryMultiplier,
  monasterySeedArchiveTargetPerCrop,
} from '../../buildings/monasteryEstate.ts';
import {
  buildingPreservedFoodStorageFactor,
  formatFreshFoodLoss,
  formatPreservedFoodLoss,
} from '../../economy/foodPreservation.ts';
import {
  edibleFoodStock,
  freshFoodStock,
  preservableFoodStock,
  preservedFoodStock,
} from '../../economy/foodInventory.ts';
import {
  granaryExportableGrain,
} from '../../economy/granaryPolicy.ts';
import {
  GRANARY_STORAGE_GROUPS,
  renderStorageAcceptanceControls,
} from '../../economy/storageAcceptancePolicy.ts';
import {
  CARPENTER_POLEARM_RESERVE_PRESETS,
  carpenterArmoryPlan,
} from '../../economy/carpenterArmoryPolicy.ts';
import {
  buildFarmsteadWorkPlan,
  fieldAcceptsFarmsteadLabor,
  farmsteadSeedGrainRequired,
  type SeasonalWorkPlan,
} from '../../farming/farmWorkPlanning.ts';
import {
  normalizeThreshingPriority,
  THRESHING_PRIORITY_PRESETS,
  threshingPriorityLabel,
} from '../../farming/threshingPriority.ts';
import { cropLabel } from '../../farming/farmFieldMath.ts';
import {
  type SeedGrainSourceCoveragePlan,
} from '../../economy/marketplaceSeedCoverage.ts';
import { computeCattleFieldSupport } from '../../farming/cattleFieldSupport.ts';
import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import { assignStableOxen } from '../../settlement/stableOxen.ts';
import { settlementHasStaffedChapel } from '../../logistics/landmarkAccess.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import {
  vineyardProductionMultiplier,
  vineyardSiteFactors,
} from '../../vineyards/vineyardSuitability.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';
import { buildingStorageCaps } from '../resourceTotals.ts';
import { GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS } from '../../security/frontierSecurity.ts';
import { processorOutputCommodityForBuilding } from '../../economy/processorOutputPolicy.ts';
import { civicReceiptCollectionPlan } from '../../economy/civicReceipts.ts';
import {
  normalizeWeaverInputPolicy,
  SPINNING_RETTING_INPUT_POLICY_PRESETS,
  WEAVER_INPUT_POLICY_AUTO,
  WEAVER_INPUT_POLICY_FLAX_FIRST,
  WEAVER_INPUT_POLICY_PRESETS,
  weaverFibreDeliveryPreferenceLabel,
} from '../../economy/weaverInputPolicy.ts';
import {
  normalizePotterFiringPolicy,
  POTTER_FIRING_POLICY_PRESETS,
  potterFiringPolicyLabel,
} from '../../economy/potterFiringPolicy.ts';
import {
  BREWERY_RECIPE_AUTO,
  BREWERY_RECIPE_PRESETS,
  breweryPolicyOutput,
  normalizeBreweryRecipePolicy,
} from '../../economy/breweryRecipePolicy.ts';
import {
  normalizeSmokehouseRecipePolicy,
  SMOKEHOUSE_RECIPE_AUTO,
  SMOKEHOUSE_RECIPE_PRESETS,
  smokehouseRecipeConversion,
  smokehouseRecipeOutput,
} from '../../economy/smokehouseRecipePolicy.ts';
import {
  FREE_CONSTRUCTION_COST_TOOLTIP,
  renderResourceCost,
} from '../../ui/resourceCost.ts';
import {
  APIARY_HARVEST_POLICIES,
  apiaryHarvestPolicy,
} from '../../economy/specialtyTrade.ts';
import {
  BREAD_GRAIN_KINDS,
  FLOUR_KINDS,
  breadGrainBulkStock,
  breadGrainStock,
  breadStock,
  flourStock,
  grainSheafStock,
  type BreadGrainKind,
  type FlourKind,
} from '../../economy/cropGoods.ts';

function isBreadGrainKind(kind: DeliveryCargoKind | undefined): kind is BreadGrainKind {
  return kind != null && (BREAD_GRAIN_KINDS as readonly DeliveryCargoKind[]).includes(kind);
}

function dominantFlourKind(building: BuildingState): FlourKind {
  return FLOUR_KINDS.reduce((best, kind) =>
    (building[kind] ?? 0) > (building[best] ?? 0) ? kind : best,
  );
}

function dominantBreadGrainKind(building: BuildingState): BreadGrainKind {
  return BREAD_GRAIN_KINDS.reduce((best, kind) =>
    (building[kind] ?? 0) > (building[best] ?? 0) ? kind : best,
  );
}

const PROCESS: Record<string, string> = {
  mine: 'Rich iron, salt, or clay + timber-supported deep labor → raw material for linked local processing',
  charcoal_burner: 'Firewood + labor -> charcoal, competing directly with winter heating reserves',
  smithy: 'Small direct-process bloomery reduces local ore or reheats imported blooms and bars; the smithing bay then uses charcoal and automatically staged well water to finish tools, fittings, and weapon heads',
  potter_kiln: 'Local clay + firewood + automatically staged well water -> either vessels or rare prosperous-house roof tiles',
  threshing_barn: 'Farmstead crew works nearby drawn fields',
  watermill: 'Grain + seasonal river power + smith-dressed millstones and iron fittings → flour',
  windmill: 'Grain + upland wind + smith-dressed millstones and iron fittings → flour without river access',
  granary: 'Shelters foodstuffs, farm crops, flour, and cured provisions, then stocks Marketplace stalls, Taverns, and physical institutional routes',
  bakery: 'Flour + automatic well service + firewood + baker labor -> bread for Marketplace stalls and institutions',
  brewery: 'Barley → malt → ale, 4 apples → 1 apple cider, 4 pears → 1 pear cider, or 1 honey → 1 mead; each finished beverage remains distinct and goes to staffed Taverns',
  tavern: 'Receives ale, apple cider, pear cider, and mead, then serves any of them as the residential Beverage service',
  smokehouse: 'Meat, fish, or milk + firewood + local or imported salt -> cured meat, smoked fish, or cheese',
  apiary: 'March-August forage accumulates a whole-unit hive crop; September-November labor extracts it as physical honey for food, luxury comfort, or Mead-selected Brewhouses, with nearby orchard and vineyard pollination',
  monastery: 'A self-governing 68 × 53 m walled estate raises mixed orchard and garden crops alongside cattle, sheep, eggs, milk, meat, honey, and cheese; orchard fruit becomes house cider, apiary honey becomes mead, and player-drawn vineyards produce town-market wine',
  carpenter: 'Timber + smith-forged ironwork → polearms and cartwright support',
  weaponsmith_armorer: 'Finished timber, ironwork, leather, and linen → sidearms, shields, polearms, padded armor, or mail armor; the least-stocked military output is made first',
  bowyer_fletcher: 'Finished timber, ironwork, leather, and linen → bows, crossbows, or four-bundle ammunition batches; the least-stocked ranged output is made first',
  spinning_retting_house: 'Annual sheep fleece → yarn, or harvested flax + hauled water → linen; prepared fibre moves physically to a Weaver, Storehouse, or Trading Post',
  weaver: 'Yarn or linen + loom labor → finished clothing → tier-2+ Marketplace stalls, then Trading Post export',
  tannery: 'Livestock hides + hauled water + firewood → tanned leather for Cobbler workshops and trade; hunted pelts bypass the Tannery',
  cobbler: 'Tanned leather + cobbler labor → finished shoes → Tier 3+ Marketplace stalls, then Trading Post export',
  chandlery: '2 beeswax + 1 firewood + chandler labor → 6 candle lots for prosperous households and regional trade',
};

const OUTBOUND_SUPPLY_KINDS = new Set<BuildingKind>([
  'mine',
  'threshing_barn',
  'watermill',
  'windmill',
  'granary',
  'bakery',
  'brewery',
  'smokehouse',
  'apiary',
  'monastery',
  'carpenter',
  'tannery',
  'cobbler',
  'chandlery',
  'spinning_retting_house',
  'weaver',
  'charcoal_burner',
  'smithy',
  'weaponsmith_armorer',
  'bowyer_fletcher',
  'potter_kiln',
]);

const HOUSEHOLD_FOOD_DISTRIBUTORS = new Set<BuildingKind>(['marketplace']);

function buildingHasOutboundStock(
  building: BuildingState,
  protectedSeedGrain = 0,
): boolean {
  switch (building.kind) {
    case 'threshing_barn':
      return breadGrainStock(building) > protectedSeedGrain + 1e-6
        || (building.barley ?? 0) > 1e-6
        || (building.flax ?? 0) > 1e-6;
    case 'watermill':
    case 'windmill':
      return flourStock(building) > 0;
    case 'granary':
      return edibleFoodStock(building) > 0
        || flourStock(building) > 0
        || (building.barley ?? 0) > 0
        || (building.flax ?? 0) > 0
        || granaryExportableGrain(
          breadGrainStock(building),
          building.granaryGrainReserve ?? 0,
        ) > 1e-6;
    case 'bakery':
      return breadStock(building) > 0;
    case 'brewery':
      return (building.barley ?? 0) > 0
        || (building.malt ?? 0) > 0
        || (building.apples ?? 0) > 0
        || (building.pears ?? 0) > 0
        || (building.honey ?? 0) > 0
        || building.ale > 0
        || (building.cider ?? 0) > 0
        || (building.pearCider ?? 0) > 0
        || (building.mead ?? 0) > 0;
    case 'smokehouse':
      return preservedFoodStock(building) > 0;
    case 'apiary':
      return building.honey > 0;
    case 'monastery':
      return building.ale > 18 + 1e-6
        || building.honey > 10 + 1e-6
        || (building.cheese ?? 0) > 8 + 1e-6
        || building.wine > 6 + 1e-6;
    case 'carpenter':
      return (building.polearms ?? 0) > 0;
    case 'spinning_retting_house':
      return (building.yarn ?? 0) > 0 || (building.linen ?? 0) > 0;
    case 'weaver':
      return (building.cloth ?? 0) > 0;
    case 'charcoal_burner':
      return (building.charcoal ?? 0) > 0;
    case 'smithy':
      return (building.ironwork ?? 0) > 0;
    case 'potter_kiln':
      return (building.pottery ?? 0) > 0;
    case 'chandlery':
      return (building.candles ?? 0) > 0;
    default:
      return false;
  }
}

function outboundDestinationLabel(building: BuildingState): string {
  switch (building.kind) {
    case 'threshing_barn':
      return 'Highest-priority active processor, then lowest runway and granary reserve';
    case 'watermill':
    case 'windmill':
      return 'Active bakery working buffers first, then staffed granary storage, then emergency bakery overflow';
    case 'bakery':
      return 'Protected bread surplus to critical institutions or a staffed granary for Marketplace stalls';
    case 'granary':
      return 'Critical processor, company, and brewery buffers first · then fresh and cured Marketplace stalls';
    case 'brewery':
      return 'Staffed Tavern beverage service, then road-linked export market';
    case 'smokehouse':
      return 'Nearest staffed granary or Marketplace cured-food reserve';
    case 'apiary':
      return 'Ordinary town demand, then the road-linked export market';
    case 'monastery':
      return 'Vineyard wine to the nearest granary by monk handcart · other surplus to a regional merchant';
    case 'carpenter':
      return 'Nearest road-linked guardhouse';
    case 'spinning_retting_house':
      return 'Lowest-runway Weaver working buffer, then staffed Storehouse or Trading Post overflow';
    case 'weaver':
      return 'Staffed Storehouse for Marketplace clothing stalls, then road-linked export market';
    case 'charcoal_burner':
      return 'Settlement-wide match: highest-priority road-linked smithy, then shortest producer route';
    case 'smithy':
      return 'Settlement-wide match: highest-priority maintained worksite, then shortest forge route and overflow';
    case 'potter_kiln':
      return 'Settlement-wide match: staffed Storehouse market supply, highest-priority smokehouse, then export';
    case 'chandlery':
      return 'Staffed Storehouse first, then the road-linked Trading Post';
    default:
      return 'Awaiting destination';
  }
}

function cargoPerTripLabel(building: BuildingState): string | null {
  switch (building.kind) {
    case 'threshing_barn':
    case 'watermill':
    case 'windmill':
    case 'brewery':
    case 'bakery':
    case 'apiary':
      return `${GRAIN_TRANSFER_PER_TRIP} per haul`;
    case 'granary':
      return `4 fresh or 3 cured per market-stall haul · ${GRAIN_TRANSFER_PER_TRIP} per bulk haul`;
    case 'smokehouse':
      return `3 per cured-food haul · ${GRAIN_TRANSFER_PER_TRIP} per granary haul`;
    case 'spinning_retting_house':
      return `${TEXTILE_TRANSFER_PER_TRIP} yarn or linen per handcart`;
    case 'weaver':
      return `${TEXTILE_TRANSFER_PER_TRIP} clothing per Storehouse or market haul`;
    case 'chandlery':
      return `${CANDLE_TRANSFER_PER_TRIP} candle lots per Storehouse or market haul`;
    case 'charcoal_burner':
    case 'smithy':
    case 'potter_kiln':
      return `${GRAIN_TRANSFER_PER_TRIP} per handcart`;
    case 'monastery':
      return 'Up to 6 wine per monk handcart or 6 goods per estate export';
    default:
      return null;
  }
}

function outboundTargetKinds(kind: BuildingKind): BuildingKind[] {
  switch (kind) {
    case 'threshing_barn':
      return ['pastoral_farmstead', 'watermill', 'windmill', 'brewery', 'granary', 'monastery', 'spinning_retting_house'];
    case 'watermill':
    case 'windmill':
      return ['bakery', 'granary'];
    case 'granary':
      return ['bakery', 'brewery', 'spinning_retting_house', 'smokehouse'];
    case 'apiary':
      return ['marketplace'];
    case 'carpenter':
      return ['guardhouse'];
    case 'spinning_retting_house':
      return ['weaver', 'village_storehouse', 'trading_post'];
    case 'weaver':
      return ['marketplace'];
    case 'charcoal_burner':
      return ['smithy'];
    case 'smithy':
      return [
        'lumber_mill',
        'woodcutters_lodge',
        'stone_quarry',
        'large_quarry',
        'threshing_barn',
        'watermill',
        'windmill',
        'carpenter',
      ];
    case 'potter_kiln':
      return ['smokehouse', 'marketplace'];
    default:
      return [];
  }
}

function outboundTripTarget(
  building: BuildingState,
  context: InspectorRenderContext,
  seedPlan: SeedGrainSourceCoveragePlan | null = null,
): { id?: string; x: number; z: number } | null {
  if (building.kind === 'threshing_barn') {
    return context.worldQueries.getNextFarmFlaxDispatch(building)?.target
      ?? context.worldQueries.getNextFarmGrainDispatch(building)?.target
      ?? context.worldQueries.getNextFarmBarleyDispatch(building)?.target
      ?? null;
  }
  if (building.kind === 'watermill' || building.kind === 'windmill') {
    return context.worldQueries.getNextDirectProcessorInputDispatch(
      building,
      dominantFlourKind(building),
    )?.target ?? null;
  }
  if (building.kind === 'brewery') {
    const home = context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(building, 'ale');
    if (home) return home;
    return context.worldQueries.findNearestRoadLinkedBuilding(building, ['marketplace']);
  }
  if (building.kind === 'apiary') {
    return context.worldQueries.getNextFoodDeliveryTargetForSupplier(building)
      ?? context.worldQueries.findNearestRoadLinkedBuilding(building, ['marketplace']);
  }
  if (building.kind === 'monastery' && building.wine > 6 + 1e-6) {
    return context.worldQueries.findNearestRoadLinkedBuilding(building, ['granary']);
  }
  if (building.kind === 'spinning_retting_house') {
    const selected = processorOutputCommodityForBuilding(building) === 'linen'
      ? 'linen'
      : 'yarn';
    const alternate = selected === 'yarn' ? 'linen' : 'yarn';
    return context.worldQueries.getNextDirectProcessorInputDispatch(
      building,
      selected,
    )?.target ?? context.worldQueries.getNextDirectProcessorInputDispatch(
      building,
      alternate,
    )?.target ?? null;
  }
  if (building.kind === 'weaver') {
    return context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(building, 'cloth')
      ?? context.worldQueries.findNearestRoadLinkedBuilding(building, ['marketplace']);
  }
  if (building.kind === 'smithy') {
    return context.worldQueries.getNextDirectProcessorInputDispatch(
      building,
      'ironwork',
    )?.target ?? null;
  }
  if (building.kind === 'charcoal_burner') {
    return context.worldQueries.getNextDirectProcessorInputDispatch(
      building,
      'charcoal',
    )?.target ?? null;
  }
  if (building.kind === 'potter_kiln') {
    const householdTarget = context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(
      building,
      'pottery',
    );
    const materialTarget = context.worldQueries.getNextDirectProcessorInputDispatch(
      building,
      'pottery',
    )?.target ?? null;
    return householdTarget ?? materialTarget;
  }
  if (building.kind === 'granary') {
    if (
      seedPlan?.nextDispatchBuildingId != null
      && seedPlan.nextDispatchAmount > 0.05
    ) {
      const seedTarget = context.gameState.buildings.get(
        seedPlan.nextDispatchBuildingId,
      );
      if (seedTarget) return seedTarget;
    }
    const grainDispatch = context.worldQueries.getNextGranaryGrainDispatch(building);
    const guardFoodDispatch = context.conflictEnabled
      ? context.worldQueries.getNextGranaryGuardFoodDispatch(building)
      : null;
    const grainIsCritical = grainDispatch != null
      && grainDispatch.runwayCycles < GRAIN_CRITICAL_RUNWAY_CYCLES;
    const guardFoodPreemptsGrain = guardFoodDispatch != null
      && (
        !grainIsCritical
        || grainDispatch != null && (() => {
          const guardUrgency = guardFoodDispatch.runwayDays
            / GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS;
          const grainUrgency = grainDispatch.runwayCycles
            / GRAIN_CRITICAL_RUNWAY_CYCLES;
          return guardUrgency < grainUrgency - 1e-9
            || (
              Math.abs(guardUrgency - grainUrgency) <= 1e-9
              && compareStableEntityIds(
                guardFoodDispatch.target.id,
                grainDispatch.target.id,
              ) < 0
            );
        })()
      );
    if (guardFoodPreemptsGrain) {
      return guardFoodDispatch.target;
    }
    if (grainIsCritical) {
      return grainDispatch.target;
    }
    const barleyTarget = context.worldQueries.getNextDirectProcessorInputDispatch(
      building,
      'barley',
    )?.target ?? null;
    if (barleyTarget) return barleyTarget;
    const householdFoodTarget = edibleFoodStock(building) > 1e-6
      ? context.worldQueries.getNextFoodDeliveryTargetForSupplier(building)
      : null;
    const preservationTarget = preservableFoodStock(building) > 1e-6
      ? context.worldQueries.getNextDirectProcessorInputDispatch(
        building,
        'food',
      )?.target ?? null
      : null;
    const curedHouseholdTarget = preservedFoodStock(building) > 1e-6
      ? context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(
        building,
        'preservedFood',
      )
      : null;
    const householdTarget = householdFoodTarget ?? curedHouseholdTarget;
    const foodTarget = householdTarget ?? preservationTarget;
    if (foodTarget) return foodTarget;
    return grainDispatch?.target ?? null;
  }

  const buildingTarget = context.worldQueries.findNearestRoadLinkedBuilding(
    building,
    outboundTargetKinds(building.kind),
  );
  if (buildingTarget) return buildingTarget;

  switch (building.kind) {
    case 'monastery':
      return null;
    case 'smokehouse':
      return context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(
        building,
        'preservedFood',
      ) ?? context.worldQueries.getNextDirectProcessorInputDispatch(
        building,
        'preservedFood',
      )?.target ?? null;
    default:
      return null;
  }
}

function plannedOutboundTripSeconds(
  building: BuildingState,
  context: InspectorRenderContext,
  seedPlan: SeedGrainSourceCoveragePlan | null = null,
): number {
  const network = context.worldQueries.getRoadNetworkSnapshot();
  const target = outboundTripTarget(building, context, seedPlan);
  const granaryIsSendingBuildingSupply = building.kind === 'granary'
    && target?.id != null
    && context.gameState.buildings.has(target.id);
  const weaverIsSendingHouseholdSupply = building.kind === 'weaver'
    && target?.id != null
    && context.gameState.residences.has(target.id);
  const potterIsSendingHouseholdSupply = building.kind === 'potter_kiln'
    && target?.id != null
    && context.gameState.residences.has(target.id);
  const speed = building.kind === 'monastery' || (building.kind === 'granary' && !granaryIsSendingBuildingSupply) || building.kind === 'brewery' || building.kind === 'smokehouse' || weaverIsSendingHouseholdSupply || potterIsSendingHouseholdSupply
    ? FOOD_DELIVERY_SPEED_MPS
    : TIMBER_DELIVERY_SPEED_MPS;
  const unload = building.kind === 'monastery' || (building.kind === 'granary' && !granaryIsSendingBuildingSupply) || building.kind === 'brewery' || building.kind === 'smokehouse' || weaverIsSendingHouseholdSupply || potterIsSendingHouseholdSupply
    ? FOOD_DELIVERY_UNLOAD_SEC
    : TIMBER_DELIVERY_UNLOAD_SEC;
  return roadDeliveryTripSeconds(
    network,
    building,
    target,
    speed,
    1,
    unload,
    context.worldQueries.getDeliveryTravelSpeedMultiplier(building),
  );
}

function renderLogisticsRows(
  building: BuildingState,
  context: InspectorRenderContext,
  seedPlan: SeedGrainSourceCoveragePlan | null = null,
): string {
  if (!OUTBOUND_SUPPLY_KINDS.has(building.kind)) return '';

  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const inboundTrip = context.worldQueries.getInboundSupplyTrip(building);
  const protectedSeedGrain = building.kind === 'threshing_barn'
    ? farmsteadSeedGrainRequired(
        [...context.gameState.farmFields.values()]
          .filter((field) => field.farmsteadId === building.id),
      )
    : 0;
  const tripRemaining = context.worldQueries.getActiveTripRemainingSeconds(building);
  const seedDispatchReady = building.kind === 'granary'
    && seedPlan?.nextDispatchAmount != null
    && seedPlan.nextDispatchAmount > 0.05;
  const activeSeedCollection = building.kind === 'granary'
    && isBreadGrainKind(activeTrip?.cargoKind)
    && activeTrip.targetBuildingId != null
    && context.gameState.buildings.get(activeTrip.targetBuildingId)?.kind === 'threshing_barn';
  const seedHaulUsesHoldingCrew = seedDispatchReady || activeSeedCollection;
  const flourCommodity = building.kind === 'watermill' || building.kind === 'windmill'
    ? dominantFlourKind(building)
    : null;
  const flourDispatch = flourCommodity
    ? context.worldQueries.getNextDirectProcessorInputDispatch(building, flourCommodity)
    : null;
  const ironworkDispatch = building.kind === 'smithy'
    ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'ironwork')
    : null;
  const textileCommodity = building.kind === 'spinning_retting_house'
    ? (building.linen ?? 0) > (building.yarn ?? 0)
      ? 'linen' as const
      : 'yarn' as const
    : null;
  const textileDispatch = textileCommodity
    ? context.worldQueries.getNextDirectProcessorInputDispatch(
        building,
        textileCommodity,
      )
    : null;
  const materialDispatch = building.kind === 'charcoal_burner'
      ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'charcoal')
      : building.kind === 'potter_kiln'
        ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'pottery')
        : null;
  const potteryHouseholdTarget = building.kind === 'potter_kiln'
    ? context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(building, 'pottery')
    : null;
  const materialCommodity = building.kind === 'charcoal_burner'
      ? 'charcoal'
      : building.kind === 'potter_kiln'
        ? 'pottery'
        : null;
  const potteryMaterialDestination = materialDispatch && materialCommodity === 'pottery'
    ? materialDispatch.duty === 'working-buffer'
      ? `${context.worldQueries.getBuildingLabel(materialDispatch.target.kind)} · ${Math.round(materialDispatch.target.pottery ?? 0)} / ${Math.ceil(materialDispatch.desiredStock)} pottery · ${materialDispatch.runwayCycles.toFixed(1)} cycles`
      : `${context.worldQueries.getBuildingLabel(materialDispatch.target.kind)} · local pottery duties covered · nearest export route`
    : null;
  const potteryHouseholdDestination = potteryHouseholdTarget
    ? `Parcel #${potteryHouseholdTarget.parcelIndex + 1} · lowest household pottery runway`
    : null;
  const potteryDestination = building.kind === 'potter_kiln'
    ? potteryHouseholdDestination ?? potteryMaterialDestination
    : null;
  const flaxDispatch = building.kind === 'threshing_barn'
    ? context.worldQueries.getNextFarmFlaxDispatch(building)
    : null;
  const destination = seedHaulUsesHoldingCrew
    ? 'Least-covered active farmstead, then shorter road'
    : flaxDispatch
      ? flaxDispatch.duty === 'working-buffer'
        ? `${context.worldQueries.getBuildingLabel(flaxDispatch.target.kind)} · ${weaverFibreDeliveryPreferenceLabel(flaxDispatch.target.weaverInputPolicy, 'flax')} · ${Math.round(flaxDispatch.target.flax ?? 0)} / ${Math.ceil(flaxDispatch.desiredStock)} flax`
        : `${context.worldQueries.getBuildingLabel(flaxDispatch.target.kind)} · active fibre-workshop buffers covered · nearest overflow route`
      : flourDispatch
      ? flourDispatch.duty === 'working-buffer'
        ? `${context.worldQueries.getBuildingLabel(flourDispatch.target.kind)} · ${Math.round(Math.max(0, flourCommodity ? flourDispatch.target[flourCommodity] ?? 0 : 0))} / ${Math.ceil(flourDispatch.desiredStock)} ${flourCommodity?.replace(/([A-Z])/g, ' $1').toLowerCase()} · ${flourDispatch.runwayCycles.toFixed(1)} cycles`
        : flourDispatch.duty === 'central-storage'
          ? `${context.worldQueries.getBuildingLabel(flourDispatch.target.kind)} · central flour reserve after active bakery buffers · shortest road`
          : `${context.worldQueries.getBuildingLabel(flourDispatch.target.kind)} · emergency overflow because no granary can receive flour · shortest road`
      : ironworkDispatch
        ? ironworkDispatch.duty === 'working-buffer'
          ? `${context.worldQueries.getBuildingLabel(ironworkDispatch.target.kind)} · ${Math.round(ironworkDispatch.target.ironwork ?? 0)} / ${Math.ceil(ironworkDispatch.desiredStock)} ironwork · ${ironworkDispatch.runwayCycles.toFixed(1)} cycles`
          : `${context.worldQueries.getBuildingLabel(ironworkDispatch.target.kind)} · maintained buffers covered · nearest overflow route`
      : textileDispatch && textileCommodity
        ? textileDispatch.duty === 'working-buffer'
          ? `${context.worldQueries.getBuildingLabel(textileDispatch.target.kind)} · ${weaverFibreDeliveryPreferenceLabel(textileDispatch.target.weaverInputPolicy, textileCommodity)} · ${Math.round(textileDispatch.target[textileCommodity] ?? 0)} / ${Math.ceil(textileDispatch.desiredStock)} ${textileCommodity} · ${textileDispatch.runwayCycles.toFixed(1)} cycles`
          : `${context.worldQueries.getBuildingLabel(textileDispatch.target.kind)} · active Weaver buffers covered · nearest textile overflow route`
      : potteryDestination
        ? potteryDestination
      : materialDispatch && materialCommodity
        ? materialDispatch.duty === 'working-buffer'
          ? `${context.worldQueries.getBuildingLabel(materialDispatch.target.kind)} · ${Math.round(materialDispatch.target[materialCommodity] ?? 0)} / ${Math.ceil(materialDispatch.desiredStock)} ${materialCommodity} · ${materialDispatch.runwayCycles.toFixed(1)} cycles`
          : `${context.worldQueries.getBuildingLabel(materialDispatch.target.kind)} · active material buffers covered · nearest overflow route`
      : outboundDestinationLabel(building);
  const nearestTarget = outboundTripTarget(building, context, seedPlan);
  const pathDistance = nearestTarget
    ? context.worldQueries.getRoadPathDistance(building.x, building.z, nearestTarget.x, nearestTarget.z)
    : null;
  const deliveryContext: DeliveryStatusContext = {
    getRoadPathDistance: (ax: number, az: number, bx: number, bz: number) =>
      context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
    getResidence: (id: string) => context.worldQueries.getResidence(id),
    getBuilding: (id: string) => context.worldQueries.getBuilding(id),
    getBuildingLabel: (kind: BuildingKind) => context.worldQueries.getBuildingLabel(kind),
    getActiveTripPathDistance: (trip: DeliveryTripState) => context.worldQueries.getActiveTripPathDistance(trip),
  };
  const foodTerritoryRows = HOUSEHOLD_FOOD_DISTRIBUTORS.has(building.kind)
    ? (() => {
        const claimed = context.worldQueries.getClaimedResidencesForFoodSupplier(building);
        const next = context.worldQueries.getNextFoodDeliveryTargetForSupplier(building);
        const availableFood = edibleFoodStock(building);
        return `<li><span>Food territory</span><span>${availableFood <= 1e-6 ? 'Yielding while empty' : claimed.length === 0 ? 'None on branch' : `${claimed.length} households claimed`}</span></li>
          <li><span>Next household</span><span>${next ? `Parcel #${next.parcelIndex + 1}` : 'None needing food'}</span></li>`;
      })()
    : '';
  const preservedFoodTerritoryRows =
    building.kind === 'smokehouse' || building.kind === 'granary'
      ? `<li><span>Cured-food territory</span><span>Connected homes are served from stocked Marketplace food stalls</span></li>
         <li><span>Physical cured route</span><span>${building.kind === 'smokehouse' ? 'Smokehouse → staffed Granary → Marketplace stall' : 'Granary → Marketplace stall'} · no routine home cart</span></li>`
      : '';
  const textileTerritoryRows = building.kind === 'spinning_retting_house'
    ? `<li><span>Prepared-fibre route</span><span>Wool becomes yarn; flax + water becomes linen. Both are hauled as physical intermediate goods.</span></li>
       <li><span>Next textile stage</span><span>Spinning & Retting House → Weaver working buffer → clothing; staffed Storehouse or Trading Post receives overflow</span></li>`
    : building.kind === 'weaver'
    ? `<li><span>Clothing territory</span><span>Connected tier-2+ homes draw clothing from stocked Marketplace goods stalls</span></li>
       <li><span>Physical clothing route</span><span>Weaver → staffed Storehouse → Marketplace stall · no routine home cart</span></li>`
    : '';
  const potteryTerritoryRows = building.kind === 'potter_kiln'
    ? `<li><span>Kiln firing</span><span>${potterFiringPolicyLabel(building.potterFiringPolicy)}</span></li>
       <li><span>Household-ware territory</span><span>Connected tier-4 homes draw pottery from stocked Marketplace goods stalls</span></li>
       <li><span>Physical pottery route</span><span>Kiln → staffed Storehouse → Marketplace stall · no routine home cart</span></li>`
    : '';
  const householdTerritoryRows =
    foodTerritoryRows
    + preservedFoodTerritoryRows
    + textileTerritoryRows
    + potteryTerritoryRows;

  if (activeTrip) {
    const tripPath = context.worldQueries.getActiveTripPathDistance(activeTrip);
    return householdTerritoryRows + renderOutboundDeliveryRows(
      activeTrip,
      tripRemaining,
      destination,
      tripPath,
      plannedOutboundTripSeconds(building, context, seedPlan),
      cargoPerTripLabel(building),
      deliveryContext,
    );
  }

  const logisticsWorkplace = building.kind === 'granary'
    ? building
    : nearestTarget?.id != null
      ? context.gameState.buildings.get(nearestTarget.id) ?? null
      : null;
  const logisticsLaborAvailable = logisticsWorkplace?.kind === 'granary'
    ? logisticsWorkplace.assignedLabor > 0
    : logisticsWorkplace?.kind === 'village_storehouse'
      || logisticsWorkplace?.kind === 'marketplace'
      ? logisticsWorkplace.assignedLabor > 0
      : context.populationStats.idle > 0;
  if (!logisticsLaborAvailable) {
    const laborMessage = logisticsWorkplace?.kind === 'granary'
      ? 'Waiting for an assigned granary hauler'
      : logisticsWorkplace?.kind === 'village_storehouse'
        || logisticsWorkplace?.kind === 'marketplace'
        ? `Waiting for a worker at the ${context.worldQueries.getBuildingLabel(logisticsWorkplace.kind)}`
        : 'Waiting for an unassigned hauler';
    return `${householdTerritoryRows}<li><span>Deliveries</span><span>${laborMessage}</span></li>`;
  }

  const inboundRow = renderInboundSupplyRow(inboundTrip, deliveryContext);
  if (inboundRow) return householdTerritoryRows + inboundRow;

  if (
    seedDispatchReady
    || buildingHasOutboundStock(
      building,
      protectedSeedGrain,
    )
  ) {
    return householdTerritoryRows + renderOutboundDeliveryRows(
      null,
      null,
      destination,
      pathDistance,
      plannedOutboundTripSeconds(building, context, seedPlan),
      cargoPerTripLabel(building),
      deliveryContext,
    );
  }

  return `${householdTerritoryRows}<li><span>Deliveries</span><span>Ready — awaiting cargo or destination</span></li>`;
}

function renderCivicReceiptRows(
  building: BuildingState,
  context: InspectorRenderContext,
  dispatchThreshold: number,
  labels: { held: string; collection: string } = {
    held: 'Civic visitor gifts',
    collection: 'Civic collection',
  },
): string {
  const plan = civicReceiptCollectionPlan({
    source: building,
    buildings: context.gameState.buildings.values(),
    trips: context.gameState.deliveryTrips.values(),
    physicalEconomy: context.gameState.physicalFoundingSiteEnabled === true,
    dispatchThreshold,
    getRoadPathDistance: (ax, az, bx, bz) =>
      context.worldQueries.getRoadPathDistance(ax, az, bx, bz),
  });
  const targetLabel = plan.target
    ? context.worldQueries.getBuildingLabel(plan.target.kind)
    : 'civic lockbox';
  const route = plan.routeDistance == null
    ? ''
    : ` · ${plan.routeDistance.toFixed(0)} m by road`;
  const inspect = plan.activeTrip
    ? ` <button type="button" class="inspector-jump-button" data-inspect-delivery-trip="${plan.activeTrip.id}" aria-label="Inspect civic receipt cart">Inspect cart</button>`
    : '';
  const collection = (() => {
    switch (plan.status) {
      case 'legacy':
        return 'Legacy settlement · income credits the treasury immediately';
      case 'en-route':
        return `${Math.round(plan.inTransitGold)} gold en route to ${targetLabel}${route}${inspect}`;
      case 'no-treasury':
        return `${Math.round(plan.heldGold)} gold held · complete a Town Hall or retain the founding lockbox`;
      case 'no-road':
        return `${Math.round(plan.heldGold)} gold ready · connect this source to ${targetLabel} by road`;
      case 'ready':
        return `${Math.round(plan.heldGold)} gold ready for one handcart to ${targetLabel}${route} · needs a free villager`;
      case 'accumulating':
        return `${Math.round(plan.heldGold)} / ${Math.ceil(plan.dispatchThreshold)} gold toward the next daily collection batch`;
    }
  })();
  return `<li><span>${labels.held}</span><span>${Math.round(plan.heldGold)} gold secured at this source${plan.inTransitGold > 0.05 ? ` · ${Math.round(plan.inTransitGold)} already moving` : ''}</span></li>
      <li><span>${labels.collection}</span><span>${collection}</span></li>`;
}

export function renderExpandedBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const tavernServiceResidenceIds = building.kind === 'tavern'
    ? context.worldQueries
        .getClaimedResidencesForSpecialtySupplier(building, 'ale')
        .filter((residence) => (
          residence.tier >= 2
          && residence.population > 0
          && !residence.abandoned
        ))
        .map((residence) => residence.id)
    : null;
  const definition = getBuildingDefinition(building.kind);
  const processorStatus = getBuildingProcessorStatus(building, context.worldQueries, {
    matureTrees: target.matureTrees,
    month: gameClock(context.gameState.tick).month,
  });
  const armory = building.kind === 'carpenter' && context.conflictEnabled
    ? carpenterArmoryPlan(building)
    : null;
  const carpenterServiceTrips = building.kind === 'carpenter'
    ? carpenterCartServiceTripsAvailable(building)
    : 0;
  const carpenterServiceTargetTrips = building.kind === 'carpenter'
    ? normalizeCarpenterCartServiceTargetTrips(
        building.carpenterCartServiceTargetTrips,
      )
    : 0;
  const carpenterServiceTimberTarget = carpenterCartServiceTimberTarget(
    building.carpenterCartServiceTargetTrips,
  );
  const carpenterServiceIronworkTarget = carpenterCartServiceIronworkTarget(
    building.carpenterCartServiceTargetTrips,
  );
  const carpenterStatus = building.kind === 'carpenter'
    ? building.assignedLabor <= 0
      ? {
          statusText: context.conflictEnabled
            ? 'Idle — assign craftspeople for cartwright work and polearms'
            : 'Idle — assign craftspeople for construction and cart support',
          statusState: 'idle' as const,
        }
      : carpenterServiceTargetTrips <= 0
        ? {
            statusText: 'Construction support active — accelerated cart service disabled by policy',
            statusState: 'active' as const,
          }
      : carpenterServiceTrips <= 0
        ? {
            statusText: `Construction support active — cart service awaits ${
              building.timber + 1e-6 < CARPENTER_CART_SERVICE_TIMBER_PER_TRIP
                ? 'prepared timber'
                : 'smith-forged ironwork'
            }`,
            statusState: 'warning' as const,
          }
      : armory?.reserve === 0
        ? {
            statusText: `Cart service ready (${carpenterServiceTrips} departures) — polearm production paused by policy`,
            statusState: 'active' as const,
          }
      : armory && armory.shortfall > 0
        && building.timber + 1e-6
          < carpenterServiceTimberTarget + CARPENTER_TIMBER_PER_POLEARM
        ? { statusText: `Cart service ready — polearms need ${CARPENTER_TIMBER_PER_POLEARM} surplus timber beyond the repair buffer`, statusState: 'warning' as const }
      : armory && armory.shortfall > 0
        && (building.ironwork ?? 0) + 1e-6
          < carpenterServiceIronworkTarget + CARPENTER_IRONWORK_PER_POLEARM
        ? { statusText: 'Cart service ready — polearms await smith-forged ironwork beyond the repair buffer', statusState: 'warning' as const }
          : armory && armory.shortfall <= 0
            ? {
                statusText: `Cart service ready (${carpenterServiceTrips} departures) — armory reserve ${armory.stock.toFixed(0)}/${armory.reserve}`,
                statusState: 'active' as const,
              }
          : {
              statusText: `Cart service ready — ${carpenterServiceTrips} accelerated departures stocked`,
              statusState: 'active' as const,
            }
    : null;
  const fallbackActive = definition.acceptsLabor ? building.assignedLabor > 0 : true;
  const logisticsRows = building.kind === 'granary'
    ? ''
    : renderLogisticsRows(building, context);
  const clock = gameClock(context.gameState.tick);
  const environment = environmentFor(
    context.gameState.seed,
    context.worldHydrology,
    clock,
    context.severeWeatherEnabled ?? false,
  );
  const windSiteThroughput = windSiteThroughputMultiplier(
    context.gameState.seed,
    building.x,
    building.z,
  );
  const windWeatherThroughput = windWeatherThroughputMultiplier(environment.weather);
  const windmillThroughput = windSiteThroughput * windWeatherThroughput;
  const charcoalClampWeatherLabel = environment.weather === 'frost'
    ? 'snowbound tending and frozen billets'
    : environment.weather === 'drought'
      ? 'dry billets'
      : environment.weather === 'rain'
        ? 'damp billets'
        : 'seasoned billets';
  const charcoalClampRows = building.kind === 'charcoal_burner'
    ? `<li><span>Clamp conditions</span><span>${Math.round(environment.charcoalBurnerThroughputMultiplier * 100)}% burn pace · ${charcoalClampWeatherLabel}</span></li>
      <li><span>Dispatch logic</span><span>Active smithies refill from below 3 to 6 cycles first · an empty staffed depot pulls a capped transit batch only for uncovered linked household fuel demand · otherwise output remains here and the clamp stops at its selected ceiling</span></li>
      <li><span>Seasonal tradeoff</span><span>Drought carbonizes faster but carries the yard's highest fire danger · spring rain and winter frost favor advance charcoal reserves</span></li>`
    : '';
  const seasonalProcessorStatus = building.kind === 'watermill'
    && environment.weather === 'frost'
    ? {
        statusText: 'Frozen mill race · shut down until spring',
        statusState: 'idle' as const,
      }
    : building.kind === 'watermill'
    && processorStatus?.statusState === 'active'
    && Math.abs(environment.watermillThroughputMultiplier - 1) > 1e-6
    ? {
        statusText: environment.watermillThroughputMultiplier > 1
          ? `Strong spring flow · ${Math.round(environment.watermillThroughputMultiplier * 100)}% river power before millstone condition`
          : `Low stream flow · ${Math.round(environment.watermillThroughputMultiplier * 100)}% river power before millstone condition`,
        statusState: environment.watermillThroughputMultiplier > 1
          ? 'active' as const
          : 'warning' as const,
      }
    : building.kind === 'windmill'
      && processorStatus?.statusState === 'active'
      ? {
          statusText: `${Math.round(windmillThroughput * 100)}% wind power · ${Math.round(windSiteThroughput * 100)}% site exposure × ${Math.round(windWeatherThroughput * 100)}% ${environment.weather} wind`,
          statusState: windmillThroughput < 0.8
            ? 'warning' as const
            : 'active' as const,
        }
    : building.kind === 'charcoal_burner'
        && processorStatus?.statusState === 'active'
        && Math.abs(environment.charcoalBurnerThroughputMultiplier - 1) > 1e-6
        ? {
            statusText: environment.charcoalBurnerThroughputMultiplier > 1
              ? `Dry charcoal charge · ${Math.round(environment.charcoalBurnerThroughputMultiplier * 100)}% burn pace · elevated drought fire danger`
              : `${environment.weather === 'frost' ? 'Snowbound clamp' : 'Damp charcoal charge'} · ${Math.round(environment.charcoalBurnerThroughputMultiplier * 100)}% burn pace · draw down stored charcoal`,
            statusState: environment.charcoalBurnerThroughputMultiplier > 1
              ? 'active' as const
              : 'warning' as const,
          }
        : null;
  const monasteryPolicy = context.getMonasteryPolicy?.() ?? DEFAULT_MONASTERY_POLICY;
  const hospitality = building.kind === 'monastery' && building.assignedLabor > 0
    ? monasteryHospitalityPlan(building, monasteryPolicy.feastsEnabled)
    : null;
  const feastReadiness = building.kind === 'monastery' && building.assignedLabor > 0
    ? monasteryFeastReadiness(building)
    : null;
  const nextFeast = building.kind === 'monastery' && building.assignedLabor > 0
    ? nextMonasteryFeast(clock)
    : null;
  const monasteryCandleStock = building.kind === 'monastery'
    ? Math.max(0, building.candles ?? 0)
    : 0;
  const monasteryCandleLiturgy = devotionalCandlesSupplied(monasteryCandleStock);
  const monasteryInboundCandles = building.kind === 'monastery'
    ? Array.from(context.gameState.deliveryTrips.values())
        .filter(
          (trip) =>
            trip.targetBuildingId === building.id
            && trip.cargoKind === 'candles'
            && trip.phase !== 'inbound',
        )
        .reduce((sum, trip) => sum + trip.amount, 0)
    : 0;
  const monasteryDevotionalRows = building.kind === 'monastery'
    ? `<li><span>Devotional candles</span><span>${Math.round(monasteryCandleStock)} / ${MONASTERY_CANDLE_CAPACITY}${monasteryInboundCandles > 0 ? ` · ${Math.round(monasteryInboundCandles)} incoming` : ''}</span></li>
      <li><span>Local candle contract</span><span>${devotionalCandleContractLabel('monastery')} · Trading Post stock only</span></li>
      <li><span>Liturgical offices</span><span>${building.assignedLabor <= 0 ? 'Dormant · assign monks' : monasteryCandleLiturgy ? `Supplied · burns one lot every ${MONASTERY_CANDLE_USE_INTERVAL_DAYS} days · ×${MONASTERY_LITURGY_PRESTIGE_MULTIPLIER.toFixed(2)} liturgical gift prestige` : 'Unlit · baseline pilgrimage prestige'}</span></li>`
    : '';
  const monasteryHospitalityRows = hospitality
    ? `<li><span>Hospitality</span><span>${monasteryHospitalityStatusLabel(hospitality)}</span></li>
      <li><span>Honey runway</span><span>${formatHospitalityRunway(hospitality.honeyRunwayDays)} daily surplus · ${MONASTERY_FEAST_HONEY} feast honey protected</span></li>
      <li><span>Estate drink</span><span>${hospitality.drinkMix} · ${formatHospitalityRunway(hospitality.drinkRunwayDays)} surplus runway · orchard cider and brewhouse mead sustain the common table, while vintner-made wine raises gift prestige</span></li>
      <li><span>Cellar character</span><span>${hospitality.mixedCellar ? 'Lavish mixed cellar' : 'Single estate drink'} · table ×${hospitality.commonTableMultiplier.toFixed(2)} · gift prestige ×${hospitality.prestigeMultiplier.toFixed(2)}</span></li>
      <li><span>Next feast</span><span>${nextFeast ? formatNextMonasteryFeast(nextFeast) : 'No observance scheduled'}</span></li>
      <li><span>Feast pantry</span><span>${feastReadiness ? formatMonasteryFeastReadiness(feastReadiness) : 'Unavailable'} · one complete batch protected from routine use</span></li>
      <li><span>Feast table</span><span>Estate meat, cheese, and milk are explicitly set out when stocked; the rest of the fixed meal comes from the general orchard, garden, egg, and pantry supply</span></li>
      <li><span>Annual hospitality cost</span><span>${hospitality.feastFoodPerYear.toFixed(0)} food · ${hospitality.feastDrinkPerYear.toFixed(0)} cider, mead, and/or wine · ${hospitality.honeyPerYear.toFixed(0)} honey</span></li>
      <li><span>Pilgrimage offerings</span><span>~${hospitality.pilgrimageGoldPerDay.toFixed(2)} gold/day before charter levy · requires church and market road link · retained income funds the house and its services</span></li>`
    : '';
  const monasteryTreasuryRows = building.kind === 'monastery'
    ? (() => {
        const extensions = building.monasteryExtensions ?? 0;
        const extensionCount = monasteryExtensionCount(extensions);
        const nextExtension = building.monasteryNextExtension ?? 0;
        const nextInvestment = monasteryEstateNextInvestmentCost(extensions, nextExtension);
        const privateGold = Math.max(0, building.gold - (building.civicReceiptsGold ?? 0));
        const serviceFunding = Math.max(0, Math.min(1, building.monasteryServiceFunding ?? 1));
        const estateMultiplier = monasteryEstateYieldMultiplier(extensions);
        const onsiteMonks = onsiteBuildingLabor(
          building,
          context.worldQueries.getActiveDeliveryTrip?.(building) ?? null,
        );
        const staffing = Math.max(
          0,
          Math.min(1, onsiteMonks / Math.max(1, definition.maxLabor)),
        );
        const infirmaryBeds = monasteryInfirmaryBeds(extensions, serviceFunding);
        const infirmaryRecovery = monasteryInfirmaryRecoveryMultiplier(extensions, serviceFunding);
        const infirmaryMortality = monasteryInfirmaryMortalityMultiplier(extensions, serviceFunding);
        const seedTarget = monasterySeedArchiveTargetPerCrop(extensions, serviceFunding);
        const scriptoriumRecovery = monasteryScriptoriumRecoveryMultiplier(extensions, serviceFunding);
        const archetype = monasteryArchetype(0, 0);
        const builtExtensions = MONASTERY_EXTENSIONS
          .filter((extension) => monasteryHasExtension(extensions, extension.value))
          .map((extension) => extension.label);
        const selectedExtension = MONASTERY_EXTENSIONS.find((extension) => extension.value === nextExtension);
        const vineyardParcels = [...(context.gameState.vineyardParcels?.values() ?? [])]
          .filter((parcel) => parcel.monasteryId === building.id);
        const incomingTithe = Array.from(context.gameState.deliveryTrips.values())
          .filter(
            (trip) =>
              trip.targetBuildingId === building.id
              && trip.cargoKind === 'gold'
              && trip.phase !== 'inbound',
          )
          .reduce((sum, trip) => sum + trip.amount, 0);
        return `${monasteryDevotionalRows}<li><span>Reserved estate</span><span>68 × 53 m inside a complete stone precinct wall · frontier belt is at least 200 m deep and scales with map size</span></li>
          <li><span>Monastery identity</span><span><strong>${archetype.name}</strong> · ${archetype.payoff}</span></li>
          <li><span>Enclosed estate</span><span>Mixed apples and pears · cabbage, carrots, and beetroot · apiary · cattle and sheep pasture · no crop-by-crop player choices</span></li>
          <li><span>Estate development</span><span>${extensionCount} / 4 extensions · ${builtExtensions.join(' · ') || 'founding house only'}</span></li>
          <li><span>Service endowment</span><span>${Math.round(serviceFunding * 100)}% funded today · retained offerings, tithes, and export income pay real daily service costs after the charter levy</span></li>
          <li><span>Monastic community</span><span>${onsiteMonks} on site / ${building.assignedLabor} assigned / ${definition.maxLabor} cells · ${Math.round(staffing * 100)}% estate output before cart absences and supply losses${building.assignedLabor <= 0 ? ' · every service dormant' : ''}</span></li>
          <li><span>Estate proceeds</span><span>Orchard, gardens, apiary, livestock, dairy, and workshop activity resolve into abstract off-map sales and returning gold · development ×${estateMultiplier.toFixed(2)}</span></li>
          <li><span>Orchard cider press</span><span>The fixed mixed orchard supplies apples and pears to a visible press and cider cellar bay · it makes one canonical house cider with no fruit-recipe choice</span></li>
          <li><span>Mead brewhouse</span><span>Monks canonically brew apiary honey into mead for their own table and hospitality · it is not monastery ale</span></li>
          <li><span>Pasture and feast table</span><span>Visible cattle and sheep canonically supply estate meat, milk, and cheese · feasts preferentially serve portions of all three when stocked, then complete the meal from the broader pantry</span></li>
          <li><span>Separate vintner</span><span>${vineyardParcels.length} player-laid vineyard parcel${vineyardParcels.length === 1 ? '' : 's'} · monks work the visible press and cellar · grapes become physical wine that may enter town stock</span></li>
          <li><span>Regional estate exports</span><span>Routine estate goods are presented as gold-in/gold-out administration · ${Math.round(monasteryPolicy.levyRate * 100)}% ${monasteryCharterLabel(monasteryPolicy.levyRate).toLowerCase()} reserved for the civic treasury · house cider and mead stay in the monastery cellar, while wine remains the deliberate physical settlement-economy exception</span></li>
          <li><span>Infirmary</span><span>${infirmaryBeds} abstract beds · patients remain simulated at home; shortest remedy runway receives care first · consumes ${MONASTERY_INFIRMARY_FOOD_PER_BED_DAY.toFixed(1)} estate food per occupied bed/day</span></li>
          <li><span>Skilled nursing</span><span>Up to ${Math.round((infirmaryRecovery - 1) * 100)}% faster illness recovery and ${Math.round((1 - infirmaryMortality) * 100)}% lower illness mortality · stacks with household remedies</span></li>
          <li><span>Agricultural archive</span><span>Rye ${Math.max(0, building.ryeGrain ?? 0).toFixed(1)} / ${seedTarget.toFixed(0)} · oats ${Math.max(0, building.oatGrain ?? 0).toFixed(1)} / ${seedTarget.toFixed(0)} · maslin ${Math.max(0, building.maslinGrain ?? 0).toFixed(1)} / ${seedTarget.toFixed(0)} emergency seed</span></li>
          <li><span>Emergency reseeding</span><span>Draws only farmstead/granary surplus · automatically sends physical seed carts to road-linked holdings that cannot cover their next sowing · the reserve can run out</span></li>
          <li><span>Scriptorium records</span><span>${Math.round((1 - scriptoriumRecovery) * 100)}% fewer timber, stone, fittings, and roof tiles for fire reconstruction within 520 m by road · requires monks and a staffed church link · does not affect ordinary construction</span></li>
          <li><span>Recorded accomplishments</span><span>${monasteryPolicy.feastsHeldTotal} feasts held · ${monasteryPolicy.seedRescueTotal.toFixed(0)} emergency seed delivered · records saved ${monasteryPolicy.scriptoriumTimberSavedTotal.toFixed(0)} timber, ${monasteryPolicy.scriptoriumStoneSavedTotal.toFixed(0)} stone, ${monasteryPolicy.scriptoriumIronworkSavedTotal.toFixed(0)} fittings, and ${monasteryPolicy.scriptoriumRoofTilesSavedTotal.toFixed(0)} roof tiles</span></li>
          <li><span>Monastery purse</span><span>${Math.round(building.gold)} gold secured here · ${privateGold.toFixed(1)} private estate gold${incomingTithe > 0.05 ? ` · ${Math.round(incomingTithe)} tithe incoming by handcart` : ''}</span></li>
          <li><span>Reserved extension</span><span>${extensionCount >= 4 ? 'Estate fully developed' : nextInvestment == null ? 'Awaiting the player’s next extension choice' : `${selectedExtension?.label ?? 'Selected work'} · ${privateGold.toFixed(1)} / ${nextInvestment + 6} gold · construction begins automatically after preserving a 6-gold working reserve`}</span></li>`;
      })()
    : '';
  const civicReceiptRows = building.kind === 'monastery'
    ? renderCivicReceiptRows(
        building,
        context,
        hospitality?.pilgrimageGoldPerDay ?? MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
        { held: 'Secular levy held', collection: 'Levy collection' },
      )
    : '';
  const preservedStorageCapacity =
    buildingStorageCaps(building.kind).preservedFood ?? 0;
  const preservedStorageFactor =
    buildingPreservedFoodStorageFactor(building.kind);
  const preservedStorageRows = preservedStorageCapacity > 0
    ? `<li><span>Cured-store aging</span><span>${preservedStorageFactor < 1
        ? `${Math.round((1 - preservedStorageFactor) * 100)}% slower than ordinary dry storage`
        : 'Ordinary dry storage'} · ${formatPreservedFoodLoss(
          preservedFoodStock(building)
          * environment.preservedFoodSpoilageFractionPerDay
          * preservedStorageFactor,
        )}</span></li>`
    : '';
  const granaryRows = building.kind === 'granary'
    ? `<li><span>Labor roles</span><span>${building.assignedLabor} assigned food keeper${building.assignedLabor === 1 ? '' : 's'} and handcart hauler${building.assignedLabor === 1 ? '' : 's'} · no baking work</span></li>
      <li><span>Automatic routing</span><span>Critical shortages, stock runway, road distance, and stable ties choose every cart destination</span></li>
      <li><span>Sheltered storage</span><span>${Math.round((1 - FRESH_FOOD_STORAGE_GRANARY_FACTOR) * 100)}% less spoilage · ${formatFreshFoodLoss(freshFoodStock(building) * environment.freshFoodSpoilageFractionPerDay * FRESH_FOOD_STORAGE_GRANARY_FACTOR)}</span></li>`
    : '';
  const processorGrainKind = dominantBreadGrainKind(building);
  const processorGrainStock = Math.max(0, building[processorGrainKind] ?? 0);
  const grainProcessorRows = building.kind === 'watermill'
    || building.kind === 'windmill'
    ? `<li><span>Grain working buffer</span><span>${formatGrainWorkingBuffer(
        processorGrainStock,
        building.kind,
        1,
        building.processorOutputTargetPercent,
      )} · ${processorGrainKind.replace(/([A-Z])/g, ' $1').toLowerCase()}</span></li>`
    : '';
  const millPowerRows = building.kind === 'watermill'
    ? `<li><span>River power</span><span>${Math.round(environment.watermillThroughputMultiplier * 100)}% throughput · ${environment.weather === 'rain'
        ? 'strong spring flow'
        : environment.weather === 'drought'
          ? 'low summer stream'
          : environment.weather === 'frost'
            ? 'frozen mill race stops the wheel'
            : 'normal flow'}</span></li>
      <li><span>Seasonal planning</span><span>Shuts down all winter · stockpile flour or build a windmill on well-exposed ground for winter milling</span></li>`
    : building.kind === 'windmill'
      ? `<li><span>Wind exposure</span><span>${Math.round(windSiteThroughput * 100)}% site power × ${Math.round(windWeatherThroughput * 100)}% ${environment.weather} wind = ${Math.round(windmillThroughput * 100)}% current throughput</span></li>
        <li><span>Site role</span><span>River-independent flour processor · use the wind overlay to find stronger ground, then connect grain and bakeries by road</span></li>`
      : '';
  const routineFreshFoodSource = building.kind === 'apiary';
  const routineFreshFoodClaims = routineFreshFoodSource
    ? context.worldQueries.getClaimedResidencesForFoodSupplier(building).length
    : 0;
  const routineFreshFoodCapacity = routineFreshFoodSource
    ? buildingStorageCaps(building.kind).honey ?? 0
    : 0;
  const routinePolicyReserve = building.kind === 'apiary'
    ? apiaryHarvestPolicy(building.apiaryHarvestPolicy).reserve
    : 0;
  const routineGenericSurplus = routineFreshFoodSource
    ? institutionalFoodSurplus(
        edibleFoodStock(building),
        routineFreshFoodClaims,
        routineFreshFoodCapacity,
      )
    : 0;
  const routineFreshFoodSurplus = routineFreshFoodSource
    ? Math.min(
        routineGenericSurplus,
        Math.max(0, edibleFoodStock(building) - routinePolicyReserve),
      )
    : 0;
  const routineFreshFoodDispatch = routineFreshFoodSource
    ? context.worldQueries.getNextInstitutionalFoodDispatch(
        building,
        context.conflictEnabled === true,
      )
    : null;
  const institutionalFoodRows = building.kind === 'smokehouse'
    ? `<li><span>Fresh-food priority</span><span>Producer-owned carts protect local Marketplace reserves, then serve a critical company before this working batch</span></li>
      <li><span>Shared arbitration</span><span>Smokehouse batch → routine company reserve → enabled granary intake · lowest runway, road length, and stable order break ties</span></li>`
    : routineFreshFoodSource
      ? `<li><span>Local food reserve</span><span>${Math.round(edibleFoodStock(building) - routineFreshFoodSurplus)} protected · ${Math.round(routineFreshFoodSurplus)} central surplus</span></li>
        <li><span>Next surplus cart</span><span>${routineFreshFoodDispatch
          ? `${institutionalFoodDutyLabel(routineFreshFoodDispatch.duty)} → ${context.worldQueries.getBuildingLabel(routineFreshFoodDispatch.target.kind)} · ${Math.round(edibleFoodStock(routineFreshFoodDispatch.target))} / ${Math.ceil(routineFreshFoodDispatch.desiredStock)} meals`
          : routineFreshFoodSurplus <= 1e-6
            ? 'None · local household reserve is protected'
            : 'No eligible institution requesting food'}</span></li>`
      : '';
  const farmsteadPlanning = building.kind === 'threshing_barn'
    ? renderFarmsteadPlanning(building, context)
    : null;
  const vineyardParcels = building.kind === 'monastery'
    ? [...(context.gameState.vineyardParcels?.values() ?? [])]
        .filter((parcel) => parcel.monasteryId === building.id)
    : [];
  const vineyardRows = building.kind === 'monastery'
    ? (() => {
        const progress = Math.max(0, building.vineyardFermentationProgress ?? 0);
        const fermenting = Math.max(0, building.vineyardFermentingGrapes ?? 0);
        const cellarProgress = fermenting > 1e-6
          ? `${Math.min(100, progress / VINEYARD_FERMENTATION_SECONDS * 100).toFixed(0)}% · ${Math.max(0, VINEYARD_FERMENTATION_SECONDS - progress).toFixed(0)} worker-seconds remain`
          : 'Idle · awaiting one complete grape batch';
        const parcelRows = vineyardParcels.length > 0 ? (() => {
          const totals = vineyardParcels.reduce((sum, parcel) => {
            const center = parcel.corners.reduce(
              (value, point) => ({ x: value.x + point.x / 4, z: value.z + point.z / 4 }),
              { x: 0, z: 0 },
            );
            const factors = vineyardSiteFactors(
              parcel.moisture,
              parcel.averageSlopeDegrees,
              parcel.southExposure,
              center.x,
              center.z,
            );
            const area = Math.max(0, parcel.area);
            return {
              area: sum.area + area,
              slope: sum.slope + parcel.averageSlopeDegrees * area,
              efficiency: sum.efficiency + parcel.shapeEfficiency * area,
              potential: sum.potential + parcel.siteSuitability * area,
              drainage: sum.drainage + factors.drainage * area,
              sun: sum.sun + factors.sun * area,
            };
          }, { area: 0, slope: 0, efficiency: 0, potential: 0, drainage: 0, sun: 0 });
          const area = Math.max(1, totals.area);
          const throughput = vineyardProductionMultiplier({
            area: totals.area,
            siteSuitability: totals.potential / area,
            shapeEfficiency: totals.efficiency / area,
          });
          return `<li><span>Growing parcels</span><span>${vineyardParcels.length} parcels · ${Math.round(totals.area)} m² · ${(totals.slope / area).toFixed(1)}° area-weighted slope · ${Math.round(totals.efficiency / area * 100)}% row efficiency</span></li>
            <li><span>Grape sites</span><span>${Math.round(totals.potential / area * 100)}% potential · ${Math.round(totals.drainage / area * 100)}% drainage · ${Math.round(totals.sun / area * 100)}% sun exposure</span></li>
            <li><span>Harvest pace</span><span>${throughput.toFixed(2)}× combined grape harvest during September–October · splitting land into more parcels does not multiply yield</span></li>`;
        })() : '<li><span>Growing parcels</span><span>None drawn · use the vineyard layout action to place rows</span></li>';
        return `${parcelRows}
          <li><span>Cellar batch</span><span>${VINEYARD_GRAPES_PER_FERMENTATION_BATCH} grapes → ${VINEYARD_WINE_PER_FERMENTATION_BATCH} wine over ${VINEYARD_FERMENTATION_SECONDS} worker-seconds</span></li>
          <li><span>Fermentation</span><span>${Math.round(fermenting)} grapes staged · ${cellarProgress}</span></li>
          <li><span>Wine route</span><span>One onsite monk handcarts genuine hospitality surplus to the nearest accepting granary · Marketplace food stalls reserve it for tier-4 luxury demand</span></li>`;
      })()
    : '';
  const apiaryRows = building.kind === 'apiary'
    ? (() => {
        const policy = apiaryHarvestPolicy(building.apiaryHarvestPolicy);
        const forage = Math.max(0, building.apiaryForageScore ?? 0.55);
        const health = Math.max(0, building.apiaryColonyHealth ?? 1);
        const accumulatedHoney = Math.max(0, Math.floor(building.apiaryAccumulatedHoney ?? 0));
        return `<li><span>Harvest policy</span><span>${policy.label} · ${policy.reserve.toFixed(0)} honey protected · ${Math.round(policy.yieldMultiplier * 100)}% seasonal yield</span></li>
          <li><span>Seasonal yield</span><span>${accumulatedHoney} honey in the hives · accumulates March-August, extracted September-November</span></li>
          <li><span>Forage landscape</span><span>${Math.round(forage * 100)}% · mature woodland, orchards, flower gardens, and vineyard rows inside bee range</span></li>
          <li><span>Colony health</span><span>${Math.round(health * 100)}% · winter check needs ${APIARY_WINTER_HONEY_REQUIRED} honey</span></li>
          <li><span>Pollination</span><span>Healthy nearby hives can raise orchard and vineyard output by up to ${Math.round(APIARY_POLLINATION_BONUS_MAX * 100)}%</span></li>`;
      })()
    : '';
  const buildingPolicyPanelHtml = building.kind === 'monastery'
    ? renderMonasteryPolicyPanel(building, context)
    : building.kind === 'threshing_barn'
      ? renderFarmsteadFieldPanel(building)
      : building.kind === 'granary'
        ? renderGranaryPolicyPanel(building)
        : building.kind === 'carpenter'
          ? renderCarpenterPolicyPanel(building, context.conflictEnabled === true)
          : building.kind === 'apiary'
            ? renderApiaryHarvestPolicyPanel(building)
            : undefined;
  const processorPolicyPanelHtml = renderProcessorOutputTargetPanel(building);
  const supplementalPanelHtml = `${buildingPolicyPanelHtml ?? ''}${processorPolicyPanelHtml ?? ''}`
    || undefined;
  const primaryActionHtml = building.kind === 'threshing_barn'
    ? renderFarmsteadPrimaryAction()
    : undefined;
  const role = building.kind === 'carpenter' && !context.conflictEnabled
    ? 'Timber framing and cartwright support for road-linked building sites'
    : PROCESS[building.kind] ?? 'Settlement service';
  const carpenterSupportRows = building.kind === 'carpenter'
    ? `<li><span>Construction timber</span><span>${Math.round((1 - CARPENTER_TIMBER_COST_MULTIPLIER) * 100)}% less at road-linked sites</span></li>
      <li><span>Cart travel</span><span>Handcarts and ox carts move ${Math.round((CARPENTER_DELIVERY_SPEED_MULTIPLIER - 1) * 100)}% faster from linked origins while a repair kit is available · oxen add carrying capacity, not another speed bonus</span></li>
      <li><span>Repair kit cost</span><span>${renderResourceCost({ timber: CARPENTER_CART_SERVICE_TIMBER_PER_TRIP, ironwork: CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP }, { compact: true, suffix: 'per accelerated departure' })}</span></li>
      <li><span>Service buffer</span><span>${Math.round(building.timber)} / ${Math.ceil(carpenterServiceTimberTarget)} protected timber · ${Math.round(building.ironwork ?? 0)} / ${Math.ceil(carpenterServiceIronworkTarget)} protected ironwork · ${carpenterServiceTrips} / ${carpenterServiceTargetTrips} departures ready</span></li>
      <li><span>Support state</span><span>${building.assignedLabor > 0 ? 'Skilled construction active across this road network' : 'Inactive — requires at least 1 craftsperson'}</span></li>
      ${armory ? `<li><span>Armory reserve</span><span>${armory.reserve <= 0 ? `${armory.stock.toFixed(0)} stored · production paused` : `${armory.stock.toFixed(0)} / ${armory.reserve} polearms`}</span></li>
      <li><span>Inputs to target</span><span>${armory.shortfall <= 0 ? 'Reserve stocked' : renderResourceCost({ timber: armory.timberToTarget, ironwork: armory.ironworkToTarget }, { compact: true })}</span></li>
      <li><span>Company issue</span><span>One polearm per assigned guard · surplus remains here</span></li>` : ''}`
    : '';
  return {
    eyebrow: 'Settlement building',
    title: definition.label,
    statusText: carpenterStatus?.statusText ?? seasonalProcessorStatus?.statusText ?? processorStatus?.statusText ?? farmsteadPlanning?.statusText ?? (fallbackActive ? 'Operating' : 'Awaiting workers'),
    statusState: carpenterStatus?.statusState ?? seasonalProcessorStatus?.statusState ?? processorStatus?.statusState ?? farmsteadPlanning?.statusState ?? (fallbackActive ? 'active' : 'warning'),
    detailsHtml: `<li><span>Role</span><span>${role}</span></li>${carpenterSupportRows}${building.kind === 'carpenter' && context.conflictEnabled ? `<li><span>Polearm batch cost</span><span>${renderResourceCost({ timber: CARPENTER_TIMBER_PER_POLEARM, ironwork: CARPENTER_IRONWORK_PER_POLEARM }, { compact: true, suffix: 'for 1 polearm' })}</span></li>` : ''}${granaryRows}${grainProcessorRows}${millPowerRows}${apiaryRows}${vineyardRows}${charcoalClampRows}${institutionalFoodRows}${monasteryHospitalityRows}${monasteryTreasuryRows}${civicReceiptRows}${farmsteadPlanning?.rows ?? ''}${processorStatus?.waterDetailHtml ?? ''}${civilianToolRows(building, context.worldQueries)}${preservedStorageRows}${buildingRoadAccessRow(context.worldQueries, building)}${buildingExtentRow(building.kind)}${logisticsRows}`,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    ...(primaryActionHtml ? { primaryActionHtml } : {}),
    ...(supplementalPanelHtml ? { supplementalPanelHtml } : {}),
    ...(tavernServiceResidenceIds
      ? {
          serviceCoverage: {
            kind: 'tavern',
            residenceIds: tavernServiceResidenceIds,
          },
        }
      : {}),
  };
}

function formatSeasonalWork(plan: SeasonalWorkPlan): string {
  if (plan.requiredWorkerDays <= 1e-6) return 'No cereal work scheduled';
  const base = `${plan.requiredWorkerDays.toFixed(1)} worker-days / ${plan.availableWorkerDays.toFixed(1)} available`;
  return plan.shortfallWorkerDays > 0.05
    ? `${base} · short ${plan.shortfallWorkerDays.toFixed(1)}`
    : `${base} · on plan`;
}

function renderFarmsteadPlanning(
  building: BuildingState,
  context: InspectorRenderContext,
): { rows: string; statusText: string; statusState: 'active' | 'warning' | 'idle' } {
  const clock = gameClock(context.gameState.tick);
  const fields = [...context.gameState.farmFields.values()]
    .filter((field) => field.farmsteadId === building.id);
  const sharedPriorityFields = [...context.gameState.farmFields.values()]
    .filter((field) => (
      field.farmsteadId !== building.id
      && fieldAcceptsFarmsteadLabor(field, building)
    ));
  const parish = context.getParishPolicy?.();
  const sabbathObserved = Boolean(
    parish?.sabbathObservanceEnabled
    && settlementHasStaffedChapel(context.gameState),
  );
  const cattleSupport = computeCattleFieldSupport(context.gameState);
  const onsiteLabor = onsiteBuildingLabor(
    building,
    context.worldQueries.getActiveDeliveryTrip(building),
  );
  const stableOxAssignments = assignStableOxen(
    context.gameState.stableOxen.values(),
    context.gameState.buildings,
    context.gameState.deliveryTrips.values(),
    fireDisabledBuildingIds(context.gameState.fireIncidents.values()),
  );
  const pairedStableOxen = [...stableOxAssignments.values()]
    .filter((assignment) => assignment.buildingId === building.id)
    .length;
  const inboundSupply = context.worldQueries.getInboundSupplyTrip(building);
  const inboundIronwork = inboundSupply?.cargoKind === 'ironwork'
    ? Math.max(0, inboundSupply.amount)
    : 0;
  const plan = buildFarmsteadWorkPlan(
    fields,
    onsiteLabor,
    clock,
    sabbathObserved,
    cattleSupport,
    Math.max(0, building.ironwork ?? 0) + inboundIronwork,
    building,
    pairedStableOxen,
  );
  const storageCaps = buildingStorageCaps(building.kind);
  const onsiteSeedGrain = breadGrainStock(building);
  const threshingBacklog = grainSheafStock(building);
  const threshingPriority = normalizeThreshingPriority(building.threshingPriority);
  const grainRoom = Math.max(0, (storageCaps.grain ?? 0) - breadGrainBulkStock(building));
  const barley = Math.max(0, building.barley ?? 0);
  const barleyRoom = Math.max(0, (storageCaps.barley ?? 0) - barley);
  const fibreRoom = Math.max(0, (storageCaps.flax ?? 0) - (building.flax ?? 0));
  const haulingRequired = plan.expectedHarvest > grainRoom + 1e-6;
  const barleyHaulingRequired =
    plan.expectedBarleyHarvest > barleyRoom + 1e-6;
  const fibreHaulingRequired = plan.expectedFibreHarvest > fibreRoom + 1e-6;
  const seasonalRisk = plan.harvest.shortfallWorkerDays > 0.05
    || plan.spring.shortfallWorkerDays > 0.05
    || plan.autumn.shortfallWorkerDays > 0.05;
  const inboundSeed = isBreadGrainKind(inboundSupply?.cargoKind)
    ? Math.max(0, inboundSupply.amount)
    : 0;
  const inboundBarleySeed = inboundSupply?.cargoKind === 'barley'
    ? Math.max(0, inboundSupply.amount)
    : 0;
  const inboundManure = inboundSupply?.cargoKind === 'manure'
    ? Math.max(0, inboundSupply.amount)
    : 0;
  const onsiteSeedShortfall = Math.max(0, plan.seedGrainRequired - onsiteSeedGrain);
  const onsiteBarleySeedShortfall = Math.max(
    0,
    plan.seedBarleyRequired - barley,
  );
  const seedShortfall = Math.max(
    0,
    plan.seedGrainRequired - onsiteSeedGrain - inboundSeed,
  );
  const barleySeedShortfall = Math.max(
    0,
    plan.seedBarleyRequired - barley - inboundBarleySeed,
  );
  const manureCovered = Math.min(
    plan.manureRequired,
    plan.manureApplied + Math.max(0, building.manure ?? 0) + inboundManure,
  );
  const manureShortfall = Math.max(0, plan.manureRequired - manureCovered);
  const exportableGrain = Math.max(0, onsiteSeedGrain - plan.seedGrainRequired);
  const exportableBarley = Math.max(0, barley - plan.seedBarleyRequired);
  const grainDispatch = context.worldQueries.getNextFarmGrainDispatch(building);
  const grainRoutingLabel = grainDispatch == null
    ? exportableGrain > 1e-6
      ? 'No eligible grain capacity'
      : onsiteSeedGrain > 1e-6 && plan.seedGrainRequired > 1e-6
        ? 'Held for linked fields'
        : 'No grain awaiting haul'
    : grainDispatch.duty === 'working-buffer'
      ? `${context.worldQueries.getBuildingLabel(grainDispatch.target.kind)} · ${Math.round(Math.max(0, grainDispatch.target[grainDispatch.commodity] ?? 0))} / ${Math.ceil(grainDispatch.desiredStock)} ${grainDispatch.commodity.replace(/([A-Z])/g, ' $1').toLowerCase()} working buffer`
      : grainDispatch.duty === 'granary-reserve'
        ? `${context.worldQueries.getBuildingLabel(grainDispatch.target.kind)} · central reserve`
        : `${context.worldQueries.getBuildingLabel(grainDispatch.target.kind)} · emergency overflow`;
  const barleyDispatch = context.worldQueries.getNextFarmBarleyDispatch(building);
  const barleyRoutingLabel = barleyDispatch == null
    ? exportableBarley > 1e-6
      ? 'No road-linked brewhouse capacity'
      : barley > 1e-6 && plan.seedBarleyRequired > 1e-6
        ? 'Held for linked barley fields'
        : 'No barley awaiting haul'
    : `${context.worldQueries.getBuildingLabel(barleyDispatch.target.kind)} · ${
      barleyDispatch.duty === 'working-buffer'
        ? `${Math.round(Math.max(0, barleyDispatch.target.barley ?? 0))} / ${Math.ceil(barleyDispatch.desiredStock)} malting buffer`
        : 'overflow store'
    }`;
  const weakestYearThreeField = plan.rotation.weakestYearThreeFieldId === null
    || plan.rotation.lowestYearThreeFertility === null
    ? ''
    : ` · weakest Year 3 ${Math.round(plan.rotation.lowestYearThreeFertility * 100)}% <button type="button" class="inspector-jump-button" data-inspect-field="${plan.rotation.weakestYearThreeFieldId}" aria-label="Inspect weakest Year 3 field">Inspect</button>`;
  const rotationRows = plan.rotation.activeArea <= 1e-9
    ? '<li><span>Three-year rotation</span><span>No active field area planned</span></li>'
    : `
      <li><span>Year 2 rotation</span><span>${FARM_CROPS.filter((crop) => plan.rotation.nextAreaByCrop[crop] > 0.5).map((crop) => `${Math.round(plan.rotation.nextAreaByCrop[crop])} m² ${cropLabel(crop).toLowerCase()}`).join(' · ')}</span></li>
      <li><span>Year 3 rotation</span><span>${FARM_CROPS.filter((crop) => plan.rotation.yearThreeAreaByCrop[crop] > 0.5).map((crop) => `${Math.round(plan.rotation.yearThreeAreaByCrop[crop])} m² ${cropLabel(crop).toLowerCase()}`).join(' · ')}</span></li>
      <li><span>Cyclic coverage</span><span>${Math.round(plan.rotation.cyclicArea)} / ${Math.round(plan.rotation.activeArea)} m² explicitly scheduled · remaining land repeats Year 2</span></li>
      <li><span>Soil trajectory</span><span>${Math.round(plan.rotation.currentAverageFertility * 100)}% now → ${Math.round(plan.rotation.afterCurrentAverageFertility * 100)}% after Year 1 → ${Math.round(plan.rotation.afterPlannedAverageFertility * 100)}% after Year 2 → ${Math.round(plan.rotation.afterYearThreeAverageFertility * 100)}% after Year 3${weakestYearThreeField}</span></li>
      <li><span>Year 2 potential</span><span>${plan.rotation.plannedHarvest.toFixed(1)} bread grain · ${plan.rotation.plannedBarleyHarvest.toFixed(1)} barley · ${plan.rotation.plannedFibreHarvest.toFixed(1)} flax fibre · seed ${plan.rotation.plannedSeedGrainRequired.toFixed(1)} grain + ${plan.rotation.plannedSeedBarleyRequired.toFixed(1)} barley · ${plan.rotation.restoringFields} restore / ${plan.rotation.decliningFields} draw soil</span></li>
      <li><span>Year 3 potential</span><span>${plan.rotation.yearThreeHarvest.toFixed(1)} bread grain · ${plan.rotation.yearThreeBarleyHarvest.toFixed(1)} barley · ${plan.rotation.yearThreeFibreHarvest.toFixed(1)} flax fibre · seed ${plan.rotation.yearThreeSeedGrainRequired.toFixed(1)} grain + ${plan.rotation.yearThreeSeedBarleyRequired.toFixed(1)} barley · ${plan.rotation.yearThreeRestoringFields} restore / ${plan.rotation.yearThreeDecliningFields} draw soil · current moisture, future manure excluded</span></li>
    `;
  const rows = `
    <li><span>Linked fields</span><span>${plan.activeFields} active${plan.pausedFields > 0 ? ` · ${plan.pausedFields} paused` : ''}</span></li>
    <li><span>Threshing queue</span><span>${Math.round(threshingBacklog)} sheaves waiting · ${threshingPriorityLabel(threshingPriority)}</span></li>
    <li><span>Shared farm labor</span><span>One ${onsiteLabor}-farmer budget + ${plan.pairedStableOxen} active stable ox${plan.pairedStableOxen === 1 ? '' : 'en'} · ox postings are separate; any team without a present farmer waits</span></li>
    <li><span>Crew-sharing queue</span><span>${sharedPriorityFields.length > 0 ? `${sharedPriorityFields.length} nearby High/Urgent field${sharedPriorityFields.length === 1 ? '' : 's'} may claim this crew ahead of lower-priority linked work` : 'No neighboring High/Urgent fields requesting help'} · seed, manure, and harvest remain at each field’s linked farm</span></li>
    <li><span>Stable-ox field work</span><span>${Math.round((plan.oxPloughThroughputMultiplier - 1) * 100)}% crew plough bonus · ${Math.round((plan.oxHarvestThroughputMultiplier - 1) * 100)}% crew harvest bonus · sowing remains human-only</span></li>
    <li><span>Cattle plough support</span><span>${plan.cattleSupportedFields} / ${plan.activeFields} active fields · stacks with stable teams by reducing required plough work</span></li>
    ${rotationRows}
    <li><span>August–September labor</span><span>${formatSeasonalWork(plan.harvest)}</span></li>
    <li><span>Spring crop labor</span><span>${formatSeasonalWork(plan.spring)}</span></li>
    <li><span>Autumn crop labor</span><span>${formatSeasonalWork(plan.autumn)}</span></li>
    <li><span>Seed grain</span><span>${Math.round(Math.min(onsiteSeedGrain, plan.seedGrainRequired))} onsite${inboundSeed > 0.05 ? ` + ${Math.round(inboundSeed)} inbound` : ''} / ${Math.ceil(plan.seedGrainRequired)} protected${seedShortfall > 0.05 ? ` · still short ${Math.ceil(seedShortfall)}` : ''}</span></li>
    <li><span>Barley seed</span><span>${Math.round(Math.min(barley, plan.seedBarleyRequired))} onsite${inboundBarleySeed > 0.05 ? ` + ${Math.round(inboundBarleySeed)} inbound` : ''} / ${Math.ceil(plan.seedBarleyRequired)} protected${barleySeedShortfall > 0.05 ? ` · still short ${Math.ceil(barleySeedShortfall)}` : ''}</span></li>
    <li><span>Field manure</span><span>${Math.round(plan.manureApplied)} spread + ${Math.round(Math.max(0, building.manure ?? 0))} onsite${inboundManure > 0.05 ? ` + ${Math.round(inboundManure)} inbound` : ''} / ${Math.ceil(plan.manureRequired)} cycle coverage${manureShortfall > 0.05 ? ` · short ${Math.ceil(manureShortfall)}` : ' · covered'}</span></li>
    <li><span>Manure allocation</span><span>Consumed only during ploughing · urgent fields claim the shared farmyard pile first</span></li>
    <li><span>Seasonal tool reserve</span><span>${Math.round(Math.max(0, building.ironwork ?? 0) + inboundIronwork)} onsite / inbound · ${Math.ceil(plan.toolIronworkReserveTarget)} target for ${Math.ceil(plan.toolIronworkRequired)} planned wear</span></li>
    <li><span>Exportable grain</span><span>${Math.floor(exportableGrain)} after sowing reserve</span></li>
    <li><span>Exportable barley</span><span>${Math.floor(exportableBarley)} after sowing reserve</span></li>
    <li><span>${clock.month === 8 || clock.month === 9 ? 'Harvest remaining' : 'Harvest potential'}</span><span>${plan.expectedHarvest.toFixed(1)} rye/oat/maslin sheaves · ${plan.expectedBarleyHarvest.toFixed(1)} barley sheaves</span></li>
    <li><span>Flax fibre potential</span><span>${plan.expectedFibreHarvest.toFixed(1)} fibre</span></li>
    <li><span>Harvest storage</span><span>${Math.floor(grainRoom)} onsite room${haulingRequired ? ' · road hauling required' : ' · fits onsite'}</span></li>
    <li><span>Barley storage</span><span>${Math.floor(barleyRoom)} onsite room${barleyHaulingRequired ? ' · brewery / granary hauling required' : ' · fits onsite'}</span></li>
    <li><span>Fibre storage</span><span>${Math.floor(fibreRoom)} onsite room${fibreHaulingRequired ? ' · weaver hauling required' : ' · fits onsite'}</span></li>
    <li><span>Next grain haul</span><span>${grainRoutingLabel}</span></li>
    <li><span>Next barley haul</span><span>${barleyRoutingLabel}</span></li>
    <li><span>Grain policy</span><span>Linked-field seed · lowest processor cycle runway · granary · overflow</span></li>
  `;

  if (onsiteLabor <= 0 && threshingBacklog > 1e-6) {
    return {
      rows,
      statusText: building.assignedLabor > 0
        ? 'Threshing paused — the farm crew is away with its cart'
        : 'Sheaves waiting — assign a farm crew',
      statusState: 'warning',
    };
  }
  if (fields.length === 0 && threshingBacklog > 1e-6) {
    return { rows, statusText: 'Threshing stored sheaves', statusState: 'active' };
  }
  if (fields.length === 0) {
    return { rows, statusText: 'No fields laid out', statusState: 'idle' };
  }
  if (plan.activeFields === 0 && threshingBacklog > 1e-6) {
    return { rows, statusText: 'Fields paused — threshing stored sheaves', statusState: 'active' };
  }
  if (plan.activeFields === 0) {
    return { rows, statusText: 'All linked fields are paused', statusState: 'idle' };
  }
  if (onsiteLabor <= 0) {
    return {
      rows,
      statusText: building.assignedLabor > 0
        ? 'Field work paused - the farm crew is away with its cart'
        : 'Fields waiting - assign a farm crew',
      statusState: 'warning',
    };
  }
  if (
    (onsiteSeedShortfall > 0.05 && inboundSeed > 0.05)
    || (onsiteBarleySeedShortfall > 0.05 && inboundBarleySeed > 0.05)
  ) {
    return {
      rows,
      statusText: seedShortfall > 0.05 || barleySeedShortfall > 0.05
        ? `Seed cart inbound — still short ${Math.ceil(seedShortfall)} grain and ${Math.ceil(barleySeedShortfall)} barley`
        : 'Seed cart inbound — sowing resumes after unloading',
      statusState: 'warning',
    };
  }
  if (
    (seedShortfall > 0.05 || barleySeedShortfall > 0.05)
    && (clock.month >= 9 || clock.month <= 4)
  ) {
    return {
      rows,
      statusText: `Sowing at risk — connect stored or market-imported seed, or pause fields (short ${Math.ceil(seedShortfall)} grain + ${Math.ceil(barleySeedShortfall)} barley)`,
      statusState: 'warning',
    };
  }
  if (
    manureShortfall > 0.05
    && fields.some((field) => field.priority > 0 && field.stage === 'ploughing')
  ) {
    return {
      rows,
      statusText: `Ploughing manure short ${Math.ceil(manureShortfall)} — incoming cattle carts or lower field priority can protect the most valuable parcels`,
      statusState: 'warning',
    };
  }
  if (seasonalRisk) {
    return { rows, statusText: 'Season at risk — add labor or pause low-priority fields', statusState: 'warning' };
  }
  if ((haulingRequired || barleyHaulingRequired || fibreHaulingRequired) && (clock.month === 8 || clock.month === 9)) {
    return { rows, statusText: 'Harvest needs continuous grain, barley, or fibre hauling', statusState: 'warning' };
  }
  return { rows, statusText: 'Farm calendar on plan', statusState: 'active' };
}

export function renderGranaryPolicyPanel(building: BuildingState): string {
  return `
    <div class="inspector-action-panel" data-inspector-panel-title="Accepted goods">
      <p class="inspector-action-panel__hint">Choose which goods this Granary may collect; disabling a good stops new intake but leaves existing stock usable.</p>
      ${renderStorageAcceptanceControls(building, GRANARY_STORAGE_GROUPS)}
    </div>
  `;
}

export function renderProcessorOutputTargetPanel(building: BuildingState): string | null {
  const button = (
    dataAttribute: string,
    value: number,
    label: string,
    conversion: string,
    icon: string,
    selected: boolean,
  ): string => `<button type="button" class="resource-action-button resource-action-button--icon" ${dataAttribute}="${value}" data-tooltip-title="${label}" data-tooltip="${conversion}" aria-label="${label}. ${conversion}" ${selected ? 'disabled' : ''}>${icon}<span>${label}</span></button>`;

  let controls = '';
  if (building.kind === 'brewery') {
    const selected = normalizeBreweryRecipePolicy(building.breweryRecipePolicy);
    controls = BREWERY_RECIPE_PRESETS.map((preset) => {
      const output = breweryPolicyOutput(preset.policy);
      const icon = preset.policy === BREWERY_RECIPE_AUTO
        ? renderResourceCost({ ale: 1, cider: 1, pearCider: 1, mead: 1 }, { compact: true })
        : renderResourceCost({ [output]: 1 }, { compact: true });
      const conversion = output === 'cider'
        ? `${BREWERY_APPLES_PER_CIDER_CYCLE} apples → ${BREWERY_CIDER_PER_CYCLE} apple cider`
        : output === 'pearCider'
          ? `${BREWERY_APPLES_PER_CIDER_CYCLE} pears → ${BREWERY_CIDER_PER_CYCLE} pear cider`
          : output === 'mead'
            ? `${BREWERY_HONEY_PER_MEAD_CYCLE} honey → ${BREWERY_MEAD_PER_CYCLE} mead`
            : `${BREWERY_BARLEY_PER_MALT_CYCLE} barley + ${BREWERY_MALTING_WATER_PER_CYCLE + BREWERY_BREWING_WATER_PER_CYCLE} water + ${BREWERY_MALTING_FIREWOOD_PER_CYCLE + BREWERY_BREWING_FIREWOOD_PER_CYCLE} firewood → ${BREWERY_ALE_PER_CYCLE} ale`;
      const tooltip = preset.policy === BREWERY_RECIPE_AUTO
        ? `Auto: ${BREWERY_BARLEY_PER_MALT_CYCLE} barley + ${BREWERY_MALTING_WATER_PER_CYCLE + BREWERY_BREWING_WATER_PER_CYCLE} water + ${BREWERY_MALTING_FIREWOOD_PER_CYCLE + BREWERY_BREWING_FIREWOOD_PER_CYCLE} firewood → ${BREWERY_ALE_PER_CYCLE} ale; ${BREWERY_APPLES_PER_CIDER_CYCLE} apples → ${BREWERY_CIDER_PER_CYCLE} apple cider; ${BREWERY_APPLES_PER_CIDER_CYCLE} pears → ${BREWERY_CIDER_PER_CYCLE} pear cider; ${BREWERY_HONEY_PER_MEAD_CYCLE} honey → ${BREWERY_MEAD_PER_CYCLE} mead.`
        : conversion;
      return button(
        'data-brewery-recipe-policy',
        preset.policy,
        preset.label,
        tooltip,
        icon,
        selected === preset.policy,
      );
    }).join('');
  } else if (building.kind === 'smokehouse') {
    const selected = normalizeSmokehouseRecipePolicy(building.smokehouseRecipePolicy);
    controls = SMOKEHOUSE_RECIPE_PRESETS.map((preset) => {
      const icon = preset.policy === SMOKEHOUSE_RECIPE_AUTO
        ? renderResourceCost({ curedMeat: 1, smokedFish: 1, cheese: 1 }, { compact: true })
        : renderResourceCost({ [smokehouseRecipeOutput(preset.policy)]: 1 }, { compact: true });
      const tooltip = preset.policy === SMOKEHOUSE_RECIPE_AUTO
        ? `Auto: ${SMOKEHOUSE_RECIPE_PRESETS
            .filter((candidate) => candidate.policy !== SMOKEHOUSE_RECIPE_AUTO)
            .map((candidate) => smokehouseRecipeConversion(candidate.policy))
            .join('; ')}.`
        : smokehouseRecipeConversion(preset.policy);
      return button(
        'data-smokehouse-recipe-policy',
        preset.policy,
        preset.label,
        tooltip,
        icon,
        selected === preset.policy,
      );
    }).join('');
  } else if (building.kind === 'spinning_retting_house') {
    const selected = normalizeWeaverInputPolicy(building.weaverInputPolicy);
    controls = SPINNING_RETTING_INPUT_POLICY_PRESETS.map((preset) => {
      const usesFlax = preset.policy === WEAVER_INPUT_POLICY_FLAX_FIRST;
      const icon = preset.policy === WEAVER_INPUT_POLICY_AUTO
        ? renderResourceCost({ yarn: 1, linen: 1 }, { compact: true })
        : renderResourceCost({ [usesFlax ? 'linen' : 'yarn']: 1 }, { compact: true });
      const conversion = usesFlax
        ? `${SPINNING_RETTING_FLAX_PER_CYCLE} flax + ${SPINNING_RETTING_FLAX_WATER_PER_CYCLE} water → ${SPINNING_RETTING_LINEN_PER_CYCLE} linen`
        : `${SPINNING_RETTING_WOOL_PER_CYCLE} wool → ${SPINNING_RETTING_YARN_PER_CYCLE} yarn`;
      const tooltip = preset.policy === WEAVER_INPUT_POLICY_AUTO
        ? `Auto: ${SPINNING_RETTING_WOOL_PER_CYCLE} wool → ${SPINNING_RETTING_YARN_PER_CYCLE} yarn; ${SPINNING_RETTING_FLAX_PER_CYCLE} flax + ${SPINNING_RETTING_FLAX_WATER_PER_CYCLE} water → ${SPINNING_RETTING_LINEN_PER_CYCLE} linen.`
        : conversion;
      return button(
        'data-weaver-input-policy',
        preset.policy,
        preset.label,
        tooltip,
        icon,
        selected === preset.policy,
      );
    }).join('');
  } else if (building.kind === 'weaver') {
    const selected = normalizeWeaverInputPolicy(building.weaverInputPolicy);
    controls = WEAVER_INPUT_POLICY_PRESETS.map((preset) => {
      const conversion = preset.policy === WEAVER_INPUT_POLICY_FLAX_FIRST
        ? `${WEAVER_LINEN_PER_CYCLE} linen → ${WEAVER_CLOTH_PER_CYCLE} clothing`
        : `${WEAVER_YARN_PER_CYCLE} yarn → ${WEAVER_CLOTH_PER_CYCLE} clothing`;
      const tooltip = preset.policy === WEAVER_INPUT_POLICY_AUTO
        ? `Auto: ${WEAVER_YARN_PER_CYCLE} yarn → ${WEAVER_CLOTH_PER_CYCLE} clothing; ${WEAVER_LINEN_PER_CYCLE} linen → ${WEAVER_CLOTH_PER_CYCLE} clothing.`
        : conversion;
      return button(
        'data-weaver-input-policy',
        preset.policy,
        preset.label,
        tooltip,
        renderResourceCost({ cloth: 1 }, { compact: true }),
        selected === preset.policy,
      );
    }).join('');
  } else if (building.kind === 'potter_kiln') {
    const selected = normalizePotterFiringPolicy(building.potterFiringPolicy);
    controls = POTTER_FIRING_POLICY_PRESETS.map((preset) => {
      const firesTiles = preset.policy !== 0;
      const output = firesTiles ? 'roofTiles' : 'pottery';
      const outputAmount = firesTiles
        ? POTTER_ROOF_TILES_PER_CYCLE
        : POTTER_POTTERY_PER_CYCLE;
      const conversion = `${POTTER_CLAY_PER_CYCLE} clay + ${POTTER_FIREWOOD_PER_CYCLE} firewood + ${POTTER_WATER_PER_CYCLE} water → ${outputAmount} ${firesTiles ? 'roof tiles' : 'pottery'}`;
      return button(
        'data-potter-firing-policy',
        preset.policy,
        preset.label,
        conversion,
        renderResourceCost({ [output]: 1 }, { compact: true }),
        selected === preset.policy,
      );
    }).join('');
  } else {
    return null;
  }

  return `
    <div class="inspector-action-panel" data-inspector-panel-title="Recipe">
      <div class="resource-action-row">${controls}</div>
    </div>
  `;
}

function renderCarpenterPolicyPanel(
  building: BuildingState,
  conflictEnabled: boolean,
): string {
  const serviceTarget = normalizeCarpenterCartServiceTargetTrips(
    building.carpenterCartServiceTargetTrips,
  );
  const serviceTimberTarget = carpenterCartServiceTimberTarget(serviceTarget);
  const serviceIronworkTarget = carpenterCartServiceIronworkTarget(serviceTarget);
  const armory = carpenterArmoryPlan(building);
  return `
    <div class="inspector-action-panel" data-inspector-panel-title="Cart and armory">
      <p class="resource-inspector-note">Cart-service depth — protected working capital for accelerated departures.</p>
      <div class="resource-action-row">${CARPENTER_CART_SERVICE_TARGET_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-carpenter-cart-service-target="${preset.trips}" title="${preset.hint}" ${serviceTarget === preset.trips ? 'disabled' : ''}>${preset.label} · ${preset.trips}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">${serviceTarget <= 0
        ? 'Conserve fittings keeps the road-linked construction timber discount but stops repair-kit procurement and the cart-speed bonus. Existing timber and ironwork become available to construction and weapon crafting.'
        : `This shop protects ${renderResourceCost({ timber: serviceTimberTarget, ironwork: serviceIronworkTarget }, { compact: true, suffix: `for ${serviceTarget} departures` })}. Every accelerated handcart or ox-cart departure consumes ${renderResourceCost({ timber: CARPENTER_CART_SERVICE_TIMBER_PER_TRIP, ironwork: CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP }, { compact: true })}; lowering the target immediately releases surplus stock.`}</p>
      ${conflictEnabled ? `
        <p class="resource-inspector-note">Finished polearm reserve — weapon crafting uses only timber and ironwork above the selected cart-service buffer.</p>
        <div class="resource-action-row">${CARPENTER_POLEARM_RESERVE_PRESETS
          .map((preset) => `<button type="button" class="resource-action-button" data-carpenter-polearm-reserve="${preset.reserve}" ${armory.reserve === preset.reserve ? 'disabled' : ''}>${preset.label} · ${preset.reserve}</button>`)
          .join('')}</div>
        <p class="inspector-action-panel__hint">Carpenters first issue one weapon to each assigned guard, then rebuild this local reserve. “Cartwright only” disables weapon crafting so timber and fittings remain available for framing and physical cart repair.</p>
      ` : ''}
    </div>
  `;
}

function renderFarmsteadFieldPanel(building: BuildingState): string {
  const threshingPriority = normalizeThreshingPriority(building.threshingPriority);
  return `
    <div class="inspector-action-panel" data-inspector-panel-title="Threshing">
      <p class="resource-inspector-note">Threshing priority — the same onsite crew works fields and converts stored sheaves into typed grain. A ready harvest always pre-empts threshing.</p>
      <div class="resource-action-row">${THRESHING_PRIORITY_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-threshing-priority="${preset.priority}" title="${preset.hint}" ${threshingPriority === preset.priority ? 'disabled' : ''}>${preset.label}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">Automatic restores linked-field seed and one dispatch load after High/Urgent fieldwork but before Normal fieldwork. Fields first leaves threshing until field jobs are quiet; Thresh first pre-empts every non-harvest field job.</p>
    </div>
  `;
}

function renderFarmsteadPrimaryAction(): string {
  return `<button type="button" class="resource-action-button resource-action-button--icon farm-field-layout-button" data-land-parcel="field" data-tooltip-title="Lay out field" data-tooltip="Lay out a cultivated parcel inside this farmstead’s work extent. Press C while laying it out to change its first crop; select the finished field to set its rotation." data-tooltip-cost="${FREE_CONSTRUCTION_COST_TOOLTIP}" data-tooltip-cost-affordable="true"><span class="inspector-action-icon" data-action-icon="field-parcel" aria-hidden="true"></span><span>Lay out field</span></button>`;
}

function renderApiaryHarvestPolicyPanel(building: BuildingState): string {
  const selected = apiaryHarvestPolicy(building.apiaryHarvestPolicy);
  return `
    <div class="inspector-action-panel" data-inspector-panel-title="Honey harvest">
      <p class="resource-inspector-note">Honey harvest · choose how much winter food the beekeepers protect and how much whole-unit yield they accumulate during Spring and Summer.</p>
      <div class="resource-action-row">${APIARY_HARVEST_POLICIES
        .map((policy) => `<button type="button" class="resource-action-button" data-apiary-harvest-policy="${policy.value}" title="${policy.hint}" ${selected.value === policy.value ? 'disabled' : ''}>${policy.label} · ${policy.reserve} reserve · ${Math.round(policy.yieldMultiplier * 100)}%</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">Workers tend the hives and accumulate yield from March through August, then extract that crop into physical Honey from September through November. Unharvested hive yield is lost when winter begins. The reserve protects stored Honey from town-processing and export carts; in winter the colony consumes up to ${APIARY_WINTER_HONEY_REQUIRED} honey, and a shortfall damages next season's colony health. Forage and health multiply accumulated yield, while nearby healthy hives provide bounded pollination.</p>
    </div>
  `;
}

function renderMonasteryPolicyPanel(building: BuildingState, context: InspectorRenderContext): string {
  const policy = context.getMonasteryPolicy?.() ?? DEFAULT_MONASTERY_POLICY;
  const feastBatchCost = `${MONASTERY_FEAST_FOOD} food · ${MONASTERY_FEAST_HONEY} honey · ${MONASTERY_FEAST_DRINK} cider, mead, and/or wine`;
  const dailyHospitalityCost = `${MONASTERY_HOSPITALITY_HONEY_PER_DAY.toFixed(1)} honey + ${MONASTERY_HOSPITALITY_DRINK_PER_DAY.toFixed(1)} cider, mead, and/or wine/day`;
  const archetype = monasteryArchetype(0, 0);
  const vineyards = [...(context.gameState.vineyardParcels?.values() ?? [])]
    .filter((parcel) => parcel.monasteryId === building.id);
  const vineyardArea = vineyards.reduce((sum, parcel) => sum + Math.max(0, parcel.area), 0);
  const extensions = building.monasteryExtensions ?? 0;
  const availableExtensions = MONASTERY_EXTENSIONS.filter(
    (extension) => !monasteryHasExtension(extensions, extension.value),
  );
  const nextExtension = building.monasteryNextExtension ?? 0;
  return `
    <div class="inspector-action-panel" data-inspector-panel-title="Monastery estate">
      <p class="inspector-action-panel__hint"><strong>${archetype.name}</strong> · ${archetype.payoff}. Assign residents to the eight-cell community; without a monk on site the estate and every service remain dormant. The fixed estate is intentionally non-granular: mixed apples and pears, kitchen gardens, apiary, cattle and sheep, and workshops resolve into abstract proceeds.</p>
      <div class="city-admin-panel__slider-label"><span>Enclosed estate</span><strong>Mixed orchard and kitchen gardens</strong></div>
      <p class="inspector-action-panel__hint">There are no apple-versus-pear or cabbage-versus-carrot choices. The visual estate canonically grows a useful mixture; its orchard also supplies one house-cider output, while ordinary regional activity is presented as gold-in/gold-out administration.</p>
      <div class="resource-action-row">
        <button type="button" class="resource-action-button resource-action-button--icon" data-land-parcel="vineyard" data-tooltip-title="Vineyard parcel" data-tooltip="Lay out a grape-growing parcel inside this monastery’s work extent." data-tooltip-cost="${FREE_CONSTRUCTION_COST_TOOLTIP}" data-tooltip-cost-affordable="true"><span class="inspector-action-icon" data-action-icon="field-parcel" aria-hidden="true"></span><span>${vineyards.length > 0 ? `Add vineyard parcel · ${vineyards.length} laid out (${Math.round(vineyardArea)} m²)` : 'Lay out vineyard parcel'}</span></button>
      </div>
      <p class="inspector-action-panel__hint">Vineyards are the one deliberate physical exception. Lay out free-form parcels inside the work extent; monks harvest them in September–October, then report to the separate visible vintner and wine cellar to press and ferment grapes into actual wine.</p>
      <div class="city-admin-panel__slider-label"><span>Next reserved extension</span><strong>${monasteryExtensionCount(extensions)} / 4 complete</strong></div>
      ${availableExtensions.length > 0
        ? `<div class="monastery-extension-grid" role="group" aria-label="Choose the next monastery extension">
            ${availableExtensions.map((extension) => `<button type="button" class="resource-action-button resource-action-button--toggle monastery-extension-choice${nextExtension === extension.value ? ' is-selected' : ''}" data-monastery-extension-choice="${extension.value}" aria-pressed="${nextExtension === extension.value ? 'true' : 'false'}" title="${extension.payoff}" ${nextExtension === extension.value ? 'disabled' : ''}>
              <span class="monastery-extension-choice__icon" data-monastery-extension-icon="${extension.value}" aria-hidden="true"></span>
              <span class="monastery-extension-choice__copy"><strong>${extension.label}</strong><small>${extension.cost} gold</small></span>
            </button>`).join('')}
          </div>`
        : '<p class="inspector-action-panel__hint monastery-extension-grid__complete">Estate fully developed · all four extensions complete.</p>'}
      <p class="inspector-action-panel__hint">These are four independent extensions, not upgrade tiers: they add visible buildings and services inside the already reserved precinct without enlarging or subdividing its plots. The monks begin the selected project automatically when its cost and working reserve are secured. ${availableExtensions.map((extension) => `${extension.label}: ${extension.payoff}`).join(' · ')}</p>
      <label class="city-admin-panel__toggle"><input type="checkbox" data-policy-monastery-feasts ${policy.feastsEnabled ? 'checked' : ''} /><span>Provision hospitality and feast days</span></label>
      <p class="inspector-action-panel__hint">Enabled houses protect ${feastBatchCost}. Orchard cider and apiary mead stretch the common table, while vintner-made wine increases offering prestige; any mixed cellar earns a modest lavish-hospitality bonus. When available, estate meat, cheese, and milk are all served before the rest of the pantry completes the feast. Feast crowds still gather visibly; ordinary pilgrims and infirmary patients remain abstract service simulation. Daily hospitality uses ${dailyHospitalityCost}.</p>
      <label class="city-admin-panel__slider-label"><span>Parish tithe share</span><strong data-policy-monastery-tithe-value>${Math.round(policy.titheShare * 100)}%</strong></label>
      <input class="city-admin-panel__slider" type="range" data-policy-monastery-tithe min="0" max="80" step="5" value="${Math.round(policy.titheShare * 100)}" />
      <div class="city-admin-panel__range-hints"><span>Church keeps all</span><span>Monastery-led</span></div>
      <p class="inspector-action-panel__hint">Lifetime: ${formatMonasteryTithePaidTotal(policy.tithePaidTotal)} · ${formatMonasteryPilgrimageTotal(policy.pilgrimageGoldTotal)} retained before levy · ${formatMonasteryFoodCharityTotal(policy.foodCharityTotal)} · ${policy.feastsHeldTotal} feasts · ${policy.seedRescueTotal.toFixed(0)} seed delivered.</p>
    </div>
  `;
}
