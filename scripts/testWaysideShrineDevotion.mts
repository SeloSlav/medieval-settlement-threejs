import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type { BuildingState, ResidenceState } from '../src/resources/types.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import {
  createPrayerAnimationClip,
} from '../src/settlement/SettlementCrowdRenderer.ts';
import { VillagerRenderer } from '../src/settlement/VillagerRenderer.ts';
import {
  MAX_WAYSIDE_SHRINE_VISITORS,
  claimWaysideShrinesForResidences,
  isWaysideShrinePrayerTime,
  operationalWaysideShrines,
  waysideShrinePrayerPath,
  waysideShrinePrayerPoint,
} from '../src/settlement/waysideShrineDevotion.ts';
import type { GameClock } from '../src/world/gameCalendar.ts';
import type { HolidayObservance } from '../src/world/holidayCalendar.ts';
import { isSabbathDevotionTime } from '../src/settlement/sabbathDevotion.ts';

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

function residence(id: string, x: number, z: number, population = 12): ResidenceState {
  return {
    id,
    zoneId: 'devotion-zone',
    parcelIndex: 0,
    x,
    z,
    yaw: 0,
    population,
    populationCapacity: population,
    tier: 2,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 0,
  };
}

function sundayClock(hour: number, minute = 0, totalDays = 0): GameClock {
  return {
    simTick: totalDays * 1_000 + hour * 10 + minute,
    totalDays,
    hour,
    minute,
    weekday: 0,
    monthDay: 1 + totalDays,
    month: 3,
    year: 1,
    isSunday: true,
    isWorkHours: hour >= 6 && hour < 20,
  };
}

const roads = new RoadNetwork();
roads.addRoadPath([
  new THREE.Vector3(-8, 0, 0),
  new THREE.Vector3(32, 0, 0),
]);
roads.addRoadPath([
  new THREE.Vector3(-8, 0, 24),
  new THREE.Vector3(4, 0, 24),
]);

const home = residence('home', 0, 2);
const shrine = building('shrine-connected', 'wayside_shrine', 20, 2);
const disconnectedShrine = building('shrine-disconnected', 'wayside_shrine', 0, 24);
const unfinishedShrine = building('shrine-building', 'wayside_shrine', 4, 2, {
  constructionComplete: false,
});
const operational = operationalWaysideShrines([
  disconnectedShrine,
  unfinishedShrine,
  shrine,
]);
assert.deepEqual(operational.map((candidate) => candidate.id), [
  'shrine-connected',
  'shrine-disconnected',
]);
assert.equal(
  claimWaysideShrinesForResidences([home], operational, roads).get(home.id)?.shrine.id,
  shrine.id,
  'visitors must use the nearest shrine on their connected road graph',
);

const prayerPoints = Array.from(
  { length: MAX_WAYSIDE_SHRINE_VISITORS },
  (_, slot) => waysideShrinePrayerPoint(shrine, slot, roads),
);
assert.equal(
  new Set(prayerPoints.map((point) => `${point.x.toFixed(3)}:${point.z.toFixed(3)}`)).size,
  MAX_WAYSIDE_SHRINE_VISITORS,
  'the bounded prayer group needs distinct places in front of the niche',
);
for (const point of prayerPoints) {
  const facingYaw = Math.atan2(shrine.x - point.x, shrine.z - point.z);
  assert.ok(Math.abs(point.yaw - facingYaw) < 1e-9);
}
const prayerPath = waysideShrinePrayerPath(
  { x: home.x, z: home.z },
  shrine,
  1,
  roads,
);
assert.ok(prayerPath && prayerPath.length >= 2);
assert.deepEqual(prayerPath.at(-1), prayerPoints[1]);

const identities = Array.from({ length: 100 }, (_, index) => `person:${index}`);
const sundaySets: Set<string>[] = [];
let selectedClock: GameClock | null = null;
for (let quarter = 0; quarter < 20; quarter += 1) {
  const hour = 12 + Math.floor(quarter / 4);
  const minute = quarter % 4 * 15;
  const clock = sundayClock(hour, minute);
  const active = new Set(identities.filter((identity) =>
    isWaysideShrinePrayerTime(clock, true, null, identity)
  ));
  sundaySets.push(active);
  if (!selectedClock && active.size >= 4) selectedClock = clock;
}
assert.ok(selectedClock, 'a Sabbath afternoon must produce a visible visitor cohort');
assert.ok(sundaySets.some((set) => set.size > 0));
assert.ok(sundaySets.some((set, index) =>
  index > 0 && [...set].some((identity) => !sundaySets[index - 1]!.has(identity))
), 'visitor cohorts should rotate through the afternoon');

