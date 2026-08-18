import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { getBuildingExtent } from '../src/buildings/buildingExtents.ts';
import {
  assignMarketplaceStallRoster,
  assignMarketplaceStalls,
} from '../src/economy/marketStallAssignments.ts';
import {
  BUILDING_DEFINITIONS,
  BUILDING_KINDS,
  BUILDING_STORAGE_CAPS,
  MARKETPLACE_FOOD_STALL_SLOTS,
  MARKETPLACE_GOODS_STALL_SLOTS,
  STOREHOUSE_HAUL_PER_WORKER,
  STOREHOUSE_OVERFLOW_THRESHOLD,
  TOWN_HALL_POPULATION_REQUIRED,
  TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import { BUILDING_KIND_TO_MENU_ACTION, MENU_ACTION_TO_BUILDING_KIND } from '../src/ui/buildMenuMapping.ts';
import { CIVIC_BUILD_MENU_ENTRIES } from '../src/ui/buildMenuCards.ts';
import type { BuildingState } from '../src/resources/types.ts';

assert.ok(BUILDING_KINDS.includes('town_hall'));
assert.ok(BUILDING_KINDS.includes('village_storehouse'));
assert.ok(BUILDING_KINDS.includes('granary'));
assert.ok(BUILDING_KINDS.includes('bakery'));
assert.equal(TOWN_HALL_POPULATION_REQUIRED, 24);
assert.ok(TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER > 0 && TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER < 1);
assert.ok(STOREHOUSE_OVERFLOW_THRESHOLD >= 0.5 && STOREHOUSE_OVERFLOW_THRESHOLD < 1);
assert.ok(STOREHOUSE_HAUL_PER_WORKER > 0);
assert.equal(MARKETPLACE_FOOD_STALL_SLOTS, 3);
assert.equal(MARKETPLACE_GOODS_STALL_SLOTS, 3);

assert.equal(BUILDING_DEFINITIONS.town_hall.workRadius, 0, 'Town Hall is governance, not an area-of-effect producer');
assert.equal(BUILDING_DEFINITIONS.village_storehouse.workRadius, 0, 'Storehouse uses roads rather than a ground ring');
assert.equal(BUILDING_DEFINITIONS.marketplace.workRadius, 0, 'Marketplace serves its full road network');
assert.equal(getBuildingExtent('town_hall', 0), null);
assert.equal(getBuildingExtent('village_storehouse', 0), null);
assert.equal(getBuildingExtent('marketplace', 0), null);
assert.equal(BUILDING_STORAGE_CAPS.town_hall.timber, 0);
assert.equal(BUILDING_STORAGE_CAPS.village_storehouse.food ?? 0, 0, 'storehouse must never replace the granary');
assert.equal(BUILDING_STORAGE_CAPS.village_storehouse.grain ?? 0, 0, 'storehouse must never accept grain');
assert.equal(BUILDING_STORAGE_CAPS.village_storehouse.flour ?? 0, 0, 'storehouse must never accept flour');
assert.equal(BUILDING_STORAGE_CAPS.village_storehouse.flax ?? 0, 0, 'storehouse must never accept farm crops');
assert.ok(BUILDING_STORAGE_CAPS.granary.food > 0, 'granary must shelter gathered foodstuffs');
assert.ok(BUILDING_STORAGE_CAPS.granary.grain > 0, 'granary must shelter grain crops');
assert.ok(BUILDING_STORAGE_CAPS.granary.barley > 0, 'granary must shelter barley crops');
assert.ok(BUILDING_STORAGE_CAPS.granary.flax > 0, 'granary must shelter flax crops');
assert.ok(BUILDING_STORAGE_CAPS.granary.flour > 0, 'granary must shelter flour');
assert.equal(BUILDING_STORAGE_CAPS.granary.firewood ?? 0, 0, 'granary must not keep bakery fuel');
assert.ok(BUILDING_STORAGE_CAPS.bakery.flour > 0, 'bakery must stage flour for bread');
assert.ok(BUILDING_STORAGE_CAPS.bakery.firewood > 0, 'bakery must stage oven fuel');
assert.ok(BUILDING_STORAGE_CAPS.bakery.water > 0, 'bakery must stage carted well water');
assert.ok(BUILDING_STORAGE_CAPS.village_storehouse.timber >= 300);
assert.ok(BUILDING_STORAGE_CAPS.village_storehouse.stone >= 300);

assert.equal(BUILDING_KIND_TO_MENU_ACTION.town_hall, 'town-hall');
assert.equal(BUILDING_KIND_TO_MENU_ACTION.village_storehouse, 'village-storehouse');
assert.equal(MENU_ACTION_TO_BUILDING_KIND['town-hall'], 'town_hall');
assert.equal(MENU_ACTION_TO_BUILDING_KIND['village-storehouse'], 'village_storehouse');
assert.ok(CIVIC_BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'town_hall'));
assert.ok(CIVIC_BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'village_storehouse'));

