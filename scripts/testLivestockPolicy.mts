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
  livestockStoredFodderOatEquivalent,
  livestockStoredFodderValue,
  projectLivestockFodderHolding,
} from '../src/economy/livestockFodder.ts';
import {
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  BUILDING_STORAGE_CAPS,
  CATTLE_AREA_PER_HEAD,
  CATTLE_DEFAULT_BREEDING_RESERVE,
  CATTLE_BREEDING_PER_CYCLE,
  CATTLE_DAIRY_PRODUCTIVE_SHARE,
  CATTLE_FOOD_PER_CYCLE_PER_HEAD,
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
  LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
  LIVESTOCK_MASLIN_FODDER_VALUE,
  LIVESTOCK_OAT_FODDER_VALUE,
  LIVESTOCK_RYE_FODDER_VALUE,
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
  SWINE_BREEDING_PER_CYCLE,
  SWINE_AREA_PER_HEAD,
  SWINE_HEADS_PER_WORKER,
  SWINE_MAX_HERD,
  SWINE_MATURE_TREES_PER_HEAD,
  SWINE_STARTER_HERD,
  SWINE_FOOD_PER_CYCLE_PER_HEAD,
  SWINE_WATER_PER_HEAD_PER_CYCLE,
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
    grain,
    oatGrain: grain,
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
assert.ok(CATTLE_DEFAULT_BREEDING_RESERVE < CATTLE_MAX_HERD);
assert.ok(SHEEP_DEFAULT_BREEDING_RESERVE > CATTLE_DEFAULT_BREEDING_RESERVE);

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
      ? 1.25
      : month <= 2 || month === 12
        ? 0.6
        : 1;
    progress += heads * breedingPerCycle * cyclesPerDay * seasonalMultiplier;
    while (progress >= 1 && heads < maximumHeads) {
      heads += 1;
      progress -= 1;
    }
  }
  return heads;
}

