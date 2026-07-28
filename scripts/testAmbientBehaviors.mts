import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { BuildingState, ResidenceState } from '../src/resources/types.ts';
import {
  assignAmbientBehaviorSlots,
  type AmbientBehaviorAssignment,
  type AmbientBehaviorSlot,
} from '../src/settlement/ambientBehaviors.ts';
import {
  FOUNDERS_CAMP_BENCH_SEAT,
  FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT,
  FOUNDERS_CAMP_SEAT_LANDMARKS,
  FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT,
} from '../src/buildings/foundersCampLandmarks.ts';
import { buildingPlacementYaw } from '../src/buildings/buildingPlacement.ts';
import { createFoundersCampMesh } from '../src/buildings/meshes/foundersCampMesh.ts';
import {
  FOUNDERS_CAMP_AMBIENT_CYCLE_SECONDS,
  planFoundersCampAmbientBehaviors,
} from '../src/settlement/foundersCampBehaviors.ts';
import { planChapelGatheringBehaviors } from '../src/settlement/chapelGatheringBehaviors.ts';
import {
  claimMassChapelForResidence,
  operationalMassChapels,
} from '../src/settlement/chapelMass.ts';
import { VillagerRenderer } from '../src/settlement/VillagerRenderer.ts';
import {
  seatedVillagerContactHeight,
  type VillagerModelVariant,
} from '../src/settlement/SettlementCrowdRenderer.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';

const reusableSlots: AmbientBehaviorSlot[] = [
  {
    id: 'seat',
    kind: 'sit',
    destination: { x: 1, z: 2 },
  },
  {
    id: 'chat',
    kind: 'talk',
    destination: { x: 3, z: 4 },
  },
];
const firstCycle = assignAmbientBehaviorSlots(
  ['actor-a', 'actor-b'],
  reusableSlots,
  0,
);
const secondCycle = assignAmbientBehaviorSlots(
  ['actor-a', 'actor-b'],
  reusableSlots,
  1,
);
assert.equal(firstCycle.get('actor-a')?.kind, 'sit');
assert.equal(secondCycle.get('actor-a')?.kind, 'talk');
assert.notEqual(
  firstCycle.get('actor-a')?.destination,
  reusableSlots[0]?.destination,
  'shared behavior assignments should clone mutable world-space anchors',
);

const camp = foundersCamp();
const campYaw = buildingPlacementYaw('founders_camp', camp.x, camp.z, null);
const campWorld = (point: { x: number; z: number }) => ({
  x: camp.x + Math.cos(campYaw) * point.x + Math.sin(campYaw) * point.z,
  z: camp.z - Math.sin(campYaw) * point.x + Math.cos(campYaw) * point.z,
});
const actorIds = Array.from({ length: 5 }, (_, index) => `founder-camp:${index}`);
const campPlan = planFoundersCampAmbientBehaviors(camp, actorIds, 0);
assert.deepEqual(
  [...campPlan.values()].map((assignment) => assignment.kind).sort(),
  ['rest', 'sit', 'talk', 'talk', 'wander'],
  'a full founding crowd should visibly talk, sit, rest, and move at once',
);
const plannedSeats = [...campPlan.values()].filter(
  (assignment) => assignment.kind === 'sit' || assignment.kind === 'rest',
);
assert.equal(
  plannedSeats.length,
  FOUNDERS_CAMP_SEAT_LANDMARKS.length,
  'the camp must not plan more seated people than it has physical seats',
);
assert.equal(
  new Set(plannedSeats.map((assignment) => assignment.seatId)).size,
  plannedSeats.length,
  'each seated founder must reserve a distinct physical seat',
);
for (const assignment of plannedSeats) {
  const landmark = FOUNDERS_CAMP_SEAT_LANDMARKS.find(
    (seat) => seat.id === assignment.seatId,
  );
  assert.ok(landmark, 'every sitting/resting assignment must name a real camp seat');
  assert.deepEqual(assignment.destination, campWorld(landmark.destination));
  assert.equal(
    assignment.seatSurfaceHeight,
    landmark.surfaceHeight,
    'the character pose must receive the physical support surface height',
  );
}
const crowdedPlan = planFoundersCampAmbientBehaviors(
  camp,
  Array.from({ length: 10 }, (_, index) => `crowded-founder:${index}`),
  0,
);
assert.equal(
  [...crowdedPlan.values()].filter(
    (assignment) => assignment.kind === 'sit' || assignment.kind === 'rest',
  ).length,
  FOUNDERS_CAMP_SEAT_LANDMARKS.length,
  'additional founders must remain in standing activities once every seat is claimed',
);
const conversation = [...campPlan.values()].filter(
  (assignment) => assignment.kind === 'talk',
);
assert.equal(conversation.length, 2);
assert.deepEqual(conversation[0]?.lookAt, conversation[1]?.destination);
assert.deepEqual(conversation[1]?.lookAt, conversation[0]?.destination);
assert.deepEqual(
  [...planFoundersCampAmbientBehaviors(camp, actorIds.slice(0, 2), 0).values()]
    .map((assignment) => assignment.kind),
  ['talk', 'talk'],
  'the final two unhoused founders should keep one another company',
);