for (const kind of ['town_hall', 'village_storehouse'] as const) {
  const model = createBuildingMesh(kind);
  let meshes = 0;
  model.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshes += 1; });
  assert.ok(meshes >= 20, `${kind} needs a composed, legible procedural model`);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  assert.ok(size.x > 8 && size.y > 5 && size.z > 6, `${kind} needs a civic/logistics-scale silhouette`);
}

const marketplaceModel = createBuildingMesh('marketplace');
let foodStallTables = 0;
let goodsStallTables = 0;
marketplaceModel.traverse((object) => {
  if (object.name.startsWith('MarketFoodStall')) foodStallTables += 1;
  if (object.name.startsWith('MarketGoodsStall')) goodsStallTables += 1;
});
assert.equal(foodStallTables, MARKETPLACE_FOOD_STALL_SLOTS);
assert.equal(goodsStallTables, MARKETPLACE_GOODS_STALL_SLOTS);

const stallTestBuilding = (
  id: string,
  kind: BuildingState['kind'],
  x: number,
  assignedLabor: number,
  stock: Partial<BuildingState> = {},
): BuildingState => ({
  id,
  kind,
  x,
  z: 0,
  assignedLabor,
  constructionComplete: true,
  food: 0,
  ale: 0,
  preservedFood: 0,
  honey: 0,
  firewood: 0,
  water: 0,
  timber: 0,
  stone: 0,
  gold: 0,
  waterCapacity: 0,
  actionCooldown: 0,
  workRadius: 0,
  constructionProgress: 1,
  constructionRequiredTimber: 0,
  constructionRequiredStone: 0,
  constructionDeliveredTimber: 0,
  constructionDeliveredStone: 0,
  constructionReservedTimber: 0,
  constructionReservedStone: 0,
  constructionTreasuryTimber: 0,
  constructionTreasuryStone: 0,
  storehouseAcceptsTimber: true,
  storehouseAcceptsStone: true,
  storehouseAcceptsFirewood: true,
  ...stock,
} as BuildingState);
const nearMarket = stallTestBuilding('10', 'marketplace', 10, 0);
const farMarket = stallTestBuilding('20', 'marketplace', 100, 0);
const stockedGranary = stallTestBuilding('30', 'granary', 0, 2, {
  food: 20,
  ale: 12,
});
const stockedStorehouse = stallTestBuilding('40', 'village_storehouse', 2, 1, {
  pottery: 8,
});
const stallRoster = assignMarketplaceStalls(
  [nearMarket, farMarket, stockedGranary, stockedStorehouse],
  (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az),
);
assert.deepEqual(
  stallRoster.map((stall) => [
    stall.marketplaceId,
    stall.workplaceId,
    stall.needKind,
  ]),
  [
    ['10', '30', 'food'],
    ['10', '30', 'ale'],
    ['10', '40', 'pottery'],
  ],
  'each depot laborer should open one stocked category at the nearest Marketplace only',
);
const oneWorkerRoster = assignMarketplaceStalls(
  [nearMarket, farMarket, { ...stockedGranary, assignedLabor: 1 }],
  (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az),
);
assert.deepEqual(
  oneWorkerRoster.map((stall) => stall.needKind),
  ['food'],
  'one Granary worker must not unlock every food category or multiple market squares',
);
const standbyRoster = assignMarketplaceStallRoster(
  [
    nearMarket,
    farMarket,
    { ...stockedGranary, assignedLabor: 4, food: 0, ale: 0 },
  ],
  (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az),
);
assert.equal(standbyRoster.stalls.length, 0);
assert.deepEqual(
  standbyRoster.workers.map((worker) => [worker.marketplaceId, worker.needKind]),
  [
    ['10', null],
    ['10', null],
    ['10', null],
    ['20', null],
  ],
  'empty depot workers should reserve nearest tables up to physical capacity so producers can seed them',
);

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
assert.match(hauling, /local_delivery_distance/);
assert.match(hauling, /try_start_building_supply_trip/);
assert.match(
  hauling,
  /building_ids_for_kinds\(ctx,\s*owner,\s*STOREHOUSE_OVERFLOW_SOURCE_KINDS\)/,
  'each owner-wide depot pass should inspect only indexed overflow-source kinds',
);
assert.match(hauling, /pub fn step_storehouse_market_stalls/);
assert.match(hauling, /pub fn step_village_storehouse_overflow_collection/);
assert.match(hauling, /idle_by_owner: HashMap<Identity, Vec<Building>>/);

