import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { BuildingState, ResidenceState } from '../src/resources/types.ts';
import { ResidenceMarkers } from '../src/residences/ResidenceMarkers.ts';
import {
  householdMemberHomeState,
  householdMemberRoutine,
  residenceWindowActivity,
} from '../src/residences/householdRoutine.ts';
import {
  pickWorkerTravelPath,
  WATCHTOWER_MUSTER_RANK_WIDTH,
  watchtowerMusterPosition,
} from '../src/settlement/workerPaths.ts';
import { VillagerRenderer } from '../src/settlement/VillagerRenderer.ts';
import {
  PALISADED_REFUGE_RALLY_SLOT_COUNT,
  palisadedRefugeGateInside,
  palisadedRefugeGateOutside,
  palisadedRefugeRallyPosition,
} from '../src/settlement/palisadedRefugeRally.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import {
  PEDESTRIAN_ROAD_SPEED_MULTIPLIER,
  surfaceAdjustedTravelSpeed,
} from '../src/roads/roadTravel.ts';
import { computeDayNightState } from '../src/world/dayNightPresentation.ts';
import type { GameClock } from '../src/world/gameCalendar.ts';
import { holidayObservanceForClock } from '../src/world/holidayCalendar.ts';
import type { GameSpeed } from '../src/world/gameSpeed.ts';
import { SIM_REALTIME_RATE } from '../src/generated/gameBalance.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import {
  DEFAULT_NIGHT_POLICY,
  formatDawnReport,
  isNightWorkBuilding,
  nightLightingVisualScale,
} from '../src/economy/nightPolicy.ts';

const identities = Array.from(
  { length: 12 },
  (_, index) => `residence-routine:person:${index}`,
);
const routines = identities.map((identity) => householdMemberRoutine(identity));

const quietAtNine = identities.filter(
  (identity) => householdMemberHomeState(
    identity,
    clockFromHour(21),
    { gathering: 0, curfew: 2 },
  ) === 'home_outdoors',
).length;
const livelyAtNine = identities.filter(
  (identity) => householdMemberHomeState(
    identity,
    clockFromHour(21),
    { gathering: 2, curfew: 0 },
  ) === 'home_outdoors',
).length;
assert.ok(livelyAtNine > quietAtNine, 'open-late evenings should visibly outlast a general curfew');
assert.ok(nightLightingVisualScale(2) > nightLightingVisualScale(0));
assert.equal(isNightWorkBuilding('charcoal_burner', 1), true);
assert.equal(isNightWorkBuilding('smithy', 1), false);
assert.equal(isNightWorkBuilding('smithy', 2), true);
assert.match(
  formatDawnReport({
    ...DEFAULT_NIGHT_POLICY,
    lastReportDay: 2,
    lastHouseholds: 4,
    lastWellRestedHouseholds: 3,
    lastSocialHouseholds: 2,
    lastWorkers: 1,
    lastLightingFuelUsed: 0.1,
  }),
  /3\/4 households well rested.*2 social.*1 night workers/,
);

assert.ok(
  new Set(routines.map((routine) => routine.bedtimeHour.toFixed(2))).size >= 8,
  'household members should not all share one bedtime',
);
assert.ok(
  new Set(routines.map((routine) => routine.wakeHour.toFixed(2))).size >= 8,
  'household members should not all wake at the same time',
);

for (let index = 0; index < identities.length; index++) {
  const identity = identities[index];
  const routine = routines[index];
  assert.equal(
    householdMemberHomeState(identity, clockFromHour(routine.indoorsHour - 0.02)),
    'home_outdoors',
  );
  assert.equal(
    householdMemberHomeState(identity, clockFromHour(routine.indoorsHour + 0.02)),
    'indoors',
  );
  assert.equal(
    householdMemberHomeState(identity, clockFromHour(routine.bedtimeHour + 0.02)),
    'asleep',
  );
  assert.equal(
    householdMemberHomeState(identity, clockFromHour(routine.wakeHour + 0.02)),
    'indoors',
  );
}

