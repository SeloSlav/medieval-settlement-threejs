import {
  BREWERY_ALE_PER_CYCLE,
  BREWERY_FRUIT_PER_CIDER_CYCLE,
  BREWERY_BARLEY_PER_MALT_CYCLE,
  BREWERY_BREWING_FIREWOOD_PER_CYCLE,
  BREWERY_BREWING_WATER_PER_CYCLE,
  BREWERY_MALT_PER_CYCLE,
  BREWERY_MALTING_FIREWOOD_PER_CYCLE,
  BREWERY_MALTING_WATER_PER_CYCLE,
  BREWERY_CIDER_PER_CYCLE,
  BREWERY_HONEY_PER_MEAD_CYCLE,
  BREWERY_MEAD_PER_CYCLE,
  BUILDING_STORAGE_CAPS,
  CALENDAR_SECONDS_PER_DAY,
  CHARCOAL_BURNER_CHARCOAL_PER_CYCLE,
  CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
  MILL_WATER_PER_HARVEST,
  MIN_DELIVERY_TRIP_SEC,
  RICH_MINE_THROUGHPUT_MULTIPLIER,
  FARM_TOOL_IRONWORK_PER_WORKER_DAY,
  BAKERY_FIREWOOD_PER_CYCLE,
  BAKERY_FLOUR_PER_CYCLE,
  BAKERY_RYE_BREAD_PER_CYCLE,
  BAKERY_MASLIN_BREAD_PER_CYCLE,
  BAKERY_WATER_PER_CYCLE,
  POTTER_CLAY_PER_CYCLE,
  POTTER_FIREWOOD_PER_CYCLE,
  POTTER_POTTERY_PER_CYCLE,
  POTTER_ROOF_TILES_PER_CYCLE,
  POTTER_WATER_PER_CYCLE,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_SHOES_PER_PERSON_PER_SEC,
  RESIDENCE_POTTERY_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  SMOKEHOUSE_POTTERY_PER_CYCLE,
  SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
  SMOKEHOUSE_SALT_PER_CYCLE,
  SMITHY_CHARCOAL_PER_CYCLE,
  SMITHY_IRONWORK_PER_CYCLE,
  SMITHY_IRON_PER_CYCLE,
  SMITHY_WATER_PER_CYCLE,
  TIMBER_DELIVERY_SPEED_MPS,
  TIMBER_DELIVERY_UNLOAD_SEC,
  WATERMILL_RYE_FLOUR_PER_CYCLE,
  WATERMILL_MASLIN_FLOUR_PER_CYCLE,
  WATERMILL_GRAIN_PER_CYCLE,
  SPINNING_RETTING_WOOL_PER_CYCLE,
  SPINNING_RETTING_FLAX_PER_CYCLE,
  SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
  SPINNING_RETTING_YARN_PER_CYCLE,
  SPINNING_RETTING_LINEN_PER_CYCLE,
  WEAVER_CLOTH_PER_CYCLE,
  WEAVER_YARN_PER_CYCLE,
  WEAVER_LINEN_PER_CYCLE,
  TANNERY_HIDES_PER_CYCLE,
  TANNERY_WATER_PER_CYCLE,
  TANNERY_FIREWOOD_PER_CYCLE,
  TANNERY_LEATHER_PER_CYCLE,
  COBBLER_LEATHER_PER_CYCLE,
  COBBLER_SHOES_PER_CYCLE,
} from '../generated/gameBalance.ts';
import { averageProductiveCalendarDayShare } from '../world/holidayCalendar.ts';
import {
  rosteredCartWorkersByBuilding,
  tripDeliveryRemainingSeconds,
  type DeliveryCargoKind,
  type DeliveryTripState,
} from '../logistics/deliveryTrips.ts';
import {
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
} from '../fires/fireIncident.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import { lodgeSustainedProcessingLabor } from '../logistics/lodgeLogistics.ts';
import { fieldStageAllowed } from '../farming/farmWorkPlanning.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type {
  BuildingKind,
  BuildingState,
  GameState,
  ResidenceState,
  ResourceNodeState,
} from '../resources/types.ts';
import {
  normalizeProcessorOutputTargetPercent,
  processorOutputTargetForBuilding,
} from './processorOutputPolicy.ts';
import {
  BREWERY_RECIPE_CIDER,
  BREWERY_RECIPE_MEAD,
  BREWERY_RECIPE_PEAR_CIDER,
  selectedBreweryRecipePolicy,
} from './breweryRecipePolicy.ts';
import {
  MILLABLE_GRAIN_KINDS,
  BAKEABLE_FLOUR_KINDS,
  bakeableFlourStock,
  breadStock,
  flourStock,
  millableGrainStock,
} from './cropGoods.ts';
import {
  normalizePotterFiringPolicy,
  POTTER_FIRE_ROOF_TILES,
} from './potterFiringPolicy.ts';
import {
  civilianToolsMaintained,
  civilianToolReorderStock,
  civilianToolThroughputMultiplier,
  farmToolsMaintained,
  isCivilianToolSite,
} from './civilianToolPolicy.ts';
import {
  miningPitOutputPerDay,
  miningPitSurfaceDeposit,
  mineralDepositBeneath,
  mineralMineOutputPerDay,
} from './settlementGeology.ts';
import { normalizeMarketplaceIronTarget } from './marketplaceMaterialProcurementPolicy.ts';
import { weaverUsesFlax, weaverUsesLinen } from './weaverInputPolicy.ts';
import { largeQuarrySupportsReady } from './largeQuarrySupportPolicy.ts';
import { richMineSupportsReady } from './mineSupportPolicy.ts';
import { preservableFoodStock, preservedFoodStock } from './foodInventory.ts';
import { windSiteThroughputMultiplier } from '../wind/windField.ts';

export type SettlementProductionCapacity = {
  capacityDaysPerWeek: number;
  watermillThroughputMultiplier: number;
  windmillWeatherThroughputMultiplier: number;
  surfaceClayThroughputMultiplier: number;
  charcoalBurnerThroughputMultiplier: number;
  fireDisabledProcessorSites: number;
  fireDisabledProcessorWorkers: number;
  firstFireDisabledProcessorId: string | null;
  millWorkers: number;
  bakeryWorkers: number;
  breweryWorkers: number;
  smokehouseWorkers: number;
  spinnerWorkers: number;
  weaverWorkers: number;
  tanneryWorkers: number;
  cobblerWorkers: number;
  millInputBuffer: ProcessorInputBuffer | null;
  bakeryInputBuffer: ProcessorInputBuffer | null;
  breweryInputBuffer: ProcessorInputBuffer | null;
  smokehouseInputBuffer: ProcessorInputBuffer | null;
  spinnerInputBuffer: ProcessorInputBuffer | null;
  weaverInputBuffer: ProcessorInputBuffer | null;
  tanneryInputBuffer: ProcessorInputBuffer | null;
  cobblerInputBuffer: ProcessorInputBuffer | null;
  charcoalInputBuffer: ProcessorInputBuffer | null;
  smithyInputBuffer: ProcessorInputBuffer | null;
  potterInputBuffer: ProcessorInputBuffer | null;
  millOutputRoom: ProcessorOutputRoom | null;
  bakeryOutputRoom: ProcessorOutputRoom | null;
  breweryOutputRoom: ProcessorOutputRoom | null;
  smokehouseOutputRoom: ProcessorOutputRoom | null;
  spinnerOutputRoom: ProcessorOutputRoom | null;
  weaverOutputRoom: ProcessorOutputRoom | null;
  tanneryOutputRoom: ProcessorOutputRoom | null;
  cobblerOutputRoom: ProcessorOutputRoom | null;
  charcoalOutputRoom: ProcessorOutputRoom | null;
  smithyOutputRoom: ProcessorOutputRoom | null;
  potterOutputRoom: ProcessorOutputRoom | null;
  flourOutputPerDay: number;
  bakeryFlourCapacityPerDay: number;
  breadFoodCapacityPerDay: number;
  grainChainRoads: GrainChainRoadPlan;
  grainRoadBranches: ReadonlyMap<string, ProductionGrainRoadBranch> | null;
  breadGrainPerDay: number;
  breadWaterPerDay: number;
  breadFirewoodPerDay: number;
  aleOutputPerDay: number;
  aleBarleyPerDay: number;
  aleWaterPerDay: number;
  aleFirewoodPerDay: number;
  preservedFoodOutputPerDay: number;
  preservationFreshFoodPerDay: number;
  preservationFirewoodPerDay: number;
  preservationSaltPerDay: number;
  preservationPotteryPerDay: number;
  spinnerIntermediateCapacityPerDay: number;
  weaverClothCapacityPerDay: number;
  yarnOutputPerDay: number;
  linenOutputPerDay: number;
  clothOutputPerDay: number;
  clothYarnPerDay: number;
  clothLinenPerDay: number;
  clothWoolPerDay: number;
  clothFlaxPerDay: number;
  clothFlaxWaterPerDay: number;
  leatherOutputPerDay: number;
  leatherHidesPerDay: number;
  leatherWaterPerDay: number;
  leatherFirewoodPerDay: number;
  shoesOutputPerDay: number;
  shoesLeatherPerDay: number;
  industrialMaterials: IndustrialMaterialPlan;
  tierTwoPlusResidents: number;
  tierThreePlusResidents: number;
  tierFourResidents: number;
  fireDisabledTierFourHomes: number;
  fireDisabledTierFourResidents: number;
  fireDisabledTierFourHousingCapacity: number;
  aleDemandPerDay: number;
  /** Winter-peak design demand used by long-term prosperity capacity. */
  preservedFoodDemandPerDay: number;
  currentPreservedFoodDemandPerDay: number;
  currentPreservedFoodDemandMultiplier: number;
  clothDemandPerDay: number;
  shoesDemandPerDay: number;
  potteryOutputPerDay: number;
  potteryDemandPerDay: number;
  prosperityRoadBranches: ReadonlyMap<string, ProsperityRoadBranch> | null;
};

export type ProcessorInput =
  | 'barley'
  | 'apples'
  | 'pears'
  | 'honey'
  | 'grain'
  | 'flour'
  | 'water'
  | 'firewood'
  | 'fresh food'
  | 'iron'
  | 'charcoal'
  | 'clay'
  | 'salt'
  | 'pottery'
  | 'wool'
  | 'flax'
  | 'yarn'
  | 'linen'
  | 'hides'
  | 'leather';

export type ProcessorInputBuffer = {
  days: number;
  onsiteDays: number;
  limitingInput: ProcessorInput;
  buildingId: string;
  inTransitAmount: number;
  inTransitTrips: number;
  nextDeliverySeconds: number | null;
  deliveryGap: boolean;
};

export type ProcessorOutputRoom = {
  days: number;
  buildingId: string;
  targetPercent: number;
};

export type GrainChainRoadPlan = {
  activeBranches: number;
  matchedBranches: number;
  millOnlyBranches: number;
  bakeryOnlyBranches: number;
  hypotheticalFoodPerDay: number;
  fragmentationFoodPerDay: number;
  firstImbalancedBuildingId: string | null;
};

export type IndustrialMaterialPlan = {
  activeRoadBranches: number;
  potteryMatchedBranches: number;
  potteryBlockedBranches: number;
  smithyMatchedBranches: number;
  smithyBlockedBranches: number;
  clayWorkers: number;
  potterWorkers: number;
  charcoalWorkers: number;
  smithyWorkers: number;
  toolEligibleSites: number;
  toolMaintainedSites: number;
  clayOutputPerDay: number;
  potterInstalledOutputPerDay: number;
  potteryOutputPerDay: number;
  potterInstalledRoofTilesPerDay: number;
  roofTilesOutputPerDay: number;
  potteryDemandPerDay: number;
  potteryCoveredDemandPerDay: number;
  potteryShortfallPerDay: number;
  potteryExportSurplusPerDay: number;
  potteryStrandedPerDay: number;
  potterClayPerDay: number;
  potterFirewoodPerDay: number;
  potterWaterPerDay: number;
  charcoalOutputPerDay: number;
  charcoalFirewoodPerDay: number;
  smithyInstalledIronworkPerDay: number;
  ironworkOutputPerDay: number;
  localIronOutputPerDay: number;
  localIronConsumedPerDay: number;
  ironImportDemandPerDay: number;
  ironImportUncoveredPerDay: number;
  ironImportEnabledBranches: number;
  ironImportBlockedBranches: number;
  standingIronImportMarkets: number;
  selectedIronReserve: number;
  ironImportCofferGold: number;
  localIronStrandedPerDay: number;
  smithyIronPerDay: number;
  smithyCharcoalPerDay: number;
  smithyWaterPerDay: number;
  maintainedToolIronworkPerDay: number;
  fullToolIronworkPerDay: number;
  roadCoveredToolIronworkPerDay: number;
  roadCoveredFullToolIronworkPerDay: number;
  toolDeliveryCapacityPerDay: number;
  sustainableToolIronworkPerDay: number;
  sustainableToolUptime: number;
  toolCartWorkerDaysPerDay: number;
  toolRefillLoad: number;
  toolUnreachableSites: number;
  /** Smithy output left after cart labor. Future maintenance is separate demand. */
  ironworkProducedSurplusPerDay: number;
  firstPotteryBottleneckId: string | null;
  firstPotteryBottleneckResidenceId: string | null;
  firstSmithyBottleneckId: string | null;
  firstIronImportMarketId: string | null;
  firstIronImportAttentionId: string | null;
  firstUnmaintainedToolSiteId: string | null;
  firstToolDeliveryBottleneckId: string | null;
};

export type ProductionGrainRoadBranch = {
  breadGrainPerDay: number;
  firstProcessorId: string | null;
};

type ProductionRoadEntity = Pick<BuildingState | ResidenceState, 'id' | 'x' | 'z'>;

export type ProductionRoadComponentResolver = (
  entity: ProductionRoadEntity,
) => string | number | null;

export type ProductionRoadDistanceResolver = (
  source: ProductionRoadEntity,
  target: ProductionRoadEntity,
) => number | null;

export type ProsperityRoadBranch = {
  currentResidents: number;
  fullResidents: number;
  tierTwoPlusResidents: number;
  tierThreePlusResidents: number;
  lowerTierAleClothResidents: number;
  lowerTierShoesResidents: number;
  preservedFoodOutputPerDay: number;
  aleOutputPerDay: number;
  textileIntermediateOutputPerDay: number;
  clothOutputPerDay: number;
  shoesOutputPerDay: number;
  potteryOutputPerDay: number;
  firstResidenceId: string | null;
  firstClothResidenceId: string | null;
};

