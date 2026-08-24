import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_MONTHS_PER_YEAR,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_SUNDAY_WEEKDAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  FARM_CROP_DEFINITIONS,
  FARM_EARLY_HARVEST_MINIMUM_GROWTH,
  FARM_EARLY_HARVEST_RIPENESS_FACTOR,
  FARM_FIELD_BOUNDARY_WORK_PER_METER_PER_STAGE,
  FARM_FIELD_SETUP_WORK_PER_STAGE,
  FARM_FIELD_TRAVEL_WORK_PER_METER_PER_STAGE,
  FARM_SHARED_LABOR_MIN_PRIORITY,
  FARM_HARVEST_WORK_PER_SQUARE_METER,
  FARM_PLOUGH_WORK_PER_SQUARE_METER,
  FARM_SOW_WORK_PER_SQUARE_METER,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
  FARM_WORK_METERS_PER_WORKER_PER_SEC,
} from '../generated/gameBalance.ts';
import {
  FARM_CROPS,
  type BuildingState,
  type FarmCrop,
  type FarmFieldState,
  type GameState,
} from '../resources/types.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import { wholeResourceUnits } from '../resources/resourceUnits.ts';
import {
  computeCattleFieldSupport,
  type CattleFieldSupport,
} from './cattleFieldSupport.ts';
import {
  expectedFieldYield,
  fieldCentroid,
  fieldEdgeLengths,
  fieldShapeEfficiency,
} from './farmFieldMath.ts';
import {
  fieldManureFertilityBonus,
  fieldManureApplied,
  fieldManureRequirement,
} from './manurePlanning.ts';
import {
  farmToolsMaintained,
  farmToolIronworkForWork,
} from '../economy/civilianToolPolicy.ts';
import { breadGrainStock } from '../economy/cropGoods.ts';

export type SeasonalWorkPlan = {
  requiredWork: number;
  requiredWorkerDays: number;
  availableWorkerDays: number;
  shortfallWorkerDays: number;
};

export type FarmsteadWorkPlan = {
  activeFields: number;
  pausedFields: number;
  cattleSupportedFields: number;
  expectedHarvest: number;
  expectedBarleyHarvest: number;
  expectedFibreHarvest: number;
  harvest: SeasonalWorkPlan;
  spring: SeasonalWorkPlan;
  autumn: SeasonalWorkPlan;
  seedGrainRequired: number;
  seedBarleyRequired: number;
  manureRequired: number;
  manureApplied: number;
  toolIronworkRequired: number;
  toolIronworkReserveTarget: number;
  toolThroughputMultiplier: number;
  rotation: CropRotationPlan;
};

export type SettlementSeasonalWorkPlan = {
  requiredWorkerDays: number;
  coveredWorkerDays: number;
  shortfallWorkerDays: number;
};

export type SettlementFarmPlan = {
  holdingCount: number;
  staffedHoldings: number;
  orphanedFields: number;
  activeFields: number;
  pausedFields: number;
  cattleSupportedFields: number;
  expectedHarvest: number;
  laborCoveredHarvest: number;
  expectedBarleyHarvest: number;
  laborCoveredBarleyHarvest: number;
  expectedFibreHarvest: number;
  laborCoveredFibreHarvest: number;
  seedGrainRequired: number;
  seedGrainCovered: number;
  seedGrainShortfall: number;
  seedBarleyRequired: number;
  seedBarleyCovered: number;
  seedBarleyShortfall: number;
  seedShortHoldings: number;
  firstSeedShortBuildingId: string | null;
  manureRequired: number;
  manureApplied: number;
  manureCovered: number;
  manureShortfall: number;
  manureShortHoldings: number;
  firstManureShortBuildingId: string | null;
  toolEligibleHoldings: number;
  toolMaintainedHoldings: number;
  toolIronworkRequired: number;
  toolIronworkReserveTarget: number;
  toolIronworkCovered: number;
  toolIronworkShortfall: number;
  toolShortHoldings: number;
  firstToolShortBuildingId: string | null;
  seedGrainByHolding: ReadonlyMap<string, number>;
  seedBarleyByHolding: ReadonlyMap<string, number>;
  rotation: CropRotationPlan;
  harvest: SettlementSeasonalWorkPlan;
  spring: SettlementSeasonalWorkPlan;
  autumn: SettlementSeasonalWorkPlan;
};

export type CropRotationPlan = {
  activeArea: number;
  cyclicArea: number;
  nextRyeArea: number;
  nextOatsArea: number;
  nextFallowArea: number;
  nextAreaByCrop: Record<FarmCrop, number>;
  yearThreeAreaByCrop: Record<FarmCrop, number>;
  currentAverageFertility: number;
  afterCurrentAverageFertility: number;
  afterPlannedAverageFertility: number;
  afterYearThreeAverageFertility: number;
  plannedHarvest: number;
  plannedBarleyHarvest: number;
  plannedFibreHarvest: number;
  plannedSeedGrainRequired: number;
  plannedSeedBarleyRequired: number;
  yearThreeHarvest: number;
  yearThreeBarleyHarvest: number;
  yearThreeFibreHarvest: number;
  yearThreeSeedGrainRequired: number;
  yearThreeSeedBarleyRequired: number;
  restoringFields: number;
  decliningFields: number;
  yearThreeRestoringFields: number;
  yearThreeDecliningFields: number;
  weakestFieldId: string | null;
  lowestPlannedFertility: number | null;
  weakestYearThreeFieldId: string | null;
  lowestYearThreeFertility: number | null;
};

export type EarlyHarvestAvailability = {
  available: boolean;
  yieldMultiplier: number;
  reason: string;
};

type FarmWorkWindows = {
  harvest: number;
  spring: number;
  autumn: number;
};

const WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;
const WORK_PER_WORKER_DAY = FARM_WORK_METERS_PER_WORKER_PER_SEC * WORKDAY_SECONDS;

