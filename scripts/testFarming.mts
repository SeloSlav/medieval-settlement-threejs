import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUILDING_DEFINITIONS,
  BREWERY_BREWING_FIREWOOD_PER_CYCLE,
  BREWERY_MALTING_FIREWOOD_PER_CYCLE,
  FARM_CROP_DEFINITIONS,
  FARM_CROP_KINDS,
  FARM_EARLY_HARVEST_MINIMUM_GROWTH,
  FARM_EARLY_HARVEST_RIPENESS_FACTOR,
  FARM_MIN_FIELD_AREA,
  FARM_MIN_FIELD_EDGE,
  FARM_REGIONAL_UNREPRESENTED_CEILING,
  FARM_SHARED_LABOR_MIN_PRIORITY,
  FARMSTEAD_STARTER_SEED_GRAIN,
  FARMSTEAD_STARTER_BARLEY_SEED,
  BAKERY_FIREWOOD_PER_CYCLE,
  BAKERY_WATER_PER_CYCLE,
  MILL_WATER_PER_HARVEST,
  WATERMILL_WATER_PER_CYCLE,
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_SECONDS_PER_DAY,
  FARM_MANURE_FERTILITY_BONUS,
  FARM_MANURE_PER_SQUARE_METER,
  CATTLE_PLOUGH_WORK_MULTIPLIER,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
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
  cropEnvironmentalSuitability,
  cropRegionalProfile,
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
  rasterizeVineyardSuitability,
} from '../src/farming/CropSuitabilityOverlay.ts';
import {
  sampleAverageSouthExposure,
  vineyardProductionMultiplier,
  vineyardSiteSuitability,
} from '../src/vineyards/vineyardSuitability.ts';
import {
  activeFieldHarvestYield,
  buildFarmsteadWorkPlan,
  cropCalendarLabel,
  currentFieldWorkRemaining,
  daysUntilCropHarvestWindow,
  earlyHarvestAvailability,
  earlyHarvestYieldMultiplier,
  farmsteadExportableGrain,
  farmsteadSeedGrainRequired,
  fieldAcceptsFarmsteadLabor,
  fullFieldCycleWork,
  fieldSeedGrainRemaining,
  fieldStageAllowed,
  projectedCropFertility,
  projectedFieldFertility,
  seedGrainRequired,
  yearThreeCrop,
} from '../src/farming/farmWorkPlanning.ts';
import {
  fieldTaskRank,
  normalizeThreshingPriority,
  THRESHING_PRIORITY_AUTO,
  THRESHING_PRIORITY_HIGH,
  THRESHING_PRIORITY_LOW,
  threshingTaskRank,
} from '../src/farming/threshingPriority.ts';
import { gameClockAtElapsedSeconds } from '../src/world/gameCalendar.ts';
import { resolveWorldDimensions } from '../src/world/worldGenerationSettings.ts';
import type {
  BuildingState,
  FarmFieldState,
  LivestockHerdState,
} from '../src/resources/types.ts';
import { sampleAuthoritativeGroundwaterScore } from '../src/hydrology/sampleAuthoritativeHydrology.ts';
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
assert.ok(sampleAuthoritativeGroundwaterScore(0, 0) >= 0 && sampleAuthoritativeGroundwaterScore(0, 0) <= 1);
assert.equal(sampleAuthoritativeGroundwaterScore(10_000, 10_000), 0);

