import * as THREE from 'three';
import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';
import {
  getBuildingFootprintCorners,
} from '../buildings/BuildingTerrainLayout.ts';
import {
  BUILDING_LOCAL_VISUAL_BOUNDS,
  BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN,
  getConstructionSiteLocalVisualBounds,
  type BuildingLocalVisualBounds,
} from '../buildings/BuildingVisualBounds.ts';
import type { BuildingState } from '../resources/types.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { RoadNetwork } from './RoadNetwork.ts';

const MARKER_LIFT = 0.16;
export const BUILDING_ROAD_CONNECTION_MARKER_INNER_RADIUS = 0.78;
export const BUILDING_ROAD_CONNECTION_MARKER_OUTER_RADIUS = 1.14;
/** Clear space from the audited building envelope to every circle's outer edge. */
export const BUILDING_ROAD_CONNECTION_EDGE_CLEARANCE = 0.86;
/** Horizontal distance from the building envelope to a circle center. */
export const BUILDING_ROAD_CONNECTION_CENTER_OFFSET =
  BUILDING_ROAD_CONNECTION_MARKER_OUTER_RADIUS
  + BUILDING_ROAD_CONNECTION_EDGE_CLEARANCE;
const NEAREST_MARKER_FULL_DISTANCE = 7 + BUILDING_ROAD_CONNECTION_CENTER_OFFSET;
const NEAREST_MARKER_REVEAL_DISTANCE = 14 + BUILDING_ROAD_CONNECTION_CENTER_OFFSET;
const SIBLING_MARKER_FULL_DISTANCE = 5 + BUILDING_ROAD_CONNECTION_CENTER_OFFSET;
const SIBLING_MARKER_REVEAL_DISTANCE = 13 + BUILDING_ROAD_CONNECTION_CENTER_OFFSET;
const MARKER_FADE_IN_RATE = 13;
const MARKER_FADE_OUT_RATE = 9;
const MIN_RENDERED_OPACITY = 0.015;

export type BuildingRoadConnection = {
  id: string;
  buildingId: string;
  point: THREE.Vector3;
};

export type BuildingRoadConnectionSource = Pick<BuildingState, 'id' | 'kind' | 'x' | 'z'> & {
  /** The displayed mesh yaw, when the building has already been presented. */
  yaw?: number;
  /** False while the displayed mesh is the generic construction site. */
  constructionComplete?: boolean;
};

type RuntimeBuildingRoadConnection = BuildingRoadConnection & {
  opacity: number;
  buildingGroup: number;
};

type BuildingSignatureSnapshot = {
  id: string;
  kind: BuildingRoadConnectionSource['kind'];
  x: number;
  z: number;
  yaw: number | undefined;
  constructionComplete: boolean | undefined;
};

/**
 * Returns four road anchors centered beyond the midpoint of each rotated
 * building edge. The edge envelope combines the exact placement footprint
 * with audited model bounds, then applies one fixed outward offset so the
 * complete marker remains clear independent of building size.
 */
export function getBuildingRoadConnectionPoints(
  building: BuildingRoadConnectionSource,
  terrain: Pick<Terrain, 'getPointAt'>,
  roadNetwork?: RoadNetwork | null,
): BuildingRoadConnection[] {
  const yaw = building.yaw ?? buildingPlacementYaw(
      building.kind,
      building.x,
      building.z,
      roadNetwork,
    );
  const bounds = getBuildingRoadEnvelope(building, yaw);
  const midpointX = (bounds.minX + bounds.maxX) * 0.5;
  const midpointZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const localOffsets = [
    { x: midpointX, z: bounds.maxZ + BUILDING_ROAD_CONNECTION_CENTER_OFFSET },
    { x: bounds.maxX + BUILDING_ROAD_CONNECTION_CENTER_OFFSET, z: midpointZ },
    { x: midpointX, z: bounds.minZ - BUILDING_ROAD_CONNECTION_CENTER_OFFSET },
    { x: bounds.minX - BUILDING_ROAD_CONNECTION_CENTER_OFFSET, z: midpointZ },
  ] as const;

  return localOffsetsToConnections(building, terrain, yaw, localOffsets);
}

/**
 * Returns the four corresponding building-edge endpoints. Access spurs use
 * these instead of the display-circle centers so every spur runs inward and
 * actually reaches the building envelope.
 */
