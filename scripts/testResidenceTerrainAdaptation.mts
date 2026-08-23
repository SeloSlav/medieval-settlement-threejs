import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BuildingTerrainLayout } from '../src/buildings/BuildingTerrainLayout.ts';
import {
  BurgageFencing,
  residenceHasFramedGateway,
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

testResidenceGatewayFrameVariantsAreDeterministic();
testResidenceGatewaysStayOnFrontage();
testGatewayVariantSwitchInvalidatesFenceSignature();
testReloadedResidenceFencesHaveRenderableInstances();
testRoadHydrationResyncsTerrainFollowingFences();
testForestCompletionForcesFenceInstanceUpload();

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

function testForestCompletionForcesFenceInstanceUpload(): void {
  const appSource = readFileSync(new URL('../src/app/App.ts', import.meta.url), 'utf8');
  const callbackStart = appSource.indexOf('private onForestReady(): void {');
  const callbackEnd = appSource.indexOf('private readonly onResize', callbackStart);
  assert.ok(callbackStart >= 0 && callbackEnd > callbackStart, 'forest-ready callback must exist');

  const callback = appSource.slice(callbackStart, callbackEnd);
  assert.match(
    callback,
    /this\.burgageFencing\?\.syncZones\([\s\S]*\{ forceInstanceUpload: true \},[\s\S]*\);/,
    'the post-vegetation sync must force saved fence instance buffers back onto the renderer',
  );
}

function testResidenceGatewayFrameVariantsAreDeterministic(): void {
  const residenceIds = Array.from(
    { length: 64 },
    (_, index) => `gateway-variant-residence-${index}`,
  );
  const firstPass = residenceIds.map((id) => residenceHasFramedGateway(id, 1));
  const secondPass = residenceIds.map((id) => residenceHasFramedGateway(id, 1));

  assert.deepEqual(
    secondPass,
    firstPass,
    'tier-one frontage-frame choices must reproduce exactly for the same residence IDs',
  );
  assert.ok(
    firstPass.includes(true) && firstPass.includes(false),
    'tier-one frontage-frame choices must include both hewn frames and literal fence gaps',
  );
  assert.ok(
    residenceIds.every((id) => residenceHasFramedGateway(id, 2)),
    'higher-tier residences must retain framed gateways',
  );
}

function testReloadedResidenceFencesHaveRenderableInstances(): void {
  const parent = new THREE.Group();
  const fencing = new BurgageFencing(parent);
  const savedZones = [{
    id: 'saved-zone',
    cornerA: { x: -12, z: -12 },
    cornerB: { x: 12, z: -12 },
    cornerC: { x: 12, z: 12 },
    cornerD: { x: -12, z: 12 },
    frontageEdge: 0 as const,
    plotCount: 2,
  }];
  const framedResidenceId = findTierOneResidenceIdForGatewayStyle(true);
  const openResidenceId = findTierOneResidenceIdForGatewayStyle(false);
  const savedResidences = [
    { id: framedResidenceId, zoneId: 'saved-zone', parcelIndex: 0, x: -6, z: -5, yaw: 0, tier: 1 },
    { id: openResidenceId, zoneId: 'saved-zone', parcelIndex: 1, x: 6, z: -5, yaw: 0, tier: 1 },
  ];
  const savedTerrainHeight = (x: number, z: number): number => x * 0.03 + z * 0.02;
  fencing.syncZones(
    savedZones,
    savedResidences,
    savedTerrainHeight,
  );

  const root = parent.getObjectByName('Burgage fencing');
  assert.ok(root, 'saved residence fencing should be attached after reconstruction');
  const posts = root.getObjectByName('Fence posts') as THREE.InstancedMesh;
  const rails = root.getObjectByName('Fence rails') as THREE.InstancedMesh;
  const gates = root.getObjectByName('Frontage gate frames') as THREE.InstancedMesh;

  assert.ok(posts.count > 0, 'saved residences must reconstruct perimeter posts');
  assert.ok(rails.count > 0, 'saved residences must reconstruct perimeter rails');
  const expectedGateTimbers = savedResidences.filter(
    (savedResidence) => residenceHasFramedGateway(savedResidence.id, savedResidence.tier),
  ).length * 3;
  assert.equal(
    expectedGateTimbers,
    3,
    'the saved-residence fixture must exercise one framed gateway and one literal gap',
  );
  assert.equal(
    gates.count,
    expectedGateTimbers,
    'saved residences must reconstruct three gate timbers only for deterministic framed gateways',
  );
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
    assert.equal(
      mesh.instanceMatrix.usage,
      THREE.DynamicDrawUsage,
      `${mesh.name} must declare that its saved instances can be re-uploaded`,
    );
  }

  const versionsBeforeNoOpSync = [posts, rails, gates].map((mesh) => mesh.instanceMatrix.version);
  fencing.syncZones(
    savedZones,
    savedResidences,
    savedTerrainHeight,
  );
  assert.deepEqual(
    [posts, rails, gates].map((mesh) => mesh.instanceMatrix.version),
    versionsBeforeNoOpSync,
    'an ordinary identical sync should retain the signature fast path',
  );

  fencing.syncZones(
    savedZones,
    savedResidences,
    savedTerrainHeight,
    { forceInstanceUpload: true },
  );
  [posts, rails, gates].forEach((mesh, index) => {
    assert.ok(
      mesh.instanceMatrix.version > versionsBeforeNoOpSync[index],
      `${mesh.name} must be re-uploaded when startup requests a forced sync`,
    );
  });

  fencing.dispose();
}

