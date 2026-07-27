import type { Camera } from 'three';

export type SeedThreeForestStructuralStats = {
  draws: number;
  triangles: number;
  instances: number;
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
  setShadows(enabled: boolean): void;
  dispose(): void;
};
