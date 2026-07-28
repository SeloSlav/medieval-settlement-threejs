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

/** Runtime adapter so ForestManager never statically imports SeedThree (Node-safe). */
export type SeedThreeForestController = {
  hideTree(layoutIndex: number): void;
  showTree(layoutIndex: number): void;
  commit(): void;
  updateCamera(
    camera: Camera,
    firstPersonActive: boolean,
    casterBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  ): boolean;
  getStructuralStats(): SeedThreeForestStructuralStats;
  setDeciduousFoliage(presentation: DeciduousFoliagePresentation): void;
  setShadows(enabled: boolean): void;
  dispose(): void;
};
