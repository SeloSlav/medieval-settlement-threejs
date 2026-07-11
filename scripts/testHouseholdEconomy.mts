import assert from 'node:assert/strict';
import {
  CHAPEL_BASE_ATTENDANCE_CHANCE,
  CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
  CHAPEL_PRIEST_ATTENDANCE_BONUS,
  CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY,
  CHAPEL_COFFER_CAPACITY,
  HOUSEHOLD_MAX_WEALTH,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import { SECONDS_PER_DAY } from '../src/economy/gardenMarketActivity.ts';
import {
  chapelAttendanceChance,
  chapelTitheGoldPerTick,
  expectedChapelTithePerDay,
  householdNetIncomePerDay,
} from '../src/economy/householdWealth.ts';
import {
  estimateVillageChapelTithePerDay,
  estimateVillageHouseholdSavingsPerDay,
  summarizeHouseholdWealth,
} from '../src/economy/villageProjections.ts';
import { totalChapelCofferGold } from '../src/resources/chapelCoffer.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import type { ResidenceState } from '../src/resources/types.ts';
import { taxedEconomicActivity } from '../src/economy/villageEconomy.ts';

assert.equal(
  chapelAttendanceChance(1),
  CHAPEL_BASE_ATTENDANCE_CHANCE + CHAPEL_PRIEST_ATTENDANCE_BONUS + CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
);
assert.equal(chapelAttendanceChance(0), 0);
assert.equal(chapelAttendanceChance(2), 1);

const tithePerTick = chapelTitheGoldPerTick(3);
assert.ok(
  Math.abs(tithePerTick - 3 * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY * SIM_TICK_SECONDS / SECONDS_PER_DAY) < 1e-9,
);

const expectedDaily = expectedChapelTithePerDay(4, 1);
assert.ok(
  Math.abs(expectedDaily - 4 * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY * chapelAttendanceChance(1)) < 1e-9,
);

const activity = 100;
const taxRate = 0.18;
const { adjusted, tax } = taxedEconomicActivity(activity, taxRate);
assert.equal(householdNetIncomePerDay(activity, taxRate), adjusted - tax);
assert.equal(HOUSEHOLD_MAX_WEALTH, 200);

const residences = new Map<string, ResidenceState>([
  ['residence-1', {
    id: 'residence-1',
    zoneId: 'zone-1',
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population: 3,
    populationCapacity: 3,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 12.5,
  }],
  ['residence-2', {
    id: 'residence-2',
    zoneId: 'zone-1',
    parcelIndex: 1,
    x: 10,
    z: 0,
    yaw: 0,
    population: 2,
    populationCapacity: 3,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
  }],
]);

const summary = summarizeHouseholdWealth(residences.values());
assert.equal(summary.totalWealth, 12.5);
assert.equal(summary.occupiedHomes, 2);
assert.equal(summary.homesWithSavings, 1);

const chapelTithe = estimateVillageChapelTithePerDay(
  residences.values(),
  () => ({ kind: 'chapel', assignedLabor: 1 } as never),
);
assert.ok(chapelTithe > 0);

const savings = estimateVillageHouseholdSavingsPerDay(
  [{ kind: 'apple_orchard', residenceId: 'residence-1' }],
  (id) => residences.get(id),
  taxRate,
  () => true,
);
assert.ok(savings > 0);

assert.equal(totalChapelCofferGold([{ kind: 'chapel', gold: 40 } as never, { kind: 'well', gold: 5 } as never]), 40);
assert.equal(CHAPEL_COFFER_CAPACITY, 500);

console.log('household economy tests passed');
