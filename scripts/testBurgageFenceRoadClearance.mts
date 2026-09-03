import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BurgageFencing } from '../src/residences/BurgageFencing.ts';
import { createBurgageFenceRoadClipper } from '../src/residences/burgageFenceRoadClearance.ts';
import { BURGAGE_ROAD_SETBACK } from '../src/residences/burgageFrontagePath.ts';
import { layoutFromBurgageZone } from '../src/residences/burgageZoneLayout.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type { BurgageZoneState } from '../src/resources/types.ts';
import type { Point2 } from '../src/utils/polygonGeometry.ts';

function testAnalyticRoadClipping(): void {
  for (const yaw of [0, 0.37, Math.PI / 2, Math.PI, -1.1]) {
    const transform = (x: number, z: number): Point2 => ({
      x: 170 + x * Math.cos(yaw) - z * Math.sin(yaw),
      z: -230 + x * Math.sin(yaw) + z * Math.cos(yaw),
    });
    const a = transform(-20, 0);
    const b = transform(20, 0);
    const roads = new RoadNetwork();
    roads.addRoadPath([new THREE.Vector3(a.x, 0, a.z), new THREE.Vector3(b.x, 0, b.z)]);
    const clipper = createBurgageFenceRoadClipper(roads);
    const radius = 2.1 + BURGAGE_ROAD_SETBACK;
    const frontage = [transform(-12, radius), transform(12, radius)] as const;
    assert.deepEqual(clipper.clip(frontage), [frontage], 'already snapped frontage must not lose rails');
    assert.equal(clipper.isClear(frontage), true, 'valid frontage gates must remain intact');
    assert.deepEqual(clipper.clip([transform(-12, 0), transform(12, 0)]), [], 'a fence along the road must be removed');

    for (const x of [0, 21]) {
      const segment = [transform(x, -10), transform(x, 10)] as const;
      const clipped = clipper.clip(segment);
      assert.equal(clipped.length, 2, 'crossing runs need a gap even when both endpoints are outside');
      const halfGap = x === 0 ? radius : Math.sqrt(radius ** 2 - 1);
      const expected = [
        [segment[0], transform(x, -halfGap)],
        [transform(x, halfGap), segment[1]],
      ];
      clipped.forEach((run, runIndex) => run.forEach((point, pointIndex) => {
        const target = expected[runIndex][pointIndex];
        assert.ok(Math.hypot(point.x - target.x, point.z - target.z) < 1e-6, 'trim exactly to the verge, including rounded road ends');
      }));
      const reversed = clipper.clip([segment[1], segment[0]]);
      assert.deepEqual(reversed.map((run) => run.map((point) => [point.x.toFixed(5), point.z.toFixed(5)])),
        clipped.slice().reverse().map((run) => run.slice().reverse().map((point) => [point.x.toFixed(5), point.z.toFixed(5)])),
        'clipping must not depend on frontage drawing direction');
    }
  }
}

function testRoadClearanceProductionWiring(): void {
  const bootstrap = readFileSync(new URL('../src/app/appBootstrap.ts', import.meta.url), 'utf8');
  assert.match(bootstrap, /new BurgageFencing\(sceneManager\.selectionGroup, roadNetwork\)/);
  const roadEditCallback = bootstrap.slice(bootstrap.indexOf('onNetworkChanged: (change) => {'));
  const fenceSync = roadEditCallback.indexOf('burgageFencing.syncZones(');
  assert.ok(fenceSync >= 0 && fenceSync < roadEditCallback.indexOf('spacetimeStore.queueRoadSync('),
    'local road edits must rebuild fences immediately, before waiting for server hydration');
}

function assertFenceMeshesClearRoads(parent: THREE.Group, roads: RoadNetwork): number {
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  let count = 0;
  for (const name of ['Fence posts', 'Fence rails', 'Frontage gate frames']) {
    const mesh = parent.getObjectByName(name) as THREE.InstancedMesh;
    assert.ok(mesh, `${name} must exist`);
    count += mesh.count;
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      // Check the entire timber, not just its center: long rails can cross a
      // road even when both ends are clear, and gate lintels have overhangs.
      for (const x of [-0.5, 0, 0.5]) {
        for (const y of [-0.5, 0, 0.5]) {
          for (let step = 0; step <= 24; step++) {
            point.set(x, y, step / 24 - 0.5).applyMatrix4(matrix);
            assert.equal(
              roads.getSpatialIndex().isOnRoadSurface(point.x, point.z, 0),
              false,
              `${name}[${index}] overlaps the road at (${point.x}, ${point.z})`,
            );
          }
        }
      }
    }
  }
  return count;
}