type FieldWorkFarmstead = Pick<BuildingState, 'x' | 'z'>;
type FieldLaborFarmstead = Pick<BuildingState, 'id' | 'x' | 'z' | 'workRadius'>;

type FieldWorkMetrics = {
  areaWorkFactor: number;
  stageOverhead: number;
};

export function fieldPerimeter(field: Pick<FarmFieldState, 'corners'>): number {
  return fieldEdgeLengths(field.corners).reduce((sum, edge) => sum + edge, 0);
}

export function fieldFarmsteadDistance(
  field: Pick<FarmFieldState, 'corners'>,
  farmstead?: FieldWorkFarmstead | null,
): number {
  if (!farmstead) return 0;
  const center = fieldCentroid(field.corners);
  return Math.hypot(center.x - farmstead.x, center.z - farmstead.z);
}

export function fieldAcceptsFarmsteadLabor(
  field: Pick<FarmFieldState, 'farmsteadId' | 'priority' | 'corners'>,
  farmstead: FieldLaborFarmstead,
): boolean {
  if (field.priority <= 0) return false;
  if (field.farmsteadId === farmstead.id) return true;
  return field.priority >= FARM_SHARED_LABOR_MIN_PRIORITY
    && fieldFarmsteadDistance(field, farmstead) <= Math.max(0, farmstead.workRadius);
}

function fieldWorkMetrics(
  field: Pick<FarmFieldState, 'area' | 'corners'>,
  farmstead?: FieldWorkFarmstead | null,
): FieldWorkMetrics {
  return {
    areaWorkFactor: field.area / fieldShapeEfficiency(field.corners),
    stageOverhead: FARM_FIELD_SETUP_WORK_PER_STAGE
      + fieldPerimeter(field) * FARM_FIELD_BOUNDARY_WORK_PER_METER_PER_STAGE
      + fieldFarmsteadDistance(field, farmstead) * FARM_FIELD_TRAVEL_WORK_PER_METER_PER_STAGE,
  };
}

function fieldStageWorkFromMetrics(
  metrics: FieldWorkMetrics,
  workPerSquareMeter: number,
): number {
  if (workPerSquareMeter <= 0) return 0;
  return metrics.areaWorkFactor * workPerSquareMeter + metrics.stageOverhead;
}

export function fieldStageWork(
  field: Pick<FarmFieldState, 'area' | 'corners'>,
  workPerSquareMeter: number,
  farmstead?: FieldWorkFarmstead | null,
): number {
  return fieldStageWorkFromMetrics(fieldWorkMetrics(field, farmstead), workPerSquareMeter);
}

export function fullFieldCycleWork(
  field: Pick<FarmFieldState, 'area' | 'corners' | 'crop'>,
  farmstead?: FieldWorkFarmstead | null,
): number {
  const metrics = fieldWorkMetrics(field, farmstead);
  const sowing = field.crop === 'fallow'
    ? 0
    : fieldStageWorkFromMetrics(metrics, FARM_SOW_WORK_PER_SQUARE_METER);
  const harvest = field.crop === 'fallow'
    ? 0
    : fieldStageWorkFromMetrics(metrics, FARM_HARVEST_WORK_PER_SQUARE_METER);
  return fieldStageWorkFromMetrics(metrics, FARM_PLOUGH_WORK_PER_SQUARE_METER)
    + sowing
    + harvest;
}

function currentFieldWorkRemainingWithMetrics(
  field: FarmFieldState,
  ploughWorkMultiplier: number,
  metrics: FieldWorkMetrics,
): number {
  const rate = field.stage === 'ploughing'
    ? FARM_PLOUGH_WORK_PER_SQUARE_METER
    : field.stage === 'sowing'
      ? FARM_SOW_WORK_PER_SQUARE_METER
      : field.stage === 'harvesting'
        ? FARM_HARVEST_WORK_PER_SQUARE_METER
        : 0;
  const supportMultiplier = field.stage === 'ploughing'
    ? Math.max(0, ploughWorkMultiplier)
    : 1;
  return fieldStageWorkFromMetrics(metrics, rate)
    * supportMultiplier
    * Math.max(0, 1 - field.stageProgress);
}

export function currentFieldWorkRemaining(
  field: FarmFieldState,
  ploughWorkMultiplier = 1,
  farmstead?: FieldWorkFarmstead | null,
): number {
  return currentFieldWorkRemainingWithMetrics(
    field,
    ploughWorkMultiplier,
    fieldWorkMetrics(field, farmstead),
  );
}

export function fieldWorkerDays(work: number): number {
  return Math.max(0, work) / Math.max(1e-6, WORK_PER_WORKER_DAY);
}

export function projectedCropFertility(
  fertility: number,
  crop: FarmCrop,
  cattleFertilityBonus = 0,
): number {
  const delta = FARM_CROP_DEFINITIONS[crop].fertilityDelta;
  return Math.max(0.2, Math.min(1, fertility + delta + cattleFertilityBonus));
}

export function projectedFieldFertility(
  field: FarmFieldState,
  manureFertilityBonus = fieldManureFertilityBonus(field),
): number {
  return projectedCropFertility(
    field.fertility,
    field.crop,
    manureFertilityBonus,
  );
}

export function cropSeedGrainPerSquareMeter(crop: FarmCrop): number {
  return FARM_CROP_DEFINITIONS[crop].seedGrainPerSquareMeter;
}

export function seedGrainRequired(area: number, crop: FarmCrop): number {
  const raw = Math.max(0, area) * cropSeedGrainPerSquareMeter(crop);
  return raw > 0 ? Math.ceil(raw - 1e-6) : 0;
}

export function fieldSeedGrainRemaining(field: FarmFieldState): number {
  if (field.priority <= 0) return 0;
  const plannedCrop = field.stage === 'ploughing' || field.stage === 'sowing'
    ? field.crop
    : field.nextCrop;
  if (FARM_CROP_DEFINITIONS[plannedCrop].produce === 'barley') return 0;
  return field.stage === 'sowing' && field.stageProgress > 1e-9
    ? 0
    : seedGrainRequired(field.area, plannedCrop);
}

