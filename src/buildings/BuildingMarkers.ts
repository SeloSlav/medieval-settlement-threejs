import * as THREE from 'three';
import { disposeObject3D } from '../utils/dispose.ts';
import type { BuildingState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import { createBuildingMesh } from './BuildingMeshes.ts';

type BuildingMarkersOptions = {
  terrain: Terrain;
  parent: THREE.Group;
};

export class BuildingMarkers {
  private readonly terrain: Terrain;
  private readonly group = new THREE.Group();
  private readonly buildingMeshes = new Map<string, THREE.Group>();
  private readonly radiusMeshes = new Map<string, THREE.Mesh>();
  private previewMesh: THREE.Mesh | null = null;

  constructor(options: BuildingMarkersOptions) {
    this.terrain = options.terrain;
    this.group.name = 'Building markers';
    options.parent.add(this.group);
  }

  syncBuildings(buildings: Iterable<BuildingState>): void {
    const nextIds = new Set<string>();
    for (const building of buildings) {
      nextIds.add(building.id);
      this.upsertBuilding(building);
    }

    for (const id of this.buildingMeshes.keys()) {
      if (nextIds.has(id)) continue;
      this.removeBuilding(id);
    }
  }

  setPlacementPreview(x: number, z: number, radius: number, visible: boolean): void {
    if (!visible) {
      if (this.previewMesh) this.previewMesh.visible = false;
      return;
    }

    if (!this.previewMesh) {
      this.previewMesh = createRadiusRing(0x84a66b, 0.28);
      this.group.add(this.previewMesh);
    }

    const y = this.terrain.getHeightAt(x, z) + 0.2;
    this.previewMesh.visible = true;
    this.previewMesh.position.set(x, y, z);
    this.previewMesh.scale.set(radius, 1, radius);
  }

  dispose(): void {
    if (this.previewMesh) {
      disposeObject3D(this.previewMesh);
      this.previewMesh = null;
    }
    for (const id of [...this.buildingMeshes.keys()]) {
      this.removeBuilding(id);
    }
    this.group.removeFromParent();
  }

  private upsertBuilding(building: BuildingState): void {
    let marker = this.buildingMeshes.get(building.id);
    if (!marker) {
      marker = createBuildingMesh(building.kind);
      marker.rotation.y = buildingPlacementYaw(building.x, building.z);
      this.buildingMeshes.set(building.id, marker);
      this.group.add(marker);

      const radius = createRadiusRing(buildingRadiusColor(building.kind), 0.16);
      this.radiusMeshes.set(building.id, radius);
      this.group.add(radius);
    }

    const y = this.terrain.getHeightAt(building.x, building.z);
    marker.position.set(building.x, y, building.z);

    const radiusMesh = this.radiusMeshes.get(building.id);
    if (radiusMesh) {
      radiusMesh.position.set(building.x, y + 0.15, building.z);
      radiusMesh.scale.set(building.workRadius, 1, building.workRadius);
    }
  }

  private removeBuilding(id: string): void {
    const marker = this.buildingMeshes.get(id);
    if (marker) {
      disposeObject3D(marker, true);
      this.buildingMeshes.delete(id);
    }
    const radius = this.radiusMeshes.get(id);
    if (radius) {
      disposeObject3D(radius);
      this.radiusMeshes.delete(id);
    }
  }
}

function buildingRadiusColor(kind: BuildingState['kind']): number {
  switch (kind) {
    case 'lumber_mill':
      return 0xd7b463;
    case 'reforester':
      return 0x84a66b;
    case 'stone_quarry':
      return 0xa8a29e;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function buildingPlacementYaw(x: number, z: number): number {
  return (Math.abs(Math.floor(Math.sin(x * 0.017 + z * 0.013) * 6283)) % 360) * (Math.PI / 180);
}

function createRadiusRing(color: number, opacity: number): THREE.Mesh {
  const geometry = new THREE.RingGeometry(0.94, 1, 64);
  geometry.rotateX(-Math.PI * 0.5);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 8;
  return mesh;
}