assert.ok(
  residenceWindowActivity('residence-lit', 6, clockFromHour(21)) > 0,
  'occupied homes should show lamps after household members come inside',
);
assert.equal(
  residenceWindowActivity('residence-lit', 6, clockFromHour(2)),
  0,
  'homes should go dark after every household member is asleep',
);
assert.equal(
  residenceWindowActivity('residence-lit', 6, clockFromHour(12)),
  0,
  'household lamps should be off during daytime outdoor activity',
);

const lateEvening = computeDayNightState(fullClock(22), true);
assert.equal(lateEvening.smokeAllowed, false);
assert.ok(
  lateEvening.eveningWindowGlow > 0.8,
  'the darkness envelope should allow awake households to remain lit at night',
);
const deepNight = computeDayNightState(fullClock(2), true);
assert.ok(deepNight.eveningWindowGlow > 0.8);
assert.equal(
  deepNight.eveningWindowGlow
    * residenceWindowActivity('residence-lit', 6, clockFromHour(2)),
  0,
  'sleep schedules, rather than the global darkness envelope, should turn homes off',
);

assert.deepEqual(
  pickWorkerTravelPath({ x: 2, z: 3 }, { x: 12, z: -4 }, null),
  [{ x: 2, z: 3 }, { x: 12, z: -4 }],
  'workers should still walk home directly when no road route is available',
);

const shortTripNetwork = new RoadNetwork();
shortTripNetwork.addRoadPath([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(20, 0, 0),
]);
const shortRoadTrip = pickWorkerTravelPath(
  { x: 1, z: 3 },
  { x: 2, z: 3 },
  shortTripNetwork,
);
assert.ok(
  shortRoadTrip?.some((point) => Math.abs(point.z) < 1e-6),
  'even a short same-node work journey should attach to the road instead of cutting cross-country',
);
assert.equal(
  surfaceAdjustedTravelSpeed(1.2, true, PEDESTRIAN_ROAD_SPEED_MULTIPLIER),
  1.5,
  'pedestrians should move 25% faster while their feet are on a road or bridge',
);

const originalWarn = console.warn;
console.warn = () => {};
let gameSpeed: GameSpeed = 1;
const villagers = new VillagerRenderer({
  parent: new THREE.Group(),
  getGameSpeed: () => gameSpeed,
  getHeightAt: () => 0,
});
const home = {
  ...residence('routine-home', 0, 0),
  population: 2,
  populationCapacity: 2,
};
const workplace = building('routine-workplace', 12, 0);
const chapel = {
  ...building('routine-chapel', 28, 0),
  kind: 'chapel' as const,
};
const monastery = {
  ...building('routine-monastery', 34, 0),
  kind: 'monastery' as const,
  assignedLabor: 0,
};
const refuge = {
  ...building('routine-refuge', 40, 0),
  kind: 'palisaded_refuge' as const,
  assignedLabor: 0,
  workRadius: 68,
};
const rallyPositions = Array.from(
  { length: PALISADED_REFUGE_RALLY_SLOT_COUNT },
  (_, slot) => palisadedRefugeRallyPosition(refuge, slot),
);
assert.equal(
  new Set(rallyPositions.map((position) => `${position.x}:${position.z}`)).size,
  32,
  'every resident place in the compact refuge must remain visually distinct',
);
assert.ok(
  rallyPositions.every(
    (position) =>
      Math.abs(position.x - refuge.x) <= 4.3
      && Math.abs(position.z - refuge.z) <= 3,
  ),
  'rally places must stay inside the authored palisade',
);
assert.ok(palisadedRefugeGateOutside(refuge).z > palisadedRefugeGateInside(refuge).z);
const parishRoads = new RoadNetwork();
parishRoads.addRoadPath([
  new THREE.Vector3(-5, 0, 0),
  new THREE.Vector3(35, 0, 0),
]);
const syncRoutineVillage = (
  fireIncidents: readonly FireIncidentState[] = [],
): void => {
  villagers.sync({
    residences: [home],
    buildings: [workplace, chapel, monastery, refuge],
    quarries: [],
    foragingNodes: [],
    trees: new Map(),
    treeRegistry: null,
    farmFields: [],
    pastures: [],
    fireIncidents,
    roadNetwork: parishRoads,
  });
};
syncRoutineVillage();
villagers.setSchedule(fullClock(12), false);

