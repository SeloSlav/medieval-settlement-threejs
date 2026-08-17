import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createSeedThreeBucketMatrixWriteJob,
  createSeedThreeExactShadowLodSet,
  createSeedThreeStableColorSlotSelection,
  configureSeedThreeForestPassMesh,
  enabledSeedThreeTreeCountInPrefix,
  partitionSeedThreeSelectionByStaticLod,
  runSeedThreeBucketMatrixWriteChunk,
  runSeedThreeBucketMatrixWriteSlices,
  seedThreeColorSelectionCoversView,
  seedThreeResidentSelectionCoversView,
  writeSeedThreeLodMatrices,
  type SeedThreeTreeSlot,
} from '../src/vegetation/seedthree/seedThreeForestCompaction.ts';
import { stabilizeSeedThreeForestCardMaterial } from '../src/vegetation/seedthree/seedThreeForestMaterial.ts';
import { planSeedThreeForestInteractionWork } from '../src/vegetation/seedthree/seedThreeForestInteraction.ts';
import {
  planForestBucketUpdates,
} from '../vendor/seedthree/src/core/forest-update-budget.js';
import {
  createForestLodSelector,
  selectForestLods,
} from '../vendor/seedthree/src/core/forest-lod.js';

type SeedThreeBucketSelection = {
  near: readonly number[];
  overview: readonly number[];
  viewNear?: readonly number[];
  viewOverview?: readonly number[];
};

assert.deepEqual(
  planSeedThreeForestInteractionWork(false, true, true),
  { deferWork: true, discardCoveredWork: false, completeImmediately: false },
  'covered forest compaction should remain stable while camera navigation is active',
);
assert.deepEqual(
  planSeedThreeForestInteractionWork(true, false, true),
  { deferWork: false, discardCoveredWork: true, completeImmediately: false },
  'navigation release should discard a redundant repack inside the resident guard',
);
assert.deepEqual(
  planSeedThreeForestInteractionWork(false, true, false),
  { deferWork: true, discardCoveredWork: false, completeImmediately: false },
  'an uncovered moving view must defer atomic GPU uploads until navigation ends',
);
assert.deepEqual(
  planSeedThreeForestInteractionWork(true, false, false),
  { deferWork: false, discardCoveredWork: false, completeImmediately: false },
  'a view that escaped the resident guard should refill under the normal frame budget',
);

const alphaCutoutMaterial = new THREE.MeshBasicMaterial({ alphaTest: 0.35 });
assert.equal(alphaCutoutMaterial.alphaToCoverage, false);
const alphaCutoutMaterialVersion = alphaCutoutMaterial.version;
assert.equal(
  stabilizeSeedThreeForestCardMaterial(alphaCutoutMaterial),
  alphaCutoutMaterial,
  'forest material stabilization should preserve the shared material instance',
);
assert.equal(
  alphaCutoutMaterial.alphaToCoverage,
  true,
  'alpha-tested forest cards should use MSAA coverage to prevent first-person shimmer',
);
assert.equal(
  alphaCutoutMaterial.version,
  alphaCutoutMaterialVersion + 1,
  'enabling alpha-to-coverage should invalidate any compiled shared-material pipeline',
);
alphaCutoutMaterial.dispose();

