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
 * Keep the conservative view + shadow-caster compaction as one GPU buffer, but
 * submit only its view-visible prefix to the color camera. The directional
 * shadow camera has TREE_SHADOW_CAST_LAYER enabled and continues to submit the
 * complete conservative caster prefix. No placement, LOD, material, or shadow
 * coverage changes; this only prevents shadow-only instances from leaking into
 * color/post scene passes through the aggregate frustum-disabled mesh.
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

export function partitionSeedThreeSelectionByView(
  selectedIndices: readonly number[],
  viewIndices: ReadonlySet<number>,
): { orderedIndices: number[]; viewCount: number } {
  const orderedIndices: number[] = [];
  for (const index of selectedIndices) {
    if (viewIndices.has(index)) orderedIndices.push(index);
  }
  const viewCount = orderedIndices.length;
  for (const index of selectedIndices) {
    if (!viewIndices.has(index)) orderedIndices.push(index);
  }
  return { orderedIndices, viewCount };
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
  // selected union, partition view-visible trees ahead of shadow-only casters,
  // then restore every retained tree to that immutable authored LOD.
  const selectedIndices = [
    ...selection.nearIndices,
    ...selection.overviewIndices,
  ].sort((left, right) => left - right);
  const partition = partitionSeedThreeSelectionByView(
    selectedIndices,
    new Set(selection.viewIndices),
  );
  const nearIndices: number[] = [];
  const overviewIndices: number[] = [];
  let nearViewCount = 0;
  let overviewViewCount = 0;
  for (let index = 0; index < partition.orderedIndices.length; index += 1) {
    const layoutIndex = partition.orderedIndices[index]!;
    const viewVisible = index < partition.viewCount;
    if (forceOverview(layoutIndex)) {
      overviewIndices.push(layoutIndex);
      if (viewVisible) overviewViewCount += 1;
      if (includeForcedOverviewInNear) {
        nearIndices.push(layoutIndex);
        if (viewVisible) nearViewCount += 1;
      }
    } else {
      nearIndices.push(layoutIndex);
      if (viewVisible) nearViewCount += 1;
    }
  }
  return {
    nearIndices,
    overviewIndices,
    nearViewCount,
    overviewViewCount,
  };
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
  // Leave the externally observable count at the complete compacted prefix.
  // The render hooks narrow it only for the duration of a color draw.
  mesh.count = shadowInstanceCount;
  if (mesh.userData.forestPassCountsInstalled) return;
  mesh.userData.forestPassCountsInstalled = true;
  const previousBeforeRender = mesh.onBeforeRender;
  const previousAfterRender = mesh.onAfterRender;
  mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
    const shadowCount = Number(mesh.userData.forestShadowInstanceCount) || 0;
    const viewCount = Number(mesh.userData.forestViewInstanceCount) || 0;
    mesh.count = camera.layers.isEnabled(TREE_SHADOW_CAST_LAYER)
      ? shadowCount
      : viewCount;
    previousBeforeRender.call(mesh, renderer, scene, camera, geometry, material, group);
  };
  mesh.onAfterRender = (renderer, scene, camera, geometry, material, group) => {
    mesh.count = Number(mesh.userData.forestShadowInstanceCount) || 0;
    previousAfterRender.call(mesh, renderer, scene, camera, geometry, material, group);
  };
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
