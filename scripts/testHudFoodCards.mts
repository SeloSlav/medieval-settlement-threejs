import assert from 'node:assert/strict';
import { BREAD_GRAIN_KINDS, BREAD_KINDS, FLOUR_KINDS, GRAIN_SHEAF_KINDS } from '../src/economy/cropGoods.ts';
import { FRESH_FOOD_KINDS, PRESERVED_FOOD_KINDS } from '../src/economy/foodInventory.ts';
import { TRADE_RESOURCE_KINDS } from '../src/generated/gameBalance.ts';
import { HUD_RESOURCE_KINDS } from '../src/resources/resourceTotals.ts';
import { HUD_FOOD_GROUPS, HUD_FOOD_RESOURCE_KINDS, hudFoodResourceLabel, hudFoodResourceTooltip } from '../src/ui/hudFoodCards.ts';
import { HUD_CONSTRUCTION_RESOURCE_KINDS } from '../src/ui/hudResourceCards.ts';
import { RESOURCE_COST_KINDS } from '../src/ui/resourceCost.ts';

assert.deepEqual(
  HUD_CONSTRUCTION_RESOURCE_KINDS,
  ['timber', 'stone'],
  'The Construction hover card should own the raw building materials',
);

const foods = new Set<string>(HUD_FOOD_RESOURCE_KINDS);
assert.equal(foods.size, HUD_FOOD_RESOURCE_KINDS.length, 'Each food should appear once in the food panel');
const sweetPreserves = HUD_FOOD_GROUPS.find(({ id }) => id === 'sweetPreserves');
assert.equal(sweetPreserves?.label, 'Sweet preserves');
assert.deepEqual(sweetPreserves?.kinds, ['jam', 'honey']);
const savoryPreserves = HUD_FOOD_GROUPS.find(({ id }) => id === 'savoryPreserves');
assert.equal(savoryPreserves?.label, 'Savory preserves');
assert.deepEqual(savoryPreserves?.kinds, ['curedMeat', 'smokedFish', 'cheese']);
assert.equal(HUD_FOOD_GROUPS.some(({ id }) => id === 'preservedFood'), false);
assert.equal(HUD_FOOD_GROUPS.some(({ id }) => id === 'honey'), false);
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
  assert.doesNotMatch(hudFoodResourceTooltip(kind), /undefined|NaN/, `Invalid tooltip for ${kind}`);
}
assert.doesNotMatch(hudFoodResourceTooltip('ryeSheaves'), /spoilage/i, 'Unprocessed crops must not inherit meal spoilage');
assert.match(hudFoodResourceTooltip('ryeBread'), /spoilage/i, 'Bread must retain its food tooltip');
console.log(`HUD resource coverage passed: ${foods.size} food and crop entries; ${visibleResources.size} resources across all menus.`);
