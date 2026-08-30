import * as THREE from 'three';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, normalMap, pow, texture, uv, vec2, vec3 } from 'three/tsl';
import type { BuildingTerrainSource } from '../buildings/BuildingTerrainLayout.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import {
  disposeRockTextureSet,
  type RockTextureSet,
} from '../utils/propTextureLoad.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { RiverField } from './RiverField.ts';
import { createRiverBankMeshes } from './RiverBankMesh.ts';
import { createRiverReeds, type RiverReedField } from './RiverReeds.ts';
import { createRiverLilyPads, type RiverLilyPadField } from './RiverLilyPads.ts';
import { createRiverShoreStones } from './RiverShoreStones.ts';
import { createRiverWaterMesh, disposeSharedRiverWaterMaterial } from './RiverWaterMesh.ts';
import { setSharedRiverWaterNightAmount } from './RiverWaterMaterial.ts';
import type { RockObstacle } from '../utils/pathGeometry.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import { isReedZoomActive } from '../grass/grassLodMath.ts';
import { disposeObject3D } from '../utils/dispose.ts';

type TslNode = {
  mul(value: TslNode | number): TslNode;
  x: TslNode;
  r: TslNode;
  rgb: TslNode;
};

function createPropShadowMaterials(): {
  shadowCast: THREE.MeshStandardMaterial;
  shadowDepth: THREE.MeshDepthMaterial;
} {
  return {
    shadowCast: new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    }),
    shadowDepth: new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
    }),
  };
}

export type RiverSystem = {
  field: RiverField;
  group: THREE.Group;
  reedsGroup: THREE.Group;
  finishDetails: () => Promise<void>;
  getShoreRockPlacements: () => ReadonlyArray<RockObstacle>;
  syncPlacementClearance: (
    buildings: Iterable<BuildingTerrainSource>,
    farmFieldPolygons: Iterable<Point2[]>,
  ) => void;
  syncRoadClearance: (network: RoadNetwork | null) => void;
  isBlockedAt: (x: number, z: number) => boolean;
  isGrassBlockedAt: (x: number, z: number) => boolean;
  updateCameraState: (
    cameraPosition: THREE.Vector3,
    cameraTarget: THREE.Vector3,
    cameraDistance: number,
    firstPersonActive?: boolean,
  ) => void;
  setNightAmount: (nightAmount: number) => void;
  tick: (dt: number, timeSec: number) => void;
  dispose: () => void;
};

