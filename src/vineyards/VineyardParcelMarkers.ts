import * as THREE from 'three';
import {
  polygonSegments,
  updateTerrainQuadGeometry,
  updateTerrainRibbonGeometry,
  type TerrainOverlaySegment,
} from '../placement/TerrainOverlayGeometry.ts';
import type { VineyardParcelState } from '../resources/types.ts';
import { bilinearPoint, fieldCentroid, type FarmFieldCorners } from '../farming/farmFieldMath.ts';

const STAKE_GEOMETRY = new THREE.CylinderGeometry(0.045, 0.06, 1.55, 5);
const VINE_GEOMETRY = new THREE.DodecahedronGeometry(0.48, 0);
const STAKE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.98 });
const VINE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x44642f, roughness: 0.94 });
const EARTH_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x6d4729,
  roughness: 1,
  transparent: true,
  opacity: 0.44,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
});
const BORDER_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x8b7652,
  roughness: 1,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
});
const GROUND_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x5f4a2e,
  roughness: 1,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
  side: THREE.DoubleSide,
});

function parcelDimensions(corners: FarmFieldCorners): { width: number; depth: number } {
  return {
    width: (
      Math.hypot(corners[1].x - corners[0].x, corners[1].z - corners[0].z)
      + Math.hypot(corners[2].x - corners[3].x, corners[2].z - corners[3].z)
    ) * 0.5,
    depth: (
      Math.hypot(corners[3].x - corners[0].x, corners[3].z - corners[0].z)
      + Math.hypot(corners[2].x - corners[1].x, corners[2].z - corners[1].z)
    ) * 0.5,
  };
}

function buildParcelGroup(
  parcel: VineyardParcelState,
  getHeightAt: (x: number, z: number) => number,
): THREE.Group {
  const corners = parcel.corners as FarmFieldCorners;
  const dimensions = parcelDimensions(corners);
  const center = fieldCentroid(corners);
  const group = new THREE.Group();
  group.name = `Vineyard rows ${parcel.buildingId}`;
  group.userData.vineyardBuildingId = parcel.buildingId;

  const groundGeometry = new THREE.BufferGeometry();
  updateTerrainQuadGeometry(groundGeometry, corners, getHeightAt, 0.055, 12, 12);
  const ground = new THREE.Mesh(groundGeometry, GROUND_MATERIAL);
  ground.userData.vineyardDynamicGeometry = true;
  ground.receiveShadow = true;
  ground.renderOrder = 1;
  group.add(ground);

  const rowCount = Math.max(2, Math.min(32, Math.floor(dimensions.width / 2.45)));
  const rowSegments: TerrainOverlaySegment[] = [];
  const placements: Array<{ x: number; z: number; yaw: number; scale: number }> = [];
  for (let row = 0; row < rowCount; row += 1) {
    const u = (row + 0.5) / rowCount;
    rowSegments.push([bilinearPoint(corners, u, 0.06), bilinearPoint(corners, u, 0.94)]);
    const vineCount = Math.max(3, Math.min(36, Math.floor(dimensions.depth / 2.2)));
    for (let vine = 0; vine < vineCount; vine += 1) {
      const v = (vine + 0.5) / vineCount;
      const point = bilinearPoint(corners, u, 0.06 + v * 0.88);
      // Leave the central vintner shelter and its loading yard legible.
      if (Math.hypot(point.x - center.x, point.z - center.z) < 6.2) continue;
      placements.push({
        x: point.x,
        z: point.z,
        yaw: ((row * 17 + vine * 31) % 13 - 6) * 0.018,
        scale: 0.88 + ((row * 37 + vine * 19) % 17) / 100,
      });
    }
  }

  const earthGeometry = new THREE.BufferGeometry();
  updateTerrainRibbonGeometry(earthGeometry, rowSegments, getHeightAt, {
    width: 0.58,
    lift: 0.07,
    sampleSpacing: 0.85,
  });
  const earth = new THREE.Mesh(earthGeometry, EARTH_MATERIAL);
  earth.userData.vineyardDynamicGeometry = true;
  earth.receiveShadow = true;
  earth.renderOrder = 2;
  group.add(earth);

  const borderGeometry = new THREE.BufferGeometry();
  updateTerrainRibbonGeometry(borderGeometry, polygonSegments(corners), getHeightAt, {
    width: 0.13,
    lift: 0.12,
    sampleSpacing: 0.9,
  });
  const border = new THREE.Mesh(borderGeometry, BORDER_MATERIAL);
  border.userData.vineyardDynamicGeometry = true;
  border.renderOrder = 3;
  group.add(border);

  const stakes = new THREE.InstancedMesh(STAKE_GEOMETRY, STAKE_MATERIAL, placements.length);
  const vines = new THREE.InstancedMesh(VINE_GEOMETRY, VINE_MATERIAL, placements.length);
  stakes.name = 'Vineyard stakes';
  vines.name = 'Grapevine crowns';
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const height = getHeightAt(placement.x, placement.z);
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw);
    scale.set(1, placement.scale, 1);
    matrix.compose(
      new THREE.Vector3(placement.x, height + 0.77, placement.z),
      quaternion,
      scale,
    );
    stakes.setMatrixAt(index, matrix);
    matrix.compose(
      new THREE.Vector3(placement.x, height + 1.18, placement.z),
      quaternion,
      new THREE.Vector3(placement.scale * 1.12, placement.scale * 0.70, placement.scale * 0.82),
    );
    vines.setMatrixAt(index, matrix);
  }
  stakes.instanceMatrix.needsUpdate = true;
  vines.instanceMatrix.needsUpdate = true;
  stakes.computeBoundingSphere();
  vines.computeBoundingSphere();
  stakes.castShadow = true;
  vines.castShadow = true;
  group.add(stakes, vines);
  return group;
}

function disposeParcelGroup(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.userData.vineyardDynamicGeometry) mesh.geometry.dispose();
  });
  group.clear();
}

export class VineyardParcelMarkers {
  private readonly root = new THREE.Group();
  private readonly groups = new Map<string, THREE.Group>();
  private readonly getHeightAt: (x: number, z: number) => number;
  private lastSignature = '';

  constructor(parent: THREE.Group, getHeightAt: (x: number, z: number) => number) {
    this.getHeightAt = getHeightAt;
    this.root.name = 'Free-form vineyard parcels';
    parent.add(this.root);
  }

  sync(parcels: Iterable<VineyardParcelState>): void {
    const list = [...parcels];
    const signature = list.map((parcel) =>
      `${parcel.buildingId}:${parcel.corners.map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`).join(';')}`
    ).join('|');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    for (const group of this.groups.values()) disposeParcelGroup(group);
    this.groups.clear();
    this.root.clear();
    for (const parcel of list) {
      const group = buildParcelGroup(parcel, this.getHeightAt);
      this.root.add(group);
      this.groups.set(parcel.buildingId, group);
    }
  }

  dispose(): void {
    for (const group of this.groups.values()) disposeParcelGroup(group);
    this.groups.clear();
    this.root.removeFromParent();
  }
}
