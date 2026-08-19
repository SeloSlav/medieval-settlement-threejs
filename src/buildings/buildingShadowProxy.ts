import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';

export const BUILDING_SHADOW_PROXY_FLAG = 'buildingShadowProxy';
export const BUILDING_DETAIL_SHADOW_CASTER_FLAG = 'buildingDetailShadowCaster';

export type BatchedShadowProxyStats = {
  proxies: number;
  boxInstances: number;
  cylinderInstances: number;
  shadowDraws: number;
};

/**
 * Compatibility shell for the retired footprint-shadow system.
 *
 * Coarse boxes and cylinders made completed structures cast solid, building-pad
 * shaped shadows. Those read as black slabs beneath chapels, forager sheds,
 * reclamation piles, residences, and other structures, so no proxy geometry is
 * registered or submitted. Authored detail casters remain available separately.
 */
export class BatchedBuildingShadowProxies {
  readonly group = new THREE.Group();

  constructor(
    parent: THREE.Object3D,
    name: string,
    _enabled = true,
  ) {
    this.group.name = name;
    this.group.userData.batchedBuildingShadowProxies = true;
    this.group.userData.shadowProxyCount = 0;
    this.group.userData.shadowDrawCount = 0;
    parent.add(this.group);
  }

  upsertBuilding(
    _id: string,
    _kind: BuildingKind,
    _marker: THREE.Object3D,
    _chapelTier: 1 | 2 | 3 = 3,
  ): boolean {
    return false;
  }

  upsertResidence(
    _id: string,
    _tier: 1 | 2 | 3,
    _marker: THREE.Object3D,
  ): boolean {
    return false;
  }

  remove(_id: string): boolean {
    return false;
  }

  flush(): boolean {
    return false;
  }

  getStats(): BatchedShadowProxyStats {
    return {
      proxies: 0,
      boxInstances: 0,
      cylinderInstances: 0,
      shadowDraws: 0,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

export function isBuildingShadowProxy(object: THREE.Object3D): boolean {
  return object.userData[BUILDING_SHADOW_PROXY_FLAG] === true;
}

export function markBuildingDetailShadowCaster(mesh: THREE.Mesh): void {
  mesh.userData[BUILDING_DETAIL_SHADOW_CASTER_FLAG] = true;
  mesh.castShadow = true;
}

export function isBuildingDetailShadowCaster(object: THREE.Object3D): boolean {
  return object.userData[BUILDING_DETAIL_SHADOW_CASTER_FLAG] === true;
}

export function setBuildingDetailShadowsEnabled(
  root: THREE.Object3D,
  enabled: boolean,
): void {
  root.traverse((object) => {
    if (!isBuildingDetailShadowCaster(object)) return;
    (object as THREE.Mesh).castShadow = enabled;
  });
}