const openingClock = gameClockAtElapsedSeconds(0);
assert.ok(
  Math.abs(daysUntilCropHarvestWindow(openingClock, 'rye') - (150 - 8 / 24)) < 1e-9,
  'the field forecast should count from the current time to rye’s August window',
);
const septemberClock = gameClockAtElapsedSeconds(180 * CALENDAR_SECONDS_PER_DAY);
assert.equal(daysUntilCropHarvestWindow(septemberClock, 'oats'), 0);
const octoberClock = gameClockAtElapsedSeconds(210 * CALENDAR_SECONDS_PER_DAY);
assert.ok(daysUntilCropHarvestWindow(octoberClock, 'barley') > 299);

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
assert.ok(fieldShapeEfficiency([...organicParcel]) > 0.6);
assert.equal(sampleParcelPoints([...organicParcel]).length, 25);
assert.ok(
  vineyardSiteSuitability(0.22, 8, 1, 20, -30)
    > vineyardSiteSuitability(0.95, 0, 0.5, 20, -30),
  'sunny drained slopes should beat wet flat grape sites',
);
assert.ok(
  vineyardProductionMultiplier({ area: 440, siteSuitability: 0.8, shapeEfficiency: 0.95 })
    > vineyardProductionMultiplier({ area: 110, siteSuitability: 0.8, shapeEfficiency: 0.95 }),
  'free-form vineyard area must change actual harvest capacity',
);
assert.ok(sampleAverageSouthExposure([...organicParcel], (_x, z) => -z) > 0.5);
assert.equal(rasterizeVineyardSuitability({
  resolution: 4,
  bounds: { minX: 0, minZ: 0, maxX: 20, maxZ: 20 },
  sampleMoisture: () => 0.35,
  sampleSlopeDegrees: () => 8,
  sampleSouthExposure: () => 1,
}).length, 4 * 4 * 4);
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
const dryOriginFertility = initialFieldFertility(0, 2, 0, 0);
const wetOriginFertility = initialFieldFertility(0.8, 2, 0, 0);
assert.ok(wetOriginFertility > dryOriginFertility);
assert.ok(
  initialFieldFertility(0.4, 2, 0, 0) > initialFieldFertility(0.4, 16, 0, 0),
);
assert.notEqual(
  initialFieldFertility(0.2, 2, 40, -80),
  initialFieldFertility(0.2, 2, -240, 180),
);
assert.equal(initialFieldFertility(0, 100, 0, 0), 0.35);
assert.ok(
  cropSiteSuitability('rye', 0.2, 1, 40, -80)
    > cropSiteSuitability('rye', 0.2, 14, 40, -80),
  'the placement map should reward crop-matched gentle ground',
);
assert.ok(
  cropSiteSuitability('oats', 0.7, 2, 0, 0)
    > cropSiteSuitability('oats', 0, 2, 0, 0),
  'river and aquifer ground should remain valuable to moisture-loving oats',
);
assert.ok(
  cropSiteSuitability('rye', 0, 2, 0, 0)
    > cropSiteSuitability('rye', 0.7, 2, 0, 0),
  'rye should create a strategic dry-upland alternative to river fields',
);
const strategicCrops = ['rye', 'oats', 'barley', 'flax', 'wheat'] as const;
const expectedPrimeCropCount = { small: 3, medium: 4, large: 5 } as const;
for (const mapSize of ['small', 'medium', 'large'] as const) {
  const context = { worldSeed: 0x071a_2e0d, mapSize };
  const profiles = strategicCrops.map((crop) => {
    const placement = cropRegionalProfile(crop, 0, 0, context);
    return cropRegionalProfile(crop, placement.centerX, placement.centerZ, context);
  });
  assert.equal(
    profiles.filter((profile) => profile.represented).length,
    expectedPrimeCropCount[mapSize],
    `${mapSize} maps should expose the intended number of prime crop provinces`,
  );
  for (const profile of profiles) {
    assert.ok(profile.provinceStrength > 0.999_999);
    if (profile.represented) {
      assert.ok(profile.affinity > 0.999_999);
      assert.ok(profile.yieldMultiplier > 0.999_999);
    } else {
      assert.ok(profile.affinity <= FARM_REGIONAL_UNREPRESENTED_CEILING + 1e-9);
      assert.ok(profile.yieldMultiplier < 0.71);
    }
  }
  const generationHalf = resolveWorldDimensions(mapSize).generationHalf;
  for (const crop of strategicCrops) {
    const represented = cropRegionalProfile(crop, 0, 0, context).represented;
    let primeSamples = 0;
    let totalSamples = 0;
    for (let zIndex = 0; zIndex <= 40; zIndex += 1) {
      for (let xIndex = 0; xIndex <= 40; xIndex += 1) {
        const x = -generationHalf + generationHalf * 2 * xIndex / 40;
        const z = -generationHalf + generationHalf * 2 * zIndex / 40;
        if (cropRegionalProfile(crop, x, z, context).affinity >= 0.75) {
          primeSamples += 1;
        }
        totalSamples += 1;
      }
    }
    const primeCoverage = primeSamples / totalSamples;
    if (represented) {
      assert.ok(
        primeCoverage >= 0.02 && primeCoverage <= 0.06,
        `${crop} should have limited but meaningful prime coverage on ${mapSize} maps`,
      );
    } else {
      assert.equal(primeCoverage, 0, `${crop} should have no prime province on ${mapSize} maps`);
    }
  }
}
const parityFixture = cropRegionalProfile(
  'flax',
  123.5,
  -87.25,
  { worldSeed: 0x071a_2e0d, mapSize: 'large' },
);
assert.equal(parityFixture.rank, 0);
assert.ok(Math.abs(parityFixture.provinceStrength - 0.8712118023247608) < 1e-12);
assert.ok(Math.abs(parityFixture.affinity - 0.8840906220922847) < 1e-12);
assert.ok(Math.abs(parityFixture.yieldMultiplier - 0.9327725608135251) < 1e-12);
const smallMapSpecialtySets = new Set<string>();
for (const worldSeed of [1, 2, 3, 4, 5, 0x071a_2e0d]) {
  smallMapSpecialtySets.add(strategicCrops
    .filter((crop) => cropRegionalProfile(crop, 0, 0, { worldSeed, mapSize: 'small' }).represented)
    .join(','));
}
assert.ok(
  smallMapSpecialtySets.size > 1,
  'changing the world seed should change a small map\'s comparative advantages',
);
const dryLandSites = [] as Array<{ x: number; z: number }>;
for (let z = -360; z <= 360; z += 60) {
  for (let x = -360; x <= 360; x += 60) dryLandSites.push({ x, z });
}
const winners = new Set<string>();
for (const site of dryLandSites) {
  const ranked = strategicCrops
    .map((crop) => ({ crop, score: cropEnvironmentalSuitability(crop, 0, site.x, site.z) }))
    .sort((left, right) => right.score - left.score);
  winners.add(ranked[0].crop);
}
for (const crop of strategicCrops) {
  const scores = dryLandSites.map((site) => (
    cropEnvironmentalSuitability(crop, 0, site.x, site.z)
  ));
  assert.ok(
    Math.max(...scores) - Math.min(...scores) > 0.08,
    `${crop} should have visibly different non-river soil pockets`,
  );
}
for (const grain of ['rye', 'oats', 'barley', 'wheat'] as const) {
  assert.ok(winners.has(grain), `${grain} should win some non-river land pockets`);
}
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
  regionContext: { worldSeed: 0x071a_2e0d, mapSize: 'small' },
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
const REPRESENTATIVE_FIELD_AREA = 1_600;
const representativeSide = Math.sqrt(REPRESENTATIVE_FIELD_AREA);
const representativeRectangle = [
  { x: -representativeSide / 2, z: -representativeSide / 2 },
  { x: representativeSide / 2, z: -representativeSide / 2 },
  { x: representativeSide / 2, z: representativeSide / 2 },
  { x: -representativeSide / 2, z: representativeSide / 2 },
] as FarmFieldState['corners'];
const largeArea = REPRESENTATIVE_FIELD_AREA * 2;
const largeSide = Math.sqrt(largeArea);
const largeRectangle = [
  { x: -largeSide / 2, z: -largeSide / 2 },
  { x: largeSide / 2, z: -largeSide / 2 },
  { x: largeSide / 2, z: largeSide / 2 },
  { x: -largeSide / 2, z: largeSide / 2 },
] as FarmFieldState['corners'];
const representativeYield = expectedFieldYield({
  area: REPRESENTATIVE_FIELD_AREA,
  crop: 'rye',
  moisture: 0.38,
  fertility: 1,
  averageSlopeDegrees: 0,
  corners: representativeRectangle,
});
const largeYield = expectedFieldYield({
  area: largeArea,
  crop: 'rye',
  moisture: 0.38,
  fertility: 1,
  averageSlopeDegrees: 0,
  corners: largeRectangle,
});
assert.ok(
  Math.abs(largeYield - representativeYield * 2) < 1e-9,
  'field yield should scale with area instead of crossing a hidden size penalty',
);
const representativeWorkField = {
  area: REPRESENTATIVE_FIELD_AREA,
  corners: representativeRectangle,
  crop: 'rye' as const,
};
const largeWorkField = {
  area: largeArea,
  corners: largeRectangle,
  crop: 'rye' as const,
};
assert.ok(
  fullFieldCycleWork(largeWorkField, { x: 0, z: 0 })
    < fullFieldCycleWork(representativeWorkField, { x: 0, z: 0 }) * 2,
  'one large parcel should avoid the repeated setup and boundary work of two small parcels',
);
assert.ok(
  fullFieldCycleWork(representativeWorkField, { x: 100, z: 0 })
    > fullFieldCycleWork(representativeWorkField, { x: 0, z: 0 }),
  'fields farther from their farmstead should cost more labor each cycle',
);
const linkedLaborFarm = { id: 'farm-a', x: 0, z: 0, workRadius: 250 };
const neighboringLaborFarm = { id: 'farm-b', x: 100, z: 0, workRadius: 250 };
const distantLaborFarm = { id: 'farm-c', x: 300, z: 0, workRadius: 100 };
const sharedLaborField = {
  farmsteadId: linkedLaborFarm.id,
  priority: FARM_SHARED_LABOR_MIN_PRIORITY,
  corners: representativeRectangle,
};
assert.ok(fieldAcceptsFarmsteadLabor(sharedLaborField, linkedLaborFarm));
assert.ok(fieldAcceptsFarmsteadLabor(sharedLaborField, neighboringLaborFarm));
assert.ok(!fieldAcceptsFarmsteadLabor(sharedLaborField, distantLaborFarm));
assert.ok(!fieldAcceptsFarmsteadLabor(
  { ...sharedLaborField, priority: FARM_SHARED_LABOR_MIN_PRIORITY - 1 },
  neighboringLaborFarm,
));
assert.equal(normalizeThreshingPriority(undefined), THRESHING_PRIORITY_AUTO);
assert.ok(
  fieldTaskRank(1, true) > threshingTaskRank(THRESHING_PRIORITY_HIGH, true),
  'a ready harvest must outrank even high-priority threshing',
);
assert.ok(
  threshingTaskRank(THRESHING_PRIORITY_HIGH, false) > fieldTaskRank(3, false),
  'high threshing focus must pre-empt non-harvest fieldwork',
);
assert.ok(
  threshingTaskRank(THRESHING_PRIORITY_AUTO, true) < fieldTaskRank(2, false)
    && threshingTaskRank(THRESHING_PRIORITY_AUTO, true) > fieldTaskRank(1, false),
  'automatic demand must sit between high and normal fieldwork',
);
assert.ok(
  threshingTaskRank(THRESHING_PRIORITY_LOW, true) < fieldTaskRank(1, false),
  'fields-first threshing must wait behind normal fieldwork',
);
assert.equal(MILL_WATER_PER_HARVEST, 0, 'lumber should not consume well water');
assert.equal(WATERMILL_WATER_PER_CYCLE, 0, 'a river-powered mill should not consume well water');
assert.ok(BAKERY_WATER_PER_CYCLE > 0, 'bakery production should consume well water');
assert.ok(BAKERY_FIREWOOD_PER_CYCLE > 0, 'bakery production should consume fuel');
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
assert.equal(
  seedGrainRequired(1, 'rye'),
  1,
  'positive seed requirements are indivisible lots',
);
assert.equal(FARM_CROP_DEFINITIONS.flax.produce, 'fibre');
assert.equal(FARM_CROP_DEFINITIONS.barley.produce, 'barley');
assert.equal(FARM_CROP_DEFINITIONS.wheat.workSeason, 'autumn');
assert.equal(BUILDING_DEFINITIONS.threshing_barn.workRadius, 250);
assert.equal(BUILDING_DEFINITIONS.threshing_barn.maxLabor, 8);
assert.ok(
  FARMSTEAD_STARTER_SEED_GRAIN >= seedGrainRequired(REPRESENTATIVE_FIELD_AREA, 'oats'),
  'a new holding should be able to sow one representative oats field',
);
assert.ok(
  FARMSTEAD_STARTER_BARLEY_SEED
    >= seedGrainRequired(REPRESENTATIVE_FIELD_AREA, 'barley'),
  'a new holding should be able to sow one representative barley field',
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
  currentYield: 1,
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
  fieldManureRequirement({ area: 1 }),
  1,
  'positive manure requirements are whole lots',
);
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
  0,
  'the complete seed lot leaves inventory when sowing begins',
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
assert.equal(fieldStageAllowed({ ...planningField, stage: 'harvesting' }, 7), true);
assert.equal(fieldStageAllowed({ ...planningField, stage: 'harvesting' }, 8), true);
assert.equal(fieldStageAllowed({ ...planningField, stage: 'harvesting' }, 9), false);
assert.match(cropCalendarLabel('rye'), /harvest August/);
assert.match(cropCalendarLabel('oats'), /harvest September/);