function testGatewayVariantSwitchInvalidatesFenceSignature(): void {
  const corners: BurgageZoneCorners = {
    a: { x: -12, z: -12 },
    b: { x: 12, z: -12 },
    c: { x: 12, z: 12 },
    d: { x: -12, z: 12 },
  };
  const burgage = computeBurgageLayout(corners, 0, 1);
  assert.ok(burgage, 'gateway signature test needs one valid frontage parcel');
  const parcel = burgage.parcels[0];
  const placement = burgage.residences[0];
  const variants = findMatchingGatewayVariantResidences(parcel, placement);
  const gapGateway = resolveResidenceFrontageGateway(variants.open, parcel);
  const framedGateway = resolveResidenceFrontageGateway(variants.framed, parcel);
  assert.ok(gapGateway && framedGateway, 'both signature variants must resolve a frontage opening');
  assert.equal(gapGateway.hasFrame, false);
  assert.equal(framedGateway.hasFrame, true);
  assert.deepEqual(
    gatewayGeometrySignature(framedGateway),
    gatewayGeometrySignature(gapGateway),
    'signature variants must differ only in frame ownership, not gateway geometry',
  );

  const parent = new THREE.Group();
  const fencing = new BurgageFencing(parent);
  const zone = {
    id: 'gateway-signature-zone',
    cornerA: corners.a,
    cornerB: corners.b,
    cornerC: corners.c,
    cornerD: corners.d,
    frontageEdge: 0 as const,
    plotCount: 1,
  };
  fencing.syncZones([zone], [variants.open], () => 0);

  const root = parent.getObjectByName('Burgage fencing');
  assert.ok(root, 'gateway signature fixture must attach its fencing root');
  const posts = root.getObjectByName('Fence posts') as THREE.InstancedMesh;
  const rails = root.getObjectByName('Fence rails') as THREE.InstancedMesh;
  const gates = root.getObjectByName('Frontage gate frames') as THREE.InstancedMesh;
  assert.equal(gates.count, 0, 'the initial open variant must leave a literal gap');
  const versionsBeforeFrame = [posts, rails, gates].map(
    (mesh) => mesh.instanceMatrix.version,
  );

  fencing.syncZones([zone], [variants.framed], () => 0);
  assert.equal(gates.count, 3, 'switching to the framed variant must add two posts and one lintel');
  [posts, rails, gates].forEach((mesh, index) => {
    assert.ok(
      mesh.instanceMatrix.version > versionsBeforeFrame[index],
      `${mesh.name} must upload after a gap-to-frame signature change`,
    );
  });

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
    for (const hasFrame of [false, true]) {
      const gateway = resolveResidenceFrontageGateway(
        {
          id: findTierOneResidenceIdForGatewayStyle(hasFrame),
          zoneId: 'frontage-test',
          tier: 1,
          ...placement,
        },
        parcel,
      );
      assert.ok(gateway, `frontage edge ${frontageEdge} should have a gateway`);
      assert.equal(
        gateway.hasFrame,
        hasFrame,
        `frontage edge ${frontageEdge} must preserve the selected gateway style`,
      );

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
      const frontageFenceSegments = fenceSegments.filter(([start, end]) => (
        pointSegmentDistance(start, frontStart, frontEnd) < 1e-6
        && pointSegmentDistance(end, frontStart, frontEnd) < 1e-6
      ));
      const frontageRailLength = frontageFenceSegments.reduce(
        (total, [start, end]) => total + Math.hypot(end.x - start.x, end.z - start.z),
        0,
      );
      almostEqual(
        frontageRailLength,
        Math.hypot(frontEnd.x - frontStart.x, frontEnd.z - frontStart.z) - gateway.width,
      );
      assert.ok(
        frontageFenceSegments.every(([start, end]) => (
          pointSegmentDistance(gateway.center, start, end) >= gateway.width * 0.5 - 1e-6
        )),
        `${hasFrame ? 'framed' : 'open'} frontage must retain a literal rail-free gateway gap`,
      );
    }
  }
}

