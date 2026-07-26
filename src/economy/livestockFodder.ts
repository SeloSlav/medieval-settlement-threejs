import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  CATTLE_HAY_PER_UNSUPPORTED_HEAD,
  CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
  CATTLE_GRAIN_PER_UNSUPPORTED_HEAD,
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
import {
  effectiveLivestockBreedingReserve,
  effectiveLivestockHaymakingPercent,
  isLivestockHaymakingMonth,
} from './livestockPolicy.ts';

const WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;

const GRAIN_PER_UNSUPPORTED_HEAD: Record<LivestockSpecies, number> = {
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

export type LivestockFodderHoldingPlan = {
  buildingId: string;
  species: LivestockSpecies;
  basePastureCapacity: number;
  projectedHeadCount: number;
  haymakingPercent: number;
  summerReservedCapacity: number;
  hayOutputPerDay: number;
  haymakingDaysRemaining: number;
  hayStock: number;
  projectedHayStock: number;
  currentUnsupportedHeads: number;
  currentGrainPerDay: number;
  currentGrainRunwayDays: number;
  winterPastureCapacity: number;
  winterUnsupportedHeads: number;
  winterHayNeed: number;
  winterHayShortfall: number;
  winterHayRunwayDays: number;
  winterGrainPerDay: number;
  winterGrainNeed: number;
  winterGrainRunwayDays: number;
  winterCombinedRunwayDays: number;
  winterReserveTarget: number;
  winterReserveStock: number;
  winterReserveShortfall: number;
  storageRunwayDays: number;
};

export type SettlementLivestockFodderPlan = {
  holdingCount: number;
  staffedHoldings: number;
  pastoralHoldings: number;
  haymakingHoldings: number;
  projectedHeadCount: number;
  summerReservedCapacity: number;
  hayOutputPerDay: number;
  hayStock: number;
  projectedHayStock: number;
  winterPastureCapacity: number;
  winterUnsupportedHeads: number;
  winterHayNeed: number;
  winterHayShortfall: number;
  winterGrainPerDay: number;
  winterGrainNeed: number;
  winterReserveTarget: number;
  winterReserveStock: number;
  winterReserveShortfall: number;
  shortHoldings: number;
  capacityLimitedHoldings: number;
  firstShortBuildingId: string | null;
  firstRunwayDays: number;
};

export function livestockCyclesPerCalendarDay(
  building: BuildingState,
  sabbathObserved: boolean,
): number {
  if (building.assignedLabor <= 0) return 0;
  const interval = getBuildingDefinition(building.kind).harvestInterval;
  if (interval <= 1e-9) return 0;
  return WORKDAY_SECONDS
    * (sabbathObserved ? 6 / 7 : 1)
    * building.assignedLabor
    / interval;
}

export function projectLivestockFodderHolding(
  building: BuildingState,
  herd: LivestockHerdState,
  currentPastureCapacityMultiplier: number,
  sabbathObserved: boolean,
  month: number,
  monthDay = 1,
): LivestockFodderHoldingPlan {
  const cyclesPerDay = livestockCyclesPerCalendarDay(building, sabbathObserved);
  const grainPerHead = GRAIN_PER_UNSUPPORTED_HEAD[herd.species];
  const hayPerHead = HAY_PER_UNSUPPORTED_HEAD[herd.species];
  const haymakingPercent = herd.species === 'swine'
    ? 0
    : effectiveLivestockHaymakingPercent(herd.haymakingPercent);
  const haymakingShare = haymakingPercent / 100;
  const currentGrazingShare = isLivestockHaymakingMonth(month)
    ? 1 - haymakingShare
    : 1;
  const currentCapacityFactor = currentPastureCapacityMultiplier * currentGrazingShare;
  const basePastureCapacity = currentCapacityFactor > 1e-9
    ? Math.max(0, herd.pastureCapacity) / currentCapacityFactor
    : 0;
  const projectedHeadCount = month >= 3 && month <= 11
    ? Math.min(
      herd.headCount,
      effectiveLivestockBreedingReserve(herd.species, herd.breedingReserve),
    )
    : herd.headCount;
  const summerReservedCapacity = basePastureCapacity * haymakingShare;
  const hayYieldMultiplier = isLivestockHaymakingMonth(month)
    ? Math.min(1, Math.max(0, currentPastureCapacityMultiplier))
    : 1;
  const hayOutputPerDay = summerReservedCapacity
    * HAY_YIELD_PER_RESERVED_CAPACITY[herd.species]
    * cyclesPerDay
    * hayYieldMultiplier;
  const remainingHaymakingDays = haymakingDaysRemaining(month, monthDay);
  const hayStock = Math.max(0, herd.hayStock);
  const projectedHayStock = Math.min(
    LIVESTOCK_HAY_STORAGE_CAPACITY,
    hayStock + hayOutputPerDay * remainingHaymakingDays,
  );
  const winterHayAvailable = month >= 3 && month <= LIVESTOCK_HAYMAKING_END_MONTH
    ? projectedHayStock
    : hayStock;
  const currentUnsupportedHeads = Math.max(0, herd.headCount - herd.pastureCapacity);
  const currentGrainPerDay = currentUnsupportedHeads * grainPerHead * cyclesPerDay;
  const winterPastureCapacity = basePastureCapacity
    * WINTER_PASTURE_CAPACITY_MULTIPLIER;
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
  const grainSupportedHeadCycles = Math.max(
    0,
    winterUnsupportedHeadCycles - haySupportedHeadCycles,
  );
  const winterGrainPerDay = winterUnsupportedHeads * grainPerHead * cyclesPerDay;
  const winterGrainNeed = grainSupportedHeadCycles * grainPerHead;
  const grainCapacity = buildingStorageCaps(building.kind).grain ?? 0;
  const winterReserveTarget = Math.min(winterGrainNeed, grainCapacity);
  const winterReserveStock = Math.min(
    winterReserveTarget,
    Math.max(0, building.grain),
  );

  return {
    buildingId: building.id,
    species: herd.species,
    basePastureCapacity,
    projectedHeadCount,
    haymakingPercent,
    summerReservedCapacity,
    hayOutputPerDay,
    haymakingDaysRemaining: remainingHaymakingDays,
    hayStock,
    projectedHayStock,
    currentUnsupportedHeads,
    currentGrainPerDay,
    currentGrainRunwayDays: currentGrainPerDay > 1e-9
      ? Math.max(0, building.grain) / currentGrainPerDay
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
    winterGrainPerDay,
    winterGrainNeed,
    winterGrainRunwayDays: winterGrainPerDay > 1e-9
      ? Math.max(0, building.grain) / winterGrainPerDay
      : Number.POSITIVE_INFINITY,
    winterCombinedRunwayDays: winterGrainPerDay > 1e-9
      ? (
        hayPerHead > 1e-9
          ? winterHayAvailable / (winterUnsupportedHeads * hayPerHead * cyclesPerDay)
          : 0
      ) + Math.max(0, building.grain) / winterGrainPerDay
      : Number.POSITIVE_INFINITY,
    winterReserveTarget,
    winterReserveStock,
    winterReserveShortfall: Math.max(
      0,
      winterReserveTarget - winterReserveStock,
    ),
    storageRunwayDays: winterGrainPerDay > 1e-9
      ? grainCapacity / winterGrainPerDay
      : Number.POSITIVE_INFINITY,
  };
}

export function computeSettlementLivestockFodderPlan(
  state: Pick<GameState, 'buildings' | 'livestockHerds'>,
  currentPastureCapacityMultiplier: number,
  sabbathObserved: boolean,
  month: number,
  monthDay = 1,
): SettlementLivestockFodderPlan {
  const total: SettlementLivestockFodderPlan = {
    holdingCount: 0,
    staffedHoldings: 0,
    pastoralHoldings: 0,
    haymakingHoldings: 0,
    projectedHeadCount: 0,
    summerReservedCapacity: 0,
    hayOutputPerDay: 0,
    hayStock: 0,
    projectedHayStock: 0,
    winterPastureCapacity: 0,
    winterUnsupportedHeads: 0,
    winterHayNeed: 0,
    winterHayShortfall: 0,
    winterGrainPerDay: 0,
    winterGrainNeed: 0,
    winterReserveTarget: 0,
    winterReserveStock: 0,
    winterReserveShortfall: 0,
    shortHoldings: 0,
    capacityLimitedHoldings: 0,
    firstShortBuildingId: null,
    firstRunwayDays: Number.POSITIVE_INFINITY,
  };

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
    );
    total.holdingCount += 1;
    if (building.assignedLabor > 0) total.staffedHoldings += 1;
    if (herd.species !== 'swine') {
      total.pastoralHoldings += 1;
      if (plan.haymakingPercent > 0 && building.assignedLabor > 0) {
        total.haymakingHoldings += 1;
      }
    }
    total.projectedHeadCount += plan.projectedHeadCount;
    total.summerReservedCapacity += plan.summerReservedCapacity;
    total.hayOutputPerDay += plan.hayOutputPerDay;
    total.hayStock += plan.hayStock;
    total.projectedHayStock += plan.projectedHayStock;
    total.winterPastureCapacity += plan.winterPastureCapacity;
    total.winterUnsupportedHeads += plan.winterUnsupportedHeads;
    total.winterHayNeed += plan.winterHayNeed;
    total.winterHayShortfall += plan.winterHayShortfall;
    total.winterGrainPerDay += plan.winterGrainPerDay;
    total.winterGrainNeed += plan.winterGrainNeed;
    total.winterReserveTarget += plan.winterReserveTarget;
    total.winterReserveStock += plan.winterReserveStock;
    total.winterReserveShortfall += plan.winterReserveShortfall;
    if (plan.winterGrainNeed > plan.winterReserveTarget + 0.05) {
      total.capacityLimitedHoldings += 1;
    }
    if (plan.winterReserveShortfall <= 0.05) continue;
    total.shortHoldings += 1;
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
  return total;
}
