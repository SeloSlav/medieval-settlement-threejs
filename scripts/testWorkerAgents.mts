import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  WORKER_ACTIVITY_CLIPS,
} from '../src/audio/audioCatalog.ts';
import {
  WORKER_SOUND_CUTOFF_DISTANCE,
  WORKER_SOUND_FULL_VOLUME_DISTANCE,
  WORKER_SOUND_MAX_ZOOM_DISTANCE,
  workerActivitySoundGain,
} from '../src/audio/WorkerActivityAudio.ts';
import type {
  BuildingState,
  FarmFieldState,
  ForagingNodeState,
  PastureState,
  ResidenceState,
  ResourceNodeState,
  TreeEntityState,
  TreeLayoutEntry,
} from '../src/resources/types.ts';
import { computeVillagerSlots } from '../src/settlement/villagerPaths.ts';
import {
  allocateProductionWorkers,
  collectWorkerTargets,
  FISHING_SHORE_STANDOFF,
  pickWorkerWalkPath,
  pickWorkerWalkPlan,
  PRODUCTION_WORKPLACE_KINDS,
  WATCHTOWER_GALLERY_FLOOR_HEIGHT,
  watchtowerDutyPosition,
  workerProductionBlocker,
  workerProductionBlockerDescription,
  workplaceYardPosition,
  YARD_WORK_ACTIVITY,
} from '../src/settlement/workerPaths.ts';
import { samplePolylineXZ } from '../src/utils/pathGeometry.ts';
import { workerToolVisibleInMode } from '../src/settlement/SettlementCrowdRenderer.ts';
import { WORKER_TOOL_URLS } from '../src/settlement/workerTools.ts';
import {
  WATCHTOWER_GALLERY_RAIL_CENTER_Y,
  WATCHTOWER_GALLERY_RAIL_HEIGHT,
  WATCHTOWER_ROOF_CENTER_Y,
  WATCHTOWER_ROOF_HEIGHT,
} from '../src/buildings/watchtowerLayout.ts';
import { MONASTERY_EXTENSION_INFIRMARY } from '../src/buildings/monasteryEstate.ts';
import {
  villagerDisplayName,
  villagerOccupation,
} from '../src/settlement/villagerIdentity.ts';
import { buildCrowdViewState } from '../src/settlement/crowdView.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import {
  WORKFORCE_AVERAGE_WALK_SPEED_MPS,
  WORKFORCE_ROAD_SPEED_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  createSelectedAgentRoute,
  SELECTED_AGENT_ROUTE_COLOR,
  updateSelectedAgentRoute,
} from '../src/scene/SelectedAgentRoute.ts';
import { VillagerRenderer } from '../src/settlement/VillagerRenderer.ts';
import type { GameHabitatDisturbanceSource } from '../src/foraging/gameHabitatDisturbance.ts';

const selectedWorkerRoute = createSelectedAgentRoute('Selected worker route test');
assert.equal(selectedWorkerRoute.material.color.getHex(), SELECTED_AGENT_ROUTE_COLOR);
assert.equal(selectedWorkerRoute.material.dashSize, 1.1);
assert.equal(selectedWorkerRoute.material.gapSize, 0.72);
updateSelectedAgentRoute(selectedWorkerRoute, [
  { x: 0, y: 0.24, z: 0 },
  { x: 8, y: 0.24, z: 4 },
]);
assert.equal(selectedWorkerRoute.visible, true);
const selectedRoutePosition = selectedWorkerRoute.geometry.getAttribute('position');
const selectedRouteDistance = selectedWorkerRoute.geometry.getAttribute('lineDistance');
assert.ok(
  selectedRouteDistance.count >= 2,
  'the shared pink agent route must compute dashed-line distances',
);
assert.ok(
  Math.abs(selectedRouteDistance.getX(1) - Math.hypot(
    selectedRoutePosition.getX(1) - selectedRoutePosition.getX(0),
    selectedRoutePosition.getY(1) - selectedRoutePosition.getY(0),
    selectedRoutePosition.getZ(1) - selectedRoutePosition.getZ(0),
  )) < 1e-6,
  'reused route buffers must retain Three.js line-distance semantics',
);
updateSelectedAgentRoute(selectedWorkerRoute, [
  { x: 1, y: 0.24, z: 2 },
  { x: 5, y: 0.24, z: 4 },
]);
assert.strictEqual(
  selectedWorkerRoute.geometry.getAttribute('position'),
  selectedRoutePosition,
  'same-sized moving routes must update the existing GPU position buffer',
);
assert.strictEqual(
  selectedWorkerRoute.geometry.getAttribute('lineDistance'),
  selectedRouteDistance,
  'same-sized moving routes must update the existing GPU dash-distance buffer',
);
const movingRoute = [
  { x: 1, y: 0.24, z: 2 },
  { x: 5, y: 0.24, z: 4 },
];
const routePacingStarted = performance.now();
for (let frame = 0; frame < 20_000; frame += 1) {
  movingRoute[0].x = frame * 0.0001;
  updateSelectedAgentRoute(selectedWorkerRoute, movingRoute);
}
const routePacingElapsed = performance.now() - routePacingStarted;
assert.strictEqual(selectedWorkerRoute.geometry.getAttribute('position'), selectedRoutePosition);
assert.strictEqual(selectedWorkerRoute.geometry.getAttribute('lineDistance'), selectedRouteDistance);
assert.ok(
  routePacingElapsed < 200,
  `20,000 selected-route updates took ${routePacingElapsed.toFixed(1)} ms`,
);
updateSelectedAgentRoute(selectedWorkerRoute, [
  { x: 0, y: 0.24, z: 0 },
  { x: 2, y: 0.24, z: 1 },
  { x: 5, y: 0.24, z: 4 },
]);
const grownRoutePosition = selectedWorkerRoute.geometry.getAttribute('position');
assert.notStrictEqual(grownRoutePosition, selectedRoutePosition, 'route capacity must grow on demand');
updateSelectedAgentRoute(selectedWorkerRoute, [
  { x: 1, y: 0.24, z: 0 },
  { x: 3, y: 0.24, z: 1 },
  { x: 6, y: 0.24, z: 4 },
]);
assert.strictEqual(
  selectedWorkerRoute.geometry.getAttribute('position'),
  grownRoutePosition,
  'grown route buffers must remain stable on subsequent frames',
);
updateSelectedAgentRoute(selectedWorkerRoute, []);
assert.equal(selectedWorkerRoute.visible, false);
selectedWorkerRoute.geometry.dispose();
selectedWorkerRoute.material.dispose();

const residenceA = residence('residence-a', 0, 0, 3);
const residenceB = residence('residence-b', 100, 0, 2);
const lumberMill = building('building-1', 'lumber_mill', 10, 0, 2, 60);
const stoneCamp = building('building-2', 'stone_quarry', 92, 0, 2, 55);
const serviceWell = building('building-3', 'well', 50, 0, 2, 90);

