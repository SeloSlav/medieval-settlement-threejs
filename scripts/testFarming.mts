import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BREWERY_BREWING_FIREWOOD_PER_CYCLE,
  BREWERY_MALTING_FIREWOOD_PER_CYCLE,
  FARM_CROP_DEFINITIONS,
  FARM_CROP_KINDS,
  FARM_EARLY_HARVEST_MINIMUM_GROWTH,
  FARM_EARLY_HARVEST_MONTH,
  FARM_EARLY_HARVEST_RIPENESS_FACTOR,
  FARM_LARGE_FIELD_EFFICIENCY_FLOOR,
  FARM_MIN_FIELD_AREA,
  FARM_MIN_FIELD_EDGE,
  FARM_OPTIMAL_FIELD_AREA,
  FARMSTEAD_STARTER_SEED_GRAIN,
  FARMSTEAD_STARTER_BARLEY_SEED,
  GRANARY_FIREWOOD_PER_CYCLE,
  GRANARY_WATER_PER_CYCLE,
  MILL_WATER_PER_HARVEST,
  WATERMILL_WATER_PER_CYCLE,
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_SECONDS_PER_DAY,
  FARM_MANURE_FERTILITY_BONUS,
  FARM_MANURE_PER_SQUARE_METER,
  CATTLE_PLOUGH_WORK_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  computeCattleFieldSupport,
  selectCattleSupportedFields,
} from '../src/farming/cattleFieldSupport.ts';
import {
  fieldManureFertilityBonus,
  fieldManureRequirement,
} from '../src/farming/manurePlanning.ts';
import {
  expectedFieldYield,
  fieldArea,
  fieldCentroid,
  fieldEdgeLengths,
  fieldShapeEfficiency,
  fieldSizeEfficiency,
  cropSiteSuitability,
  initialFieldFertility,
  isValidFarmFieldCorners,
  moistureSuitability,
  rectangleFromBaseline,
  sampleParcelPoints,
  sampleAverageSlopeDegrees,
} from '../src/farming/farmFieldMath.ts';
import {
  CROP_SUITABILITY_OVERLAY_RESOLUTION,
  cropSuitabilityColor,
  rasterizeCropSuitability,
} from '../src/farming/CropSuitabilityOverlay.ts';
import {
  activeFieldHarvestYield,
  buildFarmsteadWorkPlan,
  cropCalendarLabel,
  currentFieldWorkRemaining,
  earlyHarvestAvailability,
  earlyHarvestYieldMultiplier,
  farmsteadExportableGrain,
  farmsteadSeedGrainRequired,
  fieldSeedGrainRemaining,
  fieldStageAllowed,
  projectedCropFertility,
  projectedFieldFertility,
  seedGrainRequired,
  yearThreeCrop,
} from '../src/farming/farmWorkPlanning.ts';
import { gameClockAtElapsedSeconds } from '../src/world/gameCalendar.ts';
import type {
  BuildingState,
  FarmFieldState,
  LivestockHerdState,
} from '../src/resources/types.ts';
import { sampleAuthoritativeHydrologyScore } from '../src/hydrology/sampleAuthoritativeHydrology.ts';
import {
  AGRICULTURE_BUILD_MENU_ENTRIES,
  renderBuildMenuCards,
} from '../src/ui/buildMenuCards.ts';

const rectangle = rectangleFromBaseline(
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 5, z: 20 },
);
assert.ok(rectangle, 'three points should produce a rectangle');
assert.equal(fieldArea(rectangle), 400);
assert.deepEqual(fieldEdgeLengths(rectangle).map(Math.round), [20, 20, 20, 20]);
assert.equal(fieldShapeEfficiency(rectangle), 1);
assert.equal(sampleAverageSlopeDegrees(rectangle, () => 10), 0);
assert.ok(sampleAuthoritativeHydrologyScore(0, 0) >= 0 && sampleAuthoritativeHydrologyScore(0, 0) <= 1);
assert.equal(sampleAuthoritativeHydrologyScore(10_000, 10_000), 0);

const organicParcel = [
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 18, z: 14 },
  { x: 2, z: 12 },
] as const;
assert.ok(isValidFarmFieldCorners([...organicParcel]));
assert.equal(fieldArea([...organicParcel]), 234);
assert.ok(Math.abs(fieldCentroid(organicParcel).x - 10.2564102564) < 1e-9);
assert.ok(Math.abs(fieldCentroid(organicParcel).z - 6.2735042735) < 1e-9);
assert.ok(fieldShapeEfficiency([...organicParcel]) < 1);
assert.ok(fieldShapeEfficiency([...organicParcel]) > FARM_LARGE_FIELD_EFFICIENCY_FLOOR);
assert.equal(sampleParcelPoints([...organicParcel]).length, 25);
assert.ok(!isValidFarmFieldCorners([
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  { x: 5, z: 5 },
  { x: 0, z: 15 },
]));
assert.ok(!isValidFarmFieldCorners([
  { x: 0, z: 0 },
  { x: 20, z: 20 },
  { x: 0, z: 20 },
  { x: 20, z: 0 },
]));
const parcelMathStarted = performance.now();
for (let index = 0; index < 10_000; index += 1) {
  fieldArea([...organicParcel]);
  fieldCentroid(organicParcel);
  fieldShapeEfficiency([...organicParcel]);
  sampleParcelPoints([...organicParcel]);
}
assert.ok(
  performance.now() - parcelMathStarted < 250,
  '10,000 organic parcel previews should stay below interactive latency',
);

