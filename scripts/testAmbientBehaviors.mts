import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { BuildingState } from '../src/resources/types.ts';
import {
  assignAmbientBehaviorSlots,
  type AmbientBehaviorSlot,
} from '../src/settlement/ambientBehaviors.ts';
import {
  FOUNDERS_CAMP_AMBIENT_CYCLE_SECONDS,
  planFoundersCampAmbientBehaviors,
} from '../src/settlement/foundersCampBehaviors.ts';
import { VillagerRenderer } from '../src/settlement/VillagerRenderer.ts';

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
const actorIds = Array.from({ length: 5 }, (_, index) => `founder-camp:${index}`);
const campPlan = planFoundersCampAmbientBehaviors(camp, actorIds, 0);
assert.deepEqual(
  [...campPlan.values()].map((assignment) => assignment.kind).sort(),
  ['rest', 'sit', 'talk', 'talk', 'wander'],
  'a full founding crowd should visibly talk, sit, rest, and move at once',
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
  personIdentity: string;
  mode: string;
  ambientBehavior: string | null;
  x: number;
  z: number;
  yaw: number;
};
const agents = (
  villagers as unknown as { agents: Map<string, TestAgent> }
).agents;
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

const firstSitter = [...agents.values()].find(
  (agent) => agent.ambientBehavior === 'sit',
)?.personIdentity;
villagers.tick(FOUNDERS_CAMP_AMBIENT_CYCLE_SECONDS - 12 + 0.1);
const nextSitter = [...agents.values()].find(
  (agent) => agent.ambientBehavior === 'sit',
)?.personIdentity;
assert.notEqual(
  nextSitter,
  firstSitter,
  'activity cycles should rotate people through camp roles',
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
