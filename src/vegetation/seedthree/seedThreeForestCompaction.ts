import * as THREE from 'three';
import {
  createInstanceMatrixWriteJob,
  runInstanceMatrixWriteChunk,
  runInstanceMatrixWriteSlices,
  type InstanceMatrixWriteChunkResult,
  type InstanceMatrixWriteJob,
  type InstanceMatrixWriteSlicesResult,
} from '@seedthree/core/instance-matrix-chunks.js';

const DECIDUOUS_TREE_ORIGIN_Y_OFFSET = 2048;

export type SeedThreeTreeSlot = {
  layoutIndex: number;
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

export type SeedThreeResidentBucketSelection = {
  nearSlotIndices: readonly number[];
  overviewSlotIndices: readonly number[];
};

export type SeedThreeLayoutSlotMapping = {
  bucketIndex: number;
  slotIndex: number;
};

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
): SeedThreeBucketMatrixWriteJob {
  const core = createInstanceMatrixWriteJob(
    nearSet,
    overviewSet,
    slots,
    nearSlotIndices,
    overviewSlotIndices,
    {
      // These attributes are zero-filled at mesh creation and this compactor is
      // their sole writer; only the Y wind weight varies per packed instance.
      windXZInitializedZero: true,
      isSlotVisible: (slot) => (
        slot.enabled && slot.visibilityParent?.enabled !== false
      ),
      resolveTreeOriginY: (slot) => (
        slot.pos.y + (slot.seasonalDeciduous
          ? DECIDUOUS_TREE_ORIGIN_Y_OFFSET
          : 0)
      ),
    },
  );
  return {
    core,
    nearSet,
    overviewSet,
    attributeVersions: snapshotLodAttributeVersions(nearSet, overviewSet),
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
  const selectedIndices = [...new Set([
    ...selection.nearIndices,
    ...selection.overviewIndices,
  ])].sort((left, right) => left - right);
  const nearIndices: number[] = [];
  const overviewIndices: number[] = [];
  for (const layoutIndex of selectedIndices) {
    if (forceOverview(layoutIndex)) {
      overviewIndices.push(layoutIndex);
      if (includeForcedOverviewInNear) {
        nearIndices.push(layoutIndex);
      }
    } else {
      nearIndices.push(layoutIndex);
    }
  }
  return {
    nearIndices,
    overviewIndices,
    // The current WebGPU path deliberately uses the same conservative resident
    // prefix for color and shadow passes. Report the complete stable prefixes
    // so coverage checks do not schedule a redundant frustum-only repack.
    nearViewCount: nearIndices.length,
    overviewViewCount: overviewIndices.length,
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
  const residentSlotsByBucket = residentBuckets.map((bucket) => new Set([
    ...bucket.nearSlotIndices,
    ...bucket.overviewSlotIndices,
  ]));
  for (const layoutIndex of desiredViewLayoutIndices) {
    const mapping = slotByLayoutIndex[layoutIndex];
    if (!mapping) continue;
    if (!residentSlotsByBucket[mapping.bucketIndex]?.has(mapping.slotIndex)) {
      return false;
    }
  }
  return true;
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
): Map<THREE.BufferAttribute, number> {
  const versions = new Map<THREE.BufferAttribute, number>();
  forEachLodAttribute(nearSet, (attribute) => versions.set(attribute, attribute.version));
  forEachLodAttribute(overviewSet, (attribute) => versions.set(attribute, attribute.version));
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
  publishLodSetUploadRanges(job.nearSet, job.attributeVersions);
  publishLodSetUploadRanges(job.overviewSet, job.attributeVersions);
  job.uploadRangesPublished = true;
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
