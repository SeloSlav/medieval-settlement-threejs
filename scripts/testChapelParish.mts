import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHAPEL_CHARITY_MIN_COFFER_GOLD,
  CHAPEL_COFFER_RESERVE_DEFAULT,
  CHAPEL_COFFER_RESERVE_MAX,
  CHAPEL_COFFER_RESERVE_MIN,
  CHAPEL_PRIEST_SALARY_GOLD_PER_DAY,
  CHAPEL_UPKEEP_GOLD_PER_DAY,
} from '../src/generated/gameBalance.ts';
import {
  chapelCharityPerDay,
  chapelParishExpensePerDay,
  chapelPriestSalaryPerDay,
  chapelUpkeepPerDay,
  clampChapelCofferReserveGold,
  payableAutoSweepPerDay,
  payableParishExpensePerDay,
} from '../src/economy/chapelParish.ts';
import {
  expectedChapelCharityPerDay,
  expectedChapelPriestSalaryPerDay,
  expectedChapelUpkeepPerDay,
  expectedPayableAutoSweepPerDay,
  expectedPayableParishExpensePerDay,
} from './economyFormulaExpectations.ts';

assert.equal(chapelPriestSalaryPerDay(1), expectedChapelPriestSalaryPerDay(1));
assert.equal(chapelPriestSalaryPerDay(1), CHAPEL_PRIEST_SALARY_GOLD_PER_DAY);
assert.equal(chapelPriestSalaryPerDay(0), 0);
assert.equal(chapelUpkeepPerDay(1), expectedChapelUpkeepPerDay(1));
assert.equal(chapelUpkeepPerDay(1), CHAPEL_UPKEEP_GOLD_PER_DAY);
assert.ok(chapelUpkeepPerDay(0) < CHAPEL_UPKEEP_GOLD_PER_DAY);

assert.equal(chapelCharityPerDay(CHAPEL_CHARITY_MIN_COFFER_GOLD, 1), expectedChapelCharityPerDay(CHAPEL_CHARITY_MIN_COFFER_GOLD, 1));
assert.ok(chapelCharityPerDay(CHAPEL_CHARITY_MIN_COFFER_GOLD, 1) > 0);
assert.equal(chapelCharityPerDay(CHAPEL_CHARITY_MIN_COFFER_GOLD - 1, 1), 0);
assert.equal(chapelCharityPerDay(CHAPEL_CHARITY_MIN_COFFER_GOLD, 0), 0);

const staffedExpense = chapelParishExpensePerDay(1, 200);
assert.ok(staffedExpense.total > CHAPEL_PRIEST_SALARY_GOLD_PER_DAY);

const payableFull = payableParishExpensePerDay(1, 200);
const expectedFull = expectedPayableParishExpensePerDay(1, 200);
assert.equal(payableFull.salary, expectedFull.salary);
assert.equal(payableFull.upkeep, expectedFull.upkeep);
assert.equal(payableFull.charity, expectedFull.charity);
assert.equal(payableFull.total, expectedFull.total);

const payableLimited = payableParishExpensePerDay(1, 1);
const expectedLimited = expectedPayableParishExpensePerDay(1, 1);
assert.equal(payableLimited.total, expectedLimited.total);
assert.ok(payableLimited.total < payableFull.total);

assert.equal(clampChapelCofferReserveGold(CHAPEL_COFFER_RESERVE_DEFAULT), CHAPEL_COFFER_RESERVE_DEFAULT);
assert.equal(clampChapelCofferReserveGold(CHAPEL_COFFER_RESERVE_MIN - 5), CHAPEL_COFFER_RESERVE_MIN);
assert.equal(clampChapelCofferReserveGold(CHAPEL_COFFER_RESERVE_MAX + 5), CHAPEL_COFFER_RESERVE_MAX);

assert.equal(payableAutoSweepPerDay(200, 1, 80, false), expectedPayableAutoSweepPerDay(200, 1, 80, false));
assert.equal(payableAutoSweepPerDay(200, 1, 80, false), 0);
assert.ok(payableAutoSweepPerDay(200, 1, 80, true) > 0);
assert.ok(Math.abs(
  payableAutoSweepPerDay(200, 1, 80, true) - expectedPayableAutoSweepPerDay(200, 1, 80, true),
) < 1e-9);

const parishSimulation = readFileSync(
  new URL('../server/src/simulation/chapel_parish.rs', import.meta.url),
  'utf8',
);
assert.doesNotMatch(
  parishSimulation,
  /if is_parish_economy_paused\(clock\)\s*\{\s*return/,
  'night hours must not silently discard a scheduled accounting-only coffer sweep',
);
assert.match(parishSimulation, /let auto_sweep_due = chapel_auto_sweep_due\(sim_tick\)/);
assert.match(parishSimulation, /if !economy_active && !auto_sweep_due\s*\{\s*return/);
assert.match(parishSimulation, /if economy_active\s*\{[\s\S]{0,500}chapel_priest_salary_per_tick/);
assert.match(parishSimulation, /try_start_chapel_treasury_trip/);
assert.match(parishSimulation, /available_free_haulers/);
assert.match(parishSimulation, /CommodityKind::Gold/);
assert.match(
  parishSimulation,
  /\(physical && economy_active\)\s*\|\|\s*\(!physical && auto_sweep_due\)/,
  'new settlements should keep trying a standing auto-cart order during work hours while legacy saves retain their cadence',
);
assert.match(
  parishSimulation,
  /if physical\s*\{[\s\S]{0,500}try_start_chapel_treasury_trip[\s\S]{0,500}else\s*\{[\s\S]{0,300}credit_treasury_gold/,
  'only legacy saves may keep the direct accounting sweep',
);
const buildingReducers = readFileSync(
  new URL('../server/src/reducers/buildings.rs', import.meta.url),
  'utf8',
);
assert.match(
  buildingReducers,
  /collect_chapel_coffer[\s\S]{0,2200}physical_founding_site_enabled[\s\S]{0,1200}try_start_chapel_treasury_trip/,
  'manual physical collection must dispatch a cart instead of clearing the coffer',
);
const chapelInspector = readFileSync(
  new URL('../src/resources/inspector/chapelRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(chapelInspector, /Send coffer cart/);
assert.match(chapelInspector, /Auto-cart surplus to treasury/);
assert.match(chapelInspector, /Connect the chapel and Town Hall by road/);
assert.match(chapelInspector, /Monastery purse/);

console.log('chapel parish tests passed');
