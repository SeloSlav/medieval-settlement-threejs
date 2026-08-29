import type { BuildingState, TreeWorkArea } from './types.ts';
import { getBuildingDefinition } from './buildings.ts';

export function supportsTreeWorkArea(building: Pick<BuildingState, 'kind'>): boolean {
  return building.kind === 'lumber_mill'
    || building.kind === 'woodcutters_lodge'
    || building.kind === 'reforester';
}

export function hasCustomTreeWorkArea(
  building: Pick<BuildingState, 'kind' | 'treeWorkArea'>,
): boolean {
  if (!supportsTreeWorkArea(building)) return false;
  const area = building.treeWorkArea;
  return area !== undefined
    && Number.isFinite(area.x)
    && Number.isFinite(area.z)
    && Number.isFinite(area.radius)
    && area.radius > 0;
}

/** Resolves the authored circle, falling back to the building-centered balance extent. */
export function effectiveTreeWorkArea(
  building: Pick<BuildingState, 'kind' | 'x' | 'z' | 'workRadius' | 'treeWorkArea'>,
): TreeWorkArea {
  if (hasCustomTreeWorkArea(building)) {
    return building.treeWorkArea!;
  }
  // Older saves persisted zero before a building gained a forestry work
  // extent. Fall back to the current authored radius so those buildings start
  // working immediately after an additive module update.
  const persistedRadius = Number.isFinite(building.workRadius)
    ? building.workRadius
    : 0;
  const defaultRadius = persistedRadius > 0
    ? persistedRadius
    : getBuildingDefinition(building.kind).workRadius;
  return {
    x: building.x,
    z: building.z,
    radius: Math.max(0, defaultRadius),
  };
}