export function getBuildingRoadEntrancePoints(
  building: BuildingRoadConnectionSource,
  terrain: Pick<Terrain, 'getPointAt'>,
  roadNetwork?: RoadNetwork | null,
): BuildingRoadConnection[] {
  const yaw = building.yaw ?? buildingPlacementYaw(
    building.kind,
    building.x,
    building.z,
    roadNetwork,
  );
  const bounds = getBuildingRoadEnvelope(building, yaw);
  const midpointX = (bounds.minX + bounds.maxX) * 0.5;
  const midpointZ = (bounds.minZ + bounds.maxZ) * 0.5;
  return localOffsetsToConnections(building, terrain, yaw, [
    { x: midpointX, z: bounds.maxZ },
    { x: bounds.maxX, z: midpointZ },
    { x: midpointX, z: bounds.minZ },
    { x: bounds.minX, z: midpointZ },
  ], 'entrance:');
}

function getBuildingRoadEnvelope(
  building: BuildingRoadConnectionSource,
  yaw: number,
): BuildingLocalVisualBounds {
  const visualBounds = building.constructionComplete === false
    ? getConstructionSiteLocalVisualBounds(building.kind)
    : BUILDING_LOCAL_VISUAL_BOUNDS[building.kind];
  let minX = visualBounds.minX;
  let maxX = visualBounds.maxX;
  let minZ = visualBounds.minZ;
  let maxZ = visualBounds.maxZ;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  for (const corner of getBuildingFootprintCorners(
    building.kind,
    building.x,
    building.z,
    yaw,
  )) {
    const dx = corner.x - building.x;
    const dz = corner.z - building.z;
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    minX = Math.min(minX, localX - BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN);
    maxX = Math.max(maxX, localX + BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN);
    minZ = Math.min(minZ, localZ - BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN);
    maxZ = Math.max(maxZ, localZ + BUILDING_VISUAL_BOUNDS_SAFETY_MARGIN);
  }
  return { minX, maxX, minZ, maxZ };
}

