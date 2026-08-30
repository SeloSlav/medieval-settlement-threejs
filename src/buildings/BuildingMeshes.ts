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

function addWeaponsmithYard(workshop: THREE.Group): void {
  const iron = new THREE.MeshStandardMaterial({ color: 0x343332, roughness: 0.58, metalness: 0.62 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b3922, roughness: 0.9 });
  const hide = new THREE.MeshStandardMaterial({ color: 0x7b4b2a, roughness: 0.86 });
  const rack = new THREE.Group();
  rack.name = 'Weaponsmith yard racks';
  rack.position.set(3.15, 0, 0.2);

  for (const x of [-0.74, 0.74]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 0.16), wood);
    post.position.set(x, 0.95, 0);
    rack.add(post);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 0.18), wood);
  rail.position.set(0, 1.48, 0);
  rack.add(rail);

  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.14, 20), hide);
  shield.rotation.z = Math.PI / 2;
  shield.position.set(-0.38, 1.03, -0.16);
  rack.add(shield);
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), iron);
  boss.scale.x = 0.42;
  boss.position.set(-0.47, 1.03, -0.16);
  rack.add(boss);

  for (const [index, z] of [-0.34, 0.02, 0.36].entries()) {
    const weapon = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 2.08, 7), wood);
    shaft.position.y = 1.04;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.35, 5), iron);
    head.position.y = 2.24;
    weapon.add(shaft, head);
    weapon.position.set(0.22 + index * 0.2, 0, z);
    weapon.rotation.z = -0.08 + index * 0.07;
    rack.add(weapon);
  }
  workshop.add(rack);
}

function addBowyerYard(workshop: THREE.Group): void {
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4528, roughness: 0.92 });
  const straw = new THREE.MeshStandardMaterial({ color: 0xb18a43, roughness: 1 });
  const linen = new THREE.MeshStandardMaterial({ color: 0xd4c39b, roughness: 0.92 });
  const yard = new THREE.Group();
  yard.name = 'Bowyer target and bow rack';
  yard.position.set(3.0, 0, 0.25);

  const stand = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.18, 0.56), wood);
  stand.position.y = 0.28;
  yard.add(stand);
  const target = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.3, 24), straw);
  target.rotation.z = Math.PI / 2;
  target.position.set(0, 1.15, 0);
  yard.add(target);
  for (const radius of [0.48, 0.26, 0.09]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.026, 6, 28), linen);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-0.17, 1.15, 0);
    yard.add(ring);
  }

  const bowCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.8, 0.35, -0.72),
    new THREE.Vector3(1.02, 0.84, -0.8),
    new THREE.Vector3(1.08, 1.36, -0.82),
    new THREE.Vector3(0.8, 1.84, -0.72),
  ]);
  const bow = new THREE.Mesh(new THREE.TubeGeometry(bowCurve, 18, 0.035, 6, false), wood);
  yard.add(bow);
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.49, 5), linen);
  string.position.set(0.8, 1.095, -0.72);
  yard.add(string);
  workshop.add(yard);
}

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
    case 'weaponsmith_armorer': {
      const workshop = createSmithyMesh();
      workshop.name = 'Weaponsmith and armorer';
      addWeaponsmithYard(workshop);
      return workshop;
    }
    case 'bowyer_fletcher': {
      const workshop = createCarpenterMesh();
      workshop.name = 'Bowyer and fletcher';
      addBowyerYard(workshop);
      return workshop;
    }
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
