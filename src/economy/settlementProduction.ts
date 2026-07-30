import {
  BREWERY_ALE_PER_CYCLE,
  BREWERY_BARLEY_PER_MALT_CYCLE,
  BREWERY_BREWING_FIREWOOD_PER_CYCLE,
  BREWERY_BREWING_WATER_PER_CYCLE,
  BREWERY_MALT_PER_CYCLE,
  BREWERY_MALTING_FIREWOOD_PER_CYCLE,
  BREWERY_MALTING_WATER_PER_CYCLE,
  BUILDING_STORAGE_CAPS,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  CHARCOAL_BURNER_CHARCOAL_PER_CYCLE,
  CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
  FARM_TOOL_IRONWORK_PER_WORKER_DAY,
  CLAY_PIT_CLAY_PER_CYCLE,
  GRANARY_FIREWOOD_PER_CYCLE,
  GRANARY_FLOUR_PER_CYCLE,
  GRANARY_FOOD_PER_CYCLE,
  GRANARY_WATER_PER_CYCLE,
  POTTER_CLAY_PER_CYCLE,
  POTTER_FIREWOOD_PER_CYCLE,
  POTTER_POTTERY_PER_CYCLE,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
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
  WATERMILL_FLOUR_PER_CYCLE,
  WATERMILL_GRAIN_PER_CYCLE,
  WEAVER_CLOTH_PER_CYCLE,
  WEAVER_FLAX_PER_CYCLE,
  WEAVER_FLAX_WATER_PER_CYCLE,
  WEAVER_WOOL_PER_CYCLE,
} from '../generated/gameBalance.ts';
import {
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
} from '../resources/types.ts';
import {
  normalizeProcessorOutputTargetPercent,
  processorOutputTargetForBuilding,
} from './processorOutputPolicy.ts';
import {
  civilianToolsMaintained,
  civilianToolThroughputMultiplier,
  farmToolsMaintained,
  farmToolThroughputMultiplier,
  isCivilianToolSite,
} from './civilianToolPolicy.ts';
import {
  CLAY_BANK_LEAN_YIELD_THRESHOLD,
  clayBankYieldAt,
} from './clayBankPolicy.ts';
import { weaverUsesFlax } from './weaverInputPolicy.ts';

export type SettlementProductionCapacity = {
  capacityDaysPerWeek: number;
  watermillThroughputMultiplier: number;
  clayPitThroughputMultiplier: number;
  charcoalBurnerThroughputMultiplier: number;
  fireDisabledProcessorSites: number;
  fireDisabledProcessorWorkers: number;
  firstFireDisabledProcessorId: string | null;
  millWorkers: number;
  bakeryWorkers: number;
  breweryWorkers: number;
  smokehouseWorkers: number;
  weaverWorkers: number;
  millInputBuffer: ProcessorInputBuffer | null;
  bakeryInputBuffer: ProcessorInputBuffer | null;
  breweryInputBuffer: ProcessorInputBuffer | null;
  smokehouseInputBuffer: ProcessorInputBuffer | null;
  weaverInputBuffer: ProcessorInputBuffer | null;
  charcoalInputBuffer: ProcessorInputBuffer | null;
  smithyInputBuffer: ProcessorInputBuffer | null;
  potterInputBuffer: ProcessorInputBuffer | null;
  millOutputRoom: ProcessorOutputRoom | null;
  bakeryOutputRoom: ProcessorOutputRoom | null;
  breweryOutputRoom: ProcessorOutputRoom | null;
  smokehouseOutputRoom: ProcessorOutputRoom | null;
  weaverOutputRoom: ProcessorOutputRoom | null;
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
  clothOutputPerDay: number;
  clothWoolPerDay: number;
  clothFlaxPerDay: number;
  clothFlaxWaterPerDay: number;
  industrialMaterials: IndustrialMaterialPlan;
  tierThreeResidents: number;
  fireDisabledTierThreeHomes: number;
  fireDisabledTierThreeResidents: number;
  fireDisabledTierThreeHousingCapacity: number;
  aleDemandPerDay: number;
  /** Winter-peak design demand used by long-term prosperity capacity. */
  preservedFoodDemandPerDay: number;
  currentPreservedFoodDemandPerDay: number;
  currentPreservedFoodDemandMultiplier: number;
  clothDemandPerDay: number;
  potteryOutputPerDay: number;
  potteryDemandPerDay: number;
  prosperityRoadBranches: ReadonlyMap<string, ProsperityRoadBranch> | null;
};

export type ProcessorInput =
  | 'barley'
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
  | 'flax';

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
  clayBankYieldMultiplier: number;
  firstLeanClayPitId: string | null;
  clayOutputPerDay: number;
  potterInstalledOutputPerDay: number;
  potteryOutputPerDay: number;
  potteryDemandPerDay: number;
  potteryCoveredDemandPerDay: number;
  potteryShortfallPerDay: number;
  potteryExportSurplusPerDay: number;
  potteryStrandedPerDay: number;
  potterClayPerDay: number;
  potterFirewoodPerDay: number;
  charcoalOutputPerDay: number;
  charcoalFirewoodPerDay: number;
  smithyInstalledIronworkPerDay: number;
  ironworkOutputPerDay: number;
  smithyIronPerDay: number;
  smithyCharcoalPerDay: number;
  maintainedToolIronworkPerDay: number;
  fullToolIronworkPerDay: number;
  roadCoveredToolIronworkPerDay: number;
  roadCoveredFullToolIronworkPerDay: number;
  ironworkSurplusAfterToolUpkeep: number;
  firstPotteryBottleneckId: string | null;
  firstPotteryBottleneckResidenceId: string | null;
  firstSmithyBottleneckId: string | null;
  firstUnmaintainedToolSiteId: string | null;
};

