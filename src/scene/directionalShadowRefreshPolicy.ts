// At the tallest supported tree height, 0.12 degrees moves a shadow edge by
// about 10 cm: roughly one texel in the close-view 2048px shadow atlas.
export const DIRECTIONAL_SHADOW_TARGET_STEP_DEGREES = 0.12;
// Preserve the former worst-case angular step when accelerated time outruns
// the preferred redraw cadence.
export const DIRECTIONAL_SHADOW_MAX_STEP_DEGREES = 0.5;
export const DIRECTIONAL_SHADOW_MIN_REFRESH_INTERVAL_MS = 100;

export type DirectionalShadowRefreshReason =
  | 'camera-refit'
  | 'forest-casters'
  | 'first-person-motion'
  | 'dynamic-casters';

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

/**
 * Animated agents write interpolated transforms every frame, but their small
 * silhouettes do not justify rebuilding the shared 4096px atlas at display
 * refresh rate. Keep the color animation full-rate and pace only its shadow.
 */
export function shouldRefreshDynamicAgentDirectionalShadow(
  simulationDeltaSeconds: number,
  hasVisibleDynamicCasters: boolean,
  elapsedSinceRefreshMs: number,
): boolean {
  return hasVisibleDynamicCasters
    && Number.isFinite(simulationDeltaSeconds)
    && simulationDeltaSeconds > 0
    && elapsedSinceRefreshMs >= DIRECTIONAL_SHADOW_MIN_REFRESH_INTERVAL_MS;
}

/**
 * The shadow atlas is manually cached, so a completed caster-buffer upload is
 * as authoritative an invalidation as moving/refitting the shadow camera.
 */
export function shouldRefreshDirectionalShadowAtlas(
  shadowCameraNeedsRefit: boolean,
  forestShadowCastersChanged: boolean,
  firstPersonActive: boolean,
  cameraInteractionActive: boolean,
): boolean {
  return shadowCameraNeedsRefit
    || forestShadowCastersChanged
    || shouldRefreshFirstPersonDirectionalShadow(
      firstPersonActive,
      cameraInteractionActive,
    );
}

/**
 * Return the exact invalidation causes instead of collapsing them to a boolean.
 * The production renderer uses this for frame-local evidence and to ensure one
 * atlas upload is shared when several causes happen in the same frame.
 */
export function directionalShadowRefreshReasons(
  shadowCameraNeedsRefit: boolean,
  forestShadowCastersChanged: boolean,
  firstPersonActive: boolean,
  cameraInteractionActive: boolean,
): DirectionalShadowRefreshReason[] {
  const reasons: DirectionalShadowRefreshReason[] = [];
  if (shadowCameraNeedsRefit) reasons.push('camera-refit');
  if (forestShadowCastersChanged) reasons.push('forest-casters');
  if (shouldRefreshFirstPersonDirectionalShadow(
    firstPersonActive,
    cameraInteractionActive,
  )) {
    reasons.push('first-person-motion');
  }
  return reasons;
}
