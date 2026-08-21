import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHARCOAL_HOUSEHOLD_FUEL_VALUE,
  MARKETPLACE_FUEL_RESERVE_DAYS,
  SMITHY_CHARCOAL_PER_CYCLE,
  SMITHY_CHARCOAL_REORDER_CYCLES,
  SMITHY_CHARCOAL_TARGET_CYCLES,
} from '../src/generated/gameBalance.ts';
import {
  combinedFuelEquivalent,
  fuelRunwayDays,
  householdFuelDemandPerDay,
  marketplaceFuelReserveTarget,
  smithyCharcoalRefillTarget,
} from '../src/economy/fuelReservePolicy.ts';

assert.equal(CHARCOAL_HOUSEHOLD_FUEL_VALUE, 2);
assert.equal(MARKETPLACE_FUEL_RESERVE_DAYS, 21);
assert.equal(SMITHY_CHARCOAL_REORDER_CYCLES, 3);
assert.equal(SMITHY_CHARCOAL_TARGET_CYCLES, 6);
assert.equal(combinedFuelEquivalent(20, 15), 50);

const fairDailyDemand = householdFuelDemandPerDay(10, 1);
assert.ok(Math.abs(fairDailyDemand - (10 / 3)) < 1e-9);
assert.ok(Math.abs(marketplaceFuelReserveTarget(10, 1, 80, 80) - 70) < 1e-9);
assert.ok(Math.abs(marketplaceFuelReserveTarget(10, 2, 80, 80) - 140) < 1e-9);
assert.equal(marketplaceFuelReserveTarget(100, 2, 80, 80), 240);
assert.ok(Math.abs(fuelRunwayDays(70, fairDailyDemand) - 21) < 1e-9);

const reorder = SMITHY_CHARCOAL_PER_CYCLE * SMITHY_CHARCOAL_REORDER_CYCLES;
const refill = SMITHY_CHARCOAL_PER_CYCLE * SMITHY_CHARCOAL_TARGET_CYCLES;
assert.equal(smithyCharcoalRefillTarget(reorder - 0.01), refill);
assert.equal(smithyCharcoalRefillTarget(reorder), null);

const routing = readFileSync('server/src/simulation/village_storehouse.rs', 'utf8');
const materials = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const loop = readFileSync('server/src/reducers/simulation.rs', 'utf8');
const cargo = readFileSync('server/src/simulation/delivery_cargo.rs', 'utf8');

assert.match(routing, /covered_population_by_market/);
assert.match(routing, /marketplace_fuel_reserve_target/);
assert.match(routing, /combined_fuel_equivalent/);
assert.doesNotMatch(
  routing,
  /CommodityKind::Firewood[\s\S]{0,240}cap \* 0\.75/,
  'fuel must not fall back to independent 75%-of-bay targets',
);
assert.match(materials, /smithy_charcoal_refill_target/);
assert.match(
  materials,
  /\("village_storehouse", CommodityKind::Charcoal\) => Some\(&\["smithy"\]\)/,
);
assert.match(materials, /storage_accepts_commodity[\s\S]*CommodityKind::Charcoal/);
assert.match(materials, /storehouse_charcoal_target_percent/);
assert.match(materials, /fn storehouse_charcoal_transit_plan/);
assert.match(materials, /has_linked_market_shortfall/);
assert.match(
  materials,
  /has_linked_export_post[\s\S]*trading_post_exports_commodity\(ctx, post\.id, CommodityKind::Charcoal\)/,
  'accepted charcoal depots must be able to stage stock for a linked Trading Post export rule',
);
assert.doesNotMatch(
  routing,
  /"charcoal_burner" => &\[CommodityKind::Charcoal\]/,
  'full downstream runways must let surplus charcoal stop at the kiln instead of forcing overflow storage',
);
assert.ok(
  loop.indexOf('step_local_material_dispatch(ctx')
    < loop.indexOf('step_storehouse_market_stalls(ctx'),
  'smithy charcoal buffers must be assigned before household market reserves',
);
assert.ok(
  cargo.indexOf('CommodityKind::Charcoal') < cargo.indexOf('withdraw_building('),
  'household fuel withdrawal should consume charcoal before firewood',
);

console.log('fuel reserve policy tests passed');