assert.deepEqual(
  [
    fullySupportedHeadsAfterOneYear(
      CATTLE_STARTER_HERD,
      CATTLE_MAX_HERD,
      CATTLE_BREEDING_PER_CYCLE,
      7,
    ),
    fullySupportedHeadsAfterOneYear(
      SHEEP_STARTER_HERD,
      SHEEP_MAX_HERD,
      SHEEP_BREEDING_PER_CYCLE,
      7,
    ),
    fullySupportedHeadsAfterOneYear(
      SWINE_STARTER_HERD,
      SWINE_MAX_HERD,
      SWINE_BREEDING_PER_CYCLE,
      35 / 6,
    ),
  ],
  [7, 27, 21],
  'one fully supported year should grow herds meaningfully without filling every holding',
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
  livestockStoredFodderValue({ oatGrain: 10, ryeGrain: 5, maslinGrain: 5 }),
  10 * LIVESTOCK_OAT_FODDER_VALUE
    + 5 * LIVESTOCK_RYE_FODDER_VALUE
    + 5 * LIVESTOCK_MASLIN_FODDER_VALUE,
);
assert.equal(
  livestockStoredFodderOatEquivalent({ oatGrain: 10, ryeGrain: 5, maslinGrain: 5 }),
  17.6,
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
assert.equal(livestockCyclesPerCalendarDay(fodderBuilding, false), 7);
assert.equal(livestockCyclesPerCalendarDay(fodderBuilding, true), 7);
assert.equal(
  livestockCyclesPerCalendarDay(buildingFixture('building-0', 0, 0), true),
  7,
  'animal needs continue when a holding is unstaffed or observes Sabbath',
);
assert.equal(
  livestockCyclesPerCalendarDay(buildingFixture('building-2', 0, 2), false),
  7,
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
assert.ok(Math.abs(fodderPlan.winterGrainPerDay - 1.68) < 1e-9);
assert.ok(
  Math.abs(
    fodderPlan.winterGrainNeed
      - fodderPlan.winterGrainPerDay * LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
  ) < 1e-9,
);
assert.ok(Math.abs(fodderPlan.winterReserveTarget - 50.4) < 1e-9);
assert.ok(Math.abs(fodderPlan.winterReserveStock - 50.4) < 1e-9);
assert.equal(fodderPlan.winterReserveShortfall, 0);
assert.ok(Math.abs(fodderPlan.productiveHeads - 7.2) < 1e-9);
assert.ok(Math.abs(fodderPlan.dairyPreservedFoodPerDay - 3.024) < 1e-9);
assert.ok(Math.abs(fodderPlan.dairySaltPerDay - 0.378) < 1e-9);
assert.equal(
  fodderPlan.dairySaltTarget,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE * 3,
);
assert.equal(fodderPlan.dairySaltShortfall, fodderPlan.dairySaltTarget);
assert.equal(fodderPlan.dairySaltRunwayDays, 0);
assert.equal(fodderPlan.winterGrainNeed, fodderPlan.winterReserveTarget);

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
      - 3.5 * CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE * 7,
  ) < 1e-9,
);
assert.equal(summerPlan.haymakingDaysRemaining, 90);
assert.ok(Math.abs(summerPlan.projectedHayStock - 165.375) < 1e-9);
assert.equal(summerPlan.winterHayNeed, 63);
assert.equal(
  summerPlan.winterGrainNeed,
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
assert.equal(
  twoWorkerSummerPlan.dairyPreservedFoodPerDay,
  summerPlan.dairyPreservedFoodPerDay,
  'workers may cut more hay but must not accelerate milk cycles',
);
assert.equal(twoWorkerSummerPlan.winterGrainNeed, summerPlan.winterGrainNeed);

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
  { ...fodderHerd, hayStock: 63 },
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(
  hayFedAutumnPlan.winterHayNeed,
  hayFedAutumnPlan.hayStock,
  'a complete local hay reserve should cover the 30-day unsupported-head forecast',
);
assert.equal(hayFedAutumnPlan.winterGrainNeed, 0);
assert.equal(hayFedAutumnPlan.winterReserveTarget, 0);
assert.ok(CATTLE_HAY_PER_UNSUPPORTED_HEAD > 0);

const firstShortState = {
  buildings: new Map([
    ['building-10', buildingFixture('building-10', 0)],
    ['building-2', buildingFixture('building-2', 0)],
    ['building-1', buildingFixture('building-1', 90)],
  ]),
  livestockHerds: new Map([
    ['building-10', herdFixture('building-10')],
    ['building-2', herdFixture('building-2')],
    ['building-1', herdFixture('building-1')],
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
  100.8,
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
const generatedHerd = fs.readFileSync('src/generated/livestock_herd_table.ts', 'utf8');
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
const townHallInspector = fs.readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);

assert.match(serverPolicy, /pub fn can_cull_one/);
assert.match(serverPolicy, /pub fn projected_winter_fodder_grain/);
assert.match(serverPolicy, /pub fn is_haymaking_month/);
assert.match(serverPolicy, /pub fn is_shearing_month/);
assert.match(serverPolicy, /pub fn haymaking_share/);
assert.match(serverPolicy, /pub fn essential_livestock_care_labor/);
assert.match(serverPolicy, /food_room[\s\S]*slaughter_food_per_head/);
assert.match(serverSimulation, /herd\.head_count -= 1/);
assert.match(serverSimulation, /herd\.last_culled = 1/);
assert.match(serverSimulation, /species_slaughter_yields/);
assert.match(
  serverSimulation,
  /immediate_grain_buffer\.max\(winter_grain_target\)/,
  'winter reserves must extend, not replace, the immediate fallback buffer',
);
assert.match(serverSimulation, /herd\.hay_stock/);
assert.match(serverSimulation, /is_haymaking_month/);
assert.match(
  serverSimulation,
  /herd\.hay_stock \+ 1e-6 < LIVESTOCK_HAY_STORAGE_CAPACITY/,
  'a full hayloft must release reserved meadow back to grazing',
);
assert.match(
  serverSimulation,
  /let hay_supplement[\s\S]*herd\.hay_stock = [\s\S]*let grain_unsupported/,
  'winter feeding must consume local hay before emergency grain',
);
assert.match(
  serverSimulation,
  /CommodityKind::OatGrain,[\s\S]{0,120}&\["threshing_barn", "granary"\]/,
  'winter reserve must use the existing seed- and reserve-protected grain logistics',
);
assert.match(
  serverSimulation,
  /head_count < breeding_limit[\s\S]*breeding_progress \+= [\s\S]*else[\s\S]*breeding_progress = herd\.breeding_progress\.min\(0\.999\)/,
  'full herds must not bank an unlimited queue of replacement births',
);
assert.match(
  serverSimulation,
  /store_salted_farmstead_output[\s\S]*CommodityKind::Salt[\s\S]*LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT/,
  'farmhouse preserved output must withdraw physical salt',
);
assert.match(serverSimulation, /livestock_milk_allocation/);
assert.match(serverSimulation, /species_dairy_productive_share/);
assert.match(serverSimulation, /gross_milk - stored_cheese/);
assert.match(
  serverSimulation,
  /let care_labor = essential_livestock_care_labor[\s\S]{0,260}let productive_labor = if paused \{ 0 \} else \{ onsite_labor \}/,
  'Sabbath must pause haymaking and slaughter without withdrawing essential herd care',
);
assert.match(serverDeliveryTrips, /local_milk_sale[\s\S]*FOOD_SALE_GOLD_PER_UNIT/);
assert.match(serverDeliveryTrips, /credit_settlement_household_income/);
assert.match(
  serverSimulation,
  /unsalted_slaughter[\s\S]*CommodityKind::Meat/,
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
  /last_wool_gold:[\s\S]*#\[default\(7u32\)\][\s\S]*breeding_reserve:[\s\S]*last_culled:[\s\S]*#\[default\(0\.0\)\][\s\S]*hay_stock:[\s\S]*last_hay_output:[\s\S]*#\[default\(0u8\)\][\s\S]*haymaking_percent:[\s\S]*#\[default\(0\.0\)\][\s\S]*last_wool_output:[\s\S]*#\[default\(0u32\)\][\s\S]*last_shearing_year:/,
  'migration-safe fields must remain appended to the herd table',
);
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
assert.ok(GAME_TABLE_SUBSCRIPTIONS.includes('livestock_herd'));
assert.match(livestockInspector, /data-livestock-breeding-reserve/);
assert.match(livestockInspector, /October and November/);
assert.match(livestockInspector, /whole animal/);
assert.match(livestockInspector, /Winter grain reserve/);
assert.match(livestockInspector, /Winter resupply/);
assert.match(livestockInspector, /data-livestock-haymaking-percent/);
assert.match(livestockInspector, /Summer hay meadow/);
assert.match(livestockInspector, /Hayloft/);
assert.match(livestockInspector, /Cheese salt/);
assert.match(livestockInspector, /fresh milk continues/);
assert.match(livestockInspector, /data-processor-output-target/);
assert.match(livestockInspector, /LIVESTOCK_MILK_USE_PRESETS/);
assert.match(livestockInspector, /builds household wealth/);
assert.match(townHallInspector, /computeSettlementLivestockFodderPlan/);
assert.match(townHallInspector, /first winter fodder shortfall/);
assert.match(townHallInspector, /Summer hay plan/);
assert.match(townHallInspector, /Winter hay reserve/);
assert.match(townHallInspector, /Cheese-making salt/);
assert.match(townHallInspector, /first cheese-making salt shortfall/);
assert.match(townHallInspector, /data-inspect-building/);

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
