export type SeedThreeForestInteractionWorkPlan = {
  deferCoveredWork: boolean;
  completeImmediately: boolean;
};

/**
 * Keep pointer-driven camera movement visually coherent. A resident selection
 * already carries a padded view and shadow envelope, so it can remain on screen
 * while the pointer is down. Once navigation ends, publish the newest selection
 * in one frame instead of revealing species buckets over several frames.
 */
export function planSeedThreeForestInteractionWork(
  previousInteractionActive: boolean,
  interactionActive: boolean,
  residentSelectionCoversDesiredView: boolean,
): SeedThreeForestInteractionWorkPlan {
  return {
    deferCoveredWork: interactionActive && residentSelectionCoversDesiredView,
    completeImmediately:
      !residentSelectionCoversDesiredView
      || (previousInteractionActive && !interactionActive),
  };
}
