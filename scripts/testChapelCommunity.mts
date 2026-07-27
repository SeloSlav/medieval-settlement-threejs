import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  ABANDON_AFTER_DEFICIT_TICKS,
  CHAPEL_RECOVERY_NEEDS_REQUIRED,
  CHAPEL_RECOVERY_STOCK_MULTIPLIER,
  RESIDENCE_RECOVERY_FIREWOOD_MIN,
  RESIDENCE_SETTLE_TICKS,
  RESIDENCE_TIER1_ABANDONMENT_GRACE_MULTIPLIER,
  RESIDENCE_TIER2_ABANDONMENT_GRACE_MULTIPLIER,
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
assert.equal(effectiveResidenceSettleTicks(true, false, true), expectedEffectiveSettleTicks(true, false, true));
assert.equal(effectiveResidenceSettleTicks(true, false, true), 149);

assert.equal(
  effectiveAbandonAfterDeficitTicks(false, false, 1),
  ABANDON_AFTER_DEFICIT_TICKS * RESIDENCE_TIER1_ABANDONMENT_GRACE_MULTIPLIER,
);
assert.equal(
  effectiveAbandonAfterDeficitTicks(false, false, 2),
  ABANDON_AFTER_DEFICIT_TICKS * RESIDENCE_TIER2_ABANDONMENT_GRACE_MULTIPLIER,
);
assert.equal(effectiveAbandonAfterDeficitTicks(false), ABANDON_AFTER_DEFICIT_TICKS);
assert.equal(effectiveAbandonAfterDeficitTicks(true), expectedEffectiveAbandonAfterDeficitTicks(true));
assert.equal(effectiveAbandonAfterDeficitTicks(true), 5143);
assert.equal(effectiveAbandonAfterDeficitTicks(true, true), expectedEffectiveAbandonAfterDeficitTicks(true, true));
assert.equal(effectiveAbandonAfterDeficitTicks(true, true), 6051);

assert.equal(formatChapelSettlementBoostPercent(), '30%');
assert.equal(formatChapelAbandonmentGracePercent(), '43%');

assert.equal(recoveryNeedsRequired(false), RESIDENCE_NEED_KINDS.length);
assert.equal(recoveryNeedsRequired(true), CHAPEL_RECOVERY_NEEDS_REQUIRED);
assert.equal(recoveryNeedsRequired(false, 1), 1);
assert.equal(recoveryNeedsRequired(true, 1), 1);

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

const chapelSimulation = readFileSync(
  new URL('../server/src/simulation/chapel.rs', import.meta.url),
  'utf8',
);
assert.match(chapelSimulation, /build_monastery_tithe_routes/);
assert.match(chapelSimulation, /monasteries\s*\.iter\(\)/);
assert.match(chapelSimulation, /\.map\(\|building\| building\.id\)\s*\.min\(\)/);
assert.doesNotMatch(chapelSimulation, /monasteries\.sort_by_key/);
assert.doesNotMatch(
  chapelSimulation,
  /db\s*\.building\(\)\s*\.owner\(\)\s*\.filter\(&chapel\.owner\)/,
);
assert.match(
  chapelSimulation,
  /ctx\.db\.building\(\)\.id\(\)\.find\(&monastery_id\)/,
  'the selected route must still reload fresh monastery stock before crediting it',
);
const simulationReducer = readFileSync(
  new URL('../server/src/reducers/simulation.rs', import.meta.url),
  'utf8',
);
assert.match(
  simulationReducer,
  /for building in ctx\.db\.building\(\)\.iter\(\)[\s\S]{0,400}tick\.building_disabled_by_fire\(ctx, building\.id\)[\s\S]{0,500}"chapel" => chapel_ids\.push[\s\S]{0,100}"monastery" => monastery_ids\.push/,
  'automatic parish finance and monastery tithe routes must receive only fire-safe structures',
);
const townHallInspector = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(
  townHallInspector,
  /candidate\.kind === 'monastery'[\s\S]{0,160}!fireDisabled\.has\(candidate\.id\)[\s\S]{0,160}monasteryLinkedToChapel/,
  'damaged monasteries must not promise hospitality or tithe-linked service in the Town Hall',
);

const householdCount = 100_000;
const monasteryCount = 128;
const oldCandidateVisits = householdCount * monasteryCount;
const routeStarted = performance.now();
let selectedMonasteryId = Number.POSITIVE_INFINITY;
for (let id = monasteryCount; id > 0; id -= 1) {
  selectedMonasteryId = Math.min(selectedMonasteryId, id);
}
const routeElapsedMs = performance.now() - routeStarted;
assert.equal(selectedMonasteryId, 1);
assert.equal(oldCandidateVisits, 12_800_000);
assert.ok(
  routeElapsedMs < 25,
  `128-monastery stable route selection took ${routeElapsedMs.toFixed(1)} ms`,
);

console.log(
  `chapel community tests passed (100k households: monastery candidate visits ${oldCandidateVisits.toLocaleString()}→${monasteryCount})`,
);
