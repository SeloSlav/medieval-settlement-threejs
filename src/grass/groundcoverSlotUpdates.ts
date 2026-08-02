export type GroundcoverSlotRewrite = {
  dirtyInstanceCount: number;
  clearStart: number;
  clearCount: number;
};

export type GroundcoverSlotUpdate = {
  slotIndex: number;
  dirtyInstanceCounts: readonly number[];
};

export type GroundcoverAttributeUpdatePlan = {
  ranges: Array<{ start: number; count: number }>;
  componentCount: number;
  byteCount: number;
};

/**
 * A recycled slot already has a hidden tail from its first full initialization.
 * Rewriting its live prefix and hiding only a shortened old tail therefore
 * produces the same buffer contents without touching the rest of the capacity.
 */
export function resolveGroundcoverSlotRewrite(
  initialized: boolean,
  previousCount: number,
  nextCount: number,
  slotCapacity: number,
): GroundcoverSlotRewrite {
  const capacity = Math.max(0, Math.floor(slotCapacity));
  const previous = Math.min(capacity, Math.max(0, Math.floor(previousCount)));
  const next = Math.min(capacity, Math.max(0, Math.floor(nextCount)));
  if (!initialized) {
    return {
      dirtyInstanceCount: capacity,
      clearStart: 0,
      clearCount: capacity,
    };
  }
  return {
    dirtyInstanceCount: Math.max(previous, next),
    clearStart: next,
    clearCount: Math.max(0, previous - next),
  };
}

/** Plan merged component ranges for the exact dirty prefix of each slot. */
export function planGroundcoverAttributeUpdateRanges(
  updates: readonly GroundcoverSlotUpdate[],
  meshIndex: number,
  slotCapacity: number,
  itemSize: number,
  bytesPerElement = 4,
): GroundcoverAttributeUpdatePlan {
  const capacity = Math.max(0, Math.floor(slotCapacity));
  const width = Math.max(1, Math.floor(itemSize));
  const dirtyBySlot = new Map<number, number>();
  for (const update of updates) {
    const slotIndex = Math.max(0, Math.floor(update.slotIndex));
    const dirtyCount = Math.min(
      capacity,
      Math.max(0, Math.floor(update.dirtyInstanceCounts[meshIndex] ?? 0)),
    );
    if (dirtyCount <= 0) continue;
    dirtyBySlot.set(
      slotIndex,
      Math.max(dirtyBySlot.get(slotIndex) ?? 0, dirtyCount),
    );
  }

  const ranges = [...dirtyBySlot]
    .sort(([left], [right]) => left - right)
    .map(([slotIndex, dirtyCount]) => ({
      start: slotIndex * capacity * width,
      count: dirtyCount * width,
    }));
  const merged: Array<{ start: number; count: number }> = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && previous.start + previous.count >= range.start) {
      previous.count = Math.max(
        previous.start + previous.count,
        range.start + range.count,
      ) - previous.start;
    } else {
      merged.push({ ...range });
    }
  }
  const componentCount = merged.reduce((sum, range) => sum + range.count, 0);
  return {
    ranges: merged,
    componentCount,
    byteCount: componentCount * Math.max(1, Math.floor(bytesPerElement)),
  };
}
