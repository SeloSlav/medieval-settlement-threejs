import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CALENDAR_SECONDS_PER_DAY,
  RESIDENCE_SERVICE_MAX_PENALTY_DAYS,
  RESIDENCE_SERVICE_MIN_ECONOMIC_MULTIPLIER,
  RESIDENCE_SERVICE_WARNING_DAYS,
  RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import {
  residenceServiceState,
  serviceEconomicMultiplier,
} from '../src/economy/residenceSatisfaction.ts';
import type { ResidenceState } from '../src/resources/types.ts';

assert.equal(RESIDENCE_SERVICE_WARNING_DAYS, 3);
assert.equal(RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS, 6);
assert.equal(RESIDENCE_SERVICE_MAX_PENALTY_DAYS, 18);
assert.equal(RESIDENCE_SERVICE_MIN_ECONOMIC_MULTIPLIER, 0.55);
assert.ok(
  RESIDENCE_SERVICE_WARNING_DAYS < RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
  'players need a visible recovery window before residence promotion locks',
);
assert.ok(
  RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS < RESIDENCE_SERVICE_MAX_PENALTY_DAYS,
  'the economic consequence should ramp instead of jumping to its maximum',
);

assert.equal(serviceEconomicMultiplier(0), 1);
assert.equal(serviceEconomicMultiplier(RESIDENCE_SERVICE_WARNING_DAYS), 1);
assert.equal(
  serviceEconomicMultiplier(RESIDENCE_SERVICE_MAX_PENALTY_DAYS),
  RESIDENCE_SERVICE_MIN_ECONOMIC_MULTIPLIER,
);
assert.equal(
  serviceEconomicMultiplier(RESIDENCE_SERVICE_MAX_PENALTY_DAYS + 100),
  RESIDENCE_SERVICE_MIN_ECONOMIC_MULTIPLIER,
);

let previous = 1;
for (let day = 0; day <= RESIDENCE_SERVICE_MAX_PENALTY_DAYS + 5; day += 0.25) {
  const current = serviceEconomicMultiplier(day);
  assert.ok(current <= previous + 1e-12, 'service penalty must be monotonic');
  assert.ok(current >= RESIDENCE_SERVICE_MIN_ECONOMIC_MULTIPLIER);
  assert.ok(current <= 1);
  previous = current;
}

const warning = serviceStateAtDays(RESIDENCE_SERVICE_WARNING_DAYS);
assert.equal(warning.warning, true);
assert.equal(warning.upgradeBlocked, false);
assert.equal(warning.economicMultiplier, 1);

const blocked = serviceStateAtDays(RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS);
assert.equal(blocked.warning, true);
assert.equal(blocked.upgradeBlocked, true);
assert.ok(blocked.economicMultiplier < 1);
assert.ok(blocked.economicMultiplier > RESIDENCE_SERVICE_MIN_ECONOMIC_MULTIPLIER);

const balance = JSON.parse(source('../balance/gameBalance.json')) as Record<string, unknown>;
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
assert.match(source('../server/src/simulation/backyard_garden.rs'), /service_economic_multiplier/);
assert.match(source('../server/src/reducers/residences.rs'), /service_shortage_blocks_upgrade/);
assert.match(source('../src/data/spacetimeTableSync/syncResidences.ts'), /abandoned: false/);
assert.doesNotMatch(source('../src/generated/index.ts'), /repair_residence_decay/);

console.log('persistent-home satisfaction balance tests passed');

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

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}