const villagerInternals = (
  villagers as unknown as {
    agents: Map<string, {
      personIdentity: string;
      routinePhase: string;
      pathPurpose: string | null;
      pathDistance: number;
      simPathCursor: number;
      ambientBehavior: string | null;
      mode: string;
      refugeId: string | null;
      x: number;
      z: number;
    }>;
    workerTargets: Map<string, unknown[]>;
    workerToolFor: (agent: unknown) => string | null;
  }
);
const agents = villagerInternals.agents;
const worker = agents.get('worker:routine-workplace:0');
assert.ok(worker);
assert.equal(worker.routinePhase, 'work');
assert.equal(villagerInternals.workerToolFor(worker), 'hatchet');
const standingWorkerRoute = villagers.inspectVillager(worker.personIdentity)?.route ?? [];
assert.ok(
  standingWorkerRoute.length >= 2,
  'clicking a stationary assigned worker should still reveal their planned work route',
);

const resident = agents.get('resident:routine-home:0');
assert.ok(resident, 'one unassigned household member should remain visible at home');

syncRoutineVillage([fireIncident('workplace-fire', 'building', workplace.id, workplace.x, workplace.z)]);
assert.equal(
  worker.routinePhase,
  'returning_home',
  'a fire-disabled workplace must immediately release its visible crew toward home',
);
assert.equal(worker.pathPurpose, 'return_home');
assert.equal(
  villagerInternals.workerTargets.has(workplace.id),
  false,
  'a fire-disabled workplace should not retain natural-resource or yard work targets',
);
assert.equal(
  villagerInternals.workerToolFor(worker),
  null,
  'evacuating workers must put away production tools',
);
const fireDisplacedInspection = villagers.inspectVillager(worker.personIdentity);
assert.ok(
  (fireDisplacedInspection?.route.length ?? 0) >= 2,
  'clicking a traveling worker should reveal the remaining active route',
);
assert.ok(
  Math.hypot(
    (fireDisplacedInspection?.route[0]?.x ?? Infinity) - worker.x,
    (fireDisplacedInspection?.route[0]?.z ?? Infinity) - worker.z,
  ) < 1e-4,
  'the selected route should begin at the worker visible position',
);
assert.equal(fireDisplacedInspection?.eyebrow, 'Worker · Fire-displaced');
assert.match(
  fireDisplacedInspection?.activity ?? '',
  /Evacuating from the fire at Lumber mill/,
);
for (let step = 0; step < realtimeTickBudget(600); step++) villagers.tick(0.05);
assert.notEqual(
  worker.routinePhase,
  'work',
  'assigned workers must remain away while their workplace is fire-disabled',
);

syncRoutineVillage();
assert.equal(
  worker.routinePhase,
  'commuting_to_work',
  'the same rostered person should physically return when the fire outage clears',
);
assert.equal(worker.pathPurpose, 'commute_to_work');
for (let step = 0; step < realtimeTickBudget(600); step++) villagers.tick(0.05);
assert.equal(worker.routinePhase, 'work');
assert.equal(villagerInternals.workerToolFor(worker), 'hatchet');

syncRoutineVillage([fireIncident('home-fire', 'residence', home.id, home.x, home.z)]);
assert.equal(
  worker.routinePhase,
  'work',
  'a safely working household member should not falsely stop authoritative production',
);
assert.equal(
  resident.routinePhase,
  'going_to_fire_assembly',
  'an at-home resident must physically leave a fire-disabled house',
);
const displacedResidentInspection = villagers.inspectVillager(resident.personIdentity);
assert.equal(displacedResidentInspection?.eyebrow, 'Villager · Fire-displaced');
assert.match(displacedResidentInspection?.activity ?? '', /Evacuating from a household fire/);
for (let step = 0; step < realtimeTickBudget(600); step++) villagers.tick(0.05);
assert.equal(resident.routinePhase, 'at_fire_assembly');
assert.ok(
  Math.hypot(resident.x - home.x, resident.z - home.z) > 6,
  'fire-displaced residents must wait beyond the house footprint instead of inside the flames',
);

