import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import { MAIN_HOUSE_DEPTH, MAIN_HOUSE_WIDTH } from '../residences/burgageLayout.ts';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import { getBuildingPadParams } from './BuildingTerrainLayout.ts';

export const BUILDING_SHADOW_PROXY_FLAG = 'buildingShadowProxy';

const BUILDING_SHADOW_HEIGHT: Record<BuildingKind, number> = {
  lumber_mill: 6.5,
  reforester: 4.2,
  woodcutters_lodge: 4.2,
  stone_quarry: 5.8,
  well: 2.4,
  hunters_hall: 4.8,
  foragers_shed: 3.8,
  chapel: 8.6,
  marketplace: 3.2,
};

const RESIDENCE_SHADOW_HEIGHT = 7.7;

const shadowCastMaterial = new THREE.MeshStandardMaterial({
  transparent: true,
  opacity: 0,
  colorWrite: false,
  depthWrite: false,
});

const shadowDepthMaterial = new THREE.MeshDepthMaterial({
  depthPacking: THREE.RGBADepthPacking,
});

export function createBuildingShadowProxy(kind: BuildingKind): THREE.Mesh {
  const params = getBuildingPadParams(kind);
  const scale = params.innerFade * 0.92;
  const height = BUILDING_SHADOW_HEIGHT[kind];
  const geometry = createBuildingShadowGeometry(kind, params, scale, height);
  return createShadowProxyMesh(geometry, height);
}

export function createResidenceShadowProxy(): THREE.Mesh {
  const width = MAIN_HOUSE_WIDTH * 0.92;
  const depth = MAIN_HOUSE_DEPTH * 0.92;
  const geometry = new THREE.BoxGeometry(width, RESIDENCE_SHADOW_HEIGHT, depth);
  return createShadowProxyMesh(geometry, RESIDENCE_SHADOW_HEIGHT);
}

export function isBuildingShadowProxy(object: THREE.Object3D): boolean {
  return object.userData[BUILDING_SHADOW_PROXY_FLAG] === true;
}

function createShadowProxyMesh(geometry: THREE.BufferGeometry, height: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, shadowCastMaterial);
  mesh.name = 'Building shadow proxy';
  mesh.position.y = height * 0.5;
  mesh.layers.set(TREE_SHADOW_CAST_LAYER);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.customDepthMaterial = shadowDepthMaterial;
  mesh.userData[BUILDING_SHADOW_PROXY_FLAG] = true;
  return mesh;
}

function createBuildingShadowGeometry(
  kind: BuildingKind,
  params: ReturnType<typeof getBuildingPadParams>,
  scale: number,
  height: number,
): THREE.BufferGeometry {
  switch (kind) {
    case 'stone_quarry':
      return new THREE.CylinderGeometry(params.radiusX * scale, params.radiusX * scale, height, 16);
    case 'lumber_mill':
    case 'reforester':
    case 'woodcutters_lodge':
    case 'well':
    case 'hunters_hall':
    case 'foragers_shed':
    case 'chapel':
    case 'marketplace':
      return new THREE.BoxGeometry(params.radiusX * 2 * scale, height, params.radiusZ * 2 * scale);
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
