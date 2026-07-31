// At the tallest supported tree height, 0.12 degrees moves a shadow edge by
// about 10 cm: roughly one texel in the close-view 2048px shadow atlas.
export const DIRECTIONAL_SHADOW_TARGET_STEP_DEGREES = 0.12;
// Preserve the former worst-case angular step when accelerated time outruns
// the preferred redraw cadence.
export const DIRECTIONAL_SHADOW_MAX_STEP_DEGREES = 0.5;
export const DIRECTIONAL_SHADOW_MIN_REFRESH_INTERVAL_MS = 100;

const TARGET_STEP_DOT = Math.cos(
  DIRECTIONAL_SHADOW_TARGET_STEP_DEGREES * Math.PI / 180,
);
const MAX_STEP_DOT = Math.cos(
  DIRECTIONAL_SHADOW_MAX_STEP_DEGREES * Math.PI / 180,
);

/**
 * Keep ordinary solar shadows close to a 10 Hz budget while preventing fast
 * simulation speeds from accumulating a visibly larger angular jump.
 */
export function shouldRefreshDirectionalShadow(
  directionDot: number,
  elapsedSinceRefreshMs: number,
): boolean {
  if (!Number.isFinite(directionDot)) return true;
  const clampedDot = Math.max(-1, Math.min(1, directionDot));
  if (clampedDot < MAX_STEP_DOT) return true;
  return clampedDot < TARGET_STEP_DOT
    && elapsedSinceRefreshMs >= DIRECTIONAL_SHADOW_MIN_REFRESH_INTERVAL_MS;
}
