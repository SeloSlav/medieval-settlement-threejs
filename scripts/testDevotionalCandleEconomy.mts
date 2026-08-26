import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CHAPEL_CANDLE_CAPACITY,
  CHAPEL_LITURGY_ATTENDANCE_BONUS,
  DEVOTIONAL_CANDLE_CONTRACT_GOLD,
  DEVOTIONAL_CANDLE_CONTRACT_UNITS,
  MONASTERY_CANDLE_CAPACITY,
  MONASTERY_LITURGY_PRESTIGE_MULTIPLIER,
  devotionalCandleContractLabel,
  devotionalCandlesSupplied,
  monasteryLiturgyPrestigeMultiplier,
} from '../src/economy/devotionalCandles.ts';
import { chapelAttendanceChance } from '../src/economy/householdWealth.ts';
import { monasteryHospitalityPlan } from '../src/economy/monasteryHospitality.ts';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

assert.equal(DEVOTIONAL_CANDLE_CONTRACT_UNITS, 4);
assert.equal(DEVOTIONAL_CANDLE_CONTRACT_GOLD, 5);
assert.ok(DEVOTIONAL_CANDLE_CONTRACT_GOLD * 2 < 14, 'regional export must remain best pure cash');
assert.equal(CHAPEL_CANDLE_CAPACITY, 8);
assert.equal(MONASTERY_CANDLE_CAPACITY, 16);
assert.equal(devotionalCandlesSupplied(1), true);
assert.equal(devotionalCandlesSupplied(0), false);
assert.match(devotionalCandleContractLabel('chapel'), /4 candles for 5 gold/);

const unlitAttendance = chapelAttendanceChance(1, false, false, false);
const litAttendance = chapelAttendanceChance(1, false, false, true);
assert.equal(
  litAttendance,
  Math.min(1, unlitAttendance + CHAPEL_LITURGY_ATTENDANCE_BONUS),
);

assert.equal(monasteryLiturgyPrestigeMultiplier(0), 1);
assert.equal(
  monasteryLiturgyPrestigeMultiplier(1),
  MONASTERY_LITURGY_PRESTIGE_MULTIPLIER,
);
const unlitHospitality = monasteryHospitalityPlan({
  honey: 80,
  cider: 50,
  mead: 0,
  wine: 0,
  candles: 0,
}, true);
const litHospitality = monasteryHospitalityPlan({
  honey: 80,
  cider: 50,
  mead: 0,
  wine: 0,
  candles: 1,
}, true);
assert.equal(
  litHospitality.prestigeMultiplier,
  unlitHospitality.prestigeMultiplier * MONASTERY_LITURGY_PRESTIGE_MULTIPLIER,
);
assert.ok(litHospitality.pilgrimageGoldPerDay > unlitHospitality.pilgrimageGoldPerDay);

const devotionalSimulation = source('server/src/simulation/devotional_candles.rs');
assert.match(devotionalSimulation, /building_ids_for_kinds\(ctx, institution\.owner, &\["trading_post"\]\)/);
assert.match(devotionalSimulation, /building_has_inbound_commodity_trip[\s\S]*CommodityKind::Candles/);
assert.match(devotionalSimulation, /try_start_origin_rostered_building_supply_trip/);
assert.match(devotionalSimulation, /chapel_coffer_gold/);
assert.match(devotionalSimulation, /institution\.gold - institution\.civic_receipts_gold/);
assert.match(devotionalSimulation, /withdraw_coffer_in_place/);
assert.match(devotionalSimulation, /private_export_proceeds_gold/);

const trips = source('server/src/simulation/delivery_trips.rs');
assert.match(trips, /settle_devotional_candle_delivery/);
assert.match(
  trips,
  /trip\.cargo_kind = CommodityKind::Gold\.as_u8\(\);[\s\S]*trip\.amount = payment/,
);
assert.match(trips, /devotional_purchase_receipt[\s\S]*credit_local_purchase_receipt/);

const commodities = source('server/src/economy/commodities.rs');
assert.match(commodities, /devotional_candle_capacity\(kind\)/);

const reducer = source('server/src/reducers/simulation.rs');
assert.match(reducer, /step_market_household_distribution[\s\S]*step_devotional_candles/);

const chapelInspector = source('src/resources/inspector/chapelRenderer.ts');
assert.match(chapelInspector, /Devotional candles/);
assert.match(chapelInspector, /Local candle contract/);
assert.match(chapelInspector, /Liturgical service/);

const monasteryInspector = source('src/resources/inspector/expandedBuildingRenderer.ts');
assert.match(monasteryInspector, /Liturgical offices/);
assert.match(monasteryInspector, /liturgical gift prestige/);

const design = source('docs/CANDLE_ECONOMY.md');
assert.match(design, /## Local devotional contracts/);
assert.match(design, /eight locally contracted candles yield ten gross gold/);

console.log('Devotional candle routing, payment, balance, faith benefit, UI, and documentation contracts passed.');
