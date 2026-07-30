import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createSeedThreeBucketMatrixWriteJob,
  runSeedThreeBucketMatrixWriteChunk,
  runSeedThreeBucketMatrixWriteSlices,
  writeSeedThreeLodMatrices,
  type SeedThreeTreeSlot,
} from '../src/vegetation/seedthree/seedThreeForestCompaction.ts';
import { stabilizeSeedThreeForestCardMaterial } from '../src/vegetation/seedthree/seedThreeForestMaterial.ts';
import {
  planForestBucketUpdates,
} from '../vendor/seedthree/src/core/forest-update-budget.js';

type SeedThreeBucketSelection = {
  near: readonly number[];
  overview: readonly number[];
};

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

writeSeedThreeLodMatrices(nearSet, slots, [0]);
writeSeedThreeLodMatrices(overviewSet, slots, [1]);
assert.equal(nearSet.branches.count, 1, 'near bucket should submit one tree');
assert.equal(nearSet.cards[0].count, 1, 'near card bucket should submit one tree');
assert.equal(overviewSet.branches.count, 1, 'overview bucket should submit one tree');
assert.equal(overviewSet.cards[0].count, 1, 'overview card bucket should submit one tree');
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
