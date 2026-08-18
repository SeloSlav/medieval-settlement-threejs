import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BuildingTerrainLayout } from '../src/buildings/BuildingTerrainLayout.ts';
import {
  BurgageFencing,
  resolveResidenceFrontageGateway,
  sampleTerrainFenceBays,
} from '../src/residences/BurgageFencing.ts';
import {
  computeBurgageLayout,
  getParcelFenceSegments,
  getZoneEdge,
  oppositeFrontageEdge,
  type BurgageFrontageEdge,
  type BurgageZoneCorners,
} from '../src/residences/burgageLayout.ts';
import { residenceFootprintHeightDelta } from '../src/residences/burgagePlacementValidation.ts';
import {
  createHeightfieldNormals,
  updateHeightfieldNormalsInRegion,
} from '../src/terrain/terrainNormals.ts';

const almostEqual = (actual: number, expected: number, epsilon = 1e-6): void => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
};

const slopeHeight = (x: number, z: number): number => x * 0.2 + z * 0.05;
const residence = { x: 0, z: 0, yaw: 0 };
const layout = BuildingTerrainLayout.fromSettlement([], [residence], slopeHeight);

assert.equal(layout.sites.length, 1, 'a residence should contribute one terrain pad');
const centerNatural = slopeHeight(0, 0);
const centerLeveled = centerNatural + layout.getPlatformRaise(0, 0, centerNatural);
const innerNatural = slopeHeight(-3, -3.5);
const innerLeveled = innerNatural + layout.getPlatformRaise(-3, -3.5, innerNatural);
almostEqual(
  centerLeveled,
  innerLeveled,
  1e-5,
);
almostEqual(
  layout.getPlatformRaise(20, 20, slopeHeight(20, 20)),
  0,
);
const extremeLayout = BuildingTerrainLayout.fromSettlement([], [residence], (x) => x * 2);
assert.ok(
  extremeLayout.getPlatformRaise(0, 0, 0) <= 6,
  'legacy residences on extreme slopes should not create unbounded earthen platforms',
);
assert.ok(
  extremeLayout.getPlatformRaise(0, 0, 0) > 2.4,
  'residence earthworks should now accommodate slopes beyond the former strict cap',
);

const bays = sampleTerrainFenceBays(
  { x: 0, z: 0 },
  { x: 5, z: 0 },
  (x) => x * 0.25,
);
assert.equal(bays.length, 3, 'a five-meter fence should be split into three terrain bays');
for (let index = 0; index < bays.length; index++) {
  const bay = bays[index];
  assert.ok(
    Math.hypot(bay.end.x - bay.start.x, bay.end.z - bay.start.z) <= 2.2,
    'no terrain-following rail bay should exceed post spacing',
  );
  almostEqual(bay.startGroundHeight, bay.start.x * 0.25);
  almostEqual(bay.endGroundHeight, bay.end.x * 0.25);
  if (index > 0) {
    almostEqual(bays[index - 1].end.x, bay.start.x);
    almostEqual(bays[index - 1].endGroundHeight, bay.startGroundHeight);
  }
}

testResidenceGatewaysStayOnFrontage();
testReloadedResidenceFencesHaveRenderableInstances();
testRoadHydrationResyncsTerrainFollowingFences();

almostEqual(
  residenceFootprintHeightDelta(
    { parcelIndex: 0, x: 4, z: -2, yaw: Math.PI / 3 },
    () => 7,
  ),
  0,
);
assert.ok(
  residenceFootprintHeightDelta(
    { parcelIndex: 0, x: 0, z: 0, yaw: 0 },
    (x) => x * 0.5,
  ) > 2.4,
  'the residence footprint sampler should detect an excessive cross-slope',
);

testRegionalTerrainNormalsMatchFullRecompute();

console.log('Residence terrain adaptation checks passed.');

function testRegionalTerrainNormalsMatchFullRecompute(): void {
  const resolution = 11;
  const positions = new Float32Array(resolution * resolution * 3);

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const offset = (z * resolution + x) * 3;
      positions[offset] = x * 1.3;
      positions[offset + 1] = Math.sin(x * 0.37) * 0.8 + Math.cos(z * 0.29) * 0.55;
      positions[offset + 2] = z * 1.3;
    }
  }

  const regionalNormals = createHeightfieldNormals(positions, resolution);

  const minX = 3;
  const maxX = 7;
  const minZ = 2;
  const maxZ = 6;
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const offset = (z * resolution + x) * 3;
      positions[offset + 1] = 1.7 + (x - minX) * 0.04 - (z - minZ) * 0.03;
    }
  }

  const expectedNormals = createHeightfieldNormals(positions, resolution);

  updateHeightfieldNormalsInRegion(
    positions,
    regionalNormals,
    resolution,
    minX,
    maxX,
    minZ,
    maxZ,
  );

  let maximumError = 0;
  for (let index = 0; index < expectedNormals.length; index++) {
    maximumError = Math.max(maximumError, Math.abs(regionalNormals[index] - expectedNormals[index]));
  }
  assert.ok(
    maximumError === 0,
    `regional terrain normals must match a full smooth-heightfield recompute, including its boundary (max error ${maximumError})`,
  );
}

