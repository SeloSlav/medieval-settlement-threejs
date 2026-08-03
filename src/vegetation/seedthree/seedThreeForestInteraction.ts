export type SeedThreeForestInteractionWorkPlan = {
  deferCoveredWork: boolean;
  discardCoveredWork: boolean;
  completeImmediately: boolean;
};

/**
 * Keep keyboard- and pointer-driven camera movement visually coherent. A
 * resident selection already carries a padded visible prefix, so it can remain
 * on screen while the camera moves. Once navigation ends, discard a redundant
 * covered selection instead of rewriting the same visible trees into a
 * different packed order. If movement escapes that prefix, complete the
 * replacement immediately so the newly exposed view never waits on background
 * buffer work.
 */
export function planSeedThreeForestInteractionWork(
  previousInteractionActive: boolean,
  interactionActive: boolean,
  residentSelectionCoversDesiredView: boolean,
): SeedThreeForestInteractionWorkPlan {
  return {
    deferCoveredWork: interactionActive && residentSelectionCoversDesiredView,
    discardCoveredWork:
      previousInteractionActive
      && !interactionActive
      && residentSelectionCoversDesiredView,
    completeImmediately: !residentSelectionCoversDesiredView,
  };
}