const roster = allocateProductionWorkers(
  [residenceA, residenceB],
  [serviceWell, stoneCamp, lumberMill],
);
assert.equal(
  roster.assignments.length,
  6,
  'staffed posts may use the unhoused remainder of the ten-person founding population',
);
assert.deepEqual(
  roster.assignments.map((assignment) => assignment.buildingId),
  [
    'building-1',
    'building-1',
    'building-2',
    'building-2',
    'building-3',
    'building-3',
  ],
);
assert.equal(roster.remainingPopulationByResidence.get(residenceA.id), 0);
assert.equal(roster.remainingPopulationByResidence.get(residenceB.id), 0);
assert.equal(
  roster.assignments.filter((assignment) => assignment.homeResidenceId === null).length,
  1,
  'the one unfilled post should use one real settler still sleeping at the founders camp',
);
assert.ok(
  roster.assignments.every((assignment) => assignment.onSite),
  'workers without an active cart trip should remain visible at their workplaces',
);

const travelingRoster = allocateProductionWorkers(
  [residenceA, residenceB],
  [serviceWell, stoneCamp, lumberMill],
  new Map([
    ['building-1', 1],
    ['building-2', 2],
  ]),
);
assert.equal(
  travelingRoster.assignments.length,
  roster.assignments.length,
  'traveling workers must stay claimed from the settlement population',
);
assert.deepEqual(
  travelingRoster.assignments
    .filter((assignment) => assignment.onSite)
    .map((assignment) => assignment.id),
  [
    'worker:building-1:0',
    'worker:building-3:0',
    'worker:building-3:1',
  ],
  'only roster-backed cart crews should disappear from workplace bodies',
);
assert.equal(travelingRoster.remainingPopulationByResidence.get(residenceA.id), 0);
assert.equal(travelingRoster.remainingPopulationByResidence.get(residenceB.id), 0);

const homeSlots = computeVillagerSlots(
  [residenceA, residenceB],
  null,
  roster.remainingPopulationByResidence,
);
assert.equal(homeSlots.has(residenceA.id), false);
assert.equal(homeSlots.has(residenceB.id), false, 'fully assigned households disappear from home crowd');

const overstaffed = allocateProductionWorkers(
  [residence('residence-c', 0, 0, 1)],
  [building('building-4', 'stone_quarry', 0, 0, 3, 55)],
);
assert.equal(overstaffed.assignments[0]?.homeResidenceId, 'residence-c');
assert.equal(overstaffed.assignments[1]?.homeResidenceId, null);
assert.equal(overstaffed.assignments[2]?.homeResidenceId, null);

const illnessHousehold = {
  ...residence('illness-household', 0, 0, 8),
  sickPopulation: 3,
};
const illnessRoster = allocateProductionWorkers(
  [illnessHousehold],
  [building('illness-workplace', 'stone_quarry', 0, 0, 8, 55)],
);
assert.equal(
  illnessRoster.assignments.length,
  8,
  'homebound sick residents remain unavailable while healthy unhoused founders fill real open posts',
);
assert.deepEqual(
  illnessRoster.assignments.map((assignment) => assignment.personIdentity),
  [
    'illness-household:person:3',
    'illness-household:person:4',
    'illness-household:person:5',
    'illness-household:person:6',
    'illness-household:person:7',
    'starting-population:0',
    'starting-population:1',
    'starting-population:2',
  ],
  'the first household identities remain reserved for visible homebound sick residents before founders fill the roster',
);

const travelRoads = new RoadNetwork();
travelRoads.addRoadPath([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(100, 0, 0),
]);
const routedRoster = allocateProductionWorkers(
  [
    residence('road-connected-home', 0, 0, 1),
    residence('near-but-disconnected-home', 100, 90, 1),
  ],
  [building('remote-routed-workplace', 'lumber_mill', 100, 0, 1, 60)],
  new Map(),
  travelRoads,
);
assert.equal(
  routedRoster.assignments[0]?.homeResidenceId,
  'road-connected-home',
  'road travel time should beat a slightly shorter direct walk when the road pace makes it faster',
);
assert.equal(WORKFORCE_AVERAGE_WALK_SPEED_MPS, 1.225);
assert.equal(WORKFORCE_ROAD_SPEED_MULTIPLIER, 1.25);
const treeEntries: TreeLayoutEntry[] = [
  treeEntry('tree-mature', 20, 0),
  treeEntry('tree-stump', 22, 0),
];
const trees = new Map<string, TreeEntityState>([
  ['tree-mature', treeState('tree-mature', 'mature')],
  ['tree-stump', treeState('tree-stump', 'stump')],
]);
const targetInputs = {
  quarries: [] as ResourceNodeState[],
  foragingNodes: [],
  trees,
  treeRegistry: {
    treesInRadius: () => treeEntries,
  },
  farmFields: [],
  pastures: [],
};
assert.deepEqual(
  collectWorkerTargets(lumberMill, targetInputs).map((target) => target.id),
  ['tree-mature'],
  'lumber workers should only walk toward mature trees',
);
assert.deepEqual(
  collectWorkerTargets(
    building('building-5', 'reforester', 0, 0, 1, 60),
    targetInputs,
  ).map((target) => target.id),
  ['tree-stump'],
  'reforesters should walk toward stumps or growing trees',
);
const reforester = building('building-5', 'reforester', 0, 0, 1, 60);
const reforesterPlan = Array.from({ length: 32 }, (_, seed) =>
  pickWorkerWalkPlan(reforester, 0, collectWorkerTargets(reforester, targetInputs), seed)
).find((plan) => plan?.activity === 'plant');
assert.ok(reforesterPlan, 'reforesters should stop and plant at regrowing tree targets');
assert.equal(reforesterPlan.target?.id, 'tree-stump');

const remoteTreeEntries: TreeLayoutEntry[] = [
  treeEntry('tree-default-mature', 20, 0),
  treeEntry('tree-remote-mature', 240, 0),
  treeEntry('tree-remote-stump', 244, 0),
  treeEntry('tree-outside-circle', 265, 0),
];
const remoteTrees = new Map<string, TreeEntityState>([
  ['tree-default-mature', treeState('tree-default-mature', 'mature')],
  ['tree-remote-mature', treeState('tree-remote-mature', 'mature')],
  ['tree-remote-stump', treeState('tree-remote-stump', 'stump')],
  ['tree-outside-circle', treeState('tree-outside-circle', 'mature')],
]);
const remoteTargetInputs = {
  ...targetInputs,
  trees: remoteTrees,
  treeRegistry: {
    treesInRadius: (x: number, z: number, radius: number) => remoteTreeEntries.filter(
      (tree) => Math.hypot(tree.x - x, tree.z - z) <= radius,
    ),
  },
};
const limitedLumberMill = {
  ...building('limited-lumber', 'lumber_mill', 0, 0, 1, 60),
  treeWorkArea: { x: 240, z: 0, radius: 20 },
};
assert.deepEqual(
  collectWorkerTargets(limitedLumberMill, remoteTargetInputs).map((target) => target.id),
  ['tree-remote-mature'],
  'a limited lumber area should ignore default-range and out-of-circle mature trees',
);
const limitedReforester = {
  ...building('limited-reforester', 'reforester', 0, 0, 1, 60),
  treeWorkArea: { x: 240, z: 0, radius: 20 },
};
assert.deepEqual(
  collectWorkerTargets(limitedReforester, remoteTargetInputs).map((target) => target.id),
  ['tree-remote-stump'],
  'a limited reforester area should manage only recovering trees inside its circle',
);
const remoteLumberPlan = Array.from({ length: 32 }, (_, seed) =>
  pickWorkerWalkPlan(
    limitedLumberMill,
    0,
    collectWorkerTargets(limitedLumberMill, remoteTargetInputs),
    seed,
  )
).find((plan) => plan?.activity === 'chop');
assert.ok(remoteLumberPlan, 'a worker should accept a tree area far beyond the default extent');
assert.ok(
  remoteLumberPlan.path.some((point) => Math.hypot(point.x - 240, point.z) < 4),
  'a remote tree-work route must reach its target rather than clamp to the default extent',
);

