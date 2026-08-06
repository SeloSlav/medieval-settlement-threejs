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
  commuteEffectiveShiftRatio,
  WORKDAY_SECONDS,
} from '../src/settlement/workerCommute.ts';
import {
  allocateProductionWorkers,
  collectWorkerTargets,
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
import { WORKER_TOOL_URLS } from '../src/settlement/workerTools.ts';
import {
  WATCHTOWER_GALLERY_RAIL_CENTER_Y,
  WATCHTOWER_GALLERY_RAIL_HEIGHT,
  WATCHTOWER_ROOF_CENTER_Y,
  WATCHTOWER_ROOF_HEIGHT,
} from '../src/buildings/watchtowerLayout.ts';
import {
  villagerDisplayName,
  villagerOccupation,
} from '../src/settlement/villagerIdentity.ts';
import { buildCrowdViewState } from '../src/settlement/crowdView.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import {
  hasBuiltInWorkLodging,
  REMOTE_WORK_CAMPFIRE_NAME,
  REMOTE_WORK_CAMP_NAME,
  resolveWorksiteLodging,
  supportsRemoteWorkCamp,
  workLodgingDoorPosition,
  workLodgingFiresidePosition,
} from '../src/buildings/remoteWorkCamp.ts';
import { createRemoteWorkCampMesh } from '../src/buildings/meshes/foundersCampMesh.ts';
import {
  BUILDING_COSTS,
  WORKFORCE_AVERAGE_WALK_SPEED_MPS,
  WORKFORCE_ROAD_SPEED_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import { BUILDING_KIND_TO_MENU_ACTION } from '../src/ui/buildMenuMapping.ts';
import {
  createSelectedAgentRoute,
  SELECTED_AGENT_ROUTE_COLOR,
  updateSelectedAgentRoute,
} from '../src/scene/SelectedAgentRoute.ts';

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

const commuteRoads = new RoadNetwork();
commuteRoads.addRoadPath([
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
  commuteRoads,
);
assert.equal(
  routedRoster.assignments[0]?.homeResidenceId,
  'road-connected-home',
  'road travel time should beat a slightly shorter direct walk when the road pace makes it faster',
);
assert.equal(supportsRemoteWorkCamp('lumber_mill'), true);
assert.equal(supportsRemoteWorkCamp('smithy'), false);
assert.equal(hasBuiltInWorkLodging('hunters_hall'), true);
assert.equal(hasBuiltInWorkLodging('reforester'), true);
assert.equal(hasBuiltInWorkLodging('threshing_barn'), false);
assert.deepEqual(BUILDING_COSTS.remote_work_camp, { timber: 14, stone: 3 });
assert.equal(WORKFORCE_AVERAGE_WALK_SPEED_MPS, 1.225);
assert.equal(WORKFORCE_ROAD_SPEED_MULTIPLIER, 1.25);
assert.equal(commuteEffectiveShiftRatio(0), 1);
assert.ok(Math.abs(commuteEffectiveShiftRatio(WORKDAY_SECONDS * 0.125) - 0.75) < 1e-9);
assert.equal(
  BUILDING_KIND_TO_MENU_ACTION.remote_work_camp,
  undefined,
  'the linked camp must be initiated from a worksite card rather than the global build menu',
);
const hunterLodging = building('lodged-hunters', 'hunters_hall', 12, 8, 2, 55);
assert.equal(
  resolveWorksiteLodging(hunterLodging, [hunterLodging])?.mode,
  'built_in',
  'a hunter hall should canonically lodge its own crew without a second building',
);
const campWorkplace = building('camp-layout-workplace', 'lumber_mill', 40, 20, 1, 60);
const campBuilding = {
  ...building('camp-layout', 'remote_work_camp', 56, 23, 0, 0),
  linkedWorksiteId: campWorkplace.id,
  constructionComplete: true,
};
assert.equal(
  resolveWorksiteLodging(campWorkplace, [campWorkplace, campBuilding])?.lodging.id,
  campBuilding.id,
  'only a completed linked camp should replace the extraction crew commute',
);
assert.equal(
  resolveWorksiteLodging(campWorkplace, [
    campWorkplace,
    { ...campBuilding, constructionComplete: false },
  ]),
  null,
  'a construction site must not provide lodging before builders finish it',
);
assert.equal(
  resolveWorksiteLodging(campWorkplace, [campWorkplace, campBuilding], new Set([campBuilding.id])),
  null,
  'a fire-disabled camp must immediately restore the household commute',
);
const tentDoor = workLodgingDoorPosition(campBuilding, 0, commuteRoads);
const fireside = workLodgingFiresidePosition(campBuilding, 0, commuteRoads);
assert.ok(
  Number.isFinite(tentDoor.x)
    && Number.isFinite(tentDoor.z)
    && Math.hypot(tentDoor.x - campBuilding.x, tentDoor.z - campBuilding.z) > 0.5,
  'remote lodging must expose a stable tent entrance on its own building footprint',
);
assert.ok(
  Math.hypot(fireside.x - tentDoor.x, fireside.z - tentDoor.z) > 0.5,
  'remote workers need a distinct fireside gathering place before bed',
);
const campMesh = createRemoteWorkCampMesh();
assert.equal(campMesh.name, REMOTE_WORK_CAMP_NAME);
assert.equal(
  campMesh.children.filter((child) => child.name === 'Founding canvas tent').length,
  2,
  'an enabled rural camp should render two reusable canvas shelters',
);
assert.ok(
  campMesh.getObjectByName(REMOTE_WORK_CAMPFIRE_NAME) instanceof THREE.Group,
  'an enabled rural camp should render the animated founders-camp fire treatment',
);

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

const quarryCamp = building('building-6', 'stone_quarry', 0, 0, 1, 55);
const quarryTarget = resourceNode('quarry-near', 'quarry', 30, 0, 40);
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
assert.ok(quarryWorkPlan, 'stonecutters should schedule mining stops at quarry targets');
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
    pickWorkerWalkPlan(workplace, 0, targets, seed)
  ).find((plan) => plan?.activity === expectedActivity);
  assert.ok(
    activityPlan,
    `${kind} workers should perform ${expectedActivity} at ${nodeKind} targets`,
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
  'brewery',
  'smokehouse',
  'granary',
  'bakery',
  'apiary',
  'watermill',
  'windmill',
  'carpenter',
  'weaver',
  'watchtower',
  'guardhouse',
  'vineyard',
] as const;
assert.deepEqual(
  PRODUCTION_WORKPLACE_KINDS,
  expectedWorkplaces,
  'every staffed gathering and processing workplace should receive visible agents',
);

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
const buildingReducerSource = fs.readFileSync('server/src/reducers/buildings.rs', 'utf8');
const commuteAuthoritySource = fs.readFileSync(
  'server/src/simulation/workforce_commute.rs',
  'utf8',
);
const generatedBuildingSource = fs.readFileSync('src/generated/building_table.ts', 'utf8');
const lodgingInspectorSource = fs.readFileSync(
  'src/resources/inspector/remoteWorkCampRenderer.ts',
  'utf8',
);
assert.match(buildingReducerSource, /pub fn place_remote_work_camp/);
assert.match(buildingReducerSource, /place_building_internal\(ctx, "remote_work_camp"\.to_string\(\), x, z, worksite_id\)/);
assert.match(buildingReducerSource, /Demolish this worksite's overnight camp first/);
assert.doesNotMatch(buildingReducerSource, /pub fn set_remote_work_camp/);
assert.match(generatedBuildingSource, /commuteEfficiency: __t\.f64\(\)/);
assert.match(commuteAuthoritySource, /seasonal_labor_steward_review_due/);
assert.match(commuteAuthoritySource, /road_path_distances_from/);
assert.match(commuteAuthoritySource, /worksite_has_active_remote_camp/);
assert.match(lodgingInspectorSource, /Authoritative output labor/);
assert.match(lodgingInspectorSource, /restoring the worksite\\'s full productive shift/);
assert.doesNotMatch(lodgingInspectorSource, /Â/, 'inspector copy must not contain mojibake');
assert.match(villagerRendererSource, /scanFromWatchtower/);
assert.match(villagerRendererSource, /resolveAgentY/);
assert.match(villagerRendererSource, /Keeping watch from the frontier gallery/);
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
    ready: { food: 1, firewood: 1, salt: 1, pottery: 1, preservedFood: 0 },
    blocked: { food: 1, firewood: 1, salt: 0, pottery: 1, preservedFood: 0 },
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
    ironwork: 18,
  }),
  'ironwork_target',
  'a configured finished-goods target should stop visible production at the same point as the economy',
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
    shadowRadius: 80,
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
assert.equal(villagerOccupation('stone_quarry'), 'Stonecutter');
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
        food: 1,
        firewood: 1,
        salt: 1,
        pottery: 1,
      };
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
