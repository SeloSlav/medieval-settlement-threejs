import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  FOUNDERS_CAMP_BENCH,
  FOUNDERS_CAMP_BENCH_SEATS,
  FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT,
  FOUNDERS_CAMP_SEAT_LANDMARKS,
  FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT,
  FOUNDERS_CAMP_WORKYARD_STUMP_SEAT,
  FOUNDERS_CAMPFIRE_POSITION,
} from '../src/buildings/foundersCampLandmarks.ts';
import { createFoundersCampMesh } from '../src/buildings/meshes/foundersCampMesh.ts';
import { planFoundersCampAmbientBehaviors } from '../src/settlement/foundersCampBehaviors.ts';

const camp = createFoundersCampMesh();
const bench = camp.getObjectByName('Camp fireside bench');
const seat = camp.getObjectByName('Camp bench seat') as THREE.Mesh<THREE.BoxGeometry> | undefined;
const legs = camp.getObjectsByProperty('name', 'Camp bench leg') as THREE.Mesh<THREE.BoxGeometry>[];
assert.ok(bench);
assert.ok(seat);
assert.equal(camp.getObjectsByProperty('name', 'Camp fireside bench').length, 1);
assert.equal(camp.getObjectsByProperty('name', 'Camp bench seat').length, 1);
assert.equal(camp.getObjectByName('Camp cook preparation board'), undefined);
assert.deepEqual({ x: bench.position.x, z: bench.position.z }, FOUNDERS_CAMP_BENCH.center);
assert.ok(Math.abs(bench.rotation.y - Math.PI * 0.5) < 1e-9);
assert.equal(seat.parent, bench);
assert.equal(seat.geometry.parameters.width, FOUNDERS_CAMP_BENCH.length);
assert.equal(seat.geometry.parameters.depth, FOUNDERS_CAMP_BENCH.depth);
assert.equal(legs.length, 2);

const benchSeatBottom = seat.position.y - seat.geometry.parameters.height / 2;
for (const [index, leg] of legs.entries()) {
  assert.equal(leg.parent, bench);
  assert.ok(Math.abs(leg.position.x - FOUNDERS_CAMP_BENCH.legOffsets[index]!) < 1e-9);
  assert.ok(Math.abs(
    leg.position.y + leg.geometry.parameters.height / 2 - benchSeatBottom,
  ) < 1e-9);
}

assert.equal(FOUNDERS_CAMP_BENCH_SEATS.length, 3);
const yAxis = new THREE.Vector3(0, 1, 0);
const benchLocalSupports = FOUNDERS_CAMP_BENCH_SEATS.map((landmark) => (
  new THREE.Vector3(
    landmark.supportPosition.x - FOUNDERS_CAMP_BENCH.center.x,
    0,
    landmark.supportPosition.z - FOUNDERS_CAMP_BENCH.center.z,
  ).applyAxisAngle(yAxis, -FOUNDERS_CAMP_BENCH.yaw)
));
for (const [index, landmark] of FOUNDERS_CAMP_BENCH_SEATS.entries()) {
  const supportLocal = benchLocalSupports[index]!;
  const destinationLocal = new THREE.Vector3(
    landmark.destination.x - FOUNDERS_CAMP_BENCH.center.x,
    0,
    landmark.destination.z - FOUNDERS_CAMP_BENCH.center.z,
  ).applyAxisAngle(yAxis, -FOUNDERS_CAMP_BENCH.yaw);
  assert.ok(Math.abs(supportLocal.x) <= FOUNDERS_CAMP_BENCH.length / 2 - 0.3);
  assert.ok(Math.abs(supportLocal.z) < 1e-9);
  assert.ok(destinationLocal.z > FOUNDERS_CAMP_BENCH.depth / 2);
  assert.deepEqual(landmark.lookAt, FOUNDERS_CAMPFIRE_POSITION);
  assert.equal(landmark.surfaceHeight, FOUNDERS_CAMP_SEAT_SURFACE_HEIGHT);
  if (index > 0) assert.ok(supportLocal.distanceTo(benchLocalSupports[index - 1]!) >= 0.7);
}

const physicalStumps = [
  [FOUNDERS_CAMP_FIRESIDE_STUMP_SEAT, 'Camp fireside stump seat'],
  [FOUNDERS_CAMP_WORKYARD_STUMP_SEAT, 'Camp workyard stump seat'],
] as const;
for (const [landmark, name] of physicalStumps) {
  const stump = camp.getObjectByName(name);
  const top = camp.getObjectByName(`${name} top`) as THREE.Mesh<THREE.CylinderGeometry> | undefined;
  assert.ok(stump);
  assert.ok(top);
  assert.deepEqual({ x: stump.position.x, z: stump.position.z }, landmark.supportPosition);
  assert.ok(Math.abs(
    top.position.y + top.geometry.parameters.height / 2 - landmark.surfaceHeight,
  ) < 1e-9);
}

assert.equal(FOUNDERS_CAMP_SEAT_LANDMARKS.length, 5);
assert.equal(new Set(FOUNDERS_CAMP_SEAT_LANDMARKS.map(({ id }) => id)).size, 5);
const assignments = planFoundersCampAmbientBehaviors(
  { x: 0, z: 0, yaw: 0 },
  Array.from({ length: 7 }, (_, index) => `founder-${index}`),
  0,
);
const seated = [...assignments.values()].filter(
  ({ kind }) => kind === 'sit' || kind === 'rest',
);
assert.equal(seated.length, FOUNDERS_CAMP_SEAT_LANDMARKS.length);
assert.equal(new Set(seated.map(({ seatId }) => seatId)).size, seated.length);

const compiled = createBuildingMesh('founders_camp');
const visibleTriangles = compiled.userData.proceduralArchitectureMetrics.visibleTriangles as number;
assert.ok(visibleTriangles <= 18_000);

console.log(
  `founders camp seating passed (1 rotated bench, 3 bench seats, 2 stump seats, `
  + `${visibleTriangles}/18000 visible triangles)`,
);
