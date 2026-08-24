export const FOREST_MOSSY_ROCK_DENSITY_MIN = 0.52;

export type ForestRockSurface = 'mossyForest' | 'neutralMeadow';

/**
 * Keeps the rock identity deterministic without consuming placement RNG.
 * Woodland rocks receive the authored moss material; open meadow and sparse
 * edge stones retain the neutral legacy fallback.
 */
export function classifyForestRockSurface(forestDensity: number): ForestRockSurface {
  return forestDensity >= FOREST_MOSSY_ROCK_DENSITY_MIN
    ? 'mossyForest'
    : 'neutralMeadow';
}