const ryeDry = moistureSuitability('rye', 0.38);
const oatsDry = moistureSuitability('oats', 0.38);
const oatsWet = moistureSuitability('oats', 0.58);
assert.ok(ryeDry > oatsDry, 'rye should be the better crop on drier ground');
assert.ok(oatsWet > moistureSuitability('rye', 0.58), 'oats should be the better crop on wetter ground');
assert.equal(initialFieldFertility(0.5, 0), 0.77);
assert.ok(Math.abs(initialFieldFertility(10, 0) - 0.92) < 1e-9);
assert.equal(initialFieldFertility(0, 100), 0.35);
assert.ok(
  cropSiteSuitability('rye', FARM_CROP_DEFINITIONS.rye.moistureIdeal, 1)
    > cropSiteSuitability('rye', 0.95, 14),
  'the placement map should reward crop-matched gentle ground',
);
assert.ok(
  cropSiteSuitability('oats', 0.58, 2)
    > cropSiteSuitability('rye', 0.58, 2),
  'crop cycling must materially change the spatial recommendation',
);
const poorSuitabilityColor = cropSuitabilityColor(0.1);
const primeSuitabilityColor = cropSuitabilityColor(0.95);
assert.ok(poorSuitabilityColor.r > poorSuitabilityColor.g);
assert.ok(primeSuitabilityColor.g > primeSuitabilityColor.r);
const suitabilityRasterStarted = performance.now();
const suitabilityRaster = rasterizeCropSuitability({
  crop: 'rye',
  resolution: CROP_SUITABILITY_OVERLAY_RESOLUTION,
  bounds: { minX: -410, maxX: 410, minZ: -410, maxZ: 410 },
  sampleMoisture: (x, z) => 0.38 + Math.sin(x * 0.01) * Math.cos(z * 0.01) * 0.1,
  sampleSlopeDegrees: (x, z) => Math.abs(x + z) * 0.005,
});
assert.equal(
  suitabilityRaster.length,
  CROP_SUITABILITY_OVERLAY_RESOLUTION ** 2 * 4,
);
assert.ok(
  performance.now() - suitabilityRasterStarted < 150,
  'the complete placement raster should generate below interactive latency',
);

const goodYield = expectedFieldYield({
  area: 400,
  crop: 'rye',
  moisture: 0.38,
  fertility: 0.9,
  averageSlopeDegrees: 2,
  corners: rectangle,
});
const poorYield = expectedFieldYield({
  area: 400,
  crop: 'rye',
  moisture: 0.95,
  fertility: 0.4,
  averageSlopeDegrees: 15,
  corners: rectangle,
});
assert.ok(goodYield > poorYield * 3, 'hydrology, fertility, and slope should materially affect harvests');
assert.equal(expectedFieldYield({ area: 400, crop: 'fallow', moisture: 0.5, fertility: 0.5, averageSlopeDegrees: 0, corners: rectangle }), 0);

assert.ok(FARM_MIN_FIELD_AREA >= FARM_MIN_FIELD_EDGE ** 2);
assert.ok(FARM_OPTIMAL_FIELD_AREA >= 20 * FARM_MIN_FIELD_AREA);
assert.equal(fieldSizeEfficiency(FARM_OPTIMAL_FIELD_AREA), 1);
assert.ok(fieldSizeEfficiency(FARM_OPTIMAL_FIELD_AREA * 2) < 1);
assert.ok(fieldSizeEfficiency(FARM_OPTIMAL_FIELD_AREA * 2) > FARM_LARGE_FIELD_EFFICIENCY_FLOOR);
assert.equal(fieldSizeEfficiency(FARM_OPTIMAL_FIELD_AREA * 1e12), FARM_LARGE_FIELD_EFFICIENCY_FLOOR);

