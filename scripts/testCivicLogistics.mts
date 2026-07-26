import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { getBuildingExtent } from '../src/buildings/buildingExtents.ts';
import {
  BUILDING_DEFINITIONS,
  BUILDING_KINDS,
  BUILDING_STORAGE_CAPS,
  STOREHOUSE_HAUL_PER_WORKER,
  STOREHOUSE_OVERFLOW_THRESHOLD,
  TOWN_HALL_POPULATION_REQUIRED,
  TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import { BUILDING_KIND_TO_MENU_ACTION, MENU_ACTION_TO_BUILDING_KIND } from '../src/ui/buildMenuMapping.ts';
import { BASIC_BUILD_MENU_ENTRIES } from '../src/ui/buildMenuCards.ts';

assert.ok(BUILDING_KINDS.includes('town_hall'));
assert.ok(BUILDING_KINDS.includes('village_storehouse'));
assert.equal(TOWN_HALL_POPULATION_REQUIRED, 24);
assert.ok(TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER > 0 && TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER < 1);
assert.ok(STOREHOUSE_OVERFLOW_THRESHOLD >= 0.5 && STOREHOUSE_OVERFLOW_THRESHOLD < 1);
assert.ok(STOREHOUSE_HAUL_PER_WORKER > 0);

assert.equal(BUILDING_DEFINITIONS.town_hall.workRadius, 0, 'Town Hall is governance, not an area-of-effect producer');
assert.equal(BUILDING_DEFINITIONS.village_storehouse.workRadius, 0, 'Storehouse uses roads rather than a ground ring');
assert.equal(getBuildingExtent('town_hall', 0), null);
assert.equal(getBuildingExtent('village_storehouse', 0), null);
assert.equal(BUILDING_STORAGE_CAPS.town_hall.timber, 0);
assert.equal(BUILDING_STORAGE_CAPS.village_storehouse.food ?? 0, 0, 'storehouse must never replace the granary');
assert.equal(BUILDING_STORAGE_CAPS.village_storehouse.grain ?? 0, 0, 'storehouse must never accept grain');
assert.ok(BUILDING_STORAGE_CAPS.village_storehouse.timber >= 300);
assert.ok(BUILDING_STORAGE_CAPS.village_storehouse.stone >= 300);

assert.equal(BUILDING_KIND_TO_MENU_ACTION.town_hall, 'town-hall');
assert.equal(BUILDING_KIND_TO_MENU_ACTION.village_storehouse, 'village-storehouse');
assert.equal(MENU_ACTION_TO_BUILDING_KIND['town-hall'], 'town_hall');
assert.equal(MENU_ACTION_TO_BUILDING_KIND['village-storehouse'], 'village_storehouse');
assert.ok(BASIC_BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'town_hall'));
assert.ok(BASIC_BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'village_storehouse'));

for (const kind of ['town_hall', 'village_storehouse'] as const) {
  const model = createBuildingMesh(kind);
  let meshes = 0;
  model.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes += 1; });
  assert.ok(meshes >= 20, `${kind} needs a composed, legible procedural model`);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  assert.ok(size.x > 8 && size.y > 5 && size.z > 6, `${kind} needs a civic/logistics-scale silhouette`);
}

const placement = fs.readFileSync('server/src/reducers/buildings.rs', 'utf8');
assert.match(placement, /Only one Town Hall may serve a settlement/);
assert.match(placement, /population < TOWN_HALL_POPULATION_REQUIRED/);
assert.match(placement, /Build a chapel before founding the Town Hall/);
assert.match(placement, /Build a marketplace before founding the Town Hall/);
assert.match(placement, /road-linked to both the chapel and marketplace/);
assert.match(placement, /pub fn set_storehouse_policy/);

const admin = fs.readFileSync('server/src/reducers/village_admin.rs', 'utf8');
assert.match(admin, /require_owned_building\(ctx, "town_hall", true\)/, 'tax policy must require a staffed Town Hall');
assert.match(admin, /require_owned_building\(ctx, "chapel", false\)/, 'parish policy must live at a chapel');
assert.match(admin, /require_owned_building\(ctx, "monastery", false\)/, 'monastery policy must live at a monastery');

const hauling = fs.readFileSync('server/src/simulation/village_storehouse.rs', 'utf8');
assert.match(hauling, /STOREHOUSE_OVERFLOW_THRESHOLD/);
assert.match(hauling, /"lumber_mill"[\s\S]*CommodityKind::Timber/);
assert.match(hauling, /"stone_quarry"[\s\S]*CommodityKind::Stone/);
assert.match(hauling, /"woodcutters_lodge"[\s\S]*CommodityKind::Firewood/);
assert.doesNotMatch(hauling, /CommodityKind::(?:Food|Grain|Flour|Ale|PreservedFood)/);
assert.match(hauling, /road_path_distance/);
assert.match(hauling, /try_start_building_supply_trip/);
assert.match(
  hauling,
  /building_ids_for_kinds\(ctx,\s*owner,\s*STOREHOUSE_OVERFLOW_SOURCE_KINDS\)/,
  'each owner-wide depot pass should inspect only indexed overflow-source kinds',
);
assert.match(hauling, /pub fn step_village_storehouses/);
assert.match(hauling, /idle_by_owner: HashMap<Identity, Vec<Building>>/);

const aggregate = fs.readFileSync('server/src/economy/aggregate_spend.rs', 'utf8');
assert.match(
  aggregate,
  /sort_by_key\(\|building\|\s*\{[\s\S]{0,80}building\.kind == "village_storehouse"[\s\S]{0,80}\b0\b[\s\S]{0,80}else[\s\S]{0,80}\b1\b/,
);
const processors = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(processors, /"village_storehouse"/, 'storehouse firewood must support specialist processing');

const inspector = fs.readFileSync('src/resources/ResourceInspector.ts', 'utf8');
assert.match(inspector, /data-policy-tax-rate/);
assert.match(inspector, /data-policy-chapel-reserve/);
assert.match(inspector, /data-policy-monastery-tithe/);
assert.match(inspector, /data-storehouse-accepts-timber/);
const bootstrap = fs.readFileSync('src/app/appBootstrap.ts', 'utf8');
assert.match(bootstrap, /resourceInspector\.selectBuilding\(townHall\.id\)/);
assert.doesNotMatch(bootstrap, /new CityAdministrationPanel/);

console.log('Town Hall and village storehouse gameplay tests passed');