const earlyHarvestField = {
  ...planningField,
  stage: 'growing' as const,
  stageProgress: FARM_EARLY_HARVEST_MINIMUM_GROWTH,
  currentYield: 0,
};
const ryeEarlyHarvestMonth = FARM_CROP_DEFINITIONS.rye.harvestMonth - 1;
assert.equal(
  earlyHarvestAvailability(earlyHarvestField, ryeEarlyHarvestMonth).available,
  true,
);
assert.equal(earlyHarvestAvailability(earlyHarvestField, ryeEarlyHarvestMonth - 1).available, false);
assert.equal(
  earlyHarvestAvailability(
    { ...earlyHarvestField, stageProgress: FARM_EARLY_HARVEST_MINIMUM_GROWTH - 0.01 },
    ryeEarlyHarvestMonth,
  ).available,
  false,
);
assert.equal(
  earlyHarvestAvailability(
    { ...earlyHarvestField, crop: 'fallow' },
    ryeEarlyHarvestMonth,
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
const maintainedToolPlan = buildFarmsteadWorkPlan(
  [planningField],
  1,
  september,
  false,
  new Map(),
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
);
const partialToolPlan = buildFarmsteadWorkPlan(
  [planningField],
  1,
  september,
  false,
  new Map(),
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE / 2,
);
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
assert.ok(staffedPlan.toolIronworkRequired > 0);
assert.ok(
  staffedPlan.toolIronworkReserveTarget >= CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
);
assert.equal(
  maintainedToolPlan.toolIronworkRequired,
  staffedPlan.toolIronworkRequired,
  'faster tools wear by completed work rather than elapsed time',
);
assert.equal(
  maintainedToolPlan.harvest.availableWorkerDays,
  staffedPlan.harvest.availableWorkerDays * CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
);
assert.equal(
  partialToolPlan.harvest.availableWorkerDays,
  staffedPlan.harvest.availableWorkerDays,
  'partial tools may speed current work but must not promise the full seasonal bonus',
);
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
assert.doesNotMatch(farmFieldTool, /cropSiteSuitability|vineyardSiteFactors|vineyardProductionMultiplier/);
assert.doesNotMatch(farmFieldTool, /first harvest|% site|% drainage|% sun|× harvest/);
assert.match(farmFieldTool, /judge the site from the suitability overlay/);
assert.match(farmFieldTool, /expectedFieldYield\(draftField\)/, 'field placement should forecast exact harvest units');
assert.match(farmFieldTool, /m² \(\$\{hectares/, 'field placement should show area in square metres and hectares');
assert.match(farmFieldTool, /buildFarmsteadWorkPlan/, 'field placement should forecast the selected holding’s seasonal labor capacity');
assert.match(farmFieldTool, /worker-days/, 'field placement should label its farm labor forecast');
assert.match(farmFieldTool, /farm \$\{plan\.activeFields\} active fields/, 'the preview should count every parcel attached to the holding');
assert.match(
  farmFieldTool,
  /Promise\.resolve\(pending\)\.then\(\(\) => \{[\s\S]*?this\.clearDraft\(\);[\s\S]*?this\.options\.onModeChanged\(\);/,
  'placing one field should clear only its draft so the same farmstead can draw another',
);
assert.match(farmFieldTool, /suitability map visible/);
assert.match(farmFieldTool, /onCommitVineyard/);
assert.match(farmFieldTool, /this\.points\.length < 3/);
assert.match(farmFieldTool, /isValidFarmFieldCorners/);
assert.match(farmFieldTool, /sampleParcelPoints/);
assert.doesNotMatch(farmFieldTool, /rectangleFromBaseline/);
assert.match(farmFieldTool, /four independent corners/, 'shared parcel placement should explain its free-form shape model');

for (const [path, pattern, label] of [
  ['src/farming/PastureMarkers.ts', /organicParcelEdgePoints/, 'pasture fences'],
  ['src/farming/FarmFieldMarkers.ts', /organicParcelBoundaryPoints/, 'cultivated field banks'],
  ['src/vineyards/VineyardParcelMarkers.ts', /organicParcelEdgePoints[\s\S]*organicParcelBoundaryPoints/, 'vineyard rows and borders'],
] as const) {
  assert.match(
    fs.readFileSync(path, 'utf8'),
    pattern,
    `${label} should share deterministic hand-laid parcel geometry`,
  );
}
const vineyardParcelMarkers = fs.readFileSync('src/vineyards/VineyardParcelMarkers.ts', 'utf8');
assert.match(
  vineyardParcelMarkers,
  /createSeedThreeVineyardVines/,
  'free-form vineyard rows should use the established cultivated-grapevine renderer',
);
assert.doesNotMatch(
  vineyardParcelMarkers,
  /VINE_GEOMETRY|Grapevine crowns/,
  'vineyard parcels should not fall back to primitive geometric foliage',
);

const cropSuitabilityOverlay = fs.readFileSync(
  'src/farming/CropSuitabilityOverlay.ts',
  'utf8',
);
const sceneManager = fs.readFileSync('src/scene/SceneManager.ts', 'utf8');
const appSource = fs.readFileSync('src/app/App.ts', 'utf8');
const buildToolbar = fs.readFileSync('src/ui/BuildToolbar.ts', 'utf8');
assert.match(cropSuitabilityOverlay, /createDrapedOverlayGeometry/);
assert.match(cropSuitabilityOverlay, /sampleAuthoritativeGroundwaterScore/);
assert.match(cropSuitabilityOverlay, /private readonly textures = new Map/);
assert.match(sceneManager, /setCropSuitabilityOverlayCrop/);
assert.match(sceneManager, /setVineyardSuitabilityOverlayVisible/);
assert.match(sceneManager, /placementSuitabilityActive/);
assert.match(sceneManager, /this\.hydrologyOverlay\?\.setVisible\(mode === 'water'\)/);
assert.match(sceneManager, /this\.windOverlay\?\.setVisible\(mode === 'wind'\)/);
assert.match(appSource, /setCropSuitabilityOverlayCrop\(farmCrop\)/);
assert.match(appSource, /setVineyardSuitabilityOverlayVisible\(vineyardPlacementEnabled\)/);
assert.match(buildToolbar, /data-crop-suitability-legend/);
assert.match(buildToolbar, /first-crop site potential/);
assert.match(buildToolbar, /Grape suitability/);

const farmsteadInspector = fs.readFileSync('src/resources/inspector/expandedBuildingRenderer.ts', 'utf8');
const livestockInspector = fs.readFileSync('src/resources/inspector/livestockBuildingRenderer.ts', 'utf8');
const farmFieldInspector = fs.readFileSync('src/resources/inspector/farmFieldRenderer.ts', 'utf8');
assert.match(farmsteadInspector, /Seasonal tool reserve/);
assert.match(farmFieldInspector, /Field tools/);
assert.match(farmFieldInspector, /toolThroughputMultiplier/);
const townHallInspector = fs.readFileSync('src/resources/inspector/townHallRenderer.ts', 'utf8');
assert.match(farmsteadInspector, /data-land-parcel="field"/, 'farmsteads need a contextual field-layout action');
assert.match(livestockInspector, /data-land-parcel="pasture"/, 'livestock holdings need a contextual pasture action');
assert.match(farmFieldInspector, /Ox support/);
assert.match(farmFieldInspector, /High and Urgent also enter every nearby farmstead crew’s queue/);
assert.match(farmFieldInspector, /Available field crews/);
assert.match(farmsteadInspector, /Ox-supported fields/);
assert.match(farmsteadInspector, /Crew-sharing queue/);
assert.match(farmsteadInspector, /data-threshing-priority/);
assert.match(farmsteadInspector, /field and threshing work never double-count the crew/);
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
assert.match(farmFieldInspector, /Waiting until \$\{harvestMonthLabel\} keeps 100% yield/);
assert.match(farmFieldInspector, /Days until harvest/);
assert.match(farmFieldInspector, /Projected yield/);
assert.match(farmFieldInspector, /Crop province/);
assert.match(farmFieldInspector, /No prime.*province on this map/);
assert.match(farmFieldInspector, /regional yield factor/);
assert.match(farmFieldInspector, /Farmstead distance/);
assert.match(farmFieldInspector, /Parcel boundary/);
assert.doesNotMatch(farmFieldInspector, /Size efficiency/);

const farmSimulation = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const generatedBuilding = fs.readFileSync('src/generated/building_table.ts', 'utf8');
const generatedReducers = fs.readFileSync('src/generated/index.ts', 'utf8');
assert.match(generatedBuilding, /threshingPriority:\s*__t\.u8\(\)/);
assert.match(generatedReducers, /set_threshing_priority/);
assert.match(farmSimulation, /field\.current_yield \+= deposited/, 'harvest accounting must track grain actually stored');
assert.match(
  farmSimulation,
  /finish_field_cycle\(field, field\.current_yield\)/,
  'the October deadline must close partial harvests instead of erasing their soil cost',
);
assert.match(
  farmSimulation,
  /withdraw_building_commodity\([\s\S]*?resource_farmstead,[\s\S]*?CommodityKind::Manure,[\s\S]*?manure_needed,?\s*\)[\s\S]*?field\.manure_applied \+= manure_spread/,
  'ploughing progress must physically withdraw and spread manure from the crop farmstead',
);
assert.match(farmSimulation, /field_accepts_farmstead_labor/);
assert.match(farmSimulation, /threshing_preempts_fields/);
assert.match(farmSimulation, /work_allowed && threshing_labor == 0/);
assert.match(farmSimulation, /step_processor_with_labor/);
assert.match(
  farmSimulation,
  /resource_farmstead[\s\S]*CommodityKind::Manure[\s\S]*resource_farmstead[\s\S]*seed_commodity[\s\S]*deposit_building_commodity\(resource_farmstead/,
  'assisting crews must consume and deposit field resources at the linked farmstead',
);
assert.match(
  farmSimulation,
  /field_manure_fertility_bonus\(field\.area, field\.manure_applied\)/,
  'cycle settlement must convert actual spread coverage into the soil bonus',
);
assert.match(farmSimulation, /seed_grain_required\(field\.area, field\.crop\)/);
assert.match(
  farmSimulation,
  /let seed_due = if seed_required > 1e-9 && field\.stage_progress <= 1e-9[\s\S]*withdraw_building_commodity\(resource_farmstead, seed_commodity, seed_due\)/,
  'sowing must commit one complete seed lot when work first begins',
);
assert.match(
  farmSimulation,
  /let room = building_commodity_room\(resource_farmstead, commodity\)[\s\S]*harvest_due > room \+ 1e-9[\s\S]*let affordable_total = field\.current_yield \+ room/,
  'harvest progress must stop before a complete whole-unit lot exceeds storage headroom',
);
assert.doesNotMatch(
  farmSimulation,
  /let harvested = expected \* \(field\.stage_progress - previous_progress\)/,
  'harvest output must not leak fractional inventory with each work tick',
);
assert.match(
  farmSimulation,
  /fn crop_seed_commodity[\s\S]*CROP_RYE => CommodityKind::RyeGrain[\s\S]*CROP_OATS => CommodityKind::OatGrain[\s\S]*CROP_BARLEY => CommodityKind::Barley[\s\S]*CROP_FLAX => CommodityKind::Flax[\s\S]*CROP_WHEAT => CommodityKind::MaslinGrain/,
  'each field must consume its own exact seed commodity',
);
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
assert.match(constructionSimulation, /site\.rye_grain \+= FARMSTEAD_STARTER_SEED_GRAIN/);
assert.match(constructionSimulation, /site\.oat_grain \+= FARMSTEAD_STARTER_SEED_GRAIN/);
assert.match(constructionSimulation, /site\.maslin_grain \+= FARMSTEAD_STARTER_SEED_GRAIN/);
assert.match(constructionSimulation, /site\.barley \+= FARMSTEAD_STARTER_BARLEY_SEED/);
const farmFieldReducers = fs.readFileSync('server/src/reducers/farm_fields.rs', 'utf8');
assert.match(
  farmFieldReducers,
  /initial_field_fertility\(moisture, slope, center\.x, center\.z\)/,
);
assert.match(farmFieldReducers, /is_valid_convex_quadrilateral/);
assert.match(farmFieldReducers, /active rendered-water[\s\S]*groundwater proxy/);
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
