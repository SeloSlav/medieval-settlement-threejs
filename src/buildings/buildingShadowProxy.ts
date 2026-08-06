import * as THREE from 'three';
import type { BuildingKind } from '../resources/types.ts';
import { MAIN_HOUSE_DEPTH, MAIN_HOUSE_WIDTH } from '../residences/burgageLayout.ts';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import { getBuildingPadParams } from './BuildingTerrainLayout.ts';

export const BUILDING_SHADOW_PROXY_FLAG = 'buildingShadowProxy';
export const BUILDING_DETAIL_SHADOW_CASTER_FLAG = 'buildingDetailShadowCaster';

const BUILDING_SHADOW_HEIGHT: Record<BuildingKind, number> = {
  founders_camp: 3.4,
  salvage_pile: 2.2,
  remote_work_camp: 3.4,
  lumber_mill: 6.3,
  reforester: 5.5,
  woodcutters_lodge: 5.6,
  stone_quarry: 6.4,
  large_quarry: 9.2,
  mine: 9.2,
  clay_pit: 2.4,
  charcoal_burner: 4.0,
  smithy: 5.8,
  potter_kiln: 4.8,
  well: 4.7,
  hunters_hall: 5.7,
  foragers_shed: 4.9,
  fishing_camp: 5.2,
  chapel: 11.9,
  marketplace: 5.3,
  trading_post: 6.9,
  town_hall: 9.2,
  village_storehouse: 6.7,
  watchtower: 10.8,
  guardhouse: 6.5,
  palisaded_refuge: 4.6,
  threshing_barn: 7.1,
  monastery: 9.8,
  brewery: 6.7,
  smokehouse: 6.9,
  granary: 6.9,
  bakery: 6.6,
  apiary: 4.8,
  watermill: 7.2,
  windmill: 13.8,
  carpenter: 5.8,
  weaver: 5.7,
  ferry_landing: 4.8,
  vineyard: 4.2,
  pastoral_farmstead: 6.4,
  swineherd: 4.7,
};

const RESIDENCE_SHADOW_HEIGHT = 7.7;
const INITIAL_BATCH_CAPACITY = 16;

type ShadowProxyShape = 'box' | 'cylinder';

type ShadowProxySpec = {
  shape: ShadowProxyShape;
  width: number;
  height: number;
  depth: number;
};

type ShadowProxyRecord = {
  shape: ShadowProxyShape;
  matrix: THREE.Matrix4;
};

export type BatchedShadowProxyStats = {
  proxies: number;
  boxInstances: number;
  cylinderInstances: number;
  shadowDraws: number;
};

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
  const spec = buildingShadowProxySpec(kind);
  return createShadowProxyMesh(createShadowProxyGeometry(spec), spec.height);
}

export function createResidenceShadowProxy(tier: 1 | 2 | 3 = 1): THREE.Mesh {
  const spec = residenceShadowProxySpec(tier);
  return createShadowProxyMesh(createShadowProxyGeometry(spec), spec.height);
}

/**
 * Keeps every completed structure in two shadow submissions: one box batch and
 * one cylindrical quarry/mine batch. Source markers retain their authored
 * render hierarchy, while only these coarse silhouettes enter the shadow map.
 *
 * Records are updated in place and GPU matrices are rebuilt only when a
 * structure is added, removed, moved, rotated, rescaled, or changes tier.
 */
export class BatchedBuildingShadowProxies {
  readonly group = new THREE.Group();

  private readonly records = new Map<string, ShadowProxyRecord>();
  private readonly localMatrix = new THREE.Matrix4();
  private readonly combinedMatrix = new THREE.Matrix4();
  private readonly localPosition = new THREE.Vector3();
  private readonly localScale = new THREE.Vector3();
  private readonly localRotation = new THREE.Quaternion();
  private boxMesh: THREE.InstancedMesh;
  private cylinderMesh: THREE.InstancedMesh;
  private boxCapacity = INITIAL_BATCH_CAPACITY;
  private cylinderCapacity = INITIAL_BATCH_CAPACITY;
  private dirty = false;

  constructor(
    parent: THREE.Object3D,
    name: string,
    enabled = true,
  ) {
    this.group.name = name;
    this.group.userData.batchedBuildingShadowProxies = true;
    this.boxMesh = createBatchedShadowProxyMesh(
      'box',
      this.boxCapacity,
      enabled,
      `${name} boxes`,
    );
    this.cylinderMesh = createBatchedShadowProxyMesh(
      'cylinder',
      this.cylinderCapacity,
      enabled,
      `${name} cylinders`,
    );
    this.group.add(this.boxMesh, this.cylinderMesh);
    parent.add(this.group);
  }