const optimalSide = Math.sqrt(FARM_OPTIMAL_FIELD_AREA);
const optimalRectangle = rectangleFromBaseline(
  { x: 0, z: 0 },
  { x: optimalSide, z: 0 },
  { x: 0, z: optimalSide },
);
const largeSide = Math.sqrt(FARM_OPTIMAL_FIELD_AREA * 2);
const largeRectangle = rectangleFromBaseline(
  { x: 0, z: 0 },
  { x: largeSide, z: 0 },
  { x: 0, z: largeSide },
);
assert.ok(optimalRectangle && largeRectangle);
const optimalYield = expectedFieldYield({
  area: FARM_OPTIMAL_FIELD_AREA,
  crop: 'rye',
  moisture: 0.38,
  fertility: 1,
  averageSlopeDegrees: 0,
  corners: optimalRectangle,
});
const largeYield = expectedFieldYield({
  area: FARM_OPTIMAL_FIELD_AREA * 2,
  crop: 'rye',
  moisture: 0.38,
  fertility: 1,
  averageSlopeDegrees: 0,
  corners: largeRectangle,
});
assert.ok(largeYield > optimalYield, 'oversized fields should remain useful and produce more total grain');
assert.ok(largeYield / (FARM_OPTIMAL_FIELD_AREA * 2) < optimalYield / FARM_OPTIMAL_FIELD_AREA, 'oversized fields should yield less grain per square metre');
assert.equal(MILL_WATER_PER_HARVEST, 0, 'lumber should not consume well water');
assert.equal(WATERMILL_WATER_PER_CYCLE, 0, 'a river-powered mill should not consume well water');
assert.ok(GRANARY_WATER_PER_CYCLE > 0, 'bakery production should consume well water');
assert.ok(GRANARY_FIREWOOD_PER_CYCLE > 0, 'bakery production should consume fuel');
assert.ok(
  BREWERY_MALTING_FIREWOOD_PER_CYCLE
    + BREWERY_BREWING_FIREWOOD_PER_CYCLE > 0,
  'malting and brewing should consume firing fuel',
);
assert.deepEqual(FARM_CROP_KINDS, ['rye', 'oats', 'fallow', 'barley', 'flax', 'wheat']);
assert.deepEqual(
  FARM_CROP_KINDS.map((crop) => FARM_CROP_DEFINITIONS[crop].id),
  [0, 1, 2, 3, 4, 5],
  'legacy rye/oats/fallow ids must remain stable while new crops append',
);
assert.ok(FARM_CROP_DEFINITIONS.rye.seedGrainPerSquareMeter > 0);
assert.ok(
  FARM_CROP_DEFINITIONS.oats.seedGrainPerSquareMeter
    > FARM_CROP_DEFINITIONS.rye.seedGrainPerSquareMeter,
);
assert.equal(FARM_CROP_DEFINITIONS.flax.produce, 'fibre');
assert.equal(FARM_CROP_DEFINITIONS.barley.produce, 'barley');
assert.equal(FARM_CROP_DEFINITIONS.wheat.workSeason, 'autumn');
assert.ok(
  FARMSTEAD_STARTER_SEED_GRAIN >= seedGrainRequired(FARM_OPTIMAL_FIELD_AREA, 'oats'),
  'a new holding should be able to sow one efficient oats field',
);
assert.ok(
  FARMSTEAD_STARTER_BARLEY_SEED
    >= seedGrainRequired(FARM_OPTIMAL_FIELD_AREA, 'barley'),
  'a new holding should be able to sow one efficient barley field',
);

