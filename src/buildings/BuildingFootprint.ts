import type { BuildingKind } from '../resources/types.ts';

export type BuildingPadParams = {
  radiusX: number;
  radiusZ: number;
  innerFade: number;
  outerFade: number;
};

export const BUILDING_PAD_PARAMS: Record<BuildingKind, BuildingPadParams> = {
  founders_camp: { radiusX: 8.6, radiusZ: 7.2, innerFade: 0.88, outerFade: 1.28 },
  salvage_pile: { radiusX: 6.0, radiusZ: 5.2, innerFade: 0.88, outerFade: 1.28 },
  lumber_mill: { radiusX: 10.2, radiusZ: 4.8, innerFade: 0.86, outerFade: 1.38 },
  reforester: { radiusX: 4.4, radiusZ: 4.1, innerFade: 0.88, outerFade: 1.32 },
  woodcutters_lodge: { radiusX: 4.6, radiusZ: 4.3, innerFade: 0.88, outerFade: 1.34 },
  stone_quarry: { radiusX: 10.5, radiusZ: 10.5, innerFade: 0.82, outerFade: 1.42 },
  large_quarry: { radiusX: 13.0, radiusZ: 12.0, innerFade: 0.84, outerFade: 1.24 },
  mine: { radiusX: 11.0, radiusZ: 10.0, innerFade: 0.84, outerFade: 1.24 },
  charcoal_burner: { radiusX: 4.9, radiusZ: 4.4, innerFade: 0.86, outerFade: 1.28 },
  smithy: { radiusX: 4.6, radiusZ: 4.1, innerFade: 0.88, outerFade: 1.3 },
  weaponsmith_armorer: { radiusX: 5.6, radiusZ: 4.6, innerFade: 0.88, outerFade: 1.3 },
  bowyer_fletcher: { radiusX: 5.8, radiusZ: 4.6, innerFade: 0.88, outerFade: 1.3 },
  potter_kiln: { radiusX: 4.7, radiusZ: 4.1, innerFade: 0.88, outerFade: 1.3 },
  well: { radiusX: 2.2, radiusZ: 2.2, innerFade: 0.9, outerFade: 1.2 },
  stable: { radiusX: 6.4, radiusZ: 4.2, innerFade: 0.9, outerFade: 1.3 },
  cavalry_yard: { radiusX: 11.8, radiusZ: 8.2, innerFade: 0.9, outerFade: 1.35 },
  kennel: { radiusX: 5.1, radiusZ: 4.5, innerFade: 0.9, outerFade: 1.3 },
  hunters_hall: { radiusX: 6.1, radiusZ: 5.4, innerFade: 0.88, outerFade: 1.34 },
  foragers_shed: { radiusX: 4.2, radiusZ: 3.8, innerFade: 0.88, outerFade: 1.3 },
  fishing_camp: { radiusX: 5.55, radiusZ: 5.15, innerFade: 0.88, outerFade: 1.3 },
  // Permanent fenced churchyard: 14.076 x 18.7956 m at every church tier.
  // Reserves the largest church's buttresses, eaves, steps and entrance court.
  chapel: { radiusX: 8.5, radiusZ: 11.35, innerFade: 0.9, outerFade: 1.22 },
  wayside_shrine: { radiusX: 1.65, radiusZ: 1.5, innerFade: 0.9, outerFade: 1.24 },
  marketplace: { radiusX: 4.2, radiusZ: 3.4, innerFade: 0.9, outerFade: 1.3 },
  trading_post: { radiusX: 6.6, radiusZ: 5.4, innerFade: 0.88, outerFade: 1.3 },
  town_hall: { radiusX: 7.2, radiusZ: 5.8, innerFade: 0.88, outerFade: 1.32 },
  village_storehouse: { radiusX: 6.3, radiusZ: 5.2, innerFade: 0.88, outerFade: 1.3 },
  watchtower: { radiusX: 3.0, radiusZ: 3.0, innerFade: 0.9, outerFade: 1.3 },
  guardhouse: { radiusX: 6.8, radiusZ: 4.8, innerFade: 0.88, outerFade: 1.3 },
  palisaded_refuge: { radiusX: 9.2, radiusZ: 7.2, innerFade: 0.88, outerFade: 1.28 },
  threshing_barn: { radiusX: 6.5, radiusZ: 5.0, innerFade: 0.88, outerFade: 1.3 },
  monastery: { radiusX: 9.5, radiusZ: 6.8, innerFade: 0.86, outerFade: 1.35 },
  brewery: { radiusX: 5.6, radiusZ: 4.7, innerFade: 0.88, outerFade: 1.3 },
  tavern: { radiusX: 5.4, radiusZ: 4.6, innerFade: 0.88, outerFade: 1.3 },
  smokehouse: { radiusX: 4.4, radiusZ: 4.0, innerFade: 0.88, outerFade: 1.28 },
  granary: { radiusX: 5.8, radiusZ: 4.7, innerFade: 0.88, outerFade: 1.3 },
  bakery: { radiusX: 5.1, radiusZ: 4.5, innerFade: 0.88, outerFade: 1.3 },
  apiary: { radiusX: 5.3, radiusZ: 4.6, innerFade: 0.88, outerFade: 1.28 },
  watermill: { radiusX: 6.7, radiusZ: 4.9, innerFade: 0.86, outerFade: 1.35 },
  windmill: { radiusX: 7.2, radiusZ: 6.0, innerFade: 0.86, outerFade: 1.34 },
  carpenter: { radiusX: 6.4, radiusZ: 4.8, innerFade: 0.88, outerFade: 1.32 },
  spinning_retting_house: { radiusX: 6.3, radiusZ: 5.2, innerFade: 0.88, outerFade: 1.31 },
  weaver: { radiusX: 5.8, radiusZ: 4.5, innerFade: 0.88, outerFade: 1.3 },
  tannery: { radiusX: 5.2, radiusZ: 5.4, innerFade: 0.86, outerFade: 1.32 },
  cobbler: { radiusX: 4.2, radiusZ: 4.1, innerFade: 0.88, outerFade: 1.3 },
  chandlery: { radiusX: 6.0, radiusZ: 5.2, innerFade: 0.88, outerFade: 1.31 },
  pastoral_farmstead: { radiusX: 7.2, radiusZ: 5.4, innerFade: 0.88, outerFade: 1.3 },
  swineherd: { radiusX: 6.2, radiusZ: 5.2, innerFade: 0.88, outerFade: 1.28 },
};

/** Shared scale for the visible building footprint and its perimeter features. */
export const BUILDING_FOOTPRINT_SCALE = 0.92;

export function getBuildingPadParams(kind: BuildingKind): BuildingPadParams {
  return BUILDING_PAD_PARAMS[kind];
}

/** Half-extents of the exact rectangular footprint shown during placement. */
export function getBuildingFootprintHalfExtents(kind: BuildingKind): {
  halfWidth: number;
  halfDepth: number;
} {
  const params = BUILDING_PAD_PARAMS[kind];
  return {
    halfWidth: params.radiusX * params.innerFade * BUILDING_FOOTPRINT_SCALE,
    halfDepth: params.radiusZ * params.innerFade * BUILDING_FOOTPRINT_SCALE,
  };
}
