import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  CIVILIAN_TOOL_REORDER_CYCLES,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
  FARM_TOOL_IRONWORK_PER_WORKER_DAY,
  FARM_WORK_METERS_PER_WORKER_PER_SEC,
} from '../src/generated/gameBalance.ts';
import {
  CIVILIAN_TOOL_SITE_KINDS,
  civilianToolPlan,
  civilianToolRefillDue,
  civilianToolReorderStock,
  civilianToolRunwayCycles,
  civilianToolThroughputMultiplier,
  farmToolIronworkForWork,
  farmToolsMaintained,
  farmToolThroughputMultiplier,
  farmToolWorkerDayRunway,
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

assert.equal(CIVILIAN_TOOL_IRONWORK_PER_CYCLE, 0.1);
assert.equal(CIVILIAN_TOOL_REORDER_CYCLES, 6);
assert.equal(CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER, 1.2);
assert.equal(civilianToolThroughputMultiplier(0), 1);
assert.equal(civilianToolThroughputMultiplier(0.09), 1);
assert.equal(civilianToolThroughputMultiplier(0.1), 1.2);
assert.equal(civilianToolRunwayCycles(3), 30);
assert.ok(Math.abs(civilianToolReorderStock(3) - 0.6) < 1e-9);
assert.equal(civilianToolRefillDue(0.6, 3), false);
assert.equal(civilianToolRefillDue(0.59, 3), true);
assert.equal(FARM_TOOL_IRONWORK_PER_WORKER_DAY, 0.05);
const farmWorkerDayWork = FARM_WORK_METERS_PER_WORKER_PER_SEC
  * CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;
assert.equal(farmToolIronworkForWork(farmWorkerDayWork), 0.05);
assert.ok(Math.abs(
  farmToolIronworkForWork(farmWorkerDayWork * 0.35)
    + farmToolIronworkForWork(farmWorkerDayWork * 0.65)
    - 0.05,
) < 1e-9, 'tool wear must follow completed field work rather than exploitable parcel count');
assert.equal(farmToolWorkerDayRunway(0.75), 15);
assert.equal(farmToolsMaintained(0), false);
assert.equal(farmToolsMaintained(0.01), true);
assert.equal(farmToolThroughputMultiplier(0.01), 1.2);

const settlementHudSource = readFileSync(
  new URL('../src/ui/SettlementHud.ts', import.meta.url),
  'utf8',
);
const woodcutterSimulation = readFileSync(
  new URL('../server/src/simulation/woodcutters_lodge.rs', import.meta.url),
  'utf8',
);
const expandedEconomySimulation = readFileSync(
  new URL('../server/src/simulation/expanded_economy.rs', import.meta.url),
  'utf8',
);
const woodcutterInspector = readFileSync(
  new URL('../src/resources/inspector/woodcuttersLodgeRenderer.ts', import.meta.url),
  'utf8',
);
const mineralMineInspector = readFileSync(
  new URL('../src/resources/inspector/mineralMineRenderer.ts', import.meta.url),
  'utf8',
);
const buildMenuCards = readFileSync(
  new URL('../src/ui/buildMenuCards.ts', import.meta.url),
  'utf8',
);
const farmsteadInspector = readFileSync(
  new URL('../src/resources/inspector/expandedBuildingRenderer.ts', import.meta.url),
  'utf8',
);
const buildingCommon = readFileSync(
  new URL('../src/resources/inspector/buildingCommon.ts', import.meta.url),
  'utf8',
);
const marketplaceTradeRenderer = readFileSync(
  new URL('../src/resources/inspector/marketplaceTradeRenderer.ts', import.meta.url),
  'utf8',
);
const ironworkHudTag = settlementHudSource.match(
  /<div[^>]*data-resource="ironwork"[^>]*>/,
)?.[0];
assert.ok(ironworkHudTag, 'the resource HUD must expose the civilian ironwork stock');
assert.doesNotMatch(
  ironworkHudTag,
  /\bhidden\b/,
  'peaceful settlements still consume ironwork for civilian tool upkeep',
);
assert.match(
  woodcutterSimulation,
  /civilian_tool_throughput_multiplier\(lodge\.ironwork\)/,
);
assert.match(
  woodcutterSimulation,
  /withdraw_building_commodity\([\s\S]*CommodityKind::Ironwork[\s\S]*CIVILIAN_TOOL_IRONWORK_PER_CYCLE/,
);
assert.match(
  woodcutterSimulation,
  /firewood_added \/ full_firewood_output/,
  'partial firewood batches must wear tools only in proportion to actual output',
);
assert.match(
  expandedEconomySimulation,
  /"lumber_mill",\s*"woodcutters_lodge",\s*"stone_quarry"/,
  'smithies must include winter-fuel axes in physical ironwork dispatch',
);
assert.match(
  expandedEconomySimulation,
  /mill\.flour - flour_before\) \/ WATERMILL_FLOUR_PER_CYCLE/,
  'partial watermill batches must wear dressing tools in proportion to actual flour',
);
assert.match(
  expandedEconomySimulation,
  /"clay_pit",\s*"threshing_barn",\s*"watermill",\s*"carpenter"/,
  'smithies must include farm and watermill tools in physical ironwork dispatch',
);
assert.match(
  expandedEconomySimulation,
  /farm_tool_throughput[\s\S]*work_budget[\s\S]*farm_tool_ironwork_for_work\(spent\)/,
  'authoritative field progress must accelerate and wear tools only after real work',
);
assert.match(
  expandedEconomySimulation,
  /step_watermill[\s\S]*watermill_throughput_multiplier\(\)[\s\S]*civilian_tool_throughput_multiplier\(building\.ironwork\)[\s\S]*mill\.flour > flour_before[\s\S]*CommodityKind::Ironwork[\s\S]*CIVILIAN_TOOL_IRONWORK_PER_CYCLE/,
  'watermill output must combine river power with maintained dressing and wear ironwork only after a completed batch',
);
assert.match(
  expandedEconomySimulation,
  /step_mine[\s\S]*civilian_tool_throughput_multiplier\(building\.ironwork\)[\s\S]*geology_throughput \* tool_throughput[\s\S]*produced > 1e-6[\s\S]*CommodityKind::Ironwork[\s\S]*CIVILIAN_TOOL_IRONWORK_PER_CYCLE/,
  'authoritative iron and salt extraction must multiply geology by maintained tools and wear ironwork only after real output',
);
assert.match(woodcutterInspector, /civilianToolRows\(building, context\.worldQueries\)/);
assert.match(mineralMineInspector, /civilianToolRows\(building, context\.worldQueries\)/);
assert.match(buildMenuCards, /replacement axes raise output but wear each cycle/);
assert.match(buildMenuCards, /picks and hammer heads raise output but wear each cycle/);
assert.match(buildMenuCards, /ploughshares, hoes, sickles, and scythes/);
assert.match(buildMenuCards, /Smith-dressed millstones and maintained iron fittings raise output/);
assert.match(farmsteadInspector, /Seasonal tool reserve/);
assert.match(farmsteadInspector, /smith-dressed millstones and iron fittings/);
assert.match(buildingCommon, /reorders below/);
assert.match(buildingCommon, /only smithy carts refill this rack/);
assert.match(marketplaceTradeRenderer, /do not refill civilian tool racks/);
const conflictVisibilityMethod = settlementHudSource.slice(
  settlementHudSource.indexOf('setConflictEnabled(enabled: boolean)'),
  settlementHudSource.indexOf('setSettlementClock(', settlementHudSource.indexOf(
    'setConflictEnabled(enabled: boolean)',
  )),
);
assert.doesNotMatch(
  conflictVisibilityMethod,
  /ironwork/,
  'conflict mode must not control a peaceful-economy resource',
);
assert.match(
  conflictVisibilityMethod,
  /this\.polearmsStat\.hidden = !enabled/,
  'weapon stock should remain conflict-only',
);

for (const kind of CIVILIAN_TOOL_SITE_KINDS) {
  assert.equal(
    BUILDING_STORAGE_CAPS[kind].ironwork,
    3,
    `${kind} must keep a bounded physical replacement-tool rack`,
  );
  const plan = civilianToolPlan(building(kind, { ironwork: 0.75 }));
  assert.ok(plan?.maintained);
  assert.equal(plan.runwayCycles, 7.5);
  assert.equal(plan.reorderDue, false);
  assert.ok(Math.abs(plan.reorderStock - 0.6) < 1e-9);

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
const watermill = building('watermill', {
  id: 'watermill',
  assignedLabor: 1,
  constructionPriority: 2,
  ironwork: 0,
});
const mineralMine = building('mine', {
  id: 'mine',
  assignedLabor: 4,
  constructionPriority: 2,
  ironwork: 0,
});

const watermillTarget = selectDirectProcessorInputTarget(
  [watermill],
  'smithy',
  'ironwork',
  () => 24,
);
assert.equal(watermillTarget?.target.id, 'watermill');
assert.equal(watermillTarget?.duty, 'working-buffer');
assert.equal(watermillTarget?.desiredStock, 3);

const mineralMineTarget = selectDirectProcessorInputTarget(
  [mineralMine],
  'smithy',
  'ironwork',
  () => 36,
);
assert.equal(mineralMineTarget?.target.id, 'mine');
assert.equal(mineralMineTarget?.duty, 'working-buffer');
assert.equal(mineralMineTarget?.desiredStock, 3);

const priorityTarget = selectDirectProcessorInputTarget(
  [lowPriorityQuarry, highPriorityClay, carpenter],
  'smithy',
  'ironwork',
  (candidate) => candidate.id === 'quarry' ? 30 : candidate.id === 'clay' ? 80 : 10,
);
assert.equal(priorityTarget?.target.id, 'clay');
assert.equal(priorityTarget?.duty, 'working-buffer');
assert.equal(priorityTarget?.desiredStock, 3);

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
assert.notEqual(
  bulkStockpileVisualSignature(building('mine', { ironwork: 0 })),
  bulkStockpileVisualSignature(building('mine', { ironwork: 0.75 })),
  'the mine marker signature must refresh as its physical tool rack wears',
);

const perfSites = Array.from({ length: 100_000 }, (_, index) =>
  building(CIVILIAN_TOOL_SITE_KINDS[index % CIVILIAN_TOOL_SITE_KINDS.length], {
    ironwork: (index % 31) * 0.1,
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
