import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { buildingMarkerCollectionSignature } from '../src/buildings/buildingMarkerSignature.ts';
import {
  STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS,
  STOREHOUSE_IRON_VISUAL_SEGMENTS,
  STOREHOUSE_CLAY_VISUAL_SEGMENTS,
  STOREHOUSE_SALT_VISUAL_SEGMENTS,
  STOREHOUSE_STONE_VISUAL_SEGMENTS,
  STOREHOUSE_TIMBER_VISUAL_SEGMENTS,
  syncStockpileSegments,
} from '../src/buildings/buildingStockpileVisuals.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
  STOREHOUSE_STOCK_TARGET_PRESETS,
  normalizeStorehouseStockTargetPercent,
  storehouseCollectionHeadroom,
  storehouseCommodityTarget,
  storehouseCommodityTargetPercent,
  storehouseFilteredCollectionHeadroom,
  storehouseStockTarget,
} from '../src/economy/storehousePolicy.ts';
import { computeSettlementLaborPlan } from '../src/economy/settlementLabor.ts';
import { renderStorehouseStockTargetControls } from '../src/resources/inspector/storehouseRenderer.ts';
import { renderStorehouseNetworkRows } from '../src/resources/inspector/townHallRenderer.ts';
import type { BuildingState } from '../src/resources/types.ts';

assert.equal(STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT, 100);
assert.deepEqual(
  STOREHOUSE_STOCK_TARGET_PRESETS.map(({ percent }) => percent),
  [25, 50, 75, 100],
);
assert.equal(normalizeStorehouseStockTargetPercent(undefined), 100);
assert.equal(normalizeStorehouseStockTargetPercent(Number.NaN), 100);
assert.equal(normalizeStorehouseStockTargetPercent(99), 100);
assert.equal(normalizeStorehouseStockTargetPercent(25), 25);
assert.equal(normalizeStorehouseStockTargetPercent(75), 75);
assert.equal(storehouseStockTarget(360, 25), 90);
assert.equal(storehouseStockTarget(360, 50), 180);
assert.equal(storehouseStockTarget(360, 75), 270);
assert.equal(storehouseStockTarget(360, 100), 360);
assert.equal(storehouseStockTarget(-10, 100), 0);
assert.equal(storehouseStockTarget(Number.NaN, 100), 0);
assert.equal(storehouseCollectionHeadroom(40, 360, 25), 50);
assert.equal(storehouseCollectionHeadroom(90, 360, 25), 0);
assert.equal(storehouseCollectionHeadroom(120, 360, 25), 0);

const legacyStorehouse = makeStorehouse();
assert.equal(storehouseCommodityTargetPercent(legacyStorehouse, 'timber'), 100);
assert.equal(storehouseCommodityTarget(legacyStorehouse, 'timber'), 360);
assert.equal(storehouseCommodityTarget(legacyStorehouse, 'stone'), 360);
assert.equal(storehouseCommodityTarget(legacyStorehouse, 'firewood'), 280);
assert.equal(storehouseCommodityTarget(legacyStorehouse, 'iron'), 180);
assert.equal(storehouseCommodityTarget(legacyStorehouse, 'clay'), 180);
assert.equal(storehouseCommodityTarget(legacyStorehouse, 'salt'), 144);
assert.equal(storehouseFilteredCollectionHeadroom(legacyStorehouse, 'timber'), 260);
assert.equal(
  storehouseFilteredCollectionHeadroom(
    { ...legacyStorehouse, storehouseAcceptsTimber: false },
    'timber',
  ),
  0,
);
const legacyControls = renderStorehouseStockTargetControls(legacyStorehouse);
assert.match(legacyControls, /Timber target/);
assert.match(legacyControls, /100 stored \/ 360 selected/);
assert.match(
  legacyControls,
  /data-storehouse-stock-kind="timber" data-storehouse-stock-target="100"[^>]*disabled/,
  'missing saves must render the original fill-to-capacity policy as selected',
);
assert.match(legacyControls, /260 collection headroom/);
assert.match(legacyControls, /Iron target/);
assert.match(legacyControls, /Clay target/);
assert.match(legacyControls, /Salt target/);
assert.doesNotMatch(
  legacyControls,
  /Â/,
  'stock-target controls must not expose a double-decoded separator',
);

