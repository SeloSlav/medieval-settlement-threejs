import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  CIVILIAN_TOOL_SITE_KINDS,
  civilianToolPlan,
  civilianToolRunwayCycles,
  civilianToolThroughputMultiplier,
} from '../src/economy/civilianToolPolicy.ts';
import {
  selectDirectProcessorInputTarget,
} from '../src/logistics/processorInputLogistics.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
  bulkStockpileVisualSignature,
  syncBulkStockpileVisuals,
} from '../src/buildings/bulkStockpileVisuals.ts';
import type { BuildingKind, BuildingState } from '../src/resources/types.ts';

assert.equal(CIVILIAN_TOOL_IRONWORK_PER_CYCLE, 0.25);
assert.equal(CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER, 1.2);
assert.equal(civilianToolThroughputMultiplier(0), 1);
assert.equal(civilianToolThroughputMultiplier(0.24), 1);
assert.equal(civilianToolThroughputMultiplier(0.25), 1.2);
assert.equal(civilianToolRunwayCycles(3), 12);

for (const kind of CIVILIAN_TOOL_SITE_KINDS) {
  assert.equal(
    BUILDING_STORAGE_CAPS[kind].ironwork,
    3,
    `${kind} must keep a bounded physical replacement-tool rack`,
  );
  const plan = civilianToolPlan(building(kind, { ironwork: 0.75 }));
  assert.ok(plan?.maintained);
  assert.equal(plan.runwayCycles, 3);

  const marker = createBuildingMesh(kind);
  const stockpile = marker.getObjectByName('CivilianToolStockpile');
  assert.ok(stockpile instanceof THREE.Group, `${kind} must render its onsite tools`);
  assert.equal(
    stockpile.children.filter((child) => child.name === 'CivilianToolSegment').length,
    CIVILIAN_TOOL_IRONWORK_VISUAL_SEGMENTS,
  );
  syncBulkStockpileVisuals(marker, building(kind, { ironwork: 0 }));
  assert.equal(stockpile.visible, false);
  syncBulkStockpileVisuals(marker, building(kind, { ironwork: 0.75 }));
  assert.equal(stockpile.visible, true);
  assert.equal(
    stockpile.children.filter(
      (child) => child.name === 'CivilianToolSegment' && child.visible,
    ).length,
    1,
    'one three-cycle buffer must occupy one readable rack segment',
  );
}

const lowPriorityQuarry = building('stone_quarry', {
  id: 'quarry',
  assignedLabor: 3,
  constructionPriority: 1,
  ironwork: 0,
});
const highPriorityClay = building('clay_pit', {
  id: 'clay',
  assignedLabor: 2,
  constructionPriority: 3,
  ironwork: 0,
});
const carpenter = building('carpenter', {
  id: 'carpenter',
  assignedLabor: 2,
  constructionPriority: 3,
  ironwork: 0,
});

const priorityTarget = selectDirectProcessorInputTarget(
  [lowPriorityQuarry, highPriorityClay, carpenter],
  'smithy',
  'ironwork',
  (candidate) => candidate.id === 'quarry' ? 30 : candidate.id === 'clay' ? 80 : 10,
);
assert.equal(priorityTarget?.target.id, 'clay');
assert.equal(priorityTarget?.duty, 'working-buffer');
assert.equal(priorityTarget?.desiredStock, 0.75);

highPriorityClay.ironwork = 0.75;
const runwayTarget = selectDirectProcessorInputTarget(
  [lowPriorityQuarry, highPriorityClay, carpenter],
  'smithy',
  'ironwork',
  (candidate) => candidate.id === 'quarry' ? 30 : candidate.id === 'clay' ? 80 : 10,
);
assert.equal(
  runwayTarget?.target.id,
  'quarry',
  'an uncovered staffed tool site must preempt carpenter overflow and a covered site',
);

lowPriorityQuarry.ironwork = 0.75;
const overflowTarget = selectDirectProcessorInputTarget(
  [lowPriorityQuarry, highPriorityClay, carpenter],
  'smithy',
  'ironwork',
  (candidate) => candidate.id === 'carpenter' ? 10 : 30,
);
assert.equal(overflowTarget?.target.id, 'carpenter');
assert.equal(overflowTarget?.duty, 'workshop-overflow');

const emptySignature = bulkStockpileVisualSignature(
  building('large_quarry', { ironwork: 0 }),
);
const maintainedSignature = bulkStockpileVisualSignature(
  building('large_quarry', { ironwork: 0.75 }),
);
assert.notEqual(emptySignature, maintainedSignature);

const perfSites = Array.from({ length: 100_000 }, (_, index) =>
  building(CIVILIAN_TOOL_SITE_KINDS[index % CIVILIAN_TOOL_SITE_KINDS.length], {
    ironwork: (index % 13) * 0.25,
  }));
const started = performance.now();
let maintained = 0;
for (const site of perfSites) {
  maintained += civilianToolPlan(site)?.maintained ? 1 : 0;
}
const elapsed = performance.now() - started;
assert.ok(maintained > 0);
assert.ok(elapsed < 250, `100,000 tool plans took ${elapsed.toFixed(1)} ms`);

console.log(
  `Civilian tool economy tests passed (${elapsed.toFixed(1)} ms / 100k plans).`,
);

function building(
  kind: BuildingKind,
  patch: Partial<BuildingState> = {},
): BuildingState {
  return {
    id: `${kind}-test`,
    kind,
    x: 0,
    z: 0,
    workRadius: BUILDING_DEFINITIONS[kind].workRadius,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    wool: 0,
    flax: 0,
    cloth: 0,
    ironwork: 0,
    polearms: 0,
    iron: 0,
    clay: 0,
    salt: 0,
    charcoal: 0,
    pottery: 0,
    assignedLabor: 0,
    constructionPriority: 2,
    processorOutputTargetPercent: 100,
    constructionComplete: true,
    ...patch,
  } as BuildingState;
}
