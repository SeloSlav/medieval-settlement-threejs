import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BREWERY_FIREWOOD_PER_CYCLE,
  FARM_CROP_DEFINITIONS,
  FARM_CROP_KINDS,
  FARM_LARGE_FIELD_EFFICIENCY_FLOOR,
  FARM_MIN_FIELD_AREA,
  FARM_MIN_FIELD_EDGE,
  FARM_OPTIMAL_FIELD_AREA,
  FARMSTEAD_STARTER_SEED_GRAIN,
  GRANARY_FIREWOOD_PER_CYCLE,
  GRANARY_WATER_PER_CYCLE,
  MILL_WATER_PER_HARVEST,
  WATERMILL_WATER_PER_CYCLE,
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_SECONDS_PER_DAY,
  CATTLE_FERTILITY_BONUS,
  CATTLE_PLOUGH_WORK_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  computeCattleFieldSupport,
  selectCattleSupportedFields,
} from '../src/farming/cattleFieldSupport.ts';
import {
  expectedFieldYield,
  fieldArea,
  fieldEdgeLengths,
  fieldShapeEfficiency,
  fieldSizeEfficiency,
  moistureSuitability,
  rectangleFromBaseline,
  sampleAverageSlopeDegrees,
} from '../src/farming/farmFieldMath.ts';
import {
  buildFarmsteadWorkPlan,
  cropCalendarLabel,
  currentFieldWorkRemaining,
  farmsteadExportableGrain,
  farmsteadSeedGrainRequired,
  fieldSeedGrainRemaining,
  fieldStageAllowed,
  projectedCropFertility,
  projectedFieldFertility,
  seedGrainRequired,
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

const ryeDry = moistureSuitability('rye', 0.38);
const oatsDry = moistureSuitability('oats', 0.38);
const oatsWet = moistureSuitability('oats', 0.58);
assert.ok(ryeDry > oatsDry, 'rye should be the better crop on drier ground');
assert.ok(oatsWet > moistureSuitability('rye', 0.58), 'oats should be the better crop on wetter ground');

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
assert.ok(BREWERY_FIREWOOD_PER_CYCLE > 0, 'brewing should consume firing fuel');
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
assert.equal(FARM_CROP_DEFINITIONS.barley.produce, 'grain');
assert.equal(FARM_CROP_DEFINITIONS.wheat.workSeason, 'autumn');
assert.ok(
  FARMSTEAD_STARTER_SEED_GRAIN >= seedGrainRequired(FARM_OPTIMAL_FIELD_AREA, 'oats'),
  'a new holding should be able to sow one efficient oats field',
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
  stage: 'harvesting',
  stageProgress: 0.25,
  priority: 1,
  harvestCount: 0,
  lastYield: 0,
  currentYield: 6,
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
  projectedFieldFertility(planningField, CATTLE_FERTILITY_BONUS),
  projectedFieldFertility(planningField) + CATTLE_FERTILITY_BONUS,
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
assert.match(cropCalendarLabel('rye'), /Oct–Nov/);
assert.match(cropCalendarLabel('oats'), /Mar–Apr/);

const september = gameClockAtElapsedSeconds(
  6 * CALENDAR_DAYS_PER_MONTH * CALENDAR_SECONDS_PER_DAY,
);
const staffedPlan = buildFarmsteadWorkPlan([planningField], 1, september, false);
const sabbathPlan = buildFarmsteadWorkPlan([planningField], 1, september, true);
const unstaffedPlan = buildFarmsteadWorkPlan([planningField], 0, september, false);
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
assert.ok(mixedCropPlan.rotation.plannedHarvest > 0, 'barley should count toward next-cycle grain');
assert.equal(mixedCropPlan.rotation.plannedFibreHarvest, 0);
assert.equal(mixedCropPlan.rotation.nextAreaByCrop.barley, planningField.area);
assert.equal(staffedPlan.rotation.activeArea, planningField.area);
assert.equal(staffedPlan.rotation.nextFallowArea, planningField.area);
assert.equal(staffedPlan.rotation.restoringFields, 1);
assert.equal(staffedPlan.rotation.decliningFields, 0);
assert.equal(staffedPlan.rotation.plannedHarvest, 0);
assert.equal(staffedPlan.rotation.plannedSeedGrainRequired, 0);
assert.equal(staffedPlan.rotation.weakestFieldId, planningField.id);
assert.ok(
  staffedPlan.rotation.afterPlannedAverageFertility
    > staffedPlan.rotation.afterCurrentAverageFertility,
);
assert.ok(staffedPlan.harvest.requiredWorkerDays > 0);
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
      fertilityBonus: CATTLE_FERTILITY_BONUS,
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

const farmsteadInspector = fs.readFileSync('src/resources/inspector/expandedBuildingRenderer.ts', 'utf8');
const livestockInspector = fs.readFileSync('src/resources/inspector/livestockBuildingRenderer.ts', 'utf8');
const farmFieldInspector = fs.readFileSync('src/resources/inspector/farmFieldRenderer.ts', 'utf8');
assert.match(farmsteadInspector, /data-land-parcel="field"/, 'farmsteads need a contextual field-layout action');
assert.match(livestockInspector, /data-land-parcel="pasture"/, 'livestock holdings need a contextual pasture action');
assert.match(farmFieldInspector, /Ox support/);
assert.match(farmFieldInspector, /priority.*limited ox team/i);
assert.match(farmsteadInspector, /Ox-supported fields/);
assert.match(farmFieldInspector, /Current-cycle soil/);
assert.match(farmFieldInspector, /Planned-cycle soil/);
assert.match(farmFieldInspector, /Next-crop potential/);
assert.match(farmFieldInspector, /future manure/);
assert.match(farmsteadInspector, /Next rotation/);
assert.match(farmsteadInspector, /Soil trajectory/);
assert.match(farmsteadInspector, /data-inspect-field=/);

const farmSimulation = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(farmSimulation, /field\.current_yield \+= deposited/, 'harvest accounting must track grain actually stored');
assert.match(
  farmSimulation,
  /finish_field_cycle_with_manure\(field, field\.current_yield, manure_bonus\)/,
  'the October deadline must close partial harvests instead of erasing their soil cost',
);
assert.match(farmSimulation, /seed_grain_required\(field\.area, field\.crop\)/);
assert.match(farmSimulation, /withdraw_building_commodity\(farmstead, CommodityKind::Grain, seed_used\)/);
assert.match(farmSimulation, /crop_growth_allowed\(field\.crop, clock\.month\)/);
assert.match(farmSimulation, /field_work_allowed\(field\.stage, field\.crop, clock\.month\)/);
assert.match(
  farmSimulation,
  /step_seed_grain_distribution[\s\S]*select_seed_grain_delivery_candidate[\s\S]*&\["threshing_barn"\]/,
  'free granaries and markets must push scarce seed to the least-covered reachable holding',
);
assert.match(
  farmSimulation,
  /let request = \(target\.required - target\.building\.grain\)[\s\S]*\.min\(source\.grain\.max\(0\.0\)\)/,
  'seed distribution may draw through a granary floor but only for the selected holding claim',
);
const constructionSimulation = fs.readFileSync('server/src/simulation/construction.rs', 'utf8');
assert.match(constructionSimulation, /site\.grain \+= FARMSTEAD_STARTER_SEED_GRAIN/);

console.log('farming and water-chain tests passed');
