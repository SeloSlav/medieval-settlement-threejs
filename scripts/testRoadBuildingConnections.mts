import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  BuildingRoadConnections,
  getBuildingRoadConnectionPoints,
  markerRevealOpacity,
} from '../src/roads/BuildingRoadConnections.ts';
import {
  BuildingAccessSpurs,
  planBuildingAccessSpurs,
} from '../src/roads/BuildingAccessSpurs.ts';
import { getBuildingFootprintHalfExtents } from '../src/buildings/BuildingTerrainLayout.ts';
import {
  BUILDING_ACCESS_SPUR_WIDTH,
  ROAD_WIDTH,
  roadVisualWidth,
} from '../src/roads/roadDimensions.ts';
import { hasRoadAccess } from '../src/roads/roadConnectivity.ts';
import { RoadMeshBuilder } from '../src/roads/RoadMeshBuilder.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import { RoadPreview } from '../src/roads/RoadPreview.ts';
import {
  isWorldInspectionBlocked,
  isWorldResourceIconVisibilityBlocked,
  type PlacementInteractionGate,
} from '../src/input/PlacementInteractionGate.ts';

const flatTerrain = {
  getPointAt: (x: number, z: number, offset = 0) =>
    new THREE.Vector3(x, 12 + offset, z),
};

const foundersCamp = {
  id: 'founders-camp',
  kind: 'founders_camp' as const,
  x: 20,
  z: -10,
  yaw: 0,
};
const campConnections = getBuildingRoadConnectionPoints(
  foundersCamp,
  flatTerrain,
);
assert.equal(campConnections.length, 4, 'the founders camp should expose four road connections');
assert.equal(
  new Set(campConnections.map(({ point }) => `${point.x.toFixed(3)}:${point.z.toFixed(3)}`)).size,
  4,
  'all four founders-camp road connections should be distinct',
);
assert(campConnections.every(({ point }) => point.y === 12), 'connection markers should follow terrain height');
const { halfWidth, halfDepth } = getBuildingFootprintHalfExtents(foundersCamp.kind);
const expectedPerimeterPoints = [
  [foundersCamp.x, foundersCamp.z + halfDepth],
  [foundersCamp.x + halfWidth, foundersCamp.z],
  [foundersCamp.x, foundersCamp.z - halfDepth],
  [foundersCamp.x - halfWidth, foundersCamp.z],
] as const;
for (const [x, z] of expectedPerimeterPoints) {
  assert(
    campConnections.some(({ point }) =>
      Math.abs(point.x - x) < 1e-9 && Math.abs(point.z - z) < 1e-9
    ),
    'each connection should sit on the midpoint of the true footprint perimeter',
  );
}

const accessNetwork = new RoadNetwork();
accessNetwork.addRoadPath([
  new THREE.Vector3(-30, 12, 0),
  new THREE.Vector3(30, 12, 0),
]);
const connectedWell = {
  id: 'connected-well',
  kind: 'well' as const,
  x: 0,
  z: 15,
  yaw: 0,
};
const disconnectedWell = {
  ...connectedWell,
  id: 'disconnected-well',
  z: 20.01,
};
assert(hasRoadAccess(connectedWell.x, connectedWell.z, accessNetwork));
assert(!hasRoadAccess(disconnectedWell.x, disconnectedWell.z, accessNetwork));
const accessPlans = planBuildingAccessSpurs(
  [connectedWell, disconnectedWell],
  flatTerrain,
  accessNetwork,
);
assert.equal(
  accessPlans.length,
  1,
  'only buildings accepted by the existing logical road-access rule should receive a spur',
);
const wellPlan = accessPlans[0];
assert.equal(wellPlan.buildingId, connectedWell.id);
assert(Math.abs(wellPlan.centerRoadDistance - 15) < 1e-9);
assert.equal(wellPlan.roadPoint.z, 0, 'the spur should terminate at the nearest road centerline');
assert(
  wellPlan.connection.point.z < connectedWell.z,
  'the spur should start at the footprint anchor facing the road',
);
assert.equal(wellPlan.visualWidth, BUILDING_ACCESS_SPUR_WIDTH);
assert(
  BUILDING_ACCESS_SPUR_WIDTH < roadVisualWidth(ROAD_WIDTH) * 0.5,
  'building access spurs should remain distinctly slimmer than the main road',
);