function zone(frontZ: number, rearZ: number): BurgageZoneState {
  return {
    id: 'roadside-zone',
    cornerA: { x: -24, z: frontZ },
    cornerB: { x: 24, z: frontZ },
    cornerC: { x: 24, z: rearZ },
    cornerD: { x: -24, z: rearZ },
    frontageEdge: 0,
    plotCount: 4,
  };
}

function residencesFor(plot: BurgageZoneState) {
  const layout = layoutFromBurgageZone(plot);
  assert.ok(layout);
  return layout.residences.map((placement) => ({
    ...placement,
    id: `residence-${placement.parcelIndex}`,
    zoneId: plot.id,
    tier: 2, // Exercise framed gateways as well as ordinary rails/posts.
  }));
}

function testConstructedFencesClearRoads(): void {
  for (const side of [-1, 1]) {
    const roads = new RoadNetwork();
    roads.addRoadPath([new THREE.Vector3(-40, 0, 0), new THREE.Vector3(40, 0, 0)]);
    // Saved corner reconstruction can put frontage inside the road. Every
    // divider must stop before the road, not merely hide the front rails.
    const plot = zone(0, side * 24);
    const residences = residencesFor(plot);
    const parent = new THREE.Group();
    const fencing = new BurgageFencing(parent, roads);
    fencing.syncZones([plot], [], () => 0);
    assert.equal(assertFenceMeshesClearRoads(parent, roads), 0, 'unoccupied lots must remain unfenced');
    fencing.syncZones([plot], residences, (x, z) => x * 0.02 + z * 0.03);
    assert.ok(assertFenceMeshesClearRoads(parent, roads) > 0, 'keep the clear side and rear fencing');
    const gates = parent.getObjectByName('Frontage gate frames') as THREE.InstancedMesh;
    assert.equal(gates.count, 0, 'a gate frame must not bridge a road-cleared gap');
    fencing.dispose();
  }
}

function testCurvedAndChangedRoads(): void {
  const roads = new RoadNetwork();
  roads.addRoadPath([
    new THREE.Vector3(-40, 0, 0),
    new THREE.Vector3(0, 0, 7),
    new THREE.Vector3(40, 0, 0),
  ]);
  const plot = zone(5.5, 32);
  const residences = residencesFor(plot);
  const parent = new THREE.Group();
  const fencing = new BurgageFencing(parent, roads);
  fencing.syncZones([plot], residences, () => 0);
  assert.ok(assertFenceMeshesClearRoads(parent, roads) > 0, 'curved roads must retain clear fence runs');

  // A crossing road is added after construction. Both ends of the rear fence
  // are outside it, so endpoint-only checks would miss the overlap.
  roads.addRoadPath([new THREE.Vector3(3, 0, -20), new THREE.Vector3(3, 0, 45)], 6);
  fencing.syncZones([plot], residences, () => 0);
  assert.ok(assertFenceMeshesClearRoads(parent, roads) > 0);
  const rails = parent.getObjectByName('Fence rails') as THREE.InstancedMesh;
  const version = rails.instanceMatrix.version;
  fencing.syncZones([plot], residences, () => 0);
  assert.equal(rails.instanceMatrix.version, version, 'unchanged road-aware fencing should retain the no-op sync');

  // Hydration restores the same network object; clearance must not retain its
  // old spatial index or old widths.
  roads.restore(new RoadNetwork().snapshot());
  fencing.syncZones([plot], residences, () => 0);
  assert.ok(rails.instanceMatrix.version > version, 'road removal must rebuild the released fence runs');
  const gates = parent.getObjectByName('Frontage gate frames') as THREE.InstancedMesh;
  assert.equal(gates.count, residences.length * 3, 'clear gateways should retain their complete frames');
  fencing.dispose();
}

testAnalyticRoadClipping();
testRoadClearanceProductionWiring();
testConstructedFencesClearRoads();
testCurvedAndChangedRoads();
console.log('Burgage fence road-clearance regression tests passed.');
