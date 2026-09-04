import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FRESH_FOOD_KINDS,
  FOOD_MEAL_VALUES,
  NAMED_FOOD_KINDS,
  foodCategory,
  foodCategoryQualifyingStock,
  foodProgressionStatus,
  foodMealValue,
  foodSpoilageLabel,
  foodSpoilageMultiplier,
  foodVarietyCount,
  edibleFoodStock,
  edibleFoodMealEquivalents,
  freshFoodStock,
  freshFoodMealEquivalents,
  preservableFoodStock,
  preservedFoodStock,
  preservedFoodMealEquivalents,
  savoryPreservesStock,
} from '../src/economy/foodInventory.ts';
import {
  cargoKindFromId,
  cargoKindLabel,
  type DeliveryTripState,
} from '../src/logistics/deliveryTrips.ts';
import { processorInputCommodityStock } from '../src/logistics/processorInputLogistics.ts';
import { computeInTransitResourceTotals } from '../src/resources/resourceTotals.ts';
import {
  MARKET_COMMODITIES,
  MARKETPLACE_TRADE_OFFERS,
  TRADE_RESOURCE_KINDS,
} from '../src/generated/gameBalance.ts';
import { RESOURCE_KINDS } from '../src/resources/types.ts';

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
assert.equal(
  savoryPreservesStock({ curedMeat: 6, smokedFish: 7, cheese: 8, jam: 9, honey: 11 }),
  21,
  'sweet preserves must remain outside the Tier-4 and military savory-preserve role',
);
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
assert.equal(foodSpoilageLabel('honey'), 'Shelf-stable');
assert.equal(foodSpoilageLabel('ryeBread'), 'Slow spoilage');
assert.equal(foodSpoilageLabel('eggs'), 'Moderate spoilage');
assert.equal(foodSpoilageLabel('milk'), 'Fast spoilage');
assert.equal(NAMED_FOOD_KINDS.length, 23);
assert.equal(
  (FRESH_FOOD_KINDS as readonly string[]).includes('food'),
  false,
  'the retired aggregate food item must not appear in the fresh-food catalog',
);
assert.equal(
  Object.hasOwn(FOOD_MEAL_VALUES, 'food'),
  false,
  'the retired aggregate food item must not have a meal value',
);
assert.equal(
  (RESOURCE_KINDS as readonly string[]).includes('food'),
  false,
  'the retired aggregate food item must not be a client resource kind',
);
assert.equal(
  (TRADE_RESOURCE_KINDS as readonly string[]).includes('food'),
  false,
  'the retired aggregate food item must not be tradable',
);
assert.equal(
  MARKETPLACE_TRADE_OFFERS.some(({ id }) => ['buy_food', 'sell_food'].includes(id as string)),
  false,
  'legacy aggregate food offers must not be generated',
);
assert.equal(
  (NAMED_FOOD_KINDS as readonly string[]).includes('vegetables'),
  false,
  'retired aggregate vegetables must not appear in the household or HUD food catalog',
);
assert.equal(
  (RESOURCE_KINDS as readonly string[]).includes('vegetables'),
  false,
  'retired aggregate vegetables must not remain a client resource',
);
assert.equal(foodCategory('apples'), 'fruits');
assert.equal(foodCategory('pears'), 'fruits');
assert.equal(foodCategory('cherries'), 'fruits');
assert.equal(foodCategory('cabbage'), 'vegetables');
assert.equal(foodCategory('carrots'), 'vegetables');
assert.equal(foodCategory('beetroot'), 'vegetables');
assert.equal(foodCategory('aronia'), 'foraged');
assert.equal(foodCategory('rosehips'), 'foraged');
assert.equal(foodCategory('jam'), 'sweetPreserves');
assert.equal(foodCategory('honey'), 'sweetPreserves');
assert.equal(foodCategory('milk'), 'animalProduce');
assert.equal(foodCategory('curedMeat'), 'savoryPreserves');
assert.equal(foodCategory('smokedFish'), 'savoryPreserves');
assert.equal(foodCategory('cheese'), 'savoryPreserves');
assert.equal(
  foodVarietyCount({ apples: 2, cherries: 2, cabbage: 3, milk: 1, cheese: 1 }, 1),
  4,
  'cheese must count as a savory preserve rather than raw animal produce',
);
assert.equal(
  foodVarietyCount({ cabbage: 2, carrots: 2, beetroot: 2 }, 1),
  1,
  'separate vegetable commodities remain one dietary category',
);
assert.equal(
  foodVarietyCount({ aronia: 2, rosehips: 2, jam: 2 }, 1),
  2,
  'fresh hedgerow fruit and sweet preserves remain distinct dietary categories',
);
assert.equal(
  foodVarietyCount({ jam: 2, honey: 2 }, 1),
  1,
  'honey and jam share the Sweet preserves category',
);
assert.equal(foodCategoryQualifyingStock(1), 1);
assert.equal(foodCategoryQualifyingStock(6), 1);
assert.equal(
  foodVarietyCount({ cabbage: 0.9 }, 1),
  0,
  'a token amount must not qualify a category',
);
assert.equal(
  foodVarietyCount({ cabbage: 1 }, 1),
  1,
  'one monthly bill unit must qualify the vegetable category',
);
assert.equal(
  foodVarietyCount({ milk: 0.63, eggs: 0.5 }, 6),
  1,
  'raw animal produce may combine to qualify its shared category',
);
assert.equal(
  foodVarietyCount({ cheese: 0.63, curedMeat: 0.5 }, 6),
  1,
  'named savory preserves may combine to qualify their shared category',
);
assert.equal(
  foodProgressionStatus({ ryeBread: 1 }, 3, 1).ready,
  true,
  'one rye bread must satisfy a full Tier-1 household food category',
);
assert.deepEqual(
  foodProgressionStatus({ ryeBread: 2, cabbage: 2, apples: 2 }, 1, 3).satisfiedSlots,
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
const tierFourBase = { ryeBread: 2, cabbage: 2, fish: 2 };
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
  [36, 'eggs'],
  [37, 'grapes'],
  [38, 'cabbage'],
  [39, 'curedMeat'],
  [40, 'smokedFish'],
  [41, 'cheese'],
  [50, 'carrots'],
  [53, 'beetroot'],
  [55, 'cider'],
  [61, 'jam'],
] as const;
assert.equal(cargoKindFromId(2), null, 'retired aggregate food cargo id 2 must stay unmapped');
assert.equal(cargoKindFromId(7), null, 'retired aggregate preserved-food cargo id 7 must stay unmapped');
assert.equal(cargoKindFromId(35), null, 'removed aggregate vegetable cargo id must stay unmapped');
assert.equal(cargoKindFromId(57), null, 'removed second cider cargo id must stay unmapped');
assert.equal(cargoKindFromId(62), null, 'removed second jam cargo id must stay unmapped');
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
assert.equal(
  (RESOURCE_KINDS as readonly string[]).includes('preservedFood'),
  false,
  'retired aggregate preserved food must not remain a client resource',
);