export function productionRoadBranchKey(
  component: string | number | null,
  entityKind: 'building' | 'residence',
  entityId: string,
): string {
  return component === null
    ? `unroaded:${entityKind}:${entityId}`
    : `component:${typeof component}:${String(component)}`;
}

type ProcessorOverview = Pick<
  SettlementProductionCapacity,
  | 'millWorkers'
  | 'bakeryWorkers'
  | 'breweryWorkers'
  | 'smokehouseWorkers'
  | 'spinnerWorkers'
  | 'weaverWorkers'
  | 'tanneryWorkers'
  | 'cobblerWorkers'
  | 'millInputBuffer'
  | 'bakeryInputBuffer'
  | 'breweryInputBuffer'
  | 'smokehouseInputBuffer'
  | 'spinnerInputBuffer'
  | 'weaverInputBuffer'
  | 'tanneryInputBuffer'
  | 'cobblerInputBuffer'
  | 'charcoalInputBuffer'
  | 'smithyInputBuffer'
  | 'potterInputBuffer'
  | 'millOutputRoom'
  | 'bakeryOutputRoom'
  | 'breweryOutputRoom'
  | 'smokehouseOutputRoom'
  | 'spinnerOutputRoom'
  | 'weaverOutputRoom'
  | 'tanneryOutputRoom'
  | 'cobblerOutputRoom'
  | 'charcoalOutputRoom'
  | 'smithyOutputRoom'
  | 'potterOutputRoom'
> & {
  fireDisabledProcessorSites: number;
  fireDisabledProcessorWorkers: number;
  firstFireDisabledProcessorId: string | null;
  millEffectiveWorkers: number;
  grainChainBranches: Map<string, GrainChainBranch>;
  prosperityRoadBranches: Map<string, ProsperityRoadBranch> | null;
  industrialMaterialBranches: Map<string, IndustrialMaterialBranch>;
  clayWorkers: number;
  potterWorkers: number;
  charcoalWorkers: number;
  smithyWorkers: number;
  toolEligibleSites: number;
  toolMaintainedSites: number;
  maintainedToolIronworkPerDay: number;
  fullToolIronworkPerDay: number;
  firstUnmaintainedToolSiteId: string | null;
  beverageOutputPerDay: number;
  beverageBarleyPerDay: number;
  beverageWaterPerDay: number;
  beverageFirewoodPerDay: number;
};

type GrainChainBranch = {
  millWorkers: number;
  millEffectiveWorkers: number;
  millFlourRateWork: number;
  bakeryWorkers: number;
  bakeryBreadRateWork: number;
  firstMillId: string | null;
  firstBakeryId: string | null;
};

type IndustrialMaterialBranch = {
  clayOutputPerDay: number;
  potterOutputPerDay: number;
  potterRoofTileOutputPerDay: number;
  potterClayPerDay: number;
  potterFirewoodPerDay: number;
  smokehousePotteryDemandPerDay: number;
  householdPotteryDemandPerDay: number;
  charcoalOutputPerDay: number;
  charcoalFirewoodPerDay: number;
  localIronOutputPerDay: number;
  smithyIronworkPerDay: number;
  smithyIronPerDay: number;
  smithyCharcoalPerDay: number;
  hasOperationalWell: boolean;
  maintainedToolIronworkPerDay: number;
  fullToolIronworkPerDay: number;
  hasStaffedMarket: boolean;
  standingIronImportMarkets: number;
  selectedIronReserve: number;
  ironImportCofferGold: number;
  firstClayId: string | null;
  firstPotterId: string | null;
  firstSmokehouseId: string | null;
  firstResidenceId: string | null;
  firstCharcoalId: string | null;
  firstIronMineId: string | null;
  firstSmithyId: string | null;
  firstMarketId: string | null;
  firstIronImportMarketId: string | null;
  firstToolSiteId: string | null;
  toolSites: ToolMaintenanceSiteForecast[];
  toolSmithies: ToolSmithyForecast[];
};

type ToolMaintenanceSiteForecast = {
  building: BuildingState;
  demandPerDay: number;
  refillLoad: number;
};

type ToolSmithyForecast = {
  building: BuildingState;
  ironworkPerWorkerDay: number;
  availableIronworkPerDay: number;
};

type TimedInputDelivery = {
  amount: number;
  arrivalSeconds: number;
};

type TimedInputDeliveries = Map<string, Map<DeliveryCargoKind, TimedInputDelivery[]>>;

type InputRunway = Omit<ProcessorInputBuffer, 'limitingInput' | 'buildingId'>;

function grainChainBranchKey(
  building: BuildingState,
  componentFor: ProductionRoadComponentResolver | undefined,
): string {
  if (!componentFor) return 'settlement';
  return productionRoadBranchKey(
    componentFor(building),
    'building',
    building.id,
  );
}

function industrialMaterialBranch(
  branches: Map<string, IndustrialMaterialBranch>,
  building: BuildingState,
  componentFor: ProductionRoadComponentResolver | undefined,
): IndustrialMaterialBranch {
  const key = grainChainBranchKey(building, componentFor);
  return industrialMaterialBranchByKey(branches, key);
}

function industrialMaterialBranchByKey(
  branches: Map<string, IndustrialMaterialBranch>,
  key: string,
): IndustrialMaterialBranch {
  let branch = branches.get(key);
  if (branch) return branch;
  branch = {
    clayOutputPerDay: 0,
    potterOutputPerDay: 0,
    potterRoofTileOutputPerDay: 0,
    potterClayPerDay: 0,
    potterFirewoodPerDay: 0,
    smokehousePotteryDemandPerDay: 0,
    householdPotteryDemandPerDay: 0,
    charcoalOutputPerDay: 0,
    charcoalFirewoodPerDay: 0,
    localIronOutputPerDay: 0,
    smithyIronworkPerDay: 0,
    smithyIronPerDay: 0,
    smithyCharcoalPerDay: 0,
    hasOperationalWell: false,
    maintainedToolIronworkPerDay: 0,
    fullToolIronworkPerDay: 0,
    hasStaffedMarket: false,
    standingIronImportMarkets: 0,
    selectedIronReserve: 0,
    ironImportCofferGold: 0,
    firstClayId: null,
    firstPotterId: null,
    firstSmokehouseId: null,
    firstResidenceId: null,
    firstCharcoalId: null,
    firstIronMineId: null,
    firstSmithyId: null,
    firstMarketId: null,
    firstIronImportMarketId: null,
    firstToolSiteId: null,
    toolSites: [],
    toolSmithies: [],
  };
  branches.set(key, branch);
  return branch;
}

function prosperityRoadBranch(
  branches: Map<string, ProsperityRoadBranch>,
  key: string,
): ProsperityRoadBranch {
  let branch = branches.get(key);
  if (branch) return branch;
  branch = {
    currentResidents: 0,
    fullResidents: 0,
    tierTwoPlusResidents: 0,
    tierThreePlusResidents: 0,
    lowerTierAleClothResidents: 0,
    lowerTierShoesResidents: 0,
    preservedFoodOutputPerDay: 0,
    aleOutputPerDay: 0,
    textileIntermediateOutputPerDay: 0,
    clothOutputPerDay: 0,
    shoesOutputPerDay: 0,
    potteryOutputPerDay: 0,
    firstResidenceId: null,
    firstClothResidenceId: null,
  };
  branches.set(key, branch);
  return branch;
}

function recordProsperityOutput(
  branches: Map<string, ProsperityRoadBranch> | null,
  building: BuildingState,
  componentFor: ProductionRoadComponentResolver | undefined,
  kind: 'preservedFood' | 'ale' | 'textileIntermediate' | 'cloth' | 'shoes' | 'pottery',
  outputPerDay: number,
): void {
  if (!branches || !componentFor) return;
  const branch = prosperityRoadBranch(
    branches,
    productionRoadBranchKey(
      componentFor(building),
      'building',
      building.id,
    ),
  );
  if (kind === 'preservedFood') {
    branch.preservedFoodOutputPerDay += outputPerDay;
  } else if (kind === 'ale') {
    branch.aleOutputPerDay += outputPerDay;
  } else if (kind === 'textileIntermediate') {
    branch.textileIntermediateOutputPerDay += outputPerDay;
  } else if (kind === 'cloth') {
    branch.clothOutputPerDay += outputPerDay;
  } else if (kind === 'shoes') {
    branch.shoesOutputPerDay += outputPerDay;
  } else {
    branch.potteryOutputPerDay += outputPerDay;
  }
}

function earlierStableId(current: string | null, candidate: string): string {
  return current === null || compareStableEntityIds(candidate, current) < 0
    ? candidate
    : current;
}

function recordGrainRoadActivity(
  branches: Map<string, GrainChainBranch>,
  building: BuildingState,
  role: 'mill' | 'bakery',
  componentFor: ProductionRoadComponentResolver | undefined,
  throughputMultiplier = 1,
): void {
  const key = grainChainBranchKey(building, componentFor);
  const branch = branches.get(key) ?? {
    millWorkers: 0,
    millEffectiveWorkers: 0,
    millFlourRateWork: 0,
    bakeryWorkers: 0,
    bakeryBreadRateWork: 0,
    firstMillId: null,
    firstBakeryId: null,
  };
  if (role === 'mill') {
    const effectiveWork = building.assignedLabor * Math.max(0, throughputMultiplier);
    branch.millWorkers += building.assignedLabor;
    branch.millEffectiveWorkers += effectiveWork;
    branch.millFlourRateWork += effectiveWork * selectedMillFlourRate(building);
    branch.firstMillId = earlierStableId(branch.firstMillId, building.id);
  } else {
    branch.bakeryWorkers += building.assignedLabor;
    branch.bakeryBreadRateWork += building.assignedLabor
      * selectedBakeryBreadRate(building);
    branch.firstBakeryId = earlierStableId(branch.firstBakeryId, building.id);
  }
  branches.set(key, branch);
}

function timedInputDeliveries(
  trips: Iterable<DeliveryTripState>,
): TimedInputDeliveries {
  const byBuilding = new Map<string, Map<DeliveryCargoKind, TimedInputDelivery[]>>();
  for (const trip of trips) {
    if (
      trip.phase === 'inbound'
      || trip.destinationKind !== 'building'
      || trip.targetBuildingId === null
      || trip.amount <= 1e-9
    ) {
      continue;
    }
    const arrivalSeconds = tripDeliveryRemainingSeconds(trip);
    if (!Number.isFinite(arrivalSeconds)) continue;

    let byCommodity = byBuilding.get(trip.targetBuildingId);
    if (!byCommodity) {
      byCommodity = new Map();
      byBuilding.set(trip.targetBuildingId, byCommodity);
    }
    let deliveries = byCommodity.get(trip.cargoKind);
    if (!deliveries) {
      deliveries = [];
      byCommodity.set(trip.cargoKind, deliveries);
    }
    deliveries.push({
      amount: Math.max(0, trip.amount),
      arrivalSeconds: Math.max(0, arrivalSeconds),
    });
  }
  for (const byCommodity of byBuilding.values()) {
    for (const deliveries of byCommodity.values()) {
      deliveries.sort((left, right) => left.arrivalSeconds - right.arrivalSeconds);
    }
  }
  return byBuilding;
}

function inputRunway(
  stock: number,
  dailyDemand: number,
  deliveries: readonly TimedInputDelivery[] | undefined,
): InputRunway {
  if (dailyDemand <= 1e-9) {
    return {
      days: Number.POSITIVE_INFINITY,
      onsiteDays: Number.POSITIVE_INFINITY,
      inTransitAmount: 0,
      inTransitTrips: 0,
      nextDeliverySeconds: null,
      deliveryGap: false,
    };
  }

  const onsiteDays = Math.max(0, stock) / dailyDemand;
  let days = onsiteDays;
  let inTransitAmount = 0;
  let inTransitTrips = 0;
  let nextDeliverySeconds: number | null = null;
  let deliveryGap = false;
  for (const delivery of deliveries ?? []) {
    inTransitAmount += delivery.amount;
    inTransitTrips += 1;
    nextDeliverySeconds ??= delivery.arrivalSeconds;
    if (deliveryGap) continue;

    const arrivalDays = delivery.arrivalSeconds / CALENDAR_SECONDS_PER_DAY;
    if (arrivalDays > days + 1e-9) {
      deliveryGap = true;
      continue;
    }
    days += delivery.amount / dailyDemand;
  }
  return {
    days,
    onsiteDays,
    inTransitAmount,
    inTransitTrips,
    nextDeliverySeconds,
    deliveryGap,
  };
}

function outputRoomDays(
  stock: number,
  capacity: number,
  dailyOutput: number,
): number {
  if (dailyOutput <= 1e-9) return Number.POSITIVE_INFINITY;
  return Math.max(0, capacity - Math.max(0, stock)) / dailyOutput;
}

function updateFirstToFill(
  current: ProcessorOutputRoom | null,
  days: number,
  buildingId: string,
  targetPercent: number,
): ProcessorOutputRoom {
  return current === null || days < current.days
    ? { days, buildingId, targetPercent }
    : current;
}

function updateFirstToStop(
  current: ProcessorInputBuffer | null,
  runway: InputRunway,
  limitingInput: ProcessorInput,
  buildingId: string,
): ProcessorInputBuffer {
  return current === null || runway.days < current.days
    ? { ...runway, limitingInput, buildingId }
    : current;
}

function buildingInputRunway(
  deliveries: TimedInputDeliveries,
  building: BuildingState,
  commodity: DeliveryCargoKind,
  dailyDemand: number,
): InputRunway {
  return inputRunway(
    Math.max(0, building[commodity] ?? 0),
    dailyDemand,
    deliveries.get(building.id)?.get(commodity),
  );
}

function groupedBuildingInputRunway(
  deliveries: TimedInputDeliveries,
  building: BuildingState,
  commodities: readonly DeliveryCargoKind[],
  stock: number,
  dailyDemand: number,
): InputRunway {
  const incoming = commodities
    .flatMap((commodity) => deliveries.get(building.id)?.get(commodity) ?? [])
    .sort((left, right) => left.arrivalSeconds - right.arrivalSeconds);
  return inputRunway(stock, dailyDemand, incoming);
}

