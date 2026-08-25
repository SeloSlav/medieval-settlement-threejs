import assert from 'node:assert/strict';
import {
  BUILDING_DEFINITIONS,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  FISH_PER_HARVEST,
  GAME_ANIMALS_PER_HARVEST,
  GAME_PER_HARVEST,
  LODGE_FIREWOOD_PER_CYCLE,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  householdFirewoodUnitsPerDay,
  householdFirewoodUnitsPerMonth,
  householdFoodUnitsPerDayForTier,
  householdFoodUnitsPerMonthForTier,
  residenceFoodRequirementSlots,
} from '../src/economy/householdBillDemand.ts';
import { computeSettlementFirewoodPlan } from '../src/economy/settlementFirewood.ts';
import { computeSettlementProvisioning } from '../src/economy/settlementProvisioning.ts';
import {
  residenceFirewoodPriorityTarget,
  residenceFirewoodRunwayDays,
} from '../src/logistics/firewoodLogistics.ts';
import { computeResourceTotals } from '../src/resources/resourceTotals.ts';
import type { GameState, ResidenceState } from '../src/resources/types.ts';

const closeTo = (actual: number, expected: number, message: string): void => {
  assert.ok(
    Math.abs(actual - expected) <= 1e-9,
    `${message}: expected ${expected}, received ${actual}`,
  );
};

assert.deepEqual(
  ([0, 1, 2, 3, 4] as const).map(residenceFoodRequirementSlots),
  [0, 1, 2, 4, 5],
  'client tier slots must mirror the authoritative monthly food bills',
);
assert.deepEqual(
  ([0, 1, 2, 3, 4] as const).map(householdFoodUnitsPerMonthForTier),
  [0, 1, 2, 4, 5],
  'each tier slot must cost one whole food unit per month',
);
closeTo(householdFoodUnitsPerDayForTier(1), 1 / 30, 'Tier 1 daily food forecast');
closeTo(householdFoodUnitsPerDayForTier(4), 5 / 30, 'Tier 4 daily food forecast');
closeTo(householdFirewoodUnitsPerMonth(), 1, 'ordinary monthly firewood forecast');
closeTo(householdFirewoodUnitsPerMonth(2), 2, 'winter monthly firewood forecast');
closeTo(householdFirewoodUnitsPerDay(1), 1 / 30, 'ordinary daily firewood forecast');
closeTo(householdFirewoodUnitsPerDay(2), 2 / 30, 'winter daily firewood forecast');
assert.equal(householdFirewoodUnitsPerDay(-1), 0);
assert.equal(householdFirewoodUnitsPerDay(Number.NaN), 0);

const smallHousehold = residence('small-household', 1, 1, 0);
smallHousehold.needs.firewood.stock = 1;
const largeHousehold = residence('large-household', 1, 10, 1);
largeHousehold.needs.firewood.stock = 1;
closeTo(
  residenceFirewoodRunwayDays(smallHousehold) ?? -1,
  30,
  'one fuel unit must cover a one-person household for one month',
);
closeTo(
  residenceFirewoodRunwayDays(largeHousehold) ?? -1,
  30,
  'one fuel unit must cover a ten-person household for the same month',
);
assert.equal(residenceFirewoodPriorityTarget(0), 0);
assert.equal(residenceFirewoodPriorityTarget(1), 1);
assert.equal(residenceFirewoodPriorityTarget(10), 1);

const populationIndependentFuelState = emptyGameState();
populationIndependentFuelState.residences.set(smallHousehold.id, smallHousehold);
populationIndependentFuelState.residences.set(largeHousehold.id, largeHousehold);
const populationIndependentFuelPlan = computeSettlementFirewoodPlan(
  populationIndependentFuelState,
  false,
  () => 'shared-road',
);
assert.equal(populationIndependentFuelPlan.heatedHouseholds, 2);
closeTo(
  populationIndependentFuelPlan.winterHouseholdDemandPerDay,
  4 / 30,
  'settlement winter fuel demand must count households instead of residents',
);

