export type SeedThreeForestInteractionWorkPlan = {
  deferWork: boolean;
  discardCoveredWork: boolean;
  completeImmediately: boolean;
};

/**
 * Keep keyboard- and pointer-driven camera movement visually coherent. A
 * color selection already carries a padded visible guard, so it can remain on
 * screen while the camera moves. Once navigation ends, retain the newest guard
 * work and converge it under the normal frame budget. If movement escapes the
 * guard, wait until navigation ends before streaming the replacement so an
 * atomic species-buffer upload cannot block an interaction frame.
 */
export function planSeedThreeForestInteractionWork(
  previousInteractionActive: boolean,
  interactionActive: boolean,
  residentSelectionCoversDesiredView: boolean,
): SeedThreeForestInteractionWorkPlan {
  return {
    // Never publish large atomic instance-buffer uploads in the middle of a
    // walk, drag, or wheel burst. The resident selection carries a padded
    // guard, so a briefly uncovered fringe is preferable to blocking the
    // navigation frame while an entire species bucket is uploaded.
    deferWork: interactionActive,
    // A short interaction normally remains inside the resident guard. Drop
    // its now-redundant repack on release instead of uploading the same visible
    // trees in a different order.
    discardCoveredWork:
      previousInteractionActive
      && !interactionActive
      && residentSelectionCoversDesiredView,
    // Initial publication is handled explicitly by the forest builder. All
    // later coverage changes must respect its bounded streaming budget.
    completeImmediately: false,
  };
}
