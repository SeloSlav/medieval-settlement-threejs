import * as THREE from 'three';
import {
  createInstanceMatrixWriteJob,
  runInstanceMatrixWriteChunk,
  runInstanceMatrixWriteSlices,
  type InstanceMatrixWriteChunkResult,
  type InstanceMatrixWriteJob,
  type InstanceMatrixWriteSlicesResult,
} from '@seedthree/core/instance-matrix-chunks.js';
import { TREE_SHADOW_CAST_LAYER } from '../../scene/SceneLayers.ts';

const DECIDUOUS_TREE_ORIGIN_Y_OFFSET = 2048;
const HIDDEN_TREE_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

export type SeedThreeTreeSlot = {
  layoutIndex: number;
  /** Immutable authored transform used to restore a stable hidden slot. */
  authoredMatrix?: THREE.Matrix4;
  /** Runtime transform; zero-scaled while gameplay-hidden. */
  matrix: THREE.Matrix4;
  pos: THREE.Vector3;
  visibilityCenter: THREE.Vector3;
  visibilityRadius: number;
  enabled: boolean;
  /** Static low-detail assignment for remote terrain-edge trees. */
  forceOverview?: boolean;
  /** Broadleaf or larch instance eligible for seasonal color and leaf drop. */
  seasonalDeciduous?: boolean;
  /** Render-only crowns inherit the visibility/harvest state of a gameplay tree. */
  visibilityParent?: SeedThreeTreeSlot;
};

export type SeedThreeInstancedLodSet = {
  branches: THREE.InstancedMesh | null;
  cards: Array<THREE.InstancedMesh & { userData: Record<string, unknown> }>;
};

/** Keep color and shadow draw state immutable across WebGPU render passes. */
export function configureSeedThreeForestPassMesh(
  mesh: THREE.InstancedMesh,
  pass: 'color' | 'shadow',
  castsTreeSilhouette: boolean,
): void {
  const shadowOnly = pass === 'shadow';
  mesh.castShadow = shadowOnly && castsTreeSilhouette;
  mesh.receiveShadow = !shadowOnly;
  mesh.userData.neverCastShadow = !castsTreeSilhouette || !shadowOnly;
  mesh.userData.seedThreeShadowOnly = shadowOnly;
  if (shadowOnly) mesh.layers.set(TREE_SHADOW_CAST_LAYER);
  else mesh.layers.disable(TREE_SHADOW_CAST_LAYER);
}

/**
 * Clone only attributes whose packed value can differ between the color and
 * shadow selections. Static vertex geometry is shared. `aThickness` drives
 * both SSS and flutter phase, so it begins as a byte-identical clone and color
 * compaction copies its canonical shadow-union rank to keep silhouettes exact.
 */
export function createSeedThreeExactShadowLodSet(
  colorSet: SeedThreeInstancedLodSet,
  debugName: string,
): SeedThreeInstancedLodSet {
  const shadowSet: SeedThreeInstancedLodSet = { branches: null, cards: [] };
  if (colorSet.branches) {
    const source = colorSet.branches;
    const geometry = cloneForestGeometryForIndependentPacking(
      source.geometry,
      ['aWindVec', 'aAnchorPos'],
    );
    const mesh = new THREE.InstancedMesh(
      geometry,
      source.material,
      source.instanceMatrix.count,
    );
    mesh.name = `${debugName} branches`;
    mesh.frustumCulled = false;
    configureSeedThreeForestPassMesh(mesh, 'shadow', true);
    shadowSet.branches = mesh;
  }
  for (const source of colorSet.cards) {
    if (source.userData.crownUnderlay === true) continue;
    const geometry = cloneForestGeometryForIndependentPacking(
      source.geometry,
      ['aThickness', 'aTreeOrigin', 'aWindVec', 'aAnchorPos'],
    );
    const mesh = new THREE.InstancedMesh(
      geometry,
      source.material,
      source.instanceMatrix.count,
    ) as THREE.InstancedMesh & { userData: Record<string, unknown> };
    mesh.name = `${debugName} cards`;
    mesh.frustumCulled = false;
    mesh.userData.src = source.userData.src;
    mesh.userData.k = source.userData.k;
    mesh.userData.srcMatrices = source.userData.srcMatrices;
    mesh.userData.weights = source.userData.weights;
    mesh.userData.crownUnderlay = false;
    mesh.userData.seedThreeColorSource = source;
    configureSeedThreeForestPassMesh(mesh, 'shadow', true);
    shadowSet.cards.push(mesh);
  }
  return shadowSet;
}