export function fieldSeedBarleyRemaining(field: FarmFieldState): number {
  if (field.priority <= 0) return 0;
  const plannedCrop = field.stage === 'ploughing' || field.stage === 'sowing'
    ? field.crop
    : field.nextCrop;
  if (FARM_CROP_DEFINITIONS[plannedCrop].produce !== 'barley') return 0;
  return field.stage === 'sowing' && field.stageProgress > 1e-9
    ? 0
    : seedGrainRequired(field.area, plannedCrop);
}

export function farmsteadSeedGrainRequired(fields: Iterable<FarmFieldState>): number {
  let required = 0;
  for (const field of fields) required += fieldSeedGrainRemaining(field);
  return required;
}

export function farmsteadExportableGrain(
  stock: number,
  fields: Iterable<FarmFieldState>,
): number {
  return Math.max(0, wholeResourceUnits(stock) - farmsteadSeedGrainRequired(fields));
}

export function fieldStageAllowed(field: FarmFieldState, month: number): boolean {
  const crop = FARM_CROP_DEFINITIONS[field.crop];
  if (field.stage === 'harvesting') {
    const earlyMonth = crop.harvestMonth <= 1
      ? CALENDAR_MONTHS_PER_YEAR
      : crop.harvestMonth - 1;
    return month === earlyMonth || month === crop.harvestMonth;
  }
  if (field.stage === 'growing') {
    return month >= crop.growthStartMonth && month <= crop.growthEndMonth;
  }
  return month >= crop.workStartMonth && month <= crop.workEndMonth;
}

export function farmsteadSeedBarleyRequired(fields: Iterable<FarmFieldState>): number {
  let required = 0;
  for (const field of fields) required += fieldSeedBarleyRemaining(field);
  return required;
}

/** Third planned crop, with old two-cycle saves repeating their next crop. */
export function yearThreeCrop(field: FarmFieldState): FarmCrop {
  return field.followingCrop ?? field.nextCrop;
}

export function earlyHarvestYieldMultiplier(growthProgress: number): number {
  return Math.max(0, Math.min(1, growthProgress)) * FARM_EARLY_HARVEST_RIPENESS_FACTOR;
}

export function earlyHarvestAvailability(
  field: FarmFieldState,
  month: number,
): EarlyHarvestAvailability {
  const yieldMultiplier = earlyHarvestYieldMultiplier(field.stageProgress);
  if (field.stage !== 'growing') {
    return { available: false, yieldMultiplier, reason: 'Only a growing crop can be cut early.' };
  }
  if (FARM_CROP_DEFINITIONS[field.crop].produce === 'none') {
    return { available: false, yieldMultiplier, reason: 'Worked fallow has no crop to harvest.' };
  }
  const harvestMonth = FARM_CROP_DEFINITIONS[field.crop].harvestMonth;
  const earlyMonth = harvestMonth <= 1 ? CALENDAR_MONTHS_PER_YEAR : harvestMonth - 1;
  if (month !== earlyMonth) {
    return {
      available: false,
      yieldMultiplier,
      reason: `Early harvest opens in month ${earlyMonth}.`,
    };
  }
  if (field.stageProgress < FARM_EARLY_HARVEST_MINIMUM_GROWTH) {
    return {
      available: false,
      yieldMultiplier,
      reason: `Crop needs ${Math.round(FARM_EARLY_HARVEST_MINIMUM_GROWTH * 100)}% growth before it can be cut.`,
    };
  }
  return {
    available: true,
    yieldMultiplier,
    reason: 'Cut now to spread harvest labor, but permanently sacrifice unripe yield.',
  };
}

export function activeFieldHarvestYield(field: FarmFieldState): number {
  const multiplier = field.stage === 'harvesting'
    ? Math.max(0, Math.min(1, field.harvestYieldMultiplier ?? 1))
    : 1;
  return expectedFieldYield(field) * multiplier;
}

export function cropCalendarLabel(crop: FarmCrop): string {
  return FARM_CROP_DEFINITIONS[crop].calendarLabel;
}

/**
 * Calendar time until this crop's normal harvest month opens. Once that month
 * is underway the window is reported as open rather than wrapping to next year.
 */
export function daysUntilCropHarvestWindow(
  clock: Pick<
    GameClock,
    'month' | 'monthDay' | 'hour' | 'preciseHour' | 'preciseCalendarDay'
  >,
  crop: FarmCrop,
): number {
  const harvestMonth = FARM_CROP_DEFINITIONS[crop].harvestMonth;
  if (clock.month === harvestMonth) return 0;

  const currentHour = clock.preciseHour ?? clock.hour;
  const currentDayOfYear = clock.preciseCalendarDay
    ?? (clock.month - 1) * CALENDAR_DAYS_PER_MONTH
      + Math.max(0, clock.monthDay - 1)
      + currentHour / CALENDAR_HOURS_PER_DAY;
  const harvestDayOfYear = (harvestMonth - 1) * CALENDAR_DAYS_PER_MONTH;
  const daysPerYear = CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
  const delta = harvestDayOfYear - currentDayOfYear;
  return Math.max(0, delta >= 0 ? delta : delta + daysPerYear);
}

