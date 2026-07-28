import {
  BREWERY_ALE_PER_CYCLE,
  BREWERY_FIREWOOD_PER_CYCLE,
  BREWERY_GRAIN_PER_CYCLE,
  BREWERY_WATER_PER_CYCLE,
  BUILDING_STORAGE_CAPS,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  GRANARY_FIREWOOD_PER_CYCLE,
  GRANARY_FLOUR_PER_CYCLE,
  GRANARY_FOOD_PER_CYCLE,
  GRANARY_WATER_PER_CYCLE,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
  WATERMILL_FLOUR_PER_CYCLE,
  WATERMILL_GRAIN_PER_CYCLE,
  WEAVER_CLOTH_PER_CYCLE,
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

export type SettlementProductionCapacity = {
  capacityDaysPerWeek: number;
  watermillThroughputMultiplier: number;
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
  millOutputRoom: ProcessorOutputRoom | null;
  bakeryOutputRoom: ProcessorOutputRoom | null;
  breweryOutputRoom: ProcessorOutputRoom | null;
  smokehouseOutputRoom: ProcessorOutputRoom | null;
  weaverOutputRoom: ProcessorOutputRoom | null;
  flourOutputPerDay: number;
  bakeryFlourCapacityPerDay: number;
  breadFoodCapacityPerDay: number;
  grainChainRoads: GrainChainRoadPlan;
  grainRoadBranches: ReadonlyMap<string, ProductionGrainRoadBranch> | null;
  breadGrainPerDay: number;
  breadWaterPerDay: number;
  breadFirewoodPerDay: number;
  aleOutputPerDay: number;
  aleGrainPerDay: number;
  aleWaterPerDay: number;
  aleFirewoodPerDay: number;
  preservedFoodOutputPerDay: number;
  preservationFreshFoodPerDay: number;
  preservationFirewoodPerDay: number;
  clothOutputPerDay: number;
  clothWoolPerDay: number;
  tierThreeResidents: number;
  fireDisabledTierThreeHomes: number;
  fireDisabledTierThreeResidents: number;
  fireDisabledTierThreeHousingCapacity: number;
  aleDemandPerDay: number;
  preservedFoodDemandPerDay: number;
  clothDemandPerDay: number;
  prosperityRoadBranches: ReadonlyMap<string, ProsperityRoadBranch> | null;
};

export type ProcessorInput =
  | 'grain'
  | 'flour'
  | 'water'
  | 'firewood'
  | 'fresh food'
  | 'wool';

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

export type ProductionGrainRoadBranch = {
  breadGrainPerDay: number;
  aleGrainPerDay: number;
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
  | 'millOutputRoom'
  | 'bakeryOutputRoom'
  | 'breweryOutputRoom'
  | 'smokehouseOutputRoom'
  | 'weaverOutputRoom'
> & {
  fireDisabledProcessorSites: number;
  fireDisabledProcessorWorkers: number;
  firstFireDisabledProcessorId: string | null;
  grainChainBranches: Map<string, GrainChainBranch>;
  prosperityRoadBranches: Map<string, ProsperityRoadBranch> | null;
};

type GrainChainBranch = {
  millWorkers: number;
  bakeryWorkers: number;
  breweryGrainPerDay: number;
  firstMillId: string | null;
  firstBakeryId: string | null;
  firstBreweryId: string | null;
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
    firstResidenceId: null,
  };
  branches.set(key, branch);
  return branch;
}

function recordProsperityOutput(
  branches: Map<string, ProsperityRoadBranch> | null,
  building: BuildingState,
  componentFor: ProductionRoadComponentResolver | undefined,
  kind: 'preservedFood' | 'ale' | 'cloth',
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
  } else {
    branch.clothOutputPerDay += outputPerDay;
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
  role: 'mill' | 'bakery' | 'brewery',
  componentFor: ProductionRoadComponentResolver | undefined,
  grainPerDay = 0,
): void {
  const key = grainChainBranchKey(building, componentFor);
  const branch = branches.get(key) ?? {
    millWorkers: 0,
    bakeryWorkers: 0,
    breweryGrainPerDay: 0,
    firstMillId: null,
    firstBakeryId: null,
    firstBreweryId: null,
  };
  if (role === 'mill') {
    branch.millWorkers += building.assignedLabor;
    branch.firstMillId = earlierStableId(branch.firstMillId, building.id);
  } else if (role === 'bakery') {
    branch.bakeryWorkers += building.assignedLabor;
    branch.firstBakeryId = earlierStableId(branch.firstBakeryId, building.id);
  } else {
    branch.breweryGrainPerDay += Math.max(0, grainPerDay);
    branch.firstBreweryId = earlierStableId(
      branch.firstBreweryId,
      building.id,
    );
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
): ProcessorOverview {
  const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
  const deliveries = timedInputDeliveries(state.deliveryTrips.values());
  const millCyclesPerWorker = cyclesPerCalendarDay(
    'watermill',
    1,
    sabbathObserved,
    watermillThroughputMultiplier,
  );
  const bakeryCyclesPerWorker = cyclesPerCalendarDay('granary', 1, sabbathObserved);
  const breweryCyclesPerWorker = cyclesPerCalendarDay('brewery', 1, sabbathObserved);
  const smokehouseCyclesPerWorker = cyclesPerCalendarDay('smokehouse', 1, sabbathObserved);
  const weaverCyclesPerWorker = cyclesPerCalendarDay('weaver', 1, sabbathObserved);
  let fireDisabledProcessorSites = 0;
  let fireDisabledProcessorWorkers = 0;
  let firstFireDisabledProcessorId: string | null = null;
  let millWorkers = 0;
  let bakeryWorkers = 0;
  let breweryWorkers = 0;
  let smokehouseWorkers = 0;
  let weaverWorkers = 0;
  let millInputBuffer: ProcessorInputBuffer | null = null;
  let bakeryInputBuffer: ProcessorInputBuffer | null = null;
  let breweryInputBuffer: ProcessorInputBuffer | null = null;
  let smokehouseInputBuffer: ProcessorInputBuffer | null = null;
  let weaverInputBuffer: ProcessorInputBuffer | null = null;
  let millOutputRoom: ProcessorOutputRoom | null = null;
  let bakeryOutputRoom: ProcessorOutputRoom | null = null;
  let breweryOutputRoom: ProcessorOutputRoom | null = null;
  let smokehouseOutputRoom: ProcessorOutputRoom | null = null;
  let weaverOutputRoom: ProcessorOutputRoom | null = null;
  const grainChainBranches = new Map<string, GrainChainBranch>();
  const prosperityRoadBranches = componentFor
    ? new Map<string, ProsperityRoadBranch>()
    : null;
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
    switch (building.kind) {
      case 'watermill': {
        millWorkers += building.assignedLabor;
        recordGrainRoadActivity(
          grainChainBranches,
          building,
          'mill',
          componentFor,
        );
        const cycles = millCyclesPerWorker * building.assignedLabor;
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
        const cycles = breweryCyclesPerWorker * building.assignedLabor;
        recordGrainRoadActivity(
          grainChainBranches,
          building,
          'brewery',
          componentFor,
          cycles * BREWERY_GRAIN_PER_CYCLE,
        );
        recordProsperityOutput(
          prosperityRoadBranches,
          building,
          componentFor,
          'ale',
          cycles * BREWERY_ALE_PER_CYCLE,
        );
        let runway = buildingInputRunway(
          deliveries,
          building,
          'grain',
          cycles * BREWERY_GRAIN_PER_CYCLE,
        );
        let limitingInput: ProcessorInput = 'grain';
        const waterRunway = buildingInputRunway(
          deliveries,
          building,
          'water',
          cycles * BREWERY_WATER_PER_CYCLE,
        );
        if (waterRunway.days < runway.days) {
          runway = waterRunway;
          limitingInput = 'water';
        }
        const firewoodRunway = buildingInputRunway(
          deliveries,
          building,
          'firewood',
          cycles * BREWERY_FIREWOOD_PER_CYCLE,
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
            cycles * BREWERY_ALE_PER_CYCLE,
          ),
          building.id,
          normalizeProcessorOutputTargetPercent(building.processorOutputTargetPercent),
        );
        break;
      }
      case 'smokehouse': {
        smokehouseWorkers += building.assignedLabor;
        const cycles = smokehouseCyclesPerWorker * building.assignedLabor;
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
        weaverInputBuffer = updateFirstToStop(
          weaverInputBuffer,
          buildingInputRunway(
            deliveries,
            building,
            'wool',
            cycles * WEAVER_WOOL_PER_CYCLE,
          ),
          'wool',
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
      default:
        break;
    }
  }
  return {
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
    millOutputRoom,
    bakeryOutputRoom,
    breweryOutputRoom,
    smokehouseOutputRoom,
    weaverOutputRoom,
    grainChainBranches,
    prosperityRoadBranches,
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
      branch.millWorkers,
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
    let firstProcessorId = breadGrainPerDay > 1e-9
      ? branch.firstMillId
      : null;
    if (
      branch.breweryGrainPerDay > 1e-9
      && branch.firstBreweryId !== null
    ) {
      firstProcessorId = earlierStableId(
        firstProcessorId,
        branch.firstBreweryId,
      );
    }
    if (breadGrainPerDay > 1e-9 || branch.breweryGrainPerDay > 1e-9) {
      grainRoadBranches.set(key, {
        breadGrainPerDay,
        aleGrainPerDay: branch.breweryGrainPerDay,
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
 * inside real cart-connected road branches and sustained bread / ale grain draw
 * is retained for the physical reserve ledger without any shortest-path solves.
 */
export function computeSettlementProductionCapacity(
  state: GameState,
  sabbathObserved: boolean,
  roadComponentFor?: ProductionRoadComponentResolver,
  watermillThroughputMultiplier = 1,
): SettlementProductionCapacity {
  const normalizedWatermillThroughput = Number.isFinite(
    watermillThroughputMultiplier,
  )
    ? Math.max(0, watermillThroughputMultiplier)
    : 1;
  const {
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
    millOutputRoom,
    bakeryOutputRoom,
    breweryOutputRoom,
    smokehouseOutputRoom,
    weaverOutputRoom,
    grainChainBranches,
    prosperityRoadBranches,
  } = completedProcessorOverview(
    state,
    sabbathObserved,
    roadComponentFor,
    normalizedWatermillThroughput,
  );

  const millCycles = cyclesPerCalendarDay(
    'watermill',
    millWorkers,
    sabbathObserved,
    normalizedWatermillThroughput,
  );
  const bakeryCycles = cyclesPerCalendarDay('granary', bakeryWorkers, sabbathObserved);
  const breweryCycles = cyclesPerCalendarDay('brewery', breweryWorkers, sabbathObserved);
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

  return {
    capacityDaysPerWeek: sabbathObserved ? 6 : 7,
    watermillThroughputMultiplier: normalizedWatermillThroughput,
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
    millOutputRoom,
    bakeryOutputRoom,
    breweryOutputRoom,
    smokehouseOutputRoom,
    weaverOutputRoom,
    flourOutputPerDay,
    bakeryFlourCapacityPerDay,
    breadFoodCapacityPerDay,
    grainChainRoads,
    grainRoadBranches: roadComponentFor ? grainRoadBranches : null,
    breadGrainPerDay: millCyclesForBread * WATERMILL_GRAIN_PER_CYCLE,
    breadWaterPerDay: breadCyclesPerDay * GRANARY_WATER_PER_CYCLE,
    breadFirewoodPerDay: breadCyclesPerDay * GRANARY_FIREWOOD_PER_CYCLE,
    aleOutputPerDay: breweryCycles * BREWERY_ALE_PER_CYCLE,
    aleGrainPerDay: breweryCycles * BREWERY_GRAIN_PER_CYCLE,
    aleWaterPerDay: breweryCycles * BREWERY_WATER_PER_CYCLE,
    aleFirewoodPerDay: breweryCycles * BREWERY_FIREWOOD_PER_CYCLE,
    preservedFoodOutputPerDay: smokehouseCycles * SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
    preservationFreshFoodPerDay: smokehouseCycles * SMOKEHOUSE_FOOD_PER_CYCLE,
    preservationFirewoodPerDay: smokehouseCycles * SMOKEHOUSE_FIREWOOD_PER_CYCLE,
    clothOutputPerDay: weaverCycles * WEAVER_CLOTH_PER_CYCLE,
    clothWoolPerDay: weaverCycles * WEAVER_WOOL_PER_CYCLE,
    tierThreeResidents,
    fireDisabledTierThreeHomes,
    fireDisabledTierThreeResidents,
    fireDisabledTierThreeHousingCapacity,
    aleDemandPerDay:
      tierThreeResidents * RESIDENCE_ALE_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
    preservedFoodDemandPerDay:
      tierThreeResidents * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
    clothDemandPerDay:
      tierThreeResidents * RESIDENCE_CLOTH_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
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
