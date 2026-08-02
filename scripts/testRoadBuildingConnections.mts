import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BuildingRoadConnections,
  getBuildingRoadConnectionPoints,
} from '../src/roads/BuildingRoadConnections.ts';
import { getBuildingFootprintHalfExtents } from '../src/buildings/BuildingTerrainLayout.ts';
import { ROAD_WIDTH } from '../src/roads/roadDimensions.ts';
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
for (const markerName of [
  'Building road connection rings',
  'Building road connection posts',
]) {
  const markers = markerGroup?.getObjectByName(markerName);
  assert(markers instanceof THREE.InstancedMesh);
  assert(markers.material instanceof THREE.MeshBasicMaterial);
  assert.equal(markers.material.color.getHex(), 0xffffff, `${markerName} should be white`);
}
connections.dispose();

const preview = new RoadPreview({} as never, {} as never);
const cursor = preview.group.getObjectByName('Road placement cursor');
assert(cursor, 'road mode should own a persistent pointer cursor');
assert.equal(cursor.children.length, 1, 'the road cursor should be outline-only with no filled center');
const outline = cursor.getObjectByName('Road placement cursor outline');
assert(outline instanceof THREE.Mesh);
assert(outline.geometry instanceof THREE.RingGeometry);
assert.equal(
  outline.geometry.parameters.outerRadius * 2,
  ROAD_WIDTH,
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
