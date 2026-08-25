import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { GAME_TABLE_SUBSCRIPTIONS } from '../src/data/gameTableSubscriptions.ts';
import {
  effectiveLivestockBreedingReserve,
  effectiveLivestockHaymakingPercent,
  isLivestockCullMonth,
  isLivestockHaymakingMonth,
  isSheepShearingMonth,
  farmhouseCheeseSaltStagingCycles,
  livestockCareCapacity,
  livestockHeadsPerWorker,
  livestockHaymakingPresets,
  livestockDairyPreservedOutputPerCycle,
  livestockDairySaltPerCycle,
  livestockMilkAllocationPerCycle,
  livestockMilkUsePolicy,
  livestockPreservationSaltRequired,
  livestockPolicyDefinition,
  livestockPurchaseCost,
  livestockPurchaseGoldPerHead,
  livestockReservePresets,
  livestockSaleGoldPerHead,
  livestockSaleProceeds,
  livestockSaltedOutputCapacity,
  livestockStorageSecuredCullHeads,
  livestockWaterPerHeadPerCycle,
  livestockWaterRequiredPerCycle,
  pendingLivestockCullHeads,
  projectedLivestockCullYield,
} from '../src/economy/livestockPolicy.ts';
import {
  computeSettlementLivestockFodderPlan,
  livestockCyclesPerCalendarDay,
  livestockStoredFodderValue,
  projectLivestockFodderHolding,
} from '../src/economy/livestockFodder.ts';
import {
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  CATTLE_AREA_PER_HEAD,
  CATTLE_DEFAULT_BREEDING_RESERVE,
  CATTLE_BREEDING_PER_CYCLE,
  CATTLE_DAIRY_PRODUCTIVE_SHARE,
  CATTLE_FOOD_PER_CYCLE_PER_HEAD,
  CATTLE_GRAIN_PER_UNSUPPORTED_HEAD,
  CATTLE_HAY_PER_UNSUPPORTED_HEAD,
  CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
  CATTLE_HEADS_PER_WORKER,
  CATTLE_MAX_HERD,
  CATTLE_MINIMUM_BREEDING_RESERVE,
  CATTLE_PURCHASE_GOLD_PER_HEAD,
  CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD,
  CATTLE_SALE_GOLD_PER_HEAD,
  CATTLE_STARTER_HERD,
  CATTLE_WATER_PER_HEAD_PER_CYCLE,
  DROUGHT_PASTURE_CAPACITY_MULTIPLIER,
  FARM_CROP_DEFINITIONS,
  LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
  LIVESTOCK_ANIMAL_FEED_FODDER_VALUE,
  LIVESTOCK_ANIMAL_FEED_PER_CYCLE,
  LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE,
  LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
  MARKETPLACE_TRADE_OFFERS,
  MARKET_PRICE_MULTIPLIER_MAX,
  PANNAGE_AUTUMN_CAPACITY_MULTIPLIER,
  PANNAGE_DROUGHT_CAPACITY_MULTIPLIER,
  PANNAGE_SPRING_CAPACITY_MULTIPLIER,
  PANNAGE_WINTER_CAPACITY_MULTIPLIER,
  SHEEP_DEFAULT_BREEDING_RESERVE,
  SHEEP_AREA_PER_HEAD,
  SHEEP_BREEDING_PER_CYCLE,
  SHEEP_DAIRY_PRODUCTIVE_SHARE,
  SHEEP_FOOD_PER_CYCLE_PER_HEAD,
  SHEEP_HEADS_PER_WORKER,
  SHEEP_MAX_HERD,
  SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD,
  SHEEP_STARTER_HERD,
  SPRING_BREEDING_MULTIPLIER,
  SWINE_BREEDING_PER_CYCLE,
  SWINE_AREA_PER_HEAD,
  SWINE_DEFAULT_BREEDING_RESERVE,
  SWINE_HEADS_PER_WORKER,
  SWINE_MAX_HERD,
  SWINE_MATURE_TREES_PER_HEAD,
  SWINE_STARTER_HERD,
  SWINE_FOOD_PER_CYCLE_PER_HEAD,
  SWINE_WATER_PER_HEAD_PER_CYCLE,
  WINTER_BREEDING_MULTIPLIER,
  WINTER_PASTURE_CAPACITY_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import type { BuildingState, LivestockHerdState } from '../src/resources/types.ts';
import { pannageCapacityMultiplierFor } from '../src/world/seasonPolicy.ts';

function buildingFixture(
  id: string,
  grain: number,
  assignedLabor = 1,
): BuildingState {
  return {
    id,
    kind: 'pastoral_farmstead',
    x: 0,
    z: 0,
    workRadius: 110,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    oatGrain: 0,
    animalFeed: grain,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    salt: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: false,
    storehouseAcceptsStone: false,
    storehouseAcceptsFirewood: false,
  };
}

function herdFixture(buildingId: string): LivestockHerdState {
  return {
    pastureId: `pasture-for-${buildingId}`,
    buildingId,
    species: 'cattle',
    headCount: 8,
    health: 0.9,
    breedingProgress: 0,
    pastureCapacity: 10 * AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
    suppliedCapacity: 8,
    lastFoodOutput: 0,
    lastPreservedOutput: 0,
    lastWoolGold: 0,
    breedingReserve: 6,
    lastCulled: 0,
    hayStock: 0,
    lastHayOutput: 0,
    haymakingPercent: 35,
  };
}

assert.equal(SWINE_FOOD_PER_CYCLE_PER_HEAD, 0, 'pigs must not create passive meat without culling');
assert.ok(CATTLE_MINIMUM_BREEDING_RESERVE < CATTLE_DEFAULT_BREEDING_RESERVE);
assert.equal(CATTLE_DEFAULT_BREEDING_RESERVE, CATTLE_MAX_HERD);
assert.equal(SHEEP_DEFAULT_BREEDING_RESERVE, SHEEP_MAX_HERD);
assert.equal(SWINE_DEFAULT_BREEDING_RESERVE, SWINE_MAX_HERD);

assert.equal(isLivestockCullMonth(9), false);
assert.equal(isLivestockCullMonth(10), true);
assert.equal(isLivestockCullMonth(11), true);
assert.equal(isLivestockCullMonth(12), false);
assert.equal(isLivestockHaymakingMonth(5), false);
assert.equal(isLivestockHaymakingMonth(6), true);
assert.equal(isLivestockHaymakingMonth(8), true);
assert.equal(isLivestockHaymakingMonth(9), false);
assert.equal(isSheepShearingMonth(5), false);
assert.equal(isSheepShearingMonth(6), true);
assert.equal(isSheepShearingMonth(7), true);
assert.equal(isSheepShearingMonth(8), false);
assert.equal(effectiveLivestockHaymakingPercent(-1), 0);
assert.equal(effectiveLivestockHaymakingPercent(35.9), 35);
assert.equal(effectiveLivestockHaymakingPercent(100), 60);
assert.deepEqual(
  livestockHaymakingPresets().map((preset) => preset.percent),
  [0, 35, 60],
);

assert.equal(
  effectiveLivestockBreedingReserve('swine', 0),
  livestockPolicyDefinition('swine').maximumHerd,
  'zero remains a defensive no-cull fallback',
);
assert.deepEqual(
  livestockReservePresets('cattle').map((preset) => preset.reserve),
  [5, 12, 20],
);
assert.deepEqual(
  livestockReservePresets('sheep').map((preset) => preset.reserve),
  [10, 35, 60],
);
assert.deepEqual(
  livestockReservePresets('swine').map((preset) => preset.reserve),
  [6, 18, 30],
);
assert.equal(pendingLivestockCullHeads('swine', 10, 7), 3);
assert.deepEqual(projectedLivestockCullYield('swine', 10, 7), {
  heads: 3,
  food: 9,
  preservedFood: 0,
});
assert.deepEqual(projectedLivestockCullYield('cattle', 9, 6), {
  heads: 3,
  food: 15,
  preservedFood: 1.5,
});
assert.equal(livestockStorageSecuredCullHeads('cattle', 20, 12, 120, 70, 12), 8);
assert.equal(
  livestockStorageSecuredCullHeads('cattle', 20, 12, 4.99, 70, 12),
  0,
  'a whole cattle carcass must fit before winter planning removes that animal',
);
assert.equal(
  livestockStorageSecuredCullHeads('cattle', 20, 12, 44, 0, 0),
  8,
  'an unsalted cured share must correctly fall back into available fresh storage',
);
assert.equal(livestockPreservationSaltRequired(8), 1);
assert.equal(livestockSaltedOutputCapacity(1), 8);
assert.equal(
  livestockDairyPreservedOutputPerCycle('cattle', 10),
  0.6,
);
assert.equal(
  livestockDairySaltPerCycle('cattle', 10),
  0.6 * LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT,
);
assert.equal(livestockDairySaltPerCycle('swine', 10), 0);
assert.equal(livestockMilkUsePolicy(25).label, 'Fresh milk');
assert.equal(livestockMilkUsePolicy(100).label, 'Balanced');
assert.equal(livestockMilkUsePolicy(75).label, 'Cheese first');
assert.deepEqual(livestockMilkAllocationPerCycle('cattle', 10, 25), {
  grossMilk: 2.7,
  freshMilk: 2.7,
  cheese: 0,
});
const cheeseFirst = livestockMilkAllocationPerCycle('cattle', 10, 75);
assert.ok(Math.abs(cheeseFirst.freshMilk - 0.675) < 1e-9);
assert.ok(Math.abs(cheeseFirst.cheese - 2.025) < 1e-9);
assert.ok(Math.abs(cheeseFirst.freshMilk + cheeseFirst.cheese - 2.7) < 1e-9);
assert.equal(farmhouseCheeseSaltStagingCycles(25), 0);
assert.equal(farmhouseCheeseSaltStagingCycles(50), 3);
assert.equal(livestockPurchaseGoldPerHead('cattle'), CATTLE_PURCHASE_GOLD_PER_HEAD);
assert.equal(livestockSaleGoldPerHead('cattle'), CATTLE_SALE_GOLD_PER_HEAD);
assert.equal(livestockPurchaseCost('cattle', 2.9), CATTLE_PURCHASE_GOLD_PER_HEAD * 2);
assert.equal(livestockSaleProceeds('cattle', 2.9), CATTLE_SALE_GOLD_PER_HEAD * 2);
assert.equal(livestockPurchaseCost('sheep', Number.NaN), 0);
assert.equal(livestockSaleProceeds('swine', -4), 0);
assert.ok(
  livestockPurchaseGoldPerHead('cattle') > livestockSaleGoldPerHead('cattle'),
  'live-animal resale must not be an arbitrage loop',
);
assert.deepEqual(
  [CATTLE_STARTER_HERD, SHEEP_STARTER_HERD, SWINE_STARTER_HERD],
  [5, 15, 8],
  'first orders should feel like herds rather than token single animals',
);
assert.deepEqual(
  [CATTLE_MAX_HERD, SHEEP_MAX_HERD, SWINE_MAX_HERD],
  [20, 60, 30],
  'developed holdings need visibly distinct settlement-scale ceilings',
);
assert.deepEqual(
  [
    CATTLE_STARTER_HERD * CATTLE_AREA_PER_HEAD,
    SHEEP_STARTER_HERD * SHEEP_AREA_PER_HEAD,
    SWINE_STARTER_HERD * SWINE_AREA_PER_HEAD,
  ],
  [1200, 1350, 1280],
  'starter orders should ask for comparable ideal enclosure footprints',
);
assert.equal(SWINE_STARTER_HERD * SWINE_MATURE_TREES_PER_HEAD, 12);
assert.equal(SWINE_MAX_HERD * SWINE_MATURE_TREES_PER_HEAD, 45);
const starterOrderCosts = [
  livestockPurchaseCost('cattle', CATTLE_STARTER_HERD),
  livestockPurchaseCost('sheep', SHEEP_STARTER_HERD),
  livestockPurchaseCost('swine', SWINE_STARTER_HERD),
];
assert.ok(
  Math.max(...starterOrderCosts) - Math.min(...starterOrderCosts) <= 10,
  'starter orders should require comparable civic capital across species',
);
const exportGoldPerUnit = (resource: 'meat' | 'curedMeat'): number => {
  const offer = MARKETPLACE_TRADE_OFFERS.find(
    (candidate) => candidate.kind === 'goldSell' && candidate.resource === resource,
  );
  assert.ok(offer && offer.kind === 'goldSell');
  return offer.goldYield / offer.amount;
};
for (const species of ['cattle', 'sheep', 'swine'] as const) {
  const policy = livestockPolicyDefinition(species);
  const peakCullExport = (
    policy.slaughterFoodPerHead * exportGoldPerUnit('meat')
    + policy.slaughterPreservedFoodPerHead * exportGoldPerUnit('curedMeat')
  ) * MARKET_PRICE_MULTIPLIER_MAX;
  assert.ok(
    policy.purchaseGoldPerHead > peakCullExport,
    `${species} breeding stock must cost more than its peak-market carcass export`,
  );
}
const cattleFullGrossMilk = CATTLE_MAX_HERD
  * CATTLE_DAIRY_PRODUCTIVE_SHARE
  * (CATTLE_FOOD_PER_CYCLE_PER_HEAD + CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD);
const sheepFullGrossMilk = SHEEP_MAX_HERD
  * SHEEP_DAIRY_PRODUCTIVE_SHARE
  * (SHEEP_FOOD_PER_CYCLE_PER_HEAD + SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD);
assert.ok(
  Math.abs(cattleFullGrossMilk - sheepFullGrossMilk) <= cattleFullGrossMilk * 0.1,
  'larger sheep head counts must not multiply full-holding dairy beyond cattle-scale output',
);

function fullySupportedHeadsAfterOneYear(
  startingHeads: number,
  maximumHeads: number,
  breedingPerCycle: number,
  cyclesPerDay: number,
): number {
  let heads = startingHeads;
  let progress = 0;
  for (let day = 0; day < 360; day += 1) {
    const month = Math.floor(day / 30) + 1;
    const seasonalMultiplier = month >= 3 && month <= 5
      ? SPRING_BREEDING_MULTIPLIER
      : 0;
    progress += heads * breedingPerCycle * cyclesPerDay * seasonalMultiplier;
    while (progress >= 1 && heads < maximumHeads) {
      heads += 1;
      progress -= 1;
    }
  }
  return heads;
}

const workdaySeconds = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;
const pastoralBreedingCyclesPerDay = workdaySeconds
  / BUILDING_DEFINITIONS.pastoral_farmstead.harvestInterval;
const swineBreedingCyclesPerDay = workdaySeconds
  / BUILDING_DEFINITIONS.swineherd.harvestInterval;
assert.equal(pastoralBreedingCyclesPerDay, 0.1);
assert.ok(Math.abs(swineBreedingCyclesPerDay - 1 / 15) < 1e-12);
assert.equal(WINTER_BREEDING_MULTIPLIER, 0);
const serverSeasonPolicySource = fs.readFileSync('server/src/season_policy.rs', 'utf8');
assert.match(
  serverSeasonPolicySource,
  /Season::Spring => SPRING_BREEDING_MULTIPLIER,[\s\S]{0,100}Season::Summer \| Season::Autumn \| Season::Winter => 0\.0/,
  'authoritative birth progress must be zero outside spring',
);
const serverLivestockBreedingSource = fs.readFileSync(
  'server/src/simulation/livestock.rs',
  'utf8',
);
assert.match(
  serverLivestockBreedingSource,
  /if environment\.season == Season::Spring\s*&& herd\.head_count >= LIVESTOCK_MINIMUM_BREEDING_HEADS/,
  'the authoritative birth gate must explicitly reject legacy progress outside spring',
);

assert.deepEqual(
  [
    fullySupportedHeadsAfterOneYear(
      CATTLE_STARTER_HERD,
      CATTLE_MAX_HERD,
      CATTLE_BREEDING_PER_CYCLE,
      pastoralBreedingCyclesPerDay,
    ),
    fullySupportedHeadsAfterOneYear(
      SHEEP_STARTER_HERD,
      SHEEP_MAX_HERD,
      SHEEP_BREEDING_PER_CYCLE,
      pastoralBreedingCyclesPerDay,
    ),
    fullySupportedHeadsAfterOneYear(
      SWINE_STARTER_HERD,
      SWINE_MAX_HERD,
      SWINE_BREEDING_PER_CYCLE,
      swineBreedingCyclesPerDay,
    ),
  ],
  [7, 27, 21],
  'one fully supported spring at the actual fixed husbandry cadence should grow herds meaningfully',
);
assert.equal(livestockHeadsPerWorker('cattle'), CATTLE_HEADS_PER_WORKER);
assert.equal(livestockHeadsPerWorker('sheep'), SHEEP_HEADS_PER_WORKER);
assert.equal(livestockHeadsPerWorker('swine'), SWINE_HEADS_PER_WORKER);
assert.equal(livestockCareCapacity('cattle', 2.9), CATTLE_HEADS_PER_WORKER * 2);
assert.equal(livestockCareCapacity('cattle', -1), 0);
assert.equal(livestockCareCapacity('cattle', 3), CATTLE_MAX_HERD + 1);
assert.equal(livestockCareCapacity('sheep', 3), SHEEP_MAX_HERD);
assert.equal(livestockCareCapacity('swine', 2), SWINE_MAX_HERD);
assert.equal(
  livestockWaterPerHeadPerCycle('cattle'),
  CATTLE_WATER_PER_HEAD_PER_CYCLE,
);
assert.equal(
  livestockWaterPerHeadPerCycle('swine'),
  SWINE_WATER_PER_HEAD_PER_CYCLE,
);
assert.ok(
  Math.abs(
    livestockWaterRequiredPerCycle('cattle', 10)
      - CATTLE_WATER_PER_HEAD_PER_CYCLE * 10,
  ) < 1e-9,
);
assert.equal(livestockWaterRequiredPerCycle('sheep', Number.NaN), 0);
assert.equal(
  livestockStoredFodderValue({ animalFeed: 10 }),
  10 * LIVESTOCK_ANIMAL_FEED_FODDER_VALUE,
);
const rawGrainOnly = {
  animalFeed: 0,
  oatGrain: 10,
  ryeGrain: 5,
  maslinGrain: 5,
};
assert.equal(
  livestockStoredFodderValue(rawGrainOnly),
  0,
  'raw oats, rye, and maslin must not count as ready livestock fodder',
);
assert.equal(
  LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE,
  LIVESTOCK_ANIMAL_FEED_PER_CYCLE,
  'staffed pastoral farmsteads must prepare one whole Animal Feed per whole oat',
);
assert.equal(
  pannageCapacityMultiplierFor('spring', 'fair'),
  PANNAGE_SPRING_CAPACITY_MULTIPLIER,
);
assert.equal(
  pannageCapacityMultiplierFor('autumn', 'fair'),
  PANNAGE_AUTUMN_CAPACITY_MULTIPLIER,
);
assert.equal(
  pannageCapacityMultiplierFor('autumn', 'drought'),
  PANNAGE_DROUGHT_CAPACITY_MULTIPLIER,
);

const fodderBuilding = buildingFixture('building-1', 60);
const fodderHerd = herdFixture(fodderBuilding.id);
const pastoralCyclesPerCalendarDay = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY
  / BUILDING_DEFINITIONS.pastoral_farmstead.harvestInterval;
assert.equal(
  livestockCyclesPerCalendarDay(fodderBuilding, false),
  pastoralCyclesPerCalendarDay,
);
assert.equal(
  livestockCyclesPerCalendarDay(fodderBuilding, true),
  pastoralCyclesPerCalendarDay,
);
assert.equal(
  livestockCyclesPerCalendarDay(buildingFixture('building-0', 0, 0), true),
  pastoralCyclesPerCalendarDay,
  'animal needs continue when a holding is unstaffed or observes Sabbath',
);
assert.equal(
  livestockCyclesPerCalendarDay(buildingFixture('building-2', 0, 2), false),
  pastoralCyclesPerCalendarDay,
  'extra workers must not accelerate animal biology',
);
const fodderPlan = projectLivestockFodderHolding(
  fodderBuilding,
  fodderHerd,
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(fodderPlan.projectedHeadCount, 6, 'autumn forecast must include configured culls');
assert.equal(fodderPlan.plannedCullHeads, 2);
assert.equal(fodderPlan.executableCullHeads, 2);
assert.equal(fodderPlan.unsecuredCullHeads, 0);
assert.equal(fodderPlan.winterPastureCapacity, 3.5);
assert.equal(fodderPlan.winterUnsupportedHeads, 2.5);
assert.ok(
  Math.abs(
    fodderPlan.winterFeedPerDay
      - fodderPlan.winterUnsupportedHeads
        * CATTLE_GRAIN_PER_UNSUPPORTED_HEAD
        * pastoralCyclesPerCalendarDay
        / LIVESTOCK_ANIMAL_FEED_FODDER_VALUE,
  ) < 1e-9,
);
assert.ok(
  Math.abs(
    fodderPlan.winterFeedNeed
      - fodderPlan.winterFeedPerDay * LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
  ) < 1e-9,
);
assert.ok(Math.abs(fodderPlan.winterReserveTarget - fodderPlan.winterFeedNeed) < 1e-9);
assert.ok(Math.abs(fodderPlan.winterReserveStock - fodderPlan.winterReserveTarget) < 1e-9);
assert.equal(fodderPlan.winterReserveShortfall, 0);
assert.ok(
  Math.abs(
    fodderPlan.productiveHeads
      - CATTLE_HEADS_PER_WORKER * fodderHerd.health,
  ) < 1e-9,
  'dairy forecast must respect the current care crew capacity',
);
assert.ok(
  Math.abs(
    fodderPlan.dairyPreservedFoodPerDay
      - livestockMilkAllocationPerCycle(
        'cattle',
        fodderPlan.productiveHeads,
        fodderBuilding.processorOutputTargetPercent,
      ).cheese * pastoralCyclesPerCalendarDay,
  ) < 1e-9,
);
assert.ok(
  Math.abs(
    fodderPlan.dairySaltPerDay
      - livestockDairySaltPerCycle(
        'cattle',
        fodderPlan.productiveHeads,
        fodderBuilding.processorOutputTargetPercent,
      ) * pastoralCyclesPerCalendarDay,
  ) < 1e-9,
);
assert.equal(
  fodderPlan.dairySaltTarget,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE * 3,
);
assert.equal(fodderPlan.dairySaltShortfall, fodderPlan.dairySaltTarget);
assert.equal(fodderPlan.dairySaltRunwayDays, 0);
assert.equal(fodderPlan.winterFeedNeed, fodderPlan.winterReserveTarget);

const feedWorkshopBuilding = {
  ...buildingFixture('building-feed-workshop', 0),
  oatGrain: 5,
  animalFeed: 0,
};
  const feedWorkshopPlan = projectLivestockFodderHolding(
  feedWorkshopBuilding,
  { ...fodderHerd, pastureId: 'pasture-feed-workshop', buildingId: feedWorkshopBuilding.id },
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(feedWorkshopPlan.oatInputStock, 5);
assert.equal(feedWorkshopPlan.animalFeedStock, 0);
assert.equal(feedWorkshopPlan.winterReserveStock, 0);
assert.equal(
  feedWorkshopPlan.projectedAnimalFeedStock,
  5,
  'five raw oats must project to five prepared feed units at a staffed pastoral workshop',
);
assert.ok(feedWorkshopPlan.feedConversionPerDay > 0);
assert.equal(
  feedWorkshopPlan.feedOatInputPerDay,
  feedWorkshopPlan.feedConversionPerDay,
  'the client forecast must preserve the authoritative 1:1 recipe throughput',
);
assert.equal(
  feedWorkshopPlan.feedConversionPerDay,
  pastoralCyclesPerCalendarDay * LIVESTOCK_ANIMAL_FEED_PER_CYCLE,
  'one staffed holding must prepare one recipe batch per due husbandry cycle',
);
const threeWorkerFeedWorkshopPlan = projectLivestockFodderHolding(
  { ...feedWorkshopBuilding, assignedLabor: 3 },
  { ...fodderHerd, pastureId: 'pasture-feed-workshop', buildingId: feedWorkshopBuilding.id },
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(
  threeWorkerFeedWorkshopPlan.feedConversionPerDay,
  feedWorkshopPlan.feedConversionPerDay,
  'extra workers must not accelerate the fixed feed-preparation cadence',
);
assert.equal(
  threeWorkerFeedWorkshopPlan.feedOatInputPerDay,
  feedWorkshopPlan.feedOatInputPerDay,
);
const oxAssistedFeedWorkshopPlan = projectLivestockFodderHolding(
  feedWorkshopBuilding,
  { ...fodderHerd, pastureId: 'pasture-feed-workshop', buildingId: feedWorkshopBuilding.id },
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
  1,
  { onsiteHumanWorkers: 1, pairedOxen: 1, effectiveWorkers: 2 },
);
assert.equal(
  oxAssistedFeedWorkshopPlan.feedConversionPerDay,
  feedWorkshopPlan.feedConversionPerDay,
  'paired production oxen must not accelerate the fixed feed-preparation cadence',
);
const sabbathFeedWorkshopPlan = projectLivestockFodderHolding(
  feedWorkshopBuilding,
  { ...fodderHerd, pastureId: 'pasture-feed-workshop', buildingId: feedWorkshopBuilding.id },
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  true,
  9,
);
assert.ok(
  Math.abs(
    sabbathFeedWorkshopPlan.feedConversionPerDay
      - feedWorkshopPlan.feedConversionPerDay * 6 / 7,
  ) < 1e-9,
  'Sabbath must pause feed preparation for one day without changing animal biology',
);
const unstaffedFeedWorkshopPlan = projectLivestockFodderHolding(
  { ...feedWorkshopBuilding, assignedLabor: 0 },
  { ...fodderHerd, pastureId: 'pasture-feed-workshop', buildingId: feedWorkshopBuilding.id },
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(unstaffedFeedWorkshopPlan.feedConversionPerDay, 0);
assert.equal(unstaffedFeedWorkshopPlan.projectedAnimalFeedStock, 0);

const forageShortHerd = {
  ...fodderHerd,
  pastureCapacity: 2,
};
const warmSeasonFeedPlan = projectLivestockFodderHolding(
  fodderBuilding,
  forageShortHerd,
  1,
  false,
  6,
);
assert.ok(warmSeasonFeedPlan.currentUnsupportedHeads > 0);
assert.equal(
  warmSeasonFeedPlan.currentFeedPerDay,
  0,
  'prepared feed must not mask an undersized pasture during non-winter months',
);
const winterFeedPlan = projectLivestockFodderHolding(
  fodderBuilding,
  forageShortHerd,
  WINTER_PASTURE_CAPACITY_MULTIPLIER,
  false,
  1,
);
assert.ok(winterFeedPlan.currentFeedPerDay > 0);
assert.ok(Number.isFinite(winterFeedPlan.currentFeedRunwayDays));

const storageBlockedFodderPlan = projectLivestockFodderHolding(
  {
    ...fodderBuilding,
    oatGrain: 0,
    grain: 0,
    meat: BUILDING_STORAGE_CAPS.pastoral_farmstead.food,
    curedMeat: BUILDING_STORAGE_CAPS.pastoral_farmstead.preservedFood,
  },
  { ...fodderHerd, headCount: 20, breedingReserve: 12 },
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(storageBlockedFodderPlan.plannedCullHeads, 8);
assert.equal(storageBlockedFodderPlan.executableCullHeads, 0);
assert.equal(storageBlockedFodderPlan.unsecuredCullHeads, 8);
assert.equal(
  storageBlockedFodderPlan.projectedHeadCount,
  20,
  'blocked culls must leave their animals in the winter fodder forecast',
);
assert.ok(storageBlockedFodderPlan.winterHayNeed > fodderPlan.winterHayNeed);

const summerHerd = {
  ...fodderHerd,
  pastureCapacity: 10 * (1 - fodderHerd.haymakingPercent / 100),
};
const summerPlan = projectLivestockFodderHolding(
  fodderBuilding,
  summerHerd,
  1,
  false,
  6,
  1,
);
assert.equal(summerPlan.basePastureCapacity, 10);
assert.equal(summerPlan.summerReservedCapacity, 3.5);
assert.ok(
  Math.abs(
    summerPlan.hayOutputPerDay
      - 3.5
        * CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE
        * pastoralCyclesPerCalendarDay,
  ) < 1e-9,
);
assert.equal(summerPlan.haymakingDaysRemaining, 90);
assert.ok(
  Math.abs(
    summerPlan.projectedHayStock
      - summerPlan.hayOutputPerDay * summerPlan.haymakingDaysRemaining,
  ) < 1e-9,
);
assert.ok(
  Math.abs(
    summerPlan.winterHayNeed
      - summerPlan.winterUnsupportedHeads
        * pastoralCyclesPerCalendarDay
        * LIVESTOCK_WINTER_FODDER_RESERVE_DAYS
        * CATTLE_HAY_PER_UNSUPPORTED_HEAD,
  ) < 1e-9,
);
assert.equal(
  summerPlan.winterFeedNeed,
  0,
  'a full three-month haymaking season should cover the minimum winter reserve',
);
assert.equal(summerPlan.currentUnsupportedHeads, 1.5);

const fullLoftSummerPlan = projectLivestockFodderHolding(
  fodderBuilding,
  {
    ...summerHerd,
    pastureCapacity: 10,
    hayStock: LIVESTOCK_HAY_STORAGE_CAPACITY,
  },
  1,
  false,
  6,
  1,
);
assert.equal(fullLoftSummerPlan.basePastureCapacity, 10);
assert.equal(fullLoftSummerPlan.summerReservedCapacity, 0);
assert.equal(fullLoftSummerPlan.hayOutputPerDay, 0);
assert.equal(fullLoftSummerPlan.currentUnsupportedHeads, 0);

const twoWorkerSummerPlan = projectLivestockFodderHolding(
  { ...fodderBuilding, assignedLabor: 2 },
  summerHerd,
  1,
  false,
  6,
  1,
);
assert.ok(Math.abs(twoWorkerSummerPlan.hayOutputPerDay - summerPlan.hayOutputPerDay * 2) < 1e-9);
assert.ok(
  twoWorkerSummerPlan.dairyPreservedFoodPerDay
    > summerPlan.dairyPreservedFoodPerDay,
  'a second worker should bring the eighth cow into care',
);
assert.ok(
  twoWorkerSummerPlan.dairyPreservedFoodPerDay
    < summerPlan.dairyPreservedFoodPerDay * 2,
  'more care coverage must not accelerate the fixed animal cycle',
);
assert.equal(twoWorkerSummerPlan.winterFeedNeed, summerPlan.winterFeedNeed);

const oxLaborForecast = {
  onsiteHumanWorkers: 1,
  pairedOxen: 1,
  effectiveWorkers: 2,
} as const;
assert.deepEqual(oxLaborForecast, {
  onsiteHumanWorkers: 1,
  pairedOxen: 1,
  effectiveWorkers: 2,
});
const oxAssistedSummerPlan = projectLivestockFodderHolding(
  fodderBuilding,
  summerHerd,
  1,
  false,
  6,
  1,
  oxLaborForecast,
);
assert.equal(oxAssistedSummerPlan.pairedOxen, 1);
assert.equal(oxAssistedSummerPlan.effectiveWorkers, 2);
assert.ok(
  Math.abs(
    oxAssistedSummerPlan.hayOutputPerDay - summerPlan.hayOutputPerDay * 2,
  ) < 1e-9,
  'one paired stable ox must add one worker-equivalent to haymaking',
);
assert.equal(
  oxAssistedSummerPlan.dairyPreservedFoodPerDay,
  twoWorkerSummerPlan.dairyPreservedFoodPerDay,
  'the same effective labor must govern dairy care coverage',
);
const oxAssistedSettlementPlan = computeSettlementLivestockFodderPlan(
  {
    buildings: new Map([[fodderBuilding.id, fodderBuilding]]),
    livestockHerds: new Map([[summerHerd.pastureId, summerHerd]]),
  },
  1,
  false,
  6,
  1,
  new Map([[fodderBuilding.id, oxLaborForecast]]),
);
assert.equal(
  oxAssistedSettlementPlan.hayOutputPerDay,
  oxAssistedSummerPlan.hayOutputPerDay,
  'settlement forecast must consume the same injected ox-assisted labor map',
);

const sabbathSummerPlan = projectLivestockFodderHolding(
  fodderBuilding,
  summerHerd,
  1,
  true,
  6,
  1,
);
assert.ok(Math.abs(sabbathSummerPlan.hayOutputPerDay - summerPlan.hayOutputPerDay * 6 / 7) < 1e-9);
assert.equal(sabbathSummerPlan.dairyPreservedFoodPerDay, summerPlan.dairyPreservedFoodPerDay);
assert.equal(sabbathSummerPlan.winterHayNeed, summerPlan.winterHayNeed);

const unstaffedSummerPlan = projectLivestockFodderHolding(
  { ...fodderBuilding, assignedLabor: 0 },
  summerHerd,
  1,
  false,
  6,
  1,
);
assert.equal(unstaffedSummerPlan.hayOutputPerDay, 0);
assert.equal(unstaffedSummerPlan.executableCullHeads, 0);
assert.equal(unstaffedSummerPlan.unsecuredCullHeads, 2);
assert.ok(
  unstaffedSummerPlan.winterHayNeed > summerPlan.winterHayNeed,
  'an unstaffed holding must provision the surplus animals it cannot cull',
);

const swineBuilding = {
  ...buildingFixture('building-swine', 60),
  kind: 'swineherd' as const,
};
const swineHerd: LivestockHerdState = {
  ...herdFixture(swineBuilding.id),
  species: 'swine',
  headCount: 10,
  pastureCapacity: 8 * PANNAGE_AUTUMN_CAPACITY_MULTIPLIER,
  suppliedCapacity: 10,
  breedingReserve: 7,
  haymakingPercent: 0,
};
const swinePlan = projectLivestockFodderHolding(
  swineBuilding,
  swineHerd,
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(swinePlan.basePastureCapacity, 8);
assert.equal(swinePlan.winterPastureCapacity, 8 * PANNAGE_WINTER_CAPACITY_MULTIPLIER);
assert.equal(swinePlan.winterHayNeed, 0, 'pigs must never enter the pastoral hay chain');
assert.ok(swinePlan.winterFeedNeed > 0, 'winter mast shortfalls must be covered by finished feed');
assert.equal(swinePlan.oatInputStock, 0, 'swineherds must not stage raw feed oats');
assert.equal(swinePlan.feedConversionPerDay, 0, 'swineherds must not run the pastoral feed recipe');

const droughtSwinePlan = projectLivestockFodderHolding(
  swineBuilding,
  {
    ...swineHerd,
    pastureCapacity: 8 * PANNAGE_DROUGHT_CAPACITY_MULTIPLIER,
  },
  DROUGHT_PASTURE_CAPACITY_MULTIPLIER,
  false,
  7,
);
assert.equal(droughtSwinePlan.basePastureCapacity, 8);

const hayFedAutumnPlan = projectLivestockFodderHolding(
  fodderBuilding,
  { ...fodderHerd, hayStock: fodderPlan.winterHayNeed },
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(
  hayFedAutumnPlan.winterHayNeed,
  hayFedAutumnPlan.hayStock,
  'a complete local hay reserve should cover the 30-day unsupported-head forecast',
);
assert.ok(hayFedAutumnPlan.winterFeedNeed <= 1e-9);
assert.ok(hayFedAutumnPlan.winterReserveTarget <= 1e-9);
assert.ok(CATTLE_HAY_PER_UNSUPPORTED_HEAD > 0);

const firstShortState = {
  buildings: new Map([
    ['building-10', buildingFixture('building-10', 0)],
    ['building-2', buildingFixture('building-2', 0)],
    ['building-1', buildingFixture('building-1', 90)],
  ]),
  livestockHerds: new Map([
    ['pasture-10', { ...herdFixture('building-10'), pastureId: 'pasture-10' }],
    ['pasture-2', { ...herdFixture('building-2'), pastureId: 'pasture-2' }],
    ['pasture-1', { ...herdFixture('building-1'), pastureId: 'pasture-1' }],
  ]),
};
const settlementFodder = computeSettlementLivestockFodderPlan(
  firstShortState,
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(settlementFodder.holdingCount, 3);
assert.equal(settlementFodder.shortHoldings, 2);
assert.equal(
  settlementFodder.firstShortBuildingId,
  'building-2',
  'server numeric ids must break equal-runway ties',
);
assert.equal(
  settlementFodder.winterReserveShortfall,
  fodderPlan.winterReserveTarget * 2,
  'one full holding must not hide local shortfalls at two others',
);
assert.equal(settlementFodder.dairySaltShortHoldings, 3);
assert.equal(
  settlementFodder.firstDairySaltShortBuildingId,
  'building-1',
  'equal empty salt runways must use stable server-id order',
);
assert.equal(
  settlementFodder.dairySaltTarget,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE * 3 * 3,
);

const serverPolicy = fs.readFileSync('server/src/livestock_policy.rs', 'utf8');
const serverSimulation = fs.readFileSync('server/src/simulation/livestock.rs', 'utf8');
const serverReducer = fs.readFileSync('server/src/reducers/livestock.rs', 'utf8');
const serverTables = fs.readFileSync('server/src/tables.rs', 'utf8');
const serverDeliveryTrips = fs.readFileSync('server/src/simulation/delivery_trips.rs', 'utf8');
const generatedHerd = fs.readFileSync('src/generated/pasture_herd_table.ts', 'utf8');
const generatedReducer = fs.readFileSync(
  'src/generated/set_livestock_breeding_reserve_reducer.ts',
  'utf8',
);
const generatedHaymakingReducer = fs.readFileSync(
  'src/generated/set_livestock_haymaking_percent_reducer.ts',
  'utf8',
);
const clientReducers = fs.readFileSync('src/data/spacetimeReducers.ts', 'utf8');
const livestockInspector = fs.readFileSync(
  'src/resources/inspector/livestockBuildingRenderer.ts',
  'utf8',
);
const pastureInspector = fs.readFileSync(
  'src/resources/inspector/pastureRenderer.ts',
  'utf8',
);
const townHallInspector = fs.readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
const stableInspector = fs.readFileSync(
  'src/resources/inspector/stableRenderer.ts',
  'utf8',
);
const buildMenuCards = fs.readFileSync('src/ui/buildMenuCards.ts', 'utf8');
const settlementHud = fs.readFileSync('src/ui/SettlementHud.ts', 'utf8');
const livestockCycle = serverSimulation.slice(
  serverSimulation.indexOf('fn run_livestock_cycle'),
  serverSimulation.indexOf('fn farmstead_salted_output_capacity'),
);

assert.match(serverPolicy, /pub fn can_cull_one/);
assert.match(serverPolicy, /pub fn projected_winter_animal_feed/);
assert.match(serverPolicy, /pub fn is_haymaking_month/);
assert.match(serverPolicy, /pub fn is_shearing_month/);
assert.match(serverPolicy, /pub fn haymaking_share/);
assert.match(serverPolicy, /pub fn essential_livestock_care_labor/);
assert.match(serverPolicy, /food_room[\s\S]*slaughter_food_per_head/);
assert.match(serverSimulation, /herd\.head_count -= 1/);
assert.match(serverSimulation, /herd\.last_culled = 1/);
assert.match(serverSimulation, /species_slaughter_yields/);
assert.match(serverSimulation, /herd\.hay_stock/);
assert.match(serverSimulation, /is_haymaking_month/);
assert.match(
  serverSimulation,
  /herd\.hay_stock \+ 1e-6 < LIVESTOCK_HAY_STORAGE_CAPACITY/,
  'a full hayloft must release reserved meadow back to grazing',
);
assert.match(
  serverSimulation,
  /fn allocate_holding_cycle_inputs[\s\S]{0,1000}let hay_units = if environment\.season == Season::Winter[\s\S]{0,500}let feed_unsupported = \(unsupported - hay_supported_heads\)[\s\S]{0,300}let feed_units = if environment\.season == Season::Winter/,
  'each pasture must allocate its local winter hay before requesting shared prepared Animal Feed',
);
assert.match(
  livestockCycle,
  /let hay_units_used = inputs\.hay_units[\s\S]{0,360}herd\.hay_stock -= hay_units_used[\s\S]{0,220}inputs\.animal_feed_units/,
  'the parcel cycle must consume the hay and feed allocated to that herd',
);
assert.match(
  serverSimulation,
  /if swine_building && desired_feed >= 1\.0[\s\S]*CommodityKind::AnimalFeed,[\s\S]*&\["pastoral_farmstead"\]/,
  'swineherds must request finished feed from pastoral holdings',
);
assert.match(
  serverSimulation,
  /else if !swine_building && desired_feed >= 1\.0[\s\S]*CommodityKind::OatGrain,[\s\S]*&\["threshing_barn", "granary"\]/,
  'pastoral workshops must request oats from threshing barns or granaries',
);
assert.match(
  serverSimulation,
  /fn prepare_animal_feed[\s\S]{0,180}building\.kind != "pastoral_farmstead"[\s\S]{0,420}LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE[\s\S]{0,420}withdraw_building_commodity\(building, CommodityKind::OatGrain[\s\S]{0,180}deposit_building_commodity\(building, CommodityKind::AnimalFeed/,
  'only staffed pastoral production cycles may execute the oats-to-feed recipe',
);
assert.match(
  serverSimulation,
  /let feed_units = if environment\.season == Season::Winter[\s\S]{0,700}fair_whole_allocations\(whole_units\(building\.animal_feed\), &feed_demands\)[\s\S]{0,260}withdraw_building_commodity\(building, CommodityKind::AnimalFeed, feed_used\)/,
  'shared Animal Feed must be allocated fairly and consumed only for winter demand',
);
assert.doesNotMatch(
  livestockCycle,
  /CommodityKind::(?:OatGrain|RyeGrain|MaslinGrain)/,
  'livestock cycles must never consume raw grain directly',
);
assert.match(
  serverSimulation,
  /head_count < breeding_limit[\s\S]*breeding_progress \+= [\s\S]*else[\s\S]*breeding_progress = herd\.breeding_progress\.min\(0\.999\)/,
  'full herds must not bank an unlimited queue of replacement births',
);
assert.match(
  serverSimulation,
  /fn salted_output_salt_cost[\s\S]*LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT[\s\S]*fn try_store_exact_salted_output[\s\S]*withdraw_building_commodity\(building, CommodityKind::Salt/,
  'farmhouse preserved output must withdraw physical salt',
);
assert.match(serverSimulation, /livestock_milk_allocation/);
assert.match(serverSimulation, /species_dairy_productive_share/);
assert.match(serverSimulation, /gross_milk - stored_cheese/);
assert.match(
  serverSimulation,
  /let \(cycle_care_labor, cycle_productive_labor\) = if paused \{[\s\S]{0,80}\(care_labor, 0\)[\s\S]{0,260}paired_production_ox_count[\s\S]{0,220}ox_amplified_worker_count[\s\S]{0,180}essential_livestock_care_labor\(amplified_labor, false\)/,
  'Sabbath must pause productive work without withdrawing essential herd care, while working oxen amplify active-cycle labor',
);
assert.match(serverDeliveryTrips, /local_milk_sale[\s\S]*FOOD_SALE_GOLD_PER_UNIT/);
assert.match(serverDeliveryTrips, /credit_local_household_income/);
assert.match(
  serverSimulation,
  /let fresh_slaughter[\s\S]{0,1200}deposit_building_commodity\(&mut cull_building, CommodityKind::Meat, fresh_slaughter\)/,
  'unsalted autumn meat must enter vulnerable fresh-food storage',
);
assert.doesNotMatch(
  serverSimulation,
  /season_multiplier[\s\S]{0,300}species_food_per_cycle/,
  'pork must not remain a disguised passive seasonal multiplier',
);
assert.match(serverReducer, /pub fn set_livestock_breeding_reserve/);
assert.match(serverReducer, /pub fn set_livestock_haymaking_percent/);
assert.match(serverReducer, /breeding_reserve < minimum \|\| breeding_reserve > maximum/);
assert.match(
  serverTables,
  /pub struct PastureHerd \{[\s\S]{0,220}pub pasture_id: u64[\s\S]*last_wool_gold:[\s\S]*#\[default\(7u32\)\][\s\S]*breeding_reserve:[\s\S]*last_culled:[\s\S]*#\[default\(0\.0\)\][\s\S]*hay_stock:[\s\S]*last_hay_output:[\s\S]*#\[default\(0u8\)\][\s\S]*haymaking_percent:[\s\S]*#\[default\(0\.0\)\][\s\S]*last_wool_output:[\s\S]*#\[default\(0u32\)\][\s\S]*last_shearing_year:/,
  'migration-safe fields must remain on the pasture-keyed herd table',
);
assert.match(generatedHerd, /pastureId: __t\.u64\(\)\.primaryKey/);
assert.match(generatedHerd, /farmsteadId: __t\.u64\(\)/);
assert.match(generatedHerd, /breedingReserve/);
assert.match(generatedHerd, /lastCulled/);
assert.match(generatedHerd, /hayStock/);
assert.match(generatedHerd, /lastHayOutput/);
assert.match(generatedHerd, /haymakingPercent/);
assert.match(generatedHerd, /lastWoolOutput/);
assert.match(generatedHerd, /lastShearingYear/);
assert.match(serverSimulation, /herd\.last_shearing_year != clock\.year/);
assert.match(serverSimulation, /CommodityKind::Wool/);
assert.doesNotMatch(
  serverSimulation,
  /credit_treasury_gold/,
  'sheep fleece must enter physical storage rather than minting treasury gold',
);
assert.match(generatedReducer, /breedingReserve/);
assert.match(generatedHaymakingReducer, /haymakingPercent/);
assert.match(clientReducers, /setLivestockBreedingReserve/);
assert.match(clientReducers, /setLivestockHaymakingPercent/);
assert.ok(GAME_TABLE_SUBSCRIPTIONS.includes('pasture'));
assert.ok(GAME_TABLE_SUBSCRIPTIONS.includes('pasture_herd'));
assert.ok(!GAME_TABLE_SUBSCRIPTIONS.includes('livestock_herd'));
assert.match(pastureInspector, /data-livestock-breeding-reserve/);
assert.match(pastureInspector, /Spring births grow this pasture's healthy, supplied herd/);
assert.match(pastureInspector, /data-livestock-haymaking-percent/);
assert.match(pastureInspector, /Hay meadow/);
assert.match(pastureInspector, /stored for this herd and consumed before prepared Animal Feed in winter/);
assert.doesNotMatch(livestockInspector, /data-livestock-breeding-reserve|data-livestock-haymaking-percent/);
assert.match(livestockInspector, /Mixed livestock holding/);
assert.match(livestockInspector, /Shared herders, trough water, winter Animal Feed/);
assert.match(livestockInspector, /Pasture hay reserves/);
assert.match(livestockInspector, /Animal Feed store/);
assert.match(livestockInspector, /Feed workshop/);
assert.match(livestockInspector, /pigs do not consume raw oats/);
assert.match(livestockInspector, /data-processor-output-target/);
assert.match(livestockInspector, /LIVESTOCK_MILK_USE_PRESETS/);
assert.match(townHallInspector, /computeSettlementLivestockFodderPlan/);
assert.match(townHallInspector, /first winter Animal Feed shortfall/);
assert.match(townHallInspector, /Summer haymaking/);
assert.match(townHallInspector, /Winter hay coverage/);
assert.match(townHallInspector, /Winter Animal Feed/);
assert.match(townHallInspector, /Feed preparation/);
assert.match(townHallInspector, /Winter feeding logistics/);
assert.match(townHallInspector, /Cheese-making salt/);
assert.match(townHallInspector, /first cheese-making salt shortfall/);
assert.match(townHallInspector, /data-inspect-building/);
assert.match(settlementHud, /each unit provides only half a human meal/);
assert.match(settlementHud, /primary use is preparation into animal feed/);
assert.match(settlementHud, /Animal feed is not human food/);
assert.match(
  buildMenuCards,
  /pastoral_farmstead:[\s\S]{0,260}use hay before feed[\s\S]{0,160}prepare animal feed from oats[\s\S]{0,160}water stays separate/i,
);
assert.match(
  buildMenuCards,
  /swineherd:[\s\S]{0,240}woodland mast first[\s\S]{0,160}prepared animal feed[\s\S]{0,160}water is separate/i,
);
assert.match(
  buildMenuCards,
  /stable:[\s\S]{0,240}feed and water are abstracted[\s\S]{0,100}never draw herd hay or Animal Feed/i,
);
assert.match(
  stableInspector,
  /Upkeep[\s\S]{0,100}Feed and water are abstracted[\s\S]{0,100}never draw herd hay or Animal Feed/,
);
const oatsCrop = FARM_CROP_DEFINITIONS.oats;
assert.equal(oatsCrop.workSeason, 'spring');
assert.match(
  oatsCrop.calendarLabel,
  /light porridge staple or pastoral animal-feed grain/,
);

let checksum = 0;
const started = performance.now();
for (let index = 0; index < 100_000; index += 1) {
  checksum += projectedLivestockCullYield(
    index % 3 === 0 ? 'cattle' : index % 3 === 1 ? 'sheep' : 'swine',
    3 + index % 16,
    3 + index % 8,
  ).food;
}
const elapsed = performance.now() - started;
assert.ok(checksum > 0);
assert.ok(elapsed < 200, `100,000 herd policy projections took ${elapsed.toFixed(1)} ms`);

const stressBuildings = new Map<string, BuildingState>();
const stressHerds = new Map<string, LivestockHerdState>();
for (let index = 1; index <= 100_000; index += 1) {
  const id = `building-${index}`;
  stressBuildings.set(id, buildingFixture(id, 90));
  stressHerds.set(id, herdFixture(id));
}
const fodderStarted = performance.now();
const stressFodder = computeSettlementLivestockFodderPlan(
  { buildings: stressBuildings, livestockHerds: stressHerds },
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
const fodderElapsed = performance.now() - fodderStarted;
assert.equal(stressFodder.holdingCount, 100_000);
assert.equal(stressFodder.capacityLimitedHoldings, 0);
assert.ok(
  fodderElapsed < 1_000,
  `100,000-holding fodder aggregation took ${fodderElapsed.toFixed(1)} ms`,
);

console.log(
  `livestock reserve policy tests passed (${elapsed.toFixed(1)} ms policy; ${fodderElapsed.toFixed(1)} ms fodder for 100,000 herds)`,
);