function selectedMillFlourRate(building: BuildingState): number {
  const stocks = [building.ryeGrain ?? 0, building.maslinGrain ?? 0];
  const selected = stocks.indexOf(Math.max(...stocks));
  return selected === 1
    ? WATERMILL_MASLIN_FLOUR_PER_CYCLE
    : WATERMILL_RYE_FLOUR_PER_CYCLE;
}

function selectedBakeryBreadRate(building: BuildingState): number {
  const stocks = [building.ryeFlour ?? 0, building.maslinFlour ?? 0];
  const selected = stocks.indexOf(Math.max(...stocks));
  return selected === 1
    ? BAKERY_MASLIN_BREAD_PER_CYCLE
    : BAKERY_RYE_BREAD_PER_CYCLE;
}

function stockTargetHasRoom(
  building: BuildingState,
  commodity: 'timber' | 'firewood' | 'stone' | 'iron' | 'salt' | 'clay' | 'flour',
): boolean {
  const capacity = (BUILDING_STORAGE_CAPS[building.kind] as Record<
    string,
    number | undefined
  >)[commodity] ?? 0;
  const policyTarget = processorOutputTargetForBuilding(building);
  const extractionTarget = (
    building.kind === 'stone_quarry'
    || building.kind === 'large_quarry'
    || building.kind === 'mine'
  )
    ? capacity
    : null;
  const target = extractionTarget
    ?? (policyTarget == null ? capacity : Math.min(capacity, policyTarget));
  const stock = commodity === 'flour'
    ? flourStock(building)
    : Math.max(0, Number(building[commodity] ?? 0));
  return stock + 1e-6 < target;
}

function geologicalDepositForBuilding(
  building: BuildingState,
  deposits: Iterable<ResourceNodeState>,
  richOnly: boolean,
): ResourceNodeState | null {
  const radius = richOnly ? 2.5 : building.workRadius;
  let nearest: ResourceNodeState | null = null;
  let nearestDistance = radius;
  for (const deposit of deposits) {
    if (
      deposit.resource !== 'stone'
      && deposit.resource !== 'iron'
      && deposit.resource !== 'salt'
      && deposit.resource !== 'clay'
    ) {
      continue;
    }
    if (
      richOnly
        ? deposit.isRich !== true || deposit.resource !== 'stone'
        : deposit.remaining <= 1e-6
    ) {
      continue;
    }
    const distance = Math.hypot(deposit.x - building.x, deposit.z - building.z);
    if (distance > nearestDistance) continue;
    nearest = deposit;
    nearestDistance = distance;
  }
  return nearest;
}

/** Current physical gates that can prevent a tool-wearing cycle from starting. */
function civilianToolSiteCanWork(
  building: BuildingState,
  state: GameState,
  mineDeposit: ReturnType<typeof mineralDepositBeneath>,
): boolean {
  switch (building.kind) {
    case 'lumber_mill':
      return stockTargetHasRoom(building, 'timber')
        && (MILL_WATER_PER_HARVEST <= 1e-9 || building.water + 1e-6 >= MILL_WATER_PER_HARVEST);
    case 'woodcutters_lodge':
      return stockTargetHasRoom(building, 'firewood');
    case 'stone_quarry':
    case 'large_quarry': {
      const deposit = building.kind === 'stone_quarry'
        ? miningPitSurfaceDeposit(building, state.quarries.values())
        : geologicalDepositForBuilding(
          building,
          state.quarries.values(),
          true,
        );
      if (
        deposit?.resource !== 'stone'
        && deposit?.resource !== 'iron'
        && deposit?.resource !== 'salt'
        && deposit?.resource !== 'clay'
      ) return false;
      return stockTargetHasRoom(building, deposit.resource)
        && (building.kind !== 'large_quarry' || largeQuarrySupportsReady(building.timber));
    }
    case 'mine': {
      if (mineDeposit == null) return false;
      const output = mineDeposit.resource === 'iron'
        ? 'iron'
        : mineDeposit.resource === 'salt'
          ? 'salt'
          : 'clay';
      return stockTargetHasRoom(building, output)
        && richMineSupportsReady(building.timber);
    }
    case 'watermill':
    case 'windmill':
      return stockTargetHasRoom(building, 'flour')
        && millableGrainStock(building) + 1e-6 >= WATERMILL_GRAIN_PER_CYCLE;
    case 'threshing_barn':
      return true;
    default:
      return false;
  }
}

