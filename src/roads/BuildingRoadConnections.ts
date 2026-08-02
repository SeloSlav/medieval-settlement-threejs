import * as THREE from 'three';
import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';
import { getBuildingPadParams } from '../buildings/BuildingTerrainLayout.ts';
import type { BuildingState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadNetwork } from './RoadNetwork.ts';

const FOOTPRINT_SCALE = 0.92;
const CONNECTION_MARGIN = 0.72;
const MARKER_LIFT = 0.16;

export type BuildingRoadConnection = {
  buildingId: string;
  point: THREE.Vector3;
};

export type BuildingRoadConnectionSource = Pick<BuildingState, 'id' | 'kind' | 'x' | 'z'> & {
  /** The displayed mesh yaw, when the building has already been presented. */
  yaw?: number;
};

/**
 * Returns four road anchors at the midpoint of each rotated building edge.
 * The points sit just outside the placement footprint so a terminating road
 * reaches the building without running through its yard.
 */
export function getBuildingRoadConnectionPoints(
  building: BuildingRoadConnectionSource,
  terrain: Pick<Terrain, 'getPointAt'>,
  roadNetwork?: RoadNetwork | null,
): BuildingRoadConnection[] {
  const pad = getBuildingPadParams(building.kind);
  const yaw = building.yaw ?? buildingPlacementYaw(
      building.kind,
      building.x,
      building.z,
      roadNetwork,
    );
  const halfWidth = pad.radiusX * pad.innerFade * FOOTPRINT_SCALE + CONNECTION_MARGIN;
  const halfDepth = pad.radiusZ * pad.innerFade * FOOTPRINT_SCALE + CONNECTION_MARGIN;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const localOffsets = [
    { x: 0, z: halfDepth },
    { x: halfWidth, z: 0 },
    { x: 0, z: -halfDepth },
    { x: -halfWidth, z: 0 },
  ] as const;

  return localOffsets.map((offset) => {
    const x = building.x + offset.x * cos - offset.z * sin;
    const z = building.z + offset.x * sin + offset.z * cos;
    return {
      buildingId: building.id,
      point: terrain.getPointAt(x, z, 0),
    };
  });
}

export class BuildingRoadConnections {
  private readonly options: {
    parent: THREE.Object3D;
    terrain: Terrain;
    getBuildings: () => Iterable<BuildingRoadConnectionSource>;
    getRoadNetwork: () => RoadNetwork | null;
  };
  private readonly group = new THREE.Group();
  private readonly ringGeometry = new THREE.RingGeometry(0.78, 1.14, 20);
  private readonly postGeometry = new THREE.CylinderGeometry(0.18, 0.28, 0.56, 8);
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xf0c96c,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly postMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe5a0,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
  });
  private ringMarkers: THREE.InstancedMesh | null = null;
  private postMarkers: THREE.InstancedMesh | null = null;
  private capacity = 0;
  private connections: BuildingRoadConnection[] = [];
  private signature = '';
  private readonly matrix = new THREE.Matrix4();
  private readonly ringRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0),
  );
  private readonly unitScale = new THREE.Vector3(1, 1, 1);
  private readonly identityRotation = new THREE.Quaternion();

  constructor(options: {
    parent: THREE.Object3D;
    terrain: Terrain;
    getBuildings: () => Iterable<BuildingRoadConnectionSource>;
    getRoadNetwork: () => RoadNetwork | null;
  }) {
    this.options = options;
    this.group.name = 'Building road connections';
    this.group.visible = false;
    this.group.renderOrder = 29;
    options.parent.add(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    if (visible) this.refresh(true);
  }

  refresh(force = false): void {
    if (!this.group.visible && !force) return;
    const buildings = [...this.options.getBuildings()];
    const roadNetwork = this.options.getRoadNetwork();
    const signature = buildings
      .map((building) => `${building.id}:${building.kind}:${building.x.toFixed(2)}:${building.z.toFixed(2)}:${building.yaw?.toFixed(4) ?? ''}`)
      .sort()
      .join('|');
    if (!force && signature === this.signature) return;
    this.signature = signature;
    this.connections = buildings.flatMap((building) =>
      getBuildingRoadConnectionPoints(building, this.options.terrain, roadNetwork)
    );
    this.updateInstances();
  }

  findSnap(
    point: THREE.Vector3,
    maxDistance: number,
  ): { point: THREE.Vector3; distance: number } | null {
    let best: { point: THREE.Vector3; distance: number } | null = null;
    for (const connection of this.connections) {
      const distance = Math.hypot(
        point.x - connection.point.x,
        point.z - connection.point.z,
      );
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { point: connection.point, distance };
      }
    }
    return best;
  }

  dispose(): void {
    this.ringMarkers?.removeFromParent();
    this.postMarkers?.removeFromParent();
    this.ringGeometry.dispose();
    this.postGeometry.dispose();
    this.ringMaterial.dispose();
    this.postMaterial.dispose();
    this.group.removeFromParent();
  }

  private updateInstances(): void {
    this.ensureCapacity(this.connections.length);
    if (!this.ringMarkers || !this.postMarkers) return;

    for (let index = 0; index < this.connections.length; index += 1) {
      const point = this.connections[index].point;
      this.matrix.compose(
        new THREE.Vector3(point.x, point.y + MARKER_LIFT, point.z),
        this.ringRotation,
        this.unitScale,
      );
      this.ringMarkers.setMatrixAt(index, this.matrix);
      this.matrix.compose(
        new THREE.Vector3(point.x, point.y + MARKER_LIFT + 0.28, point.z),
        this.identityRotation,
        this.unitScale,
      );
      this.postMarkers.setMatrixAt(index, this.matrix);
    }

    this.ringMarkers.count = this.connections.length;
    this.postMarkers.count = this.connections.length;
    this.ringMarkers.instanceMatrix.needsUpdate = true;
    this.postMarkers.instanceMatrix.needsUpdate = true;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.capacity) return;
    this.capacity = Math.max(4, Math.pow(2, Math.ceil(Math.log2(required))));
    this.ringMarkers?.removeFromParent();
    this.postMarkers?.removeFromParent();
    this.ringMarkers = new THREE.InstancedMesh(
      this.ringGeometry,
      this.ringMaterial,
      this.capacity,
    );
    this.postMarkers = new THREE.InstancedMesh(
      this.postGeometry,
      this.postMaterial,
      this.capacity,
    );
    for (const markers of [this.ringMarkers, this.postMarkers]) {
      markers.count = 0;
      markers.renderOrder = 29;
      markers.castShadow = false;
      markers.receiveShadow = false;
      markers.frustumCulled = false;
      this.group.add(markers);
    }
  }
}
