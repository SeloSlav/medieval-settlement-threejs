export type SeedThreeForestInteractionWorkPlan = {
  deferCoveredWork: boolean;
  discardCoveredWork: boolean;
  completeImmediately: boolean;
};

/**
 * Keep keyboard- and pointer-driven camera movement visually coherent. A
 * color selection already carries a padded visible guard, so it can remain on
 * screen while the camera moves. Once navigation ends, retain the newest guard
 * work and converge it under the normal frame budget. If movement escapes the
 * guard, complete the replacement immediately so the newly exposed view never
 * waits on background buffer work.
 */
export function planSeedThreeForestInteractionWork(
  _previousInteractionActive: boolean,
  interactionActive: boolean,
  residentSelectionCoversDesiredView: boolean,
): SeedThreeForestInteractionWorkPlan {
  return {
    deferCoveredWork: interactionActive && residentSelectionCoversDesiredView,
    discardCoveredWork: false,
    completeImmediately: !residentSelectionCoversDesiredView,
  };
}