function completedProcessorOverview(
  state: GameState,
  sabbathObserved: boolean,
  componentFor: ProductionRoadComponentResolver | undefined,
  watermillThroughputMultiplier: number,
  windmillWeatherThroughputMultiplier: number,
  surfaceClayThroughputMultiplier: number,
  charcoalBurnerThroughputMultiplier: number,
  calendarMonth?: number,
): ProcessorOverview {
  const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
  const deliveries = timedInputDeliveries(state.deliveryTrips.values());
  const bakeryCyclesPerWorker = cyclesPerCalendarDay('bakery', 1, sabbathObserved);
  const breweryCyclesPerWorker = cyclesPerCalendarDay('brewery', 1, sabbathObserved);
  const smokehouseCyclesPerWorker = cyclesPerCalendarDay('smokehouse', 1, sabbathObserved);
  const spinnerCyclesPerWorker = cyclesPerCalendarDay('spinning_retting_house', 1, sabbathObserved);
  const weaverCyclesPerWorker = cyclesPerCalendarDay('weaver', 1, sabbathObserved);
  const tanneryCyclesPerWorker = cyclesPerCalendarDay('tannery', 1, sabbathObserved);
  const cobblerCyclesPerWorker = cyclesPerCalendarDay('cobbler', 1, sabbathObserved);
  const charcoalCyclesPerWorker = cyclesPerCalendarDay(
    'charcoal_burner',
    1,
    sabbathObserved,
    charcoalBurnerThroughputMultiplier,
  );
  const smithyCyclesPerWorker = cyclesPerCalendarDay('smithy', 1, sabbathObserved);
  const potterCyclesPerWorker = cyclesPerCalendarDay(
    'potter_kiln',
    1,
    sabbathObserved,
  );
  let fireDisabledProcessorSites = 0;
  let fireDisabledProcessorWorkers = 0;
  let firstFireDisabledProcessorId: string | null = null;
  let millWorkers = 0;
  let millEffectiveWorkers = 0;
  let bakeryWorkers = 0;
  let breweryWorkers = 0;
  let smokehouseWorkers = 0;
  let spinnerWorkers = 0;
  let weaverWorkers = 0;
  let tanneryWorkers = 0;
  let cobblerWorkers = 0;
  let clayWorkers = 0;
  let charcoalWorkers = 0;
  let smithyWorkers = 0;
  let potterWorkers = 0;
  let beverageOutputPerDay = 0;
  let beverageBarleyPerDay = 0;
  let beverageWaterPerDay = 0;
  let beverageFirewoodPerDay = 0;
  let toolEligibleSites = 0;
  let toolMaintainedSites = 0;
  let maintainedToolIronworkPerDay = 0;
  let fullToolIronworkPerDay = 0;
  let firstUnmaintainedToolSiteId: string | null = null;
  let millInputBuffer: ProcessorInputBuffer | null = null;
  let bakeryInputBuffer: ProcessorInputBuffer | null = null;
  let breweryInputBuffer: ProcessorInputBuffer | null = null;
  let smokehouseInputBuffer: ProcessorInputBuffer | null = null;
  let spinnerInputBuffer: ProcessorInputBuffer | null = null;
  let weaverInputBuffer: ProcessorInputBuffer | null = null;
  let tanneryInputBuffer: ProcessorInputBuffer | null = null;
  let cobblerInputBuffer: ProcessorInputBuffer | null = null;
  let charcoalInputBuffer: ProcessorInputBuffer | null = null;
  let smithyInputBuffer: ProcessorInputBuffer | null = null;
  let potterInputBuffer: ProcessorInputBuffer | null = null;
  let millOutputRoom: ProcessorOutputRoom | null = null;
  let bakeryOutputRoom: ProcessorOutputRoom | null = null;
  let breweryOutputRoom: ProcessorOutputRoom | null = null;
  let smokehouseOutputRoom: ProcessorOutputRoom | null = null;
  let spinnerOutputRoom: ProcessorOutputRoom | null = null;
  let weaverOutputRoom: ProcessorOutputRoom | null = null;
  let tanneryOutputRoom: ProcessorOutputRoom | null = null;
  let cobblerOutputRoom: ProcessorOutputRoom | null = null;
  let charcoalOutputRoom: ProcessorOutputRoom | null = null;
  let smithyOutputRoom: ProcessorOutputRoom | null = null;
  let potterOutputRoom: ProcessorOutputRoom | null = null;
  const grainChainBranches = new Map<string, GrainChainBranch>();
  const industrialMaterialBranches = new Map<string, IndustrialMaterialBranch>();
  const prosperityRoadBranches = componentFor
    ? new Map<string, ProsperityRoadBranch>()
    : null;
  const cartWorkersAway = rosteredCartWorkersByBuilding(
    state.buildings,
    state.deliveryTrips.values(),
  );
  const activeFarmToolHoldings = new Set<string>();
  for (const field of state.farmFields.values()) {
    if (
      field.priority > 0
      && field.stage !== 'growing'
      && (
        calendarMonth == null
        || fieldStageAllowed(field, calendarMonth)
      )
    ) {
      activeFarmToolHoldings.add(field.farmsteadId);
    }
  }
  for (const building of state.buildings.values()) {
    if (building.constructionComplete === false) {
      continue;
    }
    if (building.kind === 'well') {
      if (!fireDisabled.has(building.id)) {
        industrialMaterialBranch(
          industrialMaterialBranches,
          building,
          componentFor,
        ).hasOperationalWell = true;
      }
      continue;
    }
    if (building.assignedLabor <= 0) continue;
    if (fireDisabled.has(building.id)) {
      if (
        building.kind === 'watermill'
        || building.kind === 'windmill'
        || building.kind === 'bakery'
        || building.kind === 'brewery'
        || building.kind === 'smokehouse'
        || building.kind === 'spinning_retting_house'
        || building.kind === 'weaver'
        || building.kind === 'tannery'
        || building.kind === 'cobbler'
        || building.kind === 'charcoal_burner'
        || building.kind === 'smithy'
        || building.kind === 'potter_kiln'
      ) {
        fireDisabledProcessorSites += 1;
        fireDisabledProcessorWorkers += Math.max(0, building.assignedLabor);
        firstFireDisabledProcessorId = earlierStableId(
          firstFireDisabledProcessorId,
          building.id,
        );
      }
      continue;
    }
    const surfaceDeposit = building.kind === 'stone_quarry'
      ? miningPitSurfaceDeposit(building, state.quarries.values())
      : null;
    const mineDeposit = building.kind === 'mine'
      ? mineralDepositBeneath(building, state.quarries.values())
      : null;
    const onsiteLabor = Math.max(
      0,
      building.assignedLabor - (cartWorkersAway.get(building.id) ?? 0),
    );
    if (
      isCivilianToolSite(building.kind)
      && (
        building.kind !== 'threshing_barn'
        || activeFarmToolHoldings.has(building.id)
      )
      && (
        building.kind !== 'mine'
        || mineDeposit?.resource === 'iron'
        || mineDeposit?.resource === 'salt'
        || mineDeposit?.resource === 'clay'
      )
    ) {
      toolEligibleSites += 1;
      const maintained = building.kind === 'threshing_barn'
        ? farmToolsMaintained(building.ironwork ?? 0)
        : civilianToolsMaintained(building.ironwork ?? 0);
      const weeklyWorkShare = averageProductiveCalendarDayShare(sabbathObserved);
      const canWork = civilianToolSiteCanWork(building, state, mineDeposit);
      let fullyEquippedDemand: number;
      let maintainedDemand: number;
      if (building.kind === 'threshing_barn') {
        fullyEquippedDemand = (canWork ? onsiteLabor : 0)
          * weeklyWorkShare
          * CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
          * FARM_TOOL_IRONWORK_PER_WORKER_DAY;
        maintainedDemand = maintained
          ? fullyEquippedDemand
          : 0;
      } else {
        const productiveToolLabor = building.kind === 'woodcutters_lodge'
          ? lodgeSustainedProcessingLabor(onsiteLabor)
          : onsiteLabor;
        const environmentThroughput = building.kind === 'watermill'
          ? watermillThroughputMultiplier
          : building.kind === 'windmill'
            ? windSiteThroughputMultiplier(state.seed, building.x, building.z)
              * windmillWeatherThroughputMultiplier
          : building.kind === 'stone_quarry' && surfaceDeposit?.resource === 'clay'
            ? surfaceClayThroughputMultiplier
            : building.kind === 'mine' && mineDeposit?.isRich === true
              ? RICH_MINE_THROUGHPUT_MULTIPLIER
              : 1;
        const fullyEquippedCycles = cyclesPerCalendarDay(
          building.kind,
          canWork ? productiveToolLabor : 0,
          sabbathObserved,
          CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER * environmentThroughput,
        );
        fullyEquippedDemand = fullyEquippedCycles
          * CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
        maintainedDemand = maintained
          ? fullyEquippedDemand
          : 0;
      }
      fullToolIronworkPerDay += fullyEquippedDemand;
      const materialBranch = industrialMaterialBranch(
        industrialMaterialBranches,
        building,
        componentFor,
      );
      materialBranch.fullToolIronworkPerDay += fullyEquippedDemand;
      materialBranch.maintainedToolIronworkPerDay += maintainedDemand;
      materialBranch.firstToolSiteId = earlierStableId(
        materialBranch.firstToolSiteId,
        building.id,
      );
      const toolCapacity = BUILDING_STORAGE_CAPS[building.kind].ironwork ?? 0;
      materialBranch.toolSites.push({
        building,
        demandPerDay: fullyEquippedDemand,
        refillLoad: civilianToolForecastRefillLoad(toolCapacity),
      });
      if (maintained) {
        toolMaintainedSites += 1;
        maintainedToolIronworkPerDay += maintainedDemand;
      } else {
        firstUnmaintainedToolSiteId = earlierStableId(
          firstUnmaintainedToolSiteId,
          building.id,
        );
      }
    }
    switch (building.kind) {
      case 'watermill':
      case 'windmill': {
        const toolThroughput = civilianToolThroughputMultiplier(
          building.ironwork ?? 0,
        );
        const powerThroughput = building.kind === 'watermill'
          ? watermillThroughputMultiplier
          : windSiteThroughputMultiplier(state.seed, building.x, building.z)
            * windmillWeatherThroughputMultiplier;
        millWorkers += building.assignedLabor;
        millEffectiveWorkers += building.assignedLabor * toolThroughput * powerThroughput;
        recordGrainRoadActivity(
          grainChainBranches,
          building,
          'mill',
          componentFor,
          toolThroughput * powerThroughput,
        );
        const cycles = cyclesPerCalendarDay(
          building.kind,
          building.assignedLabor,
          sabbathObserved,
          powerThroughput * toolThroughput,
        );
        millInputBuffer = updateFirstToStop(
          millInputBuffer,
          groupedBuildingInputRunway(
            deliveries,
            building,
            MILLABLE_GRAIN_KINDS,
            millableGrainStock(building),
            cycles * WATERMILL_GRAIN_PER_CYCLE,
          ),
          'grain',
          building.id,
        );
        millOutputRoom = updateFirstToFill(
          millOutputRoom,
          outputRoomDays(
            flourStock(building),
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS[building.kind].flour ?? 0),
            cycles * selectedMillFlourRate(building),
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'bakery': {
        bakeryWorkers += onsiteLabor;
        recordGrainRoadActivity(
          grainChainBranches,
          building,
          'bakery',
          componentFor,
        );
        const cycles = bakeryCyclesPerWorker * onsiteLabor;
        let runway = groupedBuildingInputRunway(
          deliveries,
          building,
          BAKEABLE_FLOUR_KINDS,
          bakeableFlourStock(building),
          cycles * BAKERY_FLOUR_PER_CYCLE,
        );
        let limitingInput: ProcessorInput = 'flour';
        const waterRunway = buildingInputRunway(
          deliveries,
          building,
          'water',
          cycles * BAKERY_WATER_PER_CYCLE,
        );
        if (waterRunway.days < runway.days) {
          runway = waterRunway;
          limitingInput = 'water';
        }
        const firewoodRunway = buildingInputRunway(
          deliveries,
          building,
          'firewood',
          cycles * BAKERY_FIREWOOD_PER_CYCLE,
        );
        if (firewoodRunway.days < runway.days) {
          runway = firewoodRunway;
          limitingInput = 'firewood';
        }
        bakeryInputBuffer = updateFirstToStop(
          bakeryInputBuffer,
          runway,
          limitingInput,
          building.id,
        );
        bakeryOutputRoom = updateFirstToFill(
          bakeryOutputRoom,
          outputRoomDays(
            breadStock(building),
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.bakery.food ?? 0),
            cycles * selectedBakeryBreadRate(building),
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'brewery': {
        breweryWorkers += building.assignedLabor;
        const workCycles = breweryCyclesPerWorker * building.assignedLabor;
        const recipe = selectedBreweryRecipePolicy(
          building.breweryRecipePolicy,
          building,
        );
        const beverageCycles = recipe === BREWERY_RECIPE_CIDER
          || recipe === BREWERY_RECIPE_PEAR_CIDER
          || recipe === BREWERY_RECIPE_MEAD
          ? workCycles
          : workCycles / 2;
        const outputPerCycle = recipe === BREWERY_RECIPE_CIDER
          || recipe === BREWERY_RECIPE_PEAR_CIDER
          ? BREWERY_CIDER_PER_CYCLE
          : recipe === BREWERY_RECIPE_MEAD
            ? BREWERY_MEAD_PER_CYCLE
            : BREWERY_ALE_PER_CYCLE;
        const outputKind = recipe === BREWERY_RECIPE_CIDER
          ? 'cider'
          : recipe === BREWERY_RECIPE_PEAR_CIDER
            ? 'cider'
          : recipe === BREWERY_RECIPE_MEAD
            ? 'mead'
            : 'ale';
        const outputPerDay = beverageCycles * outputPerCycle;
        beverageOutputPerDay += outputPerDay;
        const aleCycles = workCycles / 2;
        if (
          recipe !== BREWERY_RECIPE_CIDER
          && recipe !== BREWERY_RECIPE_PEAR_CIDER
          && recipe !== BREWERY_RECIPE_MEAD
        ) {
          beverageBarleyPerDay += aleCycles * BREWERY_BARLEY_PER_MALT_CYCLE;
          beverageWaterPerDay += aleCycles * (
            BREWERY_MALTING_WATER_PER_CYCLE
            + BREWERY_BREWING_WATER_PER_CYCLE
          );
          beverageFirewoodPerDay += aleCycles * (
            BREWERY_MALTING_FIREWOOD_PER_CYCLE
            + BREWERY_BREWING_FIREWOOD_PER_CYCLE
          );
        }
        recordProsperityOutput(
          prosperityRoadBranches,
          building,
          componentFor,
          'ale',
          outputPerDay,
        );
        let limitingInput: ProcessorInput;
        let runway: InputRunway;
        if (recipe === BREWERY_RECIPE_CIDER) {
          limitingInput = 'apples';
          runway = buildingInputRunway(
            deliveries,
            building,
            'apples',
            beverageCycles * BREWERY_FRUIT_PER_CIDER_CYCLE,
          );
        } else if (recipe === BREWERY_RECIPE_PEAR_CIDER) {
          limitingInput = 'pears';
          runway = buildingInputRunway(
            deliveries,
            building,
            'pears',
            beverageCycles * BREWERY_FRUIT_PER_CIDER_CYCLE,
          );
        } else if (recipe === BREWERY_RECIPE_MEAD) {
          limitingInput = 'honey';
          runway = buildingInputRunway(
            deliveries,
            building,
            'honey',
            beverageCycles * BREWERY_HONEY_PER_MEAD_CYCLE,
          );
        } else {
          limitingInput = 'barley';
          runway = buildingInputRunway(
            deliveries,
            building,
            'barley',
            aleCycles * BREWERY_BARLEY_PER_MALT_CYCLE,
          );
          if (aleCycles > 1e-9 && (building.malt ?? 0) > 1e-9) {
            const maltAsBarley = (building.malt ?? 0)
              / BREWERY_MALT_PER_CYCLE
              * BREWERY_BARLEY_PER_MALT_CYCLE;
            runway = inputRunway(
              Math.max(0, building.barley ?? 0) + maltAsBarley,
              aleCycles * BREWERY_BARLEY_PER_MALT_CYCLE,
              deliveries.get(building.id)?.get('barley'),
            );
          }
          const waterRunway = buildingInputRunway(
            deliveries,
            building,
            'water',
            aleCycles * (
              BREWERY_MALTING_WATER_PER_CYCLE
              + BREWERY_BREWING_WATER_PER_CYCLE
            ),
          );
          if (waterRunway.days < runway.days) {
            runway = waterRunway;
            limitingInput = 'water';
          }
          const firewoodRunway = buildingInputRunway(
            deliveries,
            building,
            'firewood',
            aleCycles * (
              BREWERY_MALTING_FIREWOOD_PER_CYCLE
              + BREWERY_BREWING_FIREWOOD_PER_CYCLE
            ),
          );
          if (firewoodRunway.days < runway.days) {
            runway = firewoodRunway;
            limitingInput = 'firewood';
          }
        }
        breweryInputBuffer = updateFirstToStop(
          breweryInputBuffer,
          runway,
          limitingInput,
          building.id,
        );
        breweryOutputRoom = updateFirstToFill(
          breweryOutputRoom,
          outputRoomDays(
            Math.max(0, building[outputKind] ?? 0),
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.brewery[outputKind] ?? 0),
            outputPerDay,
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'smokehouse': {
        smokehouseWorkers += building.assignedLabor;
        const cycles = smokehouseCyclesPerWorker * building.assignedLabor;
        const materialBranch = industrialMaterialBranch(
          industrialMaterialBranches,
          building,
          componentFor,
        );
        materialBranch.smokehousePotteryDemandPerDay += cycles
          * SMOKEHOUSE_POTTERY_PER_CYCLE;
        materialBranch.firstSmokehouseId = earlierStableId(
          materialBranch.firstSmokehouseId,
          building.id,
        );
        recordProsperityOutput(
          prosperityRoadBranches,
          building,
          componentFor,
          'preservedFood',
          cycles * SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
        );
        let runway = groupedBuildingInputRunway(
          deliveries,
          building,
          ['meat', 'fish', 'milk'],
          preservableFoodStock(building),
          cycles * SMOKEHOUSE_FOOD_PER_CYCLE,
        );
        let limitingInput: ProcessorInput = 'fresh food';
        const firewoodRunway = buildingInputRunway(
          deliveries,
          building,
          'firewood',
          cycles * SMOKEHOUSE_FIREWOOD_PER_CYCLE,
        );
        if (firewoodRunway.days < runway.days) {
          runway = firewoodRunway;
          limitingInput = 'firewood';
        }
        const saltRunway = buildingInputRunway(
          deliveries,
          building,
          'salt',
          cycles * SMOKEHOUSE_SALT_PER_CYCLE,
        );
        if (saltRunway.days < runway.days) {
          runway = saltRunway;
          limitingInput = 'salt';
        }
        smokehouseInputBuffer = updateFirstToStop(
          smokehouseInputBuffer,
          runway,
          limitingInput,
          building.id,
        );
        smokehouseOutputRoom = updateFirstToFill(
          smokehouseOutputRoom,
          outputRoomDays(
            preservedFoodStock(building),
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.smokehouse.preservedFood ?? 0),
            cycles * SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'spinning_retting_house': {
        spinnerWorkers += building.assignedLabor;
        const cycles = spinnerCyclesPerWorker * building.assignedLabor;
        recordProsperityOutput(
          prosperityRoadBranches,
          building,
          componentFor,
          'textileIntermediate',
          cycles * SPINNING_RETTING_YARN_PER_CYCLE,
        );
        const usesFlax = weaverUsesFlax(building);
        let runway = buildingInputRunway(
          deliveries,
          building,
          usesFlax ? 'flax' : 'wool',
          cycles * (
            usesFlax
              ? SPINNING_RETTING_FLAX_PER_CYCLE
              : SPINNING_RETTING_WOOL_PER_CYCLE
          ),
        );
        let limitingInput: ProcessorInput = usesFlax ? 'flax' : 'wool';
        if (usesFlax) {
          const waterRunway = buildingInputRunway(
            deliveries,
            building,
            'water',
            cycles * SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
          );
          if (waterRunway.days < runway.days) {
            runway = waterRunway;
            limitingInput = 'water';
          }
        }
        spinnerInputBuffer = updateFirstToStop(
          spinnerInputBuffer,
          runway,
          limitingInput,
          building.id,
        );
        const outputKind = usesFlax ? 'linen' : 'yarn';
        const outputPerCycle = usesFlax
          ? SPINNING_RETTING_LINEN_PER_CYCLE
          : SPINNING_RETTING_YARN_PER_CYCLE;
        spinnerOutputRoom = updateFirstToFill(
          spinnerOutputRoom,
          outputRoomDays(
            building[outputKind] ?? 0,
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.spinning_retting_house[outputKind] ?? 0),
            cycles * outputPerCycle,
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'weaver': {
        weaverWorkers += building.assignedLabor;
        const cycles = weaverCyclesPerWorker * building.assignedLabor;
        recordProsperityOutput(
          prosperityRoadBranches,
          building,
          componentFor,
          'cloth',
          cycles * WEAVER_CLOTH_PER_CYCLE,
        );
        const usesLinen = weaverUsesLinen(building);
        const inputKind = usesLinen ? 'linen' : 'yarn';
        const runway = buildingInputRunway(
          deliveries,
          building,
          inputKind,
          cycles * (usesLinen ? WEAVER_LINEN_PER_CYCLE : WEAVER_YARN_PER_CYCLE),
        );
        weaverInputBuffer = updateFirstToStop(
          weaverInputBuffer,
          runway,
          inputKind,
          building.id,
        );
        weaverOutputRoom = updateFirstToFill(
          weaverOutputRoom,
          outputRoomDays(
            building.cloth ?? 0,
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.weaver.cloth ?? 0),
            cycles * WEAVER_CLOTH_PER_CYCLE,
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'tannery': {
        tanneryWorkers += building.assignedLabor;
        const cycles = tanneryCyclesPerWorker * building.assignedLabor;
        let runway = buildingInputRunway(
          deliveries,
          building,
          'hides',
          cycles * TANNERY_HIDES_PER_CYCLE,
        );
        let limitingInput: ProcessorInput = 'hides';
        const waterRunway = buildingInputRunway(
          deliveries,
          building,
          'water',
          cycles * TANNERY_WATER_PER_CYCLE,
        );
        if (waterRunway.days < runway.days) {
          runway = waterRunway;
          limitingInput = 'water';
        }
        const firewoodRunway = buildingInputRunway(
          deliveries,
          building,
          'firewood',
          cycles * TANNERY_FIREWOOD_PER_CYCLE,
        );
        if (firewoodRunway.days < runway.days) {
          runway = firewoodRunway;
          limitingInput = 'firewood';
        }
        tanneryInputBuffer = updateFirstToStop(
          tanneryInputBuffer,
          runway,
          limitingInput,
          building.id,
        );
        tanneryOutputRoom = updateFirstToFill(
          tanneryOutputRoom,
          outputRoomDays(
            building.leather ?? 0,
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.tannery.leather ?? 0),
            cycles * TANNERY_LEATHER_PER_CYCLE,
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'cobbler': {
        cobblerWorkers += building.assignedLabor;
        const cycles = cobblerCyclesPerWorker * building.assignedLabor;
        recordProsperityOutput(
          prosperityRoadBranches,
          building,
          componentFor,
          'shoes',
          cycles * COBBLER_SHOES_PER_CYCLE,
        );
        const runway = buildingInputRunway(
          deliveries,
          building,
          'leather',
          cycles * COBBLER_LEATHER_PER_CYCLE,
        );
        cobblerInputBuffer = updateFirstToStop(
          cobblerInputBuffer,
          runway,
          'leather',
          building.id,
        );
        cobblerOutputRoom = updateFirstToFill(
          cobblerOutputRoom,
          outputRoomDays(
            building.shoes ?? 0,
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.cobbler.shoes ?? 0),
            cycles * COBBLER_SHOES_PER_CYCLE,
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'stone_quarry': {
        if (surfaceDeposit?.resource !== 'iron' && surfaceDeposit?.resource !== 'clay') {
          break;
        }
        const outputPerDay = miningPitOutputPerDay(
          building,
          surfaceDeposit,
          sabbathObserved,
          surfaceClayThroughputMultiplier,
        );
        const branch = industrialMaterialBranch(
          industrialMaterialBranches,
          building,
          componentFor,
        );
        if (surfaceDeposit.resource === 'iron') {
          branch.localIronOutputPerDay += outputPerDay;
          branch.firstIronMineId = earlierStableId(
            branch.firstIronMineId,
            building.id,
          );
        } else {
          clayWorkers += building.assignedLabor;
          branch.clayOutputPerDay += outputPerDay;
          branch.firstClayId = earlierStableId(branch.firstClayId, building.id);
        }
        break;
      }
      case 'charcoal_burner': {
        charcoalWorkers += building.assignedLabor;
        const cycles = charcoalCyclesPerWorker * building.assignedLabor;
        const branch = industrialMaterialBranch(
          industrialMaterialBranches,
          building,
          componentFor,
        );
        branch.charcoalOutputPerDay += cycles
          * CHARCOAL_BURNER_CHARCOAL_PER_CYCLE;
        branch.charcoalFirewoodPerDay += cycles
          * CHARCOAL_BURNER_FIREWOOD_PER_CYCLE;
        branch.firstCharcoalId = earlierStableId(
          branch.firstCharcoalId,
          building.id,
        );
        charcoalInputBuffer = updateFirstToStop(
          charcoalInputBuffer,
          buildingInputRunway(
            deliveries,
            building,
            'firewood',
            cycles * CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
          ),
          'firewood',
          building.id,
        );
        charcoalOutputRoom = updateFirstToFill(
          charcoalOutputRoom,
          outputRoomDays(
            building.charcoal ?? 0,
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.charcoal_burner.charcoal ?? 0),
            cycles * CHARCOAL_BURNER_CHARCOAL_PER_CYCLE,
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'smithy': {
        smithyWorkers += building.assignedLabor;
        const cycles = smithyCyclesPerWorker
          * building.assignedLabor;
        const branch = industrialMaterialBranch(
          industrialMaterialBranches,
          building,
          componentFor,
        );
        branch.smithyIronworkPerDay += cycles * SMITHY_IRONWORK_PER_CYCLE;
        branch.smithyIronPerDay += cycles * SMITHY_IRON_PER_CYCLE;
        branch.smithyCharcoalPerDay += cycles * SMITHY_CHARCOAL_PER_CYCLE;
        branch.toolSmithies.push({
          building,
          ironworkPerWorkerDay: smithyCyclesPerWorker
            * SMITHY_IRONWORK_PER_CYCLE,
          availableIronworkPerDay: 0,
        });
        branch.firstSmithyId = earlierStableId(branch.firstSmithyId, building.id);
        let runway = buildingInputRunway(
          deliveries,
          building,
          'iron',
          cycles * SMITHY_IRON_PER_CYCLE,
        );
        let limitingInput: ProcessorInput = 'iron';
        const charcoalRunway = buildingInputRunway(
          deliveries,
          building,
          'charcoal',
          cycles * SMITHY_CHARCOAL_PER_CYCLE,
        );
        if (charcoalRunway.days < runway.days) {
          runway = charcoalRunway;
          limitingInput = 'charcoal';
        }
        const waterRunway = buildingInputRunway(
          deliveries,
          building,
          'water',
          cycles * SMITHY_WATER_PER_CYCLE,
        );
        if (waterRunway.days < runway.days) {
          runway = waterRunway;
          limitingInput = 'water';
        }
        smithyInputBuffer = updateFirstToStop(
          smithyInputBuffer,
          runway,
          limitingInput,
          building.id,
        );
        smithyOutputRoom = updateFirstToFill(
          smithyOutputRoom,
          outputRoomDays(
            building.ironwork ?? 0,
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.smithy.ironwork ?? 0),
            cycles * SMITHY_IRONWORK_PER_CYCLE,
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'mine': {
        if (mineDeposit?.resource !== 'iron' && mineDeposit?.resource !== 'clay') break;
        const outputPerDay = mineralMineOutputPerDay(
          building,
          mineDeposit,
          sabbathObserved,
        );
        if (outputPerDay <= 1e-9) break;
        const branch = industrialMaterialBranch(
          industrialMaterialBranches,
          building,
          componentFor,
        );
        if (mineDeposit.resource === 'iron') {
          branch.localIronOutputPerDay += outputPerDay;
          branch.firstIronMineId = earlierStableId(
            branch.firstIronMineId,
            building.id,
          );
        } else {
          clayWorkers += building.assignedLabor;
          branch.clayOutputPerDay += outputPerDay;
          branch.firstClayId = earlierStableId(branch.firstClayId, building.id);
        }
        break;
      }
      case 'potter_kiln': {
        potterWorkers += building.assignedLabor;
        const cycles = potterCyclesPerWorker * building.assignedLabor;
        const firingRoofTiles = normalizePotterFiringPolicy(
          building.potterFiringPolicy,
        ) === POTTER_FIRE_ROOF_TILES;
        const branch = industrialMaterialBranch(
          industrialMaterialBranches,
          building,
          componentFor,
        );
        if (firingRoofTiles) {
          branch.potterRoofTileOutputPerDay += cycles
            * POTTER_ROOF_TILES_PER_CYCLE;
        } else {
          branch.potterOutputPerDay += cycles * POTTER_POTTERY_PER_CYCLE;
        }
        branch.potterClayPerDay += cycles * POTTER_CLAY_PER_CYCLE;
        branch.potterFirewoodPerDay += cycles * POTTER_FIREWOOD_PER_CYCLE;
        branch.firstPotterId = earlierStableId(branch.firstPotterId, building.id);
        if (!firingRoofTiles) {
          recordProsperityOutput(
            prosperityRoadBranches,
            building,
            componentFor,
            'pottery',
            cycles * POTTER_POTTERY_PER_CYCLE,
          );
        }
        let runway = buildingInputRunway(
          deliveries,
          building,
          'clay',
          cycles * POTTER_CLAY_PER_CYCLE,
        );
        let limitingInput: ProcessorInput = 'clay';
        const firewoodRunway = buildingInputRunway(
          deliveries,
          building,
          'firewood',
          cycles * POTTER_FIREWOOD_PER_CYCLE,
        );
        if (firewoodRunway.days < runway.days) {
          runway = firewoodRunway;
          limitingInput = 'firewood';
        }
        const waterRunway = buildingInputRunway(
          deliveries,
          building,
          'water',
          cycles * POTTER_WATER_PER_CYCLE,
        );
        if (waterRunway.days < runway.days) {
          runway = waterRunway;
          limitingInput = 'water';
        }
        potterInputBuffer = updateFirstToStop(
          potterInputBuffer,
          runway,
          limitingInput,
          building.id,
        );
        potterOutputRoom = updateFirstToFill(
          potterOutputRoom,
          outputRoomDays(
            firingRoofTiles
              ? building.roofTiles ?? 0
              : building.pottery ?? 0,
            processorOutputTargetForBuilding(building)
              ?? (
                firingRoofTiles
                  ? BUILDING_STORAGE_CAPS.potter_kiln.roofTiles
                  : BUILDING_STORAGE_CAPS.potter_kiln.pottery
              )
              ?? 0,
            cycles * (
              firingRoofTiles
                ? POTTER_ROOF_TILES_PER_CYCLE
                : POTTER_POTTERY_PER_CYCLE
            ),
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'marketplace': {
        const branch = industrialMaterialBranch(
          industrialMaterialBranches,
          building,
          componentFor,
        );
        branch.hasStaffedMarket = true;
        branch.firstMarketId = earlierStableId(
          branch.firstMarketId,
          building.id,
        );
        // A staffed market can export pottery automatically, but it sustains
        // forge ore only when the player has selected the same
        // physical reserve that authorizes standing regional imports.
        const ironTarget = normalizeMarketplaceIronTarget(
          building.marketplaceIronTarget,
        );
        if (ironTarget > 0) {
          branch.standingIronImportMarkets += 1;
          branch.selectedIronReserve += ironTarget;
          branch.ironImportCofferGold += Math.max(0, building.gold ?? 0);
          branch.firstIronImportMarketId = earlierStableId(
            branch.firstIronImportMarketId,
            building.id,
          );
        }
        break;
      }
      default:
        break;
    }
  }
  return {
    fireDisabledProcessorSites,
    fireDisabledProcessorWorkers,
    firstFireDisabledProcessorId,
    millWorkers,
    millEffectiveWorkers,
    bakeryWorkers,
    breweryWorkers,
    smokehouseWorkers,
    spinnerWorkers,
    weaverWorkers,
    tanneryWorkers,
    cobblerWorkers,
    clayWorkers,
    charcoalWorkers,
    smithyWorkers,
    potterWorkers,
    toolEligibleSites,
    toolMaintainedSites,
    maintainedToolIronworkPerDay,
    fullToolIronworkPerDay,
    firstUnmaintainedToolSiteId,
    beverageOutputPerDay,
    beverageBarleyPerDay,
    beverageWaterPerDay,
    beverageFirewoodPerDay,
    millInputBuffer,
    bakeryInputBuffer,
    breweryInputBuffer,
    smokehouseInputBuffer,
    spinnerInputBuffer,
    weaverInputBuffer,
    tanneryInputBuffer,
    cobblerInputBuffer,
    charcoalInputBuffer,
    smithyInputBuffer,
    potterInputBuffer,
    millOutputRoom,
    bakeryOutputRoom,
    breweryOutputRoom,
    smokehouseOutputRoom,
    spinnerOutputRoom,
    weaverOutputRoom,
    tanneryOutputRoom,
    cobblerOutputRoom,
    charcoalOutputRoom,
    smithyOutputRoom,
    potterOutputRoom,
    grainChainBranches,
    prosperityRoadBranches,
    industrialMaterialBranches,
  };
}

function cyclesPerCalendarDay(
  kind: BuildingKind,
  assignedLabor: number,
  sabbathObserved: boolean,
  throughputMultiplier = 1,
): number {
  if (assignedLabor <= 0) return 0;
  const interval = getBuildingDefinition(kind).harvestInterval;
  if (interval <= 1e-6) return 0;
  const weeklyWorkShare = averageProductiveCalendarDayShare(sabbathObserved);
  return CALENDAR_SECONDS_PER_DAY
    * weeklyWorkShare
    * assignedLabor
    * Math.max(0, throughputMultiplier)
    / interval;
}

/**
 * Average whole-unit refill after a rack crosses below its reorder stock.
 * The crossing cycle itself is part of the load; omitting it makes a reorder
 * threshold equal to rack capacity look like a zero-capacity cart route.
 */
function civilianToolForecastRefillLoad(capacity: number): number {
  const normalizedCapacity = Math.max(0, capacity);
  if (normalizedCapacity <= 1e-9) return 0;
  const firstTriggeredStock = Math.max(
    0,
    civilianToolReorderStock(normalizedCapacity)
      - CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  );
  return Math.min(
    normalizedCapacity,
    Math.max(
      CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
      normalizedCapacity - firstTriggeredStock,
    ),
  );
}

type ToolMaintenanceRoutePlan = {
  deliveryCapacityPerDay: number;
  sustainableIronworkPerDay: number;
  uptime: number;
  cartWorkerDaysPerDay: number;
  forgeOutputAfterCarts: number;
  unreachableSites: number;
  firstBottleneckId: string | null;
};

/**
 * Long-run smithy-cart cadence. Each worksite consumes a large average refill
 * load (full rack minus reorder stock), then targets are load-balanced across
 * reachable smithies. Cart time also removes one smith from the forge, so
 * sustainable supply solves both the road-time and forgings constraints.
 */
function toolMaintenanceRoutePlan(
  toolSites: readonly ToolMaintenanceSiteForecast[],
  toolSmithies: readonly ToolSmithyForecast[],
  sabbathObserved: boolean,
  routeDistanceFor: ProductionRoadDistanceResolver | undefined,
  travelSpeedMultiplier: number,
): ToolMaintenanceRoutePlan {
  const sites = toolSites
    .filter((site) => site.demandPerDay > 1e-9 && site.refillLoad > 1e-9)
    .sort((left, right) =>
      compareStableEntityIds(left.building.id, right.building.id));
  const totalDemand = sites.reduce((sum, site) => sum + site.demandPerDay, 0);
  if (totalDemand <= 1e-9) {
    return {
      deliveryCapacityPerDay: 0,
      sustainableIronworkPerDay: 0,
      uptime: 1,
      cartWorkerDaysPerDay: 0,
      forgeOutputAfterCarts: toolSmithies.reduce(
        (sum, smithy) => sum + smithy.availableIronworkPerDay,
        0,
      ),
      unreachableSites: 0,
      firstBottleneckId: null,
    };
  }

  const workSeconds = CALENDAR_SECONDS_PER_DAY
    * averageProductiveCalendarDayShare(sabbathObserved);
  const speed = TIMBER_DELIVERY_SPEED_MPS
    * Math.max(1e-6, travelSpeedMultiplier);
  const smithyLoads = toolSmithies
    .filter((smithy) => smithy.availableIronworkPerDay > 1e-9)
    .map((smithy) => ({
    smithy,
    seconds: 0,
    demand: 0,
    firstSiteId: null as string | null,
    }));
  let reachableDemand = 0;
  let unreachableSites = 0;
  let firstBottleneckId: string | null = null;
  let fallbackSmithyIndex = 0;

  for (const site of sites) {
    let selected: (typeof smithyLoads)[number] | null = null;
    let selectedTripSeconds = Infinity;
    let selectedLoad = Infinity;
    if (!routeDistanceFor && smithyLoads.length > 0) {
      selected = smithyLoads[fallbackSmithyIndex % smithyLoads.length] ?? null;
      fallbackSmithyIndex += 1;
      selectedTripSeconds = Math.max(
        MIN_DELIVERY_TRIP_SEC,
        TIMBER_DELIVERY_UNLOAD_SEC,
      );
    } else {
      for (const candidate of smithyLoads) {
        const distance = routeDistanceFor?.(
          candidate.smithy.building,
          site.building,
        );
        if (distance == null || !Number.isFinite(distance) || distance < 0) continue;
        const tripSeconds = Math.max(
          MIN_DELIVERY_TRIP_SEC,
          distance * 2 / speed + TIMBER_DELIVERY_UNLOAD_SEC,
        );
        const requiredSeconds = tripSeconds * site.demandPerDay / site.refillLoad;
        const projectedLoad = Math.max(
          (candidate.seconds + requiredSeconds) / workSeconds,
          (candidate.demand + site.demandPerDay)
            / candidate.smithy.availableIronworkPerDay,
        );
        if (
          projectedLoad + 1e-9 < selectedLoad
          || (
            Math.abs(projectedLoad - selectedLoad) <= 1e-9
            && tripSeconds + 1e-9 < selectedTripSeconds
          )
        ) {
          selected = candidate;
          selectedTripSeconds = tripSeconds;
          selectedLoad = projectedLoad;
        }
      }
    }
    if (selected == null) {
      unreachableSites += 1;
      firstBottleneckId ??= site.building.id;
      continue;
    }
    selected.seconds += selectedTripSeconds * site.demandPerDay / site.refillLoad;
    selected.demand += site.demandPerDay;
    selected.firstSiteId ??= site.building.id;
    reachableDemand += site.demandPerDay;
  }

  if (reachableDemand <= 1e-9) {
    return {
      deliveryCapacityPerDay: 0,
      sustainableIronworkPerDay: 0,
      uptime: 0,
      cartWorkerDaysPerDay: 0,
      forgeOutputAfterCarts: toolSmithies.reduce(
        (sum, smithy) => sum + smithy.availableIronworkPerDay,
        0,
      ),
      unreachableSites,
      firstBottleneckId: firstBottleneckId ?? sites[0]?.building.id ?? null,
    };
  }

  let deliveryCapacityPerDay = 0;
  let sustainableIronworkPerDay = 0;
  let cartWorkerDaysPerDay = 0;
  let forgeOutputAfterCarts = 0;
  for (const load of smithyLoads) {
    if (load.seconds <= 1e-9 || load.demand <= 1e-9) {
      forgeOutputAfterCarts += load.smithy.availableIronworkPerDay;
      continue;
    }
    const routeScale = Math.max(0, Math.min(1, workSeconds / load.seconds));
    const laborLossAtFullUptime = load.seconds / workSeconds
      * load.smithy.ironworkPerWorkerDay;
    const supplyScale = load.smithy.availableIronworkPerDay
      / (load.demand + laborLossAtFullUptime);
    const sourceUptime = Math.max(0, Math.min(1, routeScale, supplyScale));
    deliveryCapacityPerDay += load.demand * routeScale;
    sustainableIronworkPerDay += load.demand * sourceUptime;
    cartWorkerDaysPerDay += load.seconds / workSeconds * sourceUptime;
    forgeOutputAfterCarts += Math.max(
      0,
      load.smithy.availableIronworkPerDay
        - laborLossAtFullUptime * sourceUptime,
    );
  }
  const uptime = sustainableIronworkPerDay / totalDemand;
  if (uptime < 1 - 1e-6 && firstBottleneckId == null) {
    const mostLoaded = smithyLoads
      .filter((load) => load.seconds > 1e-9)
      .sort((left, right) => right.seconds - left.seconds)[0];
    firstBottleneckId = mostLoaded?.firstSiteId ?? sites[0]?.building.id ?? null;
  }
  return {
    deliveryCapacityPerDay,
    sustainableIronworkPerDay,
    uptime,
    cartWorkerDaysPerDay,
    forgeOutputAfterCarts,
    unreachableSites,
    firstBottleneckId,
  };
}

function industrialMaterialRoadPlan(
  branches: ReadonlyMap<string, IndustrialMaterialBranch>,
  overview: Pick<
    ProcessorOverview,
    | 'clayWorkers'
    | 'potterWorkers'
    | 'charcoalWorkers'
    | 'smithyWorkers'
    | 'toolEligibleSites'
    | 'toolMaintainedSites'
    | 'maintainedToolIronworkPerDay'
    | 'fullToolIronworkPerDay'
    | 'firstUnmaintainedToolSiteId'
  >,
  prosperityRoadBranches: Map<string, ProsperityRoadBranch> | null,
  sabbathObserved: boolean,
  toolRouteDistanceFor: ProductionRoadDistanceResolver | undefined,
  toolCartTravelSpeedMultiplier: number,
): IndustrialMaterialPlan {
  let activeRoadBranches = 0;
  let potteryMatchedBranches = 0;
  let potteryBlockedBranches = 0;
  let smithyMatchedBranches = 0;
  let smithyBlockedBranches = 0;
  let clayOutputPerDay = 0;
  let potterInstalledOutputPerDay = 0;
  let potterInstalledRoofTilesPerDay = 0;
  let potteryOutputPerDay = 0;
  let roofTilesOutputPerDay = 0;
  let potteryDemandPerDay = 0;
  let potteryCoveredDemandPerDay = 0;
  let potteryExportSurplusPerDay = 0;
  let potteryStrandedPerDay = 0;
  let potterClayPerDay = 0;
  let potterFirewoodPerDay = 0;
  let potterWaterPerDay = 0;
  let charcoalOutputPerDay = 0;
  let charcoalFirewoodPerDay = 0;
  let smithyInstalledIronworkPerDay = 0;
  let ironworkOutputPerDay = 0;
  let localIronOutputPerDay = 0;
  let localIronConsumedPerDay = 0;
  let ironImportDemandPerDay = 0;
  let ironImportUncoveredPerDay = 0;
  let ironImportEnabledBranches = 0;
  let ironImportBlockedBranches = 0;
  let standingIronImportMarkets = 0;
  let selectedIronReserve = 0;
  let ironImportCofferGold = 0;
  let localIronStrandedPerDay = 0;
  let smithyIronPerDay = 0;
  let smithyCharcoalPerDay = 0;
  let smithyWaterPerDay = 0;
  let roadCoveredToolIronworkPerDay = 0;
  let roadCoveredFullToolIronworkPerDay = 0;
  let toolDeliveryCapacityPerDay = 0;
  let sustainableToolIronworkPerDay = 0;
  let toolCartWorkerDaysPerDay = 0;
  let toolUnreachableSites = 0;
  let ironworkProducedSurplusPerDay = 0;
  let firstPotteryBottleneckId: string | null = null;
  let firstPotteryBottleneckResidenceId: string | null = null;
  let firstSmithyBottleneckId: string | null = null;
  let firstIronImportMarketId: string | null = null;
  let firstIronImportAttentionId: string | null = null;
  let firstToolDeliveryBottleneckId: string | null = null;
  const allToolSites: ToolMaintenanceSiteForecast[] = [];
  const allToolSmithies: ToolSmithyForecast[] = [];

  for (const [branchKey, branch] of branches) {
    const branchPotteryDemand = branch.smokehousePotteryDemandPerDay
      + branch.householdPotteryDemandPerDay;
    const hasPotteryActivity = branch.clayOutputPerDay > 1e-9
      || branch.potterOutputPerDay > 1e-9
      || branch.potterRoofTileOutputPerDay > 1e-9
      || branchPotteryDemand > 1e-9;
    const hasSmithyActivity = branch.charcoalOutputPerDay > 1e-9
      || branch.localIronOutputPerDay > 1e-9
      || branch.smithyIronworkPerDay > 1e-9
      || branch.fullToolIronworkPerDay > 1e-9;
    if (hasPotteryActivity || hasSmithyActivity) {
      activeRoadBranches += 1;
    }

    clayOutputPerDay += branch.clayOutputPerDay;
    potterInstalledOutputPerDay += branch.potterOutputPerDay;
    potterInstalledRoofTilesPerDay += branch.potterRoofTileOutputPerDay;
    potteryDemandPerDay += branchPotteryDemand;
    charcoalOutputPerDay += branch.charcoalOutputPerDay;
    charcoalFirewoodPerDay += branch.charcoalFirewoodPerDay;
    localIronOutputPerDay += branch.localIronOutputPerDay;
    smithyInstalledIronworkPerDay += branch.smithyIronworkPerDay;
    standingIronImportMarkets += branch.standingIronImportMarkets;
    selectedIronReserve += branch.selectedIronReserve;
    ironImportCofferGold += branch.ironImportCofferGold;
    if (branch.firstIronImportMarketId !== null) {
      firstIronImportMarketId = earlierStableId(
        firstIronImportMarketId,
        branch.firstIronImportMarketId,
      );
    }

    const kilnInputScale = branch.potterClayPerDay > 1e-9
      ? Math.min(
        1,
        branch.clayOutputPerDay / branch.potterClayPerDay,
        branch.hasOperationalWell ? 1 : 0,
      )
      : 0;
    const branchPotteryOutput = branch.potterOutputPerDay * kilnInputScale;
    const branchRoofTilesOutput = branch.potterRoofTileOutputPerDay
      * kilnInputScale;
    const prosperityBranch = prosperityRoadBranches?.get(branchKey);
    if (prosperityBranch) {
      prosperityBranch.potteryOutputPerDay = branchPotteryOutput;
    }
    const branchPotteryCoverage = Math.min(
      branchPotteryOutput,
      branchPotteryDemand,
    );
    const branchPotterySurplus = Math.max(
      0,
      branchPotteryOutput - branchPotteryCoverage,
    );
    potteryOutputPerDay += branchPotteryOutput;
    roofTilesOutputPerDay += branchRoofTilesOutput;
    potteryCoveredDemandPerDay += branchPotteryCoverage;
    potterClayPerDay += branch.potterClayPerDay * kilnInputScale;
    potterFirewoodPerDay += branch.potterFirewoodPerDay * kilnInputScale;
    potterWaterPerDay += branch.potterClayPerDay
      / POTTER_CLAY_PER_CYCLE
      * POTTER_WATER_PER_CYCLE
      * kilnInputScale;
    if (branch.hasStaffedMarket) {
      potteryExportSurplusPerDay += branchPotterySurplus;
    } else {
      potteryStrandedPerDay += branchPotterySurplus;
    }

    const potteryHasDownstream = branchPotteryDemand > 1e-9
      || branch.hasStaffedMarket;
    if (branchPotteryOutput > 1e-9 && potteryHasDownstream) {
      potteryMatchedBranches += 1;
    }
    const potteryBlocked = (
      branchPotteryDemand > branchPotteryCoverage + 1e-9
      || branch.potterOutputPerDay > branchPotteryOutput + 1e-9
      || (branch.clayOutputPerDay > 1e-9 && branch.potterOutputPerDay <= 1e-9)
      || (branchPotterySurplus > 1e-9 && !branch.hasStaffedMarket)
    );
    if (potteryBlocked) {
      potteryBlockedBranches += 1;
      const candidate = branch.potterOutputPerDay > 1e-9
        ? branch.firstPotterId
        : branch.smokehousePotteryDemandPerDay > 1e-9
          ? branch.firstSmokehouseId
          : branch.firstClayId;
      if (candidate !== null) {
        firstPotteryBottleneckId = earlierStableId(
          firstPotteryBottleneckId,
          candidate,
        );
      }
      if (
        candidate === null
        && branch.householdPotteryDemandPerDay > 1e-9
        && branch.firstResidenceId !== null
      ) {
        firstPotteryBottleneckResidenceId = earlierStableId(
          firstPotteryBottleneckResidenceId,
          branch.firstResidenceId,
        );
      }
    }

    const charcoalSupportedIronwork = branch.charcoalOutputPerDay
      * SMITHY_IRONWORK_PER_CYCLE
      / SMITHY_CHARCOAL_PER_CYCLE;
    const localIronSupportedIronwork = branch.localIronOutputPerDay
      * SMITHY_IRONWORK_PER_CYCLE
      / SMITHY_IRON_PER_CYCLE;
    const nonIronSupportedIronwork = Math.min(
      branch.smithyIronworkPerDay,
      charcoalSupportedIronwork,
      branch.hasOperationalWell ? Number.POSITIVE_INFINITY : 0,
    );
    const nonIronSupportedRawIron = nonIronSupportedIronwork
      * SMITHY_IRON_PER_CYCLE
      / SMITHY_IRONWORK_PER_CYCLE;
    const branchIronImportShortfall = Math.max(
      0,
      nonIronSupportedRawIron - branch.localIronOutputPerDay,
    );
    const standingIronImportEnabled = branch.standingIronImportMarkets > 0;
    if (branchIronImportShortfall > 1e-9) {
      if (standingIronImportEnabled) {
        ironImportEnabledBranches += 1;
      } else {
        ironImportBlockedBranches += 1;
        ironImportUncoveredPerDay += branchIronImportShortfall;
        const attention = branch.firstMarketId ?? branch.firstSmithyId;
        if (attention !== null) {
          firstIronImportAttentionId = earlierStableId(
            firstIronImportAttentionId,
            attention,
          );
        }
      }
    }
    const branchIronworkOutput = Math.min(
      nonIronSupportedIronwork,
      standingIronImportEnabled
        ? Number.POSITIVE_INFINITY
        : localIronSupportedIronwork,
    );
    const branchIronUse = branchIronworkOutput
      * SMITHY_IRON_PER_CYCLE
      / SMITHY_IRONWORK_PER_CYCLE;
    const branchLocalIronConsumed = Math.min(
      branch.localIronOutputPerDay,
      branchIronUse,
    );
    ironworkOutputPerDay += branchIronworkOutput;
    smithyIronPerDay += branchIronUse;
    localIronConsumedPerDay += branchLocalIronConsumed;
    ironImportDemandPerDay += Math.max(
      0,
      branchIronUse - branchLocalIronConsumed,
    );
    localIronStrandedPerDay += Math.max(
      0,
      branch.localIronOutputPerDay - branchLocalIronConsumed,
    );
    smithyCharcoalPerDay += branchIronworkOutput
      * SMITHY_CHARCOAL_PER_CYCLE
      / SMITHY_IRONWORK_PER_CYCLE;
    smithyWaterPerDay += branchIronworkOutput
      * SMITHY_WATER_PER_CYCLE
      / SMITHY_IRONWORK_PER_CYCLE;
    const installedSmithyOutput = branch.toolSmithies.reduce(
      (sum, smithy) => sum + smithy.ironworkPerWorkerDay
        * Math.max(0, smithy.building.assignedLabor),
      0,
    );
    for (const smithy of branch.toolSmithies) {
      const installedShare = installedSmithyOutput > 1e-9
        ? smithy.ironworkPerWorkerDay
          * Math.max(0, smithy.building.assignedLabor)
          / installedSmithyOutput
        : 0;
      smithy.availableIronworkPerDay = branchIronworkOutput * installedShare;
      allToolSmithies.push(smithy);
    }
    allToolSites.push(...branch.toolSites);
    if (branchIronworkOutput > 1e-9) {
      smithyMatchedBranches += 1;
    }
    const smithyBlocked = (
      branch.smithyIronworkPerDay > branchIronworkOutput + 1e-9
      || (branch.charcoalOutputPerDay > 1e-9 && branch.smithyIronworkPerDay <= 1e-9)
      || (branch.localIronOutputPerDay > 1e-9 && branch.smithyIronworkPerDay <= 1e-9)
      || branch.fullToolIronworkPerDay > branchIronworkOutput + 1e-9
    );
    if (smithyBlocked) {
      smithyBlockedBranches += 1;
      const candidate = branch.firstSmithyId
        ?? branch.firstToolSiteId
        ?? branch.firstCharcoalId
        ?? branch.firstIronMineId;
      if (candidate !== null) {
        firstSmithyBottleneckId = earlierStableId(
          firstSmithyBottleneckId,
          candidate,
        );
      }
    }
  }

  const toolRoutes = toolMaintenanceRoutePlan(
    allToolSites,
    allToolSmithies,
    sabbathObserved,
    toolRouteDistanceFor,
    toolCartTravelSpeedMultiplier,
  );
  const maintainedShare = overview.fullToolIronworkPerDay > 1e-9
    ? Math.min(
      1,
      overview.maintainedToolIronworkPerDay / overview.fullToolIronworkPerDay,
    )
    : 1;
  roadCoveredToolIronworkPerDay = toolRoutes.sustainableIronworkPerDay
    * maintainedShare;
  roadCoveredFullToolIronworkPerDay = toolRoutes.sustainableIronworkPerDay;
  toolDeliveryCapacityPerDay = toolRoutes.deliveryCapacityPerDay;
  sustainableToolIronworkPerDay = toolRoutes.sustainableIronworkPerDay;
  toolCartWorkerDaysPerDay = toolRoutes.cartWorkerDaysPerDay;
  toolUnreachableSites = toolRoutes.unreachableSites;
  firstToolDeliveryBottleneckId = toolRoutes.firstBottleneckId;
  // Finished ironwork is surplus as soon as it is made. Tool upkeep remains a
  // future demand and may therefore need to draw the same goods back from
  // shared physical stock once a consumer rack requests a refill.
  ironworkProducedSurplusPerDay = Math.max(0, toolRoutes.forgeOutputAfterCarts);
  if (toolRoutes.uptime < 1 - 1e-6) {
    smithyBlockedBranches += 1;
    if (toolRoutes.firstBottleneckId !== null) {
      firstSmithyBottleneckId = earlierStableId(
        firstSmithyBottleneckId,
        toolRoutes.firstBottleneckId,
      );
    }
  }

  return {
    activeRoadBranches,
    potteryMatchedBranches,
    potteryBlockedBranches,
    smithyMatchedBranches,
    smithyBlockedBranches,
    clayWorkers: overview.clayWorkers,
    potterWorkers: overview.potterWorkers,
    charcoalWorkers: overview.charcoalWorkers,
    smithyWorkers: overview.smithyWorkers,
    toolEligibleSites: overview.toolEligibleSites,
    toolMaintainedSites: overview.toolMaintainedSites,
    clayOutputPerDay,
    potterInstalledOutputPerDay,
    potteryOutputPerDay,
    potterInstalledRoofTilesPerDay,
    roofTilesOutputPerDay,
    potteryDemandPerDay,
    potteryCoveredDemandPerDay,
    potteryShortfallPerDay: Math.max(
      0,
      potteryDemandPerDay - potteryCoveredDemandPerDay,
    ),
    potteryExportSurplusPerDay,
    potteryStrandedPerDay,
    potterClayPerDay,
    potterFirewoodPerDay,
    potterWaterPerDay,
    charcoalOutputPerDay,
    charcoalFirewoodPerDay,
    smithyInstalledIronworkPerDay,
    ironworkOutputPerDay,
    localIronOutputPerDay,
    localIronConsumedPerDay,
    ironImportDemandPerDay,
    ironImportUncoveredPerDay,
    ironImportEnabledBranches,
    ironImportBlockedBranches,
    standingIronImportMarkets,
    selectedIronReserve,
    ironImportCofferGold,
    localIronStrandedPerDay,
    smithyIronPerDay,
    smithyCharcoalPerDay,
    smithyWaterPerDay,
    maintainedToolIronworkPerDay: overview.maintainedToolIronworkPerDay,
    fullToolIronworkPerDay: overview.fullToolIronworkPerDay,
    roadCoveredToolIronworkPerDay,
    roadCoveredFullToolIronworkPerDay,
    toolDeliveryCapacityPerDay,
    sustainableToolIronworkPerDay,
    sustainableToolUptime: overview.fullToolIronworkPerDay > 1e-9
      ? Math.max(
        0,
        Math.min(1, sustainableToolIronworkPerDay / overview.fullToolIronworkPerDay),
      )
      : 1,
    toolCartWorkerDaysPerDay,
    toolRefillLoad: civilianToolForecastRefillLoad(
      BUILDING_STORAGE_CAPS.lumber_mill.ironwork ?? 0,
    ),
    toolUnreachableSites,
    ironworkProducedSurplusPerDay,
    firstPotteryBottleneckId,
    firstPotteryBottleneckResidenceId,
    firstSmithyBottleneckId,
    firstIronImportMarketId,
    firstIronImportAttentionId,
    firstUnmaintainedToolSiteId: overview.firstUnmaintainedToolSiteId,
    firstToolDeliveryBottleneckId,
  };
}

function grainChainRoadPlan(
  branches: ReadonlyMap<string, GrainChainBranch>,
  sabbathObserved: boolean,
  hypotheticalFoodPerDay: number,
): GrainChainRoadPlan & {
  matchedFoodPerDay: number;
  matchedBakeryCyclesPerDay: number;
  matchedMillCyclesPerDay: number;
  grainRoadBranches: ReadonlyMap<string, ProductionGrainRoadBranch>;
} {
  let matchedFoodPerDay = 0;
  let matchedBakeryCyclesPerDay = 0;
  let matchedMillCyclesPerDay = 0;
  let activeBranches = 0;
  let matchedBranches = 0;
  let millOnlyBranches = 0;
  let bakeryOnlyBranches = 0;
  let largestImbalance = 0;
  let firstImbalancedBuildingId: string | null = null;
  const grainRoadBranches = new Map<string, ProductionGrainRoadBranch>();

  for (const [key, branch] of branches) {
    const millCycles = cyclesPerCalendarDay(
      'watermill',
      branch.millEffectiveWorkers,
      sabbathObserved,
    );
    const bakeryCycles = cyclesPerCalendarDay(
      'bakery',
      branch.bakeryWorkers,
      sabbathObserved,
    );
    const millFlourRate = branch.millEffectiveWorkers > 1e-9
      ? branch.millFlourRateWork / branch.millEffectiveWorkers
      : WATERMILL_RYE_FLOUR_PER_CYCLE;
    const bakeryBreadRate = branch.bakeryWorkers > 0
      ? branch.bakeryBreadRateWork / branch.bakeryWorkers
      : BAKERY_RYE_BREAD_PER_CYCLE;
    const millFlourPerDay = millCycles * millFlourRate;
    const bakeryFlourPerDay = bakeryCycles * BAKERY_FLOUR_PER_CYCLE;
    const matchedFlourPerDay = Math.min(millFlourPerDay, bakeryFlourPerDay);
    matchedBakeryCyclesPerDay += matchedFlourPerDay / BAKERY_FLOUR_PER_CYCLE;
    matchedMillCyclesPerDay += matchedFlourPerDay / millFlourRate;
    matchedFoodPerDay += matchedFlourPerDay
      * bakeryBreadRate
      / BAKERY_FLOUR_PER_CYCLE;
    const breadGrainPerDay = matchedFlourPerDay
      / millFlourRate
      * WATERMILL_GRAIN_PER_CYCLE;
    const firstProcessorId = breadGrainPerDay > 1e-9
      ? branch.firstMillId
      : null;
    if (breadGrainPerDay > 1e-9) {
      grainRoadBranches.set(key, {
        breadGrainPerDay,
        firstProcessorId,
      });
    }

    if (branch.millWorkers <= 0 && branch.bakeryWorkers <= 0) continue;
    activeBranches += 1;

    if (branch.millWorkers > 0 && branch.bakeryWorkers > 0) {
      matchedBranches += 1;
    } else if (branch.millWorkers > 0) {
      millOnlyBranches += 1;
    } else if (branch.bakeryWorkers > 0) {
      bakeryOnlyBranches += 1;
    }

    const imbalance = Math.abs(millFlourPerDay - bakeryFlourPerDay)
      * bakeryBreadRate
      / BAKERY_FLOUR_PER_CYCLE;
    const candidateId = millFlourPerDay > bakeryFlourPerDay
      ? branch.firstMillId
      : branch.firstBakeryId;
    if (
      candidateId !== null
      && (
        imbalance > largestImbalance + 1e-9
        || (
          Math.abs(imbalance - largestImbalance) <= 1e-9
          && (
            firstImbalancedBuildingId === null
            || compareStableEntityIds(candidateId, firstImbalancedBuildingId) < 0
          )
        )
      )
    ) {
      largestImbalance = imbalance;
      firstImbalancedBuildingId = candidateId;
    }
  }

  const fragmentationFoodPerDay = Math.max(
    0,
    hypotheticalFoodPerDay - matchedFoodPerDay,
  );
  return {
    activeBranches,
    matchedBranches,
    millOnlyBranches,
    bakeryOnlyBranches,
    hypotheticalFoodPerDay,
    fragmentationFoodPerDay,
    firstImbalancedBuildingId: fragmentationFoodPerDay > 0.05
      ? firstImbalancedBuildingId
      : null,
    matchedFoodPerDay,
    matchedBakeryCyclesPerDay,
    matchedMillCyclesPerDay,
    grainRoadBranches,
  };
}

/**
 * Long-run installed workshop capacity using the authoritative calendar day, cycle
 * lengths, labor scaling, and Sabbath policy. Values deliberately assume full
 * input supply; the Town Hall labels them as capacity rather than production.
 * When a component resolver is supplied, multi-stage bread capacity is matched
 * inside real cart-connected road branches and sustained bread-grain draw
 * is retained for the physical reserve ledger without any shortest-path solves.
 */
export function computeSettlementProductionCapacity(
  state: GameState,
  sabbathObserved: boolean,
  roadComponentFor?: ProductionRoadComponentResolver,
  watermillThroughputMultiplier = 1,
  surfaceClayThroughputMultiplier = 1,
  currentPreservedFoodDemandMultiplier = 1,
  calendarMonth?: number,
  _resourceAbundance = 50,
  charcoalBurnerThroughputMultiplier = 1,
  toolRouteDistanceFor?: ProductionRoadDistanceResolver,
  toolCartTravelSpeedMultiplier = 1,
  windmillWeatherThroughputMultiplier = 1,
): SettlementProductionCapacity {
  const normalizedWatermillThroughput = Number.isFinite(
    watermillThroughputMultiplier,
  )
    ? Math.max(0, watermillThroughputMultiplier)
    : 1;
  const normalizedSurfaceClayThroughput = Number.isFinite(
    surfaceClayThroughputMultiplier,
  )
    ? Math.max(0, surfaceClayThroughputMultiplier)
    : 1;
  const normalizedCharcoalBurnerThroughput = Number.isFinite(
    charcoalBurnerThroughputMultiplier,
  )
    ? Math.max(0, charcoalBurnerThroughputMultiplier)
    : 1;
  const normalizedWindmillWeatherThroughput = Number.isFinite(
    windmillWeatherThroughputMultiplier,
  )
    ? Math.max(0, windmillWeatherThroughputMultiplier)
    : 1;
  const normalizedPreservedFoodDemandMultiplier = Number.isFinite(
    currentPreservedFoodDemandMultiplier,
  )
    ? Math.max(0, currentPreservedFoodDemandMultiplier)
    : 1;
  const {
    fireDisabledProcessorSites,
    fireDisabledProcessorWorkers,
    firstFireDisabledProcessorId,
    millWorkers,
    bakeryWorkers,
    breweryWorkers,
    smokehouseWorkers,
    spinnerWorkers,
    weaverWorkers,
    tanneryWorkers,
    cobblerWorkers,
    clayWorkers,
    charcoalWorkers,
    smithyWorkers,
    potterWorkers,
    toolEligibleSites,
    toolMaintainedSites,
    maintainedToolIronworkPerDay,
    fullToolIronworkPerDay,
    firstUnmaintainedToolSiteId,
    beverageOutputPerDay,
    beverageBarleyPerDay,
    beverageWaterPerDay,
    beverageFirewoodPerDay,
    millInputBuffer,
    bakeryInputBuffer,
    breweryInputBuffer,
    smokehouseInputBuffer,
    spinnerInputBuffer,
    weaverInputBuffer,
    tanneryInputBuffer,
    cobblerInputBuffer,
    charcoalInputBuffer,
    smithyInputBuffer,
    potterInputBuffer,
    millOutputRoom,
    bakeryOutputRoom,
    breweryOutputRoom,
    smokehouseOutputRoom,
    spinnerOutputRoom,
    weaverOutputRoom,
    tanneryOutputRoom,
    cobblerOutputRoom,
    charcoalOutputRoom,
    smithyOutputRoom,
    potterOutputRoom,
    grainChainBranches,
    prosperityRoadBranches,
    industrialMaterialBranches,
  } = completedProcessorOverview(
    state,
    sabbathObserved,
    roadComponentFor,
    normalizedWatermillThroughput,
    normalizedWindmillWeatherThroughput,
    normalizedSurfaceClayThroughput,
    normalizedCharcoalBurnerThroughput,
    calendarMonth,
  );
  const smokehouseCycles = cyclesPerCalendarDay(
    'smokehouse',
    smokehouseWorkers,
    sabbathObserved,
  );
  const spinnerCycles = cyclesPerCalendarDay(
    'spinning_retting_house',
    spinnerWorkers,
    sabbathObserved,
  );
  const weaverCycles = cyclesPerCalendarDay('weaver', weaverWorkers, sabbathObserved);
  const textileCycles = Math.min(spinnerCycles, weaverCycles);
  const tanneryCycles = cyclesPerCalendarDay('tannery', tanneryWorkers, sabbathObserved);
  const cobblerCycles = cyclesPerCalendarDay('cobbler', cobblerWorkers, sabbathObserved);

  let flourOutputPerDay = 0;
  let bakeryFlourCapacityPerDay = 0;
  let bakeryBreadCapacityPerDay = 0;
  for (const branch of grainChainBranches.values()) {
    const branchMillCycles = cyclesPerCalendarDay(
      'watermill',
      branch.millEffectiveWorkers,
      sabbathObserved,
    );
    const branchBakeryCycles = cyclesPerCalendarDay(
      'bakery',
      branch.bakeryWorkers,
      sabbathObserved,
    );
    const millRate = branch.millEffectiveWorkers > 1e-9
      ? branch.millFlourRateWork / branch.millEffectiveWorkers
      : WATERMILL_RYE_FLOUR_PER_CYCLE;
    const bakeryRate = branch.bakeryWorkers > 0
      ? branch.bakeryBreadRateWork / branch.bakeryWorkers
      : BAKERY_RYE_BREAD_PER_CYCLE;
    flourOutputPerDay += branchMillCycles * millRate;
    bakeryFlourCapacityPerDay += branchBakeryCycles * BAKERY_FLOUR_PER_CYCLE;
    bakeryBreadCapacityPerDay += branchBakeryCycles * bakeryRate;
  }
  const breadPerFlour = bakeryFlourCapacityPerDay > 1e-9
    ? bakeryBreadCapacityPerDay / bakeryFlourCapacityPerDay
    : BAKERY_RYE_BREAD_PER_CYCLE / BAKERY_FLOUR_PER_CYCLE;
  const hypotheticalBreadFoodPerDay = Math.min(
    bakeryBreadCapacityPerDay,
    flourOutputPerDay * breadPerFlour,
  );
  const {
    matchedFoodPerDay: breadFoodCapacityPerDay,
    matchedBakeryCyclesPerDay: breadCyclesPerDay,
    matchedMillCyclesPerDay: millCyclesForBread,
    grainRoadBranches,
    ...grainChainRoads
  } = grainChainRoadPlan(
    grainChainBranches,
    sabbathObserved,
    hypotheticalBreadFoodPerDay,
  );
  let tierTwoPlusResidents = 0;
  let tierThreePlusResidents = 0;
  let tierFourResidents = 0;
  let fireDisabledTierFourHomes = 0;
  let fireDisabledTierFourResidents = 0;
  let fireDisabledTierFourHousingCapacity = 0;
  const fireDisabledResidences = fireDisabledResidenceIds(
    state.fireIncidents.values(),
  );
  for (const residence of state.residences.values()) {
    if (residence.abandoned || residence.tier < 2) continue;
    if (fireDisabledResidences.has(residence.id)) {
      if (residence.tier >= 4) {
        fireDisabledTierFourHomes += 1;
        fireDisabledTierFourResidents += Math.max(0, residence.population);
        fireDisabledTierFourHousingCapacity += Math.max(
          0,
          residence.populationCapacity,
        );
      }
      continue;
    }
    tierTwoPlusResidents += residence.population;
    if (residence.tier >= 3) {
      tierThreePlusResidents += residence.population;
    }
    if (prosperityRoadBranches && roadComponentFor) {
      const branch = prosperityRoadBranch(
        prosperityRoadBranches,
        productionRoadBranchKey(
          roadComponentFor(residence),
          'residence',
          residence.id,
        ),
      );
      branch.tierTwoPlusResidents += Math.max(0, residence.population);
      if (residence.tier >= 3) {
        branch.tierThreePlusResidents += Math.max(0, residence.population);
      }
      branch.firstClothResidenceId = earlierStableId(
        branch.firstClothResidenceId,
        residence.id,
      );
      if (residence.tier < 4) {
        branch.lowerTierAleClothResidents += Math.max(0, residence.population);
        if (residence.tier >= 3) {
          branch.lowerTierShoesResidents += Math.max(0, residence.population);
        }
      }
    }
    if (residence.tier >= 4) {
      tierFourResidents += residence.population;
      const materialBranch = industrialMaterialBranchByKey(
        industrialMaterialBranches,
        roadComponentFor
          ? productionRoadBranchKey(
              roadComponentFor(residence),
              'residence',
              residence.id,
            )
          : 'settlement',
      );
      const householdPotteryDemand = Math.max(0, residence.population)
        * RESIDENCE_POTTERY_PER_PERSON_PER_SEC
        * CALENDAR_SECONDS_PER_DAY;
      materialBranch.householdPotteryDemandPerDay += householdPotteryDemand;
      if (householdPotteryDemand > 1e-9) {
        materialBranch.firstResidenceId = earlierStableId(
          materialBranch.firstResidenceId,
          residence.id,
        );
      }
      if (prosperityRoadBranches && roadComponentFor) {
        const branch = prosperityRoadBranch(
          prosperityRoadBranches,
          productionRoadBranchKey(
            roadComponentFor(residence),
            'residence',
            residence.id,
          ),
        );
        branch.currentResidents += Math.max(0, residence.population);
        branch.fullResidents += Math.max(0, residence.populationCapacity);
        branch.firstResidenceId = earlierStableId(
          branch.firstResidenceId,
          residence.id,
        );
      }
    }
  }
  const industrialMaterials = industrialMaterialRoadPlan(
    industrialMaterialBranches,
    {
      clayWorkers,
      charcoalWorkers,
      smithyWorkers,
      potterWorkers,
      toolEligibleSites,
      toolMaintainedSites,
      maintainedToolIronworkPerDay,
      fullToolIronworkPerDay,
      firstUnmaintainedToolSiteId,
    },
    prosperityRoadBranches,
    sabbathObserved,
    toolRouteDistanceFor,
    Number.isFinite(toolCartTravelSpeedMultiplier)
      ? Math.max(1e-6, toolCartTravelSpeedMultiplier)
      : 1,
  );

  return {
    capacityDaysPerWeek:
      averageProductiveCalendarDayShare(sabbathObserved) * 7,
    watermillThroughputMultiplier: normalizedWatermillThroughput,
    windmillWeatherThroughputMultiplier: normalizedWindmillWeatherThroughput,
    surfaceClayThroughputMultiplier: normalizedSurfaceClayThroughput,
    charcoalBurnerThroughputMultiplier: normalizedCharcoalBurnerThroughput,
    fireDisabledProcessorSites,
    fireDisabledProcessorWorkers,
    firstFireDisabledProcessorId,
    millWorkers,
    bakeryWorkers,
    breweryWorkers,
    smokehouseWorkers,
    spinnerWorkers,
    weaverWorkers,
    tanneryWorkers,
    cobblerWorkers,
    millInputBuffer,
    bakeryInputBuffer,
    breweryInputBuffer,
    smokehouseInputBuffer,
    spinnerInputBuffer,
    weaverInputBuffer,
    tanneryInputBuffer,
    cobblerInputBuffer,
    charcoalInputBuffer,
    smithyInputBuffer,
    potterInputBuffer,
    millOutputRoom,
    bakeryOutputRoom,
    breweryOutputRoom,
    smokehouseOutputRoom,
    spinnerOutputRoom,
    weaverOutputRoom,
    tanneryOutputRoom,
    cobblerOutputRoom,
    charcoalOutputRoom,
    smithyOutputRoom,
    potterOutputRoom,
    flourOutputPerDay,
    bakeryFlourCapacityPerDay,
    breadFoodCapacityPerDay,
    grainChainRoads,
    grainRoadBranches: roadComponentFor ? grainRoadBranches : null,
    breadGrainPerDay: millCyclesForBread * WATERMILL_GRAIN_PER_CYCLE,
    breadWaterPerDay: breadCyclesPerDay * BAKERY_WATER_PER_CYCLE,
    breadFirewoodPerDay: breadCyclesPerDay * BAKERY_FIREWOOD_PER_CYCLE,
    aleOutputPerDay: beverageOutputPerDay,
    aleBarleyPerDay: beverageBarleyPerDay,
    aleWaterPerDay: beverageWaterPerDay,
    aleFirewoodPerDay: beverageFirewoodPerDay,
    preservedFoodOutputPerDay: smokehouseCycles * SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
    preservationFreshFoodPerDay: smokehouseCycles * SMOKEHOUSE_FOOD_PER_CYCLE,
    preservationFirewoodPerDay: smokehouseCycles * SMOKEHOUSE_FIREWOOD_PER_CYCLE,
    preservationSaltPerDay: smokehouseCycles * SMOKEHOUSE_SALT_PER_CYCLE,
    preservationPotteryPerDay: smokehouseCycles * SMOKEHOUSE_POTTERY_PER_CYCLE,
    spinnerIntermediateCapacityPerDay:
      spinnerCycles * SPINNING_RETTING_YARN_PER_CYCLE,
    weaverClothCapacityPerDay: weaverCycles * WEAVER_CLOTH_PER_CYCLE,
    yarnOutputPerDay: spinnerCycles * SPINNING_RETTING_YARN_PER_CYCLE,
    linenOutputPerDay: spinnerCycles * SPINNING_RETTING_LINEN_PER_CYCLE,
    clothOutputPerDay: textileCycles * WEAVER_CLOTH_PER_CYCLE,
    clothYarnPerDay: textileCycles * WEAVER_YARN_PER_CYCLE,
    clothLinenPerDay: textileCycles * WEAVER_LINEN_PER_CYCLE,
    clothWoolPerDay: textileCycles * SPINNING_RETTING_WOOL_PER_CYCLE,
    clothFlaxPerDay: textileCycles * SPINNING_RETTING_FLAX_PER_CYCLE,
    clothFlaxWaterPerDay:
      textileCycles * SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
    leatherOutputPerDay: tanneryCycles * TANNERY_LEATHER_PER_CYCLE,
    leatherHidesPerDay: tanneryCycles * TANNERY_HIDES_PER_CYCLE,
    leatherWaterPerDay: tanneryCycles * TANNERY_WATER_PER_CYCLE,
    leatherFirewoodPerDay: tanneryCycles * TANNERY_FIREWOOD_PER_CYCLE,
    shoesOutputPerDay: cobblerCycles * COBBLER_SHOES_PER_CYCLE,
    shoesLeatherPerDay: cobblerCycles * COBBLER_LEATHER_PER_CYCLE,
    industrialMaterials,
    tierTwoPlusResidents,
    tierThreePlusResidents,
    tierFourResidents,
    fireDisabledTierFourHomes,
    fireDisabledTierFourResidents,
    fireDisabledTierFourHousingCapacity,
    aleDemandPerDay:
      tierTwoPlusResidents
        * RESIDENCE_ALE_PER_PERSON_PER_SEC
        * CALENDAR_SECONDS_PER_DAY,
    preservedFoodDemandPerDay:
      tierFourResidents
      * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
      * CALENDAR_SECONDS_PER_DAY
      * RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
    currentPreservedFoodDemandPerDay:
      tierFourResidents
      * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
      * CALENDAR_SECONDS_PER_DAY
      * normalizedPreservedFoodDemandMultiplier,
    currentPreservedFoodDemandMultiplier:
      normalizedPreservedFoodDemandMultiplier,
    clothDemandPerDay:
      tierTwoPlusResidents
        * RESIDENCE_CLOTH_PER_PERSON_PER_SEC
        * CALENDAR_SECONDS_PER_DAY,
    shoesDemandPerDay:
      tierThreePlusResidents
        * RESIDENCE_SHOES_PER_PERSON_PER_SEC
        * CALENDAR_SECONDS_PER_DAY,
    potteryOutputPerDay: industrialMaterials.potteryOutputPerDay,
    potteryDemandPerDay:
      tierFourResidents
        * RESIDENCE_POTTERY_PER_PERSON_PER_SEC
        * CALENDAR_SECONDS_PER_DAY,
    prosperityRoadBranches,
  };
}

export function processorBottleneckBuildingId(
  input: ProcessorInputBuffer | null,
  output: ProcessorOutputRoom | null,
): string | null {
  if (input === null) return output?.buildingId ?? null;
  if (output === null) return input.buildingId;
  return input.days <= output.days ? input.buildingId : output.buildingId;
}

export function grainChainBalanceLabel(
  capacity: Pick<
    SettlementProductionCapacity,
    'millWorkers' | 'bakeryWorkers' | 'flourOutputPerDay' | 'bakeryFlourCapacityPerDay'
  > & {
    grainChainRoads?: Pick<GrainChainRoadPlan, 'fragmentationFoodPerDay'>;
  },
): string {
  if (capacity.millWorkers <= 0 && capacity.bakeryWorkers <= 0) {
    return 'No staffed mill or bakery';
  }
  if (capacity.millWorkers <= 0) return 'Mill missing — bakeries cannot receive flour';
  if (capacity.bakeryWorkers <= 0) return 'Bakery missing — milled flour has no destination';
  if ((capacity.grainChainRoads?.fragmentationFoodPerDay ?? 0) > 0.05) {
    return `Road-limited — ${capacity.grainChainRoads!.fragmentationFoodPerDay.toFixed(1)} food / day stranded between branches`;
  }
  const difference = capacity.flourOutputPerDay - capacity.bakeryFlourCapacityPerDay;
  const tolerance = Math.max(
    0.5,
    Math.min(capacity.flourOutputPerDay, capacity.bakeryFlourCapacityPerDay) * 0.05,
  );
  if (Math.abs(difference) <= tolerance) return 'Balanced milling and baking capacity';
  if (difference < 0) return 'Mill-limited — add mill labor before bakery labor';
  return 'Bakery-limited — add bakery labor before mill labor';
}
