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
import {
  monasteryCharterLabel,
  normalizeMonasteryCharterRate,
} from '../src/economy/monasteryPolicy.ts';

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
assert.equal(forecast.collectableHomes, 1);
const topologyState = {
  ...state,
  buildings: new Map([[
    'market-1',
    {
      id: 'market-1',
      kind: 'marketplace',
      constructionComplete: true,
      x: 0,
      z: 0,
    },
  ]]),
  fireIncidents: new Map(),
} as unknown as GameState;
const disconnectedForecast = forecastMonthlyLandLevy(
  topologyState,
  LAND_LEVY_RATE_MAX,
  1,
  () => false,
);
assert.equal(disconnectedForecast.monthlyAssessed, forecast.monthlyAssessed);
assert.equal(disconnectedForecast.monthlyCollectable, 0);
assert.equal(disconnectedForecast.unservedHomes, 1);
assert.equal(
  forecastMonthlyLandLevy(topologyState, LAND_LEVY_RATE_MAX, 1, () => true).monthlyCollectable,
  0.2,
  'forecast collection must require the same operational Marketplace road branch as the server',
);

assert.equal(householdImportDuty(20, IMPORT_DUTY_RATE_MAX), 20 * IMPORT_DUTY_RATE_MAX);
assert.equal(householdImportDuty(20, -1), 0);
const split = splitPrivateExportReceipt(100, EXPORT_DUTY_RATE_MAX);
assert.equal(split.exportDuty, 100 * EXPORT_DUTY_RATE_MAX);
assert.equal(split.householdIncome + split.exportDuty, 100);
assert.equal(normalizeMonasteryCharterRate(-1), 0);
assert.equal(normalizeMonasteryCharterRate(0.12), 0.10);
assert.equal(normalizeMonasteryCharterRate(0.24), 0.25);
assert.equal(monasteryCharterLabel(0), 'Chartered immunity');
assert.equal(monasteryCharterLabel(0.10), 'Customary aid');
assert.equal(monasteryCharterLabel(0.25), 'Extraordinary subsidy');

const fiscalServer = readFileSync('server/src/economy/fiscal_accounting.rs', 'utf8');
const villageAdminServer = readFileSync('server/src/reducers/village_admin.rs', 'utf8');
const monasteryEconomyServer = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const parishServer = readFileSync('server/src/simulation/chapel_parish.rs', 'utf8');
const chapelReducer = readFileSync('server/src/reducers/buildings.rs', 'utf8');
assert.match(fiscalServer, /credit_private_export_receipt/);
const monasteryReceiptSource = fiscalServer.slice(
  fiscalServer.indexOf('pub fn credit_monastery_export_receipt'),
  fiscalServer.indexOf('pub fn credit_local_purchase_receipt'),
);
assert.match(monasteryReceiptSource, /player_monastery_levy_rate/);
assert.doesNotMatch(monasteryReceiptSource, /player_export_duty_rate/);
assert.match(monasteryReceiptSource, /monastery_levy_collected_total/);
assert.match(
  villageAdminServer,
  /set_monastery_charter[\s\S]*?require_owned_building\(ctx, "town_hall", true\)[\s\S]*?is_valid_monastery_levy_rate/,
  'only a staffed Town Hall may select one of the three authoritative charter rates',
);
assert.match(
  monasteryEconomyServer,
  /monastery_pilgrimage_gold[\s\S]*?credit_monastery_export_receipt/,
  'pilgrimage offerings must enter the autonomous monastery receipt split',
);
assert.match(
  monasteryEconomyServer,
  /fn fund_monastery_services[\s\S]*?monastery_daily_service_cost[\s\S]*?due\.min\(private_gold\)[\s\S]*?paid \/ due/,
  'service strength must derive from the fraction of recurring costs the retained purse actually pays',
);
assert.doesNotMatch(fiscalServer, /credit_household_import_duty/);
assert.doesNotMatch(parishServer, /try_start_chapel_treasury_trip|auto_sweep/);
assert.match(chapelReducer, /cannot be transferred to the civic treasury/);

console.log('Fiscal policy checks passed.');