function testRoadHydrationResyncsTerrainFollowingFences(): void {
  const appSource = readFileSync(new URL('../src/app/App.ts', import.meta.url), 'utf8');
  const callbackStart = appSource.indexOf('onRoadsHydrated: (roads) => {');
  const callbackEnd = appSource.indexOf('onConnectError:', callbackStart);
  assert.ok(callbackStart >= 0 && callbackEnd > callbackStart, 'road hydration callback must exist');

  const callback = appSource.slice(callbackStart, callbackEnd);
  const terrainSync = callback.indexOf('syncPlacedBuildingTerrain({');
  const fenceSync = callback.indexOf('this.burgageFencing?.syncZones(');
  assert.ok(terrainSync >= 0, 'road hydration must reapply placed-building terrain');
  assert.ok(
    fenceSync > terrainSync,
    'road hydration must resync terrain-following burgage fencing after terrain is reapplied',
  );
  assert.match(
    callback.slice(fenceSync),
    /hydratedState\.burgageZones\.values\(\)[\s\S]*hydratedState\.residences\.values\(\)[\s\S]*terrain\.getHeightAt/,
    'the refresh resync must rebuild saved plot fences at final terrain heights',
  );
}

function testReloadedResidenceFencesHaveRenderableInstances(): void {
  const parent = new THREE.Group();
  const fencing = new BurgageFencing(parent);
  fencing.syncZones(
    [{
      id: 'saved-zone',
      cornerA: { x: -12, z: -12 },
      cornerB: { x: 12, z: -12 },
      cornerC: { x: 12, z: 12 },
      cornerD: { x: -12, z: 12 },
      frontageEdge: 0,
      plotCount: 2,
    }],
    [
      { id: 'saved-residence-0', zoneId: 'saved-zone', parcelIndex: 0, x: -6, z: -5, yaw: 0 },
      { id: 'saved-residence-1', zoneId: 'saved-zone', parcelIndex: 1, x: 6, z: -5, yaw: 0 },
    ],
    (x, z) => x * 0.03 + z * 0.02,
  );

  const root = parent.getObjectByName('Burgage fencing');
  assert.ok(root, 'saved residence fencing should be attached after reconstruction');
  const posts = root.getObjectByName('Fence posts') as THREE.InstancedMesh;
  const rails = root.getObjectByName('Fence rails') as THREE.InstancedMesh;
  const gates = root.getObjectByName('Frontage gate frames') as THREE.InstancedMesh;

  assert.ok(posts.count > 0, 'saved residences must reconstruct perimeter posts');
  assert.ok(rails.count > 0, 'saved residences must reconstruct perimeter rails');
  assert.equal(gates.count, 6, 'two saved residences must reconstruct two three-timber gates');
  for (const mesh of [posts, rails, gates]) {
    assert.ok(
      mesh.geometry.hasAttribute('color'),
      `${mesh.name} must supply the vertex-color attribute required by its timber material`,
    );
    assert.equal(
      mesh.geometry.getAttribute('color').count,
      mesh.geometry.getAttribute('position').count,
      `${mesh.name} vertex colors must cover every geometry vertex`,
    );
  }

  fencing.dispose();
}

function testResidenceGatewaysStayOnFrontage(): void {
  const corners: BurgageZoneCorners = {
    a: { x: -12, z: -12 },
    b: { x: 12, z: -12 },
    c: { x: 12, z: 12 },
    d: { x: -12, z: 12 },
  };

  for (const frontageEdge of [0, 1, 2, 3] as const satisfies readonly BurgageFrontageEdge[]) {
    const burgage = computeBurgageLayout(corners, frontageEdge, 1);
    assert.ok(burgage, `frontage edge ${frontageEdge} should produce a valid test parcel`);
    const parcel = burgage.parcels[0];
    const placement = burgage.residences[0];
    const gateway = resolveResidenceFrontageGateway(
      {
        id: `frontage-${frontageEdge}`,
        zoneId: 'frontage-test',
        ...placement,
      },
      parcel,
    );
    assert.ok(gateway, `frontage edge ${frontageEdge} should have a gateway`);

    const [frontStart, frontEnd] = getZoneEdge(corners, frontageEdge);
    const [rearStart, rearEnd] = getZoneEdge(corners, oppositeFrontageEdge(frontageEdge));
    almostEqual(pointSegmentDistance(gateway.center, frontStart, frontEnd), 0);
    almostEqual(pointSegmentDistance(gateway.start, frontStart, frontEnd), 0);
    almostEqual(pointSegmentDistance(gateway.end, frontStart, frontEnd), 0);
    assert.ok(
      pointSegmentDistance(gateway.center, rearStart, rearEnd) > 20,
      `frontage edge ${frontageEdge} gateway must not migrate to the rear fence`,
    );

    const fenceSegments = getParcelFenceSegments(
      burgage,
      new Set([parcel.index]),
      new Map([[parcel.index, { center: gateway.center, width: gateway.width }]]),
    );
    const frontageRailLength = fenceSegments
      .filter(([start, end]) => (
        pointSegmentDistance(start, frontStart, frontEnd) < 1e-6
        && pointSegmentDistance(end, frontStart, frontEnd) < 1e-6
      ))
      .reduce((total, [start, end]) => total + Math.hypot(end.x - start.x, end.z - start.z), 0);
    almostEqual(
      frontageRailLength,
      Math.hypot(frontEnd.x - frontStart.x, frontEnd.z - frontStart.z) - gateway.width,
    );
  }
}

function pointSegmentDistance(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number },
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq <= 1e-9
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq));
  return Math.hypot(point.x - (start.x + dx * t), point.z - (start.z + dz * t));
}