function localOffsetsToConnections(
  building: BuildingRoadConnectionSource,
  terrain: Pick<Terrain, 'getPointAt'>,
  yaw: number,
  localOffsets: ReadonlyArray<Readonly<{ x: number; z: number }>>,
  idPrefix = '',
): BuildingRoadConnection[] {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  return localOffsets.map((offset, index) => {
    const x = building.x + offset.x * cos + offset.z * sin;
    const z = building.z - offset.x * sin + offset.z * cos;
    return {
      id: `${building.id}:${idPrefix}${index}`,
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
  private readonly ringGeometry = new THREE.RingGeometry(
    BUILDING_ROAD_CONNECTION_MARKER_INNER_RADIUS,
    BUILDING_ROAD_CONNECTION_MARKER_OUTER_RADIUS,
    20,
  );
  private readonly postGeometry = new THREE.CylinderGeometry(0.18, 0.28, 0.56, 8);
  private readonly ringMaterial = createFadingMarkerMaterial(0.9, THREE.DoubleSide);
  private readonly postMaterial = createFadingMarkerMaterial(0.94, THREE.FrontSide);
  private ringMarkers: THREE.InstancedMesh | null = null;
  private postMarkers: THREE.InstancedMesh | null = null;
  private ringOpacityAttribute: THREE.InstancedBufferAttribute | null = null;
  private postOpacityAttribute: THREE.InstancedBufferAttribute | null = null;
  private capacity = 0;
  private connections: RuntimeBuildingRoadConnection[] = [];
  private readonly buildingGroupById = new Map<string, number>();
  private readonly nearestConnectionIndexByBuilding: number[] = [];
  private readonly previousOpacityByConnectionId = new Map<string, number>();
  private readonly connectionDistances: number[] = [];
  private readonly buildingScratch: BuildingRoadConnectionSource[] = [];
  private readonly buildingSignatureSnapshots: BuildingSignatureSnapshot[] = [];
  private readonly cursorPoint = new THREE.Vector3();
  private hasCursorPoint = false;
  private signature = '';
  private readonly matrix = new THREE.Matrix4();
  private readonly markerPosition = new THREE.Vector3();
  private readonly ringRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0),
  );
  private readonly markerScale = new THREE.Vector3(1, 1, 1);
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
    if (visible) {
      this.refresh(true);
      return;
    }
    this.hasCursorPoint = false;
    for (const connection of this.connections) connection.opacity = 0;
    this.updateInstances();
  }

  setCursor(point: THREE.Vector3 | null): void {
    this.hasCursorPoint = point !== null;
    if (point) this.cursorPoint.copy(point);
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.refresh();

    const nearestConnectionByBuilding = this.nearestConnectionIndexByBuilding;
    nearestConnectionByBuilding.fill(-1);
    if (this.hasCursorPoint) {
      for (let index = 0; index < this.connections.length; index += 1) {
        const connection = this.connections[index];
        const distance = distanceXZ(connection.point, this.cursorPoint);
        this.connectionDistances[index] = distance;
        const nearestIndex = nearestConnectionByBuilding[connection.buildingGroup];
        if (
          nearestIndex === -1
          || distance < this.connectionDistances[nearestIndex]
        ) {
          nearestConnectionByBuilding[connection.buildingGroup] = index;
        }
      }
    }

    const frameDt = THREE.MathUtils.clamp(dt, 0, 0.1);
    let instancesDirty = false;
    for (let index = 0; index < this.connections.length; index += 1) {
      const connection = this.connections[index];
      const currentOpacity = connection.opacity;
      let targetOpacity = 0;
      if (this.hasCursorPoint) {
        const isNearest = nearestConnectionByBuilding[connection.buildingGroup] === index;
        targetOpacity = markerRevealOpacity(
          this.connectionDistances[index],
          isNearest,
        );
      }
      const rate = targetOpacity > currentOpacity ? MARKER_FADE_IN_RATE : MARKER_FADE_OUT_RATE;
      const blend = 1 - Math.exp(-frameDt * rate);
      let nextOpacity = THREE.MathUtils.lerp(currentOpacity, targetOpacity, blend);
      if (targetOpacity === 0 && nextOpacity < MIN_RENDERED_OPACITY) nextOpacity = 0;
      if (nextOpacity !== currentOpacity) {
        connection.opacity = nextOpacity;
        instancesDirty = true;
      }
    }

    if (instancesDirty) this.updateInstances();
  }

  refresh(force = false): void {
    if (!this.group.visible && !force) return;
    const buildings = this.buildingScratch;
    buildings.length = 0;
    let rawSignatureUnchanged = true;
    let buildingIndex = 0;
    for (const building of this.options.getBuildings()) {
      buildings.push(building);
      const previous = this.buildingSignatureSnapshots[buildingIndex];
      if (
        !previous
        || previous.id !== building.id
        || previous.kind !== building.kind
        || !Object.is(previous.x, building.x)
        || !Object.is(previous.z, building.z)
        || !Object.is(previous.yaw, building.yaw)
        || !Object.is(previous.constructionComplete, building.constructionComplete)
      ) {
        rawSignatureUnchanged = false;
      }
      buildingIndex += 1;
    }
    if (buildingIndex !== this.buildingSignatureSnapshots.length) {
      rawSignatureUnchanged = false;
    }
    if (!force && rawSignatureUnchanged) return;

    const roadNetwork = this.options.getRoadNetwork();
    const signature = buildings
      .map((building) => `${building.id}:${building.kind}:${building.x.toFixed(2)}:${building.z.toFixed(2)}:${building.yaw?.toFixed(4) ?? ''}:${building.constructionComplete ?? ''}`)
      .sort()
      .join('|');
    this.captureBuildingSignatureSnapshot(buildings);
    if (!force && signature === this.signature) return;
    this.signature = signature;

    const previousOpacities = this.previousOpacityByConnectionId;
    previousOpacities.clear();
    for (const connection of this.connections) {
      previousOpacities.set(connection.id, connection.opacity);
    }
    const nextConnections: RuntimeBuildingRoadConnection[] = [];
    const buildingGroups = this.buildingGroupById;
    buildingGroups.clear();
    for (const building of buildings) {
      let buildingGroup = buildingGroups.get(building.id);
      if (buildingGroup === undefined) {
        buildingGroup = buildingGroups.size;
        buildingGroups.set(building.id, buildingGroup);
      }
      for (const connection of getBuildingRoadConnectionPoints(
        building,
        this.options.terrain,
        roadNetwork,
      )) {
        nextConnections.push({
          ...connection,
          opacity: previousOpacities.get(connection.id) ?? 0,
          buildingGroup,
        });
      }
    }
    this.connections = nextConnections;
    this.connectionDistances.length = nextConnections.length;
    this.nearestConnectionIndexByBuilding.length = buildingGroups.size;
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
    let activeCount = 0;
    for (const connection of this.connections) {
      if (connection.opacity >= MIN_RENDERED_OPACITY) {
        activeCount += 1;
      }
    }
    if (activeCount > 0) this.ensureCapacity(activeCount);
    if (!this.ringMarkers || !this.postMarkers) return;

    let instanceIndex = 0;
    for (const connection of this.connections) {
      const opacity = connection.opacity;
      if (opacity < MIN_RENDERED_OPACITY) continue;
      const point = connection.point;
      const scale = 0.86 + opacity * 0.14;
      this.markerScale.setScalar(scale);
      this.matrix.compose(
        this.markerPosition.set(point.x, point.y + MARKER_LIFT, point.z),
        this.ringRotation,
        this.markerScale,
      );
      this.ringMarkers.setMatrixAt(instanceIndex, this.matrix);
      this.matrix.compose(
        this.markerPosition.set(point.x, point.y + MARKER_LIFT + 0.28, point.z),
        this.identityRotation,
        this.markerScale,
      );
      this.postMarkers.setMatrixAt(instanceIndex, this.matrix);
      this.ringOpacityAttribute?.setX(instanceIndex, opacity);
      this.postOpacityAttribute?.setX(instanceIndex, opacity);
      instanceIndex += 1;
    }

    this.ringMarkers.count = activeCount;
    this.postMarkers.count = activeCount;
    this.ringMarkers.instanceMatrix.needsUpdate = true;
    this.postMarkers.instanceMatrix.needsUpdate = true;
    if (this.ringOpacityAttribute) this.ringOpacityAttribute.needsUpdate = true;
    if (this.postOpacityAttribute) this.postOpacityAttribute.needsUpdate = true;
  }

  private captureBuildingSignatureSnapshot(
    buildings: readonly BuildingRoadConnectionSource[],
  ): void {
    for (let index = 0; index < buildings.length; index += 1) {
      const building = buildings[index];
      const snapshot = this.buildingSignatureSnapshots[index];
      if (snapshot) {
        snapshot.id = building.id;
        snapshot.kind = building.kind;
        snapshot.x = building.x;
        snapshot.z = building.z;
        snapshot.yaw = building.yaw;
        snapshot.constructionComplete = building.constructionComplete;
      } else {
        this.buildingSignatureSnapshots.push({
          id: building.id,
          kind: building.kind,
          x: building.x,
          z: building.z,
          yaw: building.yaw,
          constructionComplete: building.constructionComplete,
        });
      }
    }
    this.buildingSignatureSnapshots.length = buildings.length;
  }

  private ensureCapacity(required: number): void {
    if (required <= this.capacity) return;
    this.capacity = Math.max(4, Math.pow(2, Math.ceil(Math.log2(required))));
    this.ringMarkers?.removeFromParent();
    this.postMarkers?.removeFromParent();
    this.ringOpacityAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity),
      1,
    );
    this.postOpacityAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity),
      1,
    );
    this.ringGeometry.setAttribute('markerOpacity', this.ringOpacityAttribute);
    this.postGeometry.setAttribute('markerOpacity', this.postOpacityAttribute);
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
    this.ringMarkers.name = 'Building road connection rings';
    this.postMarkers.name = 'Building road connection posts';
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

export function markerRevealOpacity(distance: number, isNearest: boolean): number {
  const fullDistance = isNearest
    ? NEAREST_MARKER_FULL_DISTANCE
    : SIBLING_MARKER_FULL_DISTANCE;
  const revealDistance = isNearest
    ? NEAREST_MARKER_REVEAL_DISTANCE
    : SIBLING_MARKER_REVEAL_DISTANCE;
  const fade = THREE.MathUtils.smoothstep(distance, fullDistance, revealDistance);
  return 1 - fade;
}

export function createFadingMarkerMaterial(
  opacity: number,
  side: THREE.Side,
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    side,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float markerOpacity;\nvarying float vMarkerOpacity;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvMarkerOpacity = markerOpacity;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vMarkerOpacity;',
      )
      .replace(
        '#include <opaque_fragment>',
        'diffuseColor.a *= vMarkerOpacity;\n#include <opaque_fragment>',
      );
  };
  material.customProgramCacheKey = () => 'building-road-marker-instance-opacity-v1';
  return material;
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
