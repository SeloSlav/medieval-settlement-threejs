import type { BuildingState } from '../resources/types.ts';

/**
 * Repairs reuse construction labor and hauling without turning the surviving
 * structure back into a scaffolded construction site.
 */
export function buildingUsesCompletedMesh(
  building: Pick<BuildingState, 'kind' | 'constructionComplete' | 'fireRepairActive'>,
): boolean {
  // Reclamation piles are system-created logistics props, never buildable
  // structures. Keep their debris mesh even if a transient/stale replicated
  // construction flag arrives while a hauling update is being applied.
  return building.kind === 'salvage_pile'
    || building.constructionComplete !== false
    || building.fireRepairActive === true;
}