const spurRoadMaterial = new THREE.MeshBasicMaterial();
const spurBlendMaterial = new THREE.MeshBasicMaterial({ transparent: true });
const spurTerrain = {
  ...flatTerrain,
  getHeightAt: () => 12,
};
const spurParent = new THREE.Group();
const spurBuilder = new RoadMeshBuilder(
  spurTerrain as never,
  { road: spurRoadMaterial, roadEdge: spurBlendMaterial } as never,
);
const accessSpurs = new BuildingAccessSpurs({
  parent: spurParent,
  terrain: spurTerrain as never,
  meshBuilder: spurBuilder,
});
accessSpurs.sync([connectedWell, disconnectedWell], accessNetwork);
assert.equal(accessSpurs.group.children.length, 1);
const renderedSpur = accessSpurs.group.children[0] as THREE.Group;
assert.equal(renderedSpur.userData.buildingId, connectedWell.id);
assert.equal(renderedSpur.userData.connectionId, wellPlan.connection.id);
assert.deepEqual(renderedSpur.userData.roadPoint, wellPlan.roadPoint.toArray());
assert.deepEqual(renderedSpur.userData.buildingPoint, wellPlan.connection.point.toArray());
const renderedCore = renderedSpur.getObjectByName(
  `Building access spur core ${connectedWell.id}`,
) as THREE.Mesh;
const renderedBlend = renderedSpur.getObjectByName(
  `Building access spur blend ${connectedWell.id}`,
) as THREE.Mesh;
assert(renderedCore?.geometry.getAttribute('position').count > 4);
assert(renderedBlend?.geometry.getAttribute('position').count > 12);
assert.equal(renderedCore.userData.fpNoCollision, true);
assert.equal(renderedBlend.userData.fpNoCollision, true);
accessSpurs.sync([connectedWell, disconnectedWell], accessNetwork);
assert.equal(
  accessSpurs.group.children[0],
  renderedSpur,
  'unchanged settlement snapshots should retain spur geometry instead of rebuilding it',
);
const spurY = renderedCore.geometry.getAttribute('position') as THREE.BufferAttribute;
for (let index = 0; index < spurY.count; index += 1) {
  assert(
    spurY.getY(index) < 12.11,
    'access spurs must remain below construction-ground footprints',
  );
}
accessNetwork.addRoadPath([
  new THREE.Vector3(-30, 12, 10),
  new THREE.Vector3(30, 12, 10),
]);
accessSpurs.sync([connectedWell, disconnectedWell], accessNetwork);
assert.notEqual(
  accessSpurs.group.children[0],
  renderedSpur,
  'road topology changes should rebuild building access spurs',
);
assert.equal(
  (accessSpurs.group.children[0] as THREE.Group).userData.roadPoint[2],
  10,
  'a rebuilt spur should follow the newly nearest road',
);
accessSpurs.dispose();
spurRoadMaterial.dispose();
spurBlendMaterial.dispose();

const parent = new THREE.Group();
const connections = new BuildingRoadConnections({
  parent,
  terrain: flatTerrain as never,
  getBuildings: () => [foundersCamp],
  getRoadNetwork: () => null,
});
connections.setVisible(true);
const expected = campConnections[0].point;
const snap = connections.findSnap(expected.clone().add(new THREE.Vector3(1, 0, 0)), 5.6);
assert(snap, 'a nearby road cursor should snap to a building connection');
assert(snap.point.equals(expected), 'building snapping should return the exact connection center');
const markerGroup = parent.getObjectByName('Building road connections');
assert.equal(markerGroup?.visible, true);
assert.equal(
  (markerGroup?.getObjectByName('Building road connection rings') as THREE.InstancedMesh | undefined)?.count,
  undefined,
  'no marker buffers should be allocated before a building is near the cursor',
);

const eastConnection = campConnections.find(({ point }) => point.x > foundersCamp.x);
assert(eastConnection);
connections.setCursor(eastConnection.point.clone().add(new THREE.Vector3(7, 0, 0)));
connections.update(0.1);
assert.equal(markerRevealOpacity(7, true), 1, 'the nearest marker should be fully revealed first');
assert.equal(markerRevealOpacity(10, false), 0, 'sibling markers should remain hidden farther away');