const campMesh = createFoundersCampMesh();
const benchMesh = campMesh.getObjectByName('Camp bench seat');
const stumpMesh = campMesh.getObjectByName('Camp fireside stump seat');
const stumpTopMesh = campMesh.getObjectByName('Camp fireside stump seat top');
assert.ok(benchMesh, 'the planned bench seat must have visible supporting geometry');
assert.ok(stumpMesh, 'the fireside rest pose must have a visible stump beneath it');
assert.ok(stumpTopMesh, 'the fireside stump must expose a visible sitting surface');
assert.deepEqual(
  { x: benchMesh.position.x, z: benchMesh.position.z },
  FOUNDERS_CAMP_BENCH_SEAT.supportPosition,
);
assert.deepEqual(
  { x: stumpMesh.position.x, z: stumpMesh.position.z },
  FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT.supportPosition,
);
const benchGeometry = (benchMesh as THREE.Mesh).geometry as THREE.BoxGeometry;
const stumpTopGeometry = (stumpTopMesh as THREE.Mesh).geometry as THREE.CylinderGeometry;
assert.ok(
  Math.abs(
    benchMesh.position.y
      + benchGeometry.parameters.height / 2
      - FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT,
  ) < 1e-9,
  'the camp bench top must match the shared sitting surface',
);
assert.ok(
  Math.abs(
    stumpTopMesh.position.y
      + stumpTopGeometry.parameters.height / 2
      - FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT,
  ) < 1e-9,
  'the fireside log top must match the shared sitting surface',
);
campMesh.position.set(camp.x, 0, camp.z);
campMesh.rotation.y = campYaw;
campMesh.updateMatrixWorld(true);
const benchSupportWorld = benchMesh.getWorldPosition(new THREE.Vector3());
const expectedBenchSupportWorld = campWorld(FOUNDERS_CAMP_BENCH_SEAT.supportPosition);
assert.ok(
  Math.hypot(
    benchSupportWorld.x - expectedBenchSupportWorld.x,
    benchSupportWorld.z - expectedBenchSupportWorld.z,
  ) < 1e-9,
  'behavior landmarks and the rotated camp mesh must share one world transform',
);

const chapel = chapelBuilding('chapel-connected', 45, 0);
const churchyardPlan = planChapelGatheringBehaviors(
  chapel,
  ['parishioner-a', 'parishioner-b', 'parishioner-c'],
  0,
);
assert.deepEqual(
  [...churchyardPlan.values()].map((assignment) => assignment.kind).sort(),
  ['talk', 'talk', 'wander'],
  'the exterior chapel abstraction should mingle and circulate without seating',
);
assert.ok(
  [...churchyardPlan.values()].every(
    (assignment) => assignment.kind !== 'sit' && assignment.kind !== 'rest',
  ),
);

