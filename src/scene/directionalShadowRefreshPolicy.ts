// At the tallest supported tree height, 0.12 degrees moves a shadow edge by
// about 10 cm: roughly one texel in the close-view 2048px shadow atlas.
export const DIRECTIONAL_SHADOW_TARGET_STEP_DEGREES = 0.12;
// Preserve the former worst-case angular step when accelerated time outruns
// the preferred redraw cadence.
export const DIRECTIONAL_SHADOW_MAX_STEP_DEGREES = 0.5;
export const DIRECTIONAL_SHADOW_MIN_REFRESH_INTERVAL_MS = 100;
// A walking villager moves about 12 cm in this interval at normal speed,
// roughly one close-view shadow texel. This keeps dynamic silhouettes attached
// without turning the static forest/building atlas back into an every-frame
// render cost.
export const DYNAMIC_SHADOW_MIN_REFRESH_INTERVAL_MS = 100;

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

/**
 * Animated first-person foliage must not sample a stale manual shadow atlas
 * while the camera is moving. Screen-space lateral/backward motion makes the
 * mismatch especially visible because leaf cards move across old silhouettes.
 */
export function shouldRefreshFirstPersonDirectionalShadow(
  firstPersonActive: boolean,
  cameraInteractionActive: boolean,
): boolean {
  return firstPersonActive && cameraInteractionActive;
}

/** Pace redraws requested by animated people, carts, livestock, and wildlife. */
export function shouldRefreshDynamicDirectionalShadow(
  dynamicShadowCastersChanged: boolean,
  elapsedSinceRefreshMs: number,
): boolean {
  return dynamicShadowCastersChanged
    && elapsedSinceRefreshMs >= DYNAMIC_SHADOW_MIN_REFRESH_INTERVAL_MS;
}

/**
 * The shadow atlas is manually cached, so a completed caster-buffer upload is
 * as authoritative an invalidation as moving/refitting the shadow camera.
 */
export function shouldRefreshDirectionalShadowAtlas(
  shadowCameraNeedsRefit: boolean,
  forestShadowCastersChanged: boolean,
  dynamicShadowRefreshDue: boolean,
  firstPersonActive: boolean,
  cameraInteractionActive: boolean,
): boolean {
  return shadowCameraNeedsRefit
    || forestShadowCastersChanged
    || dynamicShadowRefreshDue
    || shouldRefreshFirstPersonDirectionalShadow(
      firstPersonActive,
      cameraInteractionActive,
    );
}
