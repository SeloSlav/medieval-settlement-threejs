import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_SECONDS_PER_DAY,
  CATTLE_HAY_PER_UNSUPPORTED_HEAD,
  CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
  CATTLE_GRAIN_PER_UNSUPPORTED_HEAD,
  DROUGHT_PASTURE_CAPACITY_MULTIPLIER,
  LIVESTOCK_ANIMAL_FEED_FODDER_VALUE,
  LIVESTOCK_ANIMAL_FEED_PER_CYCLE,
  LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE,
  LIVESTOCK_HAYMAKING_END_MONTH,
  LIVESTOCK_HAYMAKING_START_MONTH,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
  LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
  SHEEP_HAY_PER_UNSUPPORTED_HEAD,
  SHEEP_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
  SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
  SWINE_GRAIN_PER_UNSUPPORTED_HEAD,
  WINTER_PASTURE_CAPACITY_MULTIPLIER,
} from '../generated/gameBalance.ts';
import { parseBuildingServerId } from '../data/spacetimeIds.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { buildingStorageCaps } from '../resources/resourceTotals.ts';
import type {
  BuildingState,
  GameState,
  LivestockHerdState,
  LivestockSpecies,
} from '../resources/types.ts';
import { freshFoodStock, preservedFoodStock } from './foodInventory.ts';
import {
  pannageCapacityMultiplierFor,
  seasonForMonth,
} from '../world/seasonPolicy.ts';
import {
  effectiveLivestockHaymakingPercent,
  farmhouseCheeseSaltStagingCycles,
  isLivestockHaymakingMonth,
  livestockCareCapacity,
  livestockMilkAllocationPerCycle,
  livestockDairySaltPerCycle,
  livestockStorageSecuredCullHeads,
  pendingLivestockCullHeads,
} from './livestockPolicy.ts';

const WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY;

const FODDER_VALUE_PER_UNSUPPORTED_HEAD: Record<LivestockSpecies, number> = {
  cattle: CATTLE_GRAIN_PER_UNSUPPORTED_HEAD,
  sheep: SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
  swine: SWINE_GRAIN_PER_UNSUPPORTED_HEAD,
};

const HAY_PER_UNSUPPORTED_HEAD: Record<LivestockSpecies, number> = {
  cattle: CATTLE_HAY_PER_UNSUPPORTED_HEAD,
  sheep: SHEEP_HAY_PER_UNSUPPORTED_HEAD,
  swine: 0,
};

const HAY_YIELD_PER_RESERVED_CAPACITY: Record<LivestockSpecies, number> = {
  cattle: CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
  sheep: SHEEP_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
  swine: 0,
};

function compareBuildingIds(a: string, b: string): number {
  const numericA = parseBuildingServerId(a);
  const numericB = parseBuildingServerId(b);
  if (numericA !== null && numericB !== null) {
    return numericA < numericB ? -1 : numericA > numericB ? 1 : 0;
  }
  return compareStableEntityIds(a, b);
}

function haymakingDaysRemaining(month: number, monthDay: number): number {
  if (month >= 3 && month < LIVESTOCK_HAYMAKING_START_MONTH) {
    return (
      LIVESTOCK_HAYMAKING_END_MONTH - LIVESTOCK_HAYMAKING_START_MONTH + 1
    ) * CALENDAR_DAYS_PER_MONTH;
  }
  if (!isLivestockHaymakingMonth(month)) return 0;
  return (
    (LIVESTOCK_HAYMAKING_END_MONTH - month) * CALENDAR_DAYS_PER_MONTH
    + Math.max(0, CALENDAR_DAYS_PER_MONTH - monthDay + 1)
  );
}

function daysUntilWinter(month: number, monthDay: number): number {
  if (month < 3 || month > 11) return 0;
  return (11 - month) * CALENDAR_DAYS_PER_MONTH
    + Math.max(0, CALENDAR_DAYS_PER_MONTH - monthDay + 1);
}