const parishRoads = new RoadNetwork();
parishRoads.addRoadPath([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(50, 0, 0),
]);
parishRoads.addRoadPath([
  new THREE.Vector3(0, 0, 25),
  new THREE.Vector3(10, 0, 25),
]);
const home = residence('parish-home', 0, 0);
const closerButDisconnected = chapelBuilding('chapel-disconnected', 0, 25);
const operational = operationalMassChapels([closerButDisconnected, chapel]);
assert.equal(
  claimMassChapelForResidence(home, operational, parishRoads)?.chapel.id,
  chapel.id,
  'mass attendance should choose the nearest road-reachable chapel, not straight-line distance',
);
assert.equal(
  claimMassChapelForResidence(home, operational, new RoadNetwork()),
  null,
  'a residence without a chapel road route should not receive a parish or attend mass',
);

const originalWarn = console.warn;
console.warn = () => {};
const villagers = new VillagerRenderer({
  parent: new THREE.Group(),
  getGameSpeed: () => 1,
  getHeightAt: () => 0,
});
villagers.sync({
  residences: [],
  buildings: [camp],
  quarries: [],
  foragingNodes: [],
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
  roadNetwork: null,
});

type TestAgent = {
  id: string;
  personIdentity: string;
  mode: string;
  ambientBehavior: string | null;
  appearanceSeed: number;
  modelVariant: VillagerModelVariant;
  x: number;
  y: number;
  z: number;
  yaw: number;
};
const agents = (
  villagers as unknown as { agents: Map<string, TestAgent> }
).agents;
type PendingSeat = {
  assignment: AmbientBehaviorAssignment;
  previousOccupantId: string;
};
const campAmbientState = villagers as unknown as {
  campAmbientAssignments: Map<string, AmbientBehaviorAssignment>;
  pendingCampSeatAssignments: Map<string, PendingSeat>;
  campAmbientElapsedSeconds: number;
};
assert.equal(agents.size, 5);
assert.ok(
  [...agents.values()].every((agent) => agent.mode === 'walk'),
  'founders should set off toward their ambient activities immediately',
);

for (let step = 0; step < 240; step += 1) villagers.tick(0.05);
const settledModes = new Set([...agents.values()].map((agent) => agent.mode));
for (const mode of ['sit', 'rest', 'talk']) {
  assert.ok(settledModes.has(mode), `the live crowd should reach its ${mode} pose`);
}
assert.equal(
  [...agents.values()].filter(
    (agent) => agent.mode === 'sit' || agent.mode === 'rest',
  ).length,
  FOUNDERS_CAMP_SEAT_LANDMARKS.length,
  'only the founders with physical seats should enter a seated animation',
);
for (const agent of agents.values()) {
  if (agent.mode !== 'sit' && agent.mode !== 'rest') continue;
  const assignment = campAmbientState.campAmbientAssignments.get(agent.id);
  assert.ok(assignment?.seatSurfaceHeight !== undefined);
  const contactHeight = agent.y
    + seatedVillagerContactHeight(agent.modelVariant, agent.appearanceSeed);
  assert.ok(
    Math.abs(contactHeight - FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT) < 1e-6,
    `${agent.modelVariant} seated body must contact the physical support top`,
  );
}
const liveTalkers = [...agents.values()].filter(
  (agent) => agent.ambientBehavior === 'talk',
);
assert.equal(liveTalkers.length, 2);
const talkerDirection = Math.atan2(
  liveTalkers[1]!.x - liveTalkers[0]!.x,
  liveTalkers[1]!.z - liveTalkers[0]!.z,
);
assert.ok(
  Math.abs(shortestAngle(liveTalkers[0]!.yaw, talkerDirection)) < 0.01,
  'conversation partners should face one another',
);
assert.match(
  villagers.inspectVillager(liveTalkers[0]!.personIdentity)?.activity ?? '',
  /Talking with another founder/,
);
const firesideSitter = [...agents.values()].find(
  (agent) => agent.ambientBehavior === 'rest',
);
assert.match(
  villagers.inspectVillager(firesideSitter!.personIdentity)?.activity ?? '',
  /Sitting on a stump/,
);

