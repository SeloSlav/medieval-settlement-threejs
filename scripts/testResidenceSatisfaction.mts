import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CALENDAR_SECONDS_PER_DAY,
  HOUSEHOLD_TIER4_SHORTAGE_DISCRETIONARY_MULTIPLIER,
  RESIDENCE_SERVICE_WARNING_DAYS,
  RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import {
  formatResidenceServiceConsequence,
  residenceServiceState,
} from '../src/economy/residenceSatisfaction.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import type { ResidenceState } from '../src/resources/types.ts';

assert.equal(RESIDENCE_SERVICE_WARNING_DAYS, 3);
assert.equal(RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS, 6);
assert.ok(
  RESIDENCE_SERVICE_WARNING_DAYS < RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
  'players need a visible recovery window before residence promotion locks',
);

const warning = serviceStateAtDays(RESIDENCE_SERVICE_WARNING_DAYS);
assert.equal(warning.warning, true);
assert.equal(warning.upgradeBlocked, false);

const blocked = serviceStateAtDays(RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS);
assert.equal(blocked.warning, true);
assert.equal(blocked.upgradeBlocked, true);

const tierFourLuxuryPressure = tierFourLuxuryStateAtDays(RESIDENCE_SERVICE_WARNING_DAYS);
assert.equal(
  tierFourLuxuryPressure.discretionarySpendingMultiplier,
  HOUSEHOLD_TIER4_SHORTAGE_DISCRETIONARY_MULTIPLIER,
);
assert.match(
  formatResidenceServiceConsequence(tierFourLuxuryPressure),
  /optional spending and local market tax reduced 25% · work continues normally/,
);
assert.equal(
  tierFourLuxuryStateAtDays(RESIDENCE_SERVICE_WARNING_DAYS - 0.01)
    .discretionarySpendingMultiplier,
  1,
  'Tier 4 keeps its logistics grace period before the economic consequence begins',
);
assert.equal(
  tierFourLuxuryStateAtDays(RESIDENCE_SERVICE_WARNING_DAYS, 3)
    .discretionarySpendingMultiplier,
  1,
  'the non-vital spending consequence is exclusive to Tier 4',
);

const balance = JSON.parse(source('../balance/gameBalance.json')) as {
  population: Record<string, unknown>;
};
for (const removedKey of [
  'residenceServiceMaxPenaltyDays',
  'residenceServiceMinEconomicMultiplier',
]) {
  assert.equal(removedKey in balance.population, false, `${removedKey} must stay removed`);
}
for (const removedKey of [
  'abandonAfterDeficitTicks',
  'comfortMigrationStartDays',
  'residenceNeglectedAfterVacantDays',
  'residenceDilapidatedAfterVacantDays',
  'residenceRuinedAfterVacantDays',
]) {
  assert.equal(removedKey in balance, false, `${removedKey} must stay removed`);
}

assert.match(source('../server/src/simulation/residence_lifecycle.rs'), /permanent housing stock/);
assert.match(source('../server/src/simulation/residence_lifecycle.rs'), /residence\.abandoned = false/);
assert.doesNotMatch(source('../server/src/simulation/residence_needs/mod.rs'), /comfort_migration_due/);
assert.doesNotMatch(source('../server/src/simulation/backyard_garden.rs'), /service_economic_multiplier/);
assert.doesNotMatch(source('../server/src/residence_service_policy.rs'), /economic_multiplier/);
assert.match(source('../server/src/reducers/residences.rs'), /service_shortage_blocks_upgrade/);
assert.match(source('../src/data/spacetimeTableSync/syncResidences.ts'), /abandoned: false/);
assert.doesNotMatch(source('../src/generated/index.ts'), /repair_residence_decay/);

console.log('persistent-home satisfaction and full-output balance tests passed');

function serviceStateAtDays(days: number) {
  return residenceServiceState({
    tier: 1,
    needs: {
      firewood: { stock: 0, deficitTicks: 0 },
      water: { stock: 0, deficitTicks: 0 },
      food: {
        stock: 0,
        deficitTicks: days * CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS,
      },
      preservedFood: { stock: 0, deficitTicks: 0 },
      ale: { stock: 0, deficitTicks: 0 },
      cloth: { stock: 0, deficitTicks: 0 },
      pottery: { stock: 0, deficitTicks: 0 },
    },
  } as Pick<ResidenceState, 'needs' | 'tier'>);
}

function tierFourLuxuryStateAtDays(days: number, tier: 3 | 4 = 4) {
  const needs = createDefaultNeeds();
  needs.luxury.deficitTicks = days * CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS;
  return residenceServiceState({ tier, needs });
}

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