export type LivestockFodderHoldingPlan = {
  buildingId: string;
  species: LivestockSpecies;
  onsiteHumanWorkers: number;
  pairedOxen: number;
  effectiveWorkers: number;
  basePastureCapacity: number;
  projectedHeadCount: number;
  plannedCullHeads: number;
  executableCullHeads: number;
  unsecuredCullHeads: number;
  haymakingPercent: number;
  summerReservedCapacity: number;
  hayOutputPerDay: number;
  haymakingDaysRemaining: number;
  hayStock: number;
  projectedHayStock: number;
  oatInputStock: number;
  oatInputTarget: number;
  oatInputShortfall: number;
  animalFeedStock: number;
  projectedAnimalFeedStock: number;
  feedConversionPerDay: number;
  feedOatInputPerDay: number;
  currentUnsupportedHeads: number;
  currentFeedPerDay: number;
  currentFeedRunwayDays: number;
  winterPastureCapacity: number;
  winterUnsupportedHeads: number;
  winterHayNeed: number;
  winterHayShortfall: number;
  winterHayRunwayDays: number;
  winterFeedPerDay: number;
  winterFeedNeed: number;
  winterFeedRunwayDays: number;
  winterCombinedRunwayDays: number;
  winterReserveTarget: number;
  winterReserveStock: number;
  winterReserveShortfall: number;
  storageRunwayDays: number;
  productiveHeads: number;
  dairyPreservedFoodPerDay: number;
  dairySaltPerDay: number;
  dairySaltStock: number;
  dairySaltTarget: number;
  dairySaltShortfall: number;
  dairySaltRunwayDays: number;
};

export type LivestockLaborForecast = Readonly<{
  onsiteHumanWorkers: number;
  pairedOxen: number;
  effectiveWorkers: number;
}>;

function laborCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizedLivestockLaborForecast(
  building: BuildingState,
  labor: LivestockLaborForecast | null | undefined,
): LivestockLaborForecast {
  const onsiteHumanWorkers = laborCount(
    labor?.onsiteHumanWorkers ?? building.assignedLabor,
  );
  const pairedOxen = Math.min(
    onsiteHumanWorkers,
    laborCount(labor?.pairedOxen ?? 0),
  );
  return {
    onsiteHumanWorkers,
    pairedOxen,
    effectiveWorkers: onsiteHumanWorkers + pairedOxen,
  };
}

export function livestockStoredFodderValue(
  building: Pick<BuildingState, 'animalFeed'>,
): number {
  return Math.max(0, building.animalFeed ?? 0)
    * LIVESTOCK_ANIMAL_FEED_FODDER_VALUE;
}

export type SettlementLivestockFodderPlan = {
  holdingCount: number;
  staffedHoldings: number;
  pastoralHoldings: number;
  haymakingHoldings: number;
  projectedHeadCount: number;
  plannedCullHeads: number;
  executableCullHeads: number;
  unsecuredCullHeads: number;
  summerReservedCapacity: number;
  hayOutputPerDay: number;
  hayStock: number;
  projectedHayStock: number;
  oatInputStock: number;
  oatInputTarget: number;
  oatInputShortfall: number;
  animalFeedStock: number;
  projectedAnimalFeedStock: number;
  feedConversionPerDay: number;
  feedOatInputPerDay: number;
  winterPastureCapacity: number;
  winterUnsupportedHeads: number;
  winterHayNeed: number;
  winterHayShortfall: number;
  winterFeedPerDay: number;
  winterFeedNeed: number;
  winterReserveTarget: number;
  winterReserveStock: number;
  winterReserveShortfall: number;
  shortHoldings: number;
  capacityLimitedHoldings: number;
  firstShortBuildingId: string | null;
  firstRunwayDays: number;
  productiveDairyHeads: number;
  dairyPreservedFoodPerDay: number;
  dairySaltPerDay: number;
  dairySaltStock: number;
  dairySaltTarget: number;
  dairySaltShortfall: number;
  dairySaltShortHoldings: number;
  firstDairySaltShortBuildingId: string | null;
  firstDairySaltRunwayDays: number;
};