for (const markerName of [
  'Building road connection rings',
  'Building road connection posts',
]) {
  const markers = markerGroup?.getObjectByName(markerName);
  assert(markers instanceof THREE.InstancedMesh);
  assert.equal(markers.count, 1, 'only the closest node should render at the outer reveal range');
  assert(markers.material instanceof THREE.MeshBasicMaterial);
  assert.equal(markers.material.color.getHex(), 0xffffff, `${markerName} should be white`);
  assert.equal(markers.material.depthTest, false, `${markerName} should render as an overlay`);
  assert.equal(markers.material.depthWrite, false, `${markerName} must not alter scene depth`);
  const markerOpacity = markers.geometry.getAttribute('markerOpacity');
  assert(markerOpacity instanceof THREE.InstancedBufferAttribute);
  assert(markerOpacity.getX(0) > 0, `${markerName} should be fading in`);
  const shader = {
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <opaque_fragment>',
  };
  markers.material.onBeforeCompile(shader as never, {} as never);
  assert(shader.vertexShader.includes('attribute float markerOpacity;'));
  assert(shader.fragmentShader.includes('diffuseColor.a *= vMarkerOpacity;'));
}

connections.setCursor(new THREE.Vector3(foundersCamp.x, 12, foundersCamp.z));
connections.update(0.1);
assert.equal(
  (markerGroup?.getObjectByName('Building road connection rings') as THREE.InstancedMesh).count,
  4,
  'all four nodes should appear once the cursor is close to the building',
);

connections.setCursor(null);
for (let index = 0; index < 12; index += 1) connections.update(0.1);
assert.equal(
  (markerGroup?.getObjectByName('Building road connection rings') as THREE.InstancedMesh).count,
  0,
  'markers should finish fading out when the cursor moves away',
);
connections.dispose();

// Randomized parity against the allocation-heavy implementation this hot path replaced.
const parityBuildings = Array.from({ length: 24 }, (_, index) => ({
  id: `parity-${index}`,
  kind: 'founders_camp' as const,
  x: (index % 6) * 17 - 43,
  z: Math.floor(index / 6) * 19 - 31,
  yaw: (index * 0.371) % (Math.PI * 2),
}));
const parityPoints = parityBuildings.flatMap((building) =>
  getBuildingRoadConnectionPoints(building, flatTerrain)
);
const parityParent = new THREE.Group();
const parityConnections = new BuildingRoadConnections({
  parent: parityParent,
  terrain: flatTerrain as never,
  getBuildings: () => parityBuildings,
  getRoadNetwork: () => null,
});
parityConnections.setVisible(true);
const referenceOpacities = new Map<string, number>();
let randomState = 0x51f15e;
const random = (): number => {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 0x1_0000_0000;
};
const expectedMatrix = new THREE.Matrix4();
const expectedPosition = new THREE.Vector3();
const expectedScale = new THREE.Vector3();
const expectedRingRotation = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0),
);
const expectedIdentityRotation = new THREE.Quaternion();
for (let frame = 0; frame < 320; frame += 1) {
  const cursorPoint = frame % 23 === 0
    ? null
    : new THREE.Vector3(random() * 130 - 65, 12, random() * 110 - 55);
  const dt = random() * 0.14 - 0.01;
  parityConnections.setCursor(cursorPoint);
  parityConnections.update(dt);

  const nearestByBuilding = new Map<string, (typeof parityPoints)[number]>();
  if (cursorPoint) {
    for (const connection of parityPoints) {
      const nearest = nearestByBuilding.get(connection.buildingId);
      if (
        !nearest
        || Math.hypot(connection.point.x - cursorPoint.x, connection.point.z - cursorPoint.z)
          < Math.hypot(nearest.point.x - cursorPoint.x, nearest.point.z - cursorPoint.z)
      ) nearestByBuilding.set(connection.buildingId, connection);
    }
  }
  const expectedActive: Array<{ point: THREE.Vector3; opacity: number }> = [];
  const frameDt = THREE.MathUtils.clamp(dt, 0, 0.1);
  for (const connection of parityPoints) {
    const currentOpacity = referenceOpacities.get(connection.id) ?? 0;
    const targetOpacity = cursorPoint
      ? markerRevealOpacity(
        Math.hypot(connection.point.x - cursorPoint.x, connection.point.z - cursorPoint.z),
        nearestByBuilding.get(connection.buildingId) === connection,
      )
      : 0;
    const rate = targetOpacity > currentOpacity ? 13 : 9;
    const blend = 1 - Math.exp(-frameDt * rate);
    let opacity = THREE.MathUtils.lerp(currentOpacity, targetOpacity, blend);
    if (targetOpacity === 0 && opacity < 0.015) opacity = 0;
    referenceOpacities.set(connection.id, opacity);
    if (opacity >= 0.015) expectedActive.push({ point: connection.point, opacity });
  }

  const rings = parityParent.getObjectByName('Building road connection rings') as THREE.InstancedMesh | undefined;
  const posts = parityParent.getObjectByName('Building road connection posts') as THREE.InstancedMesh | undefined;
  assert.equal(rings?.count ?? 0, expectedActive.length, `ring count parity at frame ${frame}`);
  assert.equal(posts?.count ?? 0, expectedActive.length, `post count parity at frame ${frame}`);
  if (!rings || !posts) continue;
  const opacityAttribute = rings.geometry.getAttribute('markerOpacity');
  for (let index = 0; index < expectedActive.length; index += 1) {
    const expectedActiveMarker = expectedActive[index];
    assert.equal(
      opacityAttribute.getX(index),
      Math.fround(expectedActiveMarker.opacity),
      `opacity and ordering parity at frame ${frame}, instance ${index}`,
    );
    expectedScale.setScalar(0.86 + expectedActiveMarker.opacity * 0.14);
    expectedMatrix.compose(
      expectedPosition.set(
        expectedActiveMarker.point.x,
        expectedActiveMarker.point.y + 0.16,
        expectedActiveMarker.point.z,
      ),
      expectedRingRotation,
      expectedScale,
    );
    const actualMatrix = new THREE.Matrix4();
    rings.getMatrixAt(index, actualMatrix);
    for (let element = 0; element < 16; element += 1) {
      assert.equal(
        actualMatrix.elements[element],
        Math.fround(expectedMatrix.elements[element]),
        `ring transform parity at frame ${frame}, instance ${index}, element ${element}: `
          + `${actualMatrix.elements[element]} !== ${expectedMatrix.elements[element]}`,
      );
    }
    expectedMatrix.compose(
      expectedPosition.set(
        expectedActiveMarker.point.x,
        expectedActiveMarker.point.y + 0.44,
        expectedActiveMarker.point.z,
      ),
      expectedIdentityRotation,
      expectedScale,
    );
    posts.getMatrixAt(index, actualMatrix);
    for (let element = 0; element < 16; element += 1) {
      assert.equal(
        actualMatrix.elements[element],
        Math.fround(expectedMatrix.elements[element]),
        `post transform parity at frame ${frame}, instance ${index}, element ${element}: `
          + `${actualMatrix.elements[element]} !== ${expectedMatrix.elements[element]}`,
      );
    }
  }
}
parityConnections.dispose();

