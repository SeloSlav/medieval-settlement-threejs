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
  FOOD_DELIVERY_SPEED_MPS,
  FOOD_DELIVERY_UNLOAD_SEC,
  FRESH_FOOD_STORAGE_GRANARY_FACTOR,
  GRAIN_TRANSFER_PER_TRIP,
  MONASTERY_FEAST_ALE,
  MONASTERY_FEAST_FOOD,
  MONASTERY_FEAST_HONEY,
  MONASTERY_FEAST_WINE,
  MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY,
  MONASTERY_HOSPITALITY_HONEY_PER_DAY,
  MONASTERY_HOSPITALITY_WINE_PER_DAY,
  MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
  TIMBER_DELIVERY_SPEED_MPS,
  TIMBER_DELIVERY_UNLOAD_SEC,
  TEXTILE_TRANSFER_PER_TRIP,
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
  granaryDispatchPriorityLabel,
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
import { buildingDemolishHint, buildingExtentRow, buildingLaborView, buildingRoadAccessRow, buildingStorageRows, civilianToolRows } from './buildingCommon.ts';
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
} from '../../economy/monasteryPolicy.ts';
import { DEFAULT_FISCAL_POLICY } from '../../economy/fiscalPolicy.ts';
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
  MONASTERY_INFIRMARY_FOOD_PER_BED_DAY,
  monasteryEstateNextInvestmentCost,
  monasteryEstateYields,
  monasteryInfirmaryBeds,
  monasteryInfirmaryMortalityMultiplier,
  monasteryInfirmaryRecoveryMultiplier,
  monasteryScriptoriumRecoveryMultiplier,
  monasterySeedArchiveTargetPerCrop,
  normalizeMonasteryEstateLevel,
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
  GRANARY_FRESH_FOOD_TARGET_PRESETS,
  GRANARY_GRAIN_RESERVE_PRESETS,
  granaryExportableGrain,
  granaryFreshFoodTarget,
  granaryReserveLabel,
  normalizeGranaryFreshFoodTargetPercent,
  normalizeGranaryGrainReserve,
} from '../../economy/granaryPolicy.ts';
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
  seedGrainSourceCoveragePlan,
  type SeedGrainSourceCoveragePlan,
} from '../../economy/marketplaceSeedCoverage.ts';
import { computeCattleFieldSupport } from '../../farming/cattleFieldSupport.ts';
import { settlementHasStaffedChapel } from '../../logistics/landmarkAccess.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import {
  vineyardProductionMultiplier,
  vineyardSiteFactors,
} from '../../vineyards/vineyardSuitability.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';
import { buildingStorageCaps } from '../resourceTotals.ts';
import { GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS } from '../../security/frontierSecurity.ts';
import {
  isProcessorOutputTargetKind,
  normalizeProcessorOutputTargetPercent,
  PROCESSOR_OUTPUT_TARGET_PRESETS,
  processorInputStagingCycles,
  processorOutputCommodity,
  processorOutputCommodityForBuilding,
  processorOutputHeadroom,
  processorOutputTargetForBuilding,
} from '../../economy/processorOutputPolicy.ts';
import { civicReceiptCollectionPlan } from '../../economy/civicReceipts.ts';
import {
  normalizeWeaverInputPolicy,
  WEAVER_INPUT_POLICY_PRESETS,
  weaverFibreDeliveryPreferenceLabel,
} from '../../economy/weaverInputPolicy.ts';
import {
  normalizePotteryDispatchPolicy,
  POTTERY_DISPATCH_HOUSEHOLDS_FIRST,
  POTTERY_DISPATCH_POLICY_PRESETS,
  potteryDispatchPolicyLabel,
} from '../../economy/potteryDispatchPolicy.ts';
import {
  normalizePotterFiringPolicy,
  POTTER_FIRING_POLICY_PRESETS,
  POTTER_FIRE_ROOF_TILES,
  potterFiringPolicyLabel,
} from '../../economy/potterFiringPolicy.ts';
import {
  BREWERY_RECIPE_AUTO,
  BREWERY_RECIPE_PRESETS,
  breweryPolicyOutput,
  breweryRecipePolicyLabel,
  normalizeBreweryRecipePolicy,
  selectedBreweryRecipePolicy,
} from '../../economy/breweryRecipePolicy.ts';
import {
  CLAY_BANK_LEAN_YIELD_THRESHOLD,
  clayBankYieldAt,
  clayBankYieldGrade,
} from '../../economy/clayBankPolicy.ts';
import { renderExtractionStockTargetPanel } from './extractionStockTargetRenderer.ts';
import { renderResourceCost } from '../../ui/resourceCost.ts';
import {
  APIARY_HARVEST_POLICIES,
  VINEYARD_PRODUCTION_POLICIES,
  apiaryHarvestPolicy,
  vineyardProductionPolicy,
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
  mine: 'A local iron or salt deposit + labor → raw material for linked local processing',
  clay_pit: 'Finite ordinary bank or rich deep alluvium + labor -> wet clay for local potters',
  charcoal_burner: 'Firewood + labor -> charcoal, competing directly with winter heating reserves',
  smithy: 'Small direct-process bloomery reduces local ore or reheats imported blooms and bars; the smithing bay then uses charcoal and carted quench water to finish tools, fittings, and weapon heads',
  potter_kiln: 'Local clay + firewood + carted puddling water -> either vessels or rare prosperous-house roof tiles',
  threshing_barn: 'Farmstead crew works nearby drawn fields',
  watermill: 'Grain + seasonal river power + smith-dressed millstones and iron fittings → flour',
  windmill: 'Grain + upland wind + smith-dressed millstones and iron fittings → flour without river access',
  granary: 'Shelters foodstuffs, farm crops, flour, and cured provisions, then stocks Marketplace stalls, Taverns, and physical institutional routes',
  bakery: 'Flour + hauled water + firewood + baker labor -> bread for Marketplace stalls and institutions',
  brewery: 'Barley → malt → ale, 4 apples → 1 cider, or 1 honey → 1 mead; finished beverages go to staffed Taverns',
  tavern: 'Receives ale, cider, and mead, then serves any of them as the residential Beverage service',
  smokehouse: 'Meat, fish, or milk + firewood + local or imported salt + pottery vessels -> cured meat, smoked fish, or cheese',
  apiary: 'April-September forage + a healthy overwintered colony -> honey, with nearby orchard and vineyard pollination',
  vineyard: 'September-October harvest -> table-grape reserve or a staffed, timed cellar batch -> wine',
  monastery: 'A self-governing 68 × 53 m estate raises orchard fruit, vegetables, eggs, milk, meat, honey, ale, wine, and cheese for its own pantry; genuine surplus is sold beyond the map, while finite infirmary beds nurse covered households',
  carpenter: 'Timber + smith-forged ironwork → polearms and cartwright support',
  weaver: 'Annual sheep fleece or flax + hauled water → woven cloth → tier-2+ Marketplace stalls, then Trading Post export',
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
  'vineyard',
  'monastery',
  'carpenter',
  'weaver',
  'clay_pit',
  'charcoal_burner',
  'smithy',
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
        || (building.honey ?? 0) > 0
        || building.ale > 0
        || (building.cider ?? 0) > 0
        || (building.mead ?? 0) > 0;
    case 'smokehouse':
      return preservedFoodStock(building) > 0;
    case 'apiary':
      return building.honey > 0;
    case 'vineyard':
      return building.wine > 0 || (building.grapes ?? 0) > 0;
    case 'monastery':
      return building.ale > 18 + 1e-6
        || building.honey > 10 + 1e-6
        || (building.cheese ?? 0) > 8 + 1e-6;
    case 'carpenter':
      return (building.polearms ?? 0) > 0;
    case 'weaver':
      return (building.cloth ?? 0) > 0;
    case 'clay_pit':
      return (building.clay ?? 0) > 0;
    case 'charcoal_burner':
      return (building.charcoal ?? 0) > 0;
    case 'smithy':
      return (building.ironwork ?? 0) > 0;
    case 'potter_kiln':
      return (building.pottery ?? 0) > 0;
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
    case 'vineyard':
      return 'Ordinary town demand, then the road-linked export market';
    case 'monastery':
      return 'Regional merchant at the map edge · sale proceeds return to the monastery purse';
    case 'carpenter':
      return 'Nearest road-linked guardhouse';
    case 'weaver':
      return 'Staffed Storehouse for Marketplace cloth stalls, then road-linked export market';
    case 'clay_pit':
      return "Settlement-wide match: highest-priority road-linked potter's kiln, then shortest producer route";
    case 'charcoal_burner':
      return 'Settlement-wide match: highest-priority road-linked smithy, then shortest producer route';
    case 'smithy':
      return 'Settlement-wide match: highest-priority maintained worksite, then shortest forge route and overflow';
    case 'potter_kiln':
      return 'Settlement-wide match: staffed Storehouse market supply, highest-priority smokehouse, then export';
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
    case 'vineyard':
      return `${GRAIN_TRANSFER_PER_TRIP} per haul`;
    case 'granary':
      return `4 fresh or 3 cured per market-stall haul · ${GRAIN_TRANSFER_PER_TRIP} per bulk haul`;
    case 'smokehouse':
      return `3 per cured-food haul · ${GRAIN_TRANSFER_PER_TRIP} per granary haul`;
    case 'weaver':
      return `${TEXTILE_TRANSFER_PER_TRIP} cloth per Storehouse or market haul`;
    case 'clay_pit':
    case 'charcoal_burner':
    case 'smithy':
    case 'potter_kiln':
      return `${GRAIN_TRANSFER_PER_TRIP} per handcart`;
    case 'monastery':
      return 'Up to 6 ale, honey, or cheese per estate export';
    default:
      return null;
  }
}