export function livestockCyclesPerCalendarDay(
  building: BuildingState,
  _sabbathObserved: boolean,
): number {
  const interval = getBuildingDefinition(building.kind).harvestInterval;
  if (interval <= 1e-9) return 0;
  return WORKDAY_SECONDS / interval;
}

export function projectLivestockFodderHolding(
  building: BuildingState,
  herd: LivestockHerdState,
  currentPastureCapacityMultiplier: number,
  sabbathObserved: boolean,
  month: number,
  monthDay = 1,
  laborForecast?: LivestockLaborForecast | null,
): LivestockFodderHoldingPlan {
  const cyclesPerDay = livestockCyclesPerCalendarDay(building, sabbathObserved);
  const {
    onsiteHumanWorkers,
    pairedOxen,
    effectiveWorkers,
  } = normalizedLivestockLaborForecast(building, laborForecast);
  const laborCyclesPerDay = cyclesPerDay
    * effectiveWorkers
    * (sabbathObserved ? 6 / 7 : 1);
  const suppliedHeads = Math.min(
    Math.max(0, herd.headCount),
    Math.max(0, herd.suppliedCapacity),
  );
  const workdaySupportedHeads = Math.min(
    suppliedHeads,
    livestockCareCapacity(herd.species, effectiveWorkers),
  );
  const sabbathSupportedHeads = Math.min(
    suppliedHeads,
    livestockCareCapacity(herd.species, onsiteHumanWorkers),
  );
  const careSupportedHeads = sabbathObserved
    ? (workdaySupportedHeads * 6 + sabbathSupportedHeads) / 7
    : workdaySupportedHeads;
  const productiveHeads = herd.species === 'swine'
    ? 0
    : careSupportedHeads * Math.min(1, Math.max(0, herd.health));
  const dairyPreservedFoodPerCycle = livestockMilkAllocationPerCycle(
    herd.species,
    productiveHeads,
    building.processorOutputTargetPercent,
  ).cheese;
  const dairySaltPerCycle = livestockDairySaltPerCycle(
    herd.species,
    productiveHeads,
    building.processorOutputTargetPercent,
  );
  const dairySaltStock = herd.species === 'swine'
    ? 0
    : Math.max(0, building.salt ?? 0);
  const dairySaltTarget = herd.species === 'swine' || onsiteHumanWorkers <= 0
    ? 0
    : LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE
      * farmhouseCheeseSaltStagingCycles(building.processorOutputTargetPercent);
  const dairySaltPerDay = dairySaltPerCycle * cyclesPerDay;
  const fodderValuePerHead = FODDER_VALUE_PER_UNSUPPORTED_HEAD[herd.species];
  const hayPerHead = HAY_PER_UNSUPPORTED_HEAD[herd.species];
  const hayStock = Math.max(0, herd.hayStock);
  const haymakingPercent = herd.species === 'swine'
    ? 0
    : effectiveLivestockHaymakingPercent(herd.haymakingPercent);
  const haymakingShare = hayStock + 1e-6 >= LIVESTOCK_HAY_STORAGE_CAPACITY
    ? 0
    : haymakingPercent / 100;
  const currentGrazingShare = isLivestockHaymakingMonth(month)
    ? 1 - haymakingShare
    : 1;
  const currentSeason = seasonForMonth(month);
  const currentPannageWeather = Math.abs(
    currentPastureCapacityMultiplier - DROUGHT_PASTURE_CAPACITY_MULTIPLIER,
  ) <= 1e-9
    ? 'drought'
    : currentSeason === 'winter'
      ? 'frost'
      : 'fair';
  const currentSpeciesCapacityMultiplier = herd.species === 'swine'
    ? pannageCapacityMultiplierFor(currentSeason, currentPannageWeather)
    : currentPastureCapacityMultiplier;
  const currentCapacityFactor = currentSpeciesCapacityMultiplier * currentGrazingShare;
  const basePastureCapacity = currentCapacityFactor > 1e-9
    ? Math.max(0, herd.pastureCapacity) / currentCapacityFactor
    : 0;
  const storageCaps = buildingStorageCaps(building.kind);
  const cullsAffectThisWinter = month >= 3 && month <= 11;
  const plannedCullHeads = cullsAffectThisWinter
    ? pendingLivestockCullHeads(
      herd.species,
      herd.headCount,
      herd.breedingReserve,
    )
    : 0;
  const executableCullHeads = cullsAffectThisWinter
    && onsiteHumanWorkers > 0
    ? livestockStorageSecuredCullHeads(
      herd.species,
      herd.headCount,
      herd.breedingReserve,
      (storageCaps.food ?? 0) - freshFoodStock(building),
      (storageCaps.preservedFood ?? 0) - preservedFoodStock(building),
      building.salt ?? 0,
    )
    : 0;
  const unsecuredCullHeads = Math.max(
    0,
    plannedCullHeads - executableCullHeads,
  );
  const projectedHeadCount = Math.max(
    0,
    herd.headCount - executableCullHeads,
  );
  const summerReservedCapacity = basePastureCapacity * haymakingShare;
  const hayYieldMultiplier = isLivestockHaymakingMonth(month)
    ? Math.min(1, Math.max(0, currentPastureCapacityMultiplier))
    : 1;
  const hayOutputPerDay = summerReservedCapacity
    * HAY_YIELD_PER_RESERVED_CAPACITY[herd.species]
    * laborCyclesPerDay
    * hayYieldMultiplier;
  const remainingHaymakingDays = haymakingDaysRemaining(month, monthDay);
  const projectedHayStock = Math.min(
    LIVESTOCK_HAY_STORAGE_CAPACITY,
    hayStock + hayOutputPerDay * remainingHaymakingDays,
  );
  const winterHayAvailable = month >= 3 && month <= LIVESTOCK_HAYMAKING_END_MONTH
    ? projectedHayStock
    : hayStock;
  const currentUnsupportedHeads = Math.max(0, herd.headCount - herd.pastureCapacity);
  const animalFeedStock = Math.max(0, building.animalFeed ?? 0);
  const currentFeedPerDay = currentSeason === 'winter'
    ? currentUnsupportedHeads
      * fodderValuePerHead
      * cyclesPerDay
      / Math.max(1e-9, LIVESTOCK_ANIMAL_FEED_FODDER_VALUE)
    : 0;
  const winterCapacityMultiplier = herd.species === 'swine'
    ? pannageCapacityMultiplierFor('winter', 'frost')
    : WINTER_PASTURE_CAPACITY_MULTIPLIER;
  const winterPastureCapacity = basePastureCapacity * winterCapacityMultiplier;
  const winterUnsupportedHeads = Math.max(
    0,
    projectedHeadCount - winterPastureCapacity,
  );
  const winterUnsupportedHeadCycles = winterUnsupportedHeads
    * cyclesPerDay
    * LIVESTOCK_WINTER_FODDER_RESERVE_DAYS;
  const winterHayNeed = winterUnsupportedHeadCycles * hayPerHead;
  const haySupportedHeadCycles = hayPerHead > 1e-9
    ? winterHayAvailable / hayPerHead
    : 0;
  const feedSupportedHeadCycles = Math.max(
    0,
    winterUnsupportedHeadCycles - haySupportedHeadCycles,
  );
  const winterFeedPerDay = winterUnsupportedHeads
    * fodderValuePerHead
    * cyclesPerDay
    / Math.max(1e-9, LIVESTOCK_ANIMAL_FEED_FODDER_VALUE);
  const winterFeedNeed = feedSupportedHeadCycles
    * fodderValuePerHead
    / Math.max(1e-9, LIVESTOCK_ANIMAL_FEED_FODDER_VALUE);
  const feedCapacity = storageCaps.animalFeed ?? 0;
  const winterReserveTarget = Math.min(winterFeedNeed, feedCapacity);
  const winterReserveStock = Math.min(
    winterReserveTarget,
    animalFeedStock,
  );
  // Husbandry time has a fixed cadence: extra hands improve care and haymaking,
  // but each due cycle can prepare only one feed batch. Stable oxen therefore
  // do not multiply the oats-to-feed workshop rate.
  const staffedFeedCyclesPerDay = onsiteHumanWorkers > 0
    ? cyclesPerDay * (sabbathObserved ? 6 / 7 : 1)
    : 0;
  const feedConversionPerDay = building.kind === 'pastoral_farmstead'
    ? staffedFeedCyclesPerDay * LIVESTOCK_ANIMAL_FEED_PER_CYCLE
    : 0;
  const feedOatInputPerDay = building.kind === 'pastoral_farmstead'
    ? staffedFeedCyclesPerDay * LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE
    : 0;
  const oatInputStock = building.kind === 'pastoral_farmstead'
    ? Math.max(0, building.oatGrain ?? 0)
    : 0;
  const oatUnitsPerFeed = LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE
    / Math.max(1e-9, LIVESTOCK_ANIMAL_FEED_PER_CYCLE);
  const oatInputTarget = building.kind === 'pastoral_farmstead'
    ? Math.max(0, winterReserveTarget - animalFeedStock) * oatUnitsPerFeed
    : 0;
  const convertibleFeed = Math.min(
    oatInputStock / Math.max(1e-9, oatUnitsPerFeed),
    feedConversionPerDay * daysUntilWinter(month, monthDay),
  );
  const projectedAnimalFeedStock = Math.min(
    feedCapacity,
    animalFeedStock + convertibleFeed,
  );

  return {
    buildingId: building.id,
    species: herd.species,
    onsiteHumanWorkers,
    pairedOxen,
    effectiveWorkers,
    basePastureCapacity,
    projectedHeadCount,
    plannedCullHeads,
    executableCullHeads,
    unsecuredCullHeads,
    haymakingPercent,
    summerReservedCapacity,
    hayOutputPerDay,
    haymakingDaysRemaining: remainingHaymakingDays,
    hayStock,
    projectedHayStock,
    oatInputStock,
    oatInputTarget,
    oatInputShortfall: Math.max(0, oatInputTarget - oatInputStock),
    animalFeedStock,
    projectedAnimalFeedStock,
    feedConversionPerDay,
    feedOatInputPerDay,
    currentUnsupportedHeads,
    currentFeedPerDay,
    currentFeedRunwayDays: currentFeedPerDay > 1e-9
      ? animalFeedStock / currentFeedPerDay
      : Number.POSITIVE_INFINITY,
    winterPastureCapacity,
    winterUnsupportedHeads,
    winterHayNeed,
    winterHayShortfall: Math.max(0, winterHayNeed - winterHayAvailable),
    winterHayRunwayDays: winterUnsupportedHeads > 1e-9
      && hayPerHead > 1e-9
      && cyclesPerDay > 1e-9
      ? winterHayAvailable / (winterUnsupportedHeads * hayPerHead * cyclesPerDay)
      : Number.POSITIVE_INFINITY,
    winterFeedPerDay,
    winterFeedNeed,
    winterFeedRunwayDays: winterFeedPerDay > 1e-9
      ? animalFeedStock / winterFeedPerDay
      : Number.POSITIVE_INFINITY,
    winterCombinedRunwayDays: winterFeedPerDay > 1e-9
      ? (
        hayPerHead > 1e-9
          ? winterHayAvailable / (winterUnsupportedHeads * hayPerHead * cyclesPerDay)
          : 0
      ) + animalFeedStock / winterFeedPerDay
      : Number.POSITIVE_INFINITY,
    winterReserveTarget,
    winterReserveStock,
    winterReserveShortfall: Math.max(
      0,
      winterReserveTarget - winterReserveStock,
    ),
    storageRunwayDays: winterFeedPerDay > 1e-9
      ? feedCapacity / winterFeedPerDay
      : Number.POSITIVE_INFINITY,
    productiveHeads,
    dairyPreservedFoodPerDay: dairyPreservedFoodPerCycle * cyclesPerDay,
    dairySaltPerDay,
    dairySaltStock,
    dairySaltTarget,
    dairySaltShortfall: Math.max(0, dairySaltTarget - dairySaltStock),
    dairySaltRunwayDays: dairySaltPerDay > 1e-9
      ? dairySaltStock / dairySaltPerDay
      : Number.POSITIVE_INFINITY,
  };
}

