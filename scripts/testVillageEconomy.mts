import assert from 'node:assert/strict';
import {
  ECONOMIC_ACTIVITY_TAX_RATE,
  ECONOMIC_ACTIVITY_TAX_RATE_MAX,
  ECONOMIC_ACTIVITY_TAX_RATE_MIN,
  HIGH_TAX_PRODUCTIVITY_DRAG,
  LOW_TAX_PRODUCTIVITY_BOOST,
  HERB_REMEDY_SALE_GOLD_PER_UNIT,
} from '../src/generated/gameBalance.ts';
import { gardenMarketActivity, SECONDS_PER_DAY } from '../src/economy/gardenMarketActivity.ts';
import { BACKYARD_GARDEN_DEFINITIONS } from '../src/generated/gameBalance.ts';
import {
  clampEconomicActivityTaxRate,
  economicActivityProductivityMultiplier,
  taxedEconomicActivity,
} from '../src/economy/villageEconomy.ts';

function rustProductivity(taxRate: number): number {
  const t = Math.min(ECONOMIC_ACTIVITY_TAX_RATE_MAX, Math.max(ECONOMIC_ACTIVITY_TAX_RATE_MIN, taxRate));
  const tOpt = ECONOMIC_ACTIVITY_TAX_RATE;

  if (t <= tOpt + 1e-12) {
    const span = Math.max(1e-9, tOpt - ECONOMIC_ACTIVITY_TAX_RATE_MIN);
    return 1 + LOW_TAX_PRODUCTIVITY_BOOST * (tOpt - t) / span;
  }

  const span = Math.max(1e-9, ECONOMIC_ACTIVITY_TAX_RATE_MAX - tOpt);
  const drag = HIGH_TAX_PRODUCTIVITY_DRAG * (t - tOpt) / span;
  return Math.max(0.12, 1 - drag);
}

assert.equal(clampEconomicActivityTaxRate(-0.1), ECONOMIC_ACTIVITY_TAX_RATE_MIN);
assert.equal(clampEconomicActivityTaxRate(0.99), ECONOMIC_ACTIVITY_TAX_RATE_MAX);
assert.equal(economicActivityProductivityMultiplier(ECONOMIC_ACTIVITY_TAX_RATE), 1);
assert.equal(
  economicActivityProductivityMultiplier(ECONOMIC_ACTIVITY_TAX_RATE_MIN),
  rustProductivity(ECONOMIC_ACTIVITY_TAX_RATE_MIN),
);
assert.equal(
  economicActivityProductivityMultiplier(ECONOMIC_ACTIVITY_TAX_RATE_MAX),
  rustProductivity(ECONOMIC_ACTIVITY_TAX_RATE_MAX),
);

const baseActivity = 120;
const defaultTax = taxedEconomicActivity(baseActivity, ECONOMIC_ACTIVITY_TAX_RATE);
assert.equal(defaultTax.adjusted, baseActivity);
assert.ok(Math.abs(defaultTax.tax - baseActivity * ECONOMIC_ACTIVITY_TAX_RATE) < 1e-9);

const lowTax = taxedEconomicActivity(baseActivity, 0);
assert.equal(lowTax.tax, 0);
assert.ok(lowTax.adjusted > baseActivity);

const highTax = taxedEconomicActivity(baseActivity, ECONOMIC_ACTIVITY_TAX_RATE_MAX);
assert.ok(highTax.adjusted < baseActivity);

const appleDef = BACKYARD_GARDEN_DEFINITIONS.apple_orchard;
const dayActivity = gardenMarketActivity(appleDef, 3, SECONDS_PER_DAY);
assert.ok(dayActivity > 0);
const tickActivity = gardenMarketActivity(appleDef, 3, 0.2);
assert.ok(Math.abs(dayActivity / tickActivity - SECONDS_PER_DAY / 0.2) < 1e-6);

assert.equal(
  gardenMarketActivity(BACKYARD_GARDEN_DEFINITIONS.flower_garden, 3, SECONDS_PER_DAY),
  0,
  'flowers improve settlement attraction but do not mint passive income',
);
assert.equal(
  gardenMarketActivity(BACKYARD_GARDEN_DEFINITIONS.herb_garden, 3, SECONDS_PER_DAY),
  0,
  'herbs earn nothing until real remedies overflow into a staffed market',
);
assert.equal(
  gardenMarketActivity(BACKYARD_GARDEN_DEFINITIONS.herb_garden, 3, SECONDS_PER_DAY, 2),
  2 * HERB_REMEDY_SALE_GOLD_PER_UNIT,
);

console.log('village economy tests passed');