function findTierOneResidenceIdForGatewayStyle(hasFrame: boolean): string {
  for (let index = 0; index < 512; index += 1) {
    const id = `terrain-gateway-style-${index}`;
    if (residenceHasFramedGateway(id, 1) === hasFrame) return id;
  }
  assert.fail(`could not find a deterministic tier-one ${hasFrame ? 'framed' : 'open'} gateway`);
}

type GatewayTestResidence = {
  id: string;
  zoneId: string;
  parcelIndex: number;
  x: number;
  z: number;
  yaw: number;
  tier: number;
};

function findMatchingGatewayVariantResidences(
  parcel: Parameters<typeof resolveResidenceFrontageGateway>[1],
  placement: { parcelIndex: number; x: number; z: number; yaw: number },
): {
  open: GatewayTestResidence;
  framed: GatewayTestResidence;
} {
  const variantsByGeometry = new Map<
    string,
    { open?: GatewayTestResidence; framed?: GatewayTestResidence }
  >();
  for (let index = 0; index < 2_048; index += 1) {
    const candidate: GatewayTestResidence = {
      id: `gateway-signature-residence-${index}`,
      zoneId: 'gateway-signature-zone',
      tier: 1,
      ...placement,
    };
    const gateway = resolveResidenceFrontageGateway(candidate, parcel);
    if (!gateway) continue;
    const key = gatewayGeometrySignature(gateway).join('|');
    const variants = variantsByGeometry.get(key) ?? {};
    if (gateway.hasFrame) variants.framed = candidate;
    else variants.open = candidate;
    if (variants.open && variants.framed) return {
      open: variants.open,
      framed: variants.framed,
    };
    variantsByGeometry.set(key, variants);
  }
  assert.fail('could not find opposite frame variants with identical gateway geometry');
}

function gatewayGeometrySignature(gateway: {
  start: { x: number; z: number };
  center: { x: number; z: number };
  end: { x: number; z: number };
  width: number;
}): string[] {
  return [
    gateway.start.x,
    gateway.start.z,
    gateway.center.x,
    gateway.center.z,
    gateway.end.x,
    gateway.end.z,
    gateway.width,
  ].map((value) => value.toFixed(9));
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