syncRoutineVillage();
assert.equal(resident.routinePhase, 'returning_from_fire_assembly');
for (let step = 0; step < realtimeTickBudget(600); step++) villagers.tick(0.05);
assert.notEqual(resident.routinePhase, 'at_fire_assembly');
assert.equal(worker.routinePhase, 'work');

villagers.setSchedule({
  ...fullClock(20),
  weekday: 0,
  isSunday: true,
}, true, DEFAULT_NIGHT_POLICY, true, true);
assert.equal(worker.routinePhase, 'returning_home');
assert.equal(worker.pathPurpose, 'return_home');
const pausedCursor = worker.simPathCursor;
gameSpeed = 0;
villagers.tick(1);
assert.equal(
  worker.simPathCursor,
  pausedCursor,
  'paused game time should freeze villager travel',
);
gameSpeed = 1;
villagers.tick(0.2);
const scenicDistance = worker.simPathCursor - pausedCursor;
gameSpeed = 4;
villagers.tick(0.2);
const normalDistance = worker.simPathCursor - pausedCursor - scenicDistance;
assert.ok(
  normalDistance > scenicDistance * 3,
  '4× speed should advance villagers about four times farther than 1× speed',
);
gameSpeed = 1;
for (let step = 0; step < realtimeTickBudget(600); step++) villagers.tick(0.05);
assert.equal(worker.routinePhase, 'home_outdoors');
assert.equal(worker.pathPurpose, null);

villagers.setSchedule({
  ...fullClock(23.8),
  weekday: 0,
  isSunday: true,
}, true, DEFAULT_NIGHT_POLICY, true, true);
assert.equal(worker.routinePhase, 'asleep');
villagers.setSchedule({
  ...fullClock(1),
  totalDays: 1,
}, false);
assert.equal(worker.routinePhase, 'commuting_to_work');
assert.equal(worker.pathPurpose, 'commute_to_work');
for (let step = 0; step < realtimeTickBudget(600); step++) villagers.tick(0.05);
assert.equal(worker.routinePhase, 'work');
assert.notEqual(worker.pathPurpose, 'commute_to_work');

villagers.setSchedule({
  ...fullClock(9),
  weekday: 0,
  isSunday: true,
}, false);
assert.equal(worker.routinePhase, 'going_to_mass');
assert.equal(worker.pathPurpose, 'chapel_mass');
for (let step = 0; step < realtimeTickBudget(1200); step++) villagers.tick(0.05);
assert.equal(worker.routinePhase, 'at_mass');
assert.ok(
  worker.ambientBehavior === 'talk' || worker.ambientBehavior === 'wander',
  'arrived parishioners should mingle or circulate outside the chapel',
);
assert.notEqual(worker.ambientBehavior, 'sit');
assert.notEqual(worker.ambientBehavior, 'rest');

villagers.setSchedule({
  ...fullClock(12),
  weekday: 0,
  isSunday: true,
}, false);
assert.equal(worker.routinePhase, 'returning_from_mass');
assert.equal(worker.pathPurpose, 'return_from_mass');
for (let step = 0; step < realtimeTickBudget(1200); step++) villagers.tick(0.05);
assert.equal(worker.routinePhase, 'work');
assert.notEqual(worker.pathPurpose, 'return_from_mass');