function cloneForestGeometryForIndependentPacking(
  source: THREE.BufferGeometry,
  mutableAttributeNames: readonly string[],
): THREE.BufferGeometry {
  const mutable = new Set(mutableAttributeNames);
  const geometry = new THREE.BufferGeometry();
  geometry.name = source.name;
  geometry.userData = { ...source.userData, forestClone: true };
  if (source.index) geometry.setIndex(source.index);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    geometry.setAttribute(
      name,
      mutable.has(name)
        ? attribute.clone()
        : attribute,
    );
  }
  for (const group of source.groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  return geometry;
}

export type SeedThreeResidentBucketSelection = {
  nearSlotIndices: readonly number[];
  overviewSlotIndices: readonly number[];
  nearViewSlotIndices?: readonly number[];
  overviewViewSlotIndices?: readonly number[];
};

export type SeedThreeLayoutSlotMapping = {
  bucketIndex: number;
  slotIndex: number;
};

/** Camera-independent color identities for the world-resident LOD2 layer. */
export function createSeedThreeStableColorSlotSelection(
  slots: readonly Pick<SeedThreeTreeSlot, 'forceOverview'>[],
): { near: number[]; overview: number[] } {
  const near = slots.map((_, slotIndex) => slotIndex);
  const overview = slots.flatMap((slot, slotIndex) =>
    slot.forceOverview ? [slotIndex] : []);
  return { near, overview };
}

/** Camera-independent caster identities used by the strategic shadow atlas. */
export function createSeedThreeStableRtsShadowSlotSelection(
  slots: readonly Pick<SeedThreeTreeSlot, 'forceOverview'>[],
): { near: number[]; overview: number[] } {
  return createSeedThreeStableColorSlotSelection(slots);
}

type PassPartitionedInstancedMesh = THREE.InstancedMesh & {
  userData: Record<string, unknown> & {
    forestPassCountsInstalled?: boolean;
    forestViewInstanceCount?: number;
    forestShadowInstanceCount?: number;
  };
};

export type SeedThreeBucketMatrixWriteJob = {
  readonly core: InstanceMatrixWriteJob;
  readonly nearSet: SeedThreeInstancedLodSet;
  readonly overviewSet: SeedThreeInstancedLodSet;
  readonly shadowSet: SeedThreeInstancedLodSet | null;
  readonly slots: readonly SeedThreeTreeSlot[];
  readonly nearViewSlotIndices: readonly number[];
  readonly overviewViewSlotIndices: readonly number[];
  readonly nearResidentSlotIndices: readonly number[];
  readonly overviewResidentSlotIndices: readonly number[];
  readonly writeColor: boolean;
  readonly writeShadow: boolean;
  readonly realignColorAttributes: boolean;
  readonly preserveDisabledSlots: boolean;
  readonly attributeVersions: Map<THREE.BufferAttribute, number>;
  completed: boolean;
  uploadRangesPublished: boolean;
};
export type SeedThreeMatrixWriteChunkResult = InstanceMatrixWriteChunkResult;
export type SeedThreeMatrixWriteSlicesResult = InstanceMatrixWriteSlicesResult;

const EMPTY_LOD_SET: SeedThreeInstancedLodSet = {
  branches: null,
  cards: [],
};

/**
 * Game adapter boundary: SeedThree owns resumable branch/card buffer writes.
 * This game only supplies harvest visibility and its packed deciduous-origin bit.
 */
