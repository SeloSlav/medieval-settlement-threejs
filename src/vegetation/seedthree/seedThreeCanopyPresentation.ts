export type SeedThreeCrownUnderlayMode = 'off' | 'always' | 'distance';

/**
 * Global crown-fill feature flag. Change only this value to compare:
 * - 'off': no extra canopy
 * - 'always': extra canopy at every zoom level
 * - 'distance': extra canopy only beyond the thresholds below
 */
export const SEEDTHREE_CROWN_UNDERLAY_MODE: SeedThreeCrownUnderlayMode = 'distance';

/** Distance mode reveals strategic canopy fill after the camera has clearly zoomed out. */
export const SEEDTHREE_CROWN_UNDERLAY_SHOW_DISTANCE = 128;

/** Distance mode uses a wider return threshold to prevent wheel-zoom flicker. */
export const SEEDTHREE_CROWN_UNDERLAY_HIDE_DISTANCE = 112;

/** SeedThree's shared wind clock stays coherent across bark, foliage, and ground cover. */
export const SEEDTHREE_FOREST_WIND_SPEED = 0.84;

export function shouldShowSeedThreeCrownUnderlay(
  currentlyVisible: boolean,
  cameraDistance: number,
  firstPersonActive: boolean,
  mode: SeedThreeCrownUnderlayMode = SEEDTHREE_CROWN_UNDERLAY_MODE,
): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  if (firstPersonActive) return false;
  const distance = Number.isFinite(cameraDistance) ? cameraDistance : 0;
  const threshold = currentlyVisible
    ? SEEDTHREE_CROWN_UNDERLAY_HIDE_DISTANCE
    : SEEDTHREE_CROWN_UNDERLAY_SHOW_DISTANCE;
  return distance >= threshold;
}