  upsertBuilding(
    id: string,
    kind: BuildingKind,
    marker: THREE.Object3D,
    chapelTier: 1 | 2 | 3 = 3,
  ): boolean {
    // Reclamation piles are scattered ground props. A footprint-sized box
    // proxy turns their small contact shadows into a dark rectangular slab.
    if (kind === 'salvage_pile') return this.remove(id);
    return this.upsert(id, buildingShadowProxySpec(kind, chapelTier), marker);
  }

  upsertResidence(
    id: string,
    tier: 1 | 2 | 3,
    marker: THREE.Object3D,
  ): boolean {
    return this.upsert(id, residenceShadowProxySpec(tier), marker);
  }

  remove(id: string): boolean {
    if (!this.records.delete(id)) return false;
    this.dirty = true;
    return true;
  }

  flush(): boolean {
    if (!this.dirty) return false;

    let boxCount = 0;
    let cylinderCount = 0;
    for (const record of this.records.values()) {
      if (record.shape === 'box') boxCount += 1;
      else cylinderCount += 1;
    }

    this.ensureCapacity('box', boxCount);
    this.ensureCapacity('cylinder', cylinderCount);
    let boxIndex = 0;
    let cylinderIndex = 0;
    for (const record of this.records.values()) {
      if (record.shape === 'box') {
        this.boxMesh.setMatrixAt(boxIndex, record.matrix);
        boxIndex += 1;
      } else {
        this.cylinderMesh.setMatrixAt(cylinderIndex, record.matrix);
        cylinderIndex += 1;
      }
    }
    syncBatchedShadowProxyMesh(this.boxMesh, boxCount);
    syncBatchedShadowProxyMesh(this.cylinderMesh, cylinderCount);
    this.group.userData.shadowProxyCount = this.records.size;
    this.group.userData.shadowDrawCount =
      (boxCount > 0 ? 1 : 0) + (cylinderCount > 0 ? 1 : 0);
    this.dirty = false;
    return true;
  }

  getStats(): BatchedShadowProxyStats {
    const boxInstances = this.boxMesh.count;
    const cylinderInstances = this.cylinderMesh.count;
    return {
      proxies: boxInstances + cylinderInstances,
      boxInstances,
      cylinderInstances,
      shadowDraws:
        (boxInstances > 0 ? 1 : 0) + (cylinderInstances > 0 ? 1 : 0),
    };
  }

  dispose(): void {
    this.records.clear();
    this.boxMesh.geometry.dispose();
    this.cylinderMesh.geometry.dispose();
    this.group.removeFromParent();
  }

  private upsert(
    id: string,
    spec: ShadowProxySpec,
    marker: THREE.Object3D,
  ): boolean {
    marker.updateMatrix();
    this.localPosition.set(0, spec.height * 0.5, 0);
    this.localScale.set(spec.width, spec.height, spec.depth);
    this.localMatrix.compose(
      this.localPosition,
      this.localRotation.identity(),
      this.localScale,
    );
    this.combinedMatrix.multiplyMatrices(marker.matrix, this.localMatrix);

    const existing = this.records.get(id);
    if (
      existing
      && existing.shape === spec.shape
      && matricesEqual(existing.matrix, this.combinedMatrix)
    ) {
      return false;
    }
    this.records.set(id, {
      shape: spec.shape,
      matrix: this.combinedMatrix.clone(),
    });
    this.dirty = true;
    return true;
  }