export function computeSettlementLivestockFodderPlan(
  state: Pick<GameState, 'buildings' | 'livestockHerds'>,
  currentPastureCapacityMultiplier: number,
  sabbathObserved: boolean,
  month: number,
  monthDay = 1,
  laborForecasts?: ReadonlyMap<string, LivestockLaborForecast> | null,
): SettlementLivestockFodderPlan {
  const total: SettlementLivestockFodderPlan = {
    holdingCount: 0,
    staffedHoldings: 0,
    pastoralHoldings: 0,
    haymakingHoldings: 0,
    projectedHeadCount: 0,
    plannedCullHeads: 0,
    executableCullHeads: 0,
    unsecuredCullHeads: 0,
    summerReservedCapacity: 0,
    hayOutputPerDay: 0,
    hayStock: 0,
    projectedHayStock: 0,
    oatInputStock: 0,
    oatInputTarget: 0,
    oatInputShortfall: 0,
    animalFeedStock: 0,
    projectedAnimalFeedStock: 0,
    feedConversionPerDay: 0,
    feedOatInputPerDay: 0,
    winterPastureCapacity: 0,
    winterUnsupportedHeads: 0,
    winterHayNeed: 0,
    winterHayShortfall: 0,
    winterFeedPerDay: 0,
    winterFeedNeed: 0,
    winterReserveTarget: 0,
    winterReserveStock: 0,
    winterReserveShortfall: 0,
    shortHoldings: 0,
    capacityLimitedHoldings: 0,
    firstShortBuildingId: null,
    firstRunwayDays: Number.POSITIVE_INFINITY,
    productiveDairyHeads: 0,
    dairyPreservedFoodPerDay: 0,
    dairySaltPerDay: 0,
    dairySaltStock: 0,
    dairySaltTarget: 0,
    dairySaltShortfall: 0,
    dairySaltShortHoldings: 0,
    firstDairySaltShortBuildingId: null,
    firstDairySaltRunwayDays: Number.POSITIVE_INFINITY,
  };
  const countedBuildings = new Set<string>();
  const countedPastoralBuildings = new Set<string>();
  const countedHaymakingBuildings = new Set<string>();
  const shortBuildings = new Set<string>();
  const dairySaltShortBuildings = new Set<string>();
  const capacityLimitedBuildings = new Set<string>();
  const remainingFeedByBuilding = new Map<string, number>();

  for (const herd of state.livestockHerds.values()) {
    const building = state.buildings.get(herd.buildingId);
    if (
      !building
      || building.constructionComplete === false
      || (building.kind !== 'pastoral_farmstead' && building.kind !== 'swineherd')
    ) {
      continue;
    }
    const plan = projectLivestockFodderHolding(
      building,
      herd,
      currentPastureCapacityMultiplier,
      sabbathObserved,
      month,
      monthDay,
      laborForecasts?.get(building.id),
    );
    const firstHerdAtBuilding = !countedBuildings.has(building.id);
    if (firstHerdAtBuilding) {
      countedBuildings.add(building.id);
      total.holdingCount += 1;
      if (plan.onsiteHumanWorkers > 0) total.staffedHoldings += 1;
      total.oatInputStock += plan.oatInputStock;
      total.animalFeedStock += plan.animalFeedStock;
      total.projectedAnimalFeedStock += plan.projectedAnimalFeedStock;
      total.feedConversionPerDay += plan.feedConversionPerDay;
      total.feedOatInputPerDay += plan.feedOatInputPerDay;
      total.dairySaltStock += plan.dairySaltStock;
      total.dairySaltTarget += plan.dairySaltTarget;
      remainingFeedByBuilding.set(building.id, Math.max(0, plan.animalFeedStock));
    }
    if (herd.species !== 'swine') {
      if (!countedPastoralBuildings.has(building.id)) {
        countedPastoralBuildings.add(building.id);
        total.pastoralHoldings += 1;
      }
      if (
        plan.haymakingPercent > 0
        && plan.onsiteHumanWorkers > 0
        && !countedHaymakingBuildings.has(building.id)
      ) {
        countedHaymakingBuildings.add(building.id);
        total.haymakingHoldings += 1;
      }
    }
    total.projectedHeadCount += plan.projectedHeadCount;
    total.plannedCullHeads += plan.plannedCullHeads;
    total.executableCullHeads += plan.executableCullHeads;
    total.unsecuredCullHeads += plan.unsecuredCullHeads;
    total.summerReservedCapacity += plan.summerReservedCapacity;
    total.hayOutputPerDay += plan.hayOutputPerDay;
    total.hayStock += plan.hayStock;
    total.projectedHayStock += plan.projectedHayStock;
    total.winterPastureCapacity += plan.winterPastureCapacity;
    total.winterUnsupportedHeads += plan.winterUnsupportedHeads;
    total.winterHayNeed += plan.winterHayNeed;
    total.winterHayShortfall += plan.winterHayShortfall;
    total.winterFeedPerDay += plan.winterFeedPerDay;
    total.winterFeedNeed += plan.winterFeedNeed;
    total.winterReserveTarget += plan.winterReserveTarget;
    const remainingFeed = remainingFeedByBuilding.get(building.id) ?? 0;
    const allocatedFeed = Math.min(plan.winterReserveTarget, remainingFeed);
    const parcelFeedShortfall = Math.max(0, plan.winterReserveTarget - allocatedFeed);
    total.oatInputTarget += parcelFeedShortfall
      * LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE
      / Math.max(1e-9, LIVESTOCK_ANIMAL_FEED_PER_CYCLE);
    remainingFeedByBuilding.set(building.id, Math.max(0, remainingFeed - allocatedFeed));
    total.winterReserveStock += allocatedFeed;
    total.winterReserveShortfall += parcelFeedShortfall;
    total.productiveDairyHeads += plan.productiveHeads;
    total.dairyPreservedFoodPerDay += plan.dairyPreservedFoodPerDay;
    total.dairySaltPerDay += plan.dairySaltPerDay;
    if (firstHerdAtBuilding) total.dairySaltShortfall += plan.dairySaltShortfall;
    if (
      plan.onsiteHumanWorkers > 0
      && plan.dairySaltTarget > 0.01
      && plan.dairySaltShortfall > 0.05
    ) {
      if (!dairySaltShortBuildings.has(building.id)) {
        dairySaltShortBuildings.add(building.id);
        total.dairySaltShortHoldings += 1;
      }
      if (
        total.firstDairySaltShortBuildingId === null
        || plan.dairySaltRunwayDays < total.firstDairySaltRunwayDays - 1e-9
        || (
          Math.abs(plan.dairySaltRunwayDays - total.firstDairySaltRunwayDays) <= 1e-9
          && compareBuildingIds(
            plan.buildingId,
            total.firstDairySaltShortBuildingId,
          ) < 0
        )
      ) {
        total.firstDairySaltShortBuildingId = plan.buildingId;
        total.firstDairySaltRunwayDays = plan.dairySaltRunwayDays;
      }
    }
    if (
      plan.winterFeedNeed > plan.winterReserveTarget + 0.05
      && !capacityLimitedBuildings.has(building.id)
    ) {
      capacityLimitedBuildings.add(building.id);
      total.capacityLimitedHoldings += 1;
    }
    if (parcelFeedShortfall <= 0.05) continue;
    if (!shortBuildings.has(building.id)) {
      shortBuildings.add(building.id);
      total.shortHoldings += 1;
    }
    if (
      total.firstShortBuildingId === null
      || plan.winterCombinedRunwayDays < total.firstRunwayDays - 1e-9
      || (
        Math.abs(plan.winterCombinedRunwayDays - total.firstRunwayDays) <= 1e-9
        && compareBuildingIds(plan.buildingId, total.firstShortBuildingId) < 0
      )
    ) {
      total.firstShortBuildingId = plan.buildingId;
      total.firstRunwayDays = plan.winterCombinedRunwayDays;
    }
  }
  total.oatInputShortfall = Math.max(
    0,
    total.oatInputTarget - total.oatInputStock,
  );
  return total;
}
