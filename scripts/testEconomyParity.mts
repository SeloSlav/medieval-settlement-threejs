import assert from 'node:assert/strict';
import {
  expectedChapelAttendanceChance,
  expectedChapelTitheGoldPerTick,
  expectedEffectiveSettleTicks,
  expectedPayableParishExpensePerDay,
} from './economyFormulaExpectations.ts';
import {
  chapelAttendanceChance,
  chapelTitheGoldPerTick,
} from '../src/economy/householdWealth.ts';
import { effectiveResidenceSettleTicks } from '../src/economy/chapelCommunity.ts';
import { payableParishExpensePerDay } from '../src/economy/chapelParish.ts';

assert.equal(effectiveResidenceSettleTicks(true), expectedEffectiveSettleTicks(true));
assert.equal(chapelAttendanceChance(1), expectedChapelAttendanceChance(1));
assert.ok(Math.abs(chapelTitheGoldPerTick(3) - expectedChapelTitheGoldPerTick(3)) < 1e-9);

const payable = payableParishExpensePerDay(1, 50);
const expectedPayable = expectedPayableParishExpensePerDay(1, 50);
assert.equal(payable.salary, expectedPayable.salary);
assert.equal(payable.upkeep, expectedPayable.upkeep);
assert.equal(payable.charity, expectedPayable.charity);
assert.equal(payable.total, expectedPayable.total);

console.log('economy parity tests passed (TS contract; Rust mirrors in chapel_community.rs)');
