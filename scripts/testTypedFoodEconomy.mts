import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FOOD_MEAL_VALUES,
  NAMED_FOOD_KINDS,
  foodCategory,
  foodCategoryQualifyingStock,
  foodProgressionStatus,
  foodMealValue,
  foodSpoilageMultiplier,
  foodVarietyCount,
  edibleFoodStock,
  edibleFoodMealEquivalents,
  freshFoodStock,
  freshFoodMealEquivalents,
  preservableFoodStock,
  preservedFoodStock,
  preservedFoodMealEquivalents,
} from '../src/economy/foodInventory.ts';
import {
  cargoKindFromId,
  cargoKindLabel,
  type DeliveryTripState,
} from '../src/logistics/deliveryTrips.ts';
import { processorInputCommodityStock } from '../src/logistics/processorInputLogistics.ts';
import { computeInTransitResourceTotals } from '../src/resources/resourceTotals.ts';
import { MARKET_COMMODITIES } from '../src/generated/gameBalance.ts';

const pantry = {
  ryeBread: 4,
  meat: 3,
  fish: 2,
  milk: 1,
  apples: 5,
  curedMeat: 6,
  smokedFish: 7,
  cheese: 8,
  honey: 9,
};
assert.equal(freshFoodStock(pantry), 15);
assert.equal(preservableFoodStock(pantry), 6);
assert.equal(preservedFoodStock(pantry), 21);
assert.equal(edibleFoodStock(pantry), 45);
assert.equal(freshFoodMealEquivalents(pantry), 15);
assert.equal(preservedFoodMealEquivalents(pantry), 21);
assert.equal(edibleFoodMealEquivalents(pantry), 45);
assert.equal(foodMealValue('honey'), 1);
assert.equal(foodMealValue('apples'), 1);
assert.equal(
  foodMealValue('oatGrain'),
  0.5,
  'raw oats remain edible, but two physical units are required for one human meal',
);
for (const [kind, value] of Object.entries(FOOD_MEAL_VALUES)) {
  assert.equal(
    value,
    kind === 'oatGrain' ? 0.5 : 1,
    `${kind} must retain its intentional household meal value`,
  );
}
assert.equal(
  edibleFoodMealEquivalents({ meat: 49, berries: 20, fish: 27 }),
  96,
  'mixed ready-to-eat stock must be counted by physical units without nutrition weighting',
);
assert.equal(foodSpoilageMultiplier('honey'), 0);
assert.ok(foodSpoilageMultiplier('milk') > foodSpoilageMultiplier('apples'));
assert.equal(NAMED_FOOD_KINDS.length, 25);
assert.equal(foodCategory('apples'), 'fruits');
assert.equal(foodCategory('pears'), 'fruits');
assert.equal(foodCategory('cherries'), 'fruits');
assert.equal(foodCategory('vegetables'), 'vegetables');
assert.equal(foodCategory('cabbage'), 'vegetables');
assert.equal(foodCategory('carrots'), 'vegetables');
assert.equal(foodCategory('beetroot'), 'vegetables');
assert.equal(foodCategory('aronia'), 'foraged');
assert.equal(foodCategory('rosehips'), 'foraged');
assert.equal(foodCategory('aroniaJam'), 'foraged');
assert.equal(foodCategory('rosehipJam'), 'foraged');
assert.equal(foodCategory('milk'), 'animalProduce');
assert.equal(foodCategory('cheese'), 'animalProduce');
assert.equal(
  foodVarietyCount({ apples: 2, cherries: 2, vegetables: 3, milk: 1, cheese: 1 }, 1),
  3,
  'close substitutes must not inflate household variety',
);
assert.equal(
  foodVarietyCount({ cabbage: 2, carrots: 2, beetroot: 2 }, 1),
  1,
  'separate vegetable commodities remain one dietary category',
);
assert.equal(
  foodVarietyCount({ aronia: 2, rosehips: 2, aroniaJam: 2, rosehipJam: 2 }, 1),
  1,
  'fresh and preserved hedgerow fruit remain one dietary category',
);
assert.ok(Math.abs(foodCategoryQualifyingStock(1) - 1 / 3) < 1e-9);
assert.ok(Math.abs(foodCategoryQualifyingStock(6) - 2) < 1e-9);
assert.equal(
  foodVarietyCount({ vegetables: 0.3 }, 1),
  0,
  'a token amount must not qualify a category',
);
assert.equal(
  foodVarietyCount({ vegetables: 0.4 }, 1),
  1,
  'vegetables must qualify as their own category once a full household-day is stocked',
);
assert.equal(
  foodVarietyCount({ milk: 0.63, cheese: 0.5 }, 1),
  1,
  'close substitutes may combine to qualify their one shared category',
);
assert.deepEqual(
  foodProgressionStatus({ ryeBread: 2, vegetables: 2, apples: 2 }, 1, 3).satisfiedSlots,
  ['grains', 'produceAndForage'],
  'three crop and forage categories must not masquerade as a balanced tier-three diet',
);
assert.deepEqual(
  foodProgressionStatus({ ryeBread: 2, meat: 2, fish: 2 }, 1, 3).satisfiedSlots,
  ['grains', 'animalFoods', 'fish'],
  'tier-three balance requires crops/forage, animal foods, and fish',
);
assert.deepEqual(
  foodProgressionStatus({ milk: 2, cheese: 2, meat: 2 }, 1, 3).satisfiedSlots,
  ['animalFoods'],
  'animal produce and meat remain one broad tier-three diet group',
);
const tierFourBase = { ryeBread: 2, vegetables: 2, fish: 2 };
const tierFourEggs = foodProgressionStatus({ ...tierFourBase, eggs: 2 }, 1, 4);
assert.equal(tierFourEggs.missingSlots.includes('animalProduce'), false);
assert.equal(tierFourEggs.missingSlots.includes('meat'), true);
const tierFourPork = foodProgressionStatus({ ...tierFourBase, meat: 2 }, 1, 4);
assert.equal(tierFourPork.missingSlots.includes('animalProduce'), true);
assert.equal(tierFourPork.missingSlots.includes('meat'), false);
assert.equal(
  foodProgressionStatus({ ...tierFourBase, eggs: 2, meat: 2 }, 1, 4).ready,
  true,
  'tier four should require animal produce and meat as distinct food goals',
);
assert.deepEqual(
  Object.fromEntries(MARKET_COMMODITIES.map((offer) => [offer.id, offer.resourceKind])),
  {
    buy_pork: 'curedMeat',
    buy_lamb: 'meat',
    buy_veal: 'meat',
    buy_kobasica: 'curedMeat',
    buy_cheese: 'cheese',
  },
);

