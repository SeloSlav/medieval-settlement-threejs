import type { BuildingKind } from '../resources/types.ts';
import { getBuildingFootprintHalfExtents } from './BuildingFootprint.ts';

/**
 * Local X/Z envelope used by road-link markers. Bounds include the exact
 * placement footprint, every completed visual variant, and a small authored
 * safety margin so float32 geometry and animated extremities cannot touch a
 * marker that is mathematically clear.
 */
export type BuildingLocalVisualBounds = Readonly<{
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}>;

export const BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN = 0.05;

export const BUILDING_LOCAL_VISUAL_BOUNDS = {
  founders_camp: { minX: -7.96, maxX: 8.08, minZ: -5.88, maxZ: 7.85 },
  salvage_pile: { minX: -4.91, maxX: 4.91, minZ: -4.26, maxZ: 4.26 },
  lumber_mill: { minX: -8.84, maxX: 8.84, minZ: -5.08, maxZ: 5.12 },
  reforester: { minX: -3.62, maxX: 5.30, minZ: -3.37, maxZ: 3.99 },
  woodcutters_lodge: { minX: -3.78, maxX: 5.26, minZ: -4.16, maxZ: 4.21 },
  stone_quarry: { minX: -9.28, maxX: 9.14, minZ: -8.32, maxZ: 8.31 },
  large_quarry: { minX: -11.92, maxX: 11.56, minZ: -11.88, maxZ: 11.37 },
  mine: { minX: -11.92, maxX: 11.56, minZ: -11.88, maxZ: 11.32 },
  charcoal_burner: { minX: -3.93, maxX: 4.43, minZ: -3.54, maxZ: 3.54 },
  smithy: { minX: -4.32, maxX: 4.32, minZ: -3.37, maxZ: 3.70 },
  weaponsmith_armorer: { minX: -5.15, maxX: 5.15, minZ: -3.78, maxZ: 4.18 },
  bowyer_fletcher: { minX: -5.24, maxX: 6.84, minZ: -3.94, maxZ: 4.07 },
  potter_kiln: { minX: -4.39, maxX: 4.48, minZ: -3.37, maxZ: 3.37 },
  well: { minX: -2.17, maxX: 2.17, minZ: -2.17, maxZ: 2.17 },
  stable: { minX: -5.55, maxX: 5.55, minZ: -3.53, maxZ: 3.53 },
  kennel: { minX: -4.25, maxX: 4.25, minZ: -3.50, maxZ: 3.45 },
  hunters_hall: { minX: -4.88, maxX: 5.03, minZ: -4.30, maxZ: 3.05 },
  foragers_shed: { minX: -3.46, maxX: 3.46, minZ: -3.13, maxZ: 4.15 },
  fishing_camp: { minX: -7.03, maxX: 7.90, minZ: -5.05, maxZ: 4.14 },
  chapel: { minX: -5.46, maxX: 5.46, minZ: -8.82, maxZ: 9.40 },
  wayside_shrine: { minX: -1.42, maxX: 1.42, minZ: -1.30, maxZ: 1.51 },
  marketplace: { minX: -5.68, maxX: 5.40, minZ: -3.09, maxZ: 3.42 },
  trading_post: { minX: -6.68, maxX: 5.40, minZ: -5.36, maxZ: 7.30 },
  town_hall: { minX: -5.93, maxX: 5.93, minZ: -6.57, maxZ: 6.50 },
  village_storehouse: { minX: -6.68, maxX: 5.16, minZ: -5.36, maxZ: 7.30 },
  watchtower: { minX: -2.54, maxX: 3.48, minZ: -2.54, maxZ: 2.86 },
  guardhouse: { minX: -5.63, maxX: 6.85, minZ: -3.94, maxZ: 5.23 },
  palisaded_refuge: { minX: -7.96, maxX: 7.96, minZ: -6.07, maxZ: 6.49 },
  threshing_barn: { minX: -6.23, maxX: 6.37, minZ: -4.74, maxZ: 5.46 },
  pastoral_farmstead: { minX: -6.93, maxX: 7.66, minZ: -4.65, maxZ: 4.88 },
  swineherd: { minX: -5.10, maxX: 6.28, minZ: -4.26, maxZ: 5.18 },
  monastery: { minX: -34.62, maxX: 34.62, minZ: -46.12, maxZ: 8.12 },
  brewery: { minX: -4.68, maxX: 5.52, minZ: -3.86, maxZ: 5.38 },
  tavern: { minX: -4.43, maxX: 4.43, minZ: -3.78, maxZ: 5.16 },
  smokehouse: { minX: -5.43, maxX: 4.72, minZ: -3.29, maxZ: 5.22 },
  granary: { minX: -5.08, maxX: 5.08, minZ: -3.86, maxZ: 4.78 },
  bakery: { minX: -4.18, maxX: 4.18, minZ: -3.70, maxZ: 4.77 },
  apiary: { minX: -4.35, maxX: 4.35, minZ: -4.97, maxZ: 3.78 },
  watermill: { minX: -5.36, maxX: 7.33, minZ: -3.96, maxZ: 6.17 },
  windmill: { minX: -5.75, maxX: 5.75, minZ: -4.80, maxZ: 4.80 },
  carpenter: { minX: -5.24, maxX: 6.84, minZ: -3.94, maxZ: 4.07 },
  spinning_retting_house: { minX: -5.18, maxX: 5.21, minZ: -4.26, maxZ: 4.49 },
  weaver: { minX: -4.75, maxX: 7.24, minZ: -3.90, maxZ: 4.12 },
  tannery: { minX: -4.37, maxX: 4.20, minZ: -4.33, maxZ: 4.66 },
  cobbler: { minX: -3.46, maxX: 3.46, minZ: -3.37, maxZ: 3.57 },
  chandlery: { minX: -4.48, maxX: 5.99, minZ: -3.46, maxZ: 4.82 },
} as const satisfies Record<BuildingKind, BuildingLocalVisualBounds>;

/**
 * Maximum local envelope of the footprint-sized construction mesh for a kind.
 * The dimensions cover every construction stage and all delivered-material
 * piles, with the same safety margin and outward rounding as the completed
 * visual bounds above.
 */
export function getConstructionSiteLocalVisualBounds(
  kind: BuildingKind,
): BuildingLocalVisualBounds {
  const { halfWidth, halfDepth } = getBuildingFootprintHalfExtents(kind);
  return {
    minX: -halfWidth - 2.35,
    maxX: halfWidth + 2.46,
    minZ: -halfDepth - 0.65,
    maxZ: halfDepth + 1.48,
  };
}
