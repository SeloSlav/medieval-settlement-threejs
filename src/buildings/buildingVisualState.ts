import type { BuildingState } from '../resources/types.ts';

/**
 * Repairs reuse construction labor and hauling without turning the surviving
 * structure back into a scaffolded construction site.
 */
export function buildingUsesCompletedMesh(
  building: Pick<BuildingState, 'constructionComplete' | 'fireRepairActive'>,
): boolean {
  return building.constructionComplete !== false || building.fireRepairActive === true;
}
