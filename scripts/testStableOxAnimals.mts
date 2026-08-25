import assert from 'node:assert/strict';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import type { BuildingKind, BuildingState } from '../src/resources/types.ts';
import type { StableOxLike } from '../src/settlement/stableOxen.ts';
import { buildSettlementAnimalsView } from '../src/ui/settlementAnimals.ts';

function building(
  id: string,
  kind: BuildingKind,
  x: number,
  assignedLabor = 0,
): BuildingState {
  return {
    id,
    kind,
    x,
    z: 0,
    assignedLabor,
    constructionComplete: true,
  } as BuildingState;
}

const buildings = new Map<string, BuildingState>([
  ['stable-a', building('stable-a', 'stable', 0)],
  ['stable-b', building('stable-b', 'stable', 100)],
  ['stable-c', building('stable-c', 'stable', 200)],
  ['lumber', building('lumber', 'lumber_mill', 1, 1)],
  ['quarry', building('quarry', 'stone_quarry', 10, 1)],
  ['carpenter', building('carpenter', 'carpenter', 110, 0)],
  ['storehouse', building('storehouse', 'village_storehouse', 4, 1)],
]);

const oxen: StableOxLike[] = [
  {
    id: 'ox-auto-assist',
    stableId: 'stable-a',
    slot: 0,
    assignedBuildingId: null,
  },
  {
    id: 'ox-auto-haul',
    stableId: 'stable-a',
    slot: 1,
    assignedBuildingId: null,
  },
  {
    id: 'ox-posted-active',
    stableId: 'stable-b',
    slot: 0,
    assignedBuildingId: 'lumber',
  },
  {
    id: 'ox-posted-waiting',
    stableId: 'stable-b',
    slot: 1,
    assignedBuildingId: 'carpenter',
  },
  {
    id: 'ox-disabled-stable',
    stableId: 'stable-c',
    slot: 2,
    assignedBuildingId: null,
  },
];

const haulingTrip: DeliveryTripState = {
  id: 'trip-1',
  buildingId: 'storehouse',
  laborBuildingId: 'storehouse',
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: 'lumber',
  cargoKind: 'timber',
  amount: 12,
  phase: 'outbound',
  x: 5,
  z: 0,
  progress: 0.25,
  speedMps: 2,
  unloadSeconds: 1,
  unloadRemaining: 1,
  deliveryWorkers: 1,
  freeHaulerWorkers: 0,
  oxId: 'ox-auto-haul',
  pathDistance: 20,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
};

const view = buildSettlementAnimalsView(
  oxen,
  buildings,
  [haulingTrip],
  new Set(['stable-c']),
);

assert.deepEqual(
  {
    total: view.total,
    posted: view.posted,
    automatic: view.automatic,
    working: view.working,
  },
  { total: 5, posted: 2, automatic: 3, working: 3 },
  'the roster distinguishes permanent postings from the automatic pool',
);

const byId = new Map(view.entries.map((entry) => [entry.id, entry]));
const autoAssist = byId.get('ox-auto-assist');
const autoHaul = byId.get('ox-auto-haul');
const postedActive = byId.get('ox-posted-active');
const postedWaiting = byId.get('ox-posted-waiting');
const disabledStable = byId.get('ox-disabled-stable');

assert.ok(autoAssist && autoHaul && postedActive && postedWaiting && disabledStable);

assert.deepEqual(
  {
    stableLabel: autoAssist.stableLabel,
    bay: autoAssist.bay,
    mode: autoAssist.mode,
    postingLabel: autoAssist.postingLabel,
  },
  {
    stableLabel: 'Stable 1',
    bay: 1,
    mode: 'automatic',
    postingLabel: 'Best available task',
  },
  'stable numbering, one-based bay labels, and automatic-pool identity remain explicit',
);
assert.equal(autoHaul.stableLabel, 'Stable 1');
assert.equal(autoHaul.bay, 2);
assert.equal(postedActive.stableLabel, 'Stable 2');
assert.equal(postedWaiting.bay, 2);
assert.equal(disabledStable.stableLabel, 'Stable 3');
assert.equal(disabledStable.bay, 3);

assert.deepEqual(
  {
    mode: postedActive.mode,
    postingBuildingId: postedActive.postingBuildingId,
    postingLabel: postedActive.postingLabel,
    activity: postedActive.activity,
    activityBuildingId: postedActive.activityBuildingId,
    activityLabel: postedActive.activityLabel,
  },
  {
    mode: 'posted',
    postingBuildingId: 'lumber',
    postingLabel: 'Lumber mill',
    activity: 'assisting',
    activityBuildingId: 'lumber',
    activityLabel: 'Assisting Lumber mill',
  },
  'a posted ox claims its permanent workplace before an earlier automatic ox',
);
assert.deepEqual(
  {
    mode: autoAssist.mode,
    activity: autoAssist.activity,
    activityBuildingId: autoAssist.activityBuildingId,
    activityLabel: autoAssist.activityLabel,
  },
  {
    mode: 'automatic',
    activity: 'assisting',
    activityBuildingId: 'quarry',
    activityLabel: 'Assisting Mining Pit',
  },
  'the automatic ox falls back to the next open useful worker slot',
);

assert.deepEqual(
  {
    mode: autoHaul.mode,
    activity: autoHaul.activity,
    activityBuildingId: autoHaul.activityBuildingId,
    activityLabel: autoHaul.activityLabel,
  },
  {
    mode: 'automatic',
    activity: 'hauling',
    activityBuildingId: 'storehouse',
    activityLabel: 'Hauling timber from Storehouse',
  },
  'the authoritative DeliveryTrip ox reservation wins over derived production assistance',
);

assert.deepEqual(
  {
    mode: postedWaiting.mode,
    postingLabel: postedWaiting.postingLabel,
    activity: postedWaiting.activity,
    activityBuildingId: postedWaiting.activityBuildingId,
    activityLabel: postedWaiting.activityLabel,
  },
  {
    mode: 'posted',
    postingLabel: 'Carpenter and wheelwright',
    activity: 'waiting',
    activityBuildingId: 'carpenter',
    activityLabel: 'Waiting for useful work at Carpenter and wheelwright',
  },
  'a posted ox waits for its own crew instead of joining the automatic pool',
);

assert.deepEqual(
  {
    mode: disabledStable.mode,
    activity: disabledStable.activity,
    activityBuildingId: disabledStable.activityBuildingId,
    activityLabel: disabledStable.activityLabel,
  },
  {
    mode: 'automatic',
    activity: 'waiting',
    activityBuildingId: 'stable-c',
    activityLabel: 'Waiting — Stable 3 is unavailable',
  },
  'an ox housed in a fire-disabled stable is waiting, not described as idle or available',
);

const movedTripView = buildSettlementAnimalsView(
  oxen,
  buildings,
  [{ ...haulingTrip, x: 14, progress: 0.8 }],
  new Set(['stable-c']),
);
assert.equal(
  movedTripView.signature,
  view.signature,
  'cart movement alone does not invalidate the semantic Animals HUD roster',
);

console.log('stable ox Animals view-model tests passed');