const planningField: FarmFieldState = {
  id: 'field-1',
  farmsteadId: 'farm-1',
  corners: rectangle,
  area: 400,
  averageSlopeDegrees: 2,
  moisture: 0.38,
  fertility: 0.9,
  crop: 'rye',
  nextCrop: 'fallow',
  followingCrop: null,
  stage: 'harvesting',
  stageProgress: 0.25,
  priority: 1,
  harvestCount: 0,
  lastYield: 0,
  currentYield: 6,
  manureApplied: 0,
};
assert.ok(currentFieldWorkRemaining(planningField) > 0);
assert.ok(projectedFieldFertility(planningField) < planningField.fertility);
assert.ok(projectedFieldFertility({ ...planningField, crop: 'fallow' }) > planningField.fertility);
assert.equal(
  projectedCropFertility(planningField.fertility, planningField.crop),
  projectedFieldFertility(planningField),
);
assert.ok(
  projectedCropFertility(projectedFieldFertility(planningField), 'fallow')
    > projectedFieldFertility(planningField),
  'a scheduled worked fallow should visibly restore soil after the current cereal',
);
assert.equal(
  projectedFieldFertility({
    ...planningField,
    manureApplied: fieldManureRequirement(planningField),
  }),
  projectedFieldFertility(planningField) + FARM_MANURE_FERTILITY_BONUS,
);
assert.equal(fieldManureRequirement(planningField), planningField.area * FARM_MANURE_PER_SQUARE_METER);
assert.equal(
  fieldManureFertilityBonus({
    ...planningField,
    manureApplied: fieldManureRequirement(planningField) / 2,
  }),
  FARM_MANURE_FERTILITY_BONUS / 2,
  'partial physical coverage should grant only a proportional soil benefit',
);
assert.equal(
  yearThreeCrop(planningField),
  planningField.nextCrop,
  'legacy two-slot fields must repeat Year 2 until the player opts into a cycle',
);
assert.equal(
  yearThreeCrop({ ...planningField, followingCrop: 'oats' }),
  'oats',
  'an explicit third slot must drive the Year 3 forecast',
);
assert.equal(fieldSeedGrainRemaining(planningField), 0, 'planned fallow needs no seed');
assert.equal(
  fieldSeedGrainRemaining({ ...planningField, nextCrop: 'oats' }),
  seedGrainRequired(planningField.area, 'oats'),
);
assert.equal(
  fieldSeedGrainRemaining({
    ...planningField,
    crop: 'rye',
    nextCrop: 'oats',
    stage: 'sowing',
    stageProgress: 0.25,
  }),
  seedGrainRequired(planningField.area, 'rye') * 0.75,
);
assert.equal(fieldSeedGrainRemaining({ ...planningField, priority: 0, nextCrop: 'oats' }), 0);
assert.equal(
  farmsteadSeedGrainRequired([
    { ...planningField, nextCrop: 'rye' },
    { ...planningField, id: 'field-2', nextCrop: 'oats' },
  ]),
  seedGrainRequired(planningField.area, 'rye') + seedGrainRequired(planningField.area, 'oats'),
);
assert.equal(
  farmsteadExportableGrain(30, [{ ...planningField, nextCrop: 'rye' }]),
  30 - seedGrainRequired(planningField.area, 'rye'),
);
assert.equal(
  farmsteadExportableGrain(4, [{ ...planningField, nextCrop: 'rye' }]),
  0,
);
assert.equal(fieldStageAllowed({ ...planningField, crop: 'rye', stage: 'sowing' }, 10), true);
assert.equal(fieldStageAllowed({ ...planningField, crop: 'rye', stage: 'sowing' }, 3), false);
assert.equal(fieldStageAllowed({ ...planningField, crop: 'oats', stage: 'sowing' }, 3), true);
assert.equal(fieldStageAllowed({ ...planningField, crop: 'oats', stage: 'sowing' }, 10), false);
assert.equal(fieldStageAllowed({ ...planningField, stage: 'harvesting' }, 8), true);
assert.equal(fieldStageAllowed({ ...planningField, stage: 'harvesting' }, 9), true);
assert.equal(fieldStageAllowed({ ...planningField, stage: 'harvesting' }, 10), false);
assert.match(cropCalendarLabel('rye'), /Oct–Nov/);
assert.match(cropCalendarLabel('oats'), /Mar–Apr/);

const earlyHarvestField = {
  ...planningField,
  stage: 'growing' as const,
  stageProgress: FARM_EARLY_HARVEST_MINIMUM_GROWTH,
  currentYield: 0,
};
assert.equal(
  earlyHarvestAvailability(earlyHarvestField, FARM_EARLY_HARVEST_MONTH).available,
  true,
);
assert.equal(earlyHarvestAvailability(earlyHarvestField, 7).available, false);
assert.equal(
  earlyHarvestAvailability(
    { ...earlyHarvestField, stageProgress: FARM_EARLY_HARVEST_MINIMUM_GROWTH - 0.01 },
    FARM_EARLY_HARVEST_MONTH,
  ).available,
  false,
);
assert.equal(
  earlyHarvestAvailability(
    { ...earlyHarvestField, crop: 'fallow' },
    FARM_EARLY_HARVEST_MONTH,
  ).available,
  false,
);
assert.equal(
  earlyHarvestYieldMultiplier(1),
  FARM_EARLY_HARVEST_RIPENESS_FACTOR,
);
assert.equal(
  earlyHarvestYieldMultiplier(FARM_EARLY_HARVEST_MINIMUM_GROWTH),
  FARM_EARLY_HARVEST_MINIMUM_GROWTH * FARM_EARLY_HARVEST_RIPENESS_FACTOR,
);
const lockedEarlyHarvestField = {
  ...planningField,
  currentYield: 0,
  harvestYieldMultiplier: earlyHarvestYieldMultiplier(
    FARM_EARLY_HARVEST_MINIMUM_GROWTH,
  ),
};
assert.equal(
  activeFieldHarvestYield(lockedEarlyHarvestField),
  expectedFieldYield(lockedEarlyHarvestField) * lockedEarlyHarvestField.harvestYieldMultiplier,
);