function productiveSecondsInWindow(
  clock: GameClock,
  startMonth: number,
  endMonth: number,
  sabbathObserved: boolean,
): number {
  const daysPerYear = CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
  const currentDayOfYear = (clock.month - 1) * CALENDAR_DAYS_PER_MONTH + clock.monthDay - 1;
  const startDayOfYear = (startMonth - 1) * CALENDAR_DAYS_PER_MONTH;
  const endDayOfYear = endMonth * CALENDAR_DAYS_PER_MONTH;
  const insideWindow = currentDayOfYear >= startDayOfYear && currentDayOfYear < endDayOfYear;
  const startOffset = insideWindow
    ? 0
    : currentDayOfYear < startDayOfYear
      ? startDayOfYear - currentDayOfYear
      : daysPerYear - currentDayOfYear + startDayOfYear;
  const durationDays = endDayOfYear - startDayOfYear;
  const endOffset = insideWindow
    ? endDayOfYear - currentDayOfYear
    : startOffset + durationDays;
  let productiveSeconds = 0;

  for (let offset = startOffset; offset < endOffset; offset++) {
    const weekday = (clock.weekday + offset) % 7;
    if (sabbathObserved && weekday === CALENDAR_SUNDAY_WEEKDAY) continue;
    if (offset === 0) {
      const hour = clock.preciseHour ?? clock.hour + clock.minute / 60;
      const hoursLeft = Math.max(
        0,
        CALENDAR_WORK_END_HOUR - Math.max(CALENDAR_WORK_START_HOUR, hour),
      );
      productiveSeconds += hoursLeft / CALENDAR_HOURS_PER_DAY * CALENDAR_SECONDS_PER_DAY;
    } else {
      productiveSeconds += WORKDAY_SECONDS;
    }
  }
  return productiveSeconds;
}

function seasonalPlan(
  requiredWork: number,
  workers: number,
  productiveSeconds: number,
  throughputMultiplier = 1,
): SeasonalWorkPlan {
  const requiredWorkerDays = fieldWorkerDays(requiredWork);
  const availableWorkerDays = Math.max(0, workers)
    * productiveSeconds
    / WORKDAY_SECONDS
    * Math.max(0, throughputMultiplier);
  return {
    requiredWork,
    requiredWorkerDays,
    availableWorkerDays,
    shortfallWorkerDays: Math.max(0, requiredWorkerDays - availableWorkerDays),
  };
}

function plannedFieldWorkCrop(field: FarmFieldState): FarmCrop {
  return field.stage === 'ploughing' || field.stage === 'sowing'
    ? field.crop
    : field.nextCrop;
}

function remainingTillageAndSowingWork(
  field: FarmFieldState,
  support: CattleFieldSupport | undefined,
  metrics: FieldWorkMetrics,
): number {
  const crop = plannedFieldWorkCrop(field);
  if (field.stage === 'sowing') {
    return currentFieldWorkRemainingWithMetrics(field, 1, metrics);
  }
  if (field.stage === 'ploughing') {
    return currentFieldWorkRemainingWithMetrics(
      field,
      support?.ploughWorkMultiplier ?? 1,
      metrics,
    ) + (crop === 'fallow'
      ? 0
      : fieldStageWorkFromMetrics(metrics, FARM_SOW_WORK_PER_SQUARE_METER));
  }
  return fieldStageWorkFromMetrics(metrics, FARM_PLOUGH_WORK_PER_SQUARE_METER)
    * (support?.ploughWorkMultiplier ?? 1)
    + (crop === 'fallow'
      ? 0
      : fieldStageWorkFromMetrics(metrics, FARM_SOW_WORK_PER_SQUARE_METER));
}

function farmWorkWindows(
  clock: GameClock,
  sabbathObserved: boolean,
): FarmWorkWindows {
  return {
    harvest: productiveSecondsInWindow(clock, 8, 9, sabbathObserved),
    spring: productiveSecondsInWindow(clock, 3, 4, sabbathObserved),
    autumn: productiveSecondsInWindow(clock, 10, 11, sabbathObserved),
  };
}