const typedCargoKinds = [
  [4, 'pears'],
  [5, 'aronia'],
  [27, 'rosehips'],
  [28, 'meat'],
  [29, 'fish'],
  [30, 'berries'],
  [31, 'mushrooms'],
  [32, 'milk'],
  [33, 'apples'],
  [34, 'cherries'],
  [35, 'vegetables'],
  [36, 'eggs'],
  [37, 'grapes'],
  [38, 'cabbage'],
  [39, 'curedMeat'],
  [40, 'smokedFish'],
  [41, 'cheese'],
  [50, 'carrots'],
  [53, 'beetroot'],
  [57, 'pearCider'],
  [61, 'aroniaJam'],
  [62, 'rosehipJam'],
] as const;
for (const [id, kind] of typedCargoKinds) {
  assert.equal(cargoKindFromId(id), kind, `cargo id ${id} must remain ${kind}`);
  assert.notEqual(cargoKindLabel(kind), 'Food');
}
for (const [id, kind] of [
  [42, 'ryeSheaves'], [43, 'oatSheaves'], [44, 'barleySheaves'], [45, 'maslinSheaves'],
  [46, 'ryeGrain'], [47, 'oatGrain'], [48, 'maslinGrain'],
  [49, 'ryeFlour'], [51, 'maslinFlour'],
  [52, 'ryeBread'], [54, 'maslinBread'],
] as const) {
  assert.equal(cargoKindFromId(id), kind);
  assert.notEqual(cargoKindLabel(kind), 'Food');
}
assert.equal(cargoKindFromId(63), 'animalFeed');
assert.equal(cargoKindLabel('animalFeed'), 'Animal feed');