function outboundTargetKinds(kind: BuildingKind): BuildingKind[] {
  switch (kind) {
    case 'threshing_barn':
      return ['watermill', 'windmill', 'brewery', 'granary', 'monastery', 'weaver'];
    case 'watermill':
    case 'windmill':
      return ['bakery', 'granary'];
    case 'granary':
      return ['bakery', 'brewery', 'weaver', 'smokehouse'];
    case 'apiary':
    case 'vineyard':
      return ['marketplace'];
    case 'carpenter':
      return ['guardhouse'];
    case 'weaver':
      return ['marketplace'];
    case 'clay_pit':
      return ['potter_kiln'];
    case 'charcoal_burner':
      return ['smithy'];
    case 'smithy':
      return [
        'lumber_mill',
        'woodcutters_lodge',
        'stone_quarry',
        'large_quarry',
        'clay_pit',
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
  if (building.kind === 'apiary' || building.kind === 'vineyard') {
    return context.worldQueries.getNextFoodDeliveryTargetForSupplier(building)
      ?? context.worldQueries.findNearestRoadLinkedBuilding(building, ['marketplace']);
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
  if (building.kind === 'clay_pit') {
    return context.worldQueries.getNextDirectProcessorInputDispatch(
      building,
      'clay',
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
    const preservationTarget = materialTarget?.kind === 'smokehouse'
      ? materialTarget
      : null;
    const exportTarget = materialTarget?.kind === 'marketplace'
      ? materialTarget
      : null;
    return normalizePotteryDispatchPolicy(building.potteryDispatchPolicy)
      === POTTERY_DISPATCH_HOUSEHOLDS_FIRST
      ? householdTarget ?? preservationTarget ?? exportTarget
      : preservationTarget ?? householdTarget ?? exportTarget;
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
    const foodTarget = building.granaryHouseholdsFirst === true
      ? householdTarget ?? preservationTarget
      : preservationTarget ?? householdTarget;
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
  const materialDispatch = building.kind === 'clay_pit'
    ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'clay')
    : building.kind === 'charcoal_burner'
      ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'charcoal')
      : building.kind === 'potter_kiln'
        ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'pottery')
        : null;
  const potteryHouseholdTarget = building.kind === 'potter_kiln'
    ? context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(building, 'pottery')
    : null;
  const materialCommodity = building.kind === 'clay_pit'
    ? 'clay'
    : building.kind === 'charcoal_burner'
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
    ? normalizePotteryDispatchPolicy(building.potteryDispatchPolicy)
        === POTTERY_DISPATCH_HOUSEHOLDS_FIRST
      ? potteryHouseholdDestination ?? potteryMaterialDestination
      : materialDispatch?.target.kind === 'smokehouse'
        ? potteryMaterialDestination
        : potteryHouseholdDestination ?? potteryMaterialDestination
    : null;
  const flaxDispatch = building.kind === 'threshing_barn'
    ? context.worldQueries.getNextFarmFlaxDispatch(building)
    : null;
  const destination = seedHaulUsesHoldingCrew
    ? 'Least-covered active farmstead, then shorter road'
    : flaxDispatch
      ? flaxDispatch.duty === 'working-buffer'
        ? `${context.worldQueries.getBuildingLabel(flaxDispatch.target.kind)} · ${weaverFibreDeliveryPreferenceLabel(flaxDispatch.target.weaverInputPolicy, 'flax')} · ${Math.round(flaxDispatch.target.flax ?? 0)} / ${Math.ceil(flaxDispatch.desiredStock)} flax`
        : `${context.worldQueries.getBuildingLabel(flaxDispatch.target.kind)} · active loom buffers covered · nearest overflow route`
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
  const textileTerritoryRows = building.kind === 'weaver'
    ? `<li><span>Textile territory</span><span>Connected tier-2+ homes draw cloth from stocked Marketplace goods stalls</span></li>
       <li><span>Physical cloth route</span><span>Weaver → staffed Storehouse → Marketplace stall · no routine home cart</span></li>`
    : '';
  const potteryTerritoryRows = building.kind === 'potter_kiln'
    ? `<li><span>Kiln firing</span><span>${potterFiringPolicyLabel(building.potterFiringPolicy)}</span></li>
       <li><span>Kiln cart order</span><span>${potteryDispatchPolicyLabel(building.potteryDispatchPolicy)} · export always last</span></li>
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
      : context.populationStats.available > 0;
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

function formatGranarySeedCart(
  plan: SeedGrainSourceCoveragePlan | null,
  building: BuildingState,
  context: InspectorRenderContext,
): string {
  if (plan === null) return 'No seed forecast';
  if (!plan.sourceOperational) return 'Blocked while this granary is fire-disabled';
  if (plan.sourceBusy) {
    return 'Cart occupied &middot; least-covered holding recalculates when it returns';
  }
  if (plan.nextDispatchBuildingId === null) {
    if (plan.inboundBlockedHoldings > 0) {
      return `${plan.inboundBlockedHoldings} short holding${plan.inboundBlockedHoldings === 1 ? '' : 's'} already receiving grain &middot; no duplicate cart`;
    }
    if (plan.laborBlockedHoldings > 0) {
      return `${plan.laborBlockedHoldings} short holding${plan.laborBlockedHoldings === 1 ? '' : 's'} blocked by missing farm labor`;
    }
    if (plan.fireBlockedHoldings > 0) {
      return `${plan.fireBlockedHoldings} short holding${plan.fireBlockedHoldings === 1 ? '' : 's'} blocked by fire`;
    }
    if (plan.connectedHoldings <= 0) return 'No active field claim on this road branch';
    if (plan.seedShortfall <= 0.05) return 'Reachable field claims covered';
    return 'No safe staffed road-reachable holding eligible';
  }
  const inspect = `<button type="button" class="inspector-jump-button" data-inspect-building="${plan.nextDispatchBuildingId}" aria-label="Inspect next granary seed-cart holding">Inspect holding</button>`;
  const distance = plan.nextDispatchDistance === null
    ? ''
    : ` &middot; ${plan.nextDispatchDistance.toFixed(0)} m road`;
  if (breadGrainStock(building) <= 0.05 || plan.nextDispatchAmount <= 0.05) {
    return `Awaiting physical grain &middot; next holding ${Math.round(plan.nextDispatchStock)} / ${Math.ceil(plan.nextDispatchRequired)} onsite${distance} ${inspect}`;
  }
  const collection = building.assignedLabor <= 0
    ? ' &middot; waiting for an assigned granary hauler'
    : '';
  return `${Math.round(plan.nextDispatchAmount)} grain &rarr; ${context.worldQueries.getBuildingLabel('threshing_barn')} at ${Math.round(plan.nextDispatchStock)} / ${Math.ceil(plan.nextDispatchRequired)} onsite${distance}${collection} ${inspect}`;
}

function renderCivicReceiptRows(
  building: BuildingState,
  context: InspectorRenderContext,
  dispatchThreshold: number,
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
  return `<li><span>Civic visitor gifts</span><span>${Math.round(plan.heldGold)} gold secured at this source${plan.inTransitGold > 0.05 ? ` · ${Math.round(plan.inTransitGold)} already moving` : ''}</span></li>
      <li><span>Civic collection</span><span>${collection}</span></li>`;
}

export function renderExpandedBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
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
  const granarySeedPlan = building.kind === 'granary'
    ? seedGrainSourceCoveragePlan(
        building,
        context.gameState,
        (_source, farmstead) => context.worldQueries.getRoadPathDistance(
          building.x,
          building.z,
          farmstead.x,
          farmstead.z,
        ),
      )
    : null;
  const logisticsRows = renderLogisticsRows(building, context, granarySeedPlan);
  const clock = gameClock(context.gameState.tick);
  const environment = environmentFor(
    context.gameState.seed,
    context.worldHydrology,
    clock,
  );
  const windSiteThroughput = windSiteThroughputMultiplier(
    context.gameState.seed,
    building.x,
    building.z,
  );
  const windWeatherThroughput = windWeatherThroughputMultiplier(environment.weather);
  const windmillThroughput = windSiteThroughput * windWeatherThroughput;
  const clayBankYield = building.kind === 'clay_pit'
    ? clayBankYieldAt(
        building.x,
        building.z,
        context.worldResourceAbundance ?? 50,
      )
    : 1;
  const clayBankCombinedYield = clayBankYield
    * environment.clayPitThroughputMultiplier;
  const clayDepositResource = building.kind === 'clay_pit'
    ? [...context.gameState.quarries.values()].find((node) =>
        node.resource === 'clay'
        && Math.hypot(node.x - building.x, node.z - building.z) <= 2.5
      ) ?? null
    : null;
  const clayDepositExhausted = clayDepositResource !== null
    && clayDepositResource.isRich !== true
    && clayDepositResource.remaining <= 1e-6;
  const clayReserveLabel = clayDepositResource === null
    ? 'No physical clay deposit beneath this pit'
    : clayDepositResource.isRich
      ? 'Rich deep alluvial source · nondepleting'
      : `${Math.max(0, clayDepositResource.remaining).toFixed(0)} / ${Math.max(0, clayDepositResource.maxYield).toFixed(0)} finite clay remaining`;
  const clayBankWeatherLabel = environment.weather === 'frost'
    ? 'frozen ground'
    : environment.weather === 'drought'
      ? 'hardened ground'
      : environment.weather === 'rain'
        ? 'saturated ground'
        : 'fair ground';
  const clayBankRows = building.kind === 'clay_pit'
    ? `<li><span>Clay seam</span><span>${clayBankYieldGrade(clayBankYield)} · ${Math.round(clayBankYield * 100)}% geological yield at regional abundance ${Math.round(context.worldResourceAbundance ?? 50)}/100</span></li>
      <li><span>Physical reserve</span><span>${clayReserveLabel}</span></li>
      <li><span>Current digging pace</span><span>${Math.round(clayBankYield * 100)}% bank × ${Math.round(environment.clayPitThroughputMultiplier * 100)}% ${clayBankWeatherLabel} = ${Math.round(clayBankCombinedYield * 100)}% before tool condition</span></li>`
    : '';
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
    : building.kind === 'clay_pit'
      && clayDepositResource === null
      ? {
          statusText: 'Stopped - no physical clay deposit beneath this pit',
          statusState: 'warning' as const,
        }
    : building.kind === 'clay_pit'
      && clayDepositExhausted
      ? {
          statusText: 'Ordinary clay bank exhausted · relocate the pit or develop a rich deep bank',
          statusState: 'warning' as const,
        }
      : building.kind === 'clay_pit'
      && processorStatus?.statusState === 'active'
      ? {
          statusText: `${clayBankYieldGrade(clayBankYield)} · ${Math.round(clayBankCombinedYield * 100)}% clay pace before tool condition${environment.clayPitThroughputMultiplier < 1 ? ' · stockpile for winter kilns' : ''}`,
          statusState: clayBankCombinedYield < CLAY_BANK_LEAN_YIELD_THRESHOLD
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
  const hospitality = building.kind === 'monastery'
    ? monasteryHospitalityPlan(building, monasteryPolicy.feastsEnabled)
    : null;
  const feastReadiness = building.kind === 'monastery'
    ? monasteryFeastReadiness(building)
    : null;
  const nextFeast = building.kind === 'monastery'
    ? nextMonasteryFeast(clock)
    : null;
  const monasteryHospitalityRows = hospitality
    ? `<li><span>Hospitality</span><span>${monasteryHospitalityStatusLabel(hospitality)}</span></li>
      <li><span>Honey runway</span><span>${formatHospitalityRunway(hospitality.honeyRunwayDays)} daily surplus · ${MONASTERY_FEAST_HONEY} feast honey protected</span></li>
      <li><span>Wine runway</span><span>${formatHospitalityRunway(hospitality.wineRunwayDays)} daily surplus · ${MONASTERY_FEAST_WINE} feast wine protected</span></li>
      <li><span>Next feast</span><span>${nextFeast ? formatNextMonasteryFeast(nextFeast) : 'No observance scheduled'}</span></li>
      <li><span>Feast pantry</span><span>${feastReadiness ? formatMonasteryFeastReadiness(feastReadiness) : 'Unavailable'} · one complete batch protected from routine use</span></li>
      <li><span>Annual hospitality cost</span><span>${renderResourceCost({ food: hospitality.feastFoodPerYear, ale: hospitality.feastAlePerYear, honey: hospitality.honeyPerYear, wine: hospitality.winePerYear }, { compact: true, suffix: '/year' })}</span></li>
      <li><span>Pilgrimage income</span><span>${hospitality.pilgrimageGoldPerDay.toFixed(2)} gold/day at current stores · requires church and market road link · visitor gifts accrue here before collection</span></li>`
    : '';
  const monasteryTreasuryRows = building.kind === 'monastery'
    ? (() => {
        const level = normalizeMonasteryEstateLevel(building.chapelTier);
        const nextInvestment = monasteryEstateNextInvestmentCost(level);
        const privateGold = Math.max(0, building.gold - (building.civicReceiptsGold ?? 0));
        const yields = monasteryEstateYields(level);
        const infirmaryBeds = monasteryInfirmaryBeds(level);
        const infirmaryRecovery = monasteryInfirmaryRecoveryMultiplier(level);
        const infirmaryMortality = monasteryInfirmaryMortalityMultiplier(level);
        const seedTarget = monasterySeedArchiveTargetPerCrop(level);
        const scriptoriumRecovery = monasteryScriptoriumRecoveryMultiplier(level);
        const exportDutyRate = context.getFiscalPolicy?.().exportDutyRate
          ?? DEFAULT_FISCAL_POLICY.exportDutyRate;
        const levelLabel = ['Founding grange', 'Established demesne', 'Expanded estate', 'Prosperous abbey'][level];
        const incomingTithe = Array.from(context.gameState.deliveryTrips.values())
          .filter(
            (trip) =>
              trip.targetBuildingId === building.id
              && trip.cargoKind === 'gold'
              && trip.phase !== 'inbound',
          )
          .reduce((sum, trip) => sum + trip.amount, 0);
        return `<li><span>Reserved estate</span><span>68 × 53 m inside a complete perimeter fence · founded in the outer 60 m of the map</span></li>
          <li><span>Estate development</span><span>Level ${level}/3 · ${levelLabel}</span></li>
          <li><span>Internal economy</span><span>Apples ${yields.apples.toFixed(2)} · vegetables ${yields.vegetables.toFixed(2)} · eggs ${yields.eggs.toFixed(2)} · milk ${yields.milk.toFixed(2)} · meat ${yields.meat.toFixed(2)} · honey ${yields.honey.toFixed(2)} · ale ${yields.ale.toFixed(2)}${yields.cheese > 0 ? ` · cheese ${yields.cheese.toFixed(2)}` : ''} per cycle</span></li>
          <li><span>Regional estate exports</span><span>Automatic 6-unit lots · ${Math.round(exportDutyRate * 100)}% export duty is reserved for civic collection · net income remains here</span></li>
          <li><span>Infirmary</span><span>${infirmaryBeds} beds · shortest remedy runway admitted first · consumes ${MONASTERY_INFIRMARY_FOOD_PER_BED_DAY.toFixed(1)} estate food per occupied bed/day</span></li>
          <li><span>Skilled nursing</span><span>Up to ${Math.round((infirmaryRecovery - 1) * 100)}% faster illness recovery and ${Math.round((1 - infirmaryMortality) * 100)}% lower illness mortality · stacks with household remedies</span></li>
          <li><span>Agricultural archive</span><span>Rye ${Math.max(0, building.ryeGrain ?? 0).toFixed(1)} / ${seedTarget.toFixed(0)} · oats ${Math.max(0, building.oatGrain ?? 0).toFixed(1)} / ${seedTarget.toFixed(0)} · maslin ${Math.max(0, building.maslinGrain ?? 0).toFixed(1)} / ${seedTarget.toFixed(0)} emergency seed</span></li>
          <li><span>Emergency reseeding</span><span>Draws only farmstead/granary surplus · automatically sends physical seed carts to road-linked holdings that cannot cover their next sowing · the reserve can run out</span></li>
          <li><span>Scriptorium records</span><span>${Math.round((1 - scriptoriumRecovery) * 100)}% fewer timber, stone, fittings, and roof tiles for fire reconstruction within 520 m by road · requires a staffed church link · does not affect ordinary construction</span></li>
          <li><span>Monastery purse</span><span>${Math.round(building.gold)} gold secured here · ${privateGold.toFixed(1)} private estate gold${incomingTithe > 0.05 ? ` · ${Math.round(incomingTithe)} tithe incoming by handcart` : ''}</span></li>
          <li><span>Automatic reinvestment</span><span>${nextInvestment == null ? 'Estate fully developed' : `${privateGold.toFixed(1)} / ${nextInvestment + 6} gold · keeps a 6-gold working reserve`}</span></li>`;
      })()
    : '';
  const civicReceiptRows = building.kind === 'monastery'
    ? renderCivicReceiptRows(
        building,
        context,
        hospitality?.pilgrimageGoldPerDay ?? MONASTERY_PILGRIMAGE_GOLD_PER_DAY,
      )
    : '';
  const granaryGrainDispatch = building.kind === 'granary'
    ? context.worldQueries.getNextGranaryGrainDispatch(building)
    : null;
  const granaryGuardFoodDispatch = building.kind === 'granary' && context.conflictEnabled
    ? context.worldQueries.getNextGranaryGuardFoodDispatch(building)
    : null;
  const granaryInstitutionalFood = building.kind === 'granary'
    ? institutionalFoodSurplus(
        edibleFoodStock(building),
        context.worldQueries.getClaimedResidencesForFoodSupplier(building).length,
        buildingStorageCaps('granary').food ?? 0,
      )
    : 0;
  const granaryPreservationDispatch = building.kind === 'granary'
    ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'food')
    : null;
  const granaryPreservationDispatchLabel = building.kind === 'granary'
    ? granaryInstitutionalFood <= 1e-6
      ? edibleFoodStock(building) > 1e-6
        ? 'Household reserve holds current fresh food'
        : 'No fresh food available'
      : granaryPreservationDispatch
        ? granaryPreservationDispatch.duty === 'working-buffer'
          ? `${context.worldQueries.getBuildingLabel(granaryPreservationDispatch.target.kind)} · ${Math.round(preservableFoodStock(granaryPreservationDispatch.target))} / ${Math.ceil(granaryPreservationDispatch.desiredStock)} preservable food`
          : `${context.worldQueries.getBuildingLabel(granaryPreservationDispatch.target.kind)} · active buffers covered · nearest overflow route`
        : 'No smokehouse can currently receive fresh food'
    : '';
  const granaryExportableStock = building.kind === 'granary'
    ? granaryExportableGrain(
        breadGrainStock(building),
        building.granaryGrainReserve ?? 0,
      )
    : 0;
  const granaryFoodTargetPercent = building.kind === 'granary'
    ? normalizeGranaryFreshFoodTargetPercent(building.granaryFreshFoodTargetPercent)
    : 75;
  const granaryFoodTarget = building.kind === 'granary'
    ? granaryFreshFoodTarget(
        buildingStorageCaps('granary').food ?? 0,
        granaryFoodTargetPercent,
      )
    : 0;
  const granaryGrainDispatchLabel = building.kind === 'granary'
    ? granaryGrainDispatch
      ? `${context.worldQueries.getBuildingLabel(granaryGrainDispatch.target.kind)} · ${Math.round(Math.max(0, granaryGrainDispatch.target[granaryGrainDispatch.commodity] ?? 0))} / ${Math.ceil(granaryGrainDispatch.desiredStock)} ${granaryGrainDispatch.commodity.replace(/([A-Z])/g, ' $1').toLowerCase()} · ${granaryGrainDispatch.runwayCycles.toFixed(1)} cycles${
          granaryGrainDispatch.runwayCycles < GRAIN_CRITICAL_RUNWAY_CYCLES
            ? ' · critical, preempts food cart'
            : ' · after available food duty'
        }`
      : building.assignedLabor <= 0
        ? 'Waiting for an assigned granary hauler'
        : granaryExportableStock <= 1e-6
          ? breadGrainStock(building) > 1e-6
            ? 'Strategic floor holds current grain'
            : 'No exportable grain'
          : 'No staffed road-linked processor below buffer'
    : '';
  const granaryGuardFoodDispatchLabel = building.kind === 'granary' && context.conflictEnabled
    ? granaryGuardFoodDispatch
      ? `${context.worldQueries.getBuildingLabel(granaryGuardFoodDispatch.target.kind)} · ${Math.round(edibleFoodStock(granaryGuardFoodDispatch.target))} / ${Math.ceil(granaryGuardFoodDispatch.desiredStock)} · ${granaryGuardFoodDispatch.runwayDays.toFixed(1)} days`
      : building.assignedLabor <= 0
        ? 'Waiting for an assigned granary hauler'
        : granaryInstitutionalFood <= 1e-6
          ? edibleFoodStock(building) > 1e-6
            ? 'Household reserve holds current food'
            : 'No food available'
          : `No armed company below ${GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS}-day emergency floor`
    : '';
  const granaryMilitaryRows = building.kind === 'granary' && context.conflictEnabled
    ? `<li><span>Next guard cart</span><span>${granaryGuardFoodDispatchLabel}</span></li>
      <li><span>Emergency arbitration</span><span>Guard under ${GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS} days vs priority-selected processor under ${GRAIN_CRITICAL_RUNWAY_CYCLES} cycle · lower relative runway first</span></li>`
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
      <li><span>Central grain reserve</span><span>${granaryReserveLabel(building)}</span></li>
      <li><span>Seed exception</span><span>Linked farmsteads may draw through the floor; least-covered eligible holding goes first</span></li>
      <li><span>Next seed cart</span><span>${formatGranarySeedCart(granarySeedPlan, building, context)}</span></li>
      <li><span>Next grain cart</span><span>${granaryGrainDispatchLabel}</span></li>
      ${granaryMilitaryRows}
      <li><span>Fresh-food intake</span><span>${building.granaryAcceptsFreshFood === false ? `Local delivery only · ${granaryFoodTargetPercent}% target retained` : `Centralize to ${granaryFoodTargetPercent}% capacity · ${granaryFoodTarget.toFixed(0)} food`}</span></li>
      <li><span>Dispatch priority</span><span>${granaryDispatchPriorityLabel(building.granaryHouseholdsFirst === true)}</span></li>
      <li><span>Next preservation buffer</span><span>${granaryPreservationDispatchLabel}</span></li>
      <li><span>Household priority</span><span>Protect one market-allocation batch per claimed home · capped at 50% source storage</span></li>
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
  const routineFreshFoodSource = building.kind === 'apiary'
    || building.kind === 'vineyard';
  const routineFreshFoodClaims = routineFreshFoodSource
    ? context.worldQueries.getClaimedResidencesForFoodSupplier(building).length
    : 0;
  const routineFreshFoodCapacity = routineFreshFoodSource
    ? building.kind === 'apiary'
      ? buildingStorageCaps(building.kind).honey ?? 0
      : buildingStorageCaps(building.kind).food ?? 0
    : 0;
  const routinePolicyReserve = building.kind === 'apiary'
    ? apiaryHarvestPolicy(building.apiaryHarvestPolicy).reserve
    : building.kind === 'vineyard'
      ? vineyardProductionPolicy(building.vineyardProductionPolicy).reserve
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
  const vineyardParcel = building.kind === 'vineyard'
    ? context.gameState.vineyardParcels?.get(building.id) ?? null
    : null;
  const vineyardRows = building.kind === 'vineyard'
    ? (() => {
        const policy = vineyardProductionPolicy(building.vineyardProductionPolicy);
        const progress = Math.max(0, building.vineyardFermentationProgress ?? 0);
        const fermenting = Math.max(0, building.vineyardFermentingGrapes ?? 0);
        const cellarProgress = fermenting > 1e-6
          ? `${Math.min(100, progress / VINEYARD_FERMENTATION_SECONDS * 100).toFixed(0)}% · ${Math.max(0, VINEYARD_FERMENTATION_SECONDS - progress).toFixed(0)} worker-seconds remain`
          : 'Idle · awaiting one complete grape batch above the selected table reserve';
        const parcelRows = vineyardParcel ? (() => {
          const factors = vineyardSiteFactors(
            vineyardParcel.moisture,
            vineyardParcel.averageSlopeDegrees,
            vineyardParcel.southExposure,
            building.x,
            building.z,
          );
          const throughput = vineyardProductionMultiplier(vineyardParcel);
          return `<li><span>Growing parcel</span><span>${Math.round(vineyardParcel.area)} m² · ${vineyardParcel.averageSlopeDegrees.toFixed(1)}° average slope · ${Math.round(vineyardParcel.shapeEfficiency * 100)}% row efficiency</span></li>
            <li><span>Grape site</span><span>${Math.round(vineyardParcel.siteSuitability * 100)}% potential · ${Math.round(factors.drainage * 100)}% drainage · ${Math.round(factors.sun * 100)}% sun exposure</span></li>
            <li><span>Harvest pace</span><span>${throughput.toFixed(2)}× grape harvest during September–October</span></li>`;
        })() : '<li><span>Growing parcel</span><span>None drawn · use the vineyard layout action to place rows</span></li>';
        const reserve = Number.isFinite(policy.reserve)
          ? `${policy.reserve.toFixed(0)} table grapes protected`
          : 'All grapes protected for the table';
        return `${parcelRows}
          <li><span>Grape allocation</span><span>${policy.label} · ${reserve}</span></li>
          <li><span>Cellar batch</span><span>${VINEYARD_GRAPES_PER_FERMENTATION_BATCH} grapes → ${VINEYARD_WINE_PER_FERMENTATION_BATCH} wine over ${VINEYARD_FERMENTATION_SECONDS} worker-seconds</span></li>
          <li><span>Fermentation</span><span>${Math.round(fermenting)} grapes staged · ${cellarProgress}</span></li>`;
      })()
    : '';
  const apiaryRows = building.kind === 'apiary'
    ? (() => {
        const policy = apiaryHarvestPolicy(building.apiaryHarvestPolicy);
        const forage = Math.max(0, building.apiaryForageScore ?? 0.55);
        const health = Math.max(0, building.apiaryColonyHealth ?? 1);
        return `<li><span>Harvest policy</span><span>${policy.label} · ${policy.reserve.toFixed(0)} honey protected · ${Math.round(policy.yieldMultiplier * 100)}% harvest pace</span></li>
          <li><span>Forage landscape</span><span>${Math.round(forage * 100)}% · mature woodland, orchards, flower gardens, and vineyard rows inside bee range</span></li>
          <li><span>Colony health</span><span>${Math.round(health * 100)}% · winter check needs ${APIARY_WINTER_HONEY_REQUIRED} honey</span></li>
          <li><span>Pollination</span><span>Healthy nearby hives can raise orchard and vineyard output by up to ${Math.round(APIARY_POLLINATION_BONUS_MAX * 100)}%</span></li>`;
      })()
    : '';
  const buildingPolicyPanelHtml = building.kind === 'monastery'
    ? renderMonasteryPolicyPanel(context)
    : building.kind === 'threshing_barn'
      ? renderFarmsteadFieldPanel(building)
      : building.kind === 'granary'
        ? renderGranaryPolicyPanel(building)
        : building.kind === 'carpenter'
          ? renderCarpenterPolicyPanel(building, context.conflictEnabled === true)
          : building.kind === 'apiary'
            ? renderApiaryHarvestPolicyPanel(building)
            : building.kind === 'vineyard'
              ? renderVineyardProductionPolicyPanel(building)
              : undefined;
  const processorPolicyPanelHtml = renderProcessorOutputTargetPanel(building);
  const extractionPolicyPanelHtml = building.kind === 'clay_pit'
    ? renderExtractionStockTargetPanel(building, 'clay')
    : null;
  const supplementalPanelHtml = `${buildingPolicyPanelHtml ?? ''}${processorPolicyPanelHtml ?? ''}${extractionPolicyPanelHtml ?? ''}`
    || undefined;
  const role = building.kind === 'carpenter' && !context.conflictEnabled
    ? 'Timber framing and cartwright support for road-linked building sites'
    : PROCESS[building.kind] ?? 'Settlement service';
  const carpenterSupportRows = building.kind === 'carpenter'
    ? `<li><span>Construction timber</span><span>${Math.round((1 - CARPENTER_TIMBER_COST_MULTIPLIER) * 100)}% less at road-linked sites</span></li>
      <li><span>Cart travel</span><span>${Math.round((CARPENTER_DELIVERY_SPEED_MULTIPLIER - 1) * 100)}% faster from linked origins while a repair kit is available · base speed otherwise</span></li>
      <li><span>Repair kit cost</span><span>${renderResourceCost({ timber: CARPENTER_CART_SERVICE_TIMBER_PER_TRIP, ironwork: CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP }, { compact: true, suffix: 'per accelerated departure' })}</span></li>
      <li><span>Service buffer</span><span>${Math.round(building.timber)} / ${Math.ceil(carpenterServiceTimberTarget)} protected timber · ${Math.round(building.ironwork ?? 0)} / ${Math.ceil(carpenterServiceIronworkTarget)} protected ironwork · ${carpenterServiceTrips} / ${carpenterServiceTargetTrips} departures ready</span></li>
      <li><span>Support state</span><span>${building.assignedLabor > 0 ? 'Skilled construction active across this road network' : 'Inactive — requires at least 1 craftsperson'}</span></li>
      ${armory ? `<li><span>Armory reserve</span><span>${armory.reserve <= 0 ? `${armory.stock.toFixed(0)} stored · production paused` : `${armory.stock.toFixed(0)} / ${armory.reserve} polearms`}</span></li>
      <li><span>Inputs to target</span><span>${armory.shortfall <= 0 ? 'Reserve stocked' : renderResourceCost({ timber: armory.timberToTarget, ironwork: armory.ironworkToTarget }, { compact: true })}</span></li>
      <li><span>Company issue</span><span>One polearm per assigned guard · surplus remains here</span></li>` : ''}`
    : '';
  const frontierStockVisible = building.kind !== 'carpenter' || context.conflictEnabled === true;
  return {
    eyebrow: 'Settlement building',
    title: definition.label,
    statusText: carpenterStatus?.statusText ?? seasonalProcessorStatus?.statusText ?? processorStatus?.statusText ?? farmsteadPlanning?.statusText ?? (fallbackActive ? 'Operating' : 'Awaiting workers'),
    statusState: carpenterStatus?.statusState ?? seasonalProcessorStatus?.statusState ?? processorStatus?.statusState ?? farmsteadPlanning?.statusState ?? (fallbackActive ? 'active' : 'warning'),
    detailsHtml: `<li><span>Role</span><span>${role}</span></li>${carpenterSupportRows}${building.kind === 'carpenter' && context.conflictEnabled ? `<li><span>Polearm batch cost</span><span>${renderResourceCost({ timber: CARPENTER_TIMBER_PER_POLEARM, ironwork: CARPENTER_IRONWORK_PER_POLEARM }, { compact: true, suffix: 'for 1 polearm' })}</span></li>` : ''}${granaryRows}${grainProcessorRows}${millPowerRows}${apiaryRows}${vineyardRows}${clayBankRows}${charcoalClampRows}${institutionalFoodRows}${monasteryHospitalityRows}${monasteryTreasuryRows}${civicReceiptRows}${farmsteadPlanning?.rows ?? ''}${processorStatus?.waterDetailHtml ?? ''}${civilianToolRows(building, context.worldQueries)}${preservedStorageRows}${buildingStorageRows(building, building.kind, frontierStockVisible)}${buildingRoadAccessRow(context.worldQueries, building)}${buildingExtentRow(building.kind)}${logisticsRows}`,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    ...(supplementalPanelHtml ? { supplementalPanelHtml } : {}),
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
    <li><span>Shared farm labor</span><span>One ${onsiteLabor}-worker budget · harvesting always first · field and threshing work never double-count the crew</span></li>
    <li><span>Crew-sharing queue</span><span>${sharedPriorityFields.length > 0 ? `${sharedPriorityFields.length} nearby High/Urgent field${sharedPriorityFields.length === 1 ? '' : 's'} may claim this crew ahead of lower-priority linked work` : 'No neighboring High/Urgent fields requesting help'} · seed, manure, and harvest remain at each field’s linked farm</span></li>
    <li><span>Ox-supported fields</span><span>${plan.cattleSupportedFields} / ${plan.activeFields} active · labor forecast includes faster ploughing</span></li>
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
  const householdsFirst = building.granaryHouseholdsFirst === true;
  const grainReserve = normalizeGranaryGrainReserve(building.granaryGrainReserve ?? 0);
  const freshFoodTargetPercent = normalizeGranaryFreshFoodTargetPercent(
    building.granaryFreshFoodTargetPercent,
  );
  const freshFoodTarget = granaryFreshFoodTarget(
    buildingStorageCaps('granary').food ?? 0,
    freshFoodTargetPercent,
  );
  const priorityHint = householdsFirst
    ? 'Household-first stocks fresh and cured Marketplace stalls before the granary falls through to the highest-priority smokehouse working buffer.'
    : 'Preservation-first restores the highest-priority smokehouse fresh-food buffer before stocking fresh and cured Marketplace stalls.';
  return `
    <div class="inspector-action-panel">
      <p class="inspector-action-panel__hint">Centralizing perishables shelters fresh food. Each assigned granary worker can set up one fresh-food or preserved-food table at one nearest connected Marketplace; an unstocked worker stands by to accept the first compatible producer delivery. Ale is hauled to staffed Taverns instead. Those keepers also haul physical institutional routes, but never cart routine provisions from a stall to individual homes. Fresh-food surplus carts still serve critical guards, smokehouse working batches, routine company reserves, and enabled granaries.</p>
      <label class="city-admin-panel__toggle"><input type="checkbox" data-granary-accepts-fresh-food ${building.granaryAcceptsFreshFood === false ? '' : 'checked'} /><span>Collect fresh and cured surplus</span></label>
      <label class="city-admin-panel__toggle"><input type="checkbox" data-granary-households-first ${householdsFirst ? 'checked' : ''} /><span>Feed households before smokehouses</span></label>
      <p class="inspector-action-panel__hint">${priorityHint}</p>
      <p class="resource-inspector-note">Fresh-food intake target — lower settings reduce collection-cart pressure and keep stock near its source territory; higher settings shelter more food from spoilage for winter and preservation.</p>
      <div class="resource-action-row">${GRANARY_FRESH_FOOD_TARGET_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-granary-fresh-food-target="${preset.percent}" title="${preset.hint}" ${freshFoodTargetPercent === preset.percent ? 'disabled' : ''}>${preset.label} · ${preset.percent}%</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">Current target ${freshFoodTarget.toFixed(0)} food. Intake stops at this level, but Marketplace-stall, smokehouse, and guard carts may continue drawing stock.</p>
      <p class="resource-inspector-note">Strategic grain floor — mills, monasteries, and foreign sales cannot draw below it. Linked farmsteads may still take this grain when they need seed. Brewing barley has its own physical reserve.</p>
      <div class="resource-action-row">${GRANARY_GRAIN_RESERVE_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-granary-grain-reserve="${preset.reserve}" ${grainReserve === preset.reserve ? 'disabled' : ''}>${preset.label} · ${preset.reserve}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">A staffed granary collects fresh stock above local market reserves until its selected target. Sources with no dependent market branch can release their whole surplus. Cured provisions retain best in their smokehouse loft; granary cured storage is still safer than leaving fresh goods exposed. When perishable collection is enabled, cured provisions use separate capacity; disabling it stops new cured intake but assigned granary haulers may still stock Marketplace stalls from goods already here. Baking happens only at a staffed bakery.</p>
    </div>
  `;
}

export function renderProcessorOutputTargetPanel(building: BuildingState): string | null {
  if (!isProcessorOutputTargetKind(building.kind)) return null;
  const percent = normalizeProcessorOutputTargetPercent(
    building.processorOutputTargetPercent,
  );
  const output = processorOutputCommodityForBuilding(building)
    ?? processorOutputCommodity(building.kind);
  const stagingCycles = processorInputStagingCycles(percent);
  const stagingLabel = `${stagingCycles} input ${stagingCycles === 1 ? 'cycle' : 'cycles'}`;
  const label = output === 'preservedFood' ? 'preserved staples' : output;
  const stock = output === 'flour'
    ? flourStock(building)
    : output === 'bread'
      ? breadStock(building)
      : Math.max(0, building[output] ?? 0);
  const target = processorOutputTargetForBuilding(building) ?? 0;
  const headroom = processorOutputHeadroom(building) ?? 0;
  const pressure = headroom > 0.05
    ? `${headroom.toFixed(0)} production headroom`
    : stock > target + 0.05
      ? `${(stock - target).toFixed(0)} above target · still available`
      : 'Production paused at target';
  const breweryRecipePolicy = building.kind === 'brewery'
    ? (() => {
        const configured = normalizeBreweryRecipePolicy(building.breweryRecipePolicy);
        const selected = selectedBreweryRecipePolicy(configured, building);
        const active = configured === BREWERY_RECIPE_AUTO
          ? `Auto currently selects ${breweryRecipePolicyLabel(selected)} from on-site stocks.`
          : `${breweryRecipePolicyLabel(configured)} is the only recipe accepting new inputs.`;
        return `
          <p class="resource-inspector-note">Active recipe · choose which raw material this Brewery accepts and converts.</p>
          <div class="resource-action-row">${BREWERY_RECIPE_PRESETS
            .map((preset) => {
              const output = breweryPolicyOutput(preset.policy);
              const icon = output === 'cider'
                ? renderResourceCost({ cider: 1 }, { compact: true })
                : output === 'mead'
                  ? renderResourceCost({ mead: 1 }, { compact: true })
                  : renderResourceCost({ ale: 1 }, { compact: true });
              return `<button type="button" class="resource-action-button" data-brewery-recipe-policy="${preset.policy}" title="${preset.hint}" ${configured === preset.policy ? 'disabled' : ''}>${preset.label} · ${icon}</button>`;
            })
            .join('')}</div>
          <p class="inspector-action-panel__hint">${active} Cider uses 4 apples for 1 cider; mead uses 1 honey for 1 mead. Ale, cider, and mead are all hauled to a staffed Tavern and fulfill the same Beverage requirement.</p>
        `;
      })()
    : '';
  const weaverInputPolicy = building.kind === 'weaver'
    ? `
      <p class="resource-inspector-note">Fibre preference · steers matching raw-fibre carts between active looms, then decides which complete onsite recipe is consumed first.</p>
      <div class="resource-action-row">${WEAVER_INPUT_POLICY_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-weaver-input-policy="${preset.policy}" title="${preset.hint}" ${normalizeWeaverInputPolicy(building.weaverInputPolicy) === preset.policy ? 'disabled' : ''}>${preset.label}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">Matching specialization wins a contested working-buffer cart; Auto forms the neutral middle pool. The same order governs scarce well water once flax is physically staged. Covered buffers and ready alternate recipes remain fallbacks so neither carts nor crews deadlock. Wool avoids a water haul; flax turns planned field fibre and well capacity into cloth while preserving annual fleece.</p>
    `
    : '';
  const potteryDispatchPolicy = building.kind === 'potter_kiln'
    ? `
      <p class="resource-inspector-note">Cart priority · chooses which local pottery shortage gets this kiln's one physical cart first.</p>
      <div class="resource-action-row">${POTTERY_DISPATCH_POLICY_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-pottery-dispatch-policy="${preset.policy}" title="${preset.hint}" ${normalizePotteryDispatchPolicy(building.potteryDispatchPolicy) === preset.policy ? 'disabled' : ''}>${preset.label}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">Market-wares-first lets staffed storehouse workers collect pottery for household stalls before smokehouse packing stock. Preservation-first stages the smokehouse working buffer with the lowest runway before storehouse collection. Either order immediately falls through when its first duty has no reachable shortage, and Trading Post export always waits until both local duties are covered.</p>
    `
    : '';
  const potterFiringPolicy = building.kind === 'potter_kiln'
    ? `
      <p class="resource-inspector-note">Firing order · one kiln output at a time. Changing it never converts stock already fired.</p>
      <div class="resource-action-row">${POTTER_FIRING_POLICY_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-potter-firing-policy="${preset.policy}" title="${preset.hint}" ${normalizePotterFiringPolicy(building.potterFiringPolicy) === preset.policy ? 'disabled' : ''}>${preset.label}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">${normalizePotterFiringPolicy(building.potterFiringPolicy) === POTTER_FIRE_ROOF_TILES
        ? 'Tile firing suspends new market and smokehouse vessel output. Existing vessels still dispatch; fired tiles remain stacked here until a tier-4 residence commissions a road-hauled roof project.'
        : 'Vessel firing serves household breakage, preserving crocks, then export. Commissioned roof projects wait until this or another linked kiln fires enough physical tiles.'}</p>
    `
    : '';
  return `
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Stock policy · stages ${stagingLabel} · finished ${label} ${stock.toFixed(0)} / ${target.toFixed(0)} · ${pressure}</p>
      <div class="resource-action-row">${PROCESSOR_OUTPUT_TARGET_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-processor-output-target="${preset.percent}" title="${preset.hint}" ${percent === preset.percent ? 'disabled' : ''}>${preset.label} · ${preset.percent}%</button>`)
        .join('')}</div>
      ${weaverInputPolicy}
      ${breweryRecipePolicy}
      ${potterFiringPolicy}
      ${potteryDispatchPolicy}
      <p class="inspector-action-panel__hint">This policy sets both the on-site input staging depth and the finished-goods ceiling. Routine input top-ups stop at the staged-cycle target; a producer may still use the workshop as last-resort overflow when normal storage cannot receive its cargo. Finished-goods deliveries may draw below the ceiling and restart work. It is not a protected reserve, and a cart already on the road may still arrive after you lower it.</p>
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
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Cart-service depth — protected working capital for accelerated departures.</p>
      <div class="resource-action-row">${CARPENTER_CART_SERVICE_TARGET_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-carpenter-cart-service-target="${preset.trips}" title="${preset.hint}" ${serviceTarget === preset.trips ? 'disabled' : ''}>${preset.label} · ${preset.trips}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">${serviceTarget <= 0
        ? 'Conserve fittings keeps the road-linked construction timber discount but stops repair-kit procurement and the cart-speed bonus. Existing timber and ironwork become available to construction and weapon crafting.'
        : `This shop protects ${renderResourceCost({ timber: serviceTimberTarget, ironwork: serviceIronworkTarget }, { compact: true, suffix: `for ${serviceTarget} departures` })}. Every accelerated departure consumes ${renderResourceCost({ timber: CARPENTER_CART_SERVICE_TIMBER_PER_TRIP, ironwork: CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP }, { compact: true })}; lowering the target immediately releases surplus stock.`}</p>
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
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Threshing priority — the same onsite crew works fields and converts stored sheaves into typed grain. A ready harvest always pre-empts threshing.</p>
      <div class="resource-action-row">${THRESHING_PRIORITY_PRESETS
        .map((preset) => `<button type="button" class="resource-action-button" data-threshing-priority="${preset.priority}" title="${preset.hint}" ${threshingPriority === preset.priority ? 'disabled' : ''}>${preset.label}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">Automatic restores linked-field seed and one dispatch load after High/Urgent fieldwork but before Normal fieldwork. Fields first leaves threshing until field jobs are quiet; Thresh first pre-empts every non-harvest field job.</p>
      <p class="inspector-action-panel__hint">Lay out cultivated land for this farmstead. Linked fields always enter its queue; nearby High/Urgent fields may also request this crew when they fall inside its work radius.</p>
      <div class="resource-action-row">
        <button type="button" class="resource-action-button" data-land-parcel="field">Lay out farm field</button>
      </div>
    </div>
  `;
}

function renderApiaryHarvestPolicyPanel(building: BuildingState): string {
  const selected = apiaryHarvestPolicy(building.apiaryHarvestPolicy);
  return `
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Honey harvest · choose how much winter food the beekeepers protect and how aggressively they work the hives.</p>
      <div class="resource-action-row">${APIARY_HARVEST_POLICIES
        .map((policy) => `<button type="button" class="resource-action-button" data-apiary-harvest-policy="${policy.value}" title="${policy.hint}" ${selected.value === policy.value ? 'disabled' : ''}>${policy.label} · ${policy.reserve} reserve · ${Math.round(policy.yieldMultiplier * 100)}%</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">The reserve is protected from town-processing and export carts. In winter the colony consumes up to ${APIARY_WINTER_HONEY_REQUIRED} honey; a shortfall damages next season's colony health. Forage and health multiply the selected harvest pace, while nearby healthy hives provide bounded pollination.</p>
    </div>
  `;
}

function renderVineyardProductionPolicyPanel(building: BuildingState): string {
  const selected = vineyardProductionPolicy(building.vineyardProductionPolicy);
  return `
    <div class="inspector-action-panel">
      <p class="resource-inspector-note">Grape allocation · the harvest always enters storage as real grapes. The selected reserve is protected before any new cellar batch begins.</p>
      <div class="resource-action-row">${VINEYARD_PRODUCTION_POLICIES
        .map((policy) => `<button type="button" class="resource-action-button" data-vineyard-production-policy="${policy.value}" title="${policy.hint}" ${selected.value === policy.value ? 'disabled' : ''}>${policy.label}${Number.isFinite(policy.reserve) ? ` · ${policy.reserve} reserve` : ''}</button>`)
        .join('')}</div>
      <p class="inspector-action-panel__hint">A staffed cellar withdraws ${VINEYARD_GRAPES_PER_FERMENTATION_BATCH} grapes above the reserve, works for ${VINEYARD_FERMENTATION_SECONDS} seconds, then deposits ${VINEYARD_WINE_PER_FERMENTATION_BATCH} wine if storage has room. Changing policy never converts grapes or wine instantly.</p>
    </div>
  `;
}

function renderMonasteryPolicyPanel(context: InspectorRenderContext): string {
  const policy = context.getMonasteryPolicy?.() ?? DEFAULT_MONASTERY_POLICY;
  const feastBatchCost = renderResourceCost({
    food: MONASTERY_FEAST_FOOD,
    ale: MONASTERY_FEAST_ALE,
    honey: MONASTERY_FEAST_HONEY,
    wine: MONASTERY_FEAST_WINE,
  }, { compact: true, suffix: 'per feast' });
  const dailyHospitalityCost = renderResourceCost({
    honey: MONASTERY_HOSPITALITY_HONEY_PER_DAY,
    wine: MONASTERY_HOSPITALITY_WINE_PER_DAY,
  }, { compact: true, suffix: '/day' });
  return `
    <div class="inspector-action-panel">
      <p class="inspector-action-panel__hint">The monastery is an enclosed frontier estate, not a second church. Its orchards, gardens, animals, hives, dairy, and brewhouse produce autonomously; protected surplus is sold directly to regional merchants, export duty is collected on the returned gold, and the net automatically expands the demesne through three visible levels. Its finite infirmary supplies skilled nursing above ordinary herb treatment. The agricultural archive holds exhaustible seed for failed sowing seasons, while the scriptorium preserves plans and ledgers that lower fire-reconstruction material costs.</p>
      <label class="city-admin-panel__toggle"><input type="checkbox" data-policy-monastery-feasts ${policy.feastsEnabled ? 'checked' : ''} /><span>Provision hospitality and feast days</span></label>
      <p class="inspector-action-panel__hint">Enabled monasteries protect ${feastBatchCost} from their own estate production; no town producer refills the pantry. Daily hospitality and estate exports use only stock above those protected floors. On each observance, covered households walk here by road and consume the complete batch onsite: immediate food and ale deficits are relieved, but no provisions appear in home pantries. Daily hospitality consumes ${dailyHospitalityCost}, raising linked pilgrimage income from ${MONASTERY_PILGRIMAGE_GOLD_PER_DAY.toFixed(1)} to as much as ${(MONASTERY_PILGRIMAGE_GOLD_PER_DAY + MONASTERY_HOSPITALITY_BONUS_GOLD_PER_DAY).toFixed(1)} gold per day. Routine alms and poor-relief carts remain the church's role; the monastery contributes a common table and scarce infirmary beds.</p>
      <label class="city-admin-panel__slider-label"><span>Parish tithe share</span><strong data-policy-monastery-tithe-value>${Math.round(policy.titheShare * 100)}%</strong></label>
      <input class="city-admin-panel__slider" type="range" data-policy-monastery-tithe min="0" max="80" step="5" value="${Math.round(policy.titheShare * 100)}" />
      <div class="city-admin-panel__range-hints"><span>Church keeps all</span><span>Monastery-led</span></div>
      <p class="inspector-action-panel__hint">Lifetime: ${formatMonasteryTithePaidTotal(policy.tithePaidTotal)} · ${formatMonasteryPilgrimageTotal(policy.pilgrimageGoldTotal)} · ${formatMonasteryFoodCharityTotal(policy.foodCharityTotal)}</p>
    </div>
  `;
}
