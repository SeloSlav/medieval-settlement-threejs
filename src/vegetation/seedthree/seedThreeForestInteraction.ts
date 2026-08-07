export type SeedThreeForestInteractionWorkPlan = {
  deferCoveredWork: boolean;
  discardCoveredWork: boolean;
  completeImmediately: boolean;
};

/**
 * Keep keyboard- and pointer-driven camera movement visually coherent. A
 * resident selection already carries a padded visible prefix, so it can remain
 * on screen while the camera moves. Never rewrite live foliage instance
 * buffers during navigation: even an immediate replacement can be observed by
 * the renderer between matrix uploads and presents as flashing leaves. Once
 * navigation ends, discard a redundant covered selection or complete an
 * uncovered replacement before the next moving frame.
 */
export function planSeedThreeForestInteractionWork(
  previousInteractionActive: boolean,
  interactionActive: boolean,
  residentSelectionCoversDesiredView: boolean,
): SeedThreeForestInteractionWorkPlan {
  return {
    deferCoveredWork: interactionActive,
    discardCoveredWork:
      previousInteractionActive
      && !interactionActive
      && residentSelectionCoversDesiredView,
    completeImmediately: !interactionActive && !residentSelectionCoversDesiredView,
  };
}