export function createSeedThreeBucketMatrixWriteJob(
  nearSet: SeedThreeInstancedLodSet,
  overviewSet: SeedThreeInstancedLodSet,
  slots: SeedThreeTreeSlot[],
  nearSlotIndices: readonly number[],
  overviewSlotIndices: readonly number[],
  shadow?: {
    lodSet: SeedThreeInstancedLodSet;
    selectedSlotIndices: readonly number[];
    overviewSelectedSlotIndices?: readonly number[];
    writeColor?: boolean;
    writeShadow?: boolean;
    realignColorAttributes?: boolean;
    /**
     * Keep every selected tree at a stable instance rank and represent
     * gameplay-hidden trees with a zero-scale matrix. This makes later
     * visibility changes sparse buffer patches instead of full compactions.
     */
    preserveDisabledSlots?: boolean;
  },
): SeedThreeBucketMatrixWriteJob {
  const writeColor = shadow?.writeColor !== false;
  const writeShadow = shadow !== undefined && shadow.writeShadow !== false;
  const realignColorAttributes = shadow?.realignColorAttributes ?? writeColor;
  const preserveDisabledSlots = shadow?.preserveDisabledSlots === true;
  const core = createInstanceMatrixWriteJob(
    writeColor ? nearSet : EMPTY_LOD_SET,
    writeColor ? overviewSet : EMPTY_LOD_SET,
    slots,
    nearSlotIndices,
    overviewSlotIndices,
    {
      // These attributes are zero-filled at mesh creation and this compactor is
      // their sole writer; only the Y wind weight varies per packed instance.
      windXZInitializedZero: true,
      isSlotVisible: preserveDisabledSlots
        ? () => true
        : (slot) => slotIsVisible(slot),
      resolveTreeOriginY: (slot) => (
        slot.pos.y + (slot.seasonalDeciduous
          ? DECIDUOUS_TREE_ORIGIN_Y_OFFSET
          : 0)
      ),
      additionalSelections: shadow && writeShadow ? [{
        lodSet: shadow.lodSet,
        selectedSlotIndices: shadow.selectedSlotIndices,
      }] : [],
    },
  );
  return {
    core,
    nearSet,
    overviewSet,
    shadowSet: shadow?.lodSet ?? null,
    slots,
    nearViewSlotIndices: nearSlotIndices,
    overviewViewSlotIndices: overviewSlotIndices,
    nearResidentSlotIndices: shadow?.selectedSlotIndices ?? nearSlotIndices,
    overviewResidentSlotIndices:
      shadow?.overviewSelectedSlotIndices ?? overviewSlotIndices,
    writeColor,
    writeShadow,
    realignColorAttributes,
    preserveDisabledSlots,
    attributeVersions: snapshotLodAttributeVersions(
      writeColor ? nearSet : EMPTY_LOD_SET,
      writeColor ? overviewSet : EMPTY_LOD_SET,
      writeShadow ? shadow?.lodSet : undefined,
    ),
    completed: core.completed,
    uploadRangesPublished: false,
  };
}

export function runSeedThreeBucketMatrixWriteChunk(
  job: SeedThreeBucketMatrixWriteJob,
  options: {
    deadlineMs: number;
    maxMatrixWrites: number;
    now?: () => number;
  },
): SeedThreeMatrixWriteChunkResult {
  const result = runInstanceMatrixWriteChunk(job.core, options);
  job.completed = result.completed;
  if (result.completed) publishExactLodUploadRanges(job);
  return result;
}

export function runSeedThreeBucketMatrixWriteSlices(
  job: SeedThreeBucketMatrixWriteJob,
  options: {
    deadlineMs: number;
    minimumChunkHeadroomMs?: number;
    maxChunks?: number;
    maxMatrixWritesPerChunk: number;
    now?: () => number;
  },
): SeedThreeMatrixWriteSlicesResult {
  const result = runInstanceMatrixWriteSlices(job.core, options);
  job.completed = result.completed;
  if (result.completed) publishExactLodUploadRanges(job);
  return result;
}