const trip = (
  id: string,
  cargoKind: DeliveryTripState['cargoKind'],
  amount: number,
): DeliveryTripState => ({
  id,
  buildingId: 'source',
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: 'target',
  cargoKind,
  amount,
  phase: 'outbound',
  x: 0,
  z: 0,
  progress: 0,
  speedMps: 1,
  unloadSeconds: 1,
  unloadRemaining: 1,
  deliveryWorkers: 1,
  freeHaulerWorkers: 0,
  pathDistance: 1,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
});
const transit = computeInTransitResourceTotals([
  trip('oats', 'oatGrain', 5),
  trip('animal-feed', 'animalFeed', 7),
  trip('rye-bread', 'ryeBread', 10),
  trip('meat', 'meat', 4),
  trip('cheese', 'cheese', 3),
  trip('honey', 'honey', 2),
]);
assert.equal(transit.oatGrain, 5);
assert.equal(transit.animalFeed, 7);
assert.equal(transit.ryeBread, 10);
assert.equal(transit.meat, 4);
assert.equal(transit.cheese, 3);
assert.equal(transit.preservedFood, 3);
assert.equal(
  transit.food,
  21.5,
  'in-transit food totals must count oats at half a meal and exclude Animal Feed entirely',
);

assert.equal(processorInputCommodityStock(pantry, 'food'), 6);
assert.equal(processorInputCommodityStock(pantry, 'preservedFood'), 21);

const commoditiesSource = readFileSync(
  'server/src/economy/commodities.rs',
  'utf8',
);
const supplyPolicySource = readFileSync(
  'server/src/supply_policy.rs',
  'utf8',
);
assert.match(commoditiesSource, /Self::Meat => Some\(Self::CuredMeat\)/);
assert.match(commoditiesSource, /Self::Fish => Some\(Self::SmokedFish\)/);
assert.match(commoditiesSource, /Self::Milk => Some\(Self::Cheese\)/);
assert.match(
  commoditiesSource,
  /pub fn meal_value[\s\S]*Self::RosehipJam => 1\.0,[\s\S]*Self::OatGrain => OAT_GRAIN_MEAL_VALUE,[\s\S]*_ => 0\.0/,
  'the server must make oats the sole half-meal edible commodity and reject non-food goods',
);
assert.match(
  supplyPolicySource,
  /pub const OAT_GRAIN_MEAL_VALUE: f64 = 0\.5/,
  'client oat nutrition must remain in parity with the authoritative server policy',
);
const economySource = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
const tradeResourcesSource = readFileSync(
  'server/src/economy/trade_resources.rs',
  'utf8',
);
const nightCycleSource = readFileSync(
  'server/src/simulation/night_cycle.rs',
  'utf8',
);
assert.match(economySource, /CommodityKind::RyeBread/);
assert.doesNotMatch(economySource, /CommodityKind::OatBread|CommodityKind::OatFlour/);
assert.match(economySource, /CommodityKind::MaslinBread/);
assert.match(economySource, /kind == "smokehouse" && commodity\.is_preserved_food\(\)/);
assert.match(tradeResourcesSource, /CommodityKind::Meat => TradeResource::Meat/);
assert.match(tradeResourcesSource, /CommodityKind::CuredMeat => TradeResource::CuredMeat/);
assert.match(tradeResourcesSource, /CommodityKind::Cheese => TradeResource::Cheese/);
assert.match(nightCycleSource, /monthly tier slots are the single authoritative household food/);
assert.doesNotMatch(nightCycleSource, /withdraw_residence_(?:fresh|preserved)_food/);
assert.doesNotMatch(nightCycleSource, /take_need_stock/);

console.log('Typed food identity, cargo, aggregation, and preservation tests passed.');
