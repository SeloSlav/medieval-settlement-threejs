import type { BuildingKind } from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';

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
  reforester: { minX: -3.62, maxX: 5.30, minZ: -3.37, maxZ: 3.37 },
  woodcutters_lodge: { minX: -3.78, maxX: 5.26, minZ: -4.16, maxZ: 4.08 },
  stone_quarry: { minX: -9.28, maxX: 9.14, minZ: -8.32, maxZ: 8.31 },
  large_quarry: { minX: -11.92, maxX: 11.56, minZ: -11.88, maxZ: 11.32 },
  mine: { minX: -11.92, maxX: 11.56, minZ: -11.88, maxZ: 11.32 },
  clay_pit: { minX: -5.59, maxX: 5.18, minZ: -3.53, maxZ: 3.53 },
  charcoal_burner: { minX: -3.93, maxX: 4.43, minZ: -3.54, maxZ: 3.54 },
  smithy: { minX: -4.32, maxX: 4.32, minZ: -3.37, maxZ: 3.70 },
  potter_kiln: { minX: -4.39, maxX: 4.48, minZ: -3.37, maxZ: 3.37 },
  well: { minX: -2.17, maxX: 2.17, minZ: -2.17, maxZ: 2.17 },
  stable: { minX: -5.55, maxX: 5.55, minZ: -3.53, maxZ: 3.53 },
  hunters_hall: { minX: -4.26, maxX: 5.98, minZ: -3.94, maxZ: 3.94 },
  foragers_shed: { minX: -3.46, maxX: 3.46, minZ: -3.13, maxZ: 4.15 },
  fishing_camp: { minX: -6.13, maxX: 4.63, minZ: -3.70, maxZ: 4.00 },
  chapel: { minX: -4.69, maxX: 4.69, minZ: -6.10, maxZ: 6.10 },
  wayside_shrine: { minX: -1.42, maxX: 1.42, minZ: -1.30, maxZ: 1.51 },
  marketplace: { minX: -5.68, maxX: 5.40, minZ: -3.09, maxZ: 3.42 },
  trading_post: { minX: -6.68, maxX: 5.40, minZ: -5.36, maxZ: 7.30 },
  town_hall: { minX: -5.88, maxX: 5.88, minZ: -4.75, maxZ: 6.44 },
  village_storehouse: { minX: -6.68, maxX: 5.16, minZ: -5.36, maxZ: 7.30 },
  watchtower: { minX: -2.54, maxX: 3.48, minZ: -2.54, maxZ: 2.86 },
  guardhouse: { minX: -5.56, maxX: 6.85, minZ: -3.94, maxZ: 3.94 },
  palisaded_refuge: { minX: -7.96, maxX: 7.96, minZ: -6.07, maxZ: 6.49 },
  threshing_barn: { minX: -6.23, maxX: 6.37, minZ: -4.74, maxZ: 5.46 },
  pastoral_farmstead: { minX: -6.84, maxX: 7.66, minZ: -4.65, maxZ: 4.88 },
  swineherd: { minX: -5.10, maxX: 6.19, minZ: -4.26, maxZ: 5.18 },
  monastery: { minX: -34.62, maxX: 34.62, minZ: -46.12, maxZ: 8.12 },
  brewery: { minX: -4.59, maxX: 5.52, minZ: -3.86, maxZ: 5.38 },
  tavern: { minX: -4.43, maxX: 4.43, minZ: -3.78, maxZ: 5.16 },
  smokehouse: { minX: -5.43, maxX: 4.72, minZ: -3.29, maxZ: 4.11 },
  granary: { minX: -5.00, maxX: 5.00, minZ: -3.86, maxZ: 4.78 },
  bakery: { minX: -4.18, maxX: 4.18, minZ: -3.70, maxZ: 4.74 },
  apiary: { minX: -4.35, maxX: 4.35, minZ: -4.97, maxZ: 3.78 },
  watermill: { minX: -5.36, maxX: 7.33, minZ: -3.96, maxZ: 4.97 },
  windmill: { minX: -5.75, maxX: 5.75, minZ: -4.80, maxZ: 4.80 },
  carpenter: { minX: -5.24, maxX: 6.84, minZ: -3.94, maxZ: 3.94 },
  spinning_retting_house: { minX: -5.18, maxX: 5.21, minZ: -4.26, maxZ: 4.49 },
  weaver: { minX: -4.75, maxX: 7.24, minZ: -3.90, maxZ: 4.11 },
  tannery: { minX: -4.37, maxX: 4.20, minZ: -4.33, maxZ: 4.66 },
  cobbler: { minX: -3.46, maxX: 3.46, minZ: -3.37, maxZ: 3.57 },
  chandlery: { minX: -4.48, maxX: 5.93, minZ: -3.45, maxZ: 4.82 },
} as const satisfies Record<BuildingKind, BuildingLocalVisualBounds>;

/**
 * Maximum local envelope of the generic construction-site mesh for a kind.
 * The dimensions cover every construction stage and all delivered-material
 * piles, with the same safety margin and outward rounding as the completed
 * visual bounds above.
 */
export function getConstructionSiteLocalVisualBounds(
  kind: BuildingKind,
): BuildingLocalVisualBounds {
  const pickRadius = getBuildingDefinition(kind).pickRadius;
  const halfWidth = Math.min(8.8, Math.max(3.4, pickRadius * 0.62));
  const halfDepth = Math.min(7.2, Math.max(2.8, pickRadius * 0.48));
  return {
    minX: -halfWidth - 2.35,
    maxX: halfWidth + 2.46,
    minZ: -halfDepth - 0.65,
    maxZ: halfDepth + 1.48,
  };
}
