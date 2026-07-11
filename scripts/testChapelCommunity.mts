import assert from 'node:assert/strict';
import {
  ABANDON_AFTER_DEFICIT_TICKS,
  CHAPEL_RECOVERY_NEEDS_REQUIRED,
  CHAPEL_RECOVERY_STOCK_MULTIPLIER,
  RESIDENCE_RECOVERY_FIREWOOD_MIN,
  RESIDENCE_SETTLE_TICKS,
} from '../src/generated/gameBalance.ts';
import {
  expectedChapelAttendanceChance,
  expectedEffectiveAbandonAfterDeficitTicks,
  expectedEffectiveSettleTicks,
} from './economyFormulaExpectations.ts';
import {
  effectiveAbandonAfterDeficitTicks,
  effectiveResidenceSettleTicks,
  formatChapelAbandonmentGracePercent,
  formatChapelSettlementBoostPercent,
  recoveryNeedsRequired,
  recoveryStockMin,
} from '../src/economy/chapelCommunity.ts';
import {
  chapelAttendanceChance,
  chapelTitheGoldPerDay,
  expectedChapelTithePerDay,
} from '../src/economy/householdWealth.ts';
import { RESIDENCE_NEED_KINDS } from '../src/residences/residenceNeedState.ts';

assert.equal(effectiveResidenceSettleTicks(false), RESIDENCE_SETTLE_TICKS);
assert.equal(effectiveResidenceSettleTicks(true), expectedEffectiveSettleTicks(true));
assert.equal(effectiveResidenceSettleTicks(true), 175);

assert.equal(effectiveAbandonAfterDeficitTicks(false), ABANDON_AFTER_DEFICIT_TICKS);
assert.equal(effectiveAbandonAfterDeficitTicks(true), expectedEffectiveAbandonAfterDeficitTicks(true));
assert.equal(effectiveAbandonAfterDeficitTicks(true), 5143);

assert.equal(formatChapelSettlementBoostPercent(), '30%');
assert.equal(formatChapelAbandonmentGracePercent(), '43%');

assert.equal(recoveryNeedsRequired(false), RESIDENCE_NEED_KINDS.length);
assert.equal(recoveryNeedsRequired(true), CHAPEL_RECOVERY_NEEDS_REQUIRED);

assert.equal(
  recoveryStockMin('firewood', true),
  RESIDENCE_RECOVERY_FIREWOOD_MIN * CHAPEL_RECOVERY_STOCK_MULTIPLIER,
);

const population = 6;
const assignedLabor = 1;
const expectedDaily = expectedChapelTithePerDay(population, assignedLabor);
assert.ok(
  Math.abs(expectedDaily - chapelTitheGoldPerDay(population) * chapelAttendanceChance(assignedLabor)) < 1e-9,
);
assert.equal(chapelAttendanceChance(assignedLabor), expectedChapelAttendanceChance(assignedLabor));

console.log('chapel community tests passed');