const nextSunday = sundayClock(selectedClock!.hour, selectedClock!.minute, 7);
const thisSundayVisitors = new Set(identities.filter((identity) =>
  isWaysideShrinePrayerTime(selectedClock!, true, null, identity)
));
const nextSundayVisitors = new Set(identities.filter((identity) =>
  isWaysideShrinePrayerTime(nextSunday, true, null, identity)
));
assert.notDeepEqual(thisSundayVisitors, nextSundayVisitors);
assert.equal(
  isWaysideShrinePrayerTime(selectedClock!, false, null, identities[0]!),
  false,
  'an ordinary Sunday without active Sabbath observance must not schedule shrine prayer',
);

const feast: HolidayObservance = {
  id: 'assumption',
  label: 'Assumption of Mary',
  periodLabel: 'Assumption',
  kind: 'procession',
  periodDay: 1,
  periodLength: 1,
  historicalYear: 1550,
};
assert.ok(identities.some((identity) =>
  isWaysideShrinePrayerTime(
    { ...sundayClock(14), isSunday: false, weekday: 1 },
    false,
    feast,
    identity,
  )
), 'a named feast day must schedule a devotional cohort without Sabbath policy');

const originalWarn = console.warn;
console.warn = () => {};
const villagers = new VillagerRenderer({
  parent: new THREE.Group(),
  getGameSpeed: () => 1,
  getHeightAt: () => 0,
});
villagers.sync({
  residences: [home],
  buildings: [shrine],
  quarries: [],
  foragingNodes: [],
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
  roadNetwork: roads,
});
type TestAgent = {
  personIdentity: string;
  routinePhase: string;
  pathPurpose: string | null;
  mode: string;
  devotionalShrineId: string | null;
};
const agents = (villagers as unknown as { agents: Map<string, TestAgent> }).agents;
let runtimeClock: GameClock | null = null;
for (let quarter = 0; quarter < 20; quarter += 1) {
  const candidateClock = sundayClock(
    12 + Math.floor(quarter / 4),
    quarter % 4 * 15,
  );
  const eligible = [...agents.values()].filter((agent) =>
    isSabbathDevotionTime(
      candidateClock,
      true,
      agent.personIdentity,
    )
  );
  if (eligible.length > 0) {
    runtimeClock = candidateClock;
    break;
  }
}
assert.ok(runtimeClock);
villagers.setSchedule(runtimeClock, true, true, true, null);
const outbound = [...agents.values()].filter(
  (agent) => agent.routinePhase === 'going_to_shrine',
);
assert.ok(outbound.length > 0);
assert.ok(outbound.length <= MAX_WAYSIDE_SHRINE_VISITORS);
assert.ok(outbound.every((agent) =>
  agent.pathPurpose === 'wayside_shrine_prayer'
  && agent.devotionalShrineId === shrine.id
));

let praying: TestAgent | null = null;
for (let step = 0; step < 400; step += 1) {
  villagers.tick(0.1);
  praying = outbound.find(
    (agent) => agent.routinePhase === 'praying_at_shrine',
  ) ?? null;
  if (praying) break;
}
assert.ok(praying);
assert.equal(praying.mode, 'pray');

const bytes = fs.readFileSync('public/assets/models/villagers/quaternius-villager-man.glb');
const buffer = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
) as ArrayBuffer;
const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>(
  (resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject),
);
const idle = gltf.animations.find((clip) =>
  clip.name.toLowerCase().endsWith('_idle')
  || clip.name.toLowerCase().endsWith('|idle')
);
assert.ok(idle);
const prayerClip = createPrayerAnimationClip(gltf.scene, idle);
assert.equal(prayerClip.name, 'Villager_Devotional_Prayer');
assert.ok(prayerClip.duration >= 2.4);
for (const bone of ['Neck', 'UpperArmL', 'LowerArmL', 'UpperArmR', 'LowerArmR']) {
  assert.ok(
    prayerClip.tracks.some((track) => track.name === `${bone}.quaternion`),
    `prayer loop must explicitly own the ${bone} pose`,
  );
}

await villagers.visualAssetsReady;
villagers.dispose();
console.warn = originalWarn;
console.log('Wayside shrine devotion tests passed.');
