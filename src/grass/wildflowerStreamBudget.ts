export const WILDFLOWER_SLOT_CAPACITIES = [48, 32, 48, 8, 8] as const;

export const WILDFLOWER_SPECIES_COUNT = WILDFLOWER_SLOT_CAPACITIES.length;

export const WILDFLOWER_TOTAL_SLOT_CAPACITY = WILDFLOWER_SLOT_CAPACITIES.reduce(
  (total, capacity) => total + capacity,
  0,
);

export type WildflowerGeometryLod = 'detail' | 'footprint';
export type WildflowerGeometryLodSummary = WildflowerGeometryLod | 'mixed';

export const WILDFLOWER_DETAIL_LOD_ENTER_DISTANCE_METERS = 10;
export const WILDFLOWER_DETAIL_LOD_EXIT_DISTANCE_METERS = 14;

export function resolveWildflowerGeometryLod(
  current: WildflowerGeometryLod,
  distanceMeters: number,
  _firstPersonActive = false,
): WildflowerGeometryLod {
  const distance = Number.isFinite(distanceMeters)
    ? Math.max(0, distanceMeters)
    : Number.POSITIVE_INFINITY;
  if (current === 'detail') {
    return distance <= WILDFLOWER_DETAIL_LOD_EXIT_DISTANCE_METERS
      ? 'detail'
      : 'footprint';
  }
  return distance <= WILDFLOWER_DETAIL_LOD_ENTER_DISTANCE_METERS
    ? 'detail'
    : 'footprint';
}

export function countLiveWildflowerInstances(
  slotCounts: readonly (readonly number[])[],
): number {
  let total = 0;
  for (const counts of slotCounts) {
    for (let speciesIndex = 0; speciesIndex < WILDFLOWER_SPECIES_COUNT; speciesIndex++) {
      const count = counts[speciesIndex] ?? 0;
      if (Number.isFinite(count) && count > 0) total += Math.floor(count);
    }
  }
  return total;
}

export function resolveWildflowerLodSubmission(
  liveInstances: number,
  lodVisible: boolean,
): { submittedInstances: number; culledInstances: number } {
  const live = Number.isFinite(liveInstances)
    ? Math.max(0, Math.floor(liveInstances))
    : 0;
  const submittedInstances = lodVisible ? live : 0;
  return {
    submittedInstances,
    culledInstances: live - submittedInstances,
  };
}

export function estimateWildflowerSubmittedTriangles(
  speciesInstanceCounts: readonly number[],
  speciesTrianglesPerInstance: readonly number[],
): number {
  let total = 0;
  for (let speciesIndex = 0; speciesIndex < WILDFLOWER_SPECIES_COUNT; speciesIndex++) {
    const instances = Math.max(0, Math.floor(speciesInstanceCounts[speciesIndex] ?? 0));
    const triangles = Math.max(0, Math.floor(speciesTrianglesPerInstance[speciesIndex] ?? 0));
    total += instances * triangles;
  }
  return total;
}
