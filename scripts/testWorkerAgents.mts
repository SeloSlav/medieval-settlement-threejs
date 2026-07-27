import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  pickWorkerWalkPath,
  pickWorkerWalkPlan,
  PRODUCTION_WORKPLACE_KINDS,
  WATCHTOWER_GALLERY_FLOOR_HEIGHT,
  watchtowerDutyPosition,
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

const residenceA = residence('residence-a', 0, 0, 3);
const residenceB = residence('residence-b', 100, 0, 2);
const lumberMill = building('building-1', 'lumber_mill', 10, 0, 2, 60);
const stoneCamp = building('building-2', 'stone_quarry', 92, 0, 2, 55);
const serviceWell = building('building-3', 'well', 50, 0, 2, 90);

const roster = allocateProductionWorkers(
  [residenceA, residenceB],
  [serviceWell, stoneCamp, lumberMill],
);
assert.equal(roster.assignments.length, 6, 'resource and processing labor becomes workplace agents');
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
  'nearby housed residents should be claimed before one starting-population fallback',
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
  'apiary',
  'watermill',
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
  [],
  Array.from({ length: 600 }, (_, index) =>
    building(`bounded-watch-${index}`, 'watchtower', index * 8, 0, 2, 190)
  ),
);
assert.equal(
  boundedWatchRoster.assignments.length,
  1024,
  'visible tower posts must respect the existing settlement crowd budget',
);
const villagerRendererSource = fs.readFileSync('src/settlement/VillagerRenderer.ts', 'utf8');
assert.match(villagerRendererSource, /scanFromWatchtower/);
assert.match(villagerRendererSource, /resolveAgentY/);
assert.match(villagerRendererSource, /Keeping watch from the frontier gallery/);

for (const [kind, expectedActivity] of Object.entries(YARD_WORK_ACTIVITY)) {
  const workplace = building(`yard-${kind}`, kind as BuildingState['kind'], 0, 0, 2, 0);
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
  assert.equal(clips.length, 4, `${activity} should have four randomized sound variants`);
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

console.log('production worker agent tests passed');

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
