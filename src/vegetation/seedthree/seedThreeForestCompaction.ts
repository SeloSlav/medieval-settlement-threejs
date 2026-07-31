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

export type SeedThreeBucketMatrixWriteJob = InstanceMatrixWriteJob;
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
  return createInstanceMatrixWriteJob(
    nearSet,
    overviewSet,
    slots,
    nearSlotIndices,
    overviewSlotIndices,
    {
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
}

export function runSeedThreeBucketMatrixWriteChunk(
  job: SeedThreeBucketMatrixWriteJob,
  options: {
    deadlineMs: number;
    maxMatrixWrites: number;
    now?: () => number;
  },
): SeedThreeMatrixWriteChunkResult {
  return runInstanceMatrixWriteChunk(job, options);
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
  return runInstanceMatrixWriteSlices(job, options);
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
