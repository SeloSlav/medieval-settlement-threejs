import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import { createFoundersCampMesh, createRemoteWorkCampMesh } from './meshes/foundersCampMesh.ts';
import { createSalvagePileMesh } from './meshes/salvagePileMesh.ts';
import { createChapelMesh } from './meshes/chapelMesh.ts';
import {
  createLumberMillMesh,
  createReforesterHutMesh,
  createWoodcuttersLodgeMesh,
} from './meshes/industryBuildingMeshes.ts';
import { createMarketplaceMesh } from './meshes/marketplaceMesh.ts';
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
  createClayPitMesh,
  createPotterKilnMesh,
  createSmithyMesh,
} from './meshes/materialChainBuildingMeshes.ts';
import {
  createApiaryMesh,
  createBakeryMesh,
  createBreweryMesh,
  createCarpenterMesh,
  createFerryLandingMesh,
  createGranaryMesh,
  createMonasteryMesh,
  createSmokehouseMesh,
  createThreshingBarnMesh,
  createVineyardMesh,
  createWatermillMesh,
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

export function createBuildingMesh(kind: BuildingKind, chapelTier: 1 | 2 | 3 = 3): THREE.Group {
  switch (kind) {
    case 'founders_camp':
      return createFoundersCampMesh();
    case 'salvage_pile':
      return createSalvagePileMesh();
    case 'remote_work_camp':
      return createRemoteWorkCampMesh();
    case 'lumber_mill':
      return createLumberMillMesh();
    case 'reforester':
      return createReforesterHutMesh();
    case 'woodcutters_lodge':
      return createWoodcuttersLodgeMesh();
    case 'stone_quarry':
      return createStoneQuarryMesh();
    case 'large_quarry':
      return createLargeQuarryMesh();
    case 'mine':
      return createMineralMineMesh();
    case 'clay_pit':
      return createClayPitMesh();
    case 'charcoal_burner':
      return createCharcoalBurnerMesh();
    case 'smithy':
      return createSmithyMesh();
    case 'potter_kiln':
      return createPotterKilnMesh();
    case 'well':
      return createWellMesh();
    case 'hunters_hall':
      return createHuntersHallMesh();
    case 'foragers_shed':
      return createForagersShedMesh();
    case 'fishing_camp':
      return createFishingCampMesh();
    case 'chapel':
      return createChapelMesh(chapelTier);
    case 'marketplace':
      return createMarketplaceMesh();
    case 'town_hall': return createTownHallMesh();
    case 'village_storehouse': return createVillageStorehouseMesh();
    case 'watchtower': return createWatchtowerMesh();
    case 'guardhouse': return createGuardhouseMesh();
    case 'palisaded_refuge': return createPalisadedRefugeMesh();
    case 'threshing_barn': return createThreshingBarnMesh();
    case 'monastery': return createMonasteryMesh();
    case 'brewery': return createBreweryMesh();
    case 'smokehouse': return createSmokehouseMesh();
    case 'granary': return createGranaryMesh();
    case 'bakery': return createBakeryMesh();
    case 'apiary': return createApiaryMesh();
    case 'watermill': return createWatermillMesh();
    case 'carpenter': return createCarpenterMesh();
    case 'weaver': return createWeaverMesh();
    case 'ferry_landing': return createFerryLandingMesh();
    case 'vineyard': return createVineyardMesh();
    case 'pastoral_farmstead': return createPastoralFarmsteadMesh();
    case 'swineherd': return createSwineherdMesh();
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
