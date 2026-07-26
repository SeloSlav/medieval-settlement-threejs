import {
  BREWERY_ALE_PER_CYCLE,
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
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingKind, BuildingState, GameState } from '../resources/types.ts';
import {
  normalizeProcessorOutputTargetPercent,
  processorOutputTargetForBuilding,
} from './processorOutputPolicy.ts';

export type SettlementProductionCapacity = {
  capacityDaysPerWeek: number;
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
  breadGrainPerDay: number;
  breadWaterPerDay: number;
  breadFirewoodPerDay: number;
  aleOutputPerDay: number;
  aleGrainPerDay: number;
  aleWaterPerDay: number;
  preservedFoodOutputPerDay: number;
  preservationFreshFoodPerDay: number;
  preservationFirewoodPerDay: number;
  clothOutputPerDay: number;
  clothWoolPerDay: number;
  tierThreeResidents: number;
  aleDemandPerDay: number;
  preservedFoodDemandPerDay: number;
  clothDemandPerDay: number;
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
>;

type TimedInputDelivery = {
  amount: number;
  arrivalSeconds: number;
};

type TimedInputDeliveries = Map<string, Map<DeliveryCargoKind, TimedInputDelivery[]>>;

type InputRunway = Omit<ProcessorInputBuffer, 'limitingInput' | 'buildingId'>;

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
): ProcessorOverview {
  const deliveries = timedInputDeliveries(state.deliveryTrips.values());
  const millCyclesPerWorker = cyclesPerCalendarDay('watermill', 1, sabbathObserved);
  const bakeryCyclesPerWorker = cyclesPerCalendarDay('granary', 1, sabbathObserved);
  const breweryCyclesPerWorker = cyclesPerCalendarDay('brewery', 1, sabbathObserved);
  const smokehouseCyclesPerWorker = cyclesPerCalendarDay('smokehouse', 1, sabbathObserved);
  const weaverCyclesPerWorker = cyclesPerCalendarDay('weaver', 1, sabbathObserved);
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
  for (const building of state.buildings.values()) {
    if (building.constructionComplete === false || building.assignedLabor <= 0) {
      continue;
    }
    switch (building.kind) {
      case 'watermill': {
        millWorkers += building.assignedLabor;
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
  };
}

function cyclesPerCalendarDay(
  kind: BuildingKind,
  assignedLabor: number,
  sabbathObserved: boolean,
): number {
  if (assignedLabor <= 0) return 0;
  const interval = getBuildingDefinition(kind).harvestInterval;
  if (interval <= 1e-6) return 0;
  const weeklyWorkShare = sabbathObserved ? 6 / 7 : 1;
  return WORKDAY_SECONDS * weeklyWorkShare * assignedLabor / interval;
}

/**
 * Long-run installed workshop capacity using authoritative work hours, cycle
 * lengths, labor scaling, and Sabbath policy. Values deliberately assume full
 * input supply; the Town Hall labels them as capacity rather than production.
 */
export function computeSettlementProductionCapacity(
  state: GameState,
  sabbathObserved: boolean,
): SettlementProductionCapacity {
  const {
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
  } = completedProcessorOverview(state, sabbathObserved);

  const millCycles = cyclesPerCalendarDay('watermill', millWorkers, sabbathObserved);
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
  const breadFoodCapacityPerDay = Math.min(
    bakeryCycles * GRANARY_FOOD_PER_CYCLE,
    flourOutputPerDay * GRANARY_FOOD_PER_CYCLE / GRANARY_FLOUR_PER_CYCLE,
  );
  const breadCyclesPerDay = breadFoodCapacityPerDay / GRANARY_FOOD_PER_CYCLE;
  const matchedFlourPerDay = breadCyclesPerDay * GRANARY_FLOUR_PER_CYCLE;
  const millCyclesForBread = matchedFlourPerDay / WATERMILL_FLOUR_PER_CYCLE;

  let tierThreeResidents = 0;
  for (const residence of state.residences.values()) {
    if (!residence.abandoned && residence.tier >= 3) {
      tierThreeResidents += residence.population;
    }
  }

  return {
    capacityDaysPerWeek: sabbathObserved ? 6 : 7,
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
    breadGrainPerDay: millCyclesForBread * WATERMILL_GRAIN_PER_CYCLE,
    breadWaterPerDay: breadCyclesPerDay * GRANARY_WATER_PER_CYCLE,
    breadFirewoodPerDay: breadCyclesPerDay * GRANARY_FIREWOOD_PER_CYCLE,
    aleOutputPerDay: breweryCycles * BREWERY_ALE_PER_CYCLE,
    aleGrainPerDay: breweryCycles * BREWERY_GRAIN_PER_CYCLE,
    aleWaterPerDay: breweryCycles * BREWERY_WATER_PER_CYCLE,
    preservedFoodOutputPerDay: smokehouseCycles * SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
    preservationFreshFoodPerDay: smokehouseCycles * SMOKEHOUSE_FOOD_PER_CYCLE,
    preservationFirewoodPerDay: smokehouseCycles * SMOKEHOUSE_FIREWOOD_PER_CYCLE,
    clothOutputPerDay: weaverCycles * WEAVER_CLOTH_PER_CYCLE,
    clothWoolPerDay: weaverCycles * WEAVER_WOOL_PER_CYCLE,
    tierThreeResidents,
    aleDemandPerDay:
      tierThreeResidents * RESIDENCE_ALE_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
    preservedFoodDemandPerDay:
      tierThreeResidents * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
    clothDemandPerDay:
      tierThreeResidents * RESIDENCE_CLOTH_PER_PERSON_PER_SEC * WORKDAY_SECONDS,
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
  >,
): string {
  if (capacity.millWorkers <= 0 && capacity.bakeryWorkers <= 0) {
    return 'No staffed mill or granary';
  }
  if (capacity.millWorkers <= 0) return 'Mill missing — granaries cannot receive flour';
  if (capacity.bakeryWorkers <= 0) return 'Granary missing — milled flour has no bakery';
  const difference = capacity.flourOutputPerDay - capacity.bakeryFlourCapacityPerDay;
  const tolerance = Math.max(
    0.5,
    Math.min(capacity.flourOutputPerDay, capacity.bakeryFlourCapacityPerDay) * 0.05,
  );
  if (Math.abs(difference) <= tolerance) return 'Balanced milling and baking capacity';
  if (difference < 0) return 'Mill-limited — add mill labor before bakery labor';
  return 'Bakery-limited — add granary labor before mill labor';
}
