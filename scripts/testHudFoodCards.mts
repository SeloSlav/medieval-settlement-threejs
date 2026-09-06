import assert from 'node:assert/strict';
import { BREAD_GRAIN_KINDS, BREAD_KINDS, FLOUR_KINDS, GRAIN_SHEAF_KINDS } from '../src/economy/cropGoods.ts';
import { FRESH_FOOD_KINDS, PRESERVED_FOOD_KINDS } from '../src/economy/foodInventory.ts';
import { TRADE_RESOURCE_KINDS } from '../src/generated/gameBalance.ts';
import { HUD_RESOURCE_KINDS } from '../src/resources/resourceTotals.ts';
import { HUD_FOOD_GROUPS, HUD_FOOD_RESOURCE_KINDS, hudFoodResourceLabel } from '../src/ui/hudFoodCards.ts';
import { HUD_PROVISION_GROUPS, HUD_PROVISION_RESOURCE_KINDS } from '../src/ui/hudProvisionCards.ts';
import { HUD_CONSTRUCTION_RESOURCE_KINDS } from '../src/ui/hudResourceCards.ts';
import { RESOURCE_COST_KINDS } from '../src/ui/resourceCost.ts';

assert.deepEqual(
  HUD_CONSTRUCTION_RESOURCE_KINDS,
  ['timber', 'stone', 'ironwork', 'roofTiles'],
  'The Construction hover card should own every building material',
);

const foods = new Set<string>(HUD_FOOD_RESOURCE_KINDS);
assert.equal(foods.size, HUD_FOOD_RESOURCE_KINDS.length, 'Each food should appear once in the food panel');
const cereals = HUD_FOOD_GROUPS.find(({ id }) => id === 'cereals');
assert.equal(cereals?.label, 'Cereals & bread');
assert.deepEqual(cereals?.kinds, [
  ...GRAIN_SHEAF_KINDS,
  'ryeGrain', 'oatGrain', 'barley', 'maslinGrain',
  'ryeFlour', 'malt', 'maslinFlour',
  ...BREAD_KINDS,
], 'Cereal resources should follow four crop lanes with their processed goods below them');
assert.equal(HUD_FOOD_GROUPS.some(({ id }) => id === 'sheaves'), false);
assert.equal(HUD_FOOD_GROUPS.some(({ id }) => id === 'rawGrains'), false);
assert.equal(HUD_FOOD_GROUPS.some(({ id }) => id === 'flour'), false);
const sweetPreserves = HUD_FOOD_GROUPS.find(({ id }) => id === 'sweetPreserves');
assert.equal(sweetPreserves?.label, 'Sweet preserves');
assert.deepEqual(sweetPreserves?.kinds, ['jam', 'honey']);
const savoryPreserves = HUD_FOOD_GROUPS.find(({ id }) => id === 'savoryPreserves');
assert.equal(savoryPreserves?.label, 'Savory preserves');
assert.deepEqual(savoryPreserves?.kinds, ['curedMeat', 'smokedFish', 'cheese']);
assert.equal(HUD_FOOD_GROUPS.some(({ id }) => id === 'preservedFood'), false);
assert.equal(HUD_FOOD_GROUPS.some(({ id }) => id === 'honey'), false);
const provisions = new Set<string>(HUD_PROVISION_RESOURCE_KINDS);
assert.equal(
  provisions.size,
  HUD_PROVISION_RESOURCE_KINDS.length,
  'Each non-food provision should appear once in Goods & provisions',
);
for (const kind of HUD_CONSTRUCTION_RESOURCE_KINDS) {
  assert.equal(
    provisions.has(kind),
    false,
    `${kind} must appear only in the Construction hover card`,
  );
}
assert.deepEqual(
  HUD_PROVISION_GROUPS.find(({ id }) => id === 'beverages')?.kinds,
  ['ale', 'cider', 'mead', 'wine'],
);
for (const kind of foods) {
  assert.equal(provisions.has(kind), false, `${kind} must appear only in the Food hover card`);
}
for (const kind of [
  ...FRESH_FOOD_KINDS, ...PRESERVED_FOOD_KINDS, ...BREAD_GRAIN_KINDS,
  ...BREAD_KINDS, ...FLOUR_KINDS, ...GRAIN_SHEAF_KINDS, 'barley', 'malt', 'honey',
]) {
  assert.ok(foods.has(kind), `Food panel is missing ${kind}`);
}
const visibleResources = new Set<string>([
  ...HUD_RESOURCE_KINDS,
  ...foods,
  ...HUD_FOOD_GROUPS.map(({ id }) => id),
]);
for (const kind of new Set([...TRADE_RESOURCE_KINDS, ...RESOURCE_COST_KINDS])) {
  assert.ok(visibleResources.has(kind), `HUD menus are missing ${kind}`);
}
for (const kind of HUD_FOOD_RESOURCE_KINDS) {
  assert.ok(hudFoodResourceLabel(kind).length > 0, `Missing label for ${kind}`);
}
console.log(`HUD resource coverage passed: ${foods.size} food and crop entries; ${visibleResources.size} resources across all menus.`);
