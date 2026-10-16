/** SeedThree's authored mobile tree rungs: LOD2, LOD3, LOD4. */
export const SEEDTHREE_FOREST_LOD_DISTANCES = [0, 48, 96] as const;
export type SeedThreeTreeLod = 0 | 1 | 2;
/** One pause-aware wind clock for all tree rungs and ground cover. */
export const SEEDTHREE_FOREST_WIND_SPEED = 0.84;

/** A single owner per tree; hysteresis prevents toggling at a distance boundary. */
export function selectSeedThreeTreeLod(
  distance: number,
  previous: number,
  distantOnly = false,
): SeedThreeTreeLod {
  if (distantOnly) return 2;
  const d = Number.isFinite(distance) ? Math.max(0, distance) : Infinity;
  const [, middle, far] = SEEDTHREE_FOREST_LOD_DISTANCES;
  if (previous === 0) return d <= middle * 1.1 ? 0 : d <= far * 1.1 ? 1 : 2;
  if (previous === 1) return d < middle * 0.9 ? 0 : d <= far * 1.1 ? 1 : 2;
  if (previous === 2) return d < middle * 0.9 ? 0 : d < far * 0.9 ? 1 : 2;
  return d <= middle ? 0 : d <= far ? 1 : 2;
}
