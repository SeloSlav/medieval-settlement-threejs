import type { WildflowerGeometryLod } from './wildflowerStreamBudget.ts';

export type CompactWildflowerData = {
  matrices: Float32Array;
  anchors: Float32Array;
  count: number;
};
export type WildflowerPrefixLayout = Array<
  { data: CompactWildflowerData; offset: number; lod: WildflowerGeometryLod } | undefined
>;
export type WildflowerPrefixRange = { start: number; count: number };

/** Retain identical slot runs; a removed tail needs only a smaller draw count. */
export function writeWildflowerPrefixes(
  records: readonly {
    compactData: readonly (CompactWildflowerData | null)[];
    wildflowerGeometryLod: WildflowerGeometryLod;
  }[],
  meshIndex: number,
  previous: WildflowerPrefixLayout,
  detail: { matrices: Float32Array; anchors: Float32Array },
  footprint: { matrices: Float32Array; anchors: Float32Array },
): {
  detailCount: number;
  footprintCount: number;
  detailRanges: WildflowerPrefixRange[];
  footprintRanges: WildflowerPrefixRange[];
} {
  let detailCount = 0,
    footprintCount = 0;
  const detailRanges: WildflowerPrefixRange[] = [],
    footprintRanges: WildflowerPrefixRange[] = [];
  records.forEach((record, index) => {
    const data = record.compactData[meshIndex];
    if (!data?.count) {
      previous[index] = undefined;
      return;
    }
    const lod = record.wildflowerGeometryLod,
      isDetail = lod === 'detail';
    const offset = isDetail ? detailCount : footprintCount;
    const target = isDetail ? detail : footprint;
    if (
      (offset + data.count) * 16 > target.matrices.length ||
      (offset + data.count) * 4 > target.anchors.length
    )
      throw new Error('Wildflower prefix exceeds its allocation');
    const prior = previous[index];
    if (prior?.data !== data || prior.offset !== offset || prior.lod !== lod) {
      target.matrices.set(data.matrices, offset * 16);
      target.anchors.set(data.anchors, offset * 4);
      const ranges = isDetail ? detailRanges : footprintRanges,
        last = ranges.at(-1);
      if (last && last.start + last.count === offset) last.count += data.count;
      else ranges.push({ start: offset, count: data.count });
      previous[index] = { data, offset, lod };
    }
    if (isDetail) detailCount += data.count;
    else footprintCount += data.count;
  });
  return { detailCount, footprintCount, detailRanges, footprintRanges };
}