export async function createRiverSystem(
  terrain: Terrain,
  riverField: RiverField,
  bankMaterial: MeshStandardNodeMaterial,
  rockTextures: RockTextureSet<'river'>,
  maxAnisotropy: number,
  rendererBackend: RendererBackendKind,
): Promise<RiverSystem> {
  const group = new THREE.Group();
  group.name = 'River system';

  const rockMaterial = createRiverRockMaterial(rockTextures);
  if (riverField.layout.terrainPreset === 'kupa_valley') {
    configureRiverCarbonateBankMaterial(bankMaterial, rockTextures);
  }
  const rockShadowMaterials = createPropShadowMaterials();
  const waterController = createRiverWaterMesh(group, terrain, riverField);
  const reedsGroup = new THREE.Group();
  reedsGroup.name = 'Progressive river reeds';
  group.add(reedsGroup);
  let shoreStones: ReturnType<typeof createRiverShoreStones> | null = null;
  let reeds: RiverReedField | null = null;
  let lilyPads: RiverLilyPadField | null = null;
  let detailsPromise: Promise<void> | null = null;
  let disposed = false;
  let clearance: {
    buildings: BuildingTerrainSource[];
    farmFieldPolygons: Point2[][];
  } | null = null;
  let roadNetwork: RoadNetwork | null = null;

  const finishDetails = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (detailsPromise) return detailsPromise;
    detailsPromise = (async () => {
      const nextShoreStones = createRiverShoreStones(
        terrain,
        riverField,
        rockMaterial,
        rockShadowMaterials,
        mulberry32(0x71ee1212),
      );
      const bankMeshes = createRiverBankMeshes(terrain, riverField, bankMaterial);
      const [nextReeds, nextLilyPads] = await Promise.all([
        createRiverReeds(
          terrain,
          riverField,
          mulberry32(0x8eed1212),
          maxAnisotropy,
          rendererBackend,
        ),
        createRiverLilyPads(
          terrain,
          riverField,
          mulberry32(0x11171212),
          maxAnisotropy,
        ),
      ]);
      if (disposed) {
        disposeObject3D(nextShoreStones.group);
        disposeObject3D(bankMeshes);
        nextReeds.dispose();
        nextLilyPads.dispose();
        return;
      }
      shoreStones = nextShoreStones;
      reeds = nextReeds;
      lilyPads = nextLilyPads;
      group.add(nextShoreStones.group, bankMeshes);
      group.add(nextLilyPads.group);
      reedsGroup.add(nextReeds.group);
      if (clearance) {
        nextShoreStones.syncPlacementClearance(clearance.buildings, clearance.farmFieldPolygons);
      }
      nextShoreStones.syncRoadClearance(roadNetwork);
    })();
    return detailsPromise;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    waterController?.dispose();
    disposeSharedRiverWaterMaterial();
    rockMaterial.dispose();
    disposeRockTextureSet(rockTextures);
    rockShadowMaterials.shadowCast.dispose();
    rockShadowMaterials.shadowDepth.dispose();
    reeds?.dispose();
    lilyPads?.dispose();
  };

  return {
    field: riverField,
    group,
    reedsGroup,
    finishDetails,
    getShoreRockPlacements: () => shoreStones?.placements ?? [],
    syncPlacementClearance: (buildings, farmFieldPolygons) => {
      clearance = {
        buildings: [...buildings],
        farmFieldPolygons: [...farmFieldPolygons],
      };
      shoreStones?.syncPlacementClearance(clearance.buildings, clearance.farmFieldPolygons);
    },
    syncRoadClearance: (network) => {
      roadNetwork = network;
      shoreStones?.syncRoadClearance(network);
    },
    isBlockedAt: (x, z) => riverField.isBlockedForProps(x, z),
    isGrassBlockedAt: (x, z) => riverField.isGrassBlockedAt(x, z),
    updateCameraState: (cameraPosition, cameraTarget, cameraDistance, firstPersonActive) => {
      reedsGroup.visible = firstPersonActive === true || isReedZoomActive(cameraDistance);
      reeds?.updateCameraState(cameraPosition, cameraTarget, cameraDistance, firstPersonActive);
    },
    setNightAmount: setSharedRiverWaterNightAmount,
    tick: (dt, timeSec) => waterController?.tick(dt, timeSec),
    dispose: () => {
      dispose();
    },
  };
}

function createRiverRockMaterial(rockTextures: RockTextureSet<'river'>): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: rockTextures.map,
    normalMap: rockTextures.normalMap,
    roughnessMap: rockTextures.roughnessMap,
    aoMap: rockTextures.aoMap,
    color: 0xf0eee5,
    roughness: 0.88,
    metalness: 0,
    vertexColors: true,
  });
  material.normalScale.set(0.62, 0.62);
  material.aoMapIntensity = 0.72;
  return material;
}

function configureRiverCarbonateBankMaterial(
  material: MeshStandardNodeMaterial,
  rockTextures: RockTextureSet<'river'>,
): void {
  const bankUv = uv() as unknown as TslNode;
  const mineralUv = attribute('uv1', 'vec2') as unknown as TslNode;
  const mineralSample = texture(rockTextures.map, mineralUv as never) as unknown as TslNode;
  const wetEdge = pow(bankUv.x, float(1.38)) as unknown as TslNode;
  const paleCarbonate = mineralSample.rgb.mul(vec3(1.02, 1.01, 0.96) as unknown as TslNode);
  const waterlineMoss = mineralSample.rgb.mul(vec3(0.32, 0.45, 0.24) as unknown as TslNode);
  material.name = 'Kupa pale carbonate and moss river bank';
  material.colorNode = mix(
    paleCarbonate as never,
    waterlineMoss as never,
    wetEdge.mul(0.72) as never,
  );
  material.normalNode = normalMap(
    texture(rockTextures.normalMap, mineralUv as never),
    vec2(0.62, 0.62),
  );
  const roughSample = (texture(
    rockTextures.roughnessMap,
    mineralUv as never,
  ) as unknown as TslNode).r;
  material.roughnessNode = mix(
    roughSample as never,
    float(0.54),
    wetEdge.mul(0.58) as never,
  );
  if (rockTextures.aoMap) {
    material.aoNode = (texture(
      rockTextures.aoMap,
      mineralUv as never,
    ) as unknown as TslNode).r as never;
  }
  material.userData.riverBankSurface = 'pale-carbonate-waterline-moss';
  material.needsUpdate = true;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