const aggregate = fs.readFileSync('server/src/economy/aggregate_spend.rs', 'utf8');
assert.match(
  aggregate,
  /sort_by_key\(\|building\|\s*\{[\s\S]{0,80}building\.kind == "village_storehouse"[\s\S]{0,80}\b0\b[\s\S]{0,80}else[\s\S]{0,80}\b1\b/,
);
const processors = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(processors, /"village_storehouse"/, 'storehouse firewood must support specialist processing');

const marketCaravans = fs.readFileSync('server/src/simulation/marketplace_caravan.rs', 'utf8');
assert.match(marketCaravans, /marketplace_stall_workplace_id/);
assert.match(marketCaravans, /then_some\(\(workplace_id, 1\)\)/, 'one rostered depot worker must own each stall trip');
const marketRoster = fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8');
assert.match(marketRoster, /struct MarketplaceStallRoster/);
assert.match(marketRoster, /workplace_by_market_need/);
assert.match(marketRoster, /road_path_distance/);
assert.match(marketRoster, /source_has_stock/);
assert.match(marketRoster, /marketplace_stall_accepts_commodity_from/);
assert.match(marketRoster, /marketplace_stall_workplace_id_for_commodity/);
assert.doesNotMatch(
  marketRoster,
  /founding_stall_exception/,
  'a Marketplace must not run a table without an actual depot laborer',
);
const marketDistribution = fs.readFileSync('server/src/simulation/household_distribution.rs', 'utf8');
assert.match(marketDistribution, /sort_distribution_targets/);
assert.match(marketDistribution, /left\.distance[\s\S]{0,120}residence_id/);
const marketInspector = fs.readFileSync('src/resources/inspector/marketStallsRenderer.ts', 'utf8');
assert.match(marketInspector, /no distance radius/);
assert.match(marketInspector, /nearest stocked Marketplace by exact road length/);

const inspector = fs.readFileSync('src/resources/ResourceInspector.ts', 'utf8');
assert.match(inspector, /data-policy-tax-rate/);
assert.match(inspector, /data-policy-chapel-sabbath/);
assert.match(inspector, /data-policy-monastery-tithe/);
assert.match(inspector, /data-storehouse-accepts-timber/);
const bootstrap = fs.readFileSync('src/app/appBootstrap.ts', 'utf8');
assert.match(bootstrap, /resourceInspector\.selectBuilding\(townHall\.id\)/);
assert.doesNotMatch(bootstrap, /new CityAdministrationPanel/);

console.log('Town Hall, Marketplace, and village storehouse gameplay tests passed');