const sixHomeState = emptyGameState();
for (let index = 0; index < 6; index += 1) {
  const home = residence(`tier-1-${index}`, 1, 3, index);
  home.food = 12;
  home.needs.food.stock = 12;
  home.needs.firewood.stock = 12;
  sixHomeState.residences.set(home.id, home);
}
const sixHomeProvisioning = computeSettlementProvisioning({
  state: sixHomeState,
  totals: computeResourceTotals(sixHomeState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: () => 'shared-road',
});

assert.equal(sixHomeProvisioning.foodConsumers, 18);
assert.equal(sixHomeProvisioning.heatedResidents, 18);
closeTo(
  sixHomeProvisioning.grossHouseholdFoodPerDay,
  6 / 30,
  'six Tier 1 household food demand',
);
closeTo(
  sixHomeProvisioning.foodRunwayWithoutSpoilageDays,
  360,
  '72 food should cover six Tier 1 households for one year',
);
closeTo(
  sixHomeProvisioning.currentFirewoodPerDay,
  6 / 30,
  'six-household ordinary firewood demand',
);
closeTo(
  sixHomeProvisioning.currentFirewoodRunwayDays,
  360,
  '72 firewood should cover six households for one ordinary year',
);
closeTo(
  sixHomeProvisioning.winterFirewoodPerDay,
  12 / 30,
  'six-household winter firewood demand',
);
closeTo(
  sixHomeProvisioning.winterFirewoodRunwayDays,
  180,
  '72 firewood should cover six households for six winter months',
);
closeTo(
  sixHomeProvisioning.roadBranches?.worstFoodRunwayDays ?? -1,
  360,
  'road-branch food runway must use monthly household bills',
);
closeTo(
  sixHomeProvisioning.roadBranches?.worstWinterFirewoodRunwayDays ?? -1,
  180,
  'road-branch fuel runway must use monthly household bills',
);

const summerSixHomeProvisioning = computeSettlementProvisioning({
  state: sixHomeState,
  totals: computeResourceTotals(sixHomeState),
  currentFirewoodDemandMultiplier: 0.7,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
});
closeTo(
  summerSixHomeProvisioning.currentFirewoodPerDay,
  6 * 0.7 / 30,
  'current-season multiplier must scale household fuel forecasts',
);

const monthlyReadinessState = emptyGameState();
const underfilledTierFour = residence('underfilled-tier-4', 4, 2, 0);
underfilledTierFour.food = 1;
underfilledTierFour.needs.food.stock = 1;
underfilledTierFour.needs.firewood.stock = 0.5;
monthlyReadinessState.residences.set(underfilledTierFour.id, underfilledTierFour);
const monthlyReadiness = computeSettlementProvisioning({
  state: monthlyReadinessState,
  totals: computeResourceTotals(monthlyReadinessState),
  currentFirewoodDemandMultiplier: 0.7,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
});
assert.equal(
  monthlyReadiness.householdBufferFoodShortHomes,
  1,
  'Tier 4 readiness requires its full five-unit monthly food bill',
);
assert.equal(
  monthlyReadiness.householdBufferFirewoodShortHomes,
  1,
  'fuel readiness requires one whole monthly unit in every season',
);

const screenshotState = emptyGameState();
screenshotState.stockpile.food = 193;
screenshotState.stockpile.firewood = 55;
for (let index = 0; index < 6; index += 1) {
  const home = residence(`screenshot-tier-1-${index}`, 1, 3, index);
  screenshotState.residences.set(home.id, home);
}
const screenshotProvisioning = computeSettlementProvisioning({
  state: screenshotState,
  totals: computeResourceTotals(screenshotState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: () => 'screenshot-road',
});
closeTo(
  screenshotProvisioning.foodRunwayWithoutSpoilageDays,
  965,
  '193 food must cover six Tier 1 homes for more than 32 months before spoilage',
);
closeTo(
  screenshotProvisioning.currentFirewoodRunwayDays,
  275,
  '55 fuel must cover six Tier 1 homes for more than nine ordinary months',
);
closeTo(
  screenshotProvisioning.winterFirewoodRunwayDays,
  137.5,
  '55 fuel must still cover six Tier 1 homes for more than four winter months',
);

const mixedFoodState = emptyGameState();
mixedFoodState.stockpile.meat = 49;
mixedFoodState.stockpile.berries = 20;
mixedFoodState.stockpile.fish = 27;
for (let index = 0; index < 6; index += 1) {
  const home = residence(`mixed-food-tier-1-${index}`, 1, 3, index);
  mixedFoodState.residences.set(home.id, home);
}
const mixedFoodProvisioning = computeSettlementProvisioning({
  state: mixedFoodState,
  totals: computeResourceTotals(mixedFoodState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
});
closeTo(
  mixedFoodProvisioning.usableFoodStock,
  96,
  '49 meat + 20 berries + 27 fish must contribute 96 physical units to the runway numerator',
);
closeTo(
  mixedFoodProvisioning.foodRunwayWithoutSpoilageDays,
  480,
  'mixed foods must use the same one-unit household ration policy as the server',
);

const workSecondsPerDay = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;
const sabbathAdjustedWorkFraction = 6 / 7;
const fishing = BUILDING_DEFINITIONS.fishing_camp;
const hunting = BUILDING_DEFINITIONS.hunters_hall;
const lodge = BUILDING_DEFINITIONS.woodcutters_lodge;
const fullFishingOutputPerDay = fishing.maxLabor
  * FISH_PER_HARVEST
  * workSecondsPerDay
  / fishing.harvestInterval
  * sabbathAdjustedWorkFraction;
const fullHuntingOutputPerDay = hunting.maxLabor
  * GAME_ANIMALS_PER_HARVEST
  * GAME_PER_HARVEST
  * workSecondsPerDay
  / hunting.harvestInterval
  * sabbathAdjustedWorkFraction;
const fullLodgeOutputPerDay = lodge.maxLabor
  * LODGE_FIREWOOD_PER_CYCLE
  * workSecondsPerDay
  / lodge.harvestInterval
  * sabbathAdjustedWorkFraction;
const sixHomeDemandPerDay = 6 / 30;
assert.ok(
  fullFishingOutputPerDay > sixHomeDemandPerDay * 3,
  'one fully staffed fishing camp must create a strong long-run food surplus for six homes',
);
assert.ok(
  fullHuntingOutputPerDay > sixHomeDemandPerDay * 3,
  'one fully staffed hunting camp must create a strong long-run food surplus for six homes',
);
assert.ok(
  fullLodgeOutputPerDay > sixHomeDemandPerDay * 3,
  'one fully staffed woodcutter lodge must create a strong long-run fuel surplus for six homes',
);

const mixedTierState = emptyGameState();
for (const [id, tier, population] of [
  ['tier-1-large', 1, 10],
  ['tier-2-small', 2, 1],
  ['tier-3-medium', 3, 4],
  ['tier-4-small', 4, 2],
] as const) {
  const home = residence(id, tier, population, tier);
  home.food = 30;
  home.needs.food.stock = 30;
  home.needs.firewood.stock = 30;
  mixedTierState.residences.set(home.id, home);
}
const mixedTierProvisioning = computeSettlementProvisioning({
  state: mixedTierState,
  totals: computeResourceTotals(mixedTierState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: () => 'mixed-road',
});

assert.equal(mixedTierProvisioning.foodConsumers, 17);
assert.equal(mixedTierProvisioning.heatedResidents, 17);
closeTo(
  mixedTierProvisioning.grossHouseholdFoodPerDay,
  (1 + 2 + 4 + 5) / 30,
  'mixed-tier food demand must follow tier slots instead of population',
);
closeTo(
  mixedTierProvisioning.householdPreservedFoodRotationTargetPerDay,
  1 / 30,
  'one Tier 4 household must rotate one preserved slot per month',
);
closeTo(
  mixedTierProvisioning.foodRunwayWithoutSpoilageDays,
  300,
  'mixed-tier aggregate food runway',
);
closeTo(
  mixedTierProvisioning.currentFirewoodPerDay,
  4 / 30,
  'fuel demand must count occupied heated households instead of residents',
);
closeTo(
  mixedTierProvisioning.roadBranches?.worstFoodRunwayDays ?? -1,
  300,
  'mixed-tier road-branch food runway',
);
closeTo(
  mixedTierProvisioning.roadBranches?.worstWinterFirewoodRunwayDays ?? -1,
  450,
  'mixed-tier road-branch winter fuel runway',
);

assert.equal(WINTER_FIREWOOD_DEMAND_MULTIPLIER, 2);

console.log('household supply runway parity tests passed');

function residence(
  id: string,
  tier: ResidenceState['tier'],
  population: number,
  x: number,
): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: population,
    tier,
    settlementTicks: 0,
    needs: {
      firewood: { stock: 0, deficitSeconds: 0 },
      water: { stock: 0, deficitSeconds: 0 },
      food: { stock: 0, deficitSeconds: 0 },
      preservedFood: { stock: 0, deficitSeconds: 0 },
      ale: { stock: 0, deficitSeconds: 0 },
      cloth: { stock: 0, deficitSeconds: 0 },
      pottery: { stock: 0, deficitSeconds: 0 },
    },
    food: 0,
    preservedFood: 0,
    abandoned: false,
    householdWealth: 0,
  };
}

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: {
      timber: 0,
      stone: 0,
      firewood: 0,
      water: 0,
      game: 0,
      berries: 0,
      mushrooms: 0,
      fish: 0,
      food: 0,
      grain: 0,
      flour: 0,
      ale: 0,
      preservedFood: 0,
      honey: 0,
      wine: 0,
      polearms: 0,
      gold: 0,
    },
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}
