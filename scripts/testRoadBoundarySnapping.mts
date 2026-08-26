import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ROAD_BOUNDARY_CENTERLINE_OFFSET,
  buildRoadBoundaryToRoadPath,
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
const oppositeRoute = buildRoadBoundaryPath(south, north);
assert(oppositeRoute, 'opposite edges should follow the shorter outside perimeter');

// Screenshot regression: clicking near both rear corners often classifies the
// two anchors against the opposing side edges. The route must still recognize
// that the rear perimeter is much shorter than the frontage-side alternative.
const westNearSouth = findRoadBoundarySnap({ x: -0.4, z: 2 }, [zone]);
const eastNearSouth = findRoadBoundarySnap({ x: 40.4, z: 2 }, [zone]);
assert(westNearSouth);
assert(eastNearSouth);
assert.equal(westNearSouth.edgeIndex, 3);
assert.equal(eastNearSouth.edgeIndex, 1);
const rearWrap = buildRoadBoundaryPath(westNearSouth, eastNearSouth);
assert(rearWrap);
assert(
  rearWrap.some((point) => Math.abs(point.x - 20) < 2.2 && Math.abs(point.z + offset) < 1e-9),
  'opposing side snaps near the rear must route along the rear boundary rail',
);

const sampledRearWrap = new THREE.CatmullRomCurve3(
  rearWrap.map((point) => new THREE.Vector3(point.x, 0, point.z)),
  false,
  'centripetal',
  0.45,
);
for (let index = 0; index <= 320; index += 1) {
  const point = sampledRearWrap.getPoint(index / 320);
  if (point.x < 5 || point.x > 35) continue;
  assert(
    Math.abs(point.z + offset) < 0.08,
    `the sampled rear run bowed away from its rail at ${point.x}, ${point.z}`,
  );
}

// Boundary-to-road regression: a node on the road-facing side must not pull a
// free diagonal across the residence block. Follow the parallel side rail and
// make only the short final handoff into the existing road node.
const northWest = findRoadBoundarySnap({ x: 4, z: 20.4 }, [zone]);
assert(northWest);
const eastRoadNode = {
  point: { x: 45, z: 7 },
  tangents: [{ x: 0, z: 1 }],
};
const roadHandoff = buildRoadBoundaryToRoadPath(northWest, eastRoadNode);
assert(roadHandoff);
assert(
  roadHandoff.some((point) => (
    Math.abs(point.x - (40 + offset)) < 1e-9
    && point.z > 10
    && point.z < 19
  )),
  'the road handoff should turn onto the residence side parallel to the road',
);
assert.deepEqual(roadHandoff.at(-1), eastRoadNode.point);
const firstEastRailIndex = roadHandoff.findIndex((point) => (
  Math.abs(point.x - (40 + offset)) < 1e-9
));
assert(firstEastRailIndex > 0);
assert(
  roadHandoff.slice(0, firstEastRailIndex).every((point) => point.z >= 20 - 1e-9),
  'the approach should stay on the north residence border before the right-angle turn',
);
const sampledRoadHandoff = new THREE.CatmullRomCurve3(
  roadHandoff.map((point) => new THREE.Vector3(point.x, 0, point.z)),
  false,
  'centripetal',
  0.45,
);
for (let index = 0; index <= 320; index += 1) {
  const point = sampledRoadHandoff.getPoint(index / 320);
  if (point.x >= 6 && point.x <= 34) {
    assert(point.z >= 21.95, 'the sampled handoff cut diagonally across the residence block');
  }
  if (point.z >= 9 && point.z <= 17) {
    assert(point.x >= 41.95, 'the sampled handoff left the road-parallel side rail');
  }
}

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
