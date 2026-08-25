import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  LARGE_QUARRY_TIMBER_SUPPORT_BUFFER_CYCLES,
  LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import {
  LARGE_QUARRY_SUPPORT_TARGET,
  largeQuarrySupportRunwayCycles,
  largeQuarrySupportsReady,
} from '../src/economy/largeQuarrySupportPolicy.ts';
import {
  resolveBuildingPlacementPoint,
  validateBuildingPlacement,
} from '../src/buildings/BuildingPlacementValidation.ts';
import { surfaceRockCountForRemaining } from '../src/quarries/quarryDepletion.ts';
import type { BuildingState, ResourceNodeState } from '../src/resources/types.ts';
import { collectWorkerTargets, pickWorkerWalkPlan } from '../src/settlement/workerPaths.ts';
import { createRegionalResourcePlan } from '../src/world/regionalResourceDistribution.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../src/world/worldGenerationSettings.ts';

const worldResourceRows = JSON.parse(readFileSync('server/generated/world_quarries.json', 'utf8'))
  .quarries as Array<{
    quarryId: string;
    x: number;
    z: number;
    maxYield: number;
    isRich: boolean;
  }>;
const worldQuarries = worldResourceRows.filter((quarry) =>
  quarry.quarryId.startsWith('quarry-')
);
const defaultResourcePlan = createRegionalResourcePlan(DEFAULT_WORLD_GENERATION_SETTINGS);
assert.equal(
  worldQuarries.length,
  defaultResourcePlan.ordinaryQuarryCount + defaultResourcePlan.richStoneDepositCount,
  'generated bootstrap should match the default map-size stone budget',
);
assert.equal(
  worldQuarries.filter((quarry) => quarry.isRich).length,
  defaultResourcePlan.richStoneDepositCount,
  'generated rich stone must match the default seed roll',
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
  'Quarry placement should snap to the eligible rich-stone center',
);
assert.deepEqual(
  resolveBuildingPlacementPoint('large_quarry', ordinary.x, ordinary.z, quarryStates),
  { x: ordinary.x, z: ordinary.z },
  'ordinary deposits must not become Quarry snap targets',
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
  isResourceDepositAt: (x: number, z: number) => quarryStates.some((quarry) =>
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
    !placementContext.isResourceDepositAt(point.x, point.z)
    && Math.hypot(point.x - rich.x, point.z - rich.z) <= BUILDING_DEFINITIONS.stone_quarry.workRadius
  );
assert.ok(nearbyCampPoint, 'rich deposit should have nearby ground in Mining Camp range');
assert.deepEqual(
  validateBuildingPlacement('stone_quarry', nearbyCampPoint.x, nearbyCampPoint.z, placementContext),
  { ok: true },
);
assert.deepEqual(
  validateBuildingPlacement('stone_quarry', rich.x, rich.z, placementContext),
  { ok: false, reason: 'on_resource_deposit' },
);

assert.equal(surfaceRockCountForRemaining(40, 4000, 4000), 40);
assert.equal(surfaceRockCountForRemaining(40, 2000, 4000), 20);
assert.equal(surfaceRockCountForRemaining(40, 1, 4000), 1);
assert.equal(surfaceRockCountForRemaining(40, 0, 4000), 0);

assert.equal(BUILDING_DEFINITIONS.large_quarry.maxLabor, 6);
assert.equal(BUILDING_DEFINITIONS.large_quarry.workRadius, 0);
assert.equal(BUILDING_STORAGE_CAPS.large_quarry.stone, 360);
assert.equal(BUILDING_STORAGE_CAPS.large_quarry.timber, 12);
assert.equal(BUILDING_DEFINITIONS.large_quarry.requiresRoad, true);
assert.equal(LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE, 1);
assert.equal(LARGE_QUARRY_TIMBER_SUPPORT_BUFFER_CYCLES, 6);
assert.equal(LARGE_QUARRY_SUPPORT_TARGET, 6);
assert.equal(largeQuarrySupportRunwayCycles(6), 6);
assert.equal(largeQuarrySupportsReady(0.99), false);
assert.equal(largeQuarrySupportsReady(1), true);
assert.equal(
  BUILDING_DEFINITIONS.large_quarry.harvestInterval,
  BUILDING_DEFINITIONS.stone_quarry.harvestInterval,
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
assert.equal(workerTargets.length, 6, 'Quarry should expose one underground work stop per labor slot');
const workerPlan = pickWorkerWalkPlan(largeQuarry, 0, workerTargets, 42);
assert.equal(workerPlan?.activity, 'mine');

const serverWorkflow = readFileSync('server/src/simulation/large_quarry.rs', 'utf8');
assert.match(serverWorkflow, /deposit_building/);
assert.match(
  serverWorkflow,
  /request_connected_commodity[\s\S]*CommodityKind::Timber[\s\S]*lumber_mill[\s\S]*village_storehouse[\s\S]*large_quarry_support_target/,
  'the deep quarry must request physical prepared timber from connected suppliers',
);
assert.match(
  serverWorkflow,
  /!large_quarry_supports_ready\(building\.timber\)[\s\S]*return;/,
  'deep quarry cooldown must not advance without one complete support batch',
);
assert.match(
  serverWorkflow,
  /deposit_building_commodity[\s\S]*!= batch[\s\S]*return;[\s\S]*CommodityKind::Timber[\s\S]*LARGE_QUARRY_TIMBER_SUPPORT_PER_CYCLE/,
  'prepared chamber timber must wear only after stone is actually produced',
);
assert.doesNotMatch(
  serverWorkflow,
  /quarry\(\)\.quarry_id\(\)\.update/,
  'underground production must not reduce the finite surface row',
);

console.log('rich stone system tests passed');
