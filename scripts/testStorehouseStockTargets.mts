import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
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

const distributedStorehouse = makeStorehouse({
  storehouseTimberTargetPercent: 25,
  storehouseStoneTargetPercent: 50,
  storehouseFirewoodTargetPercent: 75,
  timber: 120,
  stone: 90,
  firewood: 210,
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
const networkRows = renderStorehouseNetworkRows(networkPlan);
assert.match(networkRows, /Material depots/);
assert.match(networkRows, /1 completed/);
assert.match(networkRows, /Timber depots/);
assert.match(networkRows, /90 \/ 90 toward selected targets/);
assert.match(networkRows, /30 above targets remains available/);
assert.match(networkRows, /Stone depots/);
assert.match(networkRows, /90 collection headroom/);

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
  /set_storehouse_stock_target[\s\S]*is_valid_storehouse_stock_target_percent[\s\S]*"timber"[\s\S]*storehouse_timber_target_percent = target_percent[\s\S]*"stone"[\s\S]*storehouse_stone_target_percent = target_percent[\s\S]*"firewood"[\s\S]*storehouse_firewood_target_percent = target_percent/,
);
assert.match(storehouseStep, /fn storehouse_collection_room/);
assert.match(storehouseStep, /storehouse_filtered_collection_headroom\(/);
assert.match(storehouseStep, /idle_by_owner: HashMap<Identity, Vec<Building>>/);
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
assert.match(
  simulationLoop,
  /village_storehouse_ids[\s\S]*step_village_storehouses/,
  'all depot rows must enter one owner-wide arbitration pass',
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
assert.match(generatedReducer, /commodity: __t\.string/);
assert.match(generatedReducer, /targetPercent: __t\.u8/);
assert.match(clientReducers, /setStorehouseStockTarget/);
assert.match(buildingSync, /storehouseTimberTargetPercent: row\.storehouseTimberTargetPercent/);
assert.match(inspectorActions, /onSetStorehouseStockTarget/);
assert.match(
  storehouseInspectorSource,
  /Fullest producer first · nearest compatible idle depot/,
);
assert.match(
  inspectorSource,
  /building\.kind === 'village_storehouse'[\s\S]{0,500}data-storehouse-stock-target[\s\S]{0,500}onSetStorehouseStockTarget/,
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
    ...partial,
  };
}
