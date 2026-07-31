/** Strategic canopy fill appears only after the camera has clearly zoomed out. */
export const SEEDTHREE_CROWN_UNDERLAY_SHOW_DISTANCE = 128;

/** A wider return threshold prevents the crown layer flickering during wheel zoom. */
export const SEEDTHREE_CROWN_UNDERLAY_HIDE_DISTANCE = 112;

/** SeedThree's shared wind clock stays coherent across bark, foliage, and ground cover. */
export const SEEDTHREE_FOREST_WIND_SPEED = 0.84;

export function shouldShowSeedThreeCrownUnderlay(
  currentlyVisible: boolean,
  cameraDistance: number,
  firstPersonActive: boolean,
): boolean {
  if (firstPersonActive) return false;
  const distance = Number.isFinite(cameraDistance) ? cameraDistance : 0;
  const threshold = currentlyVisible
    ? SEEDTHREE_CROWN_UNDERLAY_HIDE_DISTANCE
    : SEEDTHREE_CROWN_UNDERLAY_SHOW_DISTANCE;
  return distance >= threshold;
}