  private ensureCapacity(shape: ShadowProxyShape, required: number): void {
    const currentCapacity = shape === 'box'
      ? this.boxCapacity
      : this.cylinderCapacity;
    if (required <= currentCapacity) return;
    let capacity = currentCapacity;
    while (capacity < required) capacity *= 2;

    const current = shape === 'box' ? this.boxMesh : this.cylinderMesh;
    const replacement = createBatchedShadowProxyMesh(
      shape,
      capacity,
      current.castShadow,
      current.name,
    );
    current.removeFromParent();
    current.geometry.dispose();
    this.group.add(replacement);
    if (shape === 'box') {
      this.boxMesh = replacement;
      this.boxCapacity = capacity;
    } else {
      this.cylinderMesh = replacement;
      this.cylinderCapacity = capacity;
    }
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

function buildingShadowProxySpec(
  kind: BuildingKind,
  chapelTier: 1 | 2 | 3 = 3,
): ShadowProxySpec {
  const params = getBuildingPadParams(kind);
  const tierScale = kind === 'chapel'
    ? chapelTier === 1
      ? 0.57
      : chapelTier === 2
        ? 0.76
        : 1
    : 1;
  const scale = params.innerFade * 0.92 * tierScale;
  const height = kind === 'chapel'
    ? chapelTier === 1
      ? 6.4
      : chapelTier === 2
        ? 7.8
        : BUILDING_SHADOW_HEIGHT.chapel
    : BUILDING_SHADOW_HEIGHT[kind];
  switch (kind) {
    case 'stone_quarry':
    case 'large_quarry':
    case 'mine':
      return {
        shape: 'cylinder',
        width: params.radiusX * scale,
        height,
        depth: params.radiusX * scale,
      };
    case 'founders_camp':
    case 'salvage_pile':
    case 'remote_work_camp':
    case 'lumber_mill':
    case 'reforester':
    case 'woodcutters_lodge':
    case 'clay_pit':
    case 'charcoal_burner':
    case 'smithy':
    case 'potter_kiln':
    case 'well':
    case 'hunters_hall':
    case 'foragers_shed':
    case 'fishing_camp':
    case 'chapel':
    case 'marketplace':
    case 'trading_post':
    case 'town_hall':
    case 'village_storehouse':
    case 'watchtower':
    case 'guardhouse':
    case 'palisaded_refuge':
    case 'threshing_barn':
    case 'monastery':
    case 'brewery':
    case 'smokehouse':
    case 'granary':
    case 'bakery':
    case 'apiary':
    case 'watermill':
    case 'windmill':
    case 'carpenter':
    case 'weaver':
    case 'ferry_landing':
    case 'vineyard':
    case 'pastoral_farmstead':
    case 'swineherd':
      return {
        shape: 'box',
        width: params.radiusX * 2 * scale,
        height,
        depth: params.radiusZ * 2 * scale,
      };
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function residenceShadowProxySpec(tier: 1 | 2 | 3): ShadowProxySpec {
  const scale = tier === 1 ? 0.82 : tier === 3 ? 1.22 : 1;
  const height = tier === 1 ? 5.1 : tier === 3 ? 8.3 : RESIDENCE_SHADOW_HEIGHT;
  return {
    shape: 'box',
    width: MAIN_HOUSE_WIDTH * 0.92 * scale,
    height,
    depth: MAIN_HOUSE_DEPTH * 0.92 * (tier === 3 ? 1.14 : scale),
  };
}

function createShadowProxyGeometry(spec: ShadowProxySpec): THREE.BufferGeometry {
  return spec.shape === 'box'
    ? new THREE.BoxGeometry(spec.width, spec.height, spec.depth)
    : new THREE.CylinderGeometry(spec.width, spec.depth, spec.height, 16);
}

function createBatchedShadowProxyMesh(
  shape: ShadowProxyShape,
  capacity: number,
  enabled: boolean,
  name: string,
): THREE.InstancedMesh {
  const geometry = shape === 'box'
    ? new THREE.BoxGeometry(1, 1, 1)
    : new THREE.CylinderGeometry(1, 1, 1, 16);
  const mesh = new THREE.InstancedMesh(
    geometry,
    shadowCastMaterial,
    Math.max(1, capacity),
  );
  mesh.name = name;
  mesh.count = 0;
  mesh.layers.set(TREE_SHADOW_CAST_LAYER);
  mesh.castShadow = enabled;
  mesh.receiveShadow = false;
  mesh.customDepthMaterial = shadowDepthMaterial;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.userData[BUILDING_SHADOW_PROXY_FLAG] = true;
  mesh.userData.batchedShadowProxyShape = shape;
  return mesh;
}

function syncBatchedShadowProxyMesh(
  mesh: THREE.InstancedMesh,
  count: number,
): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.shadowProxyCount = count;
  if (count > 0) {
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  } else {
    mesh.boundingBox = null;
    mesh.boundingSphere = null;
  }
}

function matricesEqual(
  left: THREE.Matrix4,
  right: THREE.Matrix4,
): boolean {
  const leftElements = left.elements;
  const rightElements = right.elements;
  for (let index = 0; index < 16; index += 1) {
    if (Math.abs(leftElements[index]! - rightElements[index]!) > 1e-6) {
      return false;
    }
  }
  return true;
}
