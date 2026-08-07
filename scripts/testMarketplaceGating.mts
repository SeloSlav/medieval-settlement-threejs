import assert from 'node:assert/strict';
import { computeBackyardGardenTickEffects } from '../src/economy/backyardGardenTick.ts';

const withoutMarket = computeBackyardGardenTickEffects('apple_orchard', 3, false);
assert.ok(withoutMarket.selfFood > 0, 'self-food should deposit without marketplace access');
assert.equal(withoutMarket.marketFood, 0, 'no food can enter a closed market');
assert.equal(withoutMarket.economicActivity, 0, 'no taxable activity without marketplace access');

const withMarket = computeBackyardGardenTickEffects('apple_orchard', 3, true);
assert.ok(withMarket.selfFood > 0, 'self-food should still deposit with marketplace access');
assert.equal(withMarket.marketFood, 0, 'an empty pantry must fill its reserve before selling');
assert.equal(withMarket.economicActivity, 0, 'reserve-filling output is not a sale');
assert.equal(withMarket.selfFood, withoutMarket.selfFood);

const stockedWithMarket = computeBackyardGardenTickEffects(
  'apple_orchard',
  3,
  true,
  undefined,
  1,
  0,
  1,
  20,
);
assert.equal(stockedWithMarket.selfFood, 0, 'a filled tier-one reserve needs no additional output');
assert.ok(stockedWithMarket.marketFood > 0, 'food above the reserve should enter the shared pool');
assert.ok(stockedWithMarket.economicActivity > 0, 'physical surplus sales should generate activity');

const flowerWithoutMarket = computeBackyardGardenTickEffects('flower_garden', 3, false);
assert.equal(flowerWithoutMarket.selfFood, 0);
assert.equal(flowerWithoutMarket.marketFood, 0);
assert.equal(flowerWithoutMarket.economicActivity, 0);

const flowerWithMarket = computeBackyardGardenTickEffects('flower_garden', 3, true);
assert.equal(
  flowerWithMarket.economicActivity,
  0,
  'flowers improve settlement attraction and apiary forage but do not create passive market coin',
);

const herbWithoutOverflow = computeBackyardGardenTickEffects('herb_garden', 3, true);
assert.equal(herbWithoutOverflow.economicActivity, 0);
const herbWithMarketRemedies = computeBackyardGardenTickEffects(
  'herb_garden',
  3,
  true,
  undefined,
  1,
  0.5,
);
assert.ok(
  herbWithMarketRemedies.economicActivity > 0,
  'only remedy units actually deposited at a staffed market create herb income',
);

console.log('marketplace gating tests passed');
