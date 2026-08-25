export type ForestFloorOwnedPlacement = {
  sourceTreeIndex: number;
};

export type ForestFloorPlacementMask<T extends ForestFloorOwnedPlacement> = {
  placementIndicesByTree: number[][];
  setTreeActive(treeIndex: number, active: boolean): boolean;
  setPlacementActive(placementIndex: number, active: boolean): boolean;
  refreshBlockedMask(
    isBlocked: (placement: T, placementIndex: number) => boolean,
    shouldEvaluate?: (placement: T, placementIndex: number) => boolean,
  ): number;
  isTreeActive(treeIndex: number): boolean;
  isPlacementActive(placementIndex: number): boolean;
  isPlacementVisible(placementIndex: number): boolean;
};

/**
 * Forest-floor props have two independent visibility owners: the live tree
 * that spawned them and the road/building/parcel/field footprint at their own
 * offset position. Keeping both masks prevents restoring a source tree from
 * resurrecting a child prop inside a cleared site.
 */
export function createForestFloorPlacementMask<T extends ForestFloorOwnedPlacement>(
  placements: readonly T[],
  treeCount: number,
  onVisibilityChanged: (placementIndex: number, visible: boolean) => void,
): ForestFloorPlacementMask<T> {
  const placementIndicesByTree = Array.from(
    { length: treeCount },
    () => [] as number[],
  );
  placements.forEach((placement, placementIndex) => {
    placementIndicesByTree[placement.sourceTreeIndex]?.push(placementIndex);
  });
  const treeActive = Array.from({ length: treeCount }, () => true);
  const placementActive = placements.map(() => true);
  const placementVisible = placements.map(() => true);

  const applyPlacementVisibility = (placementIndex: number): boolean => {
    const placement = placements[placementIndex];
    if (!placement) return false;
    const visible = treeActive[placement.sourceTreeIndex] === true
      && placementActive[placementIndex] === true;
    if (placementVisible[placementIndex] === visible) return false;
    placementVisible[placementIndex] = visible;
    onVisibilityChanged(placementIndex, visible);
    return true;
  };

  return {
    placementIndicesByTree,
    setTreeActive(treeIndex: number, active: boolean): boolean {
      if (!Number.isInteger(treeIndex) || treeIndex < 0 || treeIndex >= treeActive.length) {
        return false;
      }
      if (treeActive[treeIndex] === active) return false;
      treeActive[treeIndex] = active;
      for (const placementIndex of placementIndicesByTree[treeIndex] ?? []) {
        applyPlacementVisibility(placementIndex);
      }
      return true;
    },
    setPlacementActive(placementIndex: number, active: boolean): boolean {
      if (
        !Number.isInteger(placementIndex)
        || placementIndex < 0
        || placementIndex >= placementActive.length
      ) {
        return false;
      }
      if (placementActive[placementIndex] === active) return false;
      placementActive[placementIndex] = active;
      applyPlacementVisibility(placementIndex);
      return true;
    },
    refreshBlockedMask(isBlocked, shouldEvaluate): number {
      let changed = 0;
      for (let placementIndex = 0; placementIndex < placements.length; placementIndex++) {
        const placement = placements[placementIndex]!;
        if (shouldEvaluate && !shouldEvaluate(placement, placementIndex)) continue;
        const active = !isBlocked(placement, placementIndex);
        if (placementActive[placementIndex] === active) continue;
        placementActive[placementIndex] = active;
        applyPlacementVisibility(placementIndex);
        changed++;
      }
      return changed;
    },
    isTreeActive(treeIndex: number): boolean {
      return treeActive[treeIndex] === true;
    },
    isPlacementActive(placementIndex: number): boolean {
      return placementActive[placementIndex] === true;
    },
    isPlacementVisible(placementIndex: number): boolean {
      return placementVisible[placementIndex] === true;
    },
  };
}