const jurjevoClock = {
  ...fullClock(12),
  month: 4,
  monthDay: 23,
  year: 1,
};
const jurjevo = holidayObservanceForClock(jurjevoClock);
assert.ok(jurjevo);
villagers.setSchedule(
  jurjevoClock,
  true,
  DEFAULT_NIGHT_POLICY,
  true,
  false,
  jurjevo,
);
assert.equal(worker.routinePhase, 'returning_home');
assert.equal(worker.pathPurpose, 'return_home');
for (let step = 0; step < realtimeTickBudget(1200); step++) villagers.tick(0.05);
assert.equal(worker.routinePhase, 'home_outdoors');
assert.ok(
  worker.z < home.z - 3.5,
  'an off-duty holiday worker should settle physically behind the house in the backyard',
);
assert.match(
  villagers.inspectVillager(worker.personIdentity)?.activity ?? '',
  /Celebrating Jurjevo.*backyard/,
);

villagers.setSchedule({
  ...fullClock(12),
  month: 6,
  monthDay: 29,
}, false, DEFAULT_NIGHT_POLICY, true);
assert.equal(worker.routinePhase, 'going_to_feast');
assert.equal(worker.pathPurpose, 'monastery_feast');
assert.equal(villagerInternals.workerToolFor(worker), null);
for (let step = 0; step < realtimeTickBudget(4000); step++) villagers.tick(0.05);
assert.equal(
  worker.routinePhase,
  'at_feast',
  `feast journey should finish (${worker.simPathCursor.toFixed(1)} / ${worker.pathDistance.toFixed(1)} m)`,
);
assert.match(
  villagers.inspectVillager(worker.personIdentity)?.activity ?? '',
  /Sharing the feast at the monastery/,
);
assert.ok(
  Math.hypot(worker.x - monastery.x, worker.z - monastery.z) >= 9.7,
  'feast guests must remain visibly outside the monastery footprint',
);

villagers.setSchedule({
  ...fullClock(16),
  month: 6,
  monthDay: 29,
}, false, DEFAULT_NIGHT_POLICY, true);
assert.equal(worker.routinePhase, 'returning_from_feast');
assert.equal(worker.pathPurpose, 'return_from_feast');
for (let step = 0; step < realtimeTickBudget(4000); step++) villagers.tick(0.05);
assert.match(
  worker.routinePhase,
  /^(commuting_to_work|work)$/,
  'a worker returning from a feast should resume continuous ordinary labor',
);

villagers.setSchedule({
  ...fullClock(12),
  month: 8,
  monthDay: 15,
}, false, DEFAULT_NIGHT_POLICY, false);
assert.notEqual(
  worker.routinePhase,
  'going_to_feast',
  'disabling the policy must keep workers at their ordinary routines on feast dates',
);

villagers.setSchedule({
  ...fullClock(12),
  month: 9,
  monthDay: 14,
}, false, DEFAULT_NIGHT_POLICY, true);
assert.equal(worker.routinePhase, 'going_to_feast');
villagers.setRefugeAlert(true, new Map([[home.id, refuge.id]]));
assert.equal(worker.routinePhase, 'going_to_refuge');
assert.equal(worker.pathPurpose, 'refuge_rally');
for (let step = 0; step < realtimeTickBudget(1600); step++) villagers.tick(0.05);
assert.equal(worker.routinePhase, 'at_refuge');
assert.equal(worker.pathPurpose, null);
assert.match(
  villagers.inspectVillager(worker.personIdentity)?.activity ?? '',
  /Sheltering with their household/,
);
assert.ok(
  Math.hypot(worker.x - refuge.x, worker.z - refuge.z) < 5.5,
  'assigned household members must visibly finish inside their physical refuge',
);

