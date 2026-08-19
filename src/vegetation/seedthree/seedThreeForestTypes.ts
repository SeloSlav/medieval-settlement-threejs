import type { Camera } from 'three';
import type { DeciduousFoliagePresentation } from '../../world/deciduousFoliagePolicy.ts';

export type SeedThreeForestStructuralStats = {
  draws: number;
  triangles: number;
  instances: number;
  ecology: {
    counts: {
      anchors: number;
      saplings: number;
      understory: number;
      deadwood: number;
      litter: number;
    };
    draws: number;
    instances: number;
    triangles: number;
  };
  trees: {
    totalTrees: number;
    visibleTrees: number;
    nearTrees: number;
    overviewTrees: number;
    culledTrees: number;
    revision: number;
  };
};

export type SeedThreeForestSubmissionStats = {
  draws: number;
  triangles: number;
  instances: number;
};

/** One-shot profiler evidence; never sampled by the production frame loop. */
export type SeedThreeForestProfileBreakdown = {
  paddedColorTrees: number;
  criticalColorTrees: number;
  residentColor: SeedThreeForestSubmissionStats;
  submittedColor: SeedThreeForestSubmissionStats;
  criticalProjectedColor: SeedThreeForestSubmissionStats;
  submittedPasses: {
    near: SeedThreeForestSubmissionStats;
    crownUnderlay: SeedThreeForestSubmissionStats;
    overview: SeedThreeForestSubmissionStats;
  };
};

export type SeedThreeForestCameraUpdateResult = {
  presentationChanged: boolean;
  shadowCastersChanged: boolean;
};

/** Runtime adapter so ForestManager never statically imports SeedThree (Node-safe). */
export type SeedThreeForestController = {
  hideTree(layoutIndex: number): void;
  showTree(layoutIndex: number): void;
  commit(): void;
  updateCamera(
    camera: Camera,
    cameraDistance: number,
    firstPersonActive: boolean,
    casterBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    cameraInteractionActive?: boolean,
    deltaSeconds?: number,
  ): SeedThreeForestCameraUpdateResult;
  getStructuralStats(): SeedThreeForestStructuralStats;
  getProfileBreakdown(): SeedThreeForestProfileBreakdown;
  setDeciduousFoliage(presentation: DeciduousFoliagePresentation): void;
  setSnowCoverage(coverage: number): void;
  setDistantCanopyCardsEnabled(enabled: boolean): void;
  setShadows(enabled: boolean): void;
  dispose(): void;
};
