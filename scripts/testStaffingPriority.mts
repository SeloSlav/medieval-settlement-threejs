import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  normalizeStaffingPriority,
  STAFFING_PRIORITY_NORMAL,
} from '../src/economy/staffingPriority.ts';

for (const legacyValue of [undefined, 0, 1, 2, 3, 4]) {
  assert.equal(
    normalizeStaffingPriority(legacyValue),
    STAFFING_PRIORITY_NORMAL,
    'completed-workplace compatibility ordering must ignore former player tiers',
  );
}

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
const resourceInspector = readFileSync(
  new URL('../src/resources/ResourceInspector.ts', import.meta.url),
  'utf8',
);
const tables = readFileSync(
  new URL('../server/src/tables.rs', import.meta.url),
  'utf8',
);
const construction = readFileSync(
  new URL('../server/src/simulation/construction.rs', import.meta.url),
  'utf8',
);

assert.match(
  populationPolicy,
  /if assignment\.construction_complete \{[\s\S]{0,100}CONSTRUCTION_PRIORITY_NORMAL/,
  'population-loss reconciliation must put all completed jobs in one automatic tier',
);
assert.match(
  populationPolicy,
  /BinaryHeap::from\([\s\S]{0,250}building_id/,
  'equal completed jobs must still release in a stable automatic order',
);
assert.match(
  population,
  /priority: if building\.construction_complete \{[\s\S]{0,120}CONSTRUCTION_PRIORITY_NORMAL[\s\S]{0,120}building\.construction_priority/,
  'unfinished sites keep their construction queue priority while completed jobs do not',
);
assert.match(
  buildingReducers,
  /if building\.construction_complete \{[\s\S]{0,180}Construction priority only applies while a building is under construction/,
);
assert.doesNotMatch(buildingRenderer, /withStaffingPriority|staffingPriorityRenderer/);
assert.doesNotMatch(resourceInspector, /data-staffing-priority|staffingPriority/);
assert.equal(
  existsSync(new URL('../src/resources/inspector/staffingPriorityRenderer.ts', import.meta.url)),
  false,
  'the completed-building priority panel should be deleted',
);
assert.match(tables, /operating labor and[\s\S]{0,40}logistics deliberately ignore it/);
assert.match(
  construction,
  /site\.construction_priority = CONSTRUCTION_PRIORITY_NORMAL/,
  'completion must continue clearing construction-only intent',
);

console.log('construction-only priority scope tests passed');
