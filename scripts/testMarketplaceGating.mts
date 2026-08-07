import assert from 'node:assert/strict';
import { computeBackyardGardenTickEffects } from '../src/economy/backyardGardenTick.ts';

const withoutMarket = computeBackyardGardenTickEffects('apple_orchard', 3, false);
assert.ok(withoutMarket.selfFood > 0, 'self-food should deposit without marketplace access');
assert.equal(withoutMarket.marketFood, 0, 'no food can enter a closed market');
assert.equal(withoutMarket.economicActivity, 0, 'no taxable activity without marketplace access');

const withMarket = computeBackyardGardenTickEffects('apple_orchard', 3, true);
assert.ok(withMarket.selfFood > 0, 'self-food should still deposit with marketplace access');
assert.ok(withMarket.marketFood > 0, 'surplus should enter the shared food pool');
assert.ok(withMarket.economicActivity > 0, 'surplus sales should generate activity with marketplace access');
assert.ok(
  withoutMarket.selfFood > withMarket.selfFood,
  'without a granary-run stall the household should keep the full edible crop',
);

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
