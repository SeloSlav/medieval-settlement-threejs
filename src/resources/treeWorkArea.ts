import type { BuildingState, TreeWorkArea } from './types.ts';

export function supportsTreeWorkArea(building: Pick<BuildingState, 'kind'>): boolean {
  return building.kind === 'lumber_mill' || building.kind === 'reforester';
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
  return {
    x: building.x,
    z: building.z,
    radius: Math.max(0, Number.isFinite(building.workRadius) ? building.workRadius : 0),
  };
}
