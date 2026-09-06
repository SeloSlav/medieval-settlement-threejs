import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateBuildingPlacement,
  type BuildingPlacementFailureReason,
} from '../src/buildings/BuildingPlacementValidation.ts';
import { BUILDING_DEFINITIONS, BUILDING_KINDS } from '../src/generated/gameBalance.ts';
import type { BuildingKind, BuildingState, ForagingNodeState } from '../src/resources/types.ts';
import { timberInTreeWorkArea } from '../src/resources/treeWorkAreaTimber.ts';
import { TreeRegistry } from '../src/resources/TreeRegistry.ts';
import type { ForestManager } from '../src/props/ForestManager.ts';
import type { TreeEntityState } from '../src/resources/types.ts';

function building(kind: BuildingKind, x = 0, z = 0): BuildingState {
  return {
    id: `existing-${kind}`,
    kind,
    x,
    z,
    yaw: 0,
    workRadius: BUILDING_DEFINITIONS[kind].workRadius,
    constructionComplete: true,
  } as BuildingState;
}

function placementContext(kind: BuildingKind) {
  const radius = BUILDING_DEFINITIONS[kind].workRadius;
  const resourceX = radius * 0.8;
  const resourceZ = radius * 0.5;
  const foragingNodes: ForagingNodeState[] = (['game', 'berries', 'fish'] as const)
    .map((nodeKind) => ({
      nodeId: nodeKind,
      kind: nodeKind,
      resource: 'food',
      x: resourceX,
      z: resourceZ,
      remaining: 100,
      maxYield: 100,
    }));
  return {
    buildings: [building(kind), building('guardhouse', -1000, -1000)],
    residences: [],
    burgageZones: [],
    quarries: [{ nodeId: 'stone', kind: 'quarry' as const, resource: 'stone' as const,
      remaining: 100, maxYield: 100, x: resourceX, z: resourceZ }],
    foragingNodes,
    stockpile: { timber: 10_000, stone: 10_000, ironwork: 10_000, roofTiles: 10_000, gold: 10_000 },
    isWaterAt: () => false,
    getNaturalHeightAt: () => 0,
    countMatureTreesInRadius: () => 100,
    yaw: 0,
  };
}

const radiusKinds = BUILDING_KINDS.filter((kind) => BUILDING_DEFINITIONS[kind].workRadius > 0);
for (const kind of radiusKinds) {
  const context = placementContext(kind);
  const nearbyX = BUILDING_DEFINITIONS[kind].workRadius * 0.8;
  assert.deepEqual(
    validateBuildingPlacement(kind, nearbyX, 0, context),
    { ok: true },
    `${kind}: another building's work or service radius must not exclude an otherwise clear site`,
  );
  assert.deepEqual(
    validateBuildingPlacement(kind, nearbyX, 0, {
      ...context,
      buildings: [{ ...context.buildings[0], constructionComplete: false }, context.buildings[1]],
    }),
    { ok: true },
    `${kind}: construction sites must not reserve their full future work radius`,
  );
  assert.deepEqual(
    validateBuildingPlacement(kind, 0, 0, context),
    { ok: false, reason: 'too_close' },
    `${kind}: overlapping physical footprints must remain blocked`,
  );

  const definition = BUILDING_DEFINITIONS[kind];
  const resourceFailure: BuildingPlacementFailureReason | null = definition.requiresMatureTrees
    ? 'no_trees_in_range'
    : kind === 'stone_quarry' ? 'no_quarry_in_range'
      : definition.requiresGame ? 'no_game_in_range'
        : definition.requiresBerries ? 'no_berries_in_range'
          : definition.requiresFish ? 'no_fish_in_range'
            : null;
  if (resourceFailure) {
    assert.deepEqual(
      validateBuildingPlacement(kind, nearbyX, 0, {
        ...context,
        quarries: [],
        foragingNodes: [],
        countMatureTreesInRadius: () => 0,
      }),
      { ok: false, reason: resourceFailure },
      `${kind}: overlapping work areas do not waive the need for a usable resource`,
    );
  }
}

for (const kind of ['lumber_mill', 'woodcutters_lodge', 'reforester'] as const) {
  const context = placementContext(kind);
  context.buildings[0].treeWorkArea = { x: 80, z: 0, radius: 100 };
  assert.deepEqual(
    validateBuildingPlacement(kind, 60, 0, context),
    { ok: true },
    `${kind}: an authored forestry work circle must not become an exclusion zone`,
  );
}

