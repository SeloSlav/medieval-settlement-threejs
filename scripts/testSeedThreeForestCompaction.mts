import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createSeedThreeBucketMatrixWriteJob,
  enabledSeedThreeTreeCountInPrefix,
  partitionSeedThreeSelectionByStaticLod,
  partitionSeedThreeSelectionByView,
  runSeedThreeBucketMatrixWriteChunk,
  runSeedThreeBucketMatrixWriteSlices,
  updateSeedThreeLodPassInstanceCounts,
  writeSeedThreeLodMatrices,
  type SeedThreeTreeSlot,
} from '../src/vegetation/seedthree/seedThreeForestCompaction.ts';
import { stabilizeSeedThreeForestCardMaterial } from '../src/vegetation/seedthree/seedThreeForestMaterial.ts';
import { planSeedThreeForestInteractionWork } from '../src/vegetation/seedthree/seedThreeForestInteraction.ts';
import {
  planForestBucketUpdates,
} from '../vendor/seedthree/src/core/forest-update-budget.js';

type SeedThreeBucketSelection = {
  near: readonly number[];
  overview: readonly number[];
};

assert.deepEqual(
  planSeedThreeForestInteractionWork(false, true, true),
  { deferCoveredWork: true, completeImmediately: false },
  'covered forest compaction should remain stable while pointer navigation is active',
);
assert.deepEqual(
  planSeedThreeForestInteractionWork(true, false, true),
  { deferCoveredWork: false, completeImmediately: true },
  'pointer release should publish the final covered forest selection atomically',
);
assert.deepEqual(
  planSeedThreeForestInteractionWork(false, true, false),
  { deferCoveredWork: false, completeImmediately: true },
  'an uncovered moving view must be filled immediately instead of showing a gap',
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

const passPartition = partitionSeedThreeSelectionByView(
  [0, 1, 2, 3, 4],
  new Set([1, 3]),
);
assert.deepEqual(passPartition, {
  orderedIndices: [1, 3, 0, 2, 4],
  viewCount: 2,
}, 'view-visible trees must form a stable prefix ahead of shadow-only casters');
assert.deepEqual(
  [...passPartition.orderedIndices].sort((a, b) => a - b),
  [0, 1, 2, 3, 4],
  'pass partitioning must preserve the exact conservative selected set',
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
assert.deepEqual(
  staticLodFromFirstDistanceClassification,
  staticLodFromOppositeDistanceClassification,
  'camera-distance classifications must not alter any retained tree static LOD identity',
);
assert.deepEqual(staticLodFromFirstDistanceClassification, {
  nearIndices: [2, 0, 3],
  overviewIndices: [1, 4],
  nearViewCount: 1,
  overviewViewCount: 2,
}, 'static LOD partitioning must retain the exact selected union and view prefixes');
assert.deepEqual(
  [
    ...staticLodFromFirstDistanceClassification.nearIndices,
    ...staticLodFromFirstDistanceClassification.overviewIndices,
  ].sort((left, right) => left - right),
  [0, 1, 2, 3, 4],
  'static LOD restoration must neither add nor remove selected trees',
);

writeSeedThreeLodMatrices(nearSet, slots, [0]);
writeSeedThreeLodMatrices(overviewSet, slots, [1]);
assert.equal(nearSet.branches.count, 1, 'near bucket should submit one tree');
assert.equal(nearSet.cards[0].count, 1, 'near card bucket should submit one tree');
assert.equal(overviewSet.branches.count, 1, 'overview bucket should submit one tree');
assert.equal(overviewSet.cards[0].count, 1, 'overview card bucket should submit one tree');

updateSeedThreeLodPassInstanceCounts(nearSet, 0);
const mainCamera = new THREE.PerspectiveCamera();
mainCamera.layers.disable(1);
const shadowCamera = new THREE.OrthographicCamera();
shadowCamera.layers.enable(1);
const invokeBeforeRender = (mesh: THREE.InstancedMesh, camera: THREE.Camera): void => {
  mesh.onBeforeRender(
    {} as THREE.WebGLRenderer,
    new THREE.Scene(),
    camera,
    mesh.geometry,
    mesh.material as THREE.Material,
    null,
  );
};
const invokeAfterRender = (mesh: THREE.InstancedMesh, camera: THREE.Camera): void => {
  mesh.onAfterRender(
    {} as THREE.WebGLRenderer,
    new THREE.Scene(),
    camera,
    mesh.geometry,
    mesh.material as THREE.Material,
    null,
  );
};
invokeBeforeRender(nearSet.branches, mainCamera);
assert.equal(nearSet.branches.count, 0,
  'the color camera must omit the shadow-only branch suffix');
invokeAfterRender(nearSet.branches, mainCamera);
assert.equal(nearSet.branches.count, 1,
  'the complete conservative caster prefix must be restored after color submission');
invokeBeforeRender(nearSet.branches, shadowCamera);
assert.equal(nearSet.branches.count, 1,
  'the directional shadow camera must retain every conservative caster');
invokeAfterRender(nearSet.branches, shadowCamera);

const passParitySet = makeLodSet(2);
writeSeedThreeLodMatrices(passParitySet, slots, [0, 1]);
updateSeedThreeLodPassInstanceCounts(passParitySet, 1);
const branchTrianglesPerInstance = passParitySet.branches.geometry.index!.count / 3;
invokeBeforeRender(passParitySet.branches, mainCamera);
const colorTriangles = passParitySet.branches.count * branchTrianglesPerInstance;
invokeAfterRender(passParitySet.branches, mainCamera);
invokeBeforeRender(passParitySet.branches, shadowCamera);
const shadowTriangles = passParitySet.branches.count * branchTrianglesPerInstance;
invokeAfterRender(passParitySet.branches, shadowCamera);
assert.equal(colorTriangles, branchTrianglesPerInstance,
  'the color pass must submit exactly the view-visible tree prefix');
assert.equal(shadowTriangles, branchTrianglesPerInstance * 2,
  'the shadow pass must preserve exact conservative triangle coverage');
assert.equal(
  colorTriangles + branchTrianglesPerInstance,
  shadowTriangles,
  'the only removed color triangles must be the deterministic shadow-only suffix',
);

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
writeSeedThreeLodMatrices(chunkNearSet, slots, [0]);
writeSeedThreeLodMatrices(chunkOverviewSet, slots, [1]);
const chunkedJob = createSeedThreeBucketMatrixWriteJob(
  chunkNearSet,
  chunkOverviewSet,
  slots,
  [0, 1],
  [],
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
  multiSliceNearSet,
  multiSliceOverviewSet,
  passParitySet,
  affineParitySet,
  genericParitySet,
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
