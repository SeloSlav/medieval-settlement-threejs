import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  OX_SUPPORTED_WORKPLACE_KINDS,
  assignStableOxen,
  oxWorkplaceCapacity,
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
assert.equal(oxWorkplaceCapacity('reforester'), 1);
assert.equal(oxWorkplaceCapacity('carpenter'), 2);
assert.equal(oxWorkplaceCapacity('threshing_barn'), 3);
assert.equal(oxWorkplaceCapacity('granary'), 1);
assert.equal(oxWorkplaceCapacity('smithy'), 0);

const cappedFarmBuildings = new Map<string, any>([
  ['building-11', building('building-11', 'stable', 0, 0, 0)],
  ['building-12', building('building-12', 'stable', 2, 0, 0)],
  ['building-20', building('building-20', 'threshing_barn', 8, 0, 8)],
]);
const cappedFarmOxen = Array.from({ length: 5 }, (_, index) => ({
  id: `stable-ox-${index + 20}`,
  stableId: index < 3 ? 'building-11' : 'building-12',
  slot: index < 3 ? index : index - 3,
}));
assert.equal(
  assignStableOxen(cappedFarmOxen, cappedFarmBuildings).size,
  3,
  'automatic assistance must never activate more than three oxen at a large farmstead',
);
assert.equal(
  assignStableOxen(
    cappedFarmOxen.map((ox) => ({ ...ox, assignedBuildingId: 'building-20' })),
    cappedFarmBuildings,
  ).size,
  3,
  'over-cap legacy postings remain persisted but only three teams may work',
);

const oneFarmerBuildings = new Map(cappedFarmBuildings);
oneFarmerBuildings.set('building-20', building('building-20', 'threshing_barn', 8, 0, 1));
assert.equal(
  assignStableOxen(
    cappedFarmOxen.slice(0, 3).map((ox) => ({ ...ox, assignedBuildingId: 'building-20' })),
    oneFarmerBuildings,
  ).size,
  1,
  'three separately posted oxen with one present farmer produce one active team and two waiting oxen',
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

const numericTieBuildings = new Map<string, any>([
  ['building-1', building('building-1', 'stable', 0, 0, 0)],
  ['building-2', building('building-2', 'lumber_mill', -8, 0, 1)],
  ['building-10', building('building-10', 'stone_quarry', 8, 0, 1)],
]);
assert.equal(
  assignStableOxen([oxen[0]], numericTieBuildings).get('stable-ox-1')?.buildingId,
  'building-2',
  'equal-distance automatic work follows the server numeric building-id tie-break',
);

const numericOxOrderBuildings = new Map<string, any>([
  ['building-2', building('building-2', 'stable', 0, 0, 0)],
  ['building-10', building('building-10', 'stable', 2, 0, 0)],
  ['building-20', building('building-20', 'lumber_mill', 5, 0, 1)],
]);
const numericOxOrder = assignStableOxen([
  { id: 'stable-ox-10', stableId: 'building-10', slot: 0, assignedBuildingId: 'building-20' },
  { id: 'stable-ox-2', stableId: 'building-2', slot: 0, assignedBuildingId: 'building-20' },
], numericOxOrderBuildings);
assert.ok(
  numericOxOrder.has('stable-ox-2') && !numericOxOrder.has('stable-ox-10'),
  'oversubscribed postings choose the same numeric stable/bay/ox order as the server',
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
assert.match(
  renderer,
  /pickOx\([\s\S]{0,900}projectedOxHitDistance/,
  'every rendered ox should expose the same screen-space picking behavior as agents',
);
assert.match(
  renderer,
  /inspectionRoute\([\s\S]{0,1_600}getDeliveryRoute[\s\S]{0,800}getWorkerRoute/,
  'selected oxen should inherit their live cart or worker route',
);
assert.match(
  renderer,
  /SELECTED_AGENT_ROUTE_Y_OFFSET/,
  'ox routes should use the shared pink selected-agent line height',
);

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

const villagerInspector = readFileSync('src/ui/VillagerInspector.ts', 'utf8');
assert.match(
  villagerInspector,
  /this\.options\.villagers\.pickOx\([\s\S]{0,900}this\.renderOx\(ox\)/,
  'clicking an ox should open the shared agent card',
);
assert.match(
  villagerInspector,
  /renderOx\(inspection: OxInspection\)[\s\S]{0,1_800}updateSelectedAgentRoute/,
  'the ox card should update the shared marker and pink route on every frame',
);
assert.match(
  villagerInspector,
  /selectedOxId[\s\S]{0,1_800}inspectOx\(this\.selectedOxId\)/,
  'ox selection should remain live until the ox disappears or selection is dismissed',
);

console.log('stable ox posted + automatic allocation and visual contracts passed');
