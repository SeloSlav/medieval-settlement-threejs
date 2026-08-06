export type SeedThreeForestIndexSelection = {
  nearIndices: readonly number[];
  overviewIndices: readonly number[];
  viewIndices: readonly number[];
};

export type SeedThreeForestVisibilityItem = {
  x: number;
  z: number;
  radius: number;
  forceOverview?: boolean;
};

/**
 * Keep a bounded 360-degree color set around a first-person camera.
 *
 * The upstream selector correctly retains off-axis trees for shadows, but
 * normally packs them after the color-visible prefix. Pointer-look can then
 * promote the same nearby tree from that suffix into the prefix and rewrite a
 * species instance buffer. Treating the walking bubble as color-visible keeps
 * those matrices in one stable prefix; the GPU clips trees outside the lens.
 */
export function retainSeedThreeFirstPersonView(
  selection: SeedThreeForestIndexSelection,
  items: readonly SeedThreeForestVisibilityItem[],
  cameraPosition: { x: number; z: number },
  retentionRadius: number,
): SeedThreeForestIndexSelection {
  const radius = Number.isFinite(retentionRadius) ? Math.max(0, retentionRadius) : 0;
  if (radius === 0) return selection;

  const near = new Set(selection.nearIndices);
  const overview = new Set(selection.overviewIndices);
  const view = new Set(selection.viewIndices);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const reach = radius + Math.max(0, Number.isFinite(item.radius) ? item.radius : 0);
    const dx = item.x - cameraPosition.x;
    const dz = item.z - cameraPosition.z;
    if (dx * dx + dz * dz > reach * reach) continue;
    if (!near.has(index) && !overview.has(index)) {
      (item.forceOverview ? overview : near).add(index);
    }
    view.add(index);
  }

  return {
    nearIndices: [...near].sort((left, right) => left - right),
    overviewIndices: [...overview].sort((left, right) => left - right),
    viewIndices: [...view].sort((left, right) => left - right),
  };
}

export function sameSeedThreeForestIndexSelection(
  left: SeedThreeForestIndexSelection,
  right: SeedThreeForestIndexSelection,
): boolean {
  return sameIndices(left.nearIndices, right.nearIndices)
    && sameIndices(left.overviewIndices, right.overviewIndices)
    && sameIndices(left.viewIndices, right.viewIndices);
}

function sameIndices(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
