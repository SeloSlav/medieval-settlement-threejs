import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FORAGER_REMEDIES_PER_HARVEST,
  FORAGER_REMEDY_SEASON_END_MONTH,
  FORAGER_REMEDY_SEASON_START_MONTH,
  REMEDIES_PER_DELIVERY,
  REMEDY_DELIVERY_TARGET_DAYS,
} from '../src/generated/gameBalance.ts';
import {
  cargoKindFromId,
  cargoKindLabel,
  destinationKindFromId,
} from '../src/logistics/deliveryTrips.ts';
import {
  createDeliveryCartMesh,
  disposeDeliveryCartMesh,
} from '../src/logistics/deliveryCartMesh.ts';
import { createForagersShedMesh } from '../src/buildings/meshes/serviceBuildingMeshes.ts';

const root = resolve(import.meta.dirname, '..');
const read = (relative: string): string =>
  readFileSync(resolve(root, relative), 'utf8');

assert.ok(FORAGER_REMEDIES_PER_HARVEST > 0);
assert.ok(FORAGER_REMEDY_SEASON_START_MONTH >= 3);
assert.ok(FORAGER_REMEDY_SEASON_END_MONTH <= 11);
assert.ok(FORAGER_REMEDY_SEASON_START_MONTH < FORAGER_REMEDY_SEASON_END_MONTH);
assert.ok(REMEDIES_PER_DELIVERY > 0);
assert.ok(REMEDY_DELIVERY_TARGET_DAYS >= 1);

const balance = JSON.parse(read('balance/gameBalance.json'));
assert.ok(balance.buildings.foragers_shed.storage.remedies > 0);
assert.ok(balance.buildings.salvage_pile.storage.remedies > 0);

assert.equal(cargoKindFromId(25), 'remedies');
assert.equal(cargoKindLabel('remedies'), 'Dried remedies');
assert.equal(destinationKindFromId(4), 'care');

const deliveryServer = read('server/src/simulation/delivery_trips.rs');
for (const token of [
  'DELIVERY_DESTINATION_RESIDENCE_REMEDY',
  'try_start_remedy_delivery_trip',
  'withdraw_building_commodity(origin, CommodityKind::Remedies',
  'unload_remedies_to_residence',
  'HERB_REMEDY_CAPACITY',
]) {
  assert.ok(deliveryServer.includes(token), `missing physical remedy trip behavior: ${token}`);
}

const supplierServer = read('server/src/simulation/food_supplier.rs');
for (const token of [
  'FORAGER_REMEDIES_PER_HARVEST',
  'deposit_building_commodity',
  'collect_remedy_target',
  'try_start_remedy_delivery_trip',
]) {
  assert.ok(supplierServer.includes(token), `missing forager remedy behavior: ${token}`);
}

const routePolicy = read('server/src/simulation/road_logistics.rs');
const remedySelector = routePolicy.match(
  /pub fn select_residence_for_remedy_delivery[\s\S]*?(?=\n\/\/\/ Assign every residence)/,
)?.[0] ?? '';
assert.match(remedySelector, /road_path_distances_from/);
assert.doesNotMatch(
  remedySelector,
  /road_path_distance\(/,
  'care targeting must use one batched graph solve instead of one pathfind per home',
);
assert.match(remedySelector, /Reverse\(residence\.sick_population\)/);

const security = read('server/src/simulation/settlement_security.rs');
assert.match(security, /CommodityKind::Remedies[\s\S]*stores\.remedies/);
assert.match(security, /building\.remedies = stores\.remedies/);
const reclamation = read('server/src/simulation/reclamation.rs');
assert.match(reclamation, /CommodityKind::Remedies[\s\S]*"foragers_shed"/);

const villagerSource = read('src/settlement/VillagerRenderer.ts');
assert.match(villagerSource, /sick_rest/);
assert.match(villagerSource, /Ill and homebound/);
assert.match(villagerSource, /transitionToSickRest/);

const shed = createForagersShedMesh();
assert.ok(shed.getObjectByName('ForagersFoodStockpile'));
assert.ok(shed.getObjectByName('ForagersRemedyStockpile'));
assert.equal(
  shed.getObjectsByProperty('name', 'ForagersRemedySegment').length,
  4,
  'the drying porch should show four declining remedy-stock bands',
);

const cart = createDeliveryCartMesh('remedies');
assert.ok(cart.getObjectByName('Remedy herb basket'));
assert.ok(cart.getObjectByName('Remedy storage crock'));
assert.ok(cart.getObjectByName('Dried remedy bundle 1'));
disposeDeliveryCartMesh(cart);

console.log('Physical remedy harvesting, care logistics, visuals, and illness labor contract verified.');