export type ProductionGrainRoadBranch = {
  breadGrainPerDay: number;
  firstProcessorId: string | null;
};

type ProductionRoadEntity = Pick<BuildingState | ResidenceState, 'id' | 'x' | 'z'>;

export type ProductionRoadComponentResolver = (
  entity: ProductionRoadEntity,
) => string | number | null;

export type ProsperityRoadBranch = {
  currentResidents: number;
  fullResidents: number;
  preservedFoodOutputPerDay: number;
  aleOutputPerDay: number;
  clothOutputPerDay: number;
  potteryOutputPerDay: number;
  firstResidenceId: string | null;
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

const WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;

type ProcessorOverview = Pick<
  SettlementProductionCapacity,
  | 'millWorkers'
  | 'bakeryWorkers'
  | 'breweryWorkers'
  | 'smokehouseWorkers'
  | 'weaverWorkers'
  | 'millInputBuffer'
  | 'bakeryInputBuffer'
  | 'breweryInputBuffer'
  | 'smokehouseInputBuffer'
  | 'weaverInputBuffer'
  | 'charcoalInputBuffer'
  | 'smithyInputBuffer'
  | 'potterInputBuffer'
  | 'millOutputRoom'
  | 'bakeryOutputRoom'
  | 'breweryOutputRoom'
  | 'smokehouseOutputRoom'
  | 'weaverOutputRoom'
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
  clayBankWeightedLabor: number;
  firstLeanClayPitId: string | null;
  maintainedToolIronworkPerDay: number;
  fullToolIronworkPerDay: number;
  firstUnmaintainedToolSiteId: string | null;
};

type GrainChainBranch = {
  millWorkers: number;
  millEffectiveWorkers: number;
  bakeryWorkers: number;
  firstMillId: string | null;
  firstBakeryId: string | null;
};

type IndustrialMaterialBranch = {
  clayOutputPerDay: number;
  potterOutputPerDay: number;
  potterClayPerDay: number;
  potterFirewoodPerDay: number;
  smokehousePotteryDemandPerDay: number;
  householdPotteryDemandPerDay: number;
  charcoalOutputPerDay: number;
  charcoalFirewoodPerDay: number;
  smithyIronworkPerDay: number;
  smithyIronPerDay: number;
  smithyCharcoalPerDay: number;
  maintainedToolIronworkPerDay: number;
  fullToolIronworkPerDay: number;
  hasStaffedMarket: boolean;
  firstClayId: string | null;
  firstPotterId: string | null;
  firstSmokehouseId: string | null;
  firstResidenceId: string | null;
  firstCharcoalId: string | null;
  firstSmithyId: string | null;
  firstToolSiteId: string | null;
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
    potterClayPerDay: 0,
    potterFirewoodPerDay: 0,
    smokehousePotteryDemandPerDay: 0,
    householdPotteryDemandPerDay: 0,
    charcoalOutputPerDay: 0,
    charcoalFirewoodPerDay: 0,
    smithyIronworkPerDay: 0,
    smithyIronPerDay: 0,
    smithyCharcoalPerDay: 0,
    maintainedToolIronworkPerDay: 0,
    fullToolIronworkPerDay: 0,
    hasStaffedMarket: false,
    firstClayId: null,
    firstPotterId: null,
    firstSmokehouseId: null,
    firstResidenceId: null,
    firstCharcoalId: null,
    firstSmithyId: null,
    firstToolSiteId: null,
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
    preservedFoodOutputPerDay: 0,
    aleOutputPerDay: 0,
    clothOutputPerDay: 0,
    potteryOutputPerDay: 0,
    firstResidenceId: null,
  };
  branches.set(key, branch);
  return branch;
}

