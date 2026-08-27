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
  INSTITUTIONAL_FOOD_SOURCE_KINDS,
  institutionalDispatchableFoodStock,
  institutionalFoodSurplus,
  livestockHoldingProtectsFeedOats,
  selectInstitutionalFoodTarget,
} from '../src/logistics/foodLogistics.ts';
import type { BuildingKind } from '../src/resources/types.ts';

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
assert.equal(livestockHoldingProtectsFeedOats('pastoral_farmstead', true), true);
assert.equal(
  livestockHoldingProtectsFeedOats('swineherd', true),
  false,
  'swineherds receive finished Animal Feed and must not reserve raw oats',
);
assert.equal(livestockHoldingProtectsFeedOats('pastoral_farmstead', false), false);
assert.equal(livestockHoldingProtectsFeedOats('granary', true), false);
assert.equal(
  institutionalDispatchableFoodStock('pastoral_farmstead', 30, 18, true),
  21,
  'a pastoral holding must reserve staged feed oats at their half-meal human value',
);
assert.equal(
  institutionalDispatchableFoodStock('swineherd', 8, 20, true),
  8,
  'a swine holding must leave raw oats available to ordinary food logistics',
);
assert.equal(
  institutionalDispatchableFoodStock('pastoral_farmstead', 30, 18, false),
  30,
  'an empty holding must release its oats back to ordinary institutional food logistics',
);
assert.equal(institutionalDispatchableFoodStock('granary', 30, 18, true), 30);
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
assert.deepEqual(INSTITUTIONAL_FOOD_SOURCE_KINDS, [
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'bakery',
  'apiary',
  'pastoral_farmstead',
  'swineherd',
]);

type InstitutionalTarget = {
  id: string;
  kind: BuildingKind;
  ryeBread: number;
  meat: number;
  polearms?: number;
  assignedLabor: number;
  constructionComplete?: boolean;
  constructionPriority?: number;
  processorOutputTargetPercent?: number;
  guardhousePayPriority?: number;
  guardhouseFoodReserve?: number;
  granaryAcceptsFreshFood?: boolean;
  granaryFreshFoodTargetPercent?: number;
};
const destination = (
  id: string,
  kind: InstitutionalTarget['kind'],
  food: number,
  extra: Partial<InstitutionalTarget> = {},
): InstitutionalTarget => ({
  id,
  kind,
  ryeBread: kind === 'smokehouse' ? 0 : food,
  meat: kind === 'smokehouse' ? food : 0,
  polearms: 0,
  assignedLabor: 2,
  constructionComplete: true,
  constructionPriority: 2,
  processorOutputTargetPercent: 50,
  guardhousePayPriority: 1,
  guardhouseFoodReserve: 6,
  granaryAcceptsFreshFood: true,
  granaryFreshFoodTargetPercent: 75,
  ...extra,
});
const criticalGuard = destination('guard', 'guardhouse', 0, {
  assignedLabor: 4,
  polearms: 4,
});
const highSmokehouse = destination('smoke', 'smokehouse', 0, {
  constructionPriority: 3,
});
const selectedEmergency = selectInstitutionalFoodTarget(
  [highSmokehouse, criticalGuard],
  'source',
  true,
  (target) => target.id === 'guard' ? 500 : 10,
);
assert.equal(selectedEmergency?.target.id, 'guard');
assert.equal(selectedEmergency?.duty, 'critical-guard');

const routineGuard = destination('routine-guard', 'guardhouse', 12, {
  assignedLabor: 4,
  polearms: 4,
  guardhouseFoodReserve: 12,
  guardhousePayPriority: 2,
});
const selectedPreservation = selectInstitutionalFoodTarget(
  [routineGuard, highSmokehouse],
  'source',
  true,
  () => 20,
);
assert.equal(selectedPreservation?.target.id, 'smoke');
assert.equal(selectedPreservation?.duty, 'preservation-buffer');
assert.equal(
  selectInstitutionalFoodTarget(
    [routineGuard, destination('granary', 'granary', 0)],
    'source',
    true,
    () => 20,
  )?.target.id,
  'routine-guard',
  'ordinary company reserve must fill before optional granary centralization',
);
assert.equal(
  selectInstitutionalFoodTarget(
    [criticalGuard, highSmokehouse],
    'source',
    false,
    () => 20,
  )?.target.id,
  'smoke',
  'peaceful worlds must ignore military destinations entirely',
);