export function writeSeedThreeLodMatrices(
  lodSet: SeedThreeInstancedLodSet,
  slots: SeedThreeTreeSlot[],
  selectedSlotIndices: readonly number[],
): void {
  const job = createSeedThreeBucketMatrixWriteJob(
    lodSet,
    EMPTY_LOD_SET,
    slots,
    selectedSlotIndices,
    [],
  );
  runSeedThreeBucketMatrixWriteChunk(job, {
    deadlineMs: Number.POSITIVE_INFINITY,
    maxMatrixWrites: Number.POSITIVE_INFINITY,
  });
}

/**
 * Patch only the instance matrices owned by changed gameplay trees.
 *
 * Forest runtime buffers use stable selected-slot ranks. Hidden trees keep
 * their rank and receive a zero-scale transform, so removing a handful of
 * trees never shifts or rewrites the rest of a species bucket. Per-instance
 * wind/origin attributes remain valid and do not need to be uploaded again.
 */
export function patchSeedThreeLodSlotVisibility(
  lodSet: SeedThreeInstancedLodSet,
  slots: readonly SeedThreeTreeSlot[],
  selectedSlotIndices: readonly number[],
  dirtySlotIndices: Iterable<number>,
): number {
  const dirtyRanks: Array<{ rank: number; slot: SeedThreeTreeSlot }> = [];
  for (const slotIndex of dirtySlotIndices) {
    const rank = sortedIndicesIndexOf(selectedSlotIndices, slotIndex);
    const slot = slots[slotIndex];
    if (rank < 0 || !slot) continue;
    dirtyRanks.push({ rank, slot });
  }
  if (dirtyRanks.length === 0) return 0;
  dirtyRanks.sort((left, right) => left.rank - right.rank);

  let matrixWrites = 0;
  if (lodSet.branches) {
    const target = lodSet.branches.instanceMatrix.array as Float32Array;
    for (const { rank, slot } of dirtyRanks) {
      const matrix = slotIsVisible(slot) ? slot.matrix : HIDDEN_TREE_MATRIX;
      target.set(matrix.elements, rank * 16);
      matrixWrites += 1;
    }
    publishSparseMatrixRanges(
      lodSet.branches.instanceMatrix,
      dirtyRanks.map(({ rank }) => rank),
      1,
    );
  }

  const sourceMatrix = new THREE.Matrix4();
  const composedMatrix = new THREE.Matrix4();
  for (const mesh of lodSet.cards) {
    const cardsPerTree = Math.max(0, Math.floor(Number(mesh.userData.k) || 0));
    if (cardsPerTree === 0) continue;
    const target = mesh.instanceMatrix.array as Float32Array;
    const sourceMatrices = mesh.userData.srcMatrices as Float32Array | undefined;
    if (!sourceMatrices) continue;
    for (const { rank, slot } of dirtyRanks) {
      const targetStart = rank * cardsPerTree;
      if (!slotIsVisible(slot)) {
        for (let cardIndex = 0; cardIndex < cardsPerTree; cardIndex += 1) {
          target.set(HIDDEN_TREE_MATRIX.elements, (targetStart + cardIndex) * 16);
        }
      } else {
        for (let cardIndex = 0; cardIndex < cardsPerTree; cardIndex += 1) {
          sourceMatrix.fromArray(sourceMatrices, cardIndex * 16);
          composedMatrix.multiplyMatrices(slot.matrix, sourceMatrix);
          target.set(composedMatrix.elements, (targetStart + cardIndex) * 16);
        }
      }
      matrixWrites += cardsPerTree;
    }
    publishSparseMatrixRanges(
      mesh.instanceMatrix,
      dirtyRanks.map(({ rank }) => rank),
      cardsPerTree,
    );
  }
  return matrixWrites;
}

function publishSparseMatrixRanges(
  attribute: THREE.InstancedBufferAttribute,
  sortedTreeRanks: readonly number[],
  instancesPerTree: number,
): void {
  if (sortedTreeRanks.length === 0) return;
  let rangeStart = sortedTreeRanks[0]!;
  let previousRank = rangeStart;
  for (let index = 1; index <= sortedTreeRanks.length; index += 1) {
    const rank = sortedTreeRanks[index];
    if (rank === previousRank + 1) {
      previousRank = rank;
      continue;
    }
    attribute.addUpdateRange(
      rangeStart * instancesPerTree * 16,
      (previousRank - rangeStart + 1) * instancesPerTree * 16,
    );
    if (rank === undefined) break;
    rangeStart = rank;
    previousRank = rank;
  }
  attribute.needsUpdate = true;
}