function makeLodSet(capacity: number) {
  const branchGeometry = new THREE.BoxGeometry(1, 1, 1);
  branchGeometry.setAttribute(
    'aWindVec',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  branchGeometry.setAttribute(
    'aAnchorPos',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  const branches = new THREE.InstancedMesh(
    branchGeometry,
    new THREE.MeshBasicMaterial(),
    capacity,
  );

  const cardGeometry = new THREE.PlaneGeometry(1, 1);
  cardGeometry.setAttribute(
    'aThickness',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  );
  cardGeometry.setAttribute(
    'aTreeOrigin',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  cardGeometry.setAttribute(
    'aWindVec',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  cardGeometry.setAttribute(
    'aAnchorPos',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  const cards = new THREE.InstancedMesh(
    cardGeometry,
    new THREE.MeshBasicMaterial(),
    capacity,
  ) as THREE.InstancedMesh & { userData: Record<string, unknown> };
  cards.userData.k = 1;
  cards.userData.srcMatrices = new Float32Array(new THREE.Matrix4().elements);
  cards.userData.weights = new Float32Array([0.7]);
  return { branches, cards: [cards] };
}

const exactColorSource = makeLodSet(2);
exactColorSource.cards[0].geometry.setAttribute(
  'aPeriodicCardValue',
  new THREE.InstancedBufferAttribute(new Float32Array([0.625, 0.625]), 1),
);
const exactThickness = exactColorSource.cards[0].geometry.getAttribute(
  'aThickness',
) as THREE.InstancedBufferAttribute;
exactThickness.setX(0, 0.4375);
exactThickness.setX(1, 0.8125);
const underlayGeometry = exactColorSource.cards[0].geometry.clone();
underlayGeometry.userData.crownUnderlay = true;
const underlay = new THREE.InstancedMesh(
  underlayGeometry,
  exactColorSource.cards[0].material,
  2,
) as THREE.InstancedMesh & { userData: Record<string, unknown> };
underlay.userData = {
  ...exactColorSource.cards[0].userData,
  crownUnderlay: true,
};
exactColorSource.cards.push(underlay);
const exactShadowClone = createSeedThreeExactShadowLodSet(
  exactColorSource,
  'test exact shadow',
);
assert.equal(exactShadowClone.cards.length, 1,
  'non-casting crown underlays must not allocate a shadow-only mesh');
const exactShadowThickness = exactShadowClone.cards[0].geometry.getAttribute(
  'aThickness',
) as THREE.InstancedBufferAttribute;
assert.notEqual(exactShadowThickness, exactThickness,
  'color and shadow need independent packed thickness buffers');
assert.equal(
  exactShadowClone.cards[0].geometry.getAttribute('aPeriodicCardValue'),
  exactColorSource.cards[0].geometry.getAttribute('aPeriodicCardValue'),
  'tree-periodic immutable card attributes should remain shared',
);
assert.deepEqual(
  Array.from(exactShadowThickness.array),
  Array.from(exactThickness.array),
  'independent thickness buffers must begin byte-identical',
);
assert.equal(
  exactShadowClone.cards[0].material,
  exactColorSource.cards[0].material,
  'color and shadow cards must share the exact animated alpha/material graph',
);
for (const attributeName of ['aTreeOrigin', 'aWindVec', 'aAnchorPos']) {
  const colorAttribute = exactColorSource.cards[0].geometry.getAttribute(attributeName);
  const shadowAttribute = exactShadowClone.cards[0].geometry.getAttribute(attributeName);
  assert.notEqual(shadowAttribute, colorAttribute,
    `${attributeName} must own an independent packed buffer`);
  assert.deepEqual(
    Array.from(shadowAttribute.array),
    Array.from(colorAttribute.array),
    `${attributeName} must begin byte-identical before independent compaction`,
  );
}

const nearSet = makeLodSet(2);
const overviewSet = makeLodSet(2);
const slot = (layoutIndex: number, x: number): SeedThreeTreeSlot => ({
  layoutIndex,
  matrix: new THREE.Matrix4().makeTranslation(x, 0, 0),
  pos: new THREE.Vector3(x, 0, 0),
  visibilityCenter: new THREE.Vector3(x, 4, 0),
  visibilityRadius: 5,
  enabled: true,
});
const slots = [slot(0, 10), slot(1, 20)];

assert.deepEqual(
  createSeedThreeStableColorSlotSelection([
    {},
    { forceOverview: true },
    {},
  ]),
  { near: [0, 1, 2], overview: [1] },
  'camera-independent color selection must retain every tree and preserve authored overview cards',
);

const exactParityJob = createSeedThreeBucketMatrixWriteJob(
  exactColorSource,
  { branches: null, cards: [] },
  slots,
  [0],
  [],
  { lodSet: exactShadowClone, selectedSlotIndices: [0] },
);
runSeedThreeBucketMatrixWriteSlices(exactParityJob, {
  deadlineMs: Number.POSITIVE_INFINITY,
  maxMatrixWritesPerChunk: Number.POSITIVE_INFINITY,
});
assert.deepEqual(
  Array.from(exactShadowClone.cards[0].instanceMatrix.array.slice(0, 16)),
  Array.from(exactColorSource.cards[0].instanceMatrix.array.slice(0, 16)),
  'matching color/shadow identities must publish byte-identical animated card transforms',
);
for (const attributeName of ['aTreeOrigin', 'aWindVec', 'aAnchorPos']) {
  assert.deepEqual(
    Array.from(exactShadowClone.cards[0].geometry.getAttribute(attributeName).array.slice(0, 3)),
    Array.from(exactColorSource.cards[0].geometry.getAttribute(attributeName).array.slice(0, 3)),
    `${attributeName} must keep the shadow silhouette welded to color foliage`,
  );
}

const offViewBeforeVisibleJob = createSeedThreeBucketMatrixWriteJob(
  exactColorSource,
  { branches: null, cards: [] },
  slots,
  [1],
  [],
  {
    lodSet: exactShadowClone,
    selectedSlotIndices: [0, 1],
    overviewSelectedSlotIndices: [],
  },
);
const exactThicknessVersionBeforeIdentityRemap = exactThickness.version;
runSeedThreeBucketMatrixWriteSlices(offViewBeforeVisibleJob, {
  deadlineMs: Number.POSITIVE_INFINITY,
  maxMatrixWritesPerChunk: Number.POSITIVE_INFINITY,
});
assert.equal(exactThickness.getX(0), 0.8125,
  'a visible tree compacted to color index zero must inherit its union-rank flutter phase');
assert.equal(exactShadowThickness.getX(1), 0.8125,
  'the same tree at shadow index one must retain the identical flutter phase');
assert.equal(
  exactThickness.version,
  exactThicknessVersionBeforeIdentityRemap + 1,
  'canonical thickness remapping must publish exactly one attribute version',
);
assert.deepEqual(
  exactThickness.updateRanges,
  [{ start: 0, count: 1 }],
  'canonical thickness remapping must upload only the exact packed prefix',
);
assert.deepEqual(
  Array.from(exactColorSource.cards[0].instanceMatrix.array.slice(0, 16)),
  Array.from(exactShadowClone.cards[0].instanceMatrix.array.slice(16, 32)),
  'off-view predecessors must not desynchronize the visible color/shadow transform',
);
for (const attributeName of ['aTreeOrigin', 'aWindVec', 'aAnchorPos']) {
  assert.deepEqual(
    Array.from(exactColorSource.cards[0].geometry.getAttribute(attributeName).array.slice(0, 3)),
    Array.from(exactShadowClone.cards[0].geometry.getAttribute(attributeName).array.slice(3, 6)),
    `${attributeName} must match by tree identity rather than packed destination index`,
  );
}

const exactThicknessVersionBeforeEmptyView = exactThickness.version;
const emptyColorJob = createSeedThreeBucketMatrixWriteJob(
  exactColorSource,
  { branches: null, cards: [] },
  slots,
  [],
  [],
  {
    lodSet: exactShadowClone,
    selectedSlotIndices: [0, 1],
    overviewSelectedSlotIndices: [],
    writeShadow: false,
  },
);
runSeedThreeBucketMatrixWriteSlices(emptyColorJob, {
  deadlineMs: Number.POSITIVE_INFINITY,
  maxMatrixWritesPerChunk: Number.POSITIVE_INFINITY,
});
assert.equal(
  exactThickness.version,
  exactThicknessVersionBeforeEmptyView,
  'an empty color selection must not bump or upload canonical thickness',
);

const stableColorSource = makeLodSet(3);
const stableColorThickness = stableColorSource.cards[0].geometry.getAttribute(
  'aThickness',
) as THREE.InstancedBufferAttribute;
stableColorThickness.setX(0, 0.2);
stableColorThickness.setX(1, 0.5);
stableColorThickness.setX(2, 0.9);
stableColorSource.cards[0].userData.seedThreeCanonicalThickness =
  stableColorThickness.clone();
const stableShadowSubset = createSeedThreeExactShadowLodSet(
  stableColorSource,
  'stable color shadow subset',
);
const stableColorSlots = [slot(0, 10), slot(1, 20), slot(2, 30)];
const stableColorJob = createSeedThreeBucketMatrixWriteJob(
  stableColorSource,
  { branches: null, cards: [] },
  stableColorSlots,
  [0, 1, 2],
  [],
  {
    lodSet: stableShadowSubset,
    selectedSlotIndices: [1],
    overviewSelectedSlotIndices: [],
  },
);
runSeedThreeBucketMatrixWriteSlices(stableColorJob, {
  deadlineMs: Number.POSITIVE_INFINITY,
  maxMatrixWritesPerChunk: Number.POSITIVE_INFINITY,
});
assert.deepEqual(
  Array.from(stableColorThickness.array.slice(0, 3)),
  [Math.fround(0.2), Math.fround(0.5), Math.fround(0.9)],
  'full color residency must keep canonical leaf attributes when the shadow selector retains only a subset',
);

const noPolicyChurnCamera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
noPolicyChurnCamera.position.set(0, 8, 80);
noPolicyChurnCamera.lookAt(0, 8, 0);
noPolicyChurnCamera.updateMatrixWorld(true);
const noPolicyChurnSelector = createForestLodSelector([
  { x: 0, y: 8, z: 0, radius: 6 },
], { minimumCameraMove: 1000 });
const noPolicyChurnInitial = selectForestLods(noPolicyChurnSelector, noPolicyChurnCamera, {
  force: true,
});
const noPolicyChurnRepeat = selectForestLods(
  noPolicyChurnSelector,
  noPolicyChurnCamera,
  { overviewElevationFloorBelowCamera: -36 } as never,
);
assert.equal(noPolicyChurnRepeat.skipped, true,
  'removed camera-elevation classification must not invalidate selector policy');
assert.equal(noPolicyChurnRepeat.revision, noPolicyChurnInitial.revision,
  'camera-elevation policy changes must not schedule an identical static-LOD repack');

const affineParitySet = makeLodSet(1);
const affineSlot: SeedThreeTreeSlot = {
  ...slot(0, 0),
  matrix: new THREE.Matrix4().compose(
    new THREE.Vector3(7.25, -1.5, 11.75),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      1.137,
    ),
    new THREE.Vector3(1.73, 1.73, 1.73),
  ),
  pos: new THREE.Vector3(7.25, -1.35, 11.75),
  seasonalDeciduous: true,
};
const affineCardSource = new THREE.Matrix4()
  .makeRotationX(-0.413)
  .setPosition(0.75, 5.5, -2.25);
affineParitySet.cards[0].userData.srcMatrices = new Float32Array(
  affineCardSource.elements,
);
affineParitySet.cards[0].userData.weights = new Float32Array([0.37]);
writeSeedThreeLodMatrices(affineParitySet, [affineSlot], [0]);
const expectedAffineCard = new THREE.Matrix4().multiplyMatrices(
  affineSlot.matrix,
  new THREE.Matrix4().fromArray(
    affineParitySet.cards[0].userData.srcMatrices as Float32Array,
  ),
);
assert.deepEqual(
  Array.from(affineParitySet.cards[0].instanceMatrix.array.slice(0, 16)),
  Array.from(new Float32Array(expectedAffineCard.elements)),
  'direct affine packing must be bit-identical to Matrix4 multiplication after Float32 upload',
);
assert.deepEqual(
  Array.from(affineParitySet.branches.instanceMatrix.array.slice(0, 16)),
  Array.from(new Float32Array(affineSlot.matrix.elements)),
  'direct branch packing must preserve the exact source transform bits',
);
assert.deepEqual(
  Array.from(
    affineParitySet.cards[0].geometry.getAttribute('aWindVec').array.slice(0, 3),
  ),
  [0, Math.fround(0.37), 0],
  'direct card metadata packing must preserve the source wind weight',
);

const genericParitySet = makeLodSet(1);
const projectiveCardSource = new Float32Array(affineCardSource.elements);
projectiveCardSource[3] = 0.125;
genericParitySet.cards[0].userData.srcMatrices = projectiveCardSource;
writeSeedThreeLodMatrices(genericParitySet, [affineSlot], [0]);
const expectedProjectiveCard = new THREE.Matrix4().multiplyMatrices(
  affineSlot.matrix,
  new THREE.Matrix4().fromArray(projectiveCardSource),
);
assert.deepEqual(
  Array.from(genericParitySet.cards[0].instanceMatrix.array.slice(0, 16)),
  Array.from(new Float32Array(expectedProjectiveCard.elements)),
  'non-affine source matrices must retain the exact generic Matrix4 result',
);

const staticOverviewIndices = new Set([1, 4]);
const staticLodFromFirstDistanceClassification = partitionSeedThreeSelectionByStaticLod(
  {
    nearIndices: [0, 1, 2],
    overviewIndices: [3, 4],
    viewIndices: [1, 2, 4],
  },
  (layoutIndex) => staticOverviewIndices.has(layoutIndex),
);
const staticLodFromOppositeDistanceClassification = partitionSeedThreeSelectionByStaticLod(
  {
    nearIndices: [3, 4],
    overviewIndices: [0, 1, 2],
    viewIndices: [1, 2, 4],
  },
  (layoutIndex) => staticOverviewIndices.has(layoutIndex),
);
const staticLodFromOppositeView = partitionSeedThreeSelectionByStaticLod(
  {
    nearIndices: [0, 1, 2],
    overviewIndices: [3, 4],
    viewIndices: [0, 3],
  },
  (layoutIndex) => staticOverviewIndices.has(layoutIndex),
);
assert.deepEqual(
  staticLodFromFirstDistanceClassification,
  staticLodFromOppositeDistanceClassification,
  'camera-distance classifications must not alter any retained tree static LOD identity',
);
assert.deepEqual(
  {
    near: staticLodFromFirstDistanceClassification.nearIndices,
    overview: staticLodFromFirstDistanceClassification.overviewIndices,
  },
  {
    near: staticLodFromOppositeView.nearIndices,
    overview: staticLodFromOppositeView.overviewIndices,
  },
  'camera direction must not reorder the exact shadow-resident union',
);
assert.deepEqual(staticLodFromFirstDistanceClassification, {
  nearIndices: [0, 2, 3],
  overviewIndices: [1, 4],
  nearViewIndices: [2],
  overviewViewIndices: [1, 4],
  nearViewCount: 1,
  overviewViewCount: 2,
}, 'static LOD partitioning must separate the padded color guard from shadow residents');
assert.deepEqual(
  {
    nearView: staticLodFromOppositeView.nearViewIndices,
    overviewView: staticLodFromOppositeView.overviewViewIndices,
  },
  { nearView: [0, 3], overviewView: [] },
  'camera direction should update only the color guard identities',
);
assert.deepEqual(
  [
    ...staticLodFromFirstDistanceClassification.nearIndices,
    ...staticLodFromFirstDistanceClassification.overviewIndices,
  ].sort((left, right) => left - right),
  [0, 1, 2, 3, 4],
  'static LOD restoration must neither add nor remove selected trees',
);

const residentBuckets = [{
  nearSlotIndices: [0, 1],
  overviewSlotIndices: [2],
  nearViewSlotIndices: [0],
  overviewViewSlotIndices: [2],
}];
const residentLayoutMappings = [
  { bucketIndex: 0, slotIndex: 0 },
  { bucketIndex: 0, slotIndex: 1 },
  { bucketIndex: 0, slotIndex: 2 },
  { bucketIndex: 0, slotIndex: 3 },
];
assert.equal(
  seedThreeResidentSelectionCoversView(
    residentBuckets,
    residentLayoutMappings,
    [2],
  ),
  true,
  'a tree already resident for shadows must cover the color view without a repack',
);
assert.equal(
  seedThreeColorSelectionCoversView(
    residentBuckets,
    residentLayoutMappings,
    [2],
  ),
  true,
  'the color guard should cover explicitly packed overview identities',
);
assert.equal(
  seedThreeColorSelectionCoversView(
    residentBuckets,
    residentLayoutMappings,
    [1],
  ),
  false,
  'a shadow-only resident must not be mistaken for color coverage',
);
assert.equal(
  seedThreeResidentSelectionCoversView(
    residentBuckets,
    residentLayoutMappings,
    [3],
  ),
  false,
  'a genuinely uncovered view tree must still request a resident-buffer update',
);

writeSeedThreeLodMatrices(nearSet, slots, [0]);
writeSeedThreeLodMatrices(overviewSet, slots, [1]);
assert.equal(nearSet.branches.count, 1, 'near bucket should submit one tree');
assert.equal(nearSet.cards[0].count, 1, 'near card bucket should submit one tree');
assert.equal(overviewSet.branches.count, 1, 'overview bucket should submit one tree');
assert.equal(overviewSet.cards[0].count, 1, 'overview card bucket should submit one tree');

const mainCamera = new THREE.PerspectiveCamera();
const shadowCamera = new THREE.OrthographicCamera();
const passColorSet = makeLodSet(2);
const passShadowSet = makeLodSet(2);
configureSeedThreeForestPassMesh(passColorSet.branches, 'color', true);
configureSeedThreeForestPassMesh(passColorSet.cards[0], 'color', true);
configureSeedThreeForestPassMesh(passShadowSet.branches, 'shadow', true);
configureSeedThreeForestPassMesh(passShadowSet.cards[0], 'shadow', true);
const passJob = createSeedThreeBucketMatrixWriteJob(
  passColorSet,
  makeLodSet(2),
  slots,
  [0],
  [],
  { lodSet: passShadowSet, selectedSlotIndices: [0, 1] },
);
runSeedThreeBucketMatrixWriteSlices(passJob, {
  deadlineMs: Number.POSITIVE_INFINITY,
  maxMatrixWritesPerChunk: Number.POSITIVE_INFINITY,
});
assert.equal(passColorSet.branches.count, 1,
  'the color mesh must submit only its padded view guard');
assert.equal(passShadowSet.branches.count, 2,
  'the shadow mesh must retain the complete exact caster union');
assert.equal(passColorSet.branches.castShadow, false,
  'the color mesh must never enter the shadow pass');
assert.equal(passColorSet.branches.receiveShadow, true,
  'the color mesh must retain authored received lighting');
assert.equal(passShadowSet.branches.castShadow, true,
  'the shadow-only mesh must preserve exact tree casting');
assert.equal(passShadowSet.branches.receiveShadow, false,
  'the shadow-only mesh must not compile unused received-lighting work');
assert.equal(passColorSet.branches.layers.isEnabled(1), false,
  'the main-camera tree mesh must remain off the shadow-only layer');
assert.equal(passShadowSet.branches.layers.mask, 1 << 1,
  'the exact caster must be isolated on the directional-shadow layer');
passColorSet.branches.onBeforeRender(
  {} as THREE.WebGLRenderer,
  new THREE.Scene(),
  mainCamera,
  passColorSet.branches.geometry,
  passColorSet.branches.material as THREE.Material,
  {} as THREE.Group,
);
passShadowSet.branches.onBeforeRender(
  {} as THREE.WebGLRenderer,
  new THREE.Scene(),
  shadowCamera,
  passShadowSet.branches.geometry,
  passShadowSet.branches.material as THREE.Material,
  {} as THREE.Group,
);
assert.equal(passColorSet.branches.count, 1,
  'render callbacks must never mutate the stable color count');
assert.equal(passShadowSet.branches.count, 2,
  'render callbacks must never mutate the stable shadow count');
const branchTrianglesPerInstance = passColorSet.branches.geometry.index!.count / 3;
const colorTriangles = passColorSet.branches.count * branchTrianglesPerInstance;
const shadowTriangles = passShadowSet.branches.count * branchTrianglesPerInstance;
assert.equal(colorTriangles, branchTrianglesPerInstance,
  'the color pass must submit exactly the padded view guard');
assert.equal(shadowTriangles, branchTrianglesPerInstance * 2,
  'the shadow pass must preserve exact conservative triangle coverage');
assert.equal(shadowTriangles - colorTriangles, branchTrianglesPerInstance,
  'only the shadow-only off-camera suffix may leave the foliage-lighting pass');

slots[0]!.enabled = false;
assert.equal(
  enabledSeedThreeTreeCountInPrefix(slots, [0, 1], 2),
  1,
  'pass counts must exclude disabled gameplay trees without changing selection identity',
);
slots[0]!.enabled = true;
const activeDraws = (): number => [
  nearSet.branches,
  ...nearSet.cards,
  overviewSet.branches,
  ...overviewSet.cards,
].filter((mesh) => mesh.count > 0).length;
assert.equal(activeDraws(), 4,
  'disjoint near and overview bands should each issue one branch/card pair');

const chunkNearSet = makeLodSet(2);
const chunkOverviewSet = makeLodSet(2);
const chunkShadowSet = makeLodSet(2);
writeSeedThreeLodMatrices(chunkNearSet, slots, [0]);
writeSeedThreeLodMatrices(chunkOverviewSet, slots, [1]);
writeSeedThreeLodMatrices(chunkShadowSet, slots, [1]);
const chunkedJob = createSeedThreeBucketMatrixWriteJob(
  chunkNearSet,
  chunkOverviewSet,
  slots,
  [0, 1],
  [],
  { lodSet: chunkShadowSet, selectedSlotIndices: [0, 1] },
);
const firstChunk = runSeedThreeBucketMatrixWriteChunk(chunkedJob, {
  deadlineMs: Number.POSITIVE_INFINITY,
  maxMatrixWrites: 1,
});
assert.equal(firstChunk.completed, false);
assert.equal(firstChunk.matrixWrites, 1);
assert.equal(
  chunkNearSet.branches.count,
  1,
  'an incomplete within-species chunk must keep the previous coherent GPU count',
);
assert.equal(
  chunkOverviewSet.branches.count,
  1,
  'near and overview meshes must commit atomically at bucket completion',
);
assert.equal(
  chunkShadowSet.branches.count,
  1,
  'color and shadow objects must keep their previous coherent counts until atomic completion',
);
let chunkCalls = 1;
while (!chunkedJob.completed && chunkCalls < 16) {
  runSeedThreeBucketMatrixWriteChunk(chunkedJob, {
    deadlineMs: Number.POSITIVE_INFINITY,
    maxMatrixWrites: 1,
  });
  chunkCalls += 1;
}
assert.equal(chunkedJob.completed, true, 'within-species chunks must converge');
assert.ok(chunkCalls > 1, 'a species bucket must span multiple bounded chunks');
assert.equal(chunkNearSet.branches.count, 2);
assert.equal(chunkNearSet.cards[0].count, 2);
assert.equal(chunkOverviewSet.branches.count, 0);
assert.equal(chunkOverviewSet.cards[0].count, 0);
assert.equal(chunkShadowSet.branches.count, 2);
assert.equal(chunkShadowSet.cards[0].count, 2);

const multiSliceSlots = Array.from(
  { length: 129 },
  (_, index) => slot(index, index * 2),
);
const multiSliceNearSet = makeLodSet(multiSliceSlots.length);
const multiSliceOverviewSet = makeLodSet(multiSliceSlots.length);
multiSliceNearSet.branches.count = 7;
multiSliceNearSet.cards[0].count = 7;
multiSliceOverviewSet.branches.count = 3;
multiSliceOverviewSet.cards[0].count = 3;
const emptyOverviewMatrixVersion =
  multiSliceOverviewSet.branches.instanceMatrix.version;
const emptyOverviewOriginVersion =
  multiSliceOverviewSet.cards[0].geometry.getAttribute('aTreeOrigin').version;
const multiSliceJob = createSeedThreeBucketMatrixWriteJob(
  multiSliceNearSet,
  multiSliceOverviewSet,
  multiSliceSlots,
  multiSliceSlots.map((_, index) => index),
  [],
);
const multiSliceResult = runSeedThreeBucketMatrixWriteSlices(
  multiSliceJob,
  {
    deadlineMs: Number.POSITIVE_INFINITY,
    maxMatrixWritesPerChunk: 128,
  },
);
assert.equal(multiSliceResult.completed, true);
assert.equal(multiSliceResult.chunks, 3);
assert.equal(multiSliceResult.matrixWrites, multiSliceSlots.length * 2);
assert.equal(
  multiSliceResult.maxMatrixWritesInChunk,
  128,
  'the game adapter must preserve the upstream fine-slice bound',
);
assert.equal(multiSliceNearSet.branches.count, multiSliceSlots.length);
assert.equal(multiSliceNearSet.cards[0].count, multiSliceSlots.length);
assert.equal(multiSliceOverviewSet.branches.count, 0);
assert.equal(multiSliceOverviewSet.cards[0].count, 0);
assert.deepEqual(
  multiSliceNearSet.branches.instanceMatrix.updateRanges,
  [{ start: 0, count: multiSliceSlots.length * 16 }],
  'forest matrix uploads must cover only the exact packed visible prefix',
);
assert.deepEqual(
  multiSliceNearSet.branches.geometry.getAttribute('aWindVec').updateRanges,
  [{ start: 0, count: multiSliceSlots.length * 3 }],
  'branch wind uploads must cover only the exact packed visible prefix',
);
assert.deepEqual(
  multiSliceNearSet.cards[0].geometry.getAttribute('aTreeOrigin').updateRanges,
  [{ start: 0, count: multiSliceSlots.length * 3 }],
  'card metadata uploads must cover only the exact packed visible prefix',
);
assert.deepEqual(
  multiSliceOverviewSet.branches.instanceMatrix.updateRanges,
  [],
  'a zero-count LOD task must not schedule a buffer transfer',
);
assert.equal(
  multiSliceOverviewSet.branches.instanceMatrix.version,
  emptyOverviewMatrixVersion,
  'a zero-count LOD task must preserve the last published matrix version',
);
assert.deepEqual(
  multiSliceOverviewSet.cards[0].geometry.getAttribute('aTreeOrigin').updateRanges,
  [],
  'zero-count card metadata must not schedule a buffer transfer',
);
assert.equal(
  multiSliceOverviewSet.cards[0].geometry.getAttribute('aTreeOrigin').version,
  emptyOverviewOriginVersion,
  'zero-count card metadata must preserve the last published version',
);

const frozenSelection: SeedThreeBucketSelection[] = Array.from(
  { length: 8 },
  (_, index) => ({ near: [index], overview: [] }),
);
assert.deepEqual(
  planForestBucketUpdates(frozenSelection, frozenSelection, [], 1),
  { uploadBucketIndices: [], pendingBucketIndices: [] },
  'a frozen deterministic camera must schedule no forest buffer work',
);
assert.deepEqual(
  planForestBucketUpdates(
    [{ near: [0, 1], overview: [], viewNear: [0], viewOverview: [] }],
    [{ near: [0, 1], overview: [], viewNear: [1], viewOverview: [] }],
    [],
    1,
  ),
  { uploadBucketIndices: [0], pendingBucketIndices: [] },
  'a changed color guard must compact even when the exact shadow union is unchanged',
);

const activeSelection: SeedThreeBucketSelection[] = frozenSelection.map(
  (_, index) => ({ near: [], overview: [index] }),
);
let currentSelection = frozenSelection.map((selection) => ({
  near: [...selection.near],
  overview: [...selection.overview],
}));
let pendingBucketIndices: number[] = [];
let largestUploadBurst = 0;
for (let frame = 0; frame < 8; frame += 1) {
  const plan = planForestBucketUpdates(
    currentSelection,
    activeSelection,
    pendingBucketIndices,
    1,
  );
  largestUploadBurst = Math.max(largestUploadBurst, plan.uploadBucketIndices.length);
  for (const bucketIndex of plan.uploadBucketIndices) {
    currentSelection[bucketIndex] = {
      near: [...activeSelection[bucketIndex]!.near],
      overview: [...activeSelection[bucketIndex]!.overview],
    };
  }
  pendingBucketIndices = plan.pendingBucketIndices;
}
assert.equal(largestUploadBurst, 1, 'active traversal must upload at most one species bucket per frame');
assert.deepEqual(
  currentSelection,
  activeSelection,
  'bounded forest work must converge without dropping or duplicating selected trees',
);
assert.deepEqual(pendingBucketIndices, []);

const coalescedSelection: SeedThreeBucketSelection[] = activeSelection.map(
  (selection, index) => (
    index === 7 ? { near: [7], overview: [] } : selection
  ),
);
const stalePending = [3, 4, 5, 6, 7];
const coalescedPlan = planForestBucketUpdates(
  currentSelection,
  coalescedSelection,
  stalePending,
  1,
);
assert.deepEqual(
  coalescedPlan,
  { uploadBucketIndices: [7], pendingBucketIndices: [] },
  'new route semantics must cancel stale pending uploads and converge on the latest selection',
);

const matrix = new THREE.Matrix4();
nearSet.branches.getMatrixAt(0, matrix);
assert.equal(matrix.elements[12], 10, 'near compaction should preserve source transform');
overviewSet.cards[0].getMatrixAt(0, matrix);
assert.equal(matrix.elements[12], 20, 'overview compaction should preserve source transform');

slots[0]!.enabled = false;
writeSeedThreeLodMatrices(nearSet, slots, [0]);
writeSeedThreeLodMatrices(overviewSet, slots, [1]);
assert.equal(nearSet.branches.count, 0, 'harvested near tree must stay hidden after compaction');
assert.equal(nearSet.cards[0].count, 0, 'harvested near foliage must stay hidden after compaction');
assert.equal(overviewSet.branches.count, 1, 'hiding a near tree must not disturb overview trees');
assert.equal(activeDraws(), 2,
  'zero-count harvested meshes must not contribute structural draws');

slots[0]!.enabled = true;
writeSeedThreeLodMatrices(nearSet, slots, [0]);
assert.equal(nearSet.branches.count, 1, 'restored tree should return to its selected LOD band');
nearSet.branches.getMatrixAt(0, matrix);
assert.equal(matrix.elements[12], 10, 'restored tree should recover its exact source transform');

const companionSet = makeLodSet(1);
const companion: SeedThreeTreeSlot = {
  ...slot(0, 14),
  visibilityParent: slots[0],
};
writeSeedThreeLodMatrices(companionSet, [companion], [0]);
assert.equal(companionSet.cards[0].count, 1,
  'render-only canopy companion should follow a visible gameplay tree');
slots[0]!.enabled = false;
writeSeedThreeLodMatrices(companionSet, [companion], [0]);
assert.equal(companionSet.cards[0].count, 0,
  'harvesting a gameplay tree must also hide its render-only canopy companions');
slots[0]!.enabled = true;

for (const set of [
  nearSet,
  overviewSet,
  chunkNearSet,
  chunkOverviewSet,
  chunkShadowSet,
  multiSliceNearSet,
  multiSliceOverviewSet,
  passColorSet,
  passShadowSet,
  affineParitySet,
  genericParitySet,
  exactColorSource,
  exactShadowClone,
]) {
  set.branches.geometry.dispose();
  (set.branches.material as THREE.Material).dispose();
  for (const cards of set.cards) {
    cards.geometry.dispose();
    (cards.material as THREE.Material).dispose();
  }
}
companionSet.branches.geometry.dispose();
(companionSet.branches.material as THREE.Material).dispose();
for (const cards of companionSet.cards) {
  cards.geometry.dispose();
  (cards.material as THREE.Material).dispose();
}
console.log('test:seedthree-forest-compaction passed');