function buildFarmsteadWorkPlanWithWindows(
  fields: Iterable<FarmFieldState>,
  workers: number,
  windows: FarmWorkWindows,
  cattleSupport: ReadonlyMap<string, CattleFieldSupport>,
  toolIronworkAvailable = 0,
  farmstead?: FieldWorkFarmstead | null,
): FarmsteadWorkPlan {
  let activeFields = 0;
  let pausedFields = 0;
  let cattleSupportedFields = 0;
  let expectedHarvest = 0;
  let expectedBarleyHarvest = 0;
  let expectedFibreHarvest = 0;
  let harvestWork = 0;
  let springWork = 0;
  let autumnWork = 0;
  let seedGrain = 0;
  let seedBarley = 0;
  let manureRequired = 0;
  let manureApplied = 0;
  const rotation = emptyCropRotationPlan();
  let currentFertilityArea = 0;
  let afterCurrentFertilityArea = 0;
  let afterPlannedFertilityArea = 0;
  let afterYearThreeFertilityArea = 0;

  for (const field of fields) {
    if (field.priority <= 0) {
      pausedFields += 1;
      continue;
    }
    activeFields += 1;
    const support = cattleSupport.get(field.id);
    const workMetrics = fieldWorkMetrics(field, farmstead);
    if (support) cattleSupportedFields += 1;
    const area = Math.max(0, field.area);
    const currentFertility = Math.max(0.2, Math.min(1, field.fertility));
    const afterCurrentFertility = projectedFieldFertility(
      field,
      fieldManureFertilityBonus(field),
    );
    manureRequired += fieldManureRequirement(field);
    manureApplied += fieldManureApplied(field);
    const afterPlannedFertility = projectedCropFertility(
      afterCurrentFertility,
      field.nextCrop,
    );
    const thirdCrop = yearThreeCrop(field);
    const afterYearThreeFertility = projectedCropFertility(
      afterPlannedFertility,
      thirdCrop,
    );
    rotation.activeArea += area;
    if (field.followingCrop != null) rotation.cyclicArea += area;
    currentFertilityArea += currentFertility * area;
    afterCurrentFertilityArea += afterCurrentFertility * area;
    afterPlannedFertilityArea += afterPlannedFertility * area;
    afterYearThreeFertilityArea += afterYearThreeFertility * area;
    rotation.nextAreaByCrop[field.nextCrop] += area;
    rotation.yearThreeAreaByCrop[thirdCrop] += area;
    if (field.nextCrop === 'rye') rotation.nextRyeArea += area;
    else if (field.nextCrop === 'oats') rotation.nextOatsArea += area;
    else if (field.nextCrop === 'fallow') rotation.nextFallowArea += area;
    const plannedYield = expectedFieldYield({
      ...field,
      crop: field.nextCrop,
      fertility: afterCurrentFertility,
    });
    const plannedProduce = FARM_CROP_DEFINITIONS[field.nextCrop].produce;
    if (plannedProduce === 'grain') rotation.plannedHarvest += plannedYield;
    else if (plannedProduce === 'barley') rotation.plannedBarleyHarvest += plannedYield;
    else if (plannedProduce === 'fibre') rotation.plannedFibreHarvest += plannedYield;
    if (plannedProduce === 'barley') {
      rotation.plannedSeedBarleyRequired += seedGrainRequired(area, field.nextCrop);
    } else {
      rotation.plannedSeedGrainRequired += seedGrainRequired(area, field.nextCrop);
    }
    const yearThreeYield = expectedFieldYield({
      ...field,
      crop: thirdCrop,
      fertility: afterPlannedFertility,
    });
    const yearThreeProduce = FARM_CROP_DEFINITIONS[thirdCrop].produce;
    if (yearThreeProduce === 'grain') rotation.yearThreeHarvest += yearThreeYield;
    else if (yearThreeProduce === 'barley') {
      rotation.yearThreeBarleyHarvest += yearThreeYield;
    }
    else if (yearThreeProduce === 'fibre') {
      rotation.yearThreeFibreHarvest += yearThreeYield;
    }
    if (yearThreeProduce === 'barley') {
      rotation.yearThreeSeedBarleyRequired += seedGrainRequired(area, thirdCrop);
    } else {
      rotation.yearThreeSeedGrainRequired += seedGrainRequired(area, thirdCrop);
    }
    if (afterPlannedFertility > afterCurrentFertility + 1e-9) {
      rotation.restoringFields += 1;
    } else if (afterPlannedFertility < afterCurrentFertility - 1e-9) {
      rotation.decliningFields += 1;
    }
    if (afterYearThreeFertility > afterPlannedFertility + 1e-9) {
      rotation.yearThreeRestoringFields += 1;
    } else if (afterYearThreeFertility < afterPlannedFertility - 1e-9) {
      rotation.yearThreeDecliningFields += 1;
    }
    if (
      rotation.lowestPlannedFertility === null
      || afterPlannedFertility < rotation.lowestPlannedFertility - 1e-9
      || (
        Math.abs(afterPlannedFertility - rotation.lowestPlannedFertility) <= 1e-9
        && rotation.weakestFieldId !== null
        && compareStableEntityIds(field.id, rotation.weakestFieldId) < 0
      )
    ) {
      rotation.lowestPlannedFertility = afterPlannedFertility;
      rotation.weakestFieldId = field.id;
    }
    if (
      rotation.lowestYearThreeFertility === null
      || afterYearThreeFertility < rotation.lowestYearThreeFertility - 1e-9
      || (
        Math.abs(afterYearThreeFertility - rotation.lowestYearThreeFertility) <= 1e-9
        && rotation.weakestYearThreeFieldId !== null
        && compareStableEntityIds(field.id, rotation.weakestYearThreeFieldId) < 0
      )
    ) {
      rotation.lowestYearThreeFertility = afterYearThreeFertility;
      rotation.weakestYearThreeFieldId = field.id;
    }
    seedGrain += fieldSeedGrainRemaining(field);
    seedBarley += fieldSeedBarleyRemaining(field);
    const currentProduce = FARM_CROP_DEFINITIONS[field.crop].produce;
    if (currentProduce !== 'none') {
      const fieldYield = activeFieldHarvestYield(field);
      const remainingYield = field.stage === 'harvesting'
        ? Math.max(0, fieldYield - field.currentYield)
        : fieldYield;
      if (currentProduce === 'grain') expectedHarvest += remainingYield;
      else if (currentProduce === 'barley') expectedBarleyHarvest += remainingYield;
      else expectedFibreHarvest += remainingYield;
      harvestWork += field.stage === 'harvesting'
        ? currentFieldWorkRemainingWithMetrics(field, 1, workMetrics)
        : fieldStageWorkFromMetrics(workMetrics, FARM_HARVEST_WORK_PER_SQUARE_METER);
    }

    const scheduledWork = remainingTillageAndSowingWork(field, support, workMetrics);
    if (FARM_CROP_DEFINITIONS[plannedFieldWorkCrop(field)].workSeason === 'spring') {
      springWork += scheduledWork;
    } else {
      autumnWork += scheduledWork;
    }
  }
  normalizeCropRotationFertility(
    rotation,
    currentFertilityArea,
    afterCurrentFertilityArea,
    afterPlannedFertilityArea,
    afterYearThreeFertilityArea,
  );
  const toolIronworkRequired = farmToolIronworkForWork(
    harvestWork + springWork + autumnWork,
  );
  const toolIronworkReserveTarget = toolIronworkRequired <= 1e-9
    ? 0
    : Math.max(CIVILIAN_TOOL_IRONWORK_PER_CYCLE, toolIronworkRequired);
  const toolThroughputMultiplier = toolIronworkReserveTarget > 1e-9
    && Math.max(0, toolIronworkAvailable) + 1e-6 >= toolIronworkReserveTarget
    ? CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
    : 1;

  return {
    activeFields,
    pausedFields,
    cattleSupportedFields,
    expectedHarvest,
    expectedBarleyHarvest,
    expectedFibreHarvest,
    harvest: seasonalPlan(
      harvestWork,
      workers,
      windows.harvest,
      toolThroughputMultiplier,
    ),
    spring: seasonalPlan(
      springWork,
      workers,
      windows.spring,
      toolThroughputMultiplier,
    ),
    autumn: seasonalPlan(
      autumnWork,
      workers,
      windows.autumn,
      toolThroughputMultiplier,
    ),
    seedGrainRequired: seedGrain,
    seedBarleyRequired: seedBarley,
    manureRequired,
    manureApplied,
    toolIronworkRequired,
    toolIronworkReserveTarget,
    toolThroughputMultiplier,
    rotation,
  };
}