const distributedStorehouse = makeStorehouse({
  storehouseTimberTargetPercent: 25,
  storehouseStoneTargetPercent: 50,
  storehouseFirewoodTargetPercent: 75,
  storehouseIronTargetPercent: 25,
  storehouseClayTargetPercent: 50,
  storehouseSaltTargetPercent: 75,
  timber: 120,
  stone: 90,
  firewood: 210,
  iron: 50,
  clay: 45,
  salt: 108,
});
const distributedControls = renderStorehouseStockTargetControls(distributedStorehouse);
assert.match(distributedControls, /120 stored \/ 90 selected/);
assert.match(distributedControls, /30 above target/);
assert.match(
  distributedControls,
  /data-storehouse-stock-kind="timber" data-storehouse-stock-target="25"[^>]*disabled/,
);
assert.match(distributedControls, /90 stored \/ 180 selected/);
assert.match(distributedControls, /90 collection headroom/);
assert.match(distributedControls, /210 stored \/ 210 selected/);
assert.match(distributedControls, /At collection target/);
assert.match(distributedControls, /50 stored \/ 45 selected/);
assert.match(distributedControls, /5 above target/);
assert.match(distributedControls, /45 stored \/ 90 selected/);
assert.match(distributedControls, /108 stored \/ 108 selected/);

const storehouseMesh = createBuildingMesh('village_storehouse');
const timberBay = storehouseMesh.getObjectByName('StorehouseTimberStockpile');
const stoneBay = storehouseMesh.getObjectByName('StorehouseStoneStockpile');
const firewoodBay = storehouseMesh.getObjectByName('StorehouseFirewoodStockpile');
const ironBay = storehouseMesh.getObjectByName('StorehouseIronStockpile');
const clayBay = storehouseMesh.getObjectByName('StorehouseClayStockpile');
const saltBay = storehouseMesh.getObjectByName('StorehouseSaltStockpile');
assert.ok(timberBay instanceof THREE.Group);
assert.ok(stoneBay instanceof THREE.Group);
assert.ok(firewoodBay instanceof THREE.Group);
assert.ok(ironBay instanceof THREE.Group);
assert.ok(clayBay instanceof THREE.Group);
assert.ok(saltBay instanceof THREE.Group);
assert.equal(
  timberBay.children.filter((child) => child.name === 'StorehouseTimberSegment').length,
  STOREHOUSE_TIMBER_VISUAL_SEGMENTS,
);
assert.equal(
  stoneBay.children.filter((child) => child.name === 'StorehouseStoneSegment').length,
  STOREHOUSE_STONE_VISUAL_SEGMENTS,
);
assert.equal(
  firewoodBay.children.filter((child) => child.name === 'StorehouseFirewoodSegment').length,
  STOREHOUSE_FIREWOOD_VISUAL_SEGMENTS,
);
assert.equal(
  ironBay.children.filter((child) => child.name === 'StorehouseIronSegment').length,
  STOREHOUSE_IRON_VISUAL_SEGMENTS,
);
assert.equal(
  clayBay.children.filter((child) => child.name === 'StorehouseClaySegment').length,
  STOREHOUSE_CLAY_VISUAL_SEGMENTS,
);
assert.equal(
  saltBay.children.filter((child) => child.name === 'StorehouseSaltSegment').length,
  STOREHOUSE_SALT_VISUAL_SEGMENTS,
);
assert.equal(timberBay.visible, false, 'an empty storehouse must not render a full timber bay');
assert.equal(stoneBay.visible, false, 'an empty storehouse must not render a full stone bay');
assert.equal(firewoodBay.visible, false, 'an empty storehouse must not render a full fuel bay');
assert.equal(ironBay.visible, false, 'an empty storehouse must not render a full ore bay');
assert.equal(clayBay.visible, false, 'an empty storehouse must not render a full clay bay');
assert.equal(saltBay.visible, false, 'an empty storehouse must not render full salt sacks');
assert.equal(
  syncStockpileSegments(
    timberBay,
    'StorehouseTimberSegment',
    181,
    360,
  ),
  3,
  'timber stacks must expose a readable half-capacity state',
);
assert.equal(
  syncStockpileSegments(
    stoneBay,
    'StorehouseStoneSegment',
    180,
    360,
  ),
  5,
  'stone stacks must expose a readable half-capacity state',
);
assert.equal(
  syncStockpileSegments(
    firewoodBay,
    'StorehouseFirewoodSegment',
    70,
    280,
  ),
  2,
  'fuel stacks must expose a readable quarter-capacity state',
);
assert.equal(
  syncStockpileSegments(ironBay, 'StorehouseIronSegment', 91, 180),
  3,
  'stored ore must expose a readable half-capacity state',
);
assert.equal(
  syncStockpileSegments(clayBay, 'StorehouseClaySegment', 45, 180),
  1,
  'stored clay must expose a readable quarter-capacity state',
);
assert.equal(
  syncStockpileSegments(saltBay, 'StorehouseSaltSegment', 108, 144),
  3,
  'stored salt must expose a readable three-quarter-capacity state',
);
assert.equal(
  syncStockpileSegments(
    timberBay,
    'StorehouseTimberSegment',
    0,
    360,
  ),
  0,
);
assert.equal(timberBay.visible, false, 'the last construction withdrawal must clear the bay');

