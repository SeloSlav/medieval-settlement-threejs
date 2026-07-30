import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import * as THREE from 'three';
import { pickResidenceAppearance } from '../src/residences/residenceAppearance.ts';
import { createResidenceMesh } from '../src/residences/ResidenceMarkers.ts';
import {
  HAMLET_FIELD_SPECS,
  HAMLET_LANDMARKS,
  HAMLET_MOTION_ROUTE,
  HAMLET_MOTION_ROUTE_ID,
  HAMLET_RESIDENCE_ROOF,
  HAMLET_ROAD_ARMS,
  HAMLET_VIEW_IDS,
  HAMLET_VIEW_SPECS,
  HAMLET_ZONE_SPECS,
} from '../src/e2e/hamletFixtureConfig.ts';

assert.equal(HAMLET_VIEW_IDS.length, 7, 'fixture must expose seven matched review views');
assert.deepEqual(
  HAMLET_VIEW_SPECS.map((view) => view.id),
  HAMLET_VIEW_IDS,
  'view specs must cover every review distance in stable order',
);
assert.equal(new Set(HAMLET_VIEW_IDS).size, HAMLET_VIEW_IDS.length, 'view ids must be unique');
for (const view of HAMLET_VIEW_SPECS) {
  assert.ok(view.position.every(Number.isFinite), `${view.id} camera position must be fixed`);
  assert.ok(view.target.every(Number.isFinite), `${view.id} camera target must be fixed`);
}

assert.equal(HAMLET_MOTION_ROUTE.id, HAMLET_MOTION_ROUTE_ID);
assert.equal(HAMLET_MOTION_ROUTE.durationMs, 21_000);
assert.equal(HAMLET_MOTION_ROUTE.interpolation, 'world-space-position-target-quaternion');
assert.equal(HAMLET_MOTION_ROUTE.easing, 'smootherstep');
assert.deepEqual(
  HAMLET_MOTION_ROUTE.keyframes.map((keyframe) => keyframe.distanceMeters),
  [240, 240, 88, 4, 4, 88, 240],
  'motion must traverse strategic -> settlement -> road-eye -> settlement -> strategic',
);
assert.deepEqual(
  HAMLET_MOTION_ROUTE.settledStartPredicate,
  {
    id: 'fixture-ready-two-stable-frames',
    fixtureReady: true,
    detailedTexturesReady: true,
    minimumRenderedFrames: 2,
    motionInactive: true,
  },
);
for (let index = 0; index < HAMLET_MOTION_ROUTE.keyframes.length; index += 1) {
  const keyframe = HAMLET_MOTION_ROUTE.keyframes[index]!;
  if (index > 0) {
    assert.ok(
      keyframe.timeMs > HAMLET_MOTION_ROUTE.keyframes[index - 1]!.timeMs,
      `${keyframe.id} must advance route time`,
    );
  }
  const position = new THREE.Vector3(...keyframe.position);
  const target = new THREE.Vector3(...keyframe.target);
  assert.ok(
    Math.abs(position.distanceTo(target) - keyframe.distanceMeters) < 0.001,
    `${keyframe.id} world-space points must encode its named camera distance`,
  );
  const orientation = new THREE.Quaternion(...keyframe.orientation);
  assert.ok(
    Math.abs(orientation.length() - 1) < 0.000_001,
    `${keyframe.id} orientation must be a normalized world-space quaternion`,
  );
}
assert.equal(
  HAMLET_MOTION_ROUTE.keyframes.at(-1)!.timeMs,
  HAMLET_MOTION_ROUTE.durationMs,
);
assert.deepEqual(
  HAMLET_MOTION_ROUTE.lodBands,
  {
    forest: { id: 'seedthree-overview-to-near', nearDistanceMeters: 108 },
    groundcover: {
      id: 'close-ground-dirt-and-cover',
      transitionStartMeters: 44,
      fullDetailMeters: 22,
    },
    building: {
      id: 'building-review-distance',
      settlementMeters: 88,
      roadEyeMeters: 4,
    },
  },
);

