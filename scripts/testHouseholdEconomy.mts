import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHAPEL_BASE_ATTENDANCE_CHANCE,
  CHAPEL_COMMUNITY_ATTENDANCE_BONUS,
  CHAPEL_PRIEST_ATTENDANCE_BONUS,
  CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY,
  CHAPEL_COFFER_CAPACITY,
  CALENDAR_DAYS_PER_WEEK,
  HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE,
  HOUSEHOLD_MAX_WEALTH,
  HOUSEHOLD_PROJECT_WEALTH_RESERVE,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import {
  chapelAttendanceChance,
  chapelTitheGoldPerTick,
  expectedChapelTithePerDay,
  formatSettlementHouseholdProsperity,
  householdProsperityBand,
  householdNetIncomePerDay,
} from '../src/economy/householdWealth.ts';
import { GAME_WORKDAY_SECONDS } from '../src/world/gameCalendar.ts';
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
  Math.abs(
    tithePerTick
    - 3 * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY * SIM_TICK_SECONDS / GAME_WORKDAY_SECONDS,
  ) < 1e-9,
);
assert.ok(
  Math.abs(
    tithePerTick * GAME_WORKDAY_SECONDS / SIM_TICK_SECONDS
    - 3 * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY,
  ) < 1e-9,
  'a complete 06:00-20:00 workday must accrue the configured daily flat tithe',
);

const expectedDaily = expectedChapelTithePerDay(4, 1);
assert.ok(
  Math.abs(expectedDaily - 4 * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY * chapelAttendanceChance(1)) < 1e-9,
);
const expectedSabbathAverage = expectedChapelTithePerDay(4, 1, true);
assert.ok(
  Math.abs(
    expectedSabbathAverage
    - 4
      * CHAPEL_TITHE_GOLD_PER_PERSON_PER_DAY
      * chapelAttendanceChance(1, true)
      * (CALENDAR_DAYS_PER_WEEK - 1)
      / CALENDAR_DAYS_PER_WEEK,
  ) < 1e-9,
);
assert.ok(
  expectedSabbathAverage < expectedDaily,
  'the attendance bonus must not hide the coffer cost of a tithe-free Sunday',
);

const activity = 100;
const taxRate = 0.18;
const { adjusted, tax } = taxedEconomicActivity(activity, taxRate);
assert.equal(householdNetIncomePerDay(activity, taxRate), adjusted - tax);
assert.equal(HOUSEHOLD_MAX_WEALTH, 200);
assert.equal(householdProsperityBand(HOUSEHOLD_PROJECT_WEALTH_RESERVE - 0.01), 'limited');
assert.equal(householdProsperityBand(HOUSEHOLD_PROJECT_WEALTH_RESERVE), 'stable');
assert.equal(householdProsperityBand(HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE), 'prosperous');

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
    tier: 1,
    food: 20,
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
assert.equal(
  formatSettlementHouseholdProsperity(residences.values()),
  '0 prosperous · 1 stable · 1 limited',
);

const chapelTithe = estimateVillageChapelTithePerDay(
  residences.values(),
  () => ({ kind: 'chapel', assignedLabor: 1 } as never),
);
assert.ok(chapelTithe > 0);
const sabbathChapelTithe = estimateVillageChapelTithePerDay(
  residences.values(),
  () => ({ kind: 'chapel', assignedLabor: 1 } as never),
  true,
);
assert.ok(sabbathChapelTithe < chapelTithe);

const savings = estimateVillageHouseholdSavingsPerDay(
  [{ kind: 'apple_orchard', residenceId: 'residence-1' }],
  (id) => residences.get(id),
  taxRate,
  () => true,
);
assert.ok(savings > 0);

assert.equal(totalChapelCofferGold([{ kind: 'chapel', gold: 40 } as never, { kind: 'well', gold: 5 } as never]), 40);
assert.equal(CHAPEL_COFFER_CAPACITY, 500);

const discretionaryTrade = readFileSync(
  new URL('../server/src/simulation/household_discretionary_trade.rs', import.meta.url),
  'utf8',
);
assert.match(
  discretionaryTrade,
  /clock\.hour != 18[\s\S]*last_discretionary_market_day != day_marker/,
  'optional purchases must be limited to one evening market call per household and day',
);
assert.match(
  discretionaryTrade,
  /HOUSEHOLD_DISCRETIONARY_MIN_TIER[\s\S]*HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE/,
  'only comfortable households with savings above the protected reserve may shop',
);
assert.match(
  discretionaryTrade,
  /basic_buffers_are_safe[\s\S]*settlement_buffers_ready/,
  'food, fuel, water, and active-need buffers must be safe before optional spending',
);
for (const commodity of ['Ale', 'Wine', 'Honey', 'Cheese', 'Cloth', 'Pottery']) {
  assert.match(discretionaryTrade, new RegExp(`CommodityKind::${commodity}`));
}
const withdrawIndex = discretionaryTrade.indexOf('withdraw_building_commodity');
const debitIndex = discretionaryTrade.indexOf('debit_residence_wealth(ctx, residence');
const receiptIndex = discretionaryTrade.indexOf('credit_local_purchase_receipt(ctx, trading_post');
assert.ok(withdrawIndex >= 0 && withdrawIndex < debitIndex && debitIndex < receiptIndex);
assert.match(
  discretionaryTrade,
  /updated\.last_discretionary_market_day = day_marker/,
  'a completed purchase must close that household market call for the day',
);

const fiscalAccounting = readFileSync(
  new URL('../server/src/economy/fiscal_accounting.rs', import.meta.url),
  'utf8',
);
assert.match(
  fiscalAccounting,
  /credit_local_purchase_receipt[\s\S]*producer_income[\s\S]*local_tax/,
  'local purchases must split conserved payment into producer proceeds and collectible tax',
);
assert.match(
  fiscalAccounting,
  /local_discretionary_spend_total \+= split\.producer_income \+ split\.local_tax[\s\S]*local_producer_income_total \+= split\.producer_income/,
  'the economy ledger must report both gross local spending and producer income',
);

const residenceInspector = readFileSync(
  new URL('../src/resources/inspector/residenceRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(residenceInspector, /Household prosperity/);
assert.doesNotMatch(residenceInspector, /Household wealth/);

const frontierSecurity = readFileSync(
  new URL('../src/security/frontierSecurity.ts', import.meta.url),
  'utf8',
);
assert.match(frontierSecurity, /private purse/);
assert.doesNotMatch(frontierSecurity, /household gold/);

const refugeInspector = readFileSync(
  new URL('../src/resources/inspector/palisadedRefugeRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(refugeInspector, /Private savings travel with assigned families/);
assert.doesNotMatch(refugeInspector, /Math\.round\(sheltered\.shelteredWealth\)/);

console.log('household economy tests passed');
