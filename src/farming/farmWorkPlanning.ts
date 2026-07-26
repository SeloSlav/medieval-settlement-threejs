import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_MONTHS_PER_YEAR,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_SUNDAY_WEEKDAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  FARM_FALLOW_FERTILITY_RESTORE,
  FARM_HARVEST_WORK_PER_SQUARE_METER,
  FARM_OATS_FERTILITY_DRAIN,
  FARM_OATS_SEED_GRAIN_PER_SQUARE_METER,
  FARM_PLOUGH_WORK_PER_SQUARE_METER,
  FARM_RYE_FERTILITY_DRAIN,
  FARM_RYE_SEED_GRAIN_PER_SQUARE_METER,
  FARM_SOW_WORK_PER_SQUARE_METER,
  FARM_WORK_METERS_PER_WORKER_PER_SEC,
} from '../generated/gameBalance.ts';
import type { FarmCrop, FarmFieldState, GameState } from '../resources/types.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import {
  computeCattleFieldSupport,
  type CattleFieldSupport,
} from './cattleFieldSupport.ts';
import { expectedFieldYield, fieldShapeEfficiency } from './farmFieldMath.ts';

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
  harvest: SeasonalWorkPlan;
  spring: SeasonalWorkPlan;
  autumn: SeasonalWorkPlan;
  seedGrainRequired: number;
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
  seedGrainRequired: number;
  seedGrainCovered: number;
  seedGrainShortfall: number;
  seedShortHoldings: number;
  firstSeedShortBuildingId: string | null;
  rotation: CropRotationPlan;
  harvest: SettlementSeasonalWorkPlan;
  spring: SettlementSeasonalWorkPlan;
  autumn: SettlementSeasonalWorkPlan;
};