const commoditiesSource = readFileSync(
  'server/src/economy/commodities.rs',
  'utf8',
);
const tablesSource = readFileSync(
  'server/src/tables.rs',
  'utf8',
);
const supplyPolicySource = readFileSync(
  'server/src/supply_policy.rs',
  'utf8',
);
assert.match(commoditiesSource, /Self::Meat => Some\(Self::CuredMeat\)/);
assert.match(commoditiesSource, /Self::Fish => Some\(Self::SmokedFish\)/);
assert.match(commoditiesSource, /Self::Milk => Some\(Self::Cheese\)/);
const commodityEnumSource = commoditiesSource.match(
  /pub enum CommodityKind \{([\s\S]*?)\n\}/,
)?.[1];
assert.ok(commodityEnumSource, 'CommodityKind enum must remain discoverable');
assert.doesNotMatch(
  commodityEnumSource,
  /\bVegetables\b/,
  'retired aggregate vegetables must not remain a server commodity',
);
assert.doesNotMatch(
  tablesSource,
  /pub vegetables:\s*f64/,
  'retired aggregate vegetables must not remain in persisted resource schemas',
);
assert.doesNotMatch(
  tablesSource,
  /pub preserved_food:\s*f64/,
  'retired aggregate preserved food must not remain in persisted resource schemas',
);
assert.doesNotMatch(
  commodityEnumSource,
  /\bPreservedFood\b/,
  'retired aggregate preserved food must not remain a server commodity',
);
assert.doesNotMatch(
  commoditiesSource,
  /CommodityKind::Food|\bFood\s*=\s*2\b/,
  'the authoritative commodity enum must not restore the retired aggregate food item',
);
assert.match(
  commoditiesSource,
  /pub fn meal_value[\s\S]*Self::Jam => 1\.0,[\s\S]*Self::OatGrain => OAT_GRAIN_MEAL_VALUE,[\s\S]*_ => 0\.0/,
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
const residenceNeedsSource = readFileSync(
  'server/src/simulation/residence_needs/mod.rs',
  'utf8',
);
assert.match(economySource, /CommodityKind::RyeBread/);
assert.doesNotMatch(economySource, /CommodityKind::OatBread|CommodityKind::OatFlour/);
assert.match(economySource, /CommodityKind::MaslinBread/);
assert.match(economySource, /kind == "smokehouse" && commodity\.is_preserved_food\(\)/);
assert.match(tradeResourcesSource, /CommodityKind::Meat => TradeResource::Meat/);
assert.match(tradeResourcesSource, /CommodityKind::CuredMeat => TradeResource::CuredMeat/);
assert.match(tradeResourcesSource, /CommodityKind::Cheese => TradeResource::Cheese/);
assert.match(residenceNeedsSource, /consume_monthly_food_slots/);
assert.doesNotMatch(residenceNeedsSource, /withdraw_residence_(?:fresh|preserved)_food/);
assert.doesNotMatch(residenceNeedsSource, /take_need_stock/);

console.log('Typed food identity, cargo, aggregation, and preservation tests passed.');
