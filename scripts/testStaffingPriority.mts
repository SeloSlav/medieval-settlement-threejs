import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeStaffingPriority,
  STAFFING_PRIORITIES,
  STAFFING_PRIORITY_HIGH,
  STAFFING_PRIORITY_LOW,
  STAFFING_PRIORITY_NORMAL,
  staffingPriorityHint,
  staffingPriorityLabel,
} from '../src/economy/staffingPriority.ts';

assert.deepEqual(STAFFING_PRIORITIES, [1, 2, 3]);
assert.equal(normalizeStaffingPriority(undefined), STAFFING_PRIORITY_NORMAL);
assert.equal(normalizeStaffingPriority(0), STAFFING_PRIORITY_NORMAL);
assert.equal(normalizeStaffingPriority(1), STAFFING_PRIORITY_LOW);
assert.equal(normalizeStaffingPriority(2), STAFFING_PRIORITY_NORMAL);
assert.equal(normalizeStaffingPriority(3), STAFFING_PRIORITY_HIGH);
assert.equal(normalizeStaffingPriority(4), STAFFING_PRIORITY_NORMAL);
assert.deepEqual(
  STAFFING_PRIORITIES.map(staffingPriorityLabel),
  ['Low', 'Normal', 'High'],
);
assert.match(staffingPriorityHint(STAFFING_PRIORITY_LOW), /Releases workers before/);
assert.match(staffingPriorityHint(STAFFING_PRIORITY_HIGH), /Retains workers until/);

const populationPolicy = readFileSync(
  new URL('../server/src/economy/population_policy.rs', import.meta.url),
  'utf8',
);
const population = readFileSync(
  new URL('../server/src/economy/population.rs', import.meta.url),
  'utf8',
);
const buildingReducers = readFileSync(
  new URL('../server/src/reducers/buildings.rs', import.meta.url),
  'utf8',
);
const buildingRenderer = readFileSync(
  new URL('../src/resources/inspector/buildingRenderer.ts', import.meta.url),
  'utf8',
);
const staffingRenderer = readFileSync(
  new URL('../src/resources/inspector/staffingPriorityRenderer.ts', import.meta.url),
  'utf8',
);
const resourceInspector = readFileSync(
  new URL('../src/resources/ResourceInspector.ts', import.meta.url),
  'utf8',
);
const tables = readFileSync(
  new URL('../server/src/tables.rs', import.meta.url),
  'utf8',
);
const simulation = readFileSync(
  new URL('../server/src/reducers/simulation.rs', import.meta.url),
  'utf8',
);
const lifecycle = readFileSync(
  new URL('../server/src/lifecycle.rs', import.meta.url),
  'utf8',
);
const fires = readFileSync(
  new URL('../server/src/simulation/fires.rs', import.meta.url),
  'utf8',
);
const residenceNeeds = readFileSync(
  new URL('../server/src/simulation/residence_needs/mod.rs', import.meta.url),
  'utf8',
);
const residenceReducers = readFileSync(
  new URL('../server/src/reducers/residences.rs', import.meta.url),
  'utf8',
);

assert.match(populationPolicy, /effective_labor_priority/);
assert.match(
  populationPolicy,
  /let group = usize::from\(assignment\.construction_complete\);[\s\S]{0,160}effective_labor_priority\(\*assignment\)[\s\S]{0,160}group \* 4 \+ priority/,
  'construction work must still release before permanent work within the fixed priority buckets',
);
assert.match(
  populationPolicy,
  /BinaryHeap::from\([\s\S]{0,250}building_id/,
  'equal-priority work must still release newer assignments first',
);
assert.match(population, /priority: building\.construction_priority/);
assert.match(buildingReducers, /if building\.construction_complete/);
assert.match(buildingReducers, /Operating-building staffing priority must be low, normal, or high/);
assert.match(buildingReducers, /building\.construction_priority = priority/);
assert.match(
  buildingReducers,
  /building\.kind != "monastery"/,
  'autonomous monasteries need the same save-compatible priority control for rationed grain',
);
assert.match(buildingRenderer, /withStaffingPriority/);
assert.match(staffingRenderer, /data-staffing-priority/);
assert.match(staffingRenderer, /This does not hire workers automatically/);
assert.match(staffingRenderer, /Labor & cart priority/);
assert.match(staffingRenderer, /Cart priority/);
assert.match(staffingRenderer, /Grain, well-water, and firewood/);
assert.match(staffingRenderer, /Flour, well-water, and oven fuel/);
assert.match(staffingRenderer, /Dispatched fresh food/);
assert.match(staffingRenderer, /Wool/);
assert.match(staffingRenderer, /higher tiers first/);
assert.match(resourceInspector, /closest<HTMLElement>\('\[data-staffing-priority\]'\)/);
assert.match(resourceInspector, /staffingPriority != null && building\.constructionComplete/);
assert.match(tables, /Completed buildings use 1 = low, 2 = normal, 3 = high/);
assert.match(tables, /Routed processor inputs/);
assert.match(tables, /scarce carts choose a working buffer/);
assert.doesNotMatch(
  simulation,
  /reconcile_(?:all_)?building_labor/,
  'ordinary simulation substeps must not rescan every settlement for a rare population-loss invariant',
);
assert.doesNotMatch(population, /pub fn reconcile_all_building_labor/);
assert.match(
  lifecycle,
  /client_connected[\s\S]{0,260}ensure_player_resources\(ctx, owner\)[\s\S]{0,260}reconcile_building_labor\(ctx, owner\)/,
  'returning owners need one legacy-save repair after resources are initialized',
);
assert.match(
  fires,
  /fn destroy_target[\s\S]{0,4200}FIRE_TARGET_RESIDENCE =>[\s\S]{0,1800}residence\.population = 0[\s\S]{0,700}reconcile_building_labor\(ctx, owner\)/,
  'fire destruction must release over-assigned labor in the same transaction',
);
assert.match(
  residenceNeeds,
  /if next_effective_workers < previous_effective_workers \{[\s\S]{0,180}reconcile_building_labor\(ctx, owner\)/,
  'illness, emigration, starvation, and other welfare losses must release labor immediately',
);
assert.ok(
  (residenceReducers.match(/reconcile_building_labor\(ctx, owner\)/g) ?? []).length >= 2,
  'single-home and whole-zone demolition must both reconcile immediately',
);

console.log('save-compatible, event-driven staffing priority tests passed');
