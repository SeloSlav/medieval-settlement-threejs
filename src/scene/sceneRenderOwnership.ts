export type SceneRenderOwner = 'world' | 'illustrated-map';

/**
 * Resolves the one scene allowed to submit the visible frame.
 *
 * Readiness is intentionally part of the decision: requesting the illustrated
 * map before its plane exists must leave the live world as render owner.
 */
export function resolveSceneRenderOwner(
  illustratedMapActive: boolean,
  illustratedMapReady: boolean,
): SceneRenderOwner {
  return illustratedMapActive && illustratedMapReady
    ? 'illustrated-map'
    : 'world';
}
