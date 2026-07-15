import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import { createChapelMesh } from './meshes/chapelMesh.ts';
import {
  createLumberMillMesh,
  createReforesterHutMesh,
  createWoodcuttersLodgeMesh,
} from './meshes/industryBuildingMeshes.ts';
import { createMarketplaceMesh } from './meshes/marketplaceMesh.ts';
import {
  createForagersShedMesh,
  createHuntersHallMesh,
  createWellMesh,
} from './meshes/serviceBuildingMeshes.ts';
import { createStoneQuarryMesh } from './meshes/stoneQuarryMesh.ts';
import {
  createApiaryMesh,
  createBreweryMesh,
  createCarpenterMesh,
  createFerryLandingMesh,
  createGranaryMesh,
  createMonasteryMesh,
  createSmokehouseMesh,
  createThreshingBarnMesh,
  createVineyardMesh,
  createWatermillMesh,
} from './meshes/expandedBuildingMeshes.ts';
import {
  createPastoralFarmsteadMesh,
  createSwineherdMesh,
} from './meshes/livestockBuildingMeshes.ts';
import { createTownHallMesh, createVillageStorehouseMesh } from './meshes/civicLogisticsBuildingMeshes.ts';

export function createBuildingMesh(kind: BuildingKind): THREE.Group {
  switch (kind) {
    case 'lumber_mill':
      return createLumberMillMesh();
    case 'reforester':
      return createReforesterHutMesh();
    case 'woodcutters_lodge':
      return createWoodcuttersLodgeMesh();
    case 'stone_quarry':
      return createStoneQuarryMesh();
    case 'well':
      return createWellMesh();
    case 'hunters_hall':
      return createHuntersHallMesh();
    case 'foragers_shed':
      return createForagersShedMesh();
    case 'chapel':
      return createChapelMesh();
    case 'marketplace':
      return createMarketplaceMesh();
    case 'town_hall': return createTownHallMesh();
    case 'village_storehouse': return createVillageStorehouseMesh();
    case 'threshing_barn': return createThreshingBarnMesh();
    case 'monastery': return createMonasteryMesh();
    case 'brewery': return createBreweryMesh();
    case 'smokehouse': return createSmokehouseMesh();
    case 'granary': return createGranaryMesh();
    case 'apiary': return createApiaryMesh();
    case 'watermill': return createWatermillMesh();
    case 'carpenter': return createCarpenterMesh();
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
