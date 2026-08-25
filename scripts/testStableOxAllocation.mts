import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OX_SUPPORTED_WORKPLACE_KINDS,
  assignStableOxen,
  stableOxRestPose,
} from '../src/settlement/stableOxen.ts';

const building = (
  id: string,
  kind: string,
  x: number,
  z: number,
  assignedLabor: number,
) => ({
  id,
  kind,
  x,
  z,
  assignedLabor,
  constructionComplete: true,
});

const buildings = new Map<string, any>([
  ['building-1', building('building-1', 'stable', 0, 0, 0)],
  ['building-2', building('building-2', 'lumber_mill', 8, 0, 3)],
  ['building-3', building('building-3', 'stone_quarry', 24, 0, 2)],
  ['building-4', building('building-4', 'smithy', 2, 0, 4)],
  ['building-5', building('building-5', 'village_storehouse', 1, 0, 4)],
]);
const oxen = [0, 1, 2].map((slot) => ({
  id: `stable-ox-${slot + 1}`,
  stableId: 'building-1',
  slot,
}));

const assignments = assignStableOxen(oxen, buildings);
assert.equal(assignments.size, 3);
assert.deepEqual(
  [...assignments.values()].map((assignment) => [
    assignment.buildingId,
    assignment.workerSlot,
  ]),
  [
    ['building-2', 0],
    ['building-2', 1],
    ['building-2', 2],
  ],
  'nearest eligible workplace fills one distinct worker slot per ox',
);
assert.ok(!OX_SUPPORTED_WORKPLACE_KINDS.includes('smithy' as never));
assert.ok(
  [...assignments.values()].every((assignment) => assignment.buildingId !== 'building-5'),
  'logistics-only buildings reserve oxen through active cart trips, not idle worker slots',
);

const hybridOxen = [
  { ...oxen[0], assignedBuildingId: 'building-3' },
  { ...oxen[1], assignedBuildingId: null },
  { ...oxen[2], assignedBuildingId: null },
];
const hybridAssignments = assignStableOxen(hybridOxen, buildings);
assert.deepEqual(
  [...hybridAssignments.values()].map((assignment) => [
    assignment.oxId,
    assignment.buildingId,
    assignment.workerSlot,
  ]),
  [
    ['stable-ox-1', 'building-3', 0],
    ['stable-ox-2', 'building-2', 0],
    ['stable-ox-3', 'building-2', 1],
  ],
  'posted oxen claim their permanent workplace before the automatic pool chooses open work',
);

const unavailablePosting = assignStableOxen([
  { ...oxen[0], assignedBuildingId: 'building-4' },
  { ...oxen[1], assignedBuildingId: null },
], buildings);
assert.ok(
  !unavailablePosting.has('stable-ox-1'),
  'a posted ox waits instead of automatically helping elsewhere when its posting is ineligible',
);
assert.equal(
  unavailablePosting.get('stable-ox-2')?.buildingId,
  'building-2',
  'unposted oxen continue through automatic assistance when a posted animal waits',
);

const trip = {
  id: 'trip-1',
  buildingId: 'building-2',
  laborBuildingId: 'building-2',
  deliveryWorkers: 1,
  freeHaulerWorkers: 0,
  oxId: 'stable-ox-1',
};
const withReservedTrip = assignStableOxen(oxen, buildings, [trip] as any[]);
assert.ok(!withReservedTrip.has('stable-ox-1'), 'cart-reserved ox is unavailable to production');
assert.deepEqual(
  [...withReservedTrip.values()].map((assignment) => assignment.workerSlot),
  [0, 1],
  'the away human and reserved ox are removed before on-site pairing',
);

const restPoses = oxen.map((ox) => stableOxRestPose(
  buildings.get('building-1'),
  ox.slot,
  null,
));
assert.ok(Math.abs(Math.hypot(
  restPoses[1].x - restPoses[0].x,
  restPoses[1].z - restPoses[0].z,
) - 3) < 1e-6);
assert.ok(Math.abs(Math.hypot(
  restPoses[2].x - restPoses[1].x,
  restPoses[2].z - restPoses[1].z,
) - 3) < 1e-6);

const renderer = readFileSync('src/settlement/OxenRenderer.ts', 'utf8');
assert.match(renderer, /quaternius-bull\.glb/);
assert.match(renderer, /idle[^\n]*eat[^\n]*walk|idle\/eating\/walk/);
assert.match(renderer, /getWorkerPose/);
assert.match(renderer, /getDeliveryPose/);
assert.match(renderer, /Draft ox oak yoke/);

const villagerRenderer = readFileSync('src/settlement/VillagerRenderer.ts', 'utf8');
assert.match(
  villagerRenderer,
  /const deliveryTrips = \[\.\.\.\(options\.deliveryTrips \?\? \[\]\)\];/,
  'human rosters and ox reservations must share one replayable delivery-trip snapshot',
);
assert.match(
  villagerRenderer,
  /rosteredCartWorkersByBuilding\([\s\S]{0,160}deliveryTrips,/,
);
assert.match(
  villagerRenderer,
  /this\.oxen\.sync\([\s\S]{0,260}deliveryTrips,/,
);

console.log('stable ox posted + automatic allocation and visual contracts passed');