const quarryCamp = building('building-6', 'stone_quarry', 0, 0, 1, 55);
const quarryTarget = resourceNode('quarry-near', 'quarry', 30, 0, 80);
const depletedTarget = resourceNode('quarry-empty', 'quarry', 20, 0, 0);
const distantTarget = resourceNode('quarry-far', 'quarry', 80, 0, 40);
const quarryTargets = collectWorkerTargets(quarryCamp, {
  ...targetInputs,
  quarries: [quarryTarget, depletedTarget, distantTarget],
});
assert.deepEqual(quarryTargets.map((target) => target.id), ['quarry-near']);

let resourcePathFound = false;
for (let seed = 0; seed < 24; seed++) {
  const path = pickWorkerWalkPath(quarryCamp, 0, quarryTargets, seed);
  assert.ok(path && path.length >= 5);
  assert.ok(
    path.every((point) => Math.hypot(point.x - quarryCamp.x, point.z - quarryCamp.z) <= 55),
    'worker paths must stay inside the workplace extent',
  );
  if (path.some((point) => Math.hypot(point.x - quarryTarget.x, point.z - quarryTarget.z) < 4)) {
    resourcePathFound = true;
  }
}
assert.equal(resourcePathFound, true, 'workers should regularly walk out to eligible resources');

const quarryWorkPlan = Array.from({ length: 32 }, (_, seed) =>
  pickWorkerWalkPlan(quarryCamp, 0, quarryTargets, seed)
).find((plan) => plan?.activity === 'mine');
assert.ok(quarryWorkPlan, 'surface miners should schedule extraction stops at geological targets');
assert.equal(quarryWorkPlan.target?.id, quarryTarget.nodeId);
assert.ok(
  quarryWorkPlan.workDistance != null
    && quarryWorkPlan.workDistance > 0
    && quarryWorkPlan.workDistance < quarryWorkPlan.path.length * quarryCamp.workRadius,
);

const lumberTargets = collectWorkerTargets(lumberMill, targetInputs);
const lumberWorkPlan = Array.from({ length: 32 }, (_, seed) =>
  pickWorkerWalkPlan(lumberMill, 0, lumberTargets, seed)
).find((plan) => plan?.activity === 'chop');
assert.ok(lumberWorkPlan, 'lumberjacks should schedule chopping stops at mature trees');
assert.equal(lumberWorkPlan.target?.id, 'tree-mature');

const woodcuttersLodge = building('building-lodge', 'woodcutters_lodge', 0, 0, 1, 60);
const lodgeTreeTargets = collectWorkerTargets(woodcuttersLodge, targetInputs);
assert.deepEqual(
  lodgeTreeTargets.map((target) => target.id),
  ['tree-mature'],
  'woodcutters should target mature trees directly instead of a yard processing station',
);
const lodgeChopPlan = Array.from({ length: 32 }, (_, seed) =>
  pickWorkerWalkPlan(woodcuttersLodge, 0, lodgeTreeTargets, seed)
).find((plan) => plan?.activity === 'chop');
assert.ok(lodgeChopPlan, 'woodcutters should visibly chop at their selected mature tree');
assert.equal(lodgeChopPlan.target?.id, 'tree-mature');

for (const [kind, nodeKind, expectedActivity] of [
  ['hunters_hall', 'game', 'gather'],
  ['foragers_shed', 'berries', 'gather'],
  ['fishing_camp', 'fish', 'fish'],
] as const) {
  const workplace = building(`natural-${kind}`, kind, 0, 0, 1, 60);
  const node = foragingNode(`${nodeKind}-near`, nodeKind, 24, 0);
  const targets = collectWorkerTargets(workplace, {
    ...targetInputs,
    foragingNodes: [node],
  });
  const activityPlan = Array.from({ length: 32 }, (_, seed) =>
    pickWorkerWalkPlan(
      workplace,
      0,
      targets,
      seed,
      null,
      kind === 'fishing_camp'
        ? (x: number) => x >= 18
        : null,
    )
  ).find((plan) => plan?.activity === expectedActivity);
  assert.ok(
    activityPlan,
    `${kind} workers should perform ${expectedActivity} at ${nodeKind} targets`,
  );
}

for (const waterFixture of [
  {
    label: 'pond',
    shoal: { x: 24, z: 0 },
    isWaterAt: (x: number, z: number) => Math.hypot(x - 24, z) <= 8,
  },
  {
    label: 'river',
    shoal: { x: 24, z: 0 },
    isWaterAt: (x: number, z: number) => x >= 18 && x <= 30,
  },
] as const) {
  const fishingCamp = building(
    `shoreline-${waterFixture.label}`,
    'fishing_camp',
    0,
    0,
    3,
    60,
  );
  const shoal = foragingNode(
    `${waterFixture.label}-shoal`,
    'fish',
    waterFixture.shoal.x,
    waterFixture.shoal.z,
  );
  const targets = collectWorkerTargets(fishingCamp, {
    ...targetInputs,
    foragingNodes: [shoal],
  });

  for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
    const fishingPlans = Array.from({ length: 64 }, (_, seed) =>
      pickWorkerWalkPlan(
        fishingCamp,
        slotIndex,
        targets,
        seed,
        null,
        waterFixture.isWaterAt,
      )
    );
    assert.ok(
      fishingPlans.every((plan) => plan?.activity === 'fish'),
      `${waterFixture.label} fishers should never replace shoreline work with a wet yard loop`,
    );
    for (const fishingPlan of fishingPlans) {
      assert.ok(fishingPlan);
      assert.ok(fishingPlan.workDistance != null);
      const stop = samplePolylineXZ(fishingPlan.path, fishingPlan.workDistance);
      assert.ok(stop, `${waterFixture.label} fishing plan should retain its activity stop`);
      assert.equal(
        waterFixture.isWaterAt(stop.x, stop.z),
        false,
        `${waterFixture.label} fishers must stand on dry land rather than at the shoal center`,
      );
      assert.equal(
        waterFixture.isWaterAt(fishingPlan.target!.x, fishingPlan.target!.z),
        true,
        `${waterFixture.label} plans should keep the wet shoal as the casting focus`,
      );
      const focusDistance = Math.hypot(
        fishingPlan.target!.x - stop.x,
        fishingPlan.target!.z - stop.z,
      );
      const towardWater = {
        x: stop.x + (fishingPlan.target!.x - stop.x) / focusDistance
          * (FISHING_SHORE_STANDOFF + 0.25),
        z: stop.z + (fishingPlan.target!.z - stop.z) / focusDistance
          * (FISHING_SHORE_STANDOFF + 0.25),
      };
      assert.equal(
        waterFixture.isWaterAt(towardWater.x, towardWater.z),
        true,
        `${waterFixture.label} fishing stop should remain immediately beside the water`,
      );
      assertDryPolyline(
        fishingPlan.path,
        waterFixture.isWaterAt,
        `${waterFixture.label} fishers should never traverse open water`,
      );
    }
  }

  for (let seed = 0; seed < 16; seed += 1) {
    assert.equal(
      pickWorkerWalkPlan(fishingCamp, 0, [], seed, null, waterFixture.isWaterAt),
      null,
      `${waterFixture.label} crews without a harvestable shoal should stay in the dry yard`,
    );
  }
}

