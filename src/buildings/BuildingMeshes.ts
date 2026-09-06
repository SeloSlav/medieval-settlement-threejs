import { createStoneMasonMesh } from './meshes/stoneMasonMesh.ts';
import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import { createFoundersCampMesh } from './meshes/foundersCampMesh.ts';
import { createSalvagePileMesh } from './meshes/salvagePileMesh.ts';
import { createChapelMesh } from './meshes/chapelMesh.ts';
import { createWaysideShrineMesh } from './meshes/waysideShrineMesh.ts';
import {
  createLumberMillMesh,
  createReforesterHutMesh,
  createWoodcuttersLodgeMesh,
} from './meshes/industryBuildingMeshes.ts';
import { createMarketplaceMesh } from './meshes/marketplaceMesh.ts';
import { createTavernMesh } from './meshes/tavernBuildingMesh.ts';
import {
  createForagersShedMesh,
  createFishingCampMesh,
  createHuntersHallMesh,
  createWellMesh,
} from './meshes/serviceBuildingMeshes.ts';
import { createStoneQuarryMesh } from './meshes/stoneQuarryMesh.ts';
import { createLargeQuarryMesh } from './meshes/largeQuarryMesh.ts';
import { createMineralMineMesh } from './meshes/mineralMineMesh.ts';
import {
  createCharcoalBurnerMesh,
  createPotterKilnMesh,
  createSmithyMesh,
} from './meshes/materialChainBuildingMeshes.ts';
import {
  createApiaryMesh,
  createBakeryMesh,
  createBreweryMesh,
  createCarpenterMesh,
  createGranaryMesh,
  createMonasteryMesh,
  createSmokehouseMesh,
  createThreshingBarnMesh,
  createWatermillMesh,
  createWindmillMesh,
  createWeaverMesh,
} from './meshes/expandedBuildingMeshes.ts';
import {
  createPastoralFarmsteadMesh,
  createSwineherdMesh,
} from './meshes/livestockBuildingMeshes.ts';
import {
  createTownHallMesh,
  createVillageStorehouseMesh,
  createWatchtowerMesh,
  createGuardhouseMesh,
  createPalisadedRefugeMesh,
} from './meshes/civicLogisticsBuildingMeshes.ts';
import { createCobblerMesh, createTanneryMesh } from './meshes/leatherChainBuildingMeshes.ts';
import { createChandleryMesh } from './meshes/chandleryBuildingMesh.ts';
import { createStableMesh } from './meshes/stableMesh.ts';
import { createCavalryYardMesh } from './meshes/cavalryYardMesh.ts';
import { createKennelMesh } from './meshes/kennelMesh.ts';
import { createSpinningRettingHouseMesh } from './meshes/spinningRettingHouseMesh.ts';
import {
  createBowyerFletcherMesh,
  createTradingPostMesh,
  createWeaponsmithArmorerMesh,
} from './meshes/specialistWorkshopMeshes.ts';
import {
  compileProceduralBuilding,
  type ProceduralBuildingVisualRequest,
} from './proceduralArchitecture/compiler.ts';
import type {
  MonasteryExtensionMask,
} from './proceduralArchitecture/visualRequest.ts';

const CANONICAL_PROCEDURAL_SEED = 1550;

type ProceduralGeneratorContext = {
  readonly developmentTier?: 0 | 1 | 2 | 3 | 4;
  readonly monasteryPlanting?: {
    readonly orchard: number;
    readonly croft: number;
    readonly extensions?: number;
    readonly orchardMaturity?: number;
  };
};

type ProceduralBuildingGenerator = (context: ProceduralGeneratorContext) => THREE.Group;