for (const kind of ['lumber_mill', 'woodcutters_lodge'] as const) {
  assert.deepEqual(validateBuildingPlacement(kind, 60, 0, {
    ...placementContext(kind), countMatureTreesInRadius: () => 0,
    countForestryTreesInRadius: () => 1,
  }), { ok: true }, `${kind}: a camp can be placed to collect existing fallen wood`);
  assert.deepEqual(validateBuildingPlacement(kind, 60, 0, {
    ...placementContext(kind), countMatureTreesInRadius: () => 0,
    countForestryTreesInRadius: () => 0,
  }), { ok: false, reason: 'no_trees_in_range' }, `${kind}: fully depleted stumps are not usable stock`);
}

for (const [kind, reason] of [
  ['monastery', 'monastery_exists'],
  ['town_hall', 'town_hall_exists'],
] as const) {
  assert.deepEqual(
    validateBuildingPlacement(kind, 120, 0, placementContext(kind)),
    { ok: false, reason },
    `${kind}: the explicit settlement landmark limit must still apply`,
  );
}
assert.deepEqual(
  validateBuildingPlacement('palisaded_refuge', 50, 0, {
    ...placementContext('palisaded_refuge'),
    buildings: [building('palisaded_refuge')],
  }),
  { ok: false, reason: 'requires_completed_guardhouse' },
  'overlapping coverage must not bypass the guardhouse prerequisite',
);

for (const path of [
  'src/buildings/BuildingPlacementValidation.ts',
  'server/src/reducers/buildings.rs',
  'src/ui/toastMessages.ts',
]) {
  assert.doesNotMatch(
    readFileSync(path, 'utf8'),
    /overlapsSameKindFunctionalExtent|overlaps_same_kind_functional_extent|overlapping_extent|already covers this functional extent/,
    `${path}: the blanket radius exclusion and its obsolete error must stay removed`,
  );
}

const treeRegistry = TreeRegistry.fromForestManager({
  getTreeLayouts: () => [0, 20, 40, 80, 100].map((x, layoutIndex) => ({
    x, z: 0, layoutIndex, form: 'broad', species: 'beech', scale: 1,
  })),
} as unknown as ForestManager);
const trees = new Map<string, TreeEntityState>([
  ['tree-0', { treeId: 'tree-0', layoutIndex: 0, phase: 'mature', growthProgress: 1 }],
  ['tree-1', { treeId: 'tree-1', layoutIndex: 1, phase: 'logs', growthProgress: 0,
    logs: [{ x: 20, z: 0, health: 25, maxHealth: 60, firewood: 4 }] }],
  ['tree-2', { treeId: 'tree-2', layoutIndex: 2, phase: 'growing', growthProgress: 0.5 }],
  ['tree-3', { treeId: 'tree-3', layoutIndex: 3, phase: 'stump', growthProgress: 0 }],
  ['tree-4', { treeId: 'tree-4', layoutIndex: 4, phase: 'mature', growthProgress: 1 }],
]);
const workArea = { x: 0, z: 0, radius: 80 };
assert.equal(timberInTreeWorkArea({ trees }, treeRegistry, workArea), 8,
  'count standing yield and whole timber in logs, excluding regrowth, stumps, split firewood and outside trees');
for (const phase of ['falling', 'fallen'] as const) {
  trees.get('tree-0')!.phase = phase;
  assert.equal(timberInTreeWorkArea({ trees }, treeRegistry, workArea), 8,
    `${phase} trees retain their timber until processed`);
}
trees.get('tree-0')!.phase = 'logs';
trees.get('tree-0')!.logs = [0, 1, 2].map(() => ({ x: 0, z: 0, health: 20, maxHealth: 20, firewood: 0 }));
assert.equal(timberInTreeWorkArea({ trees }, treeRegistry, workArea), 8, 'bucking conserves the displayed timber');
trees.get('tree-0')!.logs = [];
assert.equal(timberInTreeWorkArea({ trees }, treeRegistry, workArea), 2, 'hauling removes timber from woodland stock');
assert.equal(timberInTreeWorkArea({ trees }, treeRegistry, { x: 100, z: 0, radius: 20 }), 6,
  'moving the circle counts its new woodland');
assert.equal(timberInTreeWorkArea({ trees }, treeRegistry, { x: 0, z: 0, radius: 10 }), 0,
  'empty circles show zero');
assert.equal(timberInTreeWorkArea({ trees }, treeRegistry, { ...workArea, radius: 100 }), 8,
  'resizing includes trees on the circle boundary');

console.log(`Work/service area placement checks passed for all ${radiusKinds.length} radius-bearing building kinds; forestry timber totals passed.`);