const september = gameClockAtElapsedSeconds(
  6 * CALENDAR_DAYS_PER_MONTH * CALENDAR_SECONDS_PER_DAY,
);
const staffedPlan = buildFarmsteadWorkPlan([planningField], 1, september, false);
const sabbathPlan = buildFarmsteadWorkPlan([planningField], 1, september, true);
const unstaffedPlan = buildFarmsteadWorkPlan([planningField], 0, september, false);
const earlyHarvestPlan = buildFarmsteadWorkPlan(
  [lockedEarlyHarvestField],
  1,
  september,
  false,
);
const mixedCropPlan = buildFarmsteadWorkPlan([
  planningField,
  {
    ...planningField,
    id: 'field-flax',
    crop: 'flax',
    nextCrop: 'barley',
    currentYield: 0,
  },
], 2, september, false);
assert.ok(mixedCropPlan.expectedHarvest > 0, 'grain crops should remain in the food harvest forecast');
assert.ok(mixedCropPlan.expectedFibreHarvest > 0, 'flax should receive its own textile harvest forecast');
assert.equal(mixedCropPlan.rotation.plannedHarvest, 0);
assert.ok(
  mixedCropPlan.rotation.plannedBarleyHarvest > 0,
  'barley should receive its own next-cycle harvest forecast',
);
assert.equal(mixedCropPlan.rotation.plannedSeedGrainRequired, 0);
assert.ok(mixedCropPlan.rotation.plannedSeedBarleyRequired > 0);
assert.equal(mixedCropPlan.rotation.plannedFibreHarvest, 0);
assert.equal(mixedCropPlan.rotation.nextAreaByCrop.barley, planningField.area);
assert.equal(staffedPlan.rotation.activeArea, planningField.area);
assert.equal(staffedPlan.rotation.nextFallowArea, planningField.area);
assert.equal(staffedPlan.rotation.restoringFields, 1);
assert.equal(staffedPlan.rotation.decliningFields, 0);
assert.equal(staffedPlan.rotation.plannedHarvest, 0);
assert.equal(staffedPlan.rotation.plannedSeedGrainRequired, 0);
assert.equal(staffedPlan.rotation.weakestFieldId, planningField.id);
assert.equal(staffedPlan.rotation.cyclicArea, 0);
assert.equal(staffedPlan.rotation.yearThreeAreaByCrop.fallow, planningField.area);
assert.equal(staffedPlan.rotation.yearThreeHarvest, 0);
assert.equal(staffedPlan.rotation.yearThreeSeedGrainRequired, 0);
assert.ok(
  staffedPlan.rotation.afterPlannedAverageFertility
    > staffedPlan.rotation.afterCurrentAverageFertility,
);
assert.equal(
  staffedPlan.rotation.afterYearThreeAverageFertility,
  projectedCropFertility(
    projectedCropFertility(projectedFieldFertility(planningField), 'fallow'),
    'fallow',
  ),
  'unscheduled legacy land should honestly forecast another worked fallow',
);
const cyclicPlan = buildFarmsteadWorkPlan(
  [{ ...planningField, followingCrop: 'oats' }],
  1,
  september,
  false,
);
assert.equal(cyclicPlan.rotation.cyclicArea, planningField.area);
assert.equal(cyclicPlan.rotation.yearThreeAreaByCrop.oats, planningField.area);
assert.ok(cyclicPlan.rotation.yearThreeHarvest > 0);
assert.equal(cyclicPlan.rotation.yearThreeFibreHarvest, 0);
assert.equal(
  cyclicPlan.rotation.yearThreeSeedGrainRequired,
  seedGrainRequired(planningField.area, 'oats'),
);
assert.equal(
  cyclicPlan.rotation.afterYearThreeAverageFertility,
  projectedCropFertility(
    projectedCropFertility(projectedFieldFertility(planningField), 'fallow'),
    'oats',
  ),
);
assert.ok(staffedPlan.harvest.requiredWorkerDays > 0);
assert.equal(
  earlyHarvestPlan.expectedHarvest,
  activeFieldHarvestYield(lockedEarlyHarvestField),
  'the holding forecast must preserve the authoritative early-cut sacrifice',
);
assert.ok(earlyHarvestPlan.expectedHarvest < staffedPlan.expectedHarvest);
assert.equal(staffedPlan.harvest.shortfallWorkerDays, 0);
assert.ok(sabbathPlan.harvest.availableWorkerDays < staffedPlan.harvest.availableWorkerDays);
assert.equal(
  unstaffedPlan.harvest.shortfallWorkerDays,
  unstaffedPlan.harvest.requiredWorkerDays,
);
assert.equal(
  buildFarmsteadWorkPlan([{ ...planningField, priority: 0 }], 6, september, false).expectedHarvest,
  0,
  'paused fields should not count as a viable harvest plan',
);
assert.equal(
  buildFarmsteadWorkPlan([{ ...planningField, priority: 0 }], 6, september, false)
    .rotation.activeArea,
  0,
  'paused land must not appear to restore soil without being worked',
);
const springOatsPlan = buildFarmsteadWorkPlan(
  [{ ...planningField, nextCrop: 'oats' }],
  2,
  september,
  false,
);
assert.ok(springOatsPlan.spring.requiredWorkerDays > 0);
assert.equal(springOatsPlan.autumn.requiredWorkerDays, 0);
assert.equal(
  springOatsPlan.seedGrainRequired,
  seedGrainRequired(planningField.area, 'oats'),
);
assert.equal(
  springOatsPlan.rotation.plannedHarvest,
  expectedFieldYield({
    ...planningField,
    crop: 'oats',
    fertility: projectedFieldFertility(planningField),
  }),
);
assert.equal(
  springOatsPlan.rotation.afterPlannedAverageFertility,
  projectedCropFertility(projectedFieldFertility(planningField), 'oats'),
);
const tiedRotationPlan = buildFarmsteadWorkPlan(
  [
    { ...planningField, id: '10', nextCrop: 'oats' },
    { ...planningField, id: '2', nextCrop: 'oats' },
  ],
  2,
  september,
  false,
);
assert.equal(
  tiedRotationPlan.rotation.weakestFieldId,
  '2',
  'equal soil projections should retain stable server-order field ids',
);
const autumnRyePlan = buildFarmsteadWorkPlan(
  [{ ...planningField, nextCrop: 'rye' }],
  2,
  september,
  false,
);
assert.ok(autumnRyePlan.autumn.requiredWorkerDays > 0);
assert.equal(autumnRyePlan.spring.requiredWorkerDays, 0);

