import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NAMED_FOOD_KINDS,
  foodCategory,
  foodCategoryQualifyingStock,
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
assert.ok(Math.abs(freshFoodMealEquivalents(pantry) - 13.05) < 1e-9);
assert.ok(Math.abs(preservedFoodMealEquivalents(pantry) - 21.45) < 1e-9);
assert.ok(Math.abs(edibleFoodMealEquivalents(pantry) - 45.3) < 1e-9);
assert.equal(foodMealValue('honey'), 1.2);
assert.equal(foodMealValue('apples'), 0.6);
assert.equal(foodSpoilageMultiplier('honey'), 0);
assert.ok(foodSpoilageMultiplier('milk') > foodSpoilageMultiplier('apples'));
assert.equal(NAMED_FOOD_KINDS.length, 18);
assert.equal(foodCategory('apples'), 'fruits');
assert.equal(foodCategory('cherries'), 'fruits');
assert.equal(foodCategory('vegetables'), 'vegetables');
assert.equal(foodCategory('milk'), 'animalProduce');
assert.equal(foodCategory('cheese'), 'animalProduce');
assert.equal(
  foodVarietyCount({ apples: 2, cherries: 2, vegetables: 3, milk: 1, cheese: 1 }, 1),
  3,
  'close substitutes must not inflate household variety',
);
assert.ok(Math.abs(foodCategoryQualifyingStock(1) - 1 / 3) < 1e-9);
assert.ok(Math.abs(foodCategoryQualifyingStock(6) - 2) < 1e-9);
assert.equal(
  foodVarietyCount({ vegetables: 0.4 }, 1),
  0,
  'a token amount must not qualify a category',
);
assert.equal(
  foodVarietyCount({ vegetables: 0.5 }, 1),
  1,
  'vegetables must qualify as their own category once a full household-day is stocked',
);
assert.equal(
  foodVarietyCount({ milk: 0.63, cheese: 0.5 }, 1),
  1,
  'close substitutes may combine to qualify their one shared category',
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
  [39, 'curedMeat'],
  [40, 'smokedFish'],
  [41, 'cheese'],
] as const;
for (const [id, kind] of typedCargoKinds) {
  assert.equal(cargoKindFromId(id), kind, `cargo id ${id} must remain ${kind}`);
  assert.notEqual(cargoKindLabel(kind), 'Food');
}
assert.equal(cargoKindFromId(27), null, 'removed generic bread id remains vacant');
assert.equal(cargoKindFromId(38), null, 'removed porridge id remains vacant');
assert.equal(cargoKindFromId(50), null, 'removed oat flour id remains vacant');
assert.equal(cargoKindFromId(53), null, 'removed oat bread id remains vacant');
for (const [id, kind] of [
  [42, 'ryeSheaves'], [43, 'oatSheaves'], [44, 'barleySheaves'], [45, 'maslinSheaves'],
  [46, 'ryeGrain'], [47, 'oatGrain'], [48, 'maslinGrain'],
  [49, 'ryeFlour'], [51, 'maslinFlour'],
  [52, 'ryeBread'], [54, 'maslinBread'],
] as const) {
  assert.equal(cargoKindFromId(id), kind);
  assert.notEqual(cargoKindLabel(kind), 'Food');
}

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
  trip('rye-bread', 'ryeBread', 10),
  trip('meat', 'meat', 4),
  trip('cheese', 'cheese', 3),
  trip('honey', 'honey', 2),
]);
assert.equal(transit.ryeBread, 10);
assert.equal(transit.meat, 4);
assert.equal(transit.cheese, 3);
assert.ok(Math.abs(transit.preservedFood - 2.7) < 1e-9);
assert.ok(Math.abs(transit.food - 19.5) < 1e-9);

assert.equal(processorInputCommodityStock(pantry, 'food'), 6);
assert.equal(processorInputCommodityStock(pantry, 'preservedFood'), 21);

const commoditiesSource = readFileSync(
  'server/src/economy/commodities.rs',
  'utf8',
);
assert.match(commoditiesSource, /Self::Meat => Some\(Self::CuredMeat\)/);
assert.match(commoditiesSource, /Self::Fish => Some\(Self::SmokedFish\)/);
assert.match(commoditiesSource, /Self::Milk => Some\(Self::Cheese\)/);
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
assert.match(nightCycleSource, /withdraw_residence_fresh_food\(&mut current, meal_due\)/);
assert.match(nightCycleSource, /withdraw_residence_preserved_food\(&mut current,/);
assert.doesNotMatch(nightCycleSource, /take_need_stock/);

console.log('Typed food identity, cargo, aggregation, and preservation tests passed.');
