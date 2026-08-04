import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NAMED_FOOD_KINDS,
  edibleFoodStock,
  freshFoodStock,
  preservableFoodStock,
  preservedFoodStock,
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
  bread: 4,
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
assert.equal(NAMED_FOOD_KINDS.length, 16);
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
  'bread',
  'meat',
  'fish',
  'berries',
  'mushrooms',
  'milk',
  'apples',
  'cherries',
  'vegetables',
  'eggs',
  'grapes',
  'porridge',
  'curedMeat',
  'smokedFish',
  'cheese',
] as const;
for (let index = 0; index < typedCargoKinds.length; index += 1) {
  const id = 27 + index;
  const kind = typedCargoKinds[index];
  assert.equal(cargoKindFromId(id), kind, `cargo id ${id} must remain ${kind}`);
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
  trip('bread', 'bread', 10),
  trip('meat', 'meat', 4),
  trip('cheese', 'cheese', 3),
  trip('honey', 'honey', 2),
]);
assert.equal(transit.bread, 10);
assert.equal(transit.meat, 4);
assert.equal(transit.cheese, 3);
assert.equal(transit.preservedFood, 3);
assert.equal(transit.food, 19);

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
const marketplaceOrdersSource = readFileSync(
  'server/src/economy/marketplace_orders.rs',
  'utf8',
);
const nightCycleSource = readFileSync(
  'server/src/simulation/night_cycle.rs',
  'utf8',
);
assert.match(economySource, /CommodityKind::Bread, BAKERY_FOOD_PER_CYCLE/);
assert.match(economySource, /kind == "smokehouse" && commodity\.is_preserved_food\(\)/);
assert.match(marketplaceOrdersSource, /"meat" => Ok\(CommodityKind::Meat\)/);
assert.match(marketplaceOrdersSource, /"curedMeat" => Ok\(CommodityKind::CuredMeat\)/);
assert.match(marketplaceOrdersSource, /"cheese" => Ok\(CommodityKind::Cheese\)/);
assert.match(nightCycleSource, /withdraw_residence_fresh_food\(&mut current, meal_due\)/);
assert.match(nightCycleSource, /withdraw_residence_preserved_food\(&mut current,/);
assert.doesNotMatch(nightCycleSource, /take_need_stock/);

console.log('Typed food identity, cargo, aggregation, and preservation tests passed.');