const emptyVisual = makeStorehouse({ timber: 0, stone: 0, firewood: 0 });
const firstTimberStack = { ...emptyVisual, timber: 1 };
const sameTimberBand = { ...emptyVisual, timber: 20 };
assert.notEqual(
  buildingMarkerCollectionSignature(new Map([[emptyVisual.id, emptyVisual]])),
  buildingMarkerCollectionSignature(new Map([[firstTimberStack.id, firstTimberStack]])),
  'the marker sync must run when an empty timber bay gains its first physical stack',
);
assert.equal(
  buildingMarkerCollectionSignature(new Map([[firstTimberStack.id, firstTimberStack]])),
  buildingMarkerCollectionSignature(new Map([[sameTimberBand.id, sameTimberBand]])),
  'stock changes inside one visual band must not rebuild or resync storehouse markers',
);

const networkPlan = computeSettlementLaborPlan({
  state: {
    buildings: new Map([[distributedStorehouse.id, distributedStorehouse]]),
    deliveryTrips: new Map(),
  },
  population: { total: 2 },
  vacantHousingSlots: 0,
}).storehouseNetwork;
assert.equal(networkPlan.completedDepots, 1);
assert.equal(networkPlan.staffedDepots, 1);
assert.deepEqual(networkPlan.commodities.timber, {
  acceptingDepots: 1,
  staffedAcceptingDepots: 1,
  targetStock: 90,
  stockTowardTarget: 90,
  collectionHeadroom: 0,
  stockAboveTarget: 30,
});
assert.equal(networkPlan.commodities.stone.targetStock, 180);
assert.equal(networkPlan.commodities.stone.collectionHeadroom, 90);
assert.equal(networkPlan.commodities.firewood.targetStock, 210);
assert.equal(networkPlan.commodities.firewood.collectionHeadroom, 0);
assert.equal(networkPlan.commodities.iron.targetStock, 45);
assert.equal(networkPlan.commodities.iron.stockAboveTarget, 5);
assert.equal(networkPlan.commodities.clay.targetStock, 90);
assert.equal(networkPlan.commodities.clay.collectionHeadroom, 45);
assert.equal(networkPlan.commodities.salt.targetStock, 108);
assert.equal(networkPlan.commodities.salt.collectionHeadroom, 0);
const networkRows = renderStorehouseNetworkRows(networkPlan);
assert.match(networkRows, /Material depots/);
assert.match(networkRows, /1 completed/);
assert.match(networkRows, /Timber depots/);
assert.match(networkRows, /90 \/ 90 toward selected targets/);
assert.match(networkRows, /30 above targets remains available/);
assert.match(networkRows, /Stone depots/);
assert.match(networkRows, /90 collection headroom/);
assert.match(networkRows, /Iron depots/);
assert.match(networkRows, /Clay depots/);
assert.match(networkRows, /Salt depots/);

const tableSource = readFileSync('server/src/tables.rs', 'utf8');
const serverPolicySource = readFileSync('server/src/storehouse_policy.rs', 'utf8');
const storehouseStep = readFileSync('server/src/simulation/village_storehouse.rs', 'utf8');
const simulationLoop = readFileSync('server/src/reducers/simulation.rs', 'utf8');
const reducerSource = readFileSync('server/src/reducers/buildings.rs', 'utf8');
const generatedBuilding = readFileSync('src/generated/building_table.ts', 'utf8');
const generatedReducer = readFileSync(
  'src/generated/set_storehouse_stock_target_reducer.ts',
  'utf8',
);
const generatedPolicyReducer = readFileSync(
  'src/generated/set_storehouse_policy_reducer.ts',
  'utf8',
);
const clientReducers = readFileSync('src/data/spacetimeReducers.ts', 'utf8');
const buildingSync = readFileSync('src/data/spacetimeTableSync/syncBuildings.ts', 'utf8');
const inspectorSource = readFileSync('src/resources/ResourceInspector.ts', 'utf8');
const storehouseInspectorSource = readFileSync(
  'src/resources/inspector/storehouseRenderer.ts',
  'utf8',
);
const inspectorActions = readFileSync('src/app/inspectorSpacetimeActions.ts', 'utf8');

