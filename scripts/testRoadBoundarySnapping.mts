import assert from 'node:assert/strict';
import {
  ROAD_BOUNDARY_CENTERLINE_OFFSET,
  buildRoadBoundaryPath,
  findRoadBoundarySnap,
} from '../src/roads/RoadBoundarySnap.ts';
import type { BurgageZoneState } from '../src/resources/types.ts';

const zone = makeZone('row', [
  { x: 0, z: 0 },
  { x: 40, z: 0 },
  { x: 40, z: 20 },
  { x: 0, z: 20 },
]);
const offset = ROAD_BOUNDARY_CENTERLINE_OFFSET;

const south = findRoadBoundarySnap({ x: 13, z: -0.4 }, [zone]);
assert(south);
assert.equal(south.edgeIndex, 0);
assertAlmostEqual(south.point.x, 13);
assertAlmostEqual(south.point.z, -offset);

const east = findRoadBoundarySnap({ x: 40.7, z: 12 }, [zone]);
assert(east);
assert.equal(east.edgeIndex, 1);
assertAlmostEqual(east.point.x, 40 + offset);
assertAlmostEqual(east.point.z, 12);

const straightEnd = findRoadBoundarySnap({ x: 31, z: -1 }, [zone]);
assert(straightEnd);
const straight = buildRoadBoundaryPath(south, straightEnd);
assert(straight);
assert(straight.length > 2, 'long boundary runs should gain spline supports');
assert(straight.every((point) => Math.abs(point.z + offset) < 1e-9));

const turn = buildRoadBoundaryPath(south, east);
assert(turn);
assert(turn.length > straight.length, 'adjacent edges should include a rounded corner transition');
const southTangentIndex = turn.findIndex((point) => (
  Math.abs(point.x - 40) < 1e-9 && Math.abs(point.z + offset) < 1e-9
));
const eastTangentIndex = turn.findIndex((point) => (
  Math.abs(point.x - (40 + offset)) < 1e-9 && Math.abs(point.z) < 1e-9
));
assert(southTangentIndex >= 0);
assert(eastTangentIndex > southTangentIndex);
for (const point of turn.slice(southTangentIndex, eastTangentIndex + 1)) {
  assertAlmostEqual(
    Math.hypot(point.x - 40, point.z),
    offset,
    'corner controls should keep constant clearance from the plot corner',
  );
}

const north = findRoadBoundarySnap({ x: 20, z: 20.3 }, [zone]);
assert(north);
assert.equal(buildRoadBoundaryPath(south, north), null, 'opposite edges should not choose a route for the player');

const clockwiseZone = makeZone('clockwise', [
  { x: 0, z: 0 },
  { x: 0, z: 20 },
  { x: 40, z: 20 },
  { x: 40, z: 0 },
]);
const clockwiseSouth = findRoadBoundarySnap({ x: 13, z: -0.4 }, [clockwiseZone]);
assert(clockwiseSouth);
assertAlmostEqual(clockwiseSouth.point.z, -offset, 'clockwise zones should still offset outward');

const adjoining = makeZone('adjoining', [
  { x: 40, z: 0 },
  { x: 60, z: 0 },
  { x: 60, z: 20 },
  { x: 40, z: 20 },
]);
assert.equal(
  findRoadBoundarySnap({ x: 40, z: 10 }, [zone, adjoining]),
  null,
  'a shared residence-zone seam must not become a road rail',
);

assert.equal(
  findRoadBoundarySnap({ x: 20, z: -20 }, [zone]),
  null,
  'distant cursor positions should remain unsnapped',
);

console.log('Road boundary snapping tests passed.');

function makeZone(
  id: string,
  corners: readonly [
    { x: number; z: number },
    { x: number; z: number },
    { x: number; z: number },
    { x: number; z: number },
  ],
): BurgageZoneState {
  return {
    id,
    cornerA: corners[0],
    cornerB: corners[1],
    cornerC: corners[2],
    cornerD: corners[3],
    frontageEdge: 0,
    plotCount: 5,
  };
}

function assertAlmostEqual(actual: number, expected: number, message = 'values should match'): void {
  assert(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} !== ${expected}`);
}
