import assert from 'node:assert/strict';
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

console.log('chapel parish tests passed');
