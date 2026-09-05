import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BuildingState, ResidenceState } from '../src/resources/types.ts';
import {
  CLERIC_SOURCE_CLIP_BY_MODE,
  createClericClipSet,
} from '../src/settlement/SettlementCrowdRenderer.ts';
import {
  CLERIC_AUTHORED_ANIMATION_NAMES,
  clericDutyAnimation,
  isDaytimeHouseholdIndoorPause,
  type ClericDuty,
} from '../src/settlement/clericBehaviors.ts';
import {
  chapelClergyGatheringPoint,
  chapelMassPhase,
} from '../src/settlement/chapelMass.ts';
import { planChapelGatheringBehaviors } from '../src/settlement/chapelGatheringBehaviors.ts';
import {
  allocateProductionWorkers,
  collectWorkerTargets,
  pickWorkerWalkPlan,
} from '../src/settlement/workerPaths.ts';
import { villagerOccupation } from '../src/settlement/villagerIdentity.ts';

(globalThis as typeof globalThis & { self: typeof globalThis }).self = globalThis;
(globalThis as typeof globalThis & {
  createImageBitmap: (blob: Blob) => Promise<ImageBitmap>;
}).createImageBitmap = async () => ({
  width: 1,
  height: 1,
  close() {},
} as ImageBitmap);

const assetPath = 'public/assets/models/villagers/cleric-monk-common-01-v001.glb';
const bytes = fs.readFileSync(assetPath);
const buffer = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
) as ArrayBuffer;
const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
  new GLTFLoader().parse(buffer, '', resolve, reject);
});

assert.deepEqual(
  gltf.animations.map((clip) => clip.name),
  CLERIC_AUTHORED_ANIMATION_NAMES,
  'the project cleric GLB must retain the complete labeled 20-clip manifest',
);
assert.deepEqual(
  [...new Set(Object.values(CLERIC_SOURCE_CLIP_BY_MODE))].sort(),
  CLERIC_AUTHORED_ANIMATION_NAMES.filter((name) => name !== 'flee_01').sort(),
  'every authored cleric clip except the unused cartoonish flee take must be reachable',
);
const gameClips = createClericClipSet(gltf.animations);
assert.equal(gameClips.sermon.name, 'greet_04:cleric-sermon');
assert.equal(gameClips.flee.name, 'run:cleric-flee');
assert.equal(gameClips.run.name, 'run:cleric-run');

const chapel = building('parish-chapel', 'chapel', 0, 0, 1);
const homes = [
  residence('home-a', -10, 6, 3),
  residence('home-b', 11, 4, 2),
];
const chapelTargets = collectWorkerTargets(chapel, emptyTargetInputs(homes));
assert.ok(chapelTargets.some((target) => target.clericDuty === 'interior_prayer' && target.interior));
assert.ok(chapelTargets.some((target) => target.clericDuty === 'interior_study' && target.interior));
assert.ok(chapelTargets.some((target) => target.clericDuty === 'churchyard_prayer'));
assert.ok(chapelTargets.some((target) => target.clericDuty === 'sermon_rehearsal'));
assert.equal(
  chapelTargets.filter((target) => target.clericDuty === 'parish_visit').length,
  homes.length,
  'the priest should make visible parish calls to nearby occupied homes',
);

const monastery = building('abbey', 'monastery', 40, 0, 8);
const monasteryTargets = collectWorkerTargets(monastery, emptyTargetInputs(homes));
const monasteryDuties = new Set(monasteryTargets.map((target) => target.clericDuty));
for (const duty of [
  'cloister_prayer',
  'scriptorium',
  'hospitality',
  'brewing',
  'harvest',
  'soil_work',
  'pruning',
  'livestock_care',
  'ox_guidance',
] as const satisfies readonly ClericDuty[]) {
  assert.ok(monasteryDuties.has(duty), `monastery duty roster must include ${duty}`);
}
assert.ok(monasteryTargets.some((target) => target.interior));
assert.ok(monasteryTargets.some((target) => !target.interior));
assert.equal(
  pickWorkerWalkPlan(monastery, 0, monasteryTargets, 17, null, null, true)?.target?.clericDuty,
  'ox_guidance',
  'a monk paired to a stable ox should take the estate pasture guidance loop',
);

const sampledDutyModes = new Set<string>();
for (const duty of monasteryDuties) {
  if (!duty) continue;
  for (let seed = 0; seed < 16; seed += 1) {
    sampledDutyModes.add(clericDutyAnimation(duty, seed));
  }
}
for (const mode of ['sit', 'look', 'bow', 'carry', 'gather', 'mine', 'sow', 'fight', 'chop', 'tend', 'hurt', 'fall', 'flee']) {
  assert.ok(sampledDutyModes.has(mode), `cleric duties must exercise ${mode}`);
}

assert.equal(villagerOccupation('chapel'), 'Priest');
assert.equal(villagerOccupation('monastery'), 'Monk');
const roster = allocateProductionWorkers(homes, [chapel, monastery]);
assert.equal(roster.assignments.filter((entry) => entry.buildingId === chapel.id).length, 1);
assert.equal(roster.assignments.filter((entry) => entry.buildingId === monastery.id).length, 8);

assert.equal(chapelMassPhase(sundayClock(8, 30), true), 'assembly');
assert.equal(chapelMassPhase(sundayClock(9, 30), true), 'service');
assert.equal(chapelMassPhase(sundayClock(10, 45), true), 'fellowship');
assert.equal(chapelMassPhase(sundayClock(12, 0), true), null);
const priestId = 'worker:parish-chapel:0';
const congregation = [priestId, 'resident:1', 'resident:2', 'resident:3'];
const assembly = planChapelGatheringBehaviors(chapel, congregation, 0, {
  clergyActorIds: [priestId],
  phase: 'assembly',
});
assert.deepEqual(assembly.get(priestId)?.destination, chapelClergyGatheringPoint(chapel));
assert.ok(
  congregation.slice(1).every((id) => assembly.get(id)?.lookAt?.z === chapelClergyGatheringPoint(chapel).z),
  'the assembling congregation should face the priest',
);
assert.equal(
  planChapelGatheringBehaviors(chapel, congregation, 0, {
    clergyActorIds: [priestId],
    phase: 'service',
  }).size,
  0,
  'the visible churchyard roster should empty while mass happens inside',
);

const pauseSamples = Array.from({ length: 32 }, (_, index) =>
  isDaytimeHouseholdIndoorPause(`worker:${index}`, { hour: 10, minute: 0 })
);
assert.ok(pauseSamples.some(Boolean) && pauseSamples.some((value) => !value));

console.log('cleric model, animation coverage, duties, and mass choreography tests passed');

function emptyTargetInputs(residences: readonly ResidenceState[]) {
  return {
    quarries: [],
    foragingNodes: [],
    trees: new Map(),
    treeRegistry: null,
    farmFields: [],
    pastures: [],
    residences,
  };
}

function building(
  id: string,
  kind: BuildingState['kind'],
  x: number,
  z: number,
  assignedLabor: number,
): BuildingState {
  return {
    id,
    kind,
    x,
    z,
    yaw: 0,
    workRadius: 70,
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

function sundayClock(hour: number, minute: number) {
  return { isSunday: true, hour, minute };
}