const source = readFileSync(new URL('../src/roads/BuildingRoadConnections.ts', import.meta.url), 'utf8');
const updateSource = source.slice(source.indexOf('  update(dt: number)'), source.indexOf('  refresh(force'));
assert(!updateSource.includes('new Map'), 'the per-frame update must not allocate a Map');
assert(!updateSource.includes('new THREE.Vector3'), 'the per-frame update must not allocate vectors');
assert(
  source.includes('if (!force && rawSignatureUnchanged) return;'),
  'unchanged buildings must bypass text-signature creation',
);

// Before/after steady-state benchmark: the reference models the former per-frame
// sorted signature, nearest Map, and two temporary position vectors per marker.
const benchmarkBuildings = Array.from({ length: 250 }, (_, index) => ({
  id: `bench-${index}`,
  kind: 'founders_camp' as const,
  x: (index % 25) * 9,
  z: Math.floor(index / 25) * 9,
  yaw: (index * 0.07) % (Math.PI * 2),
}));
const benchmarkPoints = benchmarkBuildings.flatMap((building) =>
  getBuildingRoadConnectionPoints(building, flatTerrain)
);
const benchmarkCursor = new THREE.Vector3(105, 12, 42);
const benchmarkOpacities = new Map<string, number>();
const benchmarkMatrix = new THREE.Matrix4();
const benchmarkScale = new THREE.Vector3();
const frames = 1_200;
const beforeStart = performance.now();
for (let frame = 0; frame < frames; frame += 1) {
  benchmarkBuildings
    .map((building) => `${building.id}:${building.kind}:${building.x.toFixed(2)}:${building.z.toFixed(2)}:${building.yaw.toFixed(4)}`)
    .sort()
    .join('|');
  const nearest = new Map<string, (typeof benchmarkPoints)[number]>();
  for (const connection of benchmarkPoints) {
    const prior = nearest.get(connection.buildingId);
    if (!prior || distanceToCursor(connection.point) < distanceToCursor(prior.point)) {
      nearest.set(connection.buildingId, connection);
    }
  }
  for (const connection of benchmarkPoints) {
    const target = markerRevealOpacity(
      distanceToCursor(connection.point),
      nearest.get(connection.buildingId) === connection,
    );
    const current = benchmarkOpacities.get(connection.id) ?? 0;
    const opacity = THREE.MathUtils.lerp(current, target, 1 - Math.exp(-0.016 * (target > current ? 13 : 9)));
    benchmarkOpacities.set(connection.id, opacity);
    benchmarkScale.setScalar(0.86 + opacity * 0.14);
    benchmarkMatrix.compose(
      new THREE.Vector3(connection.point.x, connection.point.y + 0.16, connection.point.z),
      expectedRingRotation,
      benchmarkScale,
    );
    benchmarkMatrix.compose(
      new THREE.Vector3(connection.point.x, connection.point.y + 0.44, connection.point.z),
      expectedIdentityRotation,
      benchmarkScale,
    );
  }
}
const beforeMs = performance.now() - beforeStart;
const benchmarkParent = new THREE.Group();
const optimizedBenchmark = new BuildingRoadConnections({
  parent: benchmarkParent,
  terrain: flatTerrain as never,
  getBuildings: () => benchmarkBuildings,
  getRoadNetwork: () => null,
});
optimizedBenchmark.setVisible(true);
optimizedBenchmark.setCursor(benchmarkCursor);
for (let frame = 0; frame < 180; frame += 1) optimizedBenchmark.update(0.016);
const matrixVersionBefore = (
  benchmarkParent.getObjectByName('Building road connection rings') as THREE.InstancedMesh
).instanceMatrix.version;
const afterStart = performance.now();
for (let frame = 0; frame < frames; frame += 1) optimizedBenchmark.update(0.016);
const afterMs = performance.now() - afterStart;
const matrixVersionAfter = (
  benchmarkParent.getObjectByName('Building road connection rings') as THREE.InstancedMesh
).instanceMatrix.version;
assert.equal(matrixVersionAfter, matrixVersionBefore, 'stable marker state must not trigger uploads');
assert(afterMs < beforeMs, `optimized road markers should beat the reference (${afterMs.toFixed(1)}ms vs ${beforeMs.toFixed(1)}ms)`);
optimizedBenchmark.dispose();
console.log(`Road-marker benchmark (1000 markers x ${frames} frames): ${beforeMs.toFixed(1)}ms -> ${afterMs.toFixed(1)}ms.`);