assert.equal(HAMLET_ROAD_ARMS.length, 3, 'fixture road must have three Y arms');
for (const arm of HAMLET_ROAD_ARMS) {
  assert.deepEqual(arm.points[0], [0, 0], `${arm.id} must share the deterministic junction`);
}
assert.equal(HAMLET_ZONE_SPECS.reduce((sum, zone) => sum + zone.plotCount, 0), 9);
assert.ok(HAMLET_FIELD_SPECS.length >= 4, 'cultivated fabric needs multiple readable parcels');
assert.deepEqual(
  new Set(HAMLET_LANDMARKS.map((landmark) => landmark.kind)),
  new Set(['chapel', 'well', 'marketplace']),
  'fixture needs chapel, well, and trade building',
);
for (const landmark of HAMLET_LANDMARKS) {
  const roadClearance = Math.min(
    ...HAMLET_ROAD_ARMS.flatMap((arm) => arm.points.slice(0, -1).map((start, index) => (
      distanceToSegment(landmark.position, start, arm.points[index + 1]!)
    ))),
  );
  assert.ok(
    roadClearance >= 5,
    `${landmark.id} must sit beside the lane rather than overlap it (${roadClearance.toFixed(2)}m)`,
  );
}

for (let seed = 0; seed < 48; seed += 1) {
  const residence = createResidenceMesh(seed, 1, { roof: HAMLET_RESIDENCE_ROOF });
  assert.equal(residence.userData.residenceRoof, 'brown');
  const forbiddenRoofMaterials = new Set<THREE.Material>();
  residence.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (/\b(?:clayRed|clayDark|slate)\b/.test(material.name)) {
        forbiddenRoofMaterials.add(material);
      }
    }
  });
  assert.equal(
    forbiddenRoofMaterials.size,
    0,
    `pre-tile residence seed ${seed} must contain only wood roof surfaces`,
  );

  const normalResidence = createResidenceMesh(seed, 1);
  assert.equal(
    normalResidence.userData.residenceRoof,
    pickResidenceAppearance(seed).roof,
    'roof override must not change ordinary seeded gameplay appearances',
  );
}

const fixtureSource = readFileSync('src/e2e/hamletFixture.ts', 'utf8');
for (const sharedSystem of [
  'RoadMeshBuilder',
  'RoadJunctionBuilder',
  'FarmFieldMarkers',
  'BurgageFencing',
  'createSeedThreeForest',
  'createGrassBladeField',
  'createBuildingMesh',
  'createResidenceMesh',
  'createPostProcessor',
  'SkyCloudMesh',
  'installVisualPerformanceHooksIfRequested',
]) {
  assert.ok(fixtureSource.includes(sharedSystem), `fixture must exercise ${sharedSystem}`);
}
for (const runtimeContract of [
  'getPointAt(',
  'getPointAtInto(',
  'setDirtZoomGate(',
  'startContinuousTick',
  'requestAnimationFrame',
  '__HAMLET_FIXTURE_MOTION_ROUTE__',
  '__HAMLET_FIXTURE_CAPTURE_VIEW__',
  '__HAMLET_FIXTURE_CAPTURE_MOTION__',
]) {
  assert.ok(
    fixtureSource.includes(runtimeContract),
    `fixture must expose or implement ${runtimeContract}`,
  );
}
assert.doesNotMatch(
  fixtureSource,
  /SettlementCrowdRenderer|VillagerRenderer/,
  'fixture should not instantiate people renderers',
);
const packageSource = readFileSync('package.json', 'utf8');
const runAllSource = readFileSync('scripts/run-all-tests.mts', 'utf8');
assert.ok(packageSource.includes('"test:hamlet-fixture"'));
assert.ok(runAllSource.includes("'test:hamlet-fixture'"));

console.log(
  `hamlet fixture tests passed (${HAMLET_VIEW_IDS.length} views, `
  + `${HAMLET_ZONE_SPECS.reduce((sum, zone) => sum + zone.plotCount, 0)} wood-roof residences, `
  + `${HAMLET_FIELD_SPECS.length} fields)`,
);

function distanceToSegment(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared <= 1e-6
    ? 0
    : Math.max(0, Math.min(1, (
      (point[0] - start[0]) * dx + (point[1] - start[1]) * dz
    ) / lengthSquared));
  return Math.hypot(
    point[0] - (start[0] + dx * t),
    point[1] - (start[1] + dz * t),
  );
}
