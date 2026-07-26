import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  HOUSEHOLD_FOOD_RESERVE_CAPACITY_FRACTION,
  HOUSEHOLD_FOOD_RESERVE_PER_CLAIM,
} from '../src/generated/gameBalance.ts';
import {
  granaryDispatchOrder,
  granaryDispatchPriorityLabel,
  householdFoodReserve,
  institutionalFoodSurplus,
} from '../src/logistics/foodLogistics.ts';

assert.equal(HOUSEHOLD_FOOD_RESERVE_PER_CLAIM, 6);
assert.equal(HOUSEHOLD_FOOD_RESERVE_CAPACITY_FRACTION, 0.5);

assert.equal(
  householdFoodReserve(0, 120),
  0,
  'an unclaimed producer should be free to centralize its full stock',
);
assert.equal(
  householdFoodReserve(2, 120),
  12,
  'two claimed homes should protect two ordinary six-unit carts',
);
assert.equal(institutionalFoodSurplus(30, 2, 120), 18);
assert.equal(
  institutionalFoodSurplus(8, 2, 120),
  0,
  'institutional collection must stop before draining the local household reserve',
);
assert.equal(
  householdFoodReserve(100, 120),
  60,
  'a very large territory must not lock more than half the producer capacity',
);
assert.equal(institutionalFoodSurplus(120, 100, 120), 60);
assert.deepEqual(
  granaryDispatchOrder(true),
  ['households', 'preservation'],
  'household-first must retain preservation as an immediate fallback',
);
assert.deepEqual(
  granaryDispatchOrder(false),
  ['preservation', 'households'],
  'preservation-first must retain household delivery as an immediate fallback',
);
assert.equal(granaryDispatchPriorityLabel(true), 'Households first');
assert.equal(granaryDispatchPriorityLabel(false), 'Winter preservation first');

const tickContext = fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8');
const expandedEconomy = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const supplyPolicy = fs.readFileSync('server/src/supply_policy.rs', 'utf8');
const buildingTable = fs.readFileSync('server/src/tables.rs', 'utf8');
const buildingReducers = fs.readFileSync('server/src/reducers/buildings.rs', 'utf8');
const generatedBuilding = fs.readFileSync('src/generated/building_table.ts', 'utf8');
const generatedGranaryReducer = fs.readFileSync(
  'src/generated/set_granary_policy_reducer.ts',
  'utf8',
);
const clientReducers = fs.readFileSync('src/data/spacetimeReducers.ts', 'utf8');
const buildingSync = fs.readFileSync(
  'src/data/spacetimeTableSync/syncBuildings.ts',
  'utf8',
);
const harvestInspector = fs.readFileSync(
  'src/resources/inspector/harvestBuildingRenderer.ts',
  'utf8',
);
const livestockInspector = fs.readFileSync(
  'src/resources/inspector/livestockBuildingRenderer.ts',
  'utf8',
);
const granaryInspector = fs.readFileSync(
  'src/resources/inspector/expandedBuildingRenderer.ts',
  'utf8',
);
const guardhouseInspector = fs.readFileSync(
  'src/resources/inspector/guardhouseRenderer.ts',
  'utf8',
);

assert.match(tickContext, /food_claim_counts: RefCell/);
assert.match(tickContext, /pub fn food_claim_count_for_supplier/);
assert.match(
  tickContext,
  /for supplier_id in claims\.values\(\)/,
  'the inverse territory count should be built once from cached claims',
);
assert.match(expandedEconomy, /request_connected_food_surplus\(/);
assert.match(expandedEconomy, /food_claim_count_for_supplier/);
assert.match(expandedEconomy, /institutional_food_surplus/);
assert.match(
  expandedEconomy,
  /for duty in granary_dispatch_order\(granary\.granary_households_first\)/,
  'the authoritative granary must execute its saved distribution order',
);
assert.match(
  expandedEconomy,
  /GranaryDispatchDuty::Households[\s\S]*GranaryDispatchDuty::Preservation/,
  'both granary duties must remain available regardless of which one has priority',
);
assert.match(
  expandedEconomy,
  /pub fn step_smokehouse[\s\S]*?request_connected_food_surplus\(/,
  'smokehouses must collect only food above household delivery reserves',
);
assert.match(
  expandedEconomy,
  /pub fn step_guardhouse[\s\S]*?request_connected_food_surplus\(/,
  'guardhouses must not requisition the last household delivery carts',
);
assert.match(
  expandedEconomy,
  /if commodity == CommodityKind::Food[\s\S]*?institutional_source_food_surplus/,
  'producer-pushed food trips must use the same reserve policy',
);
assert.match(
  expandedEconomy,
  /\.min\(transferable\)/,
  'every physical institutional food load must be capped to transferable surplus',
);
assert.match(
  supplyPolicy,
  /claimed_households as f64 \* HOUSEHOLD_FOOD_RESERVE_PER_CLAIM/,
);
assert.match(supplyPolicy, /pub fn granary_dispatch_order/);
const outboundDispatch = expandedEconomy.slice(
  expandedEconomy.indexOf('pub(crate) fn dispatch_to_building'),
  expandedEconomy.indexOf('fn dispatch_monastery_covered_need'),
);
assert.match(
  outboundDispatch,
  /labor_and_logistics_paused\(ctx, tick, source\.owner, clock\)[\s\S]*let Some\(network\)/,
  'resting logistics must return before route lookup and whole-owner building scans',
);
assert.match(
  buildingTable,
  /#\[default\(false\)\][\s\S]{0,80}pub granary_households_first: bool/,
  'existing saves must preserve the legacy preservation-first order',
);
assert.match(
  buildingReducers,
  /pub fn set_granary_policy\([\s\S]{0,220}households_first: bool[\s\S]{0,500}building\.granary_households_first = households_first/,
);
assert.match(
  generatedBuilding,
  /granaryHouseholdsFirst:[\s\S]{0,80}granary_households_first/,
);
assert.match(generatedGranaryReducer, /householdsFirst: __t\.bool\(\)/);
assert.match(clientReducers, /acceptsFreshFood,\s*householdsFirst/);
assert.match(buildingSync, /granaryHouseholdsFirst: row\.granaryHouseholdsFirst/);
assert.match(harvestInspector, /Local food reserve/);
assert.match(harvestInspector, /central surplus/);
assert.match(
  livestockInspector,
  /building\.kind === 'swineherd'[\s\S]*?building\.kind === 'pastoral_farmstead' && context\.conflictEnabled/,
);
assert.match(livestockInspector, /central surplus/);
assert.match(granaryInspector, /Household priority/);
assert.match(granaryInspector, /data-granary-households-first/);
assert.match(granaryInspector, /Feed households before smokehouses/);
assert.match(granaryInspector, /falls through/);
assert.match(granaryInspector, /granary, smokehouse, or guardhouse cart may load/);
assert.match(granaryInspector, /Collects central surplus only/);
assert.match(granaryInspector, /Producers with no claimed homes can send their whole stock/);
assert.match(guardhouseInspector, /central granary intervenes below/);
assert.match(guardhouseInspector, /None until polearms arm the company/);

const started = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  const claims = index % 24;
  checksum += institutionalFoodSurplus(index % 121, claims, 120);
}
const elapsedMs = performance.now() - started;
assert.ok(checksum > 0);
assert.ok(elapsedMs < 250, `100k institutional reserve projections took ${elapsedMs.toFixed(1)}ms`);

console.log(
  `territory-aware institutional food reserve tests passed (${elapsedMs.toFixed(1)}ms for 100k projections)`,
);
