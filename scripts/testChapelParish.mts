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
  payableParishExpensePerDay,
} from '../src/economy/chapelParish.ts';
import {
  expectedChapelCharityPerDay,
  expectedChapelPriestSalaryPerDay,
  expectedChapelUpkeepPerDay,
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

const parishSimulation = readFileSync(
  new URL('../server/src/simulation/chapel_parish.rs', import.meta.url),
  'utf8',
);
assert.match(parishSimulation, /if !economy_active\s*\{\s*return/);
assert.match(parishSimulation, /if economy_active\s*\{[\s\S]{0,800}chapel_monthly_expense_due[\s\S]{0,300}chapel_priest_salary_lot/);
assert.doesNotMatch(parishSimulation, /salary_per_tick|upkeep_per_tick|charity_per_tick/);
assert.doesNotMatch(parishSimulation, /auto_sweep|try_start_chapel_treasury_trip|credit_treasury_gold/);
const buildingReducers = readFileSync(
  new URL('../server/src/reducers/buildings.rs', import.meta.url),
  'utf8',
);
assert.match(
  buildingReducers,
  /collect_chapel_coffer[\s\S]{0,900}cannot be transferred to the civic treasury/,
  'legacy clients must be told that parish funds cannot be appropriated',
);
const chapelInspector = readFileSync(
  new URL('../src/resources/inspector/chapelRenderer.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(chapelInspector, /Send coffer cart|Auto-cart surplus to treasury|Connect the church and Town Hall by road/);
assert.match(chapelInspector, /cannot be transferred to the civic treasury/);
assert.match(chapelInspector, /Monastery purse/);

console.log('chapel parish tests passed');