const closeBankCamp = building('shoreline-close', 'fishing_camp', 0, 0, 3, 60);
const closeBankWater = (x: number) => x >= 5.5;
assert.equal(
  closeBankWater(workplaceYardPosition(closeBankCamp, 2, null, () => false).x),
  true,
  'the close-bank fixture should expose a generic yard slot over water',
);
assert.equal(
  closeBankWater(workplaceYardPosition(closeBankCamp, 2, null, closeBankWater).x),
  false,
  'fishing-camp yard slots should be pulled safely inland when the bank is close',
);
const closeBankTargets = collectWorkerTargets(closeBankCamp, {
  ...targetInputs,
  foragingNodes: [foragingNode('close-bank-shoal', 'fish', 10, 0)],
});
const closeBankPlans = Array.from({ length: 64 }, (_, seed) =>
  pickWorkerWalkPlan(
    closeBankCamp,
    2,
    closeBankTargets,
    seed,
    null,
    closeBankWater,
  )
);
assert.ok(
  closeBankPlans.every((plan) => plan?.activity === 'fish'),
  'a relocated dry yard slot should always reach its shoreline work stop',
);
for (const closeBankPlan of closeBankPlans) {
  assert.ok(closeBankPlan);
  assertDryPolyline(
    closeBankPlan.path,
    closeBankWater,
    'close-bank fishers should remain dry for the complete work loop',
  );
}

const farmstead = building('field-farmstead', 'threshing_barn', 0, 0, 1, 150);
const field = farmField('field-1', farmstead.id, 26, 0);
const fieldPlan = Array.from({ length: 32 }, (_, seed) =>
  pickWorkerWalkPlan(
    farmstead,
    0,
    collectWorkerTargets(farmstead, { ...targetInputs, farmFields: [field] }),
    seed,
  )
).find((plan) => plan?.activity === 'tend');
assert.ok(fieldPlan, 'farmhands should perform field work instead of only visiting fields');

const sowingField = { ...field, id: 'field-sowing', stage: 'sowing' as const };
const sowingPlan = Array.from({ length: 32 }, (_, seed) =>
  pickWorkerWalkPlan(
    farmstead,
    0,
    collectWorkerTargets(farmstead, { ...targetInputs, farmFields: [sowingField] }),
    seed,
  )
).find((plan) => plan?.activity === 'sow');
assert.ok(sowingPlan, 'sowing fields should route farmhands into the broadcast-seed action');
assert.equal(sowingPlan.target?.fieldStage, 'sowing');
assert.equal(
  workerToolVisibleInMode('hoe', 'sow'),
  false,
  'the hoe must be hidden while both hands perform the sowing gesture',
);

for (const kind of ['pastoral_farmstead', 'swineherd'] as const) {
  const workplace = building(`pasture-${kind}`, kind, 0, 0, 1, 120);
  const pasture = pastureState(`pasture-${kind}`, workplace.id, 24, 0);
  const activityPlan = Array.from({ length: 32 }, (_, seed) =>
    pickWorkerWalkPlan(
      workplace,
      0,
      collectWorkerTargets(workplace, { ...targetInputs, pastures: [pasture] }),
      seed,
    )
  ).find((plan) => plan?.activity === 'tend');
  assert.ok(activityPlan, `${kind} workers should visibly tend their pasture`);
}

const expectedWorkplaces = [
  'lumber_mill',
  'reforester',
  'woodcutters_lodge',
  'stone_quarry',
  'large_quarry',
  'mine',
  'clay_pit',
  'charcoal_burner',
  'smithy',
  'potter_kiln',
  'well',
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'threshing_barn',
  'pastoral_farmstead',
  'swineherd',
  'monastery',
  'brewery',
  'smokehouse',
  'granary',
  'village_storehouse',
  'bakery',
  'apiary',
  'watermill',
  'windmill',
  'carpenter',
  'spinning_retting_house',
  'weaver',
  'chandlery',
  'watchtower',
  'guardhouse',
] as const;
assert.deepEqual(
  PRODUCTION_WORKPLACE_KINDS,
  expectedWorkplaces,
  'every staffed gathering and processing workplace should receive visible agents',
);

const monasteryWorkplace = building('visible-monastery', 'monastery', 0, 0, 8, 0);
monasteryWorkplace.monasteryExtensions = MONASTERY_EXTENSION_INFIRMARY;
const monasteryTargets = collectWorkerTargets(monasteryWorkplace, {
  ...targetInputs,
  vineyardParcels: [{
    id: monasteryWorkplace.id,
    monasteryId: monasteryWorkplace.id,
    corners: [
      { x: 30, z: -8 },
      { x: 46, z: -8 },
      { x: 46, z: 8 },
      { x: 30, z: 8 },
    ],
    area: 256,
    averageSlopeDegrees: 4,
    moisture: 0.55,
    southExposure: 0.8,
    siteSuitability: 0.86,
    shapeEfficiency: 1,
  }],
});
assert.ok(
  monasteryTargets.some((target) => target.id.endsWith(':orchard'))
    && monasteryTargets.some((target) => target.id.endsWith(':croft'))
    && monasteryTargets.some((target) => target.id.endsWith(':pasture'))
    && monasteryTargets.some((target) => target.id.endsWith(':infirmary')),
  'monks must visibly work across the productive and service grounds',
);
assert.equal(
  monasteryTargets.filter((target) => target.id.includes(':monastery:vineyard:')).length,
  5,
  'the monastery roster must visibly work the player-drawn vineyard outside the precinct',
);
const outerGateTarget = monasteryTargets.find((target) => target.id.endsWith(':outer-gate'));
assert.ok(
  outerGateTarget && Math.hypot(outerGateTarget.x, outerGateTarget.z) > 15,
  'the porter or almoner must occasionally walk beyond the precinct gate',
);
const monasteryRoster = allocateProductionWorkers(
  [residence('monastery-household', 12, 8, 8)],
  [monasteryWorkplace],
);
assert.equal(monasteryRoster.assignments.length, 8);
assert.equal(villagerOccupation('monastery'), 'Monk');

const materialWorkplaces = [
  building('material-clay-workers', 'clay_pit', 0, 0, 3, 0),
  building('material-charcoal-workers', 'charcoal_burner', 15, 0, 2, 0),
  building('material-smithy-workers', 'smithy', 30, 0, 3, 0),
  building('material-potter-workers', 'potter_kiln', 45, 0, 2, 0),
];
const materialRoster = allocateProductionWorkers(
  [residence('material-worker-homes', 20, 5, 10)],
  materialWorkplaces,
  new Map([['material-smithy-workers', 1]]),
);
assert.equal(
  materialRoster.assignments.length,
  10,
  'every assigned material-chain worker must claim one visible person',
);
for (const workplace of materialWorkplaces) {
  assert.equal(
    materialRoster.assignments.filter(
      (assignment) => assignment.buildingId === workplace.id,
    ).length,
    workplace.assignedLabor,
    `${workplace.kind} must expose its complete assigned crew`,
  );
}
assert.equal(
  materialRoster.assignments.filter(
    (assignment) => assignment.buildingId === 'material-smithy-workers'
      && !assignment.onSite,
  ).length,
  1,
  'a smith traveling with the forge cart must remain claimed without duplicating at the yard',
);
assert.equal(
  materialRoster.remainingPopulationByResidence.get('material-worker-homes'),
  0,
  'material-chain labor must no longer reappear as idle household villagers',
);

