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
import { createSpinningRettingHouseMesh } from './meshes/spinningRettingHouseMesh.ts';
import {
  createAuthoredFishingCampMesh,
  createAuthoredHuntersCampMesh,
  createAuthoredLargeQuarryMesh,
  createAuthoredLumberMillMesh,
  createAuthoredMineworksMesh,
  createAuthoredMiningCampMesh,
  createAuthoredTierOneChurchMesh,
  createAuthoredWaysideShrineMesh,
} from './authoredArchitectureModels.ts';

export function createBuildingMesh(
  kind: BuildingKind,
  developmentTier?: 0 | 1 | 2 | 3,
  monasteryPlanting?: {
    orchard: number;
    croft: number;
    extensions?: number;
    orchardMaturity?: number;
  },
): THREE.Group {
  const chapelTier = Math.max(1, developmentTier ?? 3) as 1 | 2 | 3;
  switch (kind) {
    case 'founders_camp':
      return createFoundersCampMesh();
    case 'salvage_pile':
      return createSalvagePileMesh();
    case 'lumber_mill':
      return createAuthoredLumberMillMesh() ?? createLumberMillMesh();
    case 'reforester':
      return createReforesterHutMesh();
    case 'woodcutters_lodge':
      return createWoodcuttersLodgeMesh();
    case 'stone_quarry':
      return createAuthoredMiningCampMesh() ?? createStoneQuarryMesh();
    case 'large_quarry':
      return createAuthoredLargeQuarryMesh() ?? createLargeQuarryMesh();
    case 'mine':
      return createAuthoredMineworksMesh() ?? createMineralMineMesh();
    case 'charcoal_burner':
      return createCharcoalBurnerMesh();
    case 'smithy':
      return createSmithyMesh();
    case 'potter_kiln':
      return createPotterKilnMesh();
    case 'well':
      return createWellMesh();
    case 'stable':
      return createStableMesh();
    case 'hunters_hall':
      return createAuthoredHuntersCampMesh() ?? createHuntersHallMesh();
    case 'foragers_shed':
      return createForagersShedMesh();
    case 'fishing_camp':
      return createAuthoredFishingCampMesh() ?? createFishingCampMesh();
    case 'chapel':
      return chapelTier === 1
        ? createAuthoredTierOneChurchMesh() ?? createChapelMesh(chapelTier)
        : createChapelMesh(chapelTier);
    case 'wayside_shrine':
      return createAuthoredWaysideShrineMesh() ?? createWaysideShrineMesh();
    case 'marketplace':
      return createMarketplaceMesh();
    case 'trading_post': {
      const tradingPost = createVillageStorehouseMesh();
      tradingPost.name = 'Trading post';
      return tradingPost;
    }
    case 'town_hall': return createTownHallMesh();
    case 'village_storehouse': return createVillageStorehouseMesh();
    case 'watchtower': return createWatchtowerMesh();
    case 'guardhouse': return createGuardhouseMesh();
    case 'palisaded_refuge': return createPalisadedRefugeMesh();
    case 'threshing_barn': return createThreshingBarnMesh();
    case 'monastery': return createMonasteryMesh(
      monasteryPlanting?.extensions ?? developmentTier ?? 0,
      monasteryPlanting?.orchard ?? 0,
      monasteryPlanting?.croft ?? 0,
      monasteryPlanting?.orchardMaturity ?? 2,
    );
    case 'brewery': return createBreweryMesh();
    case 'tavern': return createTavernMesh();
    case 'smokehouse': return createSmokehouseMesh();
    case 'granary': return createGranaryMesh();
    case 'bakery': return createBakeryMesh();
    case 'apiary': return createApiaryMesh();
    case 'watermill': return createWatermillMesh();
    case 'windmill': return createWindmillMesh();
    case 'carpenter': return createCarpenterMesh();
    case 'spinning_retting_house': return createSpinningRettingHouseMesh();
    case 'weaver': return createWeaverMesh();
    case 'tannery': return createTanneryMesh();
    case 'cobbler': return createCobblerMesh();
    case 'chandlery': return createChandleryMesh();
    case 'pastoral_farmstead': return createPastoralFarmsteadMesh();
    case 'swineherd': return createSwineherdMesh();
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