villagers.setSchedule({
  ...fullClock(16),
  month: 9,
  monthDay: 14,
}, false, DEFAULT_NIGHT_POLICY, true);
villagers.setRefugeAlert(false);
assert.equal(worker.routinePhase, 'returning_from_refuge');
assert.equal(worker.pathPurpose, 'return_from_refuge');
for (let step = 0; step < realtimeTickBudget(1800); step++) villagers.tick(0.05);
assert.match(
  worker.routinePhase,
  /^(commuting_to_work|work)$/,
  'a worker returning from refuge should resume continuous ordinary labor',
);
assert.equal(worker.refugeId, null);
syncRoutineVillage([
  fireIncident('refuge-fire', 'building', refuge.id, refuge.x, refuge.z),
]);
villagers.setRefugeAlert(true, new Map([[home.id, refuge.id]]));
assert.notEqual(
  worker.pathPurpose,
  'refuge_rally',
  'a fire-disabled refuge must not receive a household rally',
);
villagers.setRefugeAlert(false);
syncRoutineVillage();
villagers.dispose();
await new Promise((resolve) => setTimeout(resolve, 0));

const continuousWorkVillagers = new VillagerRenderer({
  parent: new THREE.Group(),
  getGameSpeed: () => 1,
  getHeightAt: () => 0,
});
const continuousHome = residence('continuous-work-home', 0, 0);
const continuousWorkplace = building('continuous-workplace', 30, 0);
const continuousRoads = new RoadNetwork();
continuousRoads.addRoadPath([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(30, 0, 0),
]);
continuousWorkVillagers.sync({
  residences: [continuousHome],
  buildings: [continuousWorkplace],
  quarries: [],
  foragingNodes: [],
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
  fireIncidents: [],
  roadNetwork: continuousRoads,
});
continuousWorkVillagers.setSchedule(fullClock(12), false);
const continuousAgent = (
  continuousWorkVillagers as unknown as {
    agents: Map<string, {
      routinePhase: string;
      pathPurpose: string | null;
    }>;
  }
).agents.get('worker:continuous-workplace:0');
assert.ok(continuousAgent);
continuousWorkVillagers.setSchedule(fullClock(23), false);
assert.equal(
  continuousAgent.routinePhase,
  'work',
  'ordinary workers must remain on duty through cosmetic night hours',
);
continuousWorkVillagers.setSchedule({
  ...fullClock(1),
  totalDays: 1,
  weekday: 0,
  isSunday: true,
}, true, DEFAULT_NIGHT_POLICY, true, true);
assert.equal(
  continuousAgent.routinePhase,
  'returning_home',
  'an observed Sabbath must still release the continuous crew toward home',
);
for (let step = 0; step < realtimeTickBudget(900); step++) {
  continuousWorkVillagers.tick(0.05);
}
assert.equal(continuousAgent.routinePhase, 'asleep');
continuousWorkVillagers.setSchedule({
  ...fullClock(1),
  totalDays: 2,
}, false);
assert.equal(
  continuousAgent.routinePhase,
  'commuting_to_work',
  'ordinary labor must resume immediately after Sabbath even during cosmetic night',
);
continuousWorkVillagers.dispose();
await new Promise((resolve) => setTimeout(resolve, 0));