/**
 * Keep one immutable conservative instance count for color and shadow passes.
 * WebGPU can snapshot instance state outside Three's per-object callbacks, so
 * changing this count between passes is unsafe. The selector already bounds
 * the resident set; the GPU clips individual off-screen instances.
 */
export function updateSeedThreeLodPassInstanceCounts(
  lodSet: SeedThreeInstancedLodSet,
  viewTreeCount: number,
): void {
  if (lodSet.branches) {
    updateMeshPassInstanceCounts(lodSet.branches, viewTreeCount);
  }
  for (const mesh of lodSet.cards) {
    const cardsPerTree = Math.max(0, Number(mesh.userData.k) || 0);
    updateMeshPassInstanceCounts(mesh, viewTreeCount * cardsPerTree);
  }
}

export function enabledSeedThreeTreeCountInPrefix(
  slots: readonly SeedThreeTreeSlot[],
  selectedSlotIndices: readonly number[],
  prefixLength: number,
): number {
  const end = Math.min(selectedSlotIndices.length, Math.max(0, prefixLength));
  let count = 0;
  for (let index = 0; index < end; index += 1) {
    const slot = slots[selectedSlotIndices[index]!];
    if (slot?.enabled && slot.visibilityParent?.enabled !== false) count += 1;
  }
  return count;
}

export function partitionSeedThreeSelectionByStaticLod(
  selection: {
    nearIndices: readonly number[];
    overviewIndices: readonly number[];
    viewIndices: readonly number[];
  },
  forceOverview: (layoutIndex: number) => boolean,
  includeForcedOverviewInNear = false,
): {
  nearIndices: number[];
  overviewIndices: number[];
  nearViewIndices: number[];
  overviewViewIndices: number[];
  nearViewCount: number;
  overviewViewCount: number;
} {
  // SeedThree's selector owns only conservative inclusion. Its near/overview
  // arrays are distance classifications, while this app's visual identity is
  // authored once per placement through forceOverview. Re-form the exact
  // selected union in layout order, then restore every retained tree to that
  // immutable authored LOD. Camera-frustum membership must not affect packing:
  // lateral/backward motion otherwise promotes an already-resident shadow
  // caster to the front and rewrites the live WebGPU instance buffer.
  const selectedIndices = mergeSortedUniqueIndices(
    selection.nearIndices,
    selection.overviewIndices,
  );
  const nearIndices: number[] = [];
  const overviewIndices: number[] = [];
  const nearViewIndices: number[] = [];
  const overviewViewIndices: number[] = [];
  let viewCursor = 0;
  for (const layoutIndex of selectedIndices) {
    while (
      viewCursor < selection.viewIndices.length
      && selection.viewIndices[viewCursor]! < layoutIndex
    ) {
      viewCursor += 1;
    }
    const inView = selection.viewIndices[viewCursor] === layoutIndex;
    if (forceOverview(layoutIndex)) {
      overviewIndices.push(layoutIndex);
      if (inView) overviewViewIndices.push(layoutIndex);
      if (includeForcedOverviewInNear) {
        nearIndices.push(layoutIndex);
        if (inView) nearViewIndices.push(layoutIndex);
      }
    } else {
      nearIndices.push(layoutIndex);
      if (inView) nearViewIndices.push(layoutIndex);
    }
  }
  return {
    nearIndices,
    overviewIndices,
    nearViewIndices,
    overviewViewIndices,
    nearViewCount: nearViewIndices.length,
    overviewViewCount: overviewViewIndices.length,
  };
}

/**
 * Test actual view identities against the complete conservative resident set.
 * A tree already packed for the shadow envelope also covers the color view in
 * the immutable-count WebGPU path, regardless of its position in the buffer.
 */
