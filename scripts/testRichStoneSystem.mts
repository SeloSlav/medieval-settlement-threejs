import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILDING_DEFINITIONS, BUILDING_STORAGE_CAPS } from '../src/generated/gameBalance.ts';
import {
  resolveBuildingPlacementPoint,
  validateBuildingPlacement,
} from '../src/buildings/BuildingPlacementValidation.ts';
import { surfaceRockCountForRemaining } from '../src/quarries/quarryDepletion.ts';
import type { BuildingState, ResourceNodeState } from '../src/resources/types.ts';
import { collectWorkerTargets, pickWorkerWalkPlan } from '../src/settlement/workerPaths.ts';
import { createRegionalResourcePlan } from '../src/world/regionalResourceDistribution.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../src/world/worldGenerationSettings.ts';

const worldQuarries = JSON.parse(readFileSync('server/generated/world_quarries.json', 'utf8'))
  .quarries as Array<{
    quarryId: string;
    x: number;
    z: number;
    maxYield: number;
    isRich: boolean;
  }>;
assert.equal(
  worldQuarries.length,
  createRegionalResourcePlan(DEFAULT_WORLD_GENERATION_SETTINGS).ordinaryQuarryCount + 1,
  'generated bootstrap should match the default map-size stone budget',
);
assert.equal(
  worldQuarries.filter((quarry) => quarry.isRich).length,
  1,
  'exactly one generated deposit should carry a rich underground source',
);
assert.ok(worldQuarries.every((quarry) => quarry.maxYield > 0));

const quarryStates: ResourceNodeState[] = worldQuarries.map((quarry) => ({
  nodeId: quarry.quarryId,
  kind: 'quarry',
  resource: 'stone',
  remaining: quarry.maxYield,
  maxYield: quarry.maxYield,
  x: quarry.x,
  z: quarry.z,
  isRich: quarry.isRich,
}));
const rich = quarryStates.find((quarry) => quarry.isRich)!;
const ordinary = quarryStates.find((quarry) => !quarry.isRich)!;

assert.deepEqual(
  resolveBuildingPlacementPoint('large_quarry', rich.x + 24, rich.z - 12, quarryStates),
  { x: rich.x, z: rich.z },
  'Large Quarry placement should snap to the rich source center',
);
assert.deepEqual(
  resolveBuildingPlacementPoint('large_quarry', ordinary.x, ordinary.z, quarryStates),
  { x: ordinary.x, z: ordinary.z },
  'ordinary deposits must not become Large Quarry snap targets',
);

const placementContext = {
  buildings: [] as BuildingState[],
  residences: [],
  burgageZones: [],
  farmFields: [],
  pastures: [],
  quarries: quarryStates,
  foragingNodes: [],
  stockpile: { timber: 999, stone: 999 },
  isWaterAt: () => false,
  isQuarryPitAt: (x: number, z: number) => quarryStates.some((quarry) =>
    Math.hypot(quarry.x - x, quarry.z - z) <= (quarry.isRich ? 58 : 30)
  ),
  getNaturalHeightAt: () => 0,
};
assert.deepEqual(
  validateBuildingPlacement('large_quarry', rich.x, rich.z, placementContext),
  { ok: true },
);
assert.deepEqual(
  validateBuildingPlacement('large_quarry', ordinary.x, ordinary.z, placementContext),
  { ok: false, reason: 'requires_rich_deposit' },
);

const nearbyCampPoint = Array.from({ length: 23 }, (_, index) => 58 + index)
  .map((distance) => ({ x: rich.x + distance, z: rich.z }))
  .find((point) =>
    !placementContext.isQuarryPitAt(point.x, point.z)
    && Math.hypot(point.x - rich.x, point.z - rich.z) <= BUILDING_DEFINITIONS.stone_quarry.workRadius
  );
assert.ok(nearbyCampPoint, 'rich deposit should have nearby ground in Stonecutter range');
assert.deepEqual(
  validateBuildingPlacement('stone_quarry', nearbyCampPoint.x, nearbyCampPoint.z, placementContext),
  { ok: true },
);
assert.deepEqual(
  validateBuildingPlacement('stone_quarry', rich.x, rich.z, placementContext),
  { ok: false, reason: 'on_quarry_pit' },
);

assert.equal(surfaceRockCountForRemaining(40, 4000, 4000), 40);
assert.equal(surfaceRockCountForRemaining(40, 2000, 4000), 20);
assert.equal(surfaceRockCountForRemaining(40, 1, 4000), 1);
assert.equal(surfaceRockCountForRemaining(40, 0, 4000), 0);

assert.equal(BUILDING_DEFINITIONS.large_quarry.maxLabor, 6);
assert.equal(BUILDING_DEFINITIONS.large_quarry.workRadius, 0);
assert.equal(BUILDING_STORAGE_CAPS.large_quarry.stone, 360);
assert.ok(
  BUILDING_DEFINITIONS.large_quarry.harvestInterval
    < BUILDING_DEFINITIONS.stone_quarry.harvestInterval,
);

const largeQuarry = {
  id: 'large-quarry-test',
  kind: 'large_quarry',
  x: rich.x,
  z: rich.z,
  workRadius: 0,
  assignedLabor: 3,
  constructionComplete: true,
} as BuildingState;
const workerTargets = collectWorkerTargets(largeQuarry, {
  quarries: quarryStates,
  foragingNodes: [],
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
});
assert.equal(workerTargets.length, 6, 'Large Quarry should expose one underground work stop per labor slot');
const workerPlan = pickWorkerWalkPlan(largeQuarry, 0, workerTargets, 42);
assert.equal(workerPlan?.activity, 'mine');

const serverWorkflow = readFileSync('server/src/simulation/large_quarry.rs', 'utf8');
assert.match(serverWorkflow, /deposit_building/);
assert.doesNotMatch(
  serverWorkflow,
  /quarry\(\)\.quarry_id\(\)\.update/,
  'underground production must not reduce the finite surface row',
);

console.log('rich stone system tests passed');