const defenseVillagers = new VillagerRenderer({
  parent: new THREE.Group(),
  getGameSpeed: () => 1,
  getHeightAt: () => 0,
});
const defenseHome = {
  ...residence('defense-home', 0, 0),
  population: 3,
  populationCapacity: 3,
};
const guardhouse = {
  ...building('routine-guardhouse', 12, 0),
  kind: 'guardhouse' as const,
  assignedLabor: 2,
  polearms: 1,
};
const musterWatch = {
  ...building('routine-watch', 30, 0),
  kind: 'watchtower' as const,
  assignedLabor: 1,
  workRadius: 190,
};
const musterPositions = Array.from(
  { length: WATCHTOWER_MUSTER_RANK_WIDTH * 2 },
  (_, slot) => watchtowerMusterPosition(musterWatch, slot),
);
assert.equal(
  new Set(musterPositions.map((position) => `${position.x}:${position.z}`)).size,
  WATCHTOWER_MUSTER_RANK_WIDTH * 2,
  'several companies must extend the watch formation instead of overlapping',
);
assert.ok(
  musterPositions.every(
    (position) => Math.hypot(
      position.x - musterWatch.x,
      position.z - musterWatch.z,
    ) > 4,
  ),
  'guard formations must remain clear of the tower and its ladder',
);
defenseVillagers.sync({
  residences: [defenseHome],
  buildings: [guardhouse, musterWatch, refuge],
  quarries: [],
  foragingNodes: [],
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
  roadNetwork: parishRoads,
});
defenseVillagers.setSchedule(fullClock(12), false);
defenseVillagers.setRefugeAlert(
  true,
  new Map([[defenseHome.id, refuge.id]]),
);
const defenseAgents = (
  defenseVillagers as unknown as {
    agents: Map<string, {
      personIdentity: string;
      routinePhase: string;
      pathPurpose: string | null;
      musterTowerId: string | null;
      x: number;
      z: number;
    }>;
  }
).agents;
assert.equal(
  defenseAgents.get('worker:routine-guardhouse:0')?.routinePhase,
  'work',
  'watch and guard crews must stay at their defensive posts while civilians rally',
);
assert.notEqual(
  defenseAgents.get('worker:routine-guardhouse:0')?.pathPurpose,
  'refuge_rally',
);
defenseVillagers.setFrontierAlert(
  true,
  new Map([[defenseHome.id, refuge.id]]),
  new Map([[guardhouse.id, { towerId: musterWatch.id }]]),
);
const armedGuard = defenseAgents.get('worker:routine-guardhouse:0')!;
const unarmedGuard = defenseAgents.get('worker:routine-guardhouse:1')!;
const watchman = defenseAgents.get('worker:routine-watch:0')!;
assert.equal(armedGuard.routinePhase, 'going_to_muster');
assert.equal(armedGuard.pathPurpose, 'guard_muster');
assert.equal(
  unarmedGuard.routinePhase,
  'work',
  'a company member without an onsite polearm must not appear in the armed muster',
);
assert.equal(
  watchman.routinePhase,
  'work',
  'the watchman must remain on the gallery while the road company answers',
);
for (let step = 0; step < realtimeTickBudget(1200); step++) defenseVillagers.tick(0.05);
assert.equal(armedGuard.routinePhase, 'at_muster');
assert.equal(armedGuard.musterTowerId, musterWatch.id);
assert.match(
  defenseVillagers.inspectVillager(armedGuard.personIdentity)?.activity ?? '',
  /Holding the watch muster line/,
);
assert.ok(
  Math.hypot(
    armedGuard.x - musterWatch.x,
    armedGuard.z - musterWatch.z,
  ) < 7,
  'the armed company must finish in a readable line beside its linked watch',
);
defenseVillagers.setFrontierAlert(false);
assert.equal(armedGuard.routinePhase, 'returning_from_muster');
assert.equal(armedGuard.pathPurpose, 'return_from_muster');
for (let step = 0; step < realtimeTickBudget(1400); step++) defenseVillagers.tick(0.05);
assert.equal(armedGuard.routinePhase, 'work');
assert.equal(armedGuard.musterTowerId, null);
defenseVillagers.setFrontierAlert(
  true,
  new Map([[defenseHome.id, refuge.id]]),
  new Map([[guardhouse.id, { towerId: musterWatch.id }]]),
);
for (let step = 0; step < realtimeTickBudget(1200); step++) defenseVillagers.tick(0.05);
assert.equal(armedGuard.routinePhase, 'at_muster');
defenseVillagers.sync({
  residences: [defenseHome],
  buildings: [guardhouse, musterWatch, refuge],
  quarries: [],
  foragingNodes: [],
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
  fireIncidents: [
    fireIncident('guardhouse-fire', 'building', guardhouse.id, guardhouse.x, guardhouse.z),
  ],
  roadNetwork: parishRoads,
});
assert.equal(
  armedGuard.pathPurpose,
  'refuge_rally',
  'a guard whose post burns during muster must leave the line and rally with the household',
);
assert.equal(unarmedGuard.pathPurpose, 'refuge_rally');
assert.equal(
  watchman.routinePhase,
  'work',
  'a separate healthy watch crew must remain at its defensive post',
);
defenseVillagers.setFrontierAlert(false);
defenseVillagers.dispose();
await new Promise((resolve) => setTimeout(resolve, 0));
console.warn = originalWarn;