function distanceToCursor(point: THREE.Vector3): number {
  return Math.hypot(point.x - benchmarkCursor.x, point.z - benchmarkCursor.z);
}

const preview = new RoadPreview({} as never, {} as never);
const cursor = preview.group.getObjectByName('Road placement cursor');
assert(cursor, 'road mode should own a persistent pointer cursor');
assert.equal(cursor.children.length, 1, 'the road cursor should be outline-only with no filled center');
const outline = cursor.getObjectByName('Road placement cursor outline');
assert(outline instanceof THREE.Mesh);
assert(outline.geometry instanceof THREE.RingGeometry);
assert.equal(
  outline.geometry.parameters.outerRadius * 2,
  roadVisualWidth(ROAD_WIDTH),
  'the road cursor diameter should exactly match the road preview width',
);
preview.dispose();

const roadGate = {
  isSessionReady: () => true,
  isSettlementFounded: () => true,
  isRoadToolEnabled: () => true,
  isBuildingToolEnabled: () => false,
  isStarterCampPlacementActive: () => false,
  isBurgageToolEnabled: () => false,
  isFarmFieldToolEnabled: () => false,
  isFirstPersonActive: () => false,
  isMenuOpen: () => false,
} satisfies PlacementInteractionGate;
assert.equal(isWorldInspectionBlocked(roadGate), true, 'resource icons should not steal road clicks');
assert.equal(
  isWorldResourceIconVisibilityBlocked(roadGate),
  false,
  'resource icons should remain visible in road mode',
);

console.log('Road building connection tests passed.');