/** Compile-time exhaustive generator registry for every canonical BuildingKind. */
export const PROCEDURAL_BUILDING_GENERATORS = {
  founders_camp: () => createFoundersCampMesh(),
  salvage_pile: () => createSalvagePileMesh(),
  lumber_mill: () => createLumberMillMesh(),
  reforester: () => createReforesterHutMesh(),
  woodcutters_lodge: () => createWoodcuttersLodgeMesh(),
  stone_quarry: () => createStoneQuarryMesh(),
  large_quarry: () => createLargeQuarryMesh(),
  mine: () => createMineralMineMesh(),
  charcoal_burner: () => createCharcoalBurnerMesh(),
  smithy: () => createSmithyMesh(),
  weaponsmith_armorer: () => createWeaponsmithArmorerMesh(),
  bowyer_fletcher: () => createBowyerFletcherMesh(),
  stone_mason: () => createStoneMasonMesh(),
  potter_kiln: () => createPotterKilnMesh(),
  well: () => createWellMesh(),
  stable: () => createStableMesh(),
  cavalry_yard: () => createCavalryYardMesh(),
  kennel: () => createKennelMesh(),
  hunters_hall: () => createHuntersHallMesh(),
  foragers_shed: () => createForagersShedMesh(),
  fishing_camp: () => createFishingCampMesh(),
  chapel: ({ developmentTier }) => createChapelMesh(
    Math.max(1, developmentTier ?? 3) as 1 | 2 | 3 | 4,
  ),
  wayside_shrine: () => createWaysideShrineMesh(),
  marketplace: () => createMarketplaceMesh(),
  trading_post: () => createTradingPostMesh(),
  town_hall: () => createTownHallMesh(),
  village_storehouse: () => createVillageStorehouseMesh(),
  watchtower: () => createWatchtowerMesh(),
  guardhouse: () => createGuardhouseMesh(),
  palisaded_refuge: () => createPalisadedRefugeMesh(),
  threshing_barn: () => createThreshingBarnMesh(),
  pastoral_farmstead: () => createPastoralFarmsteadMesh(),
  swineherd: () => createSwineherdMesh(),
  monastery: ({ developmentTier, monasteryPlanting }) => createMonasteryMesh(
    monasteryPlanting?.extensions ?? developmentTier ?? 0,
    monasteryPlanting?.orchard ?? 0,
    monasteryPlanting?.croft ?? 0,
    monasteryPlanting?.orchardMaturity ?? 2,
  ),
  brewery: () => createBreweryMesh(),
  tavern: () => createTavernMesh(),
  smokehouse: () => createSmokehouseMesh(),
  granary: () => createGranaryMesh(),
  bakery: () => createBakeryMesh(),
  apiary: () => createApiaryMesh(),
  watermill: () => createWatermillMesh(),
  windmill: () => createWindmillMesh(),
  carpenter: () => createCarpenterMesh(),
  spinning_retting_house: () => createSpinningRettingHouseMesh(),
  weaver: () => createWeaverMesh(),
  tannery: () => createTanneryMesh(),
  cobbler: () => createCobblerMesh(),
  chandlery: () => createChandleryMesh(),
} satisfies Record<BuildingKind, ProceduralBuildingGenerator>;

function createRawBuildingMesh(
  kind: BuildingKind,
  developmentTier?: 0 | 1 | 2 | 3 | 4,
  monasteryPlanting?: ProceduralGeneratorContext['monasteryPlanting'],
): THREE.Group {
  return PROCEDURAL_BUILDING_GENERATORS[kind]({
    developmentTier,
    monasteryPlanting,
  });
}

/**
 * Authoritative runtime entry point for every placeable non-residence visual.
 * GLBs remain in art-source as comparison evidence, but no placeable building
 * depends on them at runtime.
 */
export function createBuildingMesh(
  kind: BuildingKind,
  developmentTier?: 0 | 1 | 2 | 3 | 4,
  monasteryPlanting?: {
    orchard: number;
    croft: number;
    extensions?: number;
    orchardMaturity?: number;
  },
): THREE.Group {
  const visualRequest = createCanonicalVisualRequest(
    kind,
    developmentTier,
    monasteryPlanting,
  );
  return compileProceduralBuilding({
    kind,
    request: visualRequest,
    developmentTier: kind === 'chapel'
      ? Math.max(1, developmentTier ?? 3) as 1 | 2 | 3 | 4
      : 0,
    generate: () => createRawBuildingMesh(kind, developmentTier, monasteryPlanting),
  });
}

function createCanonicalVisualRequest(
  kind: BuildingKind,
  developmentTier: 0 | 1 | 2 | 3 | 4 | undefined,
  monasteryPlanting: {
    orchard: number;
    croft: number;
    extensions?: number;
    orchardMaturity?: number;
  } | undefined,
): ProceduralBuildingVisualRequest {
  if (kind === 'chapel') {
    return {
      type: 'church',
      kind,
      tier: Math.max(1, developmentTier ?? 3) as 1 | 2 | 3 | 4,
      seed: CANONICAL_PROCEDURAL_SEED,
    };
  }
  if (kind === 'monastery') {
    return {
      type: 'monastery',
      kind,
      extensions: ((monasteryPlanting?.extensions ?? developmentTier ?? 0) & 15) as MonasteryExtensionMask,
      orchardMaturity: Math.max(
        0,
        Math.min(2, monasteryPlanting?.orchardMaturity ?? 2),
      ) as 0 | 1 | 2,
      seed: CANONICAL_PROCEDURAL_SEED,
    };
  }
  return {
    type: 'building',
    kind,
    seed: CANONICAL_PROCEDURAL_SEED,
  };
}