const residenceMarkers = new ResidenceMarkers(new THREE.Group());
residenceMarkers.syncResidences([home], () => 0);
residenceMarkers.tick(0.05);
const markerInternals = residenceMarkers as unknown as {
  smokeEmitters: Map<string, { active: boolean }>;
  meshes: Map<string, THREE.Group>;
};
const smokeEmitter = markerInternals.smokeEmitters.get(home.id);
assert.equal(smokeEmitter?.active, true);
residenceMarkers.setFireDisabledResidenceIds(new Set([home.id]));
assert.equal(
  smokeEmitter?.active,
  false,
  'a fire-disabled home must stop emitting ordinary hearth smoke immediately',
);
residenceMarkers.setFireDisabledResidenceIds(new Set());
assert.equal(smokeEmitter?.active, true);
residenceMarkers.setChimneySmokeAllowed(false);
assert.equal(
  smokeEmitter?.active,
  false,
  'the global night-hours switch should immediately stop residence chimney smoke',
);

const bedtime = householdMemberRoutine(`${home.id}:person:0`).bedtimeHour;
residenceMarkers.setEveningWindowGlow(1);
residenceMarkers.setHouseholdClock(fullClock(bedtime - 0.1));
const windowMaterial = markerInternals.meshes.get(home.id)?.userData
  .windowMaterial as THREE.MeshStandardMaterial | undefined;
assert.ok(windowMaterial && windowMaterial.emissiveIntensity > 0.2);
residenceMarkers.setFireDisabledResidenceIds(new Set([home.id]));
assert.equal(
  windowMaterial?.emissiveIntensity,
  0.12,
  'a fire-disabled home must not retain ordinary household window light',
);
residenceMarkers.setFireDisabledResidenceIds(new Set());
assert.ok(windowMaterial && windowMaterial.emissiveIntensity > 0.2);
residenceMarkers.setHouseholdClock(fullClock(2));
assert.equal(
  windowMaterial?.emissiveIntensity,
  0.12,
  'residence windows should go fully dark once the household is asleep',
);
residenceMarkers.dispose();

console.log('household routine and continuous-worker tests passed');

function realtimeTickBudget(unscaledTicks: number): number {
  return Math.ceil(unscaledTicks / Math.max(SIM_REALTIME_RATE, 1e-6));
}

function clockFromHour(hourValue: number): Pick<GameClock, 'hour' | 'minute'> {
  const wrapped = ((hourValue % 24) + 24) % 24;
  const hour = Math.floor(wrapped);
  const minute = Math.floor((wrapped - hour) * 60);
  return { hour, minute };
}

function fullClock(hourValue: number): GameClock {
  const clock = clockFromHour(hourValue);
  return {
    ...clock,
    simTick: 0,
    totalDays: 0,
    weekday: 1,
    monthDay: 1,
    month: 1,
    year: 1,
    isSunday: false,
    isWorkHours: hourValue >= 6 && hourValue < 20,
  };
}

function fireIncident(
  id: string,
  targetKind: FireIncidentState['targetKind'],
  targetId: string,
  x: number,
  z: number,
): FireIncidentState {
  return {
    id,
    targetKind,
    targetId,
    x,
    z,
    ignitionSource: 'accident',
    status: 'burning',
    intensity: 0.8,
    damage: 0.2,
    waterDelivered: 0,
    requiredWater: 12,
    extinguishChance: 0,
    startedTick: 100,
    discoveredTick: 100,
    lastWaterTick: 0,
    resolvedTick: 0,
    responseWellId: null,
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
    population: 1,
    populationCapacity: 1,
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
    householdWealth: 0,
  };
}

function building(id: string, x: number, z: number): BuildingState {
  return {
    id,
    kind: 'lumber_mill',
    x,
    z,
    workRadius: 50,
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
    assignedLabor: 1,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  };
}
