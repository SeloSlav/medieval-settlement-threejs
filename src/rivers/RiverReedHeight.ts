/** The waterline may reach a little above mid-card, but never swallow the crown. */
export const REED_MAX_WATERLINE_FRACTION = 0.58;

/**
 * Preserve the sampled physical plant height unless it would leave too little
 * crown above the local surface. Unlike adding the entire water depth, this
 * keeps the visible waterline around the lower third-to-half of most cards.
 */
export function ensureCattailEmergenceHeightMeters(
  sampledHeightMeters: number,
  waterDepthMeters: number,
): number {
  return Math.max(
    sampledHeightMeters,
    waterDepthMeters / REED_MAX_WATERLINE_FRACTION,
  );
}