export function buildFarmsteadWorkPlan(
  fields: Iterable<FarmFieldState>,
  workers: number,
  clock: GameClock,
  sabbathObserved: boolean,
  cattleSupport: ReadonlyMap<string, CattleFieldSupport> = new Map(),
  toolIronworkAvailable = 0,
  farmstead?: FieldWorkFarmstead | null,
): FarmsteadWorkPlan {
  return buildFarmsteadWorkPlanWithWindows(
    fields,
    workers,
    farmWorkWindows(clock, sabbathObserved),
    cattleSupport,
    toolIronworkAvailable,
    farmstead,
  );
}

function emptySettlementSeason(): SettlementSeasonalWorkPlan {
  return {
    requiredWorkerDays: 0,
    coveredWorkerDays: 0,
    shortfallWorkerDays: 0,
  };
}

function emptyCropRotationPlan(): CropRotationPlan {
  const nextAreaByCrop = Object.fromEntries(
    FARM_CROPS.map((crop) => [crop, 0]),
  ) as Record<FarmCrop, number>;
  const yearThreeAreaByCrop = Object.fromEntries(
    FARM_CROPS.map((crop) => [crop, 0]),
  ) as Record<FarmCrop, number>;
  return {
    activeArea: 0,
    cyclicArea: 0,
    nextRyeArea: 0,
    nextOatsArea: 0,
    nextFallowArea: 0,
    nextAreaByCrop,
    yearThreeAreaByCrop,
    currentAverageFertility: 0,
    afterCurrentAverageFertility: 0,
    afterPlannedAverageFertility: 0,
    afterYearThreeAverageFertility: 0,
    plannedHarvest: 0,
    plannedBarleyHarvest: 0,
    plannedFibreHarvest: 0,
    plannedSeedGrainRequired: 0,
    plannedSeedBarleyRequired: 0,
    yearThreeHarvest: 0,
    yearThreeBarleyHarvest: 0,
    yearThreeFibreHarvest: 0,
    yearThreeSeedGrainRequired: 0,
    yearThreeSeedBarleyRequired: 0,
    restoringFields: 0,
    decliningFields: 0,
    yearThreeRestoringFields: 0,
    yearThreeDecliningFields: 0,
    weakestFieldId: null,
    lowestPlannedFertility: null,
    weakestYearThreeFieldId: null,
    lowestYearThreeFertility: null,
  };
}

function normalizeCropRotationFertility(
  rotation: CropRotationPlan,
  currentFertilityArea: number,
  afterCurrentFertilityArea: number,
  afterPlannedFertilityArea: number,
  afterYearThreeFertilityArea: number,
): void {
  if (rotation.activeArea <= 1e-9) return;
  rotation.currentAverageFertility =
    currentFertilityArea / rotation.activeArea;
  rotation.afterCurrentAverageFertility =
    afterCurrentFertilityArea / rotation.activeArea;
  rotation.afterPlannedAverageFertility =
    afterPlannedFertilityArea / rotation.activeArea;
  rotation.afterYearThreeAverageFertility =
    afterYearThreeFertilityArea / rotation.activeArea;
}

function addSettlementSeason(
  total: SettlementSeasonalWorkPlan,
  holding: SeasonalWorkPlan,
): void {
  total.requiredWorkerDays += holding.requiredWorkerDays;
  total.coveredWorkerDays += Math.min(
    holding.requiredWorkerDays,
    holding.availableWorkerDays,
  );
  total.shortfallWorkerDays += holding.shortfallWorkerDays;
}

/**
 * Settlement-wide field plan that retains farmstead-level labor and seed
 * constraints. A surplus crew or grain pile at one holding therefore cannot
 * conceal an uncovered field group elsewhere.
 */
