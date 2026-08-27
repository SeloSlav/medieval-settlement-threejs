import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type {
  BuildingState,
  GraveyardState,
  ResidenceState,
} from '../src/resources/types.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import { isPointInPolygon2 } from '../src/utils/polygonGeometry.ts';
import { VillagerRenderer } from '../src/settlement/VillagerRenderer.ts';
import {
  MAX_GRAVEYARD_VISITORS,
  SABBATH_DEVOTION_END_HOUR,
  SABBATH_DEVOTION_START_HOUR,
  graveyardDevotionPath,
  graveyardPrayerPoint,
  indexSabbathGraveyardsByChapel,
  isSabbathDevotionTime,
  operationalSabbathGraveyards,
  pickSabbathGraveyard,
  sabbathDevotionPreference,
} from '../src/settlement/sabbathDevotion.ts';
import type { GameClock } from '../src/world/gameCalendar.ts';

(globalThis as typeof globalThis & { self: typeof globalThis }).self = globalThis;

function building(
  id: string,
  kind: BuildingState['kind'],
  x: number,
  z: number,
  overrides: Partial<BuildingState> = {},
): BuildingState {
  return {
    id,
    kind,
    x,
    z,
    constructionComplete: true,
    assignedLabor: 0,
    ...overrides,
  } as BuildingState;
}

function residence(id: string, x: number, z: number): ResidenceState {
  return {
    id,
    zoneId: 'sabbath-zone',
    parcelIndex: 0,
    x,
    z,
    yaw: 0,
    population: 12,
    populationCapacity: 12,
    tier: 2,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
  };
}

function graveyard(
  id: string,
  chapelId: string,
  centerX: number,
  centerZ: number,
  burials = 8,
): GraveyardState {
  return {
    id,
    chapelId,
    corners: [
      { x: centerX - 4, z: centerZ - 3 },
      { x: centerX + 4, z: centerZ - 3 },
      { x: centerX + 4, z: centerZ + 3 },
      { x: centerX - 4, z: centerZ + 3 },
    ],
    area: 48,
    averageSlopeDegrees: 0,
    capacity: 24,
    burials,
  };
}

function sundayClock(hour: number, minute = 0): GameClock {
  return {
    simTick: hour * 60 + minute,
    totalDays: 0,
    hour,
    minute,
    weekday: 0,
    monthDay: 1,
    month: 3,
    year: 1,
    isSunday: true,
    isWorkHours: hour >= 6 && hour < 20,
  };
}

const parishGround = graveyard('parish-ground', 'chapel', 20, 4);
const emptyGround = graveyard('empty-ground', 'chapel', 20, -5, 0);
const foreignGround = graveyard('foreign-ground', 'other-chapel', 30, 4);
const operational = operationalSabbathGraveyards(
  [foreignGround, emptyGround, parishGround],
  new Set(['chapel']),
);
assert.deepEqual(
  operational.map((candidate) => candidate.id),
  ['parish-ground'],
  'only occupied grounds belonging to an operational parish should receive visitors',
);
const indexed = indexSabbathGraveyardsByChapel(operational);
assert.equal(
  pickSabbathGraveyard(indexed.get('chapel') ?? [], 0, 'person:1')?.id,
  parishGround.id,
);

const graveyardPoints = Array.from(
  { length: MAX_GRAVEYARD_VISITORS },
  (_, slot) => graveyardPrayerPoint(parishGround, slot),
);
assert.equal(
  new Set(graveyardPoints.map((point) => `${point.x.toFixed(3)}:${point.z.toFixed(3)}`)).size,
  MAX_GRAVEYARD_VISITORS,
);
assert.ok(
  graveyardPoints.every((point) => isPointInPolygon2(point, parishGround.corners)),
  'graveyard prayer positions must remain inside the consecrated parcel',
);

const roads = new RoadNetwork();
roads.addRoadPath([
  new THREE.Vector3(-4, 0, 0),
  new THREE.Vector3(32, 0, 0),
]);
const graveyardPath = graveyardDevotionPath(
  { x: 12, z: 0 },
  parishGround,
  2,
  roads,
);
assert.ok(graveyardPath.length >= 2);
assert.deepEqual(graveyardPath.at(-1), graveyardPoints[2]);