export function seedThreeResidentSelectionCoversView(
  residentBuckets: readonly SeedThreeResidentBucketSelection[],
  slotByLayoutIndex: readonly (SeedThreeLayoutSlotMapping | null)[],
  desiredViewLayoutIndices: readonly number[],
): boolean {
  for (const layoutIndex of desiredViewLayoutIndices) {
    const mapping = slotByLayoutIndex[layoutIndex];
    if (!mapping) continue;
    const bucket = residentBuckets[mapping.bucketIndex];
    if (
      !bucket
      || (!sortedIndicesInclude(bucket.nearSlotIndices, mapping.slotIndex)
        && !sortedIndicesInclude(bucket.overviewSlotIndices, mapping.slotIndex))
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Test a view against the stable color-only buffers rather than the narrower
 * directional-shadow resident union. The color buffers carry the full forest,
 * so camera motion can never expose an unpacked tree identity.
 */
export function seedThreeColorSelectionCoversView(
  residentBuckets: readonly SeedThreeResidentBucketSelection[],
  slotByLayoutIndex: readonly (SeedThreeLayoutSlotMapping | null)[],
  desiredViewLayoutIndices: readonly number[],
): boolean {
  for (const layoutIndex of desiredViewLayoutIndices) {
    const mapping = slotByLayoutIndex[layoutIndex];
    if (!mapping) continue;
    const bucket = residentBuckets[mapping.bucketIndex];
    if (
      !bucket
      || (!sortedIndicesInclude(bucket.nearViewSlotIndices ?? [], mapping.slotIndex)
        && !sortedIndicesInclude(bucket.overviewViewSlotIndices ?? [], mapping.slotIndex))
    ) {
      return false;
    }
  }
  return true;
}

function mergeSortedUniqueIndices(
  left: readonly number[],
  right: readonly number[],
): number[] {
  const merged: number[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    const leftValue = left[leftIndex] ?? Number.POSITIVE_INFINITY;
    const rightValue = right[rightIndex] ?? Number.POSITIVE_INFINITY;
    const value = Math.min(leftValue, rightValue);
    if (merged[merged.length - 1] !== value) merged.push(value);
    if (leftValue === value) leftIndex += 1;
    if (rightValue === value) rightIndex += 1;
  }
  return merged;
}

function sortedIndicesInclude(indices: readonly number[], value: number): boolean {
  return sortedIndicesIndexOf(indices, value) >= 0;
}

function sortedIndicesIndexOf(indices: readonly number[], value: number): number {
  let low = 0;
  let high = indices.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candidate = indices[middle]!;
    if (candidate === value) return middle;
    if (candidate < value) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

function updateMeshPassInstanceCounts(
  sourceMesh: THREE.InstancedMesh,
  viewInstanceCount: number,
): void {
  const mesh = sourceMesh as PassPartitionedInstancedMesh;
  const shadowInstanceCount = mesh.count;
  mesh.userData.forestViewInstanceCount = Math.min(
    shadowInstanceCount,
    Math.max(0, Math.floor(viewInstanceCount)),
  );
  mesh.userData.forestShadowInstanceCount = shadowInstanceCount;
  // Keep the proven conservative prefix resident for both passes. WebGPU can
  // snapshot instance state outside per-object callbacks; temporarily lowering
  // and restoring `count` there lets one frame observe another pass's value.
  // A stable conservative count preserves the known-good workload and buffers
  // while the camera frustum clips off-screen instances normally.
  mesh.count = shadowInstanceCount;
}

function snapshotLodAttributeVersions(
  nearSet: SeedThreeInstancedLodSet,
  overviewSet: SeedThreeInstancedLodSet,
  shadowSet?: SeedThreeInstancedLodSet,
): Map<THREE.BufferAttribute, number> {
  const versions = new Map<THREE.BufferAttribute, number>();
  forEachLodAttribute(nearSet, (attribute) => versions.set(attribute, attribute.version));
  forEachLodAttribute(overviewSet, (attribute) => versions.set(attribute, attribute.version));
  if (shadowSet) {
    forEachLodAttribute(shadowSet, (attribute) => versions.set(attribute, attribute.version));
  }
  return versions;
}

/**
 * SeedThree compaction packs every completed draw into the start of its
 * preallocated attributes. Its portable core marks the whole capacity dirty;
 * narrow that publication to the exact packed prefix before Three sees it.
 * Zero-count LOD tasks publish only a count change, so undo their otherwise
 * redundant attribute-version bumps. Draw counts and buffer contents are
 * identical to the full upload path.
 */
function publishExactLodUploadRanges(job: SeedThreeBucketMatrixWriteJob): void {
  if (job.uploadRangesPublished) return;
  if (job.realignColorAttributes) alignColorCardInstanceAttributes(job);
  if (job.writeColor) {
    publishLodSetUploadRanges(job.nearSet, job.attributeVersions);
    publishLodSetUploadRanges(job.overviewSet, job.attributeVersions);
  }
  if (job.shadowSet && job.writeShadow) {
    publishLodSetUploadRanges(job.shadowSet, job.attributeVersions);
  }
  job.uploadRangesPublished = true;
}

function alignColorCardInstanceAttributes(job: SeedThreeBucketMatrixWriteJob): void {
  const shadowContainsEveryNearColorSlot = job.shadowSet !== null
    && job.nearViewSlotIndices.every((slotIndex) =>
      sortedIndicesInclude(job.nearResidentSlotIndices, slotIndex));
  alignLodCardInstanceAttributes(
    job.nearSet,
    shadowContainsEveryNearColorSlot ? job.shadowSet : null,
    job.slots,
    job.nearViewSlotIndices,
    job.nearResidentSlotIndices,
    job.preserveDisabledSlots,
  );
  alignLodCardInstanceAttributes(
    job.overviewSet,
    null,
    job.slots,
    job.overviewViewSlotIndices,
    job.overviewResidentSlotIndices,
    job.preserveDisabledSlots,
  );
}

function alignLodCardInstanceAttributes(
  lodSet: SeedThreeInstancedLodSet,
  canonicalLodSet: SeedThreeInstancedLodSet | null,
  slots: readonly SeedThreeTreeSlot[],
  viewSlotIndices: readonly number[],
  residentSlotIndices: readonly number[],
  preserveDisabledSlots: boolean,
): void {
  if (lodSet.cards.length === 0) return;
  const residentRankBySlot = canonicalLodSet
    ? buildResidentRankBySlot(slots, residentSlotIndices, preserveDisabledSlots)
    : null;
  for (const mesh of lodSet.cards) {
    const cardsPerTree = Math.max(0, Number(mesh.userData.k) || 0);
    if (cardsPerTree === 0) continue;
    const targetAttribute = mesh.geometry.getAttribute('aThickness');
    if (!(targetAttribute as THREE.InstancedBufferAttribute | undefined)?.isInstancedBufferAttribute) {
      continue;
    }
    const target = targetAttribute as THREE.InstancedBufferAttribute;
    const shadowSource = canonicalLodSet?.cards.find(
      (candidate) => candidate.userData.seedThreeColorSource === mesh,
    );
    const source = shadowSource
      ? shadowSource.geometry.getAttribute('aThickness')
      : canonicalCardThickness(mesh);
    if (!source) continue;
    let viewRank = 0;
    for (const slotIndex of viewSlotIndices) {
      const slot = slots[slotIndex];
      if (!slot || (!preserveDisabledSlots && !slotIsVisible(slot))) continue;
      const sourceTreeRank = residentRankBySlot
        ? residentRankBySlot[slotIndex]
        : slotIndex;
      if (sourceTreeRank === undefined || sourceTreeRank < 0) {
        throw new Error(`Color forest slot ${slotIndex} is absent from its resident union.`);
      }
      const sourceOffset = sourceTreeRank * cardsPerTree;
      const targetOffset = viewRank * cardsPerTree;
      for (let cardIndex = 0; cardIndex < cardsPerTree; cardIndex += 1) {
        target.array[targetOffset + cardIndex] = source.array[sourceOffset + cardIndex]!;
      }
      viewRank++;
    }
    target.clearUpdateRanges();
    if (viewRank > 0) {
      target.addUpdateRange(0, viewRank * cardsPerTree);
      target.needsUpdate = true;
    }
  }
}

function buildResidentRankBySlot(
  slots: readonly SeedThreeTreeSlot[],
  residentSlotIndices: readonly number[],
  preserveDisabledSlots: boolean,
): Int32Array {
  const residentRankBySlot = new Int32Array(slots.length);
  residentRankBySlot.fill(-1);
  let residentRank = 0;
  for (const slotIndex of residentSlotIndices) {
    const slot = slots[slotIndex];
    if (!slot || (!preserveDisabledSlots && !slotIsVisible(slot))) continue;
    residentRankBySlot[slotIndex] = residentRank++;
  }
  return residentRankBySlot;
}

function canonicalCardThickness(
  mesh: THREE.InstancedMesh & { userData: Record<string, unknown> },
): THREE.InstancedBufferAttribute | null {
  const cached = mesh.userData.seedThreeCanonicalThickness;
  if (cached instanceof THREE.InstancedBufferAttribute) return cached;
  const thickness = mesh.geometry.getAttribute('aThickness');
  if (!(thickness as THREE.InstancedBufferAttribute | undefined)?.isInstancedBufferAttribute) {
    return null;
  }
  const canonical = thickness.clone() as THREE.InstancedBufferAttribute;
  mesh.userData.seedThreeCanonicalThickness = canonical;
  return canonical;
}

function slotIsVisible(slot: SeedThreeTreeSlot): boolean {
  return slot.enabled && slot.visibilityParent?.enabled !== false;
}

function publishLodSetUploadRanges(
  lodSet: SeedThreeInstancedLodSet,
  previousVersions: ReadonlyMap<THREE.BufferAttribute, number>,
): void {
  if (lodSet.branches) {
    publishMeshUploadRanges(
      lodSet.branches,
      ['aWindVec', 'aAnchorPos'],
      previousVersions,
    );
  }
  for (const mesh of lodSet.cards) {
    publishMeshUploadRanges(
      mesh,
      ['aTreeOrigin', 'aWindVec', 'aAnchorPos'],
      previousVersions,
    );
  }
}

function publishMeshUploadRanges(
  mesh: THREE.InstancedMesh,
  attributeNames: readonly string[],
  previousVersions: ReadonlyMap<THREE.BufferAttribute, number>,
): void {
  publishAttributePrefix(mesh.instanceMatrix, mesh.count, previousVersions);
  for (const attributeName of attributeNames) {
    const attribute = mesh.geometry.getAttribute(attributeName) as
      | THREE.BufferAttribute
      | undefined;
    if (attribute) publishAttributePrefix(attribute, mesh.count, previousVersions);
  }
}

function publishAttributePrefix(
  attribute: THREE.BufferAttribute,
  itemCount: number,
  previousVersions: ReadonlyMap<THREE.BufferAttribute, number>,
): void {
  attribute.clearUpdateRanges();
  if (itemCount > 0) {
    attribute.addUpdateRange(0, itemCount * attribute.itemSize);
    return;
  }
  const previousVersion = previousVersions.get(attribute);
  if (previousVersion !== undefined) attribute.version = previousVersion;
}

function forEachLodAttribute(
  lodSet: SeedThreeInstancedLodSet,
  visit: (attribute: THREE.BufferAttribute) => void,
): void {
  if (lodSet.branches) {
    visit(lodSet.branches.instanceMatrix);
    visit(lodSet.branches.geometry.getAttribute('aWindVec') as THREE.BufferAttribute);
    visit(lodSet.branches.geometry.getAttribute('aAnchorPos') as THREE.BufferAttribute);
  }
  for (const mesh of lodSet.cards) {
    visit(mesh.instanceMatrix);
    visit(mesh.geometry.getAttribute('aTreeOrigin') as THREE.BufferAttribute);
    visit(mesh.geometry.getAttribute('aWindVec') as THREE.BufferAttribute);
    visit(mesh.geometry.getAttribute('aAnchorPos') as THREE.BufferAttribute);
  }
}