const benchSeatId = FOUNDERS_CAMP_BENCH_SEAT.id;
const firstBenchOccupant = [...campAmbientState.campAmbientAssignments].find(
  ([, assignment]) => assignment.seatId === benchSeatId,
)?.[0];
assert.ok(firstBenchOccupant);
const secondsUntilCycle =
  FOUNDERS_CAMP_AMBIENT_CYCLE_SECONDS - campAmbientState.campAmbientElapsedSeconds;
villagers.tick(Math.max(0, secondsUntilCycle - 0.05));
villagers.tick(0.1);

const pendingBenchEntry = [...campAmbientState.pendingCampSeatAssignments].find(
  ([, pending]) => pending.assignment.seatId === benchSeatId,
);
assert.ok(
  pendingBenchEntry,
  'the next bench user should wait while its previous occupant is still beside it',
);
const [waitingActorId, pendingBench] = pendingBenchEntry;
assert.equal(pendingBench.previousOccupantId, firstBenchOccupant);
assert.equal(
  campAmbientState.campAmbientAssignments.get(waitingActorId)?.kind,
  'idle',
  'a founder waiting for an occupied seat must remain in a standing activity',
);
assert.equal(
  campAmbientState.campAmbientAssignments.get(waitingActorId)?.seatId,
  undefined,
  'a waiting founder must not claim the occupied seat early',
);
assert.notEqual(
  agents.get(waitingActorId)?.mode,
  'sit',
  'the replacement must not begin sitting during the seat handoff',
);
assert.equal(
  agents.get(firstBenchOccupant)?.mode,
  'walk',
  'the previous occupant must stand and start moving away before replacement',
);

for (
  let step = 0;
  step < 100 && campAmbientState.pendingCampSeatAssignments.has(waitingActorId);
  step += 1
) {
  villagers.tick(0.05);
}
assert.equal(
  campAmbientState.pendingCampSeatAssignments.has(waitingActorId),
  false,
  'the seat should become available after its previous occupant clears it',
);
assert.equal(
  campAmbientState.campAmbientAssignments.get(waitingActorId)?.seatId,
  benchSeatId,
);
assert.notEqual(
  waitingActorId,
  firstBenchOccupant,
  'activity cycles should rotate people through the physical camp seats',
);
const priorBenchAgent = agents.get(firstBenchOccupant)!;
assert.ok(
  Math.hypot(
    priorBenchAgent.x - campWorld(FOUNDERS_CAMP_BENCH_SEAT.destination).x,
    priorBenchAgent.z - campWorld(FOUNDERS_CAMP_BENCH_SEAT.destination).z,
  ) >= 0.8,
  'a reserved seat must not be handed off until its old occupant has moved away',
);

villagers.dispose();
await new Promise((resolve) => setTimeout(resolve, 0));
console.warn = originalWarn;

console.log('ambient villager behavior tests passed');

function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(from - to), Math.cos(from - to));
}

function foundersCamp(): BuildingState {
  return {
    id: 'founding-camp',
    kind: 'founders_camp',
    x: 20,
    z: -8,
    workRadius: 0,
    actionCooldown: 0,
    timber: 100,
    firewood: 20,
    stone: 50,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    gold: 100,
    waterCapacity: 0,
    assignedLabor: 0,
    constructionComplete: true,
    foundingShelterActive: true,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  };
}

function chapelBuilding(id: string, x: number, z: number): BuildingState {
  return {
    ...foundersCamp(),
    id,
    kind: 'chapel',
    x,
    z,
    foundingShelterActive: false,
    assignedLabor: 1,
  };
}

function residence(id: string, x: number, z: number): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x,
    z,
    yaw: 0,
    population: 4,
    populationCapacity: 6,
    tier: 1,
    settlementTicks: 0,
    needs: {
      firewood: { stock: 1, deficitTicks: 0 },
      water: { stock: 1, deficitTicks: 0 },
      food: { stock: 1, deficitTicks: 0 },
      ale: { stock: 0, deficitTicks: 0 },
      preservedFood: { stock: 0, deficitTicks: 0 },
    },
    abandoned: false,
    householdWealth: 8,
  };
}
