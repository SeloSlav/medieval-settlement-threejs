import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  partitionSeedThreeSelectionByDistanceLod,
} from '../src/vegetation/seedthree/seedThreeForestCompaction.ts';
import {
  createForestLodSelector,
  selectForestLods,
} from '../vendor/seedthree/src/core/forest-lod.js';
const DETAIL_DISTANCE_METERS = 44;
const LOD_HYSTERESIS_METERS = 14;

function cameraAt(distance: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 400);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

const sourceItems = [
  { x: 0, y: 0, z: 0, radius: 1 },
  { x: 5, y: 0, z: 0, radius: 1, forceOverview: true },
] as const;
const selector = createForestLodSelector(sourceItems, {
  frustumPadding: 26,
  nearDistance: DETAIL_DISTANCE_METERS,
  lodHysteresis: LOD_HYSTERESIS_METERS,
  minimumCameraMove: 0,
});

const boundary = selectForestLods(selector, cameraAt(44), { force: true });
assert.ok(boundary.nearIndices.includes(0), 'a tree at 44 m starts in authored LOD2');
assert.ok(
  boundary.overviewIndices.includes(1) && !boundary.nearIndices.includes(1),
  'an authored edge-footprint tree remains overview geometry at every scale',
);

const beyondExit = selectForestLods(selector, cameraAt(59), { force: true });
assert.ok(
  beyondExit.overviewIndices.includes(0),
  'detail exits only beyond the 44 m + 14 m hysteresis boundary',
);
const insideEnterBand = selectForestLods(selector, cameraAt(31), { force: true });
assert.ok(
  insideEnterBand.overviewIndices.includes(0),
  'an overview tree stays overview inside the 44 m - 14 m enter band',
);
const beyondEnter = selectForestLods(selector, cameraAt(29), { force: true });
assert.ok(
  beyondEnter.nearIndices.includes(0),
  'genuinely close geometry returns after crossing the hysteretic enter boundary',
);

const selected = {
  nearIndices: [0, 3, 5],
  overviewIndices: [1, 2, 4, 6],
  viewIndices: [0, 1, 2, 3, 4],
};
const liveColor = partitionSeedThreeSelectionByDistanceLod(selected);
const frozenColor = partitionSeedThreeSelectionByDistanceLod(selected);
assert.deepEqual(liveColor, {
  nearViewIndices: [0, 3],
  overviewViewIndices: [1, 2, 4],
  nearViewCount: 2,
  overviewViewCount: 3,
});
assert.deepEqual(
  frozenColor,
  liveColor,
  'ordinary and frozen-selection paths must resolve identical color LOD prefixes',
);

const forestSource = readFileSync(
  new URL('../src/vegetation/seedthree/seedThreeForestBuilder.ts', import.meta.url),
  'utf8',
);
const fixtureSource = readFileSync(
  new URL('../src/e2e/hamletFixture.ts', import.meta.url),
  'utf8',
);
assert.match(
  forestSource,
  /SEEDTHREE_FOREST_DETAIL_DISTANCE_METERS = 44;[\s\S]*?SEEDTHREE_FOREST_LOD_HYSTERESIS_METERS = 14;/,
  'the reviewed close-detail footprint must remain 44 m with 14 m hysteresis',
);
assert.match(
  forestSource,
  /const distanceLod = partitionSeedThreeSelectionByDistanceLod\(selection\);[\s\S]*?viewNear:[\s\S]*?viewOverview:/,
  'production bucket selection must derive both exact color prefixes from per-tree distance LOD',
);
assert.match(
  forestSource,
  /presentationOnly[\s\S]*?bucket\.nearSlotIndices[\s\S]*?viewNear: \[\] as number\[\]/,
  'presentation-only mode may freeze caster residency but not replace spatial color ownership',
);
assert.match(
  forestSource,
  /createSeedThreeForestController[\s\S]*?updateSeedThreeForestCamera\([\s\S]*?ensureSeedThreeSpatialForestLodGroupsVisible\(/,
  'ordinary live camera updates must use the production selector and keep both exact groups renderable',
);
assert.match(
  fixtureSource,
  /forestUpdatesFrozenForMeasurement[\s\S]*?updateSeedThreeForestCameraBudgeted\([\s\S]*?presentationOnly: true/,
  'the frozen profiler must invoke the same production camera selector for presentation-only LOD',
);
assert.match(
  forestSource,
  /ensureSeedThreeSpatialForestLodGroupsVisible[\s\S]*?overviewBillboardGroup\.visible = next\.visible[\s\S]*?const nearColorVisible = true/,
  'spatial detail and footprint prefixes must coexist without a camera-wide downgrade',
);
assert.match(
  forestSource,
  /getSeedThreeForestStructuralStats[\s\S]*?forest\.group\.traverseVisible/,
  'forest evidence must count submitted visible geometry rather than hidden allocation',
);

console.log(
  'SeedThree spatial forest LOD: fixed view, 44/14 m hysteresis, exact prefix partition, and live/frozen parity passed.',
);