const tickContext = fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8');
const expandedEconomy = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const supplyPolicy = fs.readFileSync('server/src/supply_policy.rs', 'utf8');
const simulationReducer = fs.readFileSync('server/src/reducers/simulation.rs', 'utf8');
const livestockSimulation = fs.readFileSync('server/src/simulation/livestock.rs', 'utf8');
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
const resourceTotals = fs.readFileSync('src/resources/resourceTotals.ts', 'utf8');
const worldQueries = fs.readFileSync('src/resources/WorldQueries.ts', 'utf8');
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
assert.match(expandedEconomy, /food_claim_count_for_supplier/);
assert.match(expandedEconomy, /institutional_food_surplus/);
assert.match(
  expandedEconomy,
  /for duty in granary_dispatch_order\(true\)/,
  'the authoritative granary must use an automatic distribution order instead of its legacy player setting',
);
assert.match(
  expandedEconomy,
  /GranaryDispatchDuty::Households[\s\S]*GranaryDispatchDuty::Preservation/,
  'both granary duties must remain available regardless of which one has priority',
);
assert.match(
  expandedEconomy,
  /pub fn step_institutional_food_dispatch\([\s\S]*?candidates\.sort_by\([\s\S]*?compare_institutional_food_dispatch_candidates/,
  'all producer carts must arbitrate institutional demand in one authoritative pass',
);
assert.match(
  expandedEconomy,
  /InstitutionalFoodDispatchDuty::CriticalGuard[\s\S]*?InstitutionalFoodDispatchDuty::GuardReserve/,
  'armed companies must expose separate emergency and routine reserve duties',
);
assert.doesNotMatch(
  expandedEconomy,
  /request_connected_food_surplus\(/,
  'target-side institutional pulls must not reintroduce building-order races',
);
assert.doesNotMatch(
  livestockSimulation,
  /smokehouse/,
  'swine holdings must use the same shared producer-side arbitration',
);
assert.match(
  expandedEconomy,
  /if commodity\.is_edible\(\)[\s\S]*?institutional_source_food_surplus/,
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
assert.match(
  supplyPolicy,
  /pub fn livestock_holding_protects_feed_oats[\s\S]{0,220}has_feed_commitment && source_kind == "pastoral_farmstead"/,
  'the authoritative policy must protect feed-workshop oats only at live pastoral holdings',
);
assert.match(
  expandedEconomy,
  /commodity == CommodityKind::OatGrain && protects_feed_oats[\s\S]{0,80}continue/,
  'institutional dispatch must not select protected pastoral feed-workshop oats as food cargo',
);
assert.match(
  expandedEconomy,
  /fn livestock_source_has_feed_commitment[\s\S]{0,300}pasture_herd\(\)[\s\S]{0,100}farmstead_id\(\)[\s\S]{0,100}filter\(&source\.id\)[\s\S]{0,100}head_count > 0/,
  'authoritative oat protection must aggregate live pasture herds linked to the source holding',
);
assert.match(
  expandedEconomy,
  /institutional_dispatchable_food_stock\([\s\S]{0,100}&source\.kind,[\s\S]{0,100}source\.oat_grain,[\s\S]{0,100}livestock_source_has_feed_commitment/,
  'institutional source surplus must subtract livestock-local oats only with a live feed commitment',
);
assert.match(supplyPolicy, /pub enum InstitutionalFoodDispatchDuty/);
assert.match(supplyPolicy, /CriticalGuard[\s\S]*PreservationBuffer[\s\S]*GuardReserve[\s\S]*GranaryIntake/);
assert.match(
  simulationReducer,
  /for \(sim_kind, building_id\) in expanded_ids[\s\S]*step_institutional_food_dispatch[\s\S]*for payroll_bucket/,
  'institutional dispatch must run after producers attempt household carts and before guard upkeep',
);
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
assert.match(livestockInspector, /Linked pasture herds/);
assert.doesNotMatch(livestockInspector, /Animal Feed store|Fresh-food store|Preserved store/);
assert.match(granaryInspector, /Automatic routing/);
assert.doesNotMatch(
  granaryInspector,
  /Household priority|Dispatch priority|Next seed cart|Next grain cart|Next preservation buffer|data-granary-households-first|data-granary-fresh-food-target|data-granary-grain-reserve|data-inspector-panel-title="Protected grain/,
);
assert.match(buildingReducers, /granary_households_first: true/);
assert.match(granaryInspector, /critical company before this working batch/);
assert.match(granaryInspector, /Smokehouse batch → routine company reserve → enabled granary intake/);
assert.match(granaryInspector, /Producer-owned carts protect local Marketplace reserves/);
assert.match(guardhouseInspector, /becomes an emergency claim/);
assert.match(guardhouseInspector, /None until polearms arm the company/);
assert.match(
  resourceTotals,
  /const stockedLivestockBuildings = new Set\([\s\S]{0,240}herd\.headCount > 0[\s\S]{0,100}herd\.buildingId[\s\S]*livestockHoldingProtectsFeedOats\([\s\S]{0,80}building\.kind,[\s\S]{0,100}stockedLivestockBuildings\.has\(building\.id\)[\s\S]{0,120}reservedOatGrain \+=/,
  'settlement totals must aggregate parcel herds before reserving their holding feed oats',
);
assert.match(
  worldQueries,
  /const hasFeedCommitment = this\.hasStockedLivestock\(source\.id\)[\s\S]{0,180}institutionalDispatchableFoodStock\([\s\S]{0,180}hasFeedCommitment/,
  'client dispatch previews must aggregate the source holding\'s stocked pasture herds',
);
assert.match(
  resourceTotals,
  /const storedFood[\s\S]{0,120}oatGrain \* foodMealValue\('oatGrain'\)/,
  'owned oats remain edible and count toward total stored meals',
);
assert.match(
  resourceTotals,
  /const surplusOatGrain = Math\.max\(0, oatGrain - reservedOatGrain\)/,
  'available-food totals must exclude protected household, monastery, and livestock oats',
);

const started = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  const claims = index % 24;
  checksum += institutionalFoodSurplus(index % 121, claims, 120);
}
const elapsedMs = performance.now() - started;
assert.ok(checksum > 0);
assert.ok(elapsedMs < 250, `100k institutional reserve projections took ${elapsedMs.toFixed(1)}ms`);

function* institutionalTargets(count: number): IterableIterator<InstitutionalTarget> {
  for (let index = 0; index < count; index += 1) {
    yield destination(
      String(index + 1),
      'smokehouse',
      index % 6,
      { constructionPriority: index % 3 + 1 },
    );
  }
}
const dispatchStarted = performance.now();
const perfDispatch = selectInstitutionalFoodTarget(
  institutionalTargets(100_000),
  'source',
  false,
  (target) => 100_000 - Number(target.id),
);
const dispatchElapsedMs = performance.now() - dispatchStarted;
assert.equal(
  perfDispatch?.target.id,
  '99997',
  'neutralized workplace priorities should select the nearest empty smokehouse',
);
assert.ok(
  dispatchElapsedMs < 250,
  `100k institutional destinations took ${dispatchElapsedMs.toFixed(1)}ms`,
);

console.log(
  `territory-aware institutional food reserve tests passed (${elapsedMs.toFixed(1)}ms for 100k reserves; ${dispatchElapsedMs.toFixed(1)}ms for 100k destinations)`,
);