export function buildSettlementFarmPlan(
  state: GameState,
  clock: GameClock,
  sabbathObserved: boolean,
): SettlementFarmPlan {
  const fieldsByHolding = new Map<string, FarmFieldState[]>();
  for (const field of state.farmFields.values()) {
    const fields = fieldsByHolding.get(field.farmsteadId);
    if (fields) fields.push(field);
    else fieldsByHolding.set(field.farmsteadId, [field]);
  }
  const seedGrainByHolding = new Map<string, number>();
  const seedBarleyByHolding = new Map<string, number>();
  const inboundManureByHolding = new Map<string, number>();
  const inboundIronworkByHolding = new Map<string, number>();
  for (const trip of state.deliveryTrips.values()) {
    if (
      trip.targetBuildingId == null
      || trip.destinationKind !== 'building'
      || trip.phase === 'inbound'
    ) {
      continue;
    }
    if (trip.cargoKind === 'manure') {
      inboundManureByHolding.set(
        trip.targetBuildingId,
        (inboundManureByHolding.get(trip.targetBuildingId) ?? 0)
          + Math.max(0, trip.amount),
      );
    } else if (trip.cargoKind === 'ironwork') {
      inboundIronworkByHolding.set(
        trip.targetBuildingId,
        (inboundIronworkByHolding.get(trip.targetBuildingId) ?? 0)
          + Math.max(0, trip.amount),
      );
    }
  }

  const total: SettlementFarmPlan = {
    holdingCount: fieldsByHolding.size,
    staffedHoldings: 0,
    orphanedFields: 0,
    activeFields: 0,
    pausedFields: 0,
    cattleSupportedFields: 0,
    expectedHarvest: 0,
    laborCoveredHarvest: 0,
    expectedBarleyHarvest: 0,
    laborCoveredBarleyHarvest: 0,
    expectedFibreHarvest: 0,
    laborCoveredFibreHarvest: 0,
    seedGrainRequired: 0,
    seedGrainCovered: 0,
    seedGrainShortfall: 0,
    seedBarleyRequired: 0,
    seedBarleyCovered: 0,
    seedBarleyShortfall: 0,
    seedShortHoldings: 0,
    firstSeedShortBuildingId: null,
    manureRequired: 0,
    manureApplied: 0,
    manureCovered: 0,
    manureShortfall: 0,
    manureShortHoldings: 0,
    firstManureShortBuildingId: null,
    toolEligibleHoldings: 0,
    toolMaintainedHoldings: 0,
    toolIronworkRequired: 0,
    toolIronworkReserveTarget: 0,
    toolIronworkCovered: 0,
    toolIronworkShortfall: 0,
    toolShortHoldings: 0,
    firstToolShortBuildingId: null,
    seedGrainByHolding,
    seedBarleyByHolding,
    rotation: emptyCropRotationPlan(),
    harvest: emptySettlementSeason(),
    spring: emptySettlementSeason(),
    autumn: emptySettlementSeason(),
  };
  const windows = farmWorkWindows(clock, sabbathObserved);
  const cattleSupport = computeCattleFieldSupport(state);
  let firstSeedCoverage = Number.POSITIVE_INFINITY;
  let currentFertilityArea = 0;
  let afterCurrentFertilityArea = 0;
  let afterPlannedFertilityArea = 0;
  let afterYearThreeFertilityArea = 0;

  for (const [farmsteadId, fields] of fieldsByHolding) {
    const farmstead = state.buildings.get(farmsteadId);
    const operational = farmstead?.kind === 'threshing_barn'
      && farmstead.constructionComplete !== false;
    const workers = operational ? Math.max(0, farmstead.assignedLabor) : 0;
    const grain = operational ? breadGrainStock(farmstead) : 0;
    const barley = operational ? Math.max(0, farmstead.barley ?? 0) : 0;
    if (workers > 0) total.staffedHoldings += 1;
    if (!operational) total.orphanedFields += fields.length;

    const onsiteIronwork = operational ? Math.max(0, farmstead?.ironwork ?? 0) : 0;
    const inboundIronwork = operational
      ? inboundIronworkByHolding.get(farmsteadId) ?? 0
      : 0;
    const plan = buildFarmsteadWorkPlanWithWindows(
      fields,
      workers,
      windows,
      cattleSupport,
      onsiteIronwork + inboundIronwork,
      farmstead,
    );
    total.activeFields += plan.activeFields;
    total.pausedFields += plan.pausedFields;
    total.cattleSupportedFields += plan.cattleSupportedFields;
    total.expectedHarvest += plan.expectedHarvest;
    total.expectedBarleyHarvest += plan.expectedBarleyHarvest;
    total.expectedFibreHarvest += plan.expectedFibreHarvest;
    total.seedGrainRequired += plan.seedGrainRequired;
    total.seedBarleyRequired += plan.seedBarleyRequired;
    total.manureRequired += plan.manureRequired;
    total.manureApplied += plan.manureApplied;
    const onsiteManure = operational ? Math.max(0, farmstead?.manure ?? 0) : 0;
    const inboundManure = operational
      ? inboundManureByHolding.get(farmsteadId) ?? 0
      : 0;
    const manureCovered = Math.min(
      plan.manureRequired,
      plan.manureApplied + onsiteManure + inboundManure,
    );
    const manureShortfall = Math.max(0, plan.manureRequired - manureCovered);
    total.manureCovered += manureCovered;
    total.manureShortfall += manureShortfall;
    if (manureShortfall > 0.05) {
      total.manureShortHoldings += 1;
      total.firstManureShortBuildingId ??= farmsteadId;
    }
    const toolIronworkRequired = operational ? plan.toolIronworkRequired : 0;
    const toolIronworkReserveTarget = operational ? plan.toolIronworkReserveTarget : 0;
    total.toolIronworkRequired += toolIronworkRequired;
    total.toolIronworkReserveTarget += toolIronworkReserveTarget;
    const toolCovered = Math.min(
      toolIronworkReserveTarget,
      onsiteIronwork + inboundIronwork,
    );
    const toolShortfall = Math.max(
      0,
      toolIronworkReserveTarget - toolCovered,
    );
    total.toolIronworkCovered += toolCovered;
    total.toolIronworkShortfall += toolShortfall;
    if (operational && toolIronworkReserveTarget > 1e-9) {
      total.toolEligibleHoldings += 1;
      if (farmToolsMaintained(onsiteIronwork)) {
        total.toolMaintainedHoldings += 1;
      }
      if (toolShortfall > 0.01) {
        total.toolShortHoldings += 1;
        total.firstToolShortBuildingId ??= farmsteadId;
      }
    }
    seedGrainByHolding.set(farmsteadId, plan.seedGrainRequired);
    seedBarleyByHolding.set(farmsteadId, plan.seedBarleyRequired);
    total.rotation.activeArea += plan.rotation.activeArea;
    total.rotation.cyclicArea += plan.rotation.cyclicArea;
    total.rotation.nextRyeArea += plan.rotation.nextRyeArea;
    total.rotation.nextOatsArea += plan.rotation.nextOatsArea;
    total.rotation.nextFallowArea += plan.rotation.nextFallowArea;
    for (const crop of FARM_CROPS) {
      total.rotation.nextAreaByCrop[crop] += plan.rotation.nextAreaByCrop[crop];
      total.rotation.yearThreeAreaByCrop[crop] +=
        plan.rotation.yearThreeAreaByCrop[crop];
    }
    currentFertilityArea += plan.rotation.currentAverageFertility
      * plan.rotation.activeArea;
    afterCurrentFertilityArea += plan.rotation.afterCurrentAverageFertility
      * plan.rotation.activeArea;
    afterPlannedFertilityArea += plan.rotation.afterPlannedAverageFertility
      * plan.rotation.activeArea;
    afterYearThreeFertilityArea += plan.rotation.afterYearThreeAverageFertility
      * plan.rotation.activeArea;
    total.rotation.plannedHarvest += plan.rotation.plannedHarvest;
    total.rotation.plannedBarleyHarvest += plan.rotation.plannedBarleyHarvest;
    total.rotation.plannedFibreHarvest += plan.rotation.plannedFibreHarvest;
    total.rotation.plannedSeedGrainRequired +=
      plan.rotation.plannedSeedGrainRequired;
    total.rotation.plannedSeedBarleyRequired +=
      plan.rotation.plannedSeedBarleyRequired;
    total.rotation.yearThreeHarvest += plan.rotation.yearThreeHarvest;
    total.rotation.yearThreeBarleyHarvest +=
      plan.rotation.yearThreeBarleyHarvest;
    total.rotation.yearThreeFibreHarvest += plan.rotation.yearThreeFibreHarvest;
    total.rotation.yearThreeSeedGrainRequired +=
      plan.rotation.yearThreeSeedGrainRequired;
    total.rotation.yearThreeSeedBarleyRequired +=
      plan.rotation.yearThreeSeedBarleyRequired;
    total.rotation.restoringFields += plan.rotation.restoringFields;
    total.rotation.decliningFields += plan.rotation.decliningFields;
    total.rotation.yearThreeRestoringFields += plan.rotation.yearThreeRestoringFields;
    total.rotation.yearThreeDecliningFields += plan.rotation.yearThreeDecliningFields;
    if (
      plan.rotation.lowestPlannedFertility !== null
      && (
        total.rotation.lowestPlannedFertility === null
        || plan.rotation.lowestPlannedFertility
          < total.rotation.lowestPlannedFertility - 1e-9
        || (
          Math.abs(
            plan.rotation.lowestPlannedFertility
              - total.rotation.lowestPlannedFertility,
          ) <= 1e-9
          && plan.rotation.weakestFieldId !== null
          && total.rotation.weakestFieldId !== null
          && compareStableEntityIds(
            plan.rotation.weakestFieldId,
            total.rotation.weakestFieldId,
          ) < 0
        )
      )
    ) {
      total.rotation.lowestPlannedFertility =
        plan.rotation.lowestPlannedFertility;
      total.rotation.weakestFieldId = plan.rotation.weakestFieldId;
    }
    if (
      plan.rotation.lowestYearThreeFertility !== null
      && (
        total.rotation.lowestYearThreeFertility === null
        || plan.rotation.lowestYearThreeFertility
          < total.rotation.lowestYearThreeFertility - 1e-9
        || (
          Math.abs(
            plan.rotation.lowestYearThreeFertility
              - total.rotation.lowestYearThreeFertility,
          ) <= 1e-9
          && plan.rotation.weakestYearThreeFieldId !== null
          && total.rotation.weakestYearThreeFieldId !== null
          && compareStableEntityIds(
            plan.rotation.weakestYearThreeFieldId,
            total.rotation.weakestYearThreeFieldId,
          ) < 0
        )
      )
    ) {
      total.rotation.lowestYearThreeFertility =
        plan.rotation.lowestYearThreeFertility;
      total.rotation.weakestYearThreeFieldId =
        plan.rotation.weakestYearThreeFieldId;
    }
    total.seedGrainCovered += Math.min(grain, plan.seedGrainRequired);
    const seedShortfall = Math.max(0, plan.seedGrainRequired - grain);
    total.seedGrainShortfall += seedShortfall;
    total.seedBarleyCovered += Math.min(barley, plan.seedBarleyRequired);
    const barleySeedShortfall = Math.max(
      0,
      plan.seedBarleyRequired - barley,
    );
    total.seedBarleyShortfall += barleySeedShortfall;
    if (seedShortfall > 0.05 || barleySeedShortfall > 0.05) {
      total.seedShortHoldings += 1;
      const grainCoverage = plan.seedGrainRequired > 1e-9
        ? Math.min(1, grain / plan.seedGrainRequired)
        : 1;
      const barleyCoverage = plan.seedBarleyRequired > 1e-9
        ? Math.min(1, barley / plan.seedBarleyRequired)
        : 1;
      const seedCoverage = Math.min(grainCoverage, barleyCoverage);
      if (
        farmstead !== undefined
        && (
          total.firstSeedShortBuildingId === null
          || seedCoverage < firstSeedCoverage - 1e-9
          || (
            Math.abs(seedCoverage - firstSeedCoverage) <= 1e-9
            && compareStableEntityIds(
              farmsteadId,
              total.firstSeedShortBuildingId,
            ) < 0
          )
        )
      ) {
        total.firstSeedShortBuildingId = farmsteadId;
        firstSeedCoverage = seedCoverage;
      }
    }

    const harvestCoverage = plan.harvest.requiredWorkerDays <= 1e-6
      ? 1
      : Math.min(
        1,
        plan.harvest.availableWorkerDays / plan.harvest.requiredWorkerDays,
      );
    total.laborCoveredHarvest += plan.expectedHarvest * harvestCoverage;
    total.laborCoveredBarleyHarvest +=
      plan.expectedBarleyHarvest * harvestCoverage;
    total.laborCoveredFibreHarvest += plan.expectedFibreHarvest * harvestCoverage;
    addSettlementSeason(total.harvest, plan.harvest);
    addSettlementSeason(total.spring, plan.spring);
    addSettlementSeason(total.autumn, plan.autumn);
  }

  normalizeCropRotationFertility(
    total.rotation,
    currentFertilityArea,
    afterCurrentFertilityArea,
    afterPlannedFertilityArea,
    afterYearThreeFertilityArea,
  );

  return total;
}