const oxHolding = {
  id: 'building-7',
  kind: 'pastoral_farmstead',
  x: 10,
  z: 10,
  workRadius: 100,
} as BuildingState;
const healthyCattle = {
  buildingId: oxHolding.id,
  species: 'cattle',
  headCount: 4,
  health: 0.9,
  suppliedCapacity: 4,
} as LivestockHerdState;
const cattleCandidateFields = [
  { ...planningField, id: 'farm-field-10', stage: 'ploughing' as const, priority: 3 },
  { ...planningField, id: 'farm-field-2', stage: 'ploughing' as const, priority: 3 },
  { ...planningField, id: 'farm-field-3', stage: 'ploughing' as const, priority: 2 },
  {
    ...planningField,
    id: 'farm-field-1',
    stage: 'ploughing' as const,
    priority: 4,
    corners: planningField.corners.map((point) => ({
      x: point.x + 500,
      z: point.z + 500,
    })) as FarmFieldState['corners'],
  },
];
assert.deepEqual(
  selectCattleSupportedFields(oxHolding, healthyCattle, cattleCandidateFields)
    .map(({ field }) => field.id),
  ['farm-field-2', 'farm-field-10'],
  'ox teams should mirror server priority and numeric-id tie-breaking inside their work extent',
);
assert.equal(
  selectCattleSupportedFields(
    oxHolding,
    { ...healthyCattle, health: 0.64 },
    cattleCandidateFields,
  ).length,
  0,
  'an unhealthy herd should not provide field support',
);
const cattleSupport = computeCattleFieldSupport({
  buildings: new Map([[oxHolding.id, oxHolding]]),
  farmFields: new Map(cattleCandidateFields.map((field) => [field.id, field])),
  livestockHerds: new Map([[healthyCattle.buildingId, healthyCattle]]),
});
assert.deepEqual([...cattleSupport.keys()], ['farm-field-2', 'farm-field-10']);
const unsupportedPloughWork = currentFieldWorkRemaining(cattleCandidateFields[0]);
assert.equal(
  currentFieldWorkRemaining(
    cattleCandidateFields[0],
    cattleSupport.get(cattleCandidateFields[0].id)?.ploughWorkMultiplier,
  ),
  unsupportedPloughWork * CATTLE_PLOUGH_WORK_MULTIPLIER,
);
const unsupportedAutumnPlan = buildFarmsteadWorkPlan(
  [{ ...planningField, nextCrop: 'fallow' }],
  2,
  september,
  false,
);
const supportedAutumnPlan = buildFarmsteadWorkPlan(
  [{ ...planningField, nextCrop: 'fallow' }],
  2,
  september,
  false,
  new Map([[
    planningField.id,
    {
      buildingId: oxHolding.id,
      distance: 0,
      ploughWorkMultiplier: CATTLE_PLOUGH_WORK_MULTIPLIER,
    },
  ]]),
);
assert.equal(supportedAutumnPlan.cattleSupportedFields, 1);
assert.ok(
  supportedAutumnPlan.autumn.requiredWorkerDays
    < unsupportedAutumnPlan.autumn.requiredWorkerDays,
  'farmstead labor forecasts should include the ox ploughing reduction',
);
const planningStarted = performance.now();
const largeFarmPlan = buildFarmsteadWorkPlan(
  Array.from({ length: 10_000 }, (_, index) => ({
    ...planningField,
    id: `field-${index}`,
  })),
  6,
  september,
  false,
);
assert.equal(largeFarmPlan.activeFields, 10_000);
assert.equal(largeFarmPlan.seedGrainRequired, 0);
assert.ok(
  performance.now() - planningStarted < 250,
  'the inspector forecast should remain interactive for a pathological 10,000-field holding',
);
const reserveProjectionFields = Array.from({ length: 100_000 }, (_, index) => ({
  ...planningField,
  id: `reserve-field-${index}`,
  nextCrop: 'rye' as const,
}));
const reserveProjectionStarted = performance.now();
const reserveProjection = farmsteadSeedGrainRequired(reserveProjectionFields);
const reserveProjectionElapsed = performance.now() - reserveProjectionStarted;
assert.ok(
  Math.abs(
    reserveProjection
      - reserveProjectionFields.length * seedGrainRequired(planningField.area, 'rye'),
  ) < 1e-5,
);
assert.ok(
  reserveProjectionElapsed < 150,
  `100,000-field seed projection took ${reserveProjectionElapsed.toFixed(1)}ms`,
);
const cattleProjectionStarted = performance.now();
const cattleProjection = computeCattleFieldSupport({
  buildings: new Map([[
    oxHolding.id,
    { ...oxHolding, workRadius: 1_000_000 },
  ]]),
  farmFields: new Map(reserveProjectionFields.map((field, index) => [
    `farm-field-${index + 1}`,
    { ...field, id: `farm-field-${index + 1}` },
  ])),
  livestockHerds: new Map([[healthyCattle.buildingId, healthyCattle]]),
});
const cattleProjectionElapsed = performance.now() - cattleProjectionStarted;
assert.equal(cattleProjection.size, 2);
assert.ok(
  cattleProjectionElapsed < 250,
  `100,000-field cattle support projection took ${cattleProjectionElapsed.toFixed(1)}ms`,
);

