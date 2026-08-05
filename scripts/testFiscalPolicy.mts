import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  burgageZoneArea,
  forecastMonthlyLandLevy,
  householdImportDuty,
  landLevyAssessedValue,
  splitPrivateExportReceipt,
} from '../src/economy/fiscalPolicy.ts';
import {
  EXPORT_DUTY_RATE_MAX,
  IMPORT_DUTY_RATE_MAX,
  LAND_LEVY_RATE_MAX,
} from '../src/generated/gameBalance.ts';
import type { GameState } from '../src/resources/types.ts';

const zone = {
  id: 'zone-1',
  cornerA: { x: 0, z: 0 },
  cornerB: { x: 20, z: 0 },
  cornerC: { x: 20, z: 12 },
  cornerD: { x: 0, z: 12 },
  frontageEdge: 0 as const,
  plotCount: 1,
};
assert.equal(burgageZoneArea(zone), 240);

const basicValue = landLevyAssessedValue(1, 240, false);
const improvedValue = landLevyAssessedValue(3, 336, true);
assert.ok(improvedValue > basicValue, 'larger prosperous improved plots should assess higher');

const state = {
  burgageZones: new Map([[zone.id, zone]]),
  residences: new Map([[
    'home-1',
    {
      id: 'home-1',
      zoneId: zone.id,
      population: 5,
      abandoned: false,
      tier: 1,
      householdWealth: 0.2,
    },
  ]]),
  backyardGardens: new Map(),
} as unknown as GameState;
const forecast = forecastMonthlyLandLevy(state, LAND_LEVY_RATE_MAX, 1);
assert.equal(forecast.occupiedHomes, 1);
assert.equal(forecast.monthlyAssessed, basicValue * LAND_LEVY_RATE_MAX / 12);
assert.equal(forecast.monthlyCollectable, 0.2, 'land levy never drives household wealth below zero');

assert.equal(householdImportDuty(20, IMPORT_DUTY_RATE_MAX), 20 * IMPORT_DUTY_RATE_MAX);
assert.equal(householdImportDuty(20, -1), 0);
const split = splitPrivateExportReceipt(100, EXPORT_DUTY_RATE_MAX);
assert.equal(split.exportDuty, 100 * EXPORT_DUTY_RATE_MAX);
assert.equal(split.householdIncome + split.exportDuty, 100);

const fiscalServer = readFileSync('server/src/economy/fiscal_accounting.rs', 'utf8');
const parishServer = readFileSync('server/src/simulation/chapel_parish.rs', 'utf8');
const chapelReducer = readFileSync('server/src/reducers/buildings.rs', 'utf8');
assert.match(fiscalServer, /credit_private_export_receipt/);
assert.match(fiscalServer, /credit_household_import_duty/);
assert.doesNotMatch(parishServer, /try_start_chapel_treasury_trip|auto_sweep/);
assert.match(chapelReducer, /cannot be transferred to the civic treasury/);

console.log('Fiscal policy checks passed.');