const identities = Array.from({ length: 100 }, (_, index) => `person:${index}`);
assert.ok(identities.some((identity) =>
  sabbathDevotionPreference(0, identity) === 'shrine'
));
assert.ok(identities.some((identity) =>
  sabbathDevotionPreference(0, identity) === 'graveyard'
));
for (const identity of identities) {
  let activeSamples = 0;
  for (
    let minuteOfDay = SABBATH_DEVOTION_START_HOUR * 60;
    minuteOfDay < SABBATH_DEVOTION_END_HOUR * 60;
    minuteOfDay += 15
  ) {
    activeSamples += Number(isSabbathDevotionTime(
      sundayClock(Math.floor(minuteOfDay / 60), minuteOfDay % 60),
      true,
      identity,
    ));
  }
  assert.ok(activeSamples > 0, `${identity} should receive one post-mass visit window`);
}
assert.equal(
  isSabbathDevotionTime(sundayClock(13), false, identities[0]!),
  false,
  'an unobserved Sunday must not create a devotional dispersal',
);

const home = residence('home', 0, 0);
const parishHomes = [
  home,
  residence('home-north', 0, 2),
  residence('home-south', 0, -2),
  residence('home-west', -2, 0),
];
const chapel = building('chapel', 'chapel', 12, 0, { assignedLabor: 1 });
const originalWarn = console.warn;
console.warn = () => {};
const villagers = new VillagerRenderer({
  parent: new THREE.Group(),
  getGameSpeed: () => 1,
  getHeightAt: () => 0,
});
villagers.sync({
  residences: parishHomes,
  buildings: [chapel],
  quarries: [],
  foragingNodes: [],
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
  graveyards: [parishGround],
  roadNetwork: roads,
});

type TestAgent = {
  id: string;
  personIdentity: string;
  routinePhase: string;
  pathPurpose: string | null;
  mode: string;
  x: number;
  z: number;
  devotionalGraveyardId: string | null;
  lastDevotionalVisitKey: string;
};
const agents = (
  villagers as unknown as { agents: Map<string, TestAgent> }
).agents;

villagers.setSchedule(sundayClock(9), true, true, true, null);
assert.ok(
  [...agents.values()].every((agent) => agent.routinePhase === 'going_to_mass'),
  'the complete healthy visible population should join the church congregation',
);
for (let step = 0; step < 1_200; step += 1) {
  villagers.tick(0.05);
  if ([...agents.values()].every((agent) => agent.routinePhase === 'at_mass')) break;
}
assert.ok(agents.size >= 8, 'the fixture should produce a visibly large congregation');
assert.ok([...agents.values()].every((agent) =>
  agent.routinePhase === 'at_mass'
  && Math.hypot(agent.x - chapel.x, agent.z - chapel.z) < 9
));

let dispersalClock: GameClock | null = null;
for (
  let minuteOfDay = SABBATH_DEVOTION_START_HOUR * 60;
  minuteOfDay < SABBATH_DEVOTION_END_HOUR * 60;
  minuteOfDay += 15
) {
  const candidate = sundayClock(
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
  );
  const active = [...agents.values()].filter((agent) =>
    isSabbathDevotionTime(candidate, true, agent.personIdentity)
  );
  if (active.length >= 2) {
    dispersalClock = candidate;
    break;
  }
}
assert.ok(dispersalClock);
const massPositions = new Map(
  [...agents.values()].map((agent) => [agent.id, { x: agent.x, z: agent.z }]),
);
villagers.setSchedule(dispersalClock!, true, true, true, null);
const outbound = [...agents.values()].filter(
  (agent) => agent.routinePhase === 'going_to_graveyard',
);
assert.ok(outbound.length >= 2);
assert.ok(outbound.length <= MAX_GRAVEYARD_VISITORS);
assert.ok(outbound.every((agent) =>
  agent.pathPurpose === 'graveyard_prayer'
  && agent.devotionalGraveyardId === parishGround.id
  && Math.hypot(
    agent.x - massPositions.get(agent.id)!.x,
    agent.z - massPositions.get(agent.id)!.z,
  ) < 1e-6
), 'the selected cohort should disperse directly from its church gathering positions');

let graveyardArrival: TestAgent | null = null;
for (let step = 0; step < 1_200; step += 1) {
  villagers.tick(0.05);
  graveyardArrival = outbound.find(
    (agent) => agent.routinePhase === 'praying_at_graveyard',
  ) ?? null;
  if (graveyardArrival) break;
}
assert.ok(graveyardArrival);
assert.equal(graveyardArrival.mode, 'pray');

for (let step = 0; step < 2_000; step += 1) {
  villagers.tick(0.05);
  if (outbound.every((agent) => agent.routinePhase === 'indoors')) break;
}
assert.ok(outbound.every((agent) =>
  agent.routinePhase === 'indoors'
  && agent.lastDevotionalVisitKey === 'sabbath:0'
));
assert.equal(
  villagers.inspectVillager(outbound[0]!.personIdentity)?.activity,
  'Resting at home after Sabbath devotions',
);

await villagers.visualAssetsReady;
villagers.dispose();
console.warn = originalWarn;
console.log('Sabbath devotion sequence tests passed.');