for (const field of [
  'storehouse_timber_target_percent',
  'storehouse_stone_target_percent',
  'storehouse_firewood_target_percent',
  'storehouse_iron_target_percent',
  'storehouse_clay_target_percent',
  'storehouse_salt_target_percent',
]) {
  assert.match(
    tableSource,
    new RegExp(`#\\[default\\(100u8\\)\\]\\s+pub ${field}: u8`),
    `${field} must preserve the former fill-to-capacity behavior`,
  );
}
assert.match(
  serverPolicySource,
  /STOREHOUSE_STOCK_TARGET_PERCENTS: \[u8; 4\] = \[25, 50, 75, 100\]/,
);
assert.match(serverPolicySource, /pub fn storehouse_collection_headroom/);
assert.match(serverPolicySource, /pub fn storehouse_filtered_collection_headroom/);
assert.match(serverPolicySource, /pub fn compare_storehouse_source_priority/);
assert.match(serverPolicySource, /pub fn compare_storehouse_destination/);
assert.match(
  reducerSource,
  /set_storehouse_stock_target[\s\S]*is_valid_storehouse_stock_target_percent[\s\S]*"timber"[\s\S]*storehouse_timber_target_percent = target_percent[\s\S]*"stone"[\s\S]*storehouse_stone_target_percent = target_percent[\s\S]*"firewood"[\s\S]*storehouse_firewood_target_percent = target_percent[\s\S]*"iron"[\s\S]*storehouse_iron_target_percent = target_percent[\s\S]*"clay"[\s\S]*storehouse_clay_target_percent = target_percent[\s\S]*"salt"[\s\S]*storehouse_salt_target_percent = target_percent/,
);
assert.match(storehouseStep, /fn storehouse_collection_room/);
assert.match(storehouseStep, /storehouse_filtered_collection_headroom\(/);
assert.match(storehouseStep, /idle_by_owner: HashMap<Identity, Vec<Building>>/);
assert.match(
  storehouseStep,
  /STOREHOUSE_OVERFLOW_SOURCE_KINDS[\s\S]*"mine"[\s\S]*"clay_pit"/,
  'mine and clay-pit overflow must enter the same physical depot arbitration',
);
assert.match(
  storehouseStep,
  /CommodityKind::Iron[\s\S]*CommodityKind::Salt[\s\S]*CommodityKind::Clay/,
  'industrial material overflow must retain its physical commodity identity',
);
assert.match(
  storehouseStep,
  /sources\.sort_by\([\s\S]*compare_storehouse_source_priority/,
  'fullest overflowing producers must reserve idle depot carts first',
);
assert.match(
  storehouseStep,
  /\.min_by\([\s\S]*compare_storehouse_destination/,
  'each prioritized producer must choose its nearest compatible idle depot',
);
assert.match(
  storehouseStep,
  /idle_storehouses\.swap_remove\(storehouse_index\)/,
  'one depot crew must accept at most one overflow collection trip per substep',
);
const householdDutyIndex = simulationLoop.indexOf(
  'step_village_storehouse_household_firewood(ctx',
);
const localMaterialDutyIndex = simulationLoop.indexOf(
  'step_local_material_dispatch(ctx',
);
const overflowCollectionIndex = simulationLoop.indexOf(
  'step_village_storehouse_overflow_collection(ctx',
);
assert.ok(
  householdDutyIndex >= 0
  && householdDutyIndex < localMaterialDutyIndex
  && localMaterialDutyIndex < overflowCollectionIndex,
  'depot carts must protect households, then supply workshop buffers, before collecting overflow',
);
assert.match(
  storehouseStep,
  /dispatch_delivery_if_ready[\s\S]*idle_by_owner[\s\S]*dispatch_overflow_collection_for_owner/,
  'claimed household fuel must remain ahead of overflow collection',
);
assert.match(
  storehouseStep,
  /!source\.construction_complete[\s\S]*tick\.building_disabled_by_fire\(ctx, source\.id\)[\s\S]*building_has_active_trip\(ctx, source\.id\)/,
  'depots must not collect overflow from fire-disabled producers',
);
assert.doesNotMatch(
  storehouseStep,
  /building_commodity_room\(&storehouse/,
  'authoritative collection must stop at policy headroom rather than physical room',
);
assert.match(generatedBuilding, /storehouseTimberTargetPercent/);
assert.match(generatedBuilding, /storehouseStoneTargetPercent/);
assert.match(generatedBuilding, /storehouseFirewoodTargetPercent/);
assert.match(generatedBuilding, /storehouseAcceptsIron/);
assert.match(generatedBuilding, /storehouseAcceptsClay/);
assert.match(generatedBuilding, /storehouseAcceptsSalt/);
assert.match(generatedBuilding, /storehouseIronTargetPercent/);
assert.match(generatedBuilding, /storehouseClayTargetPercent/);
assert.match(generatedBuilding, /storehouseSaltTargetPercent/);
assert.match(generatedReducer, /commodity: __t\.string/);
assert.match(generatedReducer, /targetPercent: __t\.u8/);
assert.match(generatedPolicyReducer, /acceptsIron: __t\.bool/);
assert.match(generatedPolicyReducer, /acceptsClay: __t\.bool/);
assert.match(generatedPolicyReducer, /acceptsSalt: __t\.bool/);
assert.match(clientReducers, /setStorehouseStockTarget/);
assert.match(buildingSync, /storehouseTimberTargetPercent: row\.storehouseTimberTargetPercent/);
assert.match(buildingSync, /storehouseIronTargetPercent: row\.storehouseIronTargetPercent/);
assert.match(inspectorActions, /onSetStorehouseStockTarget/);
assert.match(
  storehouseInspectorSource,
  /Fullest producer first · nearest compatible idle depot/,
);
assert.match(
  inspectorSource,
  /building\.kind === 'village_storehouse'[\s\S]{0,900}data-storehouse-stock-target[\s\S]{0,500}onSetStorehouseStockTarget/,
  'target buttons must dispatch only from the village-storehouse click branch',
);

const started = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  const preset = STOREHOUSE_STOCK_TARGET_PRESETS[index % 4];
  checksum += storehouseCollectionHeadroom(
    index % 361,
    360,
    preset.percent,
  );
}
const elapsedMs = performance.now() - started;
assert.ok(checksum > 0);
assert.ok(
  elapsedMs < 250,
  `100k storehouse target projections took ${elapsedMs.toFixed(1)}ms`,
);

const perfStorehouses = new Map<string, BuildingState>();
for (let index = 0; index < 100_000; index += 1) {
  perfStorehouses.set(String(index), makeStorehouse({
    id: String(index),
    timber: index % 361,
    storehouseTimberTargetPercent: STOREHOUSE_STOCK_TARGET_PRESETS[index % 4].percent,
  }));
}
const networkStarted = performance.now();
const perfNetwork = computeSettlementLaborPlan({
  state: { buildings: perfStorehouses, deliveryTrips: new Map() },
  population: { total: 100_000 },
  vacantHousingSlots: 0,
}).storehouseNetwork;
const networkElapsedMs = performance.now() - networkStarted;
assert.equal(perfNetwork.completedDepots, 100_000);
assert.ok(
  networkElapsedMs < 500,
  `100k-depot network analysis took ${networkElapsedMs.toFixed(1)}ms`,
);

console.log(
  `storehouse stock-target tests passed (${elapsedMs.toFixed(1)}ms for 100k projections; `
  + `${networkElapsedMs.toFixed(1)}ms for 100k-depot network analysis)`,
);

function makeStorehouse(partial: Partial<BuildingState> = {}): BuildingState {
  return {
    id: 'storehouse-1',
    kind: 'village_storehouse',
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 0,
    timber: 100,
    firewood: 80,
    stone: 90,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    wool: 0,
    cloth: 0,
    iron: 0,
    clay: 0,
    salt: 0,
    ironwork: 0,
    polearms: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 2,
    constructionComplete: true,
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
    storehouseAcceptsIron: true,
    storehouseAcceptsClay: true,
    storehouseAcceptsSalt: true,
    ...partial,
  };
}