export type CropRotationPlan = {
  activeArea: number;
  nextRyeArea: number;
  nextOatsArea: number;
  nextFallowArea: number;
  currentAverageFertility: number;
  afterCurrentAverageFertility: number;
  afterPlannedAverageFertility: number;
  plannedHarvest: number;
  plannedSeedGrainRequired: number;
  restoringFields: number;
  decliningFields: number;
  weakestFieldId: string | null;
  lowestPlannedFertility: number | null;
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

function fullStageWork(field: FarmFieldState, workPerSquareMeter: number): number {
  return field.area * workPerSquareMeter / fieldShapeEfficiency(field.corners);
}

export function currentFieldWorkRemaining(
  field: FarmFieldState,
  ploughWorkMultiplier = 1,
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
  return fullStageWork(field, rate)
    * supportMultiplier
    * Math.max(0, 1 - field.stageProgress);
}

export function fieldWorkerDays(work: number): number {
  return Math.max(0, work) / Math.max(1e-6, WORK_PER_WORKER_DAY);
}

export function projectedCropFertility(
  fertility: number,
  crop: FarmCrop,
  cattleFertilityBonus = 0,
): number {
  const delta = crop === 'fallow'
    ? FARM_FALLOW_FERTILITY_RESTORE
    : crop === 'oats'
      ? -FARM_OATS_FERTILITY_DRAIN
      : -FARM_RYE_FERTILITY_DRAIN;
  return Math.max(0.2, Math.min(1, fertility + delta + cattleFertilityBonus));
}

export function projectedFieldFertility(
  field: FarmFieldState,
  cattleFertilityBonus = 0,
): number {
  return projectedCropFertility(
    field.fertility,
    field.crop,
    cattleFertilityBonus,
  );
}

export function cropSeedGrainPerSquareMeter(crop: FarmCrop): number {
  if (crop === 'rye') return FARM_RYE_SEED_GRAIN_PER_SQUARE_METER;
  if (crop === 'oats') return FARM_OATS_SEED_GRAIN_PER_SQUARE_METER;
  return 0;
}

export function seedGrainRequired(area: number, crop: FarmCrop): number {
  return Math.max(0, area) * cropSeedGrainPerSquareMeter(crop);
}

export function fieldSeedGrainRemaining(field: FarmFieldState): number {
  if (field.priority <= 0) return 0;
  const plannedCrop = field.stage === 'ploughing' || field.stage === 'sowing'
    ? field.crop
    : field.nextCrop;
  const unseededFraction = field.stage === 'sowing'
    ? 1 - Math.max(0, Math.min(1, field.stageProgress))
    : 1;
  return seedGrainRequired(field.area, plannedCrop) * unseededFraction;
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
  return Math.max(0, stock - farmsteadSeedGrainRequired(fields));
}

export function fieldStageAllowed(field: FarmFieldState, month: number): boolean {
  if (field.stage === 'harvesting') return month === 9;
  if (field.stage === 'growing') {
    return field.crop === 'oats'
      ? month >= 4 && month <= 8
      : month >= 3 && month <= 8;
  }
  return field.crop === 'oats'
    ? month === 3 || month === 4
    : month === 10 || month === 11;
}

export function cropCalendarLabel(crop: FarmCrop): string {
  if (crop === 'oats') {
    return 'Spring oats · till/sow Mar–Apr · grow Apr–Aug · harvest September';
  }
  if (crop === 'fallow') {
    return 'Worked fallow · plough Oct–Nov · recover Mar–Aug';
  }
  return 'Winter rye · till/sow Oct–Nov · grow Mar–Aug · harvest September';
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
): SeasonalWorkPlan {
  const requiredWorkerDays = fieldWorkerDays(requiredWork);
  const availableWorkerDays = Math.max(0, workers) * productiveSeconds / WORKDAY_SECONDS;
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
): number {
  const crop = plannedFieldWorkCrop(field);
  if (field.stage === 'sowing') return currentFieldWorkRemaining(field);
  if (field.stage === 'ploughing') {
    return currentFieldWorkRemaining(field, support?.ploughWorkMultiplier)
      + (crop === 'fallow' ? 0 : fullStageWork(field, FARM_SOW_WORK_PER_SQUARE_METER));
  }
  return fullStageWork(field, FARM_PLOUGH_WORK_PER_SQUARE_METER)
    * (support?.ploughWorkMultiplier ?? 1)
    + (crop === 'fallow' ? 0 : fullStageWork(field, FARM_SOW_WORK_PER_SQUARE_METER));
}

function farmWorkWindows(
  clock: GameClock,
  sabbathObserved: boolean,
): FarmWorkWindows {
  return {
    harvest: productiveSecondsInWindow(clock, 9, 9, sabbathObserved),
    spring: productiveSecondsInWindow(clock, 3, 4, sabbathObserved),
    autumn: productiveSecondsInWindow(clock, 10, 11, sabbathObserved),
  };
}

function buildFarmsteadWorkPlanWithWindows(
  fields: Iterable<FarmFieldState>,
  workers: number,
  windows: FarmWorkWindows,
  cattleSupport: ReadonlyMap<string, CattleFieldSupport>,
): FarmsteadWorkPlan {
  let activeFields = 0;
  let pausedFields = 0;
  let cattleSupportedFields = 0;
  let expectedHarvest = 0;
  let harvestWork = 0;
  let springWork = 0;
  let autumnWork = 0;
  let seedGrain = 0;
  const rotation = emptyCropRotationPlan();
  let currentFertilityArea = 0;
  let afterCurrentFertilityArea = 0;
  let afterPlannedFertilityArea = 0;

  for (const field of fields) {
    if (field.priority <= 0) {
      pausedFields += 1;
      continue;
    }
    activeFields += 1;
    const support = cattleSupport.get(field.id);
    if (support) cattleSupportedFields += 1;
    const area = Math.max(0, field.area);
    const currentFertility = Math.max(0.2, Math.min(1, field.fertility));
    const afterCurrentFertility = projectedFieldFertility(
      field,
      support?.fertilityBonus,
    );
    const afterPlannedFertility = projectedCropFertility(
      afterCurrentFertility,
      field.nextCrop,
    );
    rotation.activeArea += area;
    currentFertilityArea += currentFertility * area;
    afterCurrentFertilityArea += afterCurrentFertility * area;
    afterPlannedFertilityArea += afterPlannedFertility * area;
    if (field.nextCrop === 'rye') rotation.nextRyeArea += area;
    else if (field.nextCrop === 'oats') rotation.nextOatsArea += area;
    else rotation.nextFallowArea += area;
    rotation.plannedHarvest += expectedFieldYield({
      ...field,
      crop: field.nextCrop,
      fertility: afterCurrentFertility,
    });
    rotation.plannedSeedGrainRequired += seedGrainRequired(area, field.nextCrop);
    if (afterPlannedFertility > afterCurrentFertility + 1e-9) {
      rotation.restoringFields += 1;
    } else if (afterPlannedFertility < afterCurrentFertility - 1e-9) {
      rotation.decliningFields += 1;
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
    seedGrain += fieldSeedGrainRemaining(field);
    if (field.crop !== 'fallow') {
      const fieldYield = expectedFieldYield(field);
      expectedHarvest += field.stage === 'harvesting'
        ? Math.max(0, fieldYield - field.currentYield)
        : fieldYield;
      harvestWork += field.stage === 'harvesting'
        ? currentFieldWorkRemaining(field)
        : fullStageWork(field, FARM_HARVEST_WORK_PER_SQUARE_METER);
    }

    const scheduledWork = remainingTillageAndSowingWork(field, support);
    if (plannedFieldWorkCrop(field) === 'oats') {
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
  );

  return {
    activeFields,
    pausedFields,
    cattleSupportedFields,
    expectedHarvest,
    harvest: seasonalPlan(
      harvestWork,
      workers,
      windows.harvest,
    ),
    spring: seasonalPlan(
      springWork,
      workers,
      windows.spring,
    ),
    autumn: seasonalPlan(
      autumnWork,
      workers,
      windows.autumn,
    ),
    seedGrainRequired: seedGrain,
    rotation,
  };
}

export function buildFarmsteadWorkPlan(
  fields: Iterable<FarmFieldState>,
  workers: number,
  clock: GameClock,
  sabbathObserved: boolean,
  cattleSupport: ReadonlyMap<string, CattleFieldSupport> = new Map(),
): FarmsteadWorkPlan {
  return buildFarmsteadWorkPlanWithWindows(
    fields,
    workers,
    farmWorkWindows(clock, sabbathObserved),
    cattleSupport,
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
  return {
    activeArea: 0,
    nextRyeArea: 0,
    nextOatsArea: 0,
    nextFallowArea: 0,
    currentAverageFertility: 0,
    afterCurrentAverageFertility: 0,
    afterPlannedAverageFertility: 0,
    plannedHarvest: 0,
    plannedSeedGrainRequired: 0,
    restoringFields: 0,
    decliningFields: 0,
    weakestFieldId: null,
    lowestPlannedFertility: null,
  };
}

function normalizeCropRotationFertility(
  rotation: CropRotationPlan,
  currentFertilityArea: number,
  afterCurrentFertilityArea: number,
  afterPlannedFertilityArea: number,
): void {
  if (rotation.activeArea <= 1e-9) return;
  rotation.currentAverageFertility =
    currentFertilityArea / rotation.activeArea;
  rotation.afterCurrentAverageFertility =
    afterCurrentFertilityArea / rotation.activeArea;
  rotation.afterPlannedAverageFertility =
    afterPlannedFertilityArea / rotation.activeArea;
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

  const total: SettlementFarmPlan = {
    holdingCount: fieldsByHolding.size,
    staffedHoldings: 0,
    orphanedFields: 0,
    activeFields: 0,
    pausedFields: 0,
    cattleSupportedFields: 0,
    expectedHarvest: 0,
    laborCoveredHarvest: 0,
    seedGrainRequired: 0,
    seedGrainCovered: 0,
    seedGrainShortfall: 0,
    seedShortHoldings: 0,
    firstSeedShortBuildingId: null,
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

  for (const [farmsteadId, fields] of fieldsByHolding) {
    const farmstead = state.buildings.get(farmsteadId);
    const operational = farmstead?.kind === 'threshing_barn'
      && farmstead.constructionComplete !== false;
    const workers = operational ? Math.max(0, farmstead.assignedLabor) : 0;
    const grain = operational ? Math.max(0, farmstead.grain) : 0;
    if (workers > 0) total.staffedHoldings += 1;
    if (!operational) total.orphanedFields += fields.length;

    const plan = buildFarmsteadWorkPlanWithWindows(fields, workers, windows, cattleSupport);
    total.activeFields += plan.activeFields;
    total.pausedFields += plan.pausedFields;
    total.cattleSupportedFields += plan.cattleSupportedFields;
    total.expectedHarvest += plan.expectedHarvest;
    total.seedGrainRequired += plan.seedGrainRequired;
    total.rotation.activeArea += plan.rotation.activeArea;
    total.rotation.nextRyeArea += plan.rotation.nextRyeArea;
    total.rotation.nextOatsArea += plan.rotation.nextOatsArea;
    total.rotation.nextFallowArea += plan.rotation.nextFallowArea;
    currentFertilityArea += plan.rotation.currentAverageFertility
      * plan.rotation.activeArea;
    afterCurrentFertilityArea += plan.rotation.afterCurrentAverageFertility
      * plan.rotation.activeArea;
    afterPlannedFertilityArea += plan.rotation.afterPlannedAverageFertility
      * plan.rotation.activeArea;
    total.rotation.plannedHarvest += plan.rotation.plannedHarvest;
    total.rotation.plannedSeedGrainRequired +=
      plan.rotation.plannedSeedGrainRequired;
    total.rotation.restoringFields += plan.rotation.restoringFields;
    total.rotation.decliningFields += plan.rotation.decliningFields;
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
    total.seedGrainCovered += Math.min(grain, plan.seedGrainRequired);
    const seedShortfall = Math.max(0, plan.seedGrainRequired - grain);
    total.seedGrainShortfall += seedShortfall;
    if (seedShortfall > 0.05) {
      total.seedShortHoldings += 1;
      const seedCoverage = plan.seedGrainRequired > 1e-9
        ? Math.min(1, grain / plan.seedGrainRequired)
        : 1;
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
    addSettlementSeason(total.harvest, plan.harvest);
    addSettlementSeason(total.spring, plan.spring);
    addSettlementSeason(total.autumn, plan.autumn);
  }

  normalizeCropRotationFertility(
    total.rotation,
    currentFertilityArea,
    afterCurrentFertilityArea,
    afterPlannedFertilityArea,
  );

  return total;
}
