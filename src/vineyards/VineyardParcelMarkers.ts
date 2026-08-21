import * as THREE from 'three';
import {
  polygonSegments,
  updateTerrainQuadGeometry,
  updateTerrainRibbonGeometry,
  type TerrainOverlaySegment,
} from '../placement/TerrainOverlayGeometry.ts';
import type { VineyardParcelState } from '../resources/types.ts';
import { bilinearPoint, type FarmFieldCorners } from '../farming/farmFieldMath.ts';
import { createSeedThreeVineyardVines } from '../vegetation/seedthree/vineyardVines.ts';
import {
  hashParcelSeed,
  organicParcelBoundaryPoints,
  organicParcelEdgePoints,
  polylineSegments,
  samplePolylineAtFraction,
} from '../farming/organicParcelGeometry.ts';

const STAKE_GEOMETRY = new THREE.CylinderGeometry(0.045, 0.06, 1.55, 5);
const STAKE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.98 });
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
  const parcelSeed = hashParcelSeed(parcel.id);
  const group = new THREE.Group();
  group.name = `Monastery vineyard rows ${parcel.id}`;
  group.userData.monasteryBuildingId = parcel.monasteryId;
  group.userData.vineyardParcelId = parcel.id;

  const groundGeometry = new THREE.BufferGeometry();
  updateTerrainQuadGeometry(groundGeometry, corners, getHeightAt, 0.055, 12, 12);
  const ground = new THREE.Mesh(groundGeometry, GROUND_MATERIAL);
  ground.name = 'Vineyard parcel ground';
  ground.userData.vineyardDynamicGeometry = true;
  ground.receiveShadow = true;
  ground.renderOrder = 1;
  group.add(ground);

  const rowCount = Math.max(2, Math.min(32, Math.floor(dimensions.width / 2.45)));
  const rowSegments: TerrainOverlaySegment[] = [];
  const placements: Array<{ x: number; z: number; yaw: number; scale: number; seed: number; fruiting: boolean }> = [];
  for (let row = 0; row < rowCount; row += 1) {
    const u = (row + 0.5) / rowCount;
    const rowPath = organicParcelEdgePoints(
      bilinearPoint(corners, u, 0.06),
      bilinearPoint(corners, u, 0.94),
      {
        seed: parcelSeed ^ Math.imul(row + 1, 0x45d9f3b),
        spacing: 3.4,
        amplitude: 0.2,
      },
    );
    rowSegments.push(...polylineSegments(rowPath));
    const vineCount = Math.max(3, Math.min(36, Math.floor(dimensions.depth / 2.2)));
    for (let vine = 0; vine < vineCount; vine += 1) {
      const v = (vine + 0.5) / vineCount;
      const point = samplePolylineAtFraction(rowPath, v);
      const before = samplePolylineAtFraction(rowPath, Math.max(0, v - 0.025));
      const after = samplePolylineAtFraction(rowPath, Math.min(1, v + 0.025));
      placements.push({
        x: point.x,
        z: point.z,
        yaw: Math.atan2(after.x - before.x, after.z - before.z)
          + ((row * 17 + vine * 31) % 13 - 6) * 0.012,
        scale: 0.88 + ((row * 37 + vine * 19) % 17) / 100,
        seed: parcelSeed + row * 97 + vine * 17,
        fruiting: (row * 3 + vine) % 4 === 0,
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
  earth.name = 'Hand-laid vineyard row beds';
  earth.userData.vineyardDynamicGeometry = true;
  earth.receiveShadow = true;
  earth.renderOrder = 2;
  group.add(earth);

  const borderGeometry = new THREE.BufferGeometry();
  const organicBoundary = organicParcelBoundaryPoints(corners, parcelSeed, {
    spacing: 3.8,
    amplitude: 0.24,
  });
  updateTerrainRibbonGeometry(borderGeometry, polygonSegments(organicBoundary), getHeightAt, {
    width: 0.13,
    lift: 0.12,
    sampleSpacing: 0.9,
  });
  const border = new THREE.Mesh(borderGeometry, BORDER_MATERIAL);
  border.name = 'Organic vineyard parcel border';
  border.userData.vineyardDynamicGeometry = true;
  border.renderOrder = 3;
  group.add(border);

  const stakes = new THREE.InstancedMesh(STAKE_GEOMETRY, STAKE_MATERIAL, placements.length);
  stakes.name = 'Vineyard stakes';
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
  }
  stakes.instanceMatrix.needsUpdate = true;
  stakes.computeBoundingSphere();
  stakes.castShadow = true;
  const grapevines = createSeedThreeVineyardVines(placements.map((placement) => ({
    x: placement.x,
    y: getHeightAt(placement.x, placement.z) + 0.58,
    z: placement.z,
    seed: placement.seed,
    fruiting: placement.fruiting,
  })));
  grapevines.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) mesh.userData.vineyardParcelGeometry = true;
  });
  group.add(stakes, grapevines);
  return group;
}

function disposeParcelGroup(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.userData.vineyardDynamicGeometry || mesh.userData.vineyardParcelGeometry) {
      mesh.geometry.dispose();
    }
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
      `${parcel.id}:${parcel.monasteryId}:${parcel.corners.map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`).join(';')}`
    ).join('|');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    for (const group of this.groups.values()) disposeParcelGroup(group);
    this.groups.clear();
    this.root.clear();
    for (const parcel of list) {
      const group = buildParcelGroup(parcel, this.getHeightAt);
      this.root.add(group);
      this.groups.set(parcel.id, group);
    }
  }

  dispose(): void {
    for (const group of this.groups.values()) disposeParcelGroup(group);
    this.groups.clear();
    this.root.removeFromParent();
  }
}
