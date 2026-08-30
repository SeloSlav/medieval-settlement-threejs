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
  compileProceduralBuilding,
  type ProceduralBuildingVisualRequest,
} from './proceduralArchitecture/compiler.ts';
import {
  addMesh,
  sharedBuildingDetailMaterial,
  sharedBuildingMaterial,
} from './buildingMaterials.ts';
import type {
  MonasteryExtensionMask,
} from './proceduralArchitecture/visualRequest.ts';

const CANONICAL_PROCEDURAL_SEED = 1550;

function addWeaponsmithYard(workshop: THREE.Group): void {
  const iron = sharedBuildingMaterial('metalIron');
  const wood = sharedBuildingMaterial('timberMid');
  const hide = sharedBuildingDetailMaterial('wicker');
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
  const wood = sharedBuildingMaterial('timberMid');
  const straw = sharedBuildingDetailMaterial('wicker');
  const linen = sharedBuildingDetailMaterial('canvas');
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

type ProceduralGeneratorContext = {
  readonly developmentTier?: 0 | 1 | 2 | 3;
  readonly monasteryPlanting?: {
    readonly orchard: number;
    readonly croft: number;
    readonly extensions?: number;
    readonly orchardMaturity?: number;
  };
};

type ProceduralBuildingGenerator = (context: ProceduralGeneratorContext) => THREE.Group;

function createWeaponsmithMesh(): THREE.Group {
  const workshop = createSmithyMesh();
  workshop.name = 'Weaponsmith and armorer';
  addWeaponsmithYard(workshop);
  return workshop;
}

function createBowyerMesh(): THREE.Group {
  const workshop = createCarpenterMesh();
  workshop.name = 'Bowyer and fletcher';
  addBowyerYard(workshop);
  return workshop;
}

function createTradingPostMesh(): THREE.Group {
  const tradingPost = createVillageStorehouseMesh();
  tradingPost.name = 'Trading post';
  const canopy = new THREE.Group();
  canopy.name = 'Trading post covered loading bay';
  for (const x of [-2.15, 2.15]) {
    const post = addMesh(
      canopy,
      new THREE.BoxGeometry(0.24, 2.55, 0.24),
      sharedBuildingMaterial('timberDark'),
      new THREE.Vector3(x, 1.275, 5.15),
    );
    post.name = 'Trading post loading-bay post';
  }
  const roof = addMesh(
    canopy,
    new THREE.BoxGeometry(5.1, 0.16, 2.75),
    sharedBuildingMaterial('shingle'),
    new THREE.Vector3(0, 2.72, 4.75),
    new THREE.Euler(0.11, 0, 0),
  );
  roof.name = 'Trading post loading-bay shingle roof';
  const sign = addMesh(
    canopy,
    new THREE.BoxGeometry(1.15, 0.62, 0.1),
    sharedBuildingMaterial('timberWeathered'),
    new THREE.Vector3(0, 2.2, 6.02),
  );
  sign.name = 'Trading post road signboard';
  tradingPost.add(canopy);
  return tradingPost;
}

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
  weaponsmith_armorer: () => createWeaponsmithMesh(),
  bowyer_fletcher: () => createBowyerMesh(),
  potter_kiln: () => createPotterKilnMesh(),
  well: () => createWellMesh(),
  stable: () => createStableMesh(),
  hunters_hall: () => createHuntersHallMesh(),
  foragers_shed: () => createForagersShedMesh(),
  fishing_camp: () => createFishingCampMesh(),
  chapel: ({ developmentTier }) => createChapelMesh(
    Math.max(1, developmentTier ?? 3) as 1 | 2 | 3,
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
  developmentTier?: 0 | 1 | 2 | 3,
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
  developmentTier?: 0 | 1 | 2 | 3,
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
      ? Math.max(1, developmentTier ?? 3) as 1 | 2 | 3
      : 0,
    generate: () => createRawBuildingMesh(kind, developmentTier, monasteryPlanting),
  });
}

function createCanonicalVisualRequest(
  kind: BuildingKind,
  developmentTier: 0 | 1 | 2 | 3 | undefined,
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
      tier: Math.max(1, developmentTier ?? 3) as 1 | 2 | 3,
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
