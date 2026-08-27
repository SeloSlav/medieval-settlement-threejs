import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT,
  GRANARY_FRESH_FOOD_TARGET_PRESETS,
  granaryFreshFoodTarget,
  normalizeGranaryFreshFoodTargetPercent,
} from '../src/economy/granaryPolicy.ts';
import type { BuildingState } from '../src/resources/types.ts';
import { renderGranaryPolicyPanel } from '../src/resources/inspector/expandedBuildingRenderer.ts';

function makeGranary(partial: Partial<BuildingState> = {}): BuildingState {
  return {
    id: 'granary-1',
    kind: 'granary',
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 120,
    grain: 80,
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
    granaryAcceptsFreshFood: true,
    granaryHouseholdsFirst: true,
    granaryGrainReserve: 0,
    ...partial,
  };
}

assert.equal(GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT, 75);
assert.deepEqual(
  GRANARY_FRESH_FOOD_TARGET_PRESETS.map(({ percent }) => percent),
  [25, 50, 75, 90],
);
assert.equal(normalizeGranaryFreshFoodTargetPercent(undefined), 75);
assert.equal(normalizeGranaryFreshFoodTargetPercent(Number.NaN), 75);
assert.equal(normalizeGranaryFreshFoodTargetPercent(99), 75);
assert.equal(normalizeGranaryFreshFoodTargetPercent(25), 25);
assert.equal(normalizeGranaryFreshFoodTargetPercent(90), 90);
assert.equal(granaryFreshFoodTarget(340, 25), 85);
assert.equal(granaryFreshFoodTarget(340, 50), 170);
assert.equal(granaryFreshFoodTarget(340, 75), 255);
assert.equal(granaryFreshFoodTarget(340, 90), 306);
assert.equal(granaryFreshFoodTarget(-10, 75), 0);
assert.equal(granaryFreshFoodTarget(Number.NaN, 75), 0);

const defaultPanel = renderGranaryPolicyPanel(makeGranary());
assert.equal(
  (defaultPanel.match(/class="inspector-action-panel"/g) ?? []).length,
  1,
  'the Granary inspector should expose only its accepted-goods controls',
);
assert.match(defaultPanel, /data-inspector-panel-title="Accepted goods"/);
assert.match(defaultPanel, /Choose which goods this Granary may collect; disabling a good stops new intake but leaves existing stock usable\./);
assert.doesNotMatch(
  defaultPanel,
  /Delivery order|Fresh-food limit|Protected grain|data-granary-households-first|data-granary-fresh-food-target|data-granary-grain-reserve/,
  'automatic Granary policy must not render manual priority, intake-limit, or reserve controls',
);
const smokehouseFirstPanel = renderGranaryPolicyPanel(makeGranary({
  granaryHouseholdsFirst: false,
}));
assert.equal(smokehouseFirstPanel, defaultPanel);
const localOnlyPanel = renderGranaryPolicyPanel(makeGranary({
  granaryAcceptsFreshFood: false,
}));
assert.doesNotMatch(
  localOnlyPanel,
  /data-granary-accepts-fresh-food[^>]*checked/,
);
assert.match(localOnlyPanel, /disabling a good stops new intake but leaves existing stock usable/);

const deepReservePanel = renderGranaryPolicyPanel(makeGranary({
  granaryFreshFoodTargetPercent: 90,
}));
assert.equal(deepReservePanel, defaultPanel);

const tableSource = readFileSync('server/src/tables.rs', 'utf8');
const serverPolicySource = readFileSync('server/src/granary_policy.rs', 'utf8');
const economySource = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const reducerSource = readFileSync('server/src/reducers/buildings.rs', 'utf8');
const generatedBuilding = readFileSync('src/generated/building_table.ts', 'utf8');
const clientGameStateSource = readFileSync('src/resources/GameState.ts', 'utf8');
const generatedReducer = readFileSync(
  'src/generated/set_granary_fresh_food_target_reducer.ts',
  'utf8',
);
const clientReducers = readFileSync('src/data/spacetimeReducers.ts', 'utf8');
const buildingSync = readFileSync('src/data/spacetimeTableSync/syncBuildings.ts', 'utf8');
const inspectorSource = readFileSync('src/resources/ResourceInspector.ts', 'utf8');

assert.match(
  tableSource,
  /#\[default\(75u8\)\]\s+pub granary_fresh_food_target_percent: u8/,
  'existing saves must retain the former fixed 75% intake behavior',
);
assert.match(serverPolicySource, /GRANARY_FRESH_FOOD_TARGET_PERCENTS: \[u8; 4\] = \[25, 50, 75, 90\]/);
assert.match(serverPolicySource, /pub fn granary_fresh_food_target/);
assert.match(
  reducerSource,
  /set_granary_fresh_food_target[\s\S]*?is_valid_granary_fresh_food_target_percent[\s\S]*?granary_fresh_food_target_percent = target_percent/,
);

const granaryIntakePlan = economySource.slice(
  economySource.indexOf('fn institutional_food_target_plan'),
  economySource.indexOf('pub fn step_threshing_barn'),
);
assert.match(granaryIntakePlan, /granary_fresh_food_target\(/);
assert.match(granaryIntakePlan, /target\.granary_fresh_food_target_percent/);
assert.doesNotMatch(
  granaryIntakePlan,
  /granary_fresh_food_target\([^)]*\) \* 0\.75/,
  'authoritative intake must no longer use the old hard-coded target',
);
assert.match(generatedBuilding, /granaryFreshFoodTargetPercent/);
assert.match(generatedReducer, /targetPercent/);
assert.match(clientReducers, /setGranaryFreshFoodTarget/);
assert.match(buildingSync, /granaryFreshFoodTargetPercent: row\.granaryFreshFoodTargetPercent/);
assert.match(inspectorSource, /onSetGranaryFreshFoodTarget/);
assert.match(
  reducerSource,
  /granary_households_first: true/,
  'new authoritative Granaries must prioritize household deliveries by default',
);
assert.match(
  clientGameStateSource,
  /granaryHouseholdsFirst: true/,
  'the local placement fallback must use the same household-first default',
);
assert.doesNotMatch(defaultPanel, /data-granary-fresh-food-target/);

const started = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  const preset = GRANARY_FRESH_FOOD_TARGET_PRESETS[index % 4];
  checksum += granaryFreshFoodTarget(340 + (index % 40), preset.percent);
}
const elapsedMs = performance.now() - started;
assert.ok(checksum > 0);
assert.ok(elapsedMs < 250, `100k granary intake projections took ${elapsedMs.toFixed(1)}ms`);

console.log(
  `granary fresh-food target tests passed (${elapsedMs.toFixed(1)}ms for 100k projections)`,
);