function recordProsperityOutput(
  branches: Map<string, ProsperityRoadBranch> | null,
  building: BuildingState,
  componentFor: ProductionRoadComponentResolver | undefined,
  kind: 'preservedFood' | 'ale' | 'cloth' | 'pottery',
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
  } else if (kind === 'cloth') {
    branch.clothOutputPerDay += outputPerDay;
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
    bakeryWorkers: 0,
    firstMillId: null,
    firstBakeryId: null,
  };
  if (role === 'mill') {
    branch.millWorkers += building.assignedLabor;
    branch.millEffectiveWorkers += building.assignedLabor
      * Math.max(0, throughputMultiplier);
    branch.firstMillId = earlierStableId(branch.firstMillId, building.id);
  } else {
    branch.bakeryWorkers += building.assignedLabor;
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

function completedProcessorOverview(
  state: GameState,
  sabbathObserved: boolean,
  componentFor: ProductionRoadComponentResolver | undefined,
  watermillThroughputMultiplier: number,
  clayPitThroughputMultiplier: number,
  charcoalBurnerThroughputMultiplier: number,
  resourceAbundance: number,
  calendarMonth?: number,
): ProcessorOverview {
  const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
  const deliveries = timedInputDeliveries(state.deliveryTrips.values());
  const bakeryCyclesPerWorker = cyclesPerCalendarDay('granary', 1, sabbathObserved);
  const breweryCyclesPerWorker = cyclesPerCalendarDay('brewery', 1, sabbathObserved);
  const smokehouseCyclesPerWorker = cyclesPerCalendarDay('smokehouse', 1, sabbathObserved);
  const weaverCyclesPerWorker = cyclesPerCalendarDay('weaver', 1, sabbathObserved);
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
  let weaverWorkers = 0;
  let clayWorkers = 0;
  let charcoalWorkers = 0;
  let smithyWorkers = 0;
  let potterWorkers = 0;
  let toolEligibleSites = 0;
  let toolMaintainedSites = 0;
  let clayBankWeightedLabor = 0;
  let firstLeanClayPitId: string | null = null;
  let maintainedToolIronworkPerDay = 0;
  let fullToolIronworkPerDay = 0;
  let firstUnmaintainedToolSiteId: string | null = null;
  let millInputBuffer: ProcessorInputBuffer | null = null;
  let bakeryInputBuffer: ProcessorInputBuffer | null = null;
  let breweryInputBuffer: ProcessorInputBuffer | null = null;
  let smokehouseInputBuffer: ProcessorInputBuffer | null = null;
  let weaverInputBuffer: ProcessorInputBuffer | null = null;
  let charcoalInputBuffer: ProcessorInputBuffer | null = null;
  let smithyInputBuffer: ProcessorInputBuffer | null = null;
  let potterInputBuffer: ProcessorInputBuffer | null = null;
  let millOutputRoom: ProcessorOutputRoom | null = null;
  let bakeryOutputRoom: ProcessorOutputRoom | null = null;
  let breweryOutputRoom: ProcessorOutputRoom | null = null;
  let smokehouseOutputRoom: ProcessorOutputRoom | null = null;
  let weaverOutputRoom: ProcessorOutputRoom | null = null;
  let charcoalOutputRoom: ProcessorOutputRoom | null = null;
  let smithyOutputRoom: ProcessorOutputRoom | null = null;
  let potterOutputRoom: ProcessorOutputRoom | null = null;
  const grainChainBranches = new Map<string, GrainChainBranch>();
  const industrialMaterialBranches = new Map<string, IndustrialMaterialBranch>();
  const prosperityRoadBranches = componentFor
    ? new Map<string, ProsperityRoadBranch>()
    : null;
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
    if (building.constructionComplete === false || building.assignedLabor <= 0) {
      continue;
    }
    if (fireDisabled.has(building.id)) {
      if (
        building.kind === 'watermill'
        || building.kind === 'granary'
        || building.kind === 'brewery'
        || building.kind === 'smokehouse'
        || building.kind === 'weaver'
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
    const clayBankYield = building.kind === 'clay_pit'
      ? clayBankYieldAt(building.x, building.z, resourceAbundance)
      : 1;
    if (
      isCivilianToolSite(building.kind)
      && (
        building.kind !== 'threshing_barn'
        || activeFarmToolHoldings.has(building.id)
      )
    ) {
      toolEligibleSites += 1;
      const maintained = building.kind === 'threshing_barn'
        ? farmToolsMaintained(building.ironwork ?? 0)
        : civilianToolsMaintained(building.ironwork ?? 0);
      const weeklyWorkShare = sabbathObserved ? 6 / 7 : 1;
      let fullyEquippedDemand: number;
      let maintainedDemand: number;
      if (building.kind === 'threshing_barn') {
        fullyEquippedDemand = building.assignedLabor
          * weeklyWorkShare
          * CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
          * FARM_TOOL_IRONWORK_PER_WORKER_DAY;
        maintainedDemand = maintained
          ? building.assignedLabor
            * weeklyWorkShare
            * farmToolThroughputMultiplier(building.ironwork ?? 0)
            * FARM_TOOL_IRONWORK_PER_WORKER_DAY
          : 0;
      } else {
        const productiveToolLabor = building.kind === 'woodcutters_lodge'
          ? lodgeSustainedProcessingLabor(building.assignedLabor)
          : building.assignedLabor;
        const environmentThroughput = building.kind === 'watermill'
          ? watermillThroughputMultiplier
          : building.kind === 'clay_pit'
            ? clayPitThroughputMultiplier * clayBankYield
            : 1;
        const maintainedCycles = cyclesPerCalendarDay(
          building.kind,
          productiveToolLabor,
          sabbathObserved,
          civilianToolThroughputMultiplier(building.ironwork ?? 0)
            * environmentThroughput,
        );
        const fullyEquippedCycles = cyclesPerCalendarDay(
          building.kind,
          productiveToolLabor,
          sabbathObserved,
          CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER * environmentThroughput,
        );
        fullyEquippedDemand = fullyEquippedCycles
          * CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
        maintainedDemand = maintained
          ? maintainedCycles * CIVILIAN_TOOL_IRONWORK_PER_CYCLE
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
      case 'watermill': {
        const toolThroughput = civilianToolThroughputMultiplier(
          building.ironwork ?? 0,
        );
        millWorkers += building.assignedLabor;
        millEffectiveWorkers += building.assignedLabor * toolThroughput;
        recordGrainRoadActivity(
          grainChainBranches,
          building,
          'mill',
          componentFor,
          toolThroughput,
        );
        const cycles = cyclesPerCalendarDay(
          'watermill',
          building.assignedLabor,
          sabbathObserved,
          watermillThroughputMultiplier * toolThroughput,
        );
        millInputBuffer = updateFirstToStop(
          millInputBuffer,
          buildingInputRunway(
            deliveries,
            building,
            'grain',
            cycles * WATERMILL_GRAIN_PER_CYCLE,
          ),
          'grain',
          building.id,
        );
        millOutputRoom = updateFirstToFill(
          millOutputRoom,
          outputRoomDays(
            building.flour,
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.watermill.flour ?? 0),
            cycles * WATERMILL_FLOUR_PER_CYCLE,
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'granary': {
        bakeryWorkers += building.assignedLabor;
        recordGrainRoadActivity(
          grainChainBranches,
          building,
          'bakery',
          componentFor,
        );
        const cycles = bakeryCyclesPerWorker * building.assignedLabor;
        let runway = buildingInputRunway(
          deliveries,
          building,
          'flour',
          cycles * GRANARY_FLOUR_PER_CYCLE,
        );
        let limitingInput: ProcessorInput = 'flour';
        const waterRunway = buildingInputRunway(
          deliveries,
          building,
          'water',
          cycles * GRANARY_WATER_PER_CYCLE,
        );
        if (waterRunway.days < runway.days) {
          runway = waterRunway;
          limitingInput = 'water';
        }
        const firewoodRunway = buildingInputRunway(
          deliveries,
          building,
          'firewood',
          cycles * GRANARY_FIREWOOD_PER_CYCLE,
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
            building.food,
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.granary.food ?? 0),
            cycles * GRANARY_FOOD_PER_CYCLE,
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'brewery': {
        breweryWorkers += building.assignedLabor;
        const workCycles = breweryCyclesPerWorker * building.assignedLabor;
        const aleCycles = workCycles / 2;
        recordProsperityOutput(
          prosperityRoadBranches,
          building,
          componentFor,
          'ale',
          aleCycles * BREWERY_ALE_PER_CYCLE,
        );
        let runway = buildingInputRunway(
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
        let limitingInput: ProcessorInput = 'barley';
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
        breweryInputBuffer = updateFirstToStop(
          breweryInputBuffer,
          runway,
          limitingInput,
          building.id,
        );
        breweryOutputRoom = updateFirstToFill(
          breweryOutputRoom,
          outputRoomDays(
            building.ale,
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.brewery.ale ?? 0),
            aleCycles * BREWERY_ALE_PER_CYCLE,
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
        let runway = buildingInputRunway(
          deliveries,
          building,
          'food',
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
        const potteryRunway = buildingInputRunway(
          deliveries,
          building,
          'pottery',
          cycles * SMOKEHOUSE_POTTERY_PER_CYCLE,
        );
        if (potteryRunway.days < runway.days) {
          runway = potteryRunway;
          limitingInput = 'pottery';
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
            building.preservedFood,
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.smokehouse.preservedFood ?? 0),
            cycles * SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
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
        const usesFlax = weaverUsesFlax(building);
        let runway = buildingInputRunway(
          deliveries,
          building,
          usesFlax ? 'flax' : 'wool',
          cycles * (
            usesFlax ? WEAVER_FLAX_PER_CYCLE : WEAVER_WOOL_PER_CYCLE
          ),
        );
        let limitingInput: ProcessorInput = usesFlax ? 'flax' : 'wool';
        if (usesFlax) {
          const waterRunway = buildingInputRunway(
            deliveries,
            building,
            'water',
            cycles * WEAVER_FLAX_WATER_PER_CYCLE,
          );
          if (waterRunway.days < runway.days) {
            runway = waterRunway;
            limitingInput = 'water';
          }
        }
        weaverInputBuffer = updateFirstToStop(
          weaverInputBuffer,
          runway,
          limitingInput,
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
      case 'clay_pit': {
        clayWorkers += building.assignedLabor;
        clayBankWeightedLabor += building.assignedLabor * clayBankYield;
        if (clayBankYield < CLAY_BANK_LEAN_YIELD_THRESHOLD) {
          firstLeanClayPitId = earlierStableId(
            firstLeanClayPitId,
            building.id,
          );
        }
        const cycles = cyclesPerCalendarDay(
          'clay_pit',
          building.assignedLabor,
          sabbathObserved,
          civilianToolThroughputMultiplier(building.ironwork ?? 0)
            * clayPitThroughputMultiplier
            * clayBankYield,
        );
        const branch = industrialMaterialBranch(
          industrialMaterialBranches,
          building,
          componentFor,
        );
        branch.clayOutputPerDay += cycles * CLAY_PIT_CLAY_PER_CYCLE;
        branch.firstClayId = earlierStableId(branch.firstClayId, building.id);
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
        const cycles = smithyCyclesPerWorker * building.assignedLabor;
        const branch = industrialMaterialBranch(
          industrialMaterialBranches,
          building,
          componentFor,
        );
        branch.smithyIronworkPerDay += cycles * SMITHY_IRONWORK_PER_CYCLE;
        branch.smithyIronPerDay += cycles * SMITHY_IRON_PER_CYCLE;
        branch.smithyCharcoalPerDay += cycles * SMITHY_CHARCOAL_PER_CYCLE;
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
      case 'potter_kiln': {
        potterWorkers += building.assignedLabor;
        const cycles = potterCyclesPerWorker * building.assignedLabor;
        const branch = industrialMaterialBranch(
          industrialMaterialBranches,
          building,
          componentFor,
        );
        branch.potterOutputPerDay += cycles * POTTER_POTTERY_PER_CYCLE;
        branch.potterClayPerDay += cycles * POTTER_CLAY_PER_CYCLE;
        branch.potterFirewoodPerDay += cycles * POTTER_FIREWOOD_PER_CYCLE;
        branch.firstPotterId = earlierStableId(branch.firstPotterId, building.id);
        recordProsperityOutput(
          prosperityRoadBranches,
          building,
          componentFor,
          'pottery',
          cycles * POTTER_POTTERY_PER_CYCLE,
        );
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
        potterInputBuffer = updateFirstToStop(
          potterInputBuffer,
          runway,
          limitingInput,
          building.id,
        );
        potterOutputRoom = updateFirstToFill(
          potterOutputRoom,
          outputRoomDays(
            building.pottery ?? 0,
            processorOutputTargetForBuilding(building)
              ?? (BUILDING_STORAGE_CAPS.potter_kiln.pottery ?? 0),
            cycles * POTTER_POTTERY_PER_CYCLE,
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
    weaverWorkers,
    clayWorkers,
    charcoalWorkers,
    smithyWorkers,
    potterWorkers,
    toolEligibleSites,
    toolMaintainedSites,
    clayBankWeightedLabor,
    firstLeanClayPitId,
    maintainedToolIronworkPerDay,
    fullToolIronworkPerDay,
    firstUnmaintainedToolSiteId,
    millInputBuffer,
    bakeryInputBuffer,
    breweryInputBuffer,
    smokehouseInputBuffer,
    weaverInputBuffer,
    charcoalInputBuffer,
    smithyInputBuffer,
    potterInputBuffer,
    millOutputRoom,
    bakeryOutputRoom,
    breweryOutputRoom,
    smokehouseOutputRoom,
    weaverOutputRoom,
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
  const weeklyWorkShare = sabbathObserved ? 6 / 7 : 1;
  return WORKDAY_SECONDS
    * weeklyWorkShare
    * assignedLabor
    * Math.max(0, throughputMultiplier)
    / interval;
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
    | 'clayBankWeightedLabor'
    | 'firstLeanClayPitId'
    | 'maintainedToolIronworkPerDay'
    | 'fullToolIronworkPerDay'
    | 'firstUnmaintainedToolSiteId'
  >,
  prosperityRoadBranches: Map<string, ProsperityRoadBranch> | null,
): IndustrialMaterialPlan {
  let activeRoadBranches = 0;
  let potteryMatchedBranches = 0;
  let potteryBlockedBranches = 0;
  let smithyMatchedBranches = 0;
  let smithyBlockedBranches = 0;
  let clayOutputPerDay = 0;
  let potterInstalledOutputPerDay = 0;
  let potteryOutputPerDay = 0;
  let potteryDemandPerDay = 0;
  let potteryCoveredDemandPerDay = 0;
  let potteryExportSurplusPerDay = 0;
  let potteryStrandedPerDay = 0;
  let potterClayPerDay = 0;
  let potterFirewoodPerDay = 0;
  let charcoalOutputPerDay = 0;
  let charcoalFirewoodPerDay = 0;
  let smithyInstalledIronworkPerDay = 0;
  let ironworkOutputPerDay = 0;
  let smithyIronPerDay = 0;
  let smithyCharcoalPerDay = 0;
  let roadCoveredToolIronworkPerDay = 0;
  let roadCoveredFullToolIronworkPerDay = 0;
  let ironworkSurplusAfterToolUpkeep = 0;
  let firstPotteryBottleneckId: string | null = null;
  let firstPotteryBottleneckResidenceId: string | null = null;
  let firstSmithyBottleneckId: string | null = null;

  for (const [branchKey, branch] of branches) {
    const branchPotteryDemand = branch.smokehousePotteryDemandPerDay
      + branch.householdPotteryDemandPerDay;
    const hasPotteryActivity = branch.clayOutputPerDay > 1e-9
      || branch.potterOutputPerDay > 1e-9
      || branchPotteryDemand > 1e-9;
    const hasSmithyActivity = branch.charcoalOutputPerDay > 1e-9
      || branch.smithyIronworkPerDay > 1e-9
      || branch.fullToolIronworkPerDay > 1e-9;
    if (hasPotteryActivity || hasSmithyActivity) {
      activeRoadBranches += 1;
    }

    clayOutputPerDay += branch.clayOutputPerDay;
    potterInstalledOutputPerDay += branch.potterOutputPerDay;
    potteryDemandPerDay += branchPotteryDemand;
    charcoalOutputPerDay += branch.charcoalOutputPerDay;
    charcoalFirewoodPerDay += branch.charcoalFirewoodPerDay;
    smithyInstalledIronworkPerDay += branch.smithyIronworkPerDay;

    const claySupportedPottery = branch.clayOutputPerDay
      * POTTER_POTTERY_PER_CYCLE
      / POTTER_CLAY_PER_CYCLE;
    const branchPotteryOutput = Math.min(
      branch.potterOutputPerDay,
      claySupportedPottery,
    );
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
    potteryCoveredDemandPerDay += branchPotteryCoverage;
    potterClayPerDay += branchPotteryOutput
      * POTTER_CLAY_PER_CYCLE
      / POTTER_POTTERY_PER_CYCLE;
    potterFirewoodPerDay += branchPotteryOutput
      * POTTER_FIREWOOD_PER_CYCLE
      / POTTER_POTTERY_PER_CYCLE;
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
    const branchIronworkOutput = branch.hasStaffedMarket
      ? Math.min(branch.smithyIronworkPerDay, charcoalSupportedIronwork)
      : 0;
    ironworkOutputPerDay += branchIronworkOutput;
    smithyIronPerDay += branchIronworkOutput
      * SMITHY_IRON_PER_CYCLE
      / SMITHY_IRONWORK_PER_CYCLE;
    smithyCharcoalPerDay += branchIronworkOutput
      * SMITHY_CHARCOAL_PER_CYCLE
      / SMITHY_IRONWORK_PER_CYCLE;
    roadCoveredToolIronworkPerDay += Math.min(
      branchIronworkOutput,
      branch.maintainedToolIronworkPerDay,
    );
    roadCoveredFullToolIronworkPerDay += Math.min(
      branchIronworkOutput,
      branch.fullToolIronworkPerDay,
    );
    ironworkSurplusAfterToolUpkeep += Math.max(
      0,
      branchIronworkOutput - branch.maintainedToolIronworkPerDay,
    );
    if (branchIronworkOutput > 1e-9) {
      smithyMatchedBranches += 1;
    }
    const smithyBlocked = (
      branch.smithyIronworkPerDay > branchIronworkOutput + 1e-9
      || (branch.charcoalOutputPerDay > 1e-9 && branch.smithyIronworkPerDay <= 1e-9)
      || branch.fullToolIronworkPerDay > branchIronworkOutput + 1e-9
    );
    if (smithyBlocked) {
      smithyBlockedBranches += 1;
      const candidate = branch.firstSmithyId
        ?? branch.firstToolSiteId
        ?? branch.firstCharcoalId;
      if (candidate !== null) {
        firstSmithyBottleneckId = earlierStableId(
          firstSmithyBottleneckId,
          candidate,
        );
      }
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
    clayBankYieldMultiplier: overview.clayWorkers > 0
      ? overview.clayBankWeightedLabor / overview.clayWorkers
      : 1,
    firstLeanClayPitId: overview.firstLeanClayPitId,
    clayOutputPerDay,
    potterInstalledOutputPerDay,
    potteryOutputPerDay,
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
    charcoalOutputPerDay,
    charcoalFirewoodPerDay,
    smithyInstalledIronworkPerDay,
    ironworkOutputPerDay,
    smithyIronPerDay,
    smithyCharcoalPerDay,
    maintainedToolIronworkPerDay: overview.maintainedToolIronworkPerDay,
    fullToolIronworkPerDay: overview.fullToolIronworkPerDay,
    roadCoveredToolIronworkPerDay,
    roadCoveredFullToolIronworkPerDay,
    ironworkSurplusAfterToolUpkeep,
    firstPotteryBottleneckId,
    firstPotteryBottleneckResidenceId,
    firstSmithyBottleneckId,
    firstUnmaintainedToolSiteId: overview.firstUnmaintainedToolSiteId,
  };
}

function grainChainRoadPlan(
  branches: ReadonlyMap<string, GrainChainBranch>,
  sabbathObserved: boolean,
  hypotheticalFoodPerDay: number,
  watermillThroughputMultiplier: number,
): GrainChainRoadPlan & {
  matchedFoodPerDay: number;
  grainRoadBranches: ReadonlyMap<string, ProductionGrainRoadBranch>;
} {
  let matchedFoodPerDay = 0;
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
      watermillThroughputMultiplier,
    );
    const bakeryCycles = cyclesPerCalendarDay(
      'granary',
      branch.bakeryWorkers,
      sabbathObserved,
    );
    const millFlourPerDay = millCycles * WATERMILL_FLOUR_PER_CYCLE;
    const bakeryFlourPerDay = bakeryCycles * GRANARY_FLOUR_PER_CYCLE;
    const matchedFlourPerDay = Math.min(millFlourPerDay, bakeryFlourPerDay);
    matchedFoodPerDay += matchedFlourPerDay
      * GRANARY_FOOD_PER_CYCLE
      / GRANARY_FLOUR_PER_CYCLE;
    const breadGrainPerDay = matchedFlourPerDay
      / WATERMILL_FLOUR_PER_CYCLE
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
      * GRANARY_FOOD_PER_CYCLE
      / GRANARY_FLOUR_PER_CYCLE;
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
    grainRoadBranches,
  };
}

/**
 * Long-run installed workshop capacity using authoritative work hours, cycle
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
  clayPitThroughputMultiplier = 1,
  currentPreservedFoodDemandMultiplier = 1,
  calendarMonth?: number,
  resourceAbundance = 50,
  charcoalBurnerThroughputMultiplier = 1,
): SettlementProductionCapacity {
  const normalizedWatermillThroughput = Number.isFinite(
    watermillThroughputMultiplier,
  )
    ? Math.max(0, watermillThroughputMultiplier)
    : 1;
  const normalizedClayPitThroughput = Number.isFinite(
    clayPitThroughputMultiplier,
  )
    ? Math.max(0, clayPitThroughputMultiplier)
    : 1;
  const normalizedCharcoalBurnerThroughput = Number.isFinite(
    charcoalBurnerThroughputMultiplier,
  )
    ? Math.max(0, charcoalBurnerThroughputMultiplier)
    : 1;
  const normalizedPreservedFoodDemandMultiplier = Number.isFinite(
    currentPreservedFoodDemandMultiplier,
  )
    ? Math.max(0, currentPreservedFoodDemandMultiplier)
    : 1;
  const normalizedResourceAbundance = Number.isFinite(resourceAbundance)
    ? Math.max(0, Math.min(100, resourceAbundance))
    : 50;
  const {
    fireDisabledProcessorSites,
    fireDisabledProcessorWorkers,
    firstFireDisabledProcessorId,
    millWorkers,
    millEffectiveWorkers,
    bakeryWorkers,
    breweryWorkers,
    smokehouseWorkers,
    weaverWorkers,
    clayWorkers,
    charcoalWorkers,
    smithyWorkers,
    potterWorkers,
    toolEligibleSites,
    toolMaintainedSites,
    clayBankWeightedLabor,
    firstLeanClayPitId,
    maintainedToolIronworkPerDay,
    fullToolIronworkPerDay,
    firstUnmaintainedToolSiteId,
    millInputBuffer,
    bakeryInputBuffer,
    breweryInputBuffer,
    smokehouseInputBuffer,
    weaverInputBuffer,
    charcoalInputBuffer,
    smithyInputBuffer,
    potterInputBuffer,
    millOutputRoom,
    bakeryOutputRoom,
    breweryOutputRoom,
    smokehouseOutputRoom,
    weaverOutputRoom,
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
    normalizedClayPitThroughput,
    normalizedCharcoalBurnerThroughput,
    normalizedResourceAbundance,
    calendarMonth,
  );
  const millCycles = cyclesPerCalendarDay(
    'watermill',
    millEffectiveWorkers,
    sabbathObserved,
    normalizedWatermillThroughput,
  );
  const bakeryCycles = cyclesPerCalendarDay('granary', bakeryWorkers, sabbathObserved);
  const breweryCycles = cyclesPerCalendarDay('brewery', breweryWorkers, sabbathObserved);
  const breweryAleCycles = breweryCycles / 2;
  const smokehouseCycles = cyclesPerCalendarDay(
    'smokehouse',
    smokehouseWorkers,
    sabbathObserved,
  );
  const weaverCycles = cyclesPerCalendarDay('weaver', weaverWorkers, sabbathObserved);

  const flourOutputPerDay = millCycles * WATERMILL_FLOUR_PER_CYCLE;
  const bakeryFlourCapacityPerDay = bakeryCycles * GRANARY_FLOUR_PER_CYCLE;
  const hypotheticalBreadFoodPerDay = Math.min(
    bakeryCycles * GRANARY_FOOD_PER_CYCLE,
    flourOutputPerDay * GRANARY_FOOD_PER_CYCLE / GRANARY_FLOUR_PER_CYCLE,
  );
  const {
    matchedFoodPerDay: breadFoodCapacityPerDay,
    grainRoadBranches,
    ...grainChainRoads
  } = grainChainRoadPlan(
    grainChainBranches,
    sabbathObserved,
    hypotheticalBreadFoodPerDay,
    normalizedWatermillThroughput,
  );
  const breadCyclesPerDay = breadFoodCapacityPerDay / GRANARY_FOOD_PER_CYCLE;
  const matchedFlourPerDay = breadCyclesPerDay * GRANARY_FLOUR_PER_CYCLE;
  const millCyclesForBread = matchedFlourPerDay / WATERMILL_FLOUR_PER_CYCLE;

  let tierThreeResidents = 0;
  let fireDisabledTierThreeHomes = 0;
  let fireDisabledTierThreeResidents = 0;
  let fireDisabledTierThreeHousingCapacity = 0;
  const fireDisabledResidences = fireDisabledResidenceIds(
    state.fireIncidents.values(),
  );
  for (const residence of state.residences.values()) {
    if (!residence.abandoned && residence.tier >= 3) {
      if (fireDisabledResidences.has(residence.id)) {
        fireDisabledTierThreeHomes += 1;
        fireDisabledTierThreeResidents += Math.max(0, residence.population);
        fireDisabledTierThreeHousingCapacity += Math.max(
          0,
          residence.populationCapacity,
        );
        continue;
      }
      tierThreeResidents += residence.population;
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
        * WORKDAY_SECONDS;
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
      clayBankWeightedLabor,
      firstLeanClayPitId,
      maintainedToolIronworkPerDay,
      fullToolIronworkPerDay,
      firstUnmaintainedToolSiteId,
    },
    prosperityRoadBranches,
  );

  return {
    capacityDaysPerWeek: sabbathObserved ? 6 : 7,
    watermillThroughputMultiplier: normalizedWatermillThroughput,
    clayPitThroughputMultiplier: normalizedClayPitThroughput,
    charcoalBurnerThroughputMultiplier: normalizedCharcoalBurnerThroughput,
    fireDisabledProcessorSites,
    fireDisabledProcessorWorkers,
    firstFireDisabledProcessorId,
    millWorkers,
    bakeryWorkers,
    breweryWorkers,
    smokehouseWorkers,
    weaverWorkers,
    millInputBuffer,
    bakeryInputBuffer,
    breweryInputBuffer,
    smokehouseInputBuffer,
    weaverInputBuffer,
    charcoalInputBuffer,
    smithyInputBuffer,
    potterInputBuffer,
    millOutputRoom,
    bakeryOutputRoom,
    breweryOutputRoom,
    smokehouseOutputRoom,
    weaverOutputRoom,
    charcoalOutputRoom,
    smithyOutputRoom,
    potterOutputRoom,
    flourOutputPerDay,
    bakeryFlourCapacityPerDay,
    breadFoodCapacityPerDay,
    grainChainRoads,
    grainRoadBranches: roadComponentFor ? grainRoadBranches : null,
    breadGrainPerDay: millCyclesForBread * WATERMILL_GRAIN_PER_CYCLE,
    breadWaterPerDay: breadCyclesPerDay * GRANARY_WATER_PER_CYCLE,
    breadFirewoodPerDay: breadCyclesPerDay * GRANARY_FIREWOOD_PER_CYCLE,
    aleOutputPerDay: breweryAleCycles * BREWERY_ALE_PER_CYCLE,
    aleBarleyPerDay: breweryAleCycles * BREWERY_BARLEY_PER_MALT_CYCLE,
    aleWaterPerDay: breweryAleCycles * (
      BREWERY_MALTING_WATER_PER_CYCLE
      + BREWERY_BREWING_WATER_PER_CYCLE
    ),
    aleFirewoodPerDay: breweryAleCycles * (
      BREWERY_MALTING_FIREWOOD_PER_CYCLE
      + BREWERY_BREWING_FIREWOOD_PER_CYCLE
    ),
    preservedFoodOutputPerDay: smokehouseCycles * SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
    preservationFreshFoodPerDay: smokehouseCycles * SMOKEHOUSE_FOOD_PER_CYCLE,
    preservationFirewoodPerDay: smokehouseCycles * SMOKEHOUSE_FIREWOOD_PER_CYCLE,
    preservationSaltPerDay: smokehouseCycles * SMOKEHOUSE_SALT_PER_CYCLE,
    preservationPotteryPerDay: smokehouseCycles * SMOKEHOUSE_POTTERY_PER_CYCLE,
    clothOutputPerDay: weaverCycles * WEAVER_CLOTH_PER_CYCLE,
    clothWoolPerDay: weaverCycles * WEAVER_WOOL_PER_CYCLE,
    clothFlaxPerDay: weaverCycles * WEAVER_FLAX_PER_CYCLE,
    clothFlaxWaterPerDay:
      weaverCycles * WEAVER_FLAX_WATER_PER_CYCLE,
    industrialMaterials,
    tierThreeResidents,
    fireDisabledTierThreeHomes,
    fireDisabledTierThreeResidents,
    fireDisabledTierThreeHousingCapacity,
    aleDemandPerDay:
      tierThreeResidents * RESIDENCE_ALE_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
    preservedFoodDemandPerDay:
      tierThreeResidents
      * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
      * WORKDAY_SECONDS
      * RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
    currentPreservedFoodDemandPerDay:
      tierThreeResidents
      * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
      * WORKDAY_SECONDS
      * normalizedPreservedFoodDemandMultiplier,
    currentPreservedFoodDemandMultiplier:
      normalizedPreservedFoodDemandMultiplier,
    clothDemandPerDay:
      tierThreeResidents * RESIDENCE_CLOTH_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
    potteryOutputPerDay: industrialMaterials.potteryOutputPerDay,
    potteryDemandPerDay:
      tierThreeResidents * RESIDENCE_POTTERY_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
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
    return 'No staffed mill or granary';
  }
  if (capacity.millWorkers <= 0) return 'Mill missing — granaries cannot receive flour';
  if (capacity.bakeryWorkers <= 0) return 'Granary missing — milled flour has no bakery';
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
  return 'Bakery-limited — add granary labor before mill labor';
}
