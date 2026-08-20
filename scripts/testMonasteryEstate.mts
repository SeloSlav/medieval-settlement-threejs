import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  MONASTERY_ESTATE_DEPTH,
  MONASTERY_ESTATE_WIDTH,
  monasteryEstateFitsMap,
  monasteryEstateFootprintCorners,
  monasteryEstateIsNearMapEdge,
  monasteryEstateNextInvestmentCost,
  monasteryEstateYields,
  monasteryInfirmaryBeds,
  monasteryInfirmaryMortalityMultiplier,
  monasteryInfirmaryRecoveryMultiplier,
} from '../src/buildings/monasteryEstate.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';

assert.equal(MONASTERY_ESTATE_WIDTH, 68);
assert.equal(MONASTERY_ESTATE_DEPTH, 53);
assert.deepEqual(monasteryEstateFootprintCorners(0, 0, 0), [
  { x: -34, z: -45.5 },
  { x: 34, z: -45.5 },
  { x: 34, z: 7.5 },
  { x: -34, z: 7.5 },
]);

const smallBounds = { minX: -408.5, maxX: 408.5, minZ: -408.5, maxZ: 408.5 };
assert.equal(monasteryEstateFitsMap(0, 350, 0, smallBounds), true);
assert.equal(monasteryEstateIsNearMapEdge(0, 350, 0, smallBounds), true);
assert.equal(monasteryEstateIsNearMapEdge(0, 0, 0, smallBounds), false);
assert.equal(monasteryEstateFitsMap(0, 405, 0, smallBounds), false);

assert.equal(monasteryEstateNextInvestmentCost(0), 18);
assert.equal(monasteryEstateNextInvestmentCost(1), 42);
assert.equal(monasteryEstateNextInvestmentCost(2), 78);
assert.equal(monasteryEstateNextInvestmentCost(3), null);
assert.ok(monasteryEstateYields(3).apples > monasteryEstateYields(0).apples);
assert.equal(monasteryEstateYields(0).cheese, 0);
assert.ok(monasteryEstateYields(1).cheese > 0);
assert.equal(monasteryInfirmaryBeds(0), 4);
assert.equal(monasteryInfirmaryBeds(3), 10);
assert.ok(monasteryInfirmaryRecoveryMultiplier(3) > monasteryInfirmaryRecoveryMultiplier(0));
assert.ok(monasteryInfirmaryMortalityMultiplier(3) < monasteryInfirmaryMortalityMultiplier(0));

for (const level of [0, 1, 2, 3] as const) {
  const mesh = createBuildingMesh('monastery', level);
  const estate = mesh.getObjectByName(`Monastery enclosed estate level ${level}`);
  assert.ok(estate instanceof THREE.Group, `estate level ${level} must be rendered`);
  assert.ok(mesh.getObjectByName('Monastery estate rear fence'));
  assert.ok(mesh.getObjectByName('Monastery ale brewhouse and cellar yard'));
  assert.ok(mesh.getObjectByName('Monastery apple orchard'));
  assert.ok(mesh.getObjectByName('Monastery bee garden'));
  assert.ok(mesh.getObjectByName('Monastery chicken yard'));
  assert.ok(mesh.getObjectByName('Monastery infirmary wing'));
}
assert.ok(createBuildingMesh('monastery', 1).getObjectByName('Monastery invested dairy'));
assert.ok(createBuildingMesh('monastery', 2).getObjectByName('Monastery invested tithe barn'));
assert.ok(createBuildingMesh('monastery', 3).getObjectByName('Monastery invested apple press'));

const serverPolicy = readFileSync(new URL('../server/src/monastery_estate_policy.rs', import.meta.url), 'utf8');
assert.match(serverPolicy, /MONASTERY_ESTATE_HALF_WIDTH: f64 = 34\.0/);
assert.match(serverPolicy, /INVESTMENT_COSTS: \[f64; 3\] = \[18\.0, 42\.0, 78\.0\]/);
assert.match(serverPolicy, /MONASTERY_ESTATE_EXPORT_LOT: f64 = 6\.0/);
assert.match(serverPolicy, /INFIRMARY_BEDS: \[u32; 4\] = \[4, 6, 8, 10\]/);

const simulation = readFileSync(new URL('../server/src/simulation/expanded_economy.rs', import.meta.url), 'utf8');
assert.match(simulation, /fn reinvest_monastery_estate/);
assert.match(simulation, /fn dispatch_monastery_estate_export/);
assert.match(simulation, /CommodityKind::Apples, yields\.apples/);
assert.match(simulation, /start_regional_market_export_trip/);

const healthSimulation = readFileSync(new URL('../server/src/simulation/residence_needs/mod.rs', import.meta.url), 'utf8');
assert.match(healthSimulation, /fund_monastery_infirmary_care/);
assert.match(healthSimulation, /infirmary_recovery_multiplier/);

const deliveryTrips = readFileSync(new URL('../server/src/simulation/delivery_trips.rs', import.meta.url), 'utf8');
assert.match(deliveryTrips, /credit_monastery_export_receipt/);

console.log('monastery estate tests passed');