const agricultureMenu = renderBuildMenuCards(AGRICULTURE_BUILD_MENU_ENTRIES);
assert.doesNotMatch(agricultureMenu, /data-action="grain-field"/, 'fields must be started from a selected farmstead');
assert.doesNotMatch(agricultureMenu, /data-action="pasture"/, 'pastures must be started from a selected livestock holding');

const farmFieldTool = fs.readFileSync('src/farming/FarmFieldTool.ts', 'utf8');
assert.match(farmFieldTool, /state\.buildings\.get\(this\.farmsteadId\)/, 'parcel placement must stay pinned to the selected holding');
assert.doesNotMatch(farmFieldTool, /let distance = Number\.POSITIVE_INFINITY/, 'parcel placement must not silently choose the nearest holding');
assert.match(farmFieldTool, /corners\.some\(\(point\)/, 'the whole parcel must stay inside the selected work extent');
assert.match(farmFieldTool, /cropSiteSuitability/);
assert.match(farmFieldTool, /first harvest/);
assert.match(farmFieldTool, /suitability map visible/);
assert.match(farmFieldTool, /this\.points\.length < 3/);
assert.match(farmFieldTool, /isValidFarmFieldCorners/);
assert.match(farmFieldTool, /sampleParcelPoints/);
assert.doesNotMatch(farmFieldTool, /rectangleFromBaseline/);

const cropSuitabilityOverlay = fs.readFileSync(
  'src/farming/CropSuitabilityOverlay.ts',
  'utf8',
);
const sceneManager = fs.readFileSync('src/scene/SceneManager.ts', 'utf8');
const appSource = fs.readFileSync('src/app/App.ts', 'utf8');
const buildToolbar = fs.readFileSync('src/ui/BuildToolbar.ts', 'utf8');
assert.match(cropSuitabilityOverlay, /createDrapedOverlayGeometry/);
assert.match(cropSuitabilityOverlay, /sampleAuthoritativeHydrologyScore/);
assert.match(cropSuitabilityOverlay, /private readonly textures = new Map/);
assert.match(sceneManager, /setCropSuitabilityOverlayCrop/);
assert.match(sceneManager, /this\.hydrologyOverlay\?\.setVisible\(false\)/);
assert.match(appSource, /setCropSuitabilityOverlayCrop\(farmCrop\)/);
assert.match(buildToolbar, /data-crop-suitability-legend/);
assert.match(buildToolbar, /first-crop site potential/);

const farmsteadInspector = fs.readFileSync('src/resources/inspector/expandedBuildingRenderer.ts', 'utf8');
const livestockInspector = fs.readFileSync('src/resources/inspector/livestockBuildingRenderer.ts', 'utf8');
const farmFieldInspector = fs.readFileSync('src/resources/inspector/farmFieldRenderer.ts', 'utf8');
const townHallInspector = fs.readFileSync('src/resources/inspector/townHallRenderer.ts', 'utf8');
assert.match(farmsteadInspector, /data-land-parcel="field"/, 'farmsteads need a contextual field-layout action');
assert.match(livestockInspector, /data-land-parcel="pasture"/, 'livestock holdings need a contextual pasture action');
assert.match(farmFieldInspector, /Ox support/);
assert.match(farmFieldInspector, /priority.*limited ox team/i);
assert.match(farmsteadInspector, /Ox-supported fields/);
assert.match(farmFieldInspector, /Current-cycle soil/);
assert.match(farmFieldInspector, /Three-year rotation/);
assert.match(farmFieldInspector, /Year 3 soil/);
assert.match(farmFieldInspector, /Next-crop potential/);
assert.match(farmFieldInspector, /Year 3 potential/);
assert.match(farmFieldInspector, /data-field-following-crop/);
assert.match(farmFieldInspector, /data-field-following-clear/);
assert.match(farmFieldInspector, /future manure/);
assert.match(farmsteadInspector, /Year 3 rotation/);
assert.match(farmsteadInspector, /Cyclic coverage/);
assert.match(farmsteadInspector, /Soil trajectory/);
assert.match(farmsteadInspector, /data-inspect-field=/);
assert.match(townHallInspector, /Year 3 rotation/);
assert.match(townHallInspector, /Cyclic coverage/);
assert.match(farmFieldInspector, /data-field-early-harvest/);
assert.match(farmFieldInspector, /Waiting until September keeps 100% yield/);

const farmSimulation = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(farmSimulation, /field\.current_yield \+= deposited/, 'harvest accounting must track grain actually stored');
assert.match(
  farmSimulation,
  /finish_field_cycle\(field, field\.current_yield\)/,
  'the October deadline must close partial harvests instead of erasing their soil cost',
);
assert.match(
  farmSimulation,
  /field\.stage == STAGE_PLOUGHING[\s\S]*withdraw_building_commodity\(farmstead, CommodityKind::Manure, manure_needed\)[\s\S]*field\.manure_applied \+= manure_spread/,
  'ploughing progress must physically withdraw and spread manure from the crop farmstead',
);
assert.match(
  farmSimulation,
  /field_manure_fertility_bonus\(field\.area, field\.manure_applied\)/,
  'cycle settlement must convert actual spread coverage into the soil bonus',
);
assert.match(farmSimulation, /seed_grain_required\(field\.area, field\.crop\)/);
assert.match(farmSimulation, /withdraw_building_commodity\(farmstead, seed_commodity, seed_used\)/);
assert.match(farmSimulation, /field\.crop == CROP_BARLEY[\s\S]*CommodityKind::Barley/);
assert.match(farmSimulation, /crop_growth_allowed\(field\.crop, clock\.month\)/);
assert.match(farmSimulation, /field_work_allowed\(field\.stage, field\.crop, clock\.month\)/);
assert.match(
  farmSimulation,
  /expected_grain_yield[\s\S]*field\.harvest_yield_multiplier\.clamp\(0\.0, 1\.0\)/,
  'authoritative harvest deposits must use the yield fraction locked by the order',
);
assert.match(
  farmSimulation,
  /field\.harvest_yield_multiplier = 1\.0/,
  'completed, failed, and naturally matured cycles must restore normal yield',
);
assert.match(
  farmSimulation,
  /step_seed_grain_distribution[\s\S]*select_seed_grain_delivery_candidate[\s\S]*&\["threshing_barn"\]/,
  'free granaries and markets must push scarce seed to the least-covered reachable holding',
);
assert.match(
  farmSimulation,
  /let request = \(target\.required - building_commodity_stock\(&target\.building, commodity\)\)[\s\S]*\.min\(source_stock\.max\(0\.0\)\)/,
  'seed distribution may draw through a granary floor but only for the selected holding claim',
);
const constructionSimulation = fs.readFileSync('server/src/simulation/construction.rs', 'utf8');
assert.match(constructionSimulation, /site\.grain \+= FARMSTEAD_STARTER_SEED_GRAIN/);
assert.match(constructionSimulation, /site\.barley \+= FARMSTEAD_STARTER_BARLEY_SEED/);
const farmFieldReducers = fs.readFileSync('server/src/reducers/farm_fields.rs', 'utf8');
assert.match(farmFieldReducers, /initial_field_fertility\(moisture, slope\)/);
assert.match(farmFieldReducers, /is_valid_convex_quadrilateral/);
assert.match(farmFieldReducers, /PARCEL_SAMPLE_DIVISIONS/);
assert.match(farmFieldReducers, /pub fn start_farm_field_early_harvest/);
assert.match(farmFieldReducers, /early_harvest_available\(/);
assert.match(farmFieldReducers, /field\.harvest_yield_multiplier = early_harvest_yield_multiplier/);
assert.match(farmFieldReducers, /pub fn set_farm_field_following_crop/);
assert.match(
  farmFieldReducers,
  /if crop != NO_FOLLOWING_CROP[\s\S]*validate_crop\(crop\)/,
);
const setNextCropReducer = farmFieldReducers.match(
  /pub fn set_farm_field_crop[\s\S]*?\n}\n/,
)?.[0] ?? '';
assert.match(setNextCropReducer, /field\.next_crop = crop/);
assert.doesNotMatch(
  setNextCropReducer,
  /field\.crop = crop/,
  'scheduling Year 2 must not overwrite the crop already being worked',
);
assert.match(
  farmSimulation,
  /advance_crop_rotation\(field\.crop, field\.next_crop, field\.following_crop\)/,
);

console.log('farming and water-chain tests passed');