const watchtower = building('visible-watchtower', 'watchtower', 40, 80, 2, 190);
const watchRoster = allocateProductionWorkers(
  [residence('watch-household', 42, 84, 2)],
  [watchtower],
);
assert.equal(watchRoster.assignments.length, 2, 'both tower posts should claim real visible watchmen');
const ladderFootA = workplaceYardPosition(watchtower, 0);
const ladderFootB = workplaceYardPosition(watchtower, 1);
assert.ok(
  ladderFootA.z > watchtower.z + 2.5 && ladderFootB.z > watchtower.z + 2.5,
  'watchmen should commute to the exterior ladder before taking post',
);
const lookoutA = watchtowerDutyPosition(watchtower, 0);
const lookoutB = watchtowerDutyPosition(watchtower, 1);
assert.equal(lookoutA.yOffset, WATCHTOWER_GALLERY_FLOOR_HEIGHT);
assert.equal(lookoutB.yOffset, WATCHTOWER_GALLERY_FLOOR_HEIGHT);
assert.notDeepEqual(lookoutA, lookoutB, 'two watchmen need separate sight lines in the gallery');
for (const lookout of [lookoutA, lookoutB]) {
  assert.ok(
    Math.abs(lookout.x - watchtower.x) < 1.8
      && Math.abs(lookout.z - watchtower.z) < 1.8,
    'lookouts must stand inside the raised timber gallery',
  );
}
assert.ok(
  WATCHTOWER_GALLERY_RAIL_CENTER_Y + WATCHTOWER_GALLERY_RAIL_HEIGHT * 0.5
    < WATCHTOWER_GALLERY_FLOOR_HEIGHT + 0.75,
  'the gallery rail must leave a lookout visibly exposed above waist height',
);
assert.ok(
  WATCHTOWER_ROOF_CENTER_Y - WATCHTOWER_ROOF_HEIGHT * 0.5
    > WATCHTOWER_GALLERY_FLOOR_HEIGHT + 1.72,
  'the gallery roof must clear a full-height male villager rig',
);
const boundedWatchRoster = allocateProductionWorkers(
  [residence('bounded-watch-population', 0, 0, 2_000)],
  Array.from({ length: 600 }, (_, index) =>
    building(`bounded-watch-${index}`, 'watchtower', index * 8, 0, 2, 190)
  ),
);
assert.equal(
  boundedWatchRoster.assignments.length,
  1024,
  'visible tower posts must respect the existing settlement crowd budget',
);
const materialScaleSites = Array.from({ length: 20_000 }, (_, index) =>
  building(
    `bounded-material-${index.toString().padStart(5, '0')}`,
    index % 4 === 0
      ? 'clay_pit'
      : index % 4 === 1
        ? 'charcoal_burner'
        : index % 4 === 2
          ? 'smithy'
          : 'potter_kiln',
    index * 3,
    0,
    2,
    0,
  )
);
const materialScaleStartedAt = performance.now();
const boundedMaterialRoster = allocateProductionWorkers(
  [residence('bounded-material-population', 0, 0, 2_000)],
  materialScaleSites,
);
const materialScaleElapsedMs = performance.now() - materialScaleStartedAt;
assert.equal(
  boundedMaterialRoster.assignments.length,
  1024,
  'large industrial settlements must retain the shared visible-agent budget',
);
assert.ok(
  materialScaleElapsedMs < 1_500,
  `20,000 material workplaces took ${materialScaleElapsedMs.toFixed(1)} ms to roster`,
);
const villagerRendererSource = fs.readFileSync('src/settlement/VillagerRenderer.ts', 'utf8');
const removedContentSource = fs.readFileSync(
  'server/src/simulation/removed_content.rs',
  'utf8',
);
for (const removedPath of [
  'src/buildings/remoteWorkCamp.ts',
  'src/resources/inspector/remoteWorkCampRenderer.ts',
  'src/settlement/workerCommute.ts',
  'server/src/simulation/workforce_commute.rs',
  'server/src/workforce_commute_policy.rs',
]) {
  assert.equal(
    fs.existsSync(removedPath),
    false,
    `${removedPath} must stay deleted with shift-based commute and overnight-camp gameplay`,
  );
}
assert.match(
  removedContentSource,
  /matches!\(building\.kind\.as_str\(\),\s*"ferry_landing"\s*\|\s*"remote_work_camp"\)[\s\S]*?building\.kind\s*=\s*"salvage_pile"\.to_string\(\)/,
  'legacy remote-work camps must migrate in place to ordinary salvage piles',
);
assert.match(
  removedContentSource,
  /drain_trips_for_building\(ctx,\s*building\.id\)[\s\S]*?ReclamationStock::from_delivery_cargo\(&cargo\)[\s\S]*?ReclamationStock::from_building\(&building\)[\s\S]*?\.merged\(recovered_cargo\)/,
  'retiring a camp must preserve both its stored inventory and cargo from drained trips',
);
assert.match(
  removedContentSource,
  /building\.assigned_labor\s*=\s*0[\s\S]*?for owner in owners\s*\{[\s\S]*?reconcile_building_labor\(ctx,\s*owner\)/,
  'camp retirement must release assigned workers and reconcile each affected owner',
);
assert.match(
  removedContentSource,
  /for building_id in stale_compatibility_rows[\s\S]*?remote_work_camp_enabled\s*=\s*false[\s\S]*?linked_worksite_id\s*=\s*0[\s\S]*?commute_efficiency\s*=\s*1\.0/,
  'surviving worksites must have every legacy camp/commute cache normalized',
);
assert.match(villagerRendererSource, /scanFromWatchtower/);
assert.match(villagerRendererSource, /resolveAgentY/);
assert.match(villagerRendererSource, /buildMarketplaceStallDuties/);
assert.match(villagerRendererSource, /marketplaceStallWorkerApproach/);
assert.match(villagerRendererSource, /Minding the \$\{marketStallLabel/);
assert.match(villagerRendererSource, /private tryBeginBackyardWork/);
assert.match(villagerRendererSource, /backyardGardenPhenology\(garden\.kind, month\)/);
assert.match(villagerRendererSource, /agent\.pathPurpose = 'backyard_work'/);
assert.match(villagerRendererSource, /agent\.workActivity = 'gather'/);
assert.match(villagerRendererSource, /Harvesting \$\{backyardGardenLabel/);
assert.match(
  villagerRendererSource,
  /const purpose = forObservance[\s\S]*?'return_for_observance'[\s\S]*?'return_to_work'[\s\S]*?marketStallDutyForAgent\(agent\)[\s\S]*?beginPreparedJourney\(agent, path, purpose\)/,
  'market sellers should visibly follow the authored entrance path to their counter',
);
assert.match(villagerRendererSource, /Keeping watch from the frontier gallery/);
assert.match(villagerRendererSource, /Providing essential Sabbath livestock care/);
assert.match(villagerRendererSource, /Keeping the essential Sabbath watch/);
assert.match(villagerRendererSource, /Maintaining Sabbath guard readiness/);
assert.match(
  villagerRendererSource,
  /essentialSabbathDutyFor\(building\) === 'livestock_care'[\s\S]*?target\.kind === 'pasture'/,
  'observed-Sabbath livestock loops must exclude a swineherd mast-gather target',
);
assert.match(
  villagerRendererSource,
  /essentialSabbathDuty === 'livestock_care'[\s\S]*?agent\.mode === 'gather'[\s\S]*?beginWorkerReturnToWork\(agent\)/,
  'a swineherd already gathering mast must physically return before essential care begins',
);
assert.match(villagerRendererSource, /Cutting wet river clay/);
assert.match(villagerRendererSource, /Sealing and venting the clamp/);
assert.match(villagerRendererSource, /Forging ironwork/);
assert.match(villagerRendererSource, /Shaping and firing vessels/);
assert.match(villagerRendererSource, /Waiting at \$\{workplaceLabel\}/);
assert.match(villagerRendererSource, /workerProductionBlocker\(workplace\)/);
assert.match(
  villagerRendererSource,
  /kind === 'clay_pit'[\s\S]*kind === 'charcoal_burner'[\s\S]*return 'shovel'/,
);
assert.match(villagerRendererSource, /kind === 'carpenter' \|\| kind === 'smithy'/);
assert.match(
  villagerRendererSource,
  /workerSoundSourcePool[\s\S]*farmSongSourcePool[\s\S]*combatAudioFighterPool/,
  'per-frame villager audio sources should use retained record pools',
);
assert.match(
  villagerRendererSource,
  /pickWorkerWalkPlan\([\s\S]*this\.roadNetwork,[\s\S]*this\.isWaterAt,/,
  'runtime worker planning must use the rendered-water sampler for fishing stops',
);
assert.match(
  villagerRendererSource,
  /invalidateNavigation\(\)[\s\S]*fishingRerouteTouchesWater[\s\S]*polylineTouchesWater/,
  'navigation invalidation must not reroute an active fishing loop through water',
);

const pastoralSabbathWorkplace = building(
  'sabbath-pastoral',
  'pastoral_farmstead',
  0,
  0,
  1,
  120,
);
const swineSabbathWorkplace = building('sabbath-swine', 'swineherd', 0, 0, 1, 120);
const watchSabbathWorkplace = building('sabbath-watch', 'watchtower', 0, 0, 1, 120);
const guardSabbathWorkplace = building('sabbath-guard', 'guardhouse', 0, 0, 1, 120);
const ordinarySabbathWorkplace = building('sabbath-smithy', 'smithy', 0, 0, 1, 120);
const sabbathDutyFixture = {
  clock: { isSunday: true },
  sabbathPausedToday: true,
  holidayObservance: null as null | Record<string, unknown>,
  frontierAlertActive: false,
  fireDisabledBuildingIds: new Set<string>(),
};
const essentialSabbathDutyFor = VillagerRenderer.prototype
  .essentialSabbathDutyFor as (
    this: typeof sabbathDutyFixture,
    workplace: BuildingState | null,
  ) => 'livestock_care' | 'watch' | 'guard_readiness' | null;
assert.equal(
  essentialSabbathDutyFor.call(sabbathDutyFixture, pastoralSabbathWorkplace),
  'livestock_care',
);
assert.equal(
  essentialSabbathDutyFor.call(sabbathDutyFixture, swineSabbathWorkplace),
  'livestock_care',
);
assert.equal(
  essentialSabbathDutyFor.call(sabbathDutyFixture, watchSabbathWorkplace),
  'watch',
);
assert.equal(
  essentialSabbathDutyFor.call(sabbathDutyFixture, guardSabbathWorkplace),
  'guard_readiness',
);
assert.equal(
  essentialSabbathDutyFor.call(sabbathDutyFixture, ordinarySabbathWorkplace),
  null,
  'ordinary production workers must observe the Sunday pause',
);
sabbathDutyFixture.frontierAlertActive = true;
assert.equal(
  essentialSabbathDutyFor.call(sabbathDutyFixture, pastoralSabbathWorkplace),
  null,
  'a frontier alert must displace essential livestock care',
);
assert.equal(
  essentialSabbathDutyFor.call(sabbathDutyFixture, watchSabbathWorkplace),
  'watch',
  'the watch must remain staffed during a Sunday frontier alert',
);
sabbathDutyFixture.frontierAlertActive = false;
sabbathDutyFixture.holidayObservance = { id: 'holiday' };
assert.equal(
  essentialSabbathDutyFor.call(sabbathDutyFixture, guardSabbathWorkplace),
  null,
  'named holidays freeze even otherwise essential Sunday duties',
);
sabbathDutyFixture.holidayObservance = null;
sabbathDutyFixture.fireDisabledBuildingIds.add(watchSabbathWorkplace.id);
assert.equal(
  essentialSabbathDutyFor.call(sabbathDutyFixture, watchSabbathWorkplace),
  null,
  'fire-disabled security posts cannot claim an essential duty exception',
);

const loggingAgent = {
  id: 'worker:lumber:0',
  workplaceId: 'lumber',
  pathPurpose: 'worker_work_loop' as string | null,
  workActivity: 'chop',
  mode: 'walk',
  workTarget: { id: 'tree-edge', x: 22, z: -3 },
  x: 14,
  z: -6,
};
const firewoodAgent = {
  id: 'tree-woodcutter',
  workplaceId: 'woodcutters',
  pathPurpose: 'worker_work_loop' as string | null,
  workActivity: 'chop',
  mode: 'walk',
  workTarget: { id: 'tree-firewood', x: 11, z: 12 },
  x: 8,
  z: 9,
};
const loggingCollectorFixture = {
  agents: new Map([
    [loggingAgent.id, loggingAgent],
    ['idle-lumber', {
      id: 'idle-lumber',
      workplaceId: 'lumber',
      pathPurpose: null,
      workActivity: 'chop',
      x: 4,
      z: 5,
    }],
    ['non-chopping-lumber', {
      id: 'non-chopping-lumber',
      workplaceId: 'lumber',
      pathPurpose: 'worker_work_loop',
      workActivity: 'gather',
      x: 6,
      z: 7,
    }],
    [firewoodAgent.id, firewoodAgent],
  ]),
  buildings: new Map([
    ['lumber', { kind: 'lumber_mill' }],
    ['woodcutters', { kind: 'woodcutters_lodge' }],
  ]),
  activeLoggingDisturbances: [] as GameHabitatDisturbanceSource[],
  loggingDisturbancePool: [] as GameHabitatDisturbanceSource[],
};
const collectLoggingDisturbances = VillagerRenderer.prototype.getActiveLoggingDisturbances as (
  this: typeof loggingCollectorFixture,
) => readonly GameHabitatDisturbanceSource[];
const firstLoggingDisturbances = collectLoggingDisturbances.call(loggingCollectorFixture);
assert.deepEqual(
  firstLoggingDisturbances,
  [
    { id: loggingAgent.id, x: loggingAgent.x, z: loggingAgent.z },
    { id: 'tree-woodcutter', x: 8, z: 9 },
  ],
  'both timber and firewood harvesters on live chopping loops should disturb game',
);
const retainedLoggingDisturbance = firstLoggingDisturbances[0];
loggingAgent.x = 18;
loggingAgent.z = -2;
const movedLoggingDisturbances = collectLoggingDisturbances.call(loggingCollectorFixture);
assert.strictEqual(
  movedLoggingDisturbances,
  firstLoggingDisturbances,
  'logging disturbance collection should retain its frame array',
);
assert.strictEqual(
  movedLoggingDisturbances[0],
  retainedLoggingDisturbance,
  'moving logging workers should reuse retained disturbance records',
);
assert.deepEqual(
  movedLoggingDisturbances,
  [
    { id: loggingAgent.id, x: 18, z: -2 },
    { id: firewoodAgent.id, x: firewoodAgent.x, z: firewoodAgent.z },
  ],
  'logging disturbances should follow the worker live until the work loop ends',
);
loggingAgent.mode = 'chop';
assert.deepEqual(
  collectLoggingDisturbances.call(loggingCollectorFixture),
  [
    { id: loggingAgent.id, x: 22, z: -3 },
    { id: firewoodAgent.id, x: firewoodAgent.x, z: firewoodAgent.z },
  ],
  'active chopping should use the tree location when the worker stops just outside a habitat boundary',
);
loggingAgent.pathPurpose = null;
firewoodAgent.pathPurpose = null;
const endedLoggingDisturbances = collectLoggingDisturbances.call(loggingCollectorFixture);
assert.strictEqual(endedLoggingDisturbances, firstLoggingDisturbances);
assert.deepEqual(
  endedLoggingDisturbances,
  [],
  'the disturbance should clear as soon as the lumber worker leaves the work loop',
);
assert.match(
  villagerRendererSource,
  /buildCombatAudioSources\(\s*this\.combatAudioFighters,\s*this\.combatAudioSourceWorkspace/,
  'combat audio pairing should reuse its retained source-building workspace',
);
assert.doesNotMatch(
  villagerRendererSource,
  /renderAgents\.flatMap|\[\.\.\.this\.combatAgentVisuals\.values\(\)\]\.map/,
  'audio presentation must not rebuild mapped and flat-mapped source arrays each frame',
);

for (const [kind, expectedActivity] of Object.entries(YARD_WORK_ACTIVITY)) {
  const workplace = readyYardBuilding(
    building(`yard-${kind}`, kind as BuildingState['kind'], 0, 0, 2, 0),
  );
  const targets = collectWorkerTargets(workplace, targetInputs);
  assert.ok(
    targets.length >= 2 && targets.every((target) => target.kind === 'workstation'),
    `${kind} should expose deterministic outdoor workstations`,
  );
  const activityPlan = Array.from({ length: 32 }, (_, seed) =>
    pickWorkerWalkPlan(workplace, 0, targets, seed)
  ).find((plan) => plan?.activity === expectedActivity);
  assert.ok(
    activityPlan,
    `${kind} workers should perform ${expectedActivity} instead of only circling the yard`,
  );
}

const materialWorkCases = [
  {
    kind: 'clay_pit',
    ready: { clay: 0 },
    blocked: { clay: 180 },
    blocker: 'clay_capacity',
  },
  {
    kind: 'charcoal_burner',
    ready: { firewood: 1, charcoal: 0 },
    blocked: { firewood: 0, charcoal: 0 },
    blocker: 'firewood',
  },
  {
    kind: 'smithy',
    ready: { iron: 1, charcoal: 1, water: 1, ironwork: 0 },
    blocked: { iron: 1, charcoal: 0, water: 1, ironwork: 0 },
    blocker: 'charcoal',
  },
  {
    kind: 'potter_kiln',
    ready: { clay: 1, firewood: 1, water: 1, pottery: 0 },
    blocked: { clay: 0, firewood: 1, water: 1, pottery: 0 },
    blocker: 'clay',
  },
  {
    kind: 'smokehouse',
    ready: { meat: 1, firewood: 1, salt: 1, pottery: 1, preservedFood: 0 },
    blocked: { meat: 1, firewood: 1, salt: 0, pottery: 1, preservedFood: 0 },
    blocker: 'salt',
  },
] as const;

for (const testCase of materialWorkCases) {
  const ready = Object.assign(
    building(`ready-${testCase.kind}`, testCase.kind, 0, 0, 2, 0),
    testCase.ready,
  );
  assert.equal(
    workerProductionBlocker(ready),
    null,
    `${testCase.kind} should visibly work while its exact recipe can advance`,
  );

  const blocked = Object.assign(
    building(`blocked-${testCase.kind}`, testCase.kind, 0, 0, 2, 0),
    testCase.blocked,
  );
  assert.equal(workerProductionBlocker(blocked), testCase.blocker);
  const targets = collectWorkerTargets(blocked, targetInputs);
  for (let seed = 0; seed < 32; seed++) {
    assert.equal(
      pickWorkerWalkPlan(blocked, 0, targets, seed)?.activity,
      null,
      `${testCase.kind} should not play production actions while ${testCase.blocker}`,
    );
  }
}

assert.equal(
  workerProductionBlocker(
    Object.assign(
      building('dry-smithy', 'smithy', 0, 0, 2, 0),
      { iron: 1, charcoal: 1, water: 0 },
    ),
  ),
  'water',
  'visible smiths must stop forging when the quench tub is dry',
);
assert.equal(
  workerProductionBlocker(
    Object.assign(
      building('dry-potter', 'potter_kiln', 0, 0, 2, 0),
      { clay: 1, firewood: 1, water: 0 },
    ),
  ),
  'water',
  'visible potters must stop shaping clay when the puddling pit is dry',
);

assert.equal(
  workerProductionBlocker({
    ...readyYardBuilding(building('full-smithy', 'smithy', 0, 0, 2, 0)),
    processorOutputTargetPercent: 25,
    ironwork: 50,
  }),
  'ironwork_target',
  'a full finished-goods target should stop visible production at the same point as the economy',
);
assert.equal(
  workerProductionBlockerDescription('pottery'),
  'there are no pottery vessels on site',
);

const readinessScaleStartedAt = performance.now();
for (let index = 0; index < 100_000; index++) {
  workerProductionBlocker(
    readyYardBuilding(
      building(
        `readiness-${index}`,
        materialWorkCases[index % materialWorkCases.length]!.kind,
        0,
        0,
        2,
        0,
      ),
    ),
  );
}
const readinessScaleElapsedMs = performance.now() - readinessScaleStartedAt;
assert.ok(
  readinessScaleElapsedMs < 500,
  `100,000 material readiness checks took ${readinessScaleElapsedMs.toFixed(1)} ms`,
);

const constructionSite: BuildingState = {
  ...lumberMill,
  id: 'construction-site',
  constructionComplete: false,
  constructionProgress: 0.5,
};
const constructionTargets = collectWorkerTargets(constructionSite, targetInputs);
for (let seed = 0; seed < 24; seed++) {
  const constructionPlan = pickWorkerWalkPlan(
    constructionSite,
    seed % 4,
    constructionTargets,
    seed,
  );
  assert.equal(
    constructionPlan?.activity,
    'build',
    'builders should always stop to hammer the construction site instead of wandering',
  );
  assert.equal(constructionPlan?.target?.kind, 'construction');
}

for (const [activity, clips] of Object.entries(WORKER_ACTIVITY_CLIPS)) {
  const expectedVariants = activity === 'chop' || activity === 'mine' || activity === 'build'
    ? 4
    : 3;
  assert.equal(
    clips.length,
    expectedVariants,
    `${activity} should expose every generated sound variant`,
  );
  for (const clip of clips) {
    const assetPath = `public${clip.path}`;
    assert.ok(fs.statSync(assetPath).size > 10_000, `${assetPath} should be a real audio asset`);
  }
}
for (const [tool, url] of Object.entries(WORKER_TOOL_URLS)) {
  const assetPath = `public${url}`;
  assert.ok(fs.statSync(assetPath).size > 5_000, `${tool} should use a real CC0 GLB asset`);
}
const closeSoundView = buildCrowdViewState(
  0,
  0,
  WORKER_SOUND_MAX_ZOOM_DISTANCE,
  0,
  0,
);
const reusedSoundView = buildCrowdViewState(12, 18, 90, 4, 7, closeSoundView);
assert.equal(
  reusedSoundView,
  closeSoundView,
  'the hot-loop crowd view builder should update a caller-owned state object in place',
);
assert.deepEqual(
  reusedSoundView,
  {
    centerX: 12,
    centerZ: 18,
    viewRadius: 161.5,
    orbitDistance: 90,
    listenerX: 4,
    listenerZ: 7,
  },
  'reusing the crowd view state must preserve the exact derived presentation values',
);
buildCrowdViewState(0, 0, WORKER_SOUND_MAX_ZOOM_DISTANCE, 0, 0, closeSoundView);
assert.equal(
  workerActivitySoundGain(WORKER_SOUND_FULL_VOLUME_DISTANCE, 0, closeSoundView),
  1,
  'nearby extraction sounds should play at their configured volume',
);
assert.ok(
  workerActivitySoundGain(22, 0, closeSoundView) > 0
    && workerActivitySoundGain(22, 0, closeSoundView) < 1,
  'worker sounds should fade with listener distance',
);
assert.equal(
  workerActivitySoundGain(WORKER_SOUND_CUTOFF_DISTANCE, 0, closeSoundView),
  0,
  'worker sounds should be silent beyond their distance cutoff',
);
assert.equal(
  workerActivitySoundGain(
    0,
    0,
    buildCrowdViewState(0, 0, WORKER_SOUND_MAX_ZOOM_DISTANCE + 0.01),
  ),
  0,
  'worker sounds should be disabled as soon as the camera zooms outside close range',
);

const stableName = villagerDisplayName('residence-a:person:0', 'man');
assert.equal(
  villagerDisplayName('residence-a:person:0', 'man'),
  stableName,
  'a person identity should always resolve to the same name',
);
assert.match(stableName, /^\S+ \S+$/, 'villagers should receive a first and family name');
assert.equal(villagerOccupation('stone_quarry'), 'Miner');
assert.equal(villagerOccupation('lumber_mill', true), 'Builder');
assert.equal(villagerOccupation(null), 'Available labor');

console.log(
  `production worker agent tests passed (20,000 material workplaces: ${materialScaleElapsedMs.toFixed(1)} ms)`,
);

function residence(
  id: string,
  x: number,
  z: number,
  population: number,
): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x,
    z,
    yaw: 0,
    population,
    populationCapacity: population,
    tier: 1,
    settlementTicks: 0,
    needs: {
      firewood: { stock: 0, deficitTicks: 0 },
      water: { stock: 0, deficitTicks: 0 },
      food: { stock: 0, deficitTicks: 0 },
      ale: { stock: 0, deficitTicks: 0 },
      preservedFood: { stock: 0, deficitTicks: 0 },
    },
    abandoned: false,
    householdWealth: 0,
  };
}

function building(
  id: string,
  kind: BuildingState['kind'],
  x: number,
  z: number,
  assignedLabor: number,
  workRadius: number,
): BuildingState {
  return {
    id,
    kind,
    x,
    z,
    workRadius,
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
    gold: 0,
    waterCapacity: 0,
    assignedLabor,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  };
}

function readyYardBuilding(workplace: BuildingState): BuildingState {
  switch (workplace.kind) {
    case 'charcoal_burner':
      return { ...workplace, firewood: 1 };
    case 'smithy':
      return { ...workplace, iron: 1, charcoal: 1, water: 1 };
    case 'potter_kiln':
      return { ...workplace, clay: 1, firewood: 1, water: 1 };
    case 'smokehouse':
      return {
        ...workplace,
        meat: 1,
        firewood: 1,
        salt: 1,
        pottery: 1,
      };
    case 'chandlery':
      return { ...workplace, wax: 1, firewood: 1 };
    default:
      return workplace;
  }
}

function treeEntry(id: string, x: number, z: number): TreeLayoutEntry {
  return {
    id,
    layoutIndex: Number(id.length),
    x,
    z,
    woodYield: 4,
    form: 'broad',
    species: 'beech',
    scale: 1,
  };
}

function treeState(
  treeId: string,
  phase: TreeEntityState['phase'],
): TreeEntityState {
  return {
    treeId,
    layoutIndex: treeId.length,
    phase,
    growthProgress: phase === 'mature' ? 1 : 0,
  };
}

function resourceNode(
  nodeId: string,
  kind: ResourceNodeState['kind'],
  x: number,
  z: number,
  remaining: number,
): ResourceNodeState {
  return {
    nodeId,
    kind,
    resource: 'stone',
    remaining,
    maxYield: 100,
    x,
    z,
  };
}

function foragingNode(
  nodeId: string,
  kind: ForagingNodeState['kind'],
  x: number,
  z: number,
): ForagingNodeState {
  return {
    nodeId,
    kind,
    resource: kind,
    remaining: 40,
    maxYield: 40,
    x,
    z,
  };
}

function farmField(
  id: string,
  farmsteadId: string,
  x: number,
  z: number,
): FarmFieldState {
  return {
    id,
    farmsteadId,
    corners: [
      { x: x - 4, z: z - 4 },
      { x: x + 4, z: z - 4 },
      { x: x + 4, z: z + 4 },
      { x: x - 4, z: z + 4 },
    ],
    area: 64,
    averageSlopeDegrees: 0,
    moisture: 0.7,
    fertility: 0.8,
    crop: 'rye',
    nextCrop: 'oats',
    stage: 'harvesting',
    stageProgress: 0.5,
    priority: 1,
    harvestCount: 0,
    lastYield: 0,
  };
}

function pastureState(
  id: string,
  farmsteadId: string,
  x: number,
  z: number,
): PastureState {
  return {
    id,
    farmsteadId,
    corners: [
      { x: x - 4, z: z - 4 },
      { x: x + 4, z: z - 4 },
      { x: x + 4, z: z + 4 },
      { x: x - 4, z: z + 4 },
    ],
    area: 64,
    averageSlopeDegrees: 0,
    moisture: 0.7,
  };
}

function assertDryPolyline(
  path: ReadonlyArray<{ x: number; z: number }>,
  isWaterAt: (x: number, z: number) => boolean,
  message: string,
): void {
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    const samples = Math.max(1, Math.ceil(distance / 0.2));
    for (let sample = 0; sample <= samples; sample += 1) {
      const t = sample / samples;
      assert.equal(
        isWaterAt(
          start.x + (end.x - start.x) * t,
          start.z + (end.z - start.z) * t,
        ),
        false,
        message,
      );
    }
  }
}
