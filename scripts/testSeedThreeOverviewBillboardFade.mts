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
import { buildCardFoliage } from '../vendor/seedthree/src/core/branch-cards.js';
import { Rng } from '../vendor/seedthree/src/core/rng.js';
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

function cardVariant(chordLen: number, color: number) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([
      -0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0,
    ]), 3),
  );
  geometry.setAttribute(
    'aWindVec',
    new THREE.InstancedBufferAttribute(new Float32Array(24), 3),
  );
  geometry.setAttribute(
    'aAnchorPos',
    new THREE.InstancedBufferAttribute(new Float32Array(24), 3),
  );
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  return {
    geometry,
    material: new THREE.MeshBasicMaterial({ color }),
    chordLen,
  };
}

const cardStems = [0.8, 1.3, 2.1, 2.8].map((length, index) => ({
  points: [
    new THREE.Vector3(index * 0.2, 0, 0),
    new THREE.Vector3(index * 0.2, length, 0),
  ],
  winds: [0.2, 0.8],
}));
const threeVariantCards = buildCardFoliage(
  cardStems,
  {
    variants: [cardVariant(0.8, 0x224422), cardVariant(1.6, 0x335533), cardVariant(2.8, 0x446644)],
    centerUniform: { value: new THREE.Vector3() },
    foliageOnly: false,
  },
  new Rng('lod4-card-submission-contract'),
  { growScale: 1, keepFraction: 1, crossed: true },
);
const oneVariantMaterial = new THREE.MeshBasicMaterial({ color: 0x335533 });
const oneVariant = cardVariant(1.6, 0x335533);
oneVariant.material = oneVariantMaterial;
const oneVariantCards = buildCardFoliage(
  cardStems,
  {
    variants: [oneVariant],
    centerUniform: { value: new THREE.Vector3() },
    foliageOnly: false,
  },
  new Rng('lod4-card-submission-contract'),
  { growScale: 1, keepFraction: 1, crossed: true },
);
const cardStats = (group: THREE.Group | null) => ({
  draws: group?.children.length ?? 0,
  sourceStems: group?.children.reduce(
    (sum, child) => sum + Number(child.userData.cardSourceStemCount ?? 0),
    0,
  ) ?? 0,
  instances: group?.children.reduce(
    (sum, child) => sum + (child as THREE.InstancedMesh).count,
    0,
  ) ?? 0,
  triangles: group?.children.reduce((sum, child) => {
    const mesh = child as THREE.InstancedMesh;
    return sum + (mesh.geometry.index?.count ?? 0) / 3 * mesh.count;
  }, 0) ?? 0,
});
const threeVariantStats = cardStats(threeVariantCards);
const oneVariantStats = cardStats(oneVariantCards);
assert.equal(oneVariantStats.draws, 1, 'LOD4 uses one per-species card submission');
assert.equal(threeVariantStats.sourceStems, cardStems.length);
assert.equal(oneVariantStats.sourceStems, cardStems.length);
assert.equal(oneVariantStats.instances, threeVariantStats.instances);
assert.equal(oneVariantStats.triangles, threeVariantStats.triangles);
assert.equal(
  (oneVariantCards!.children[0] as THREE.InstancedMesh).material,
  oneVariantMaterial,
  'consolidation preserves the selected species material identity',
);

const forestSource = readFileSync(
  new URL('../src/vegetation/seedthree/seedThreeForestBuilder.ts', import.meta.url),
  'utf8',
);
const fixtureSource = readFileSync(
  new URL('../src/e2e/hamletFixture.ts', import.meta.url),
  'utf8',
);
const branchCardSource = readFileSync(
  new URL('../src/vegetation/seedthree/seedThreeBranchCards.ts', import.meta.url),
  'utf8',
);
assert.match(
  forestSource,
  /SEEDTHREE_FOREST_DETAIL_DISTANCE_METERS = 44;[\s\S]*?SEEDTHREE_FOREST_LOD_HYSTERESIS_METERS = 14;/,
  'the reviewed close-detail footprint must remain 44 m with 14 m hysteresis',
);
assert.match(
  branchCardSource,
  /SEEDTHREE_LOD4_CARD_VARIANTS = 1[\s\S]*?SEEDTHREE_LOD4_CARD_SUBMISSION_REVISION = 1[\s\S]*?`l4v\$\{SEEDTHREE_LOD4_CARD_VARIANTS\}`[\s\S]*?`l4s\$\{SEEDTHREE_LOD4_CARD_SUBMISSION_REVISION\}`[\s\S]*?variants: SEEDTHREE_LOD4_CARD_VARIANTS/,
  'LOD4-only consolidation must invalidate stale caches and leave the three-variant near ladder untouched',
);
assert.match(
  forestSource,
  /const overviewLevel = findLodLevel\(prototype, 'LOD4'\)[\s\S]*?findLodLevel\(prototype, 'LOD3'\)/,
  'the distant footprint must use authored rooted LOD4 before falling back to LOD3',
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
assert.match(
  forestSource,
  /getSeedThreeForestSpatialLodDiagnostic[\s\S]*?visibilitySelector\.criticalViewIndices[\s\S]*?item\.forceOverview !== true[\s\S]*?seedThreeLodGeometryDiagnostic\(bucket\.nearSet\)[\s\S]*?seedThreeLodGeometryDiagnostic\(bucket\.overviewSet\)/,
  'the runtime must expose read-only selector-owned distance bands and per-species geometry evidence',
);
assert.match(
  fixtureSource,
  /__HAMLET_FIXTURE_GET_FOREST_SPATIAL_LOD__[\s\S]*?getSeedThreeForestSpatialLodDiagnostic\(forest, camera, distancesMeters\)/,
  'the production fixture must expose spatial LOD evidence without forcing a fixture-only selection',
);
assert.match(
  fixtureSource,
  /hamlet-forest-spatial-lod-request[\s\S]*?hamletForestSpatialLodDiagnostic[\s\S]*?getSeedThreeForestSpatialLodDiagnostic/,
  'browser proof must be able to request selector-owned distance evidence through the production DOM realm',
);
assert.match(
  forestSource,
  /paddedColorTrees \+= enabledSeedThreeTreeCount\([\s\S]*?nearViewSlotIndices[\s\S]*?paddedColorTrees \+= enabledSeedThreeTreeCount\([\s\S]*?overviewViewSlotIndices/,
  'padded color evidence must count both submitted spatial prefixes',
);

console.log(
  'SeedThree spatial forest LOD: fixed view, 44/14 m hysteresis, exact prefix partition, one-draw LOD4 card identity, live/frozen parity, and inspectable distance-band evidence passed.',
);
