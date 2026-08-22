import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import {
  getBuildingRoadEntrancePoints,
  type BuildingRoadConnection,
  type BuildingRoadConnectionSource,
} from './BuildingRoadConnections.ts';
import { BUILDING_ROAD_ACCESS_DISTANCE, hasRoadAccess } from './roadConnectivity.ts';
import { BUILDING_ACCESS_SPUR_WIDTH } from './roadDimensions.ts';
import type { RoadMeshBuilder } from './RoadMeshBuilder.ts';
import type { RoadNetwork, SnapTarget } from './RoadNetwork.ts';

const MIN_SPUR_LENGTH = 0.2;

export type BuildingAccessSpurPlan = {
  id: string;
  buildingId: string;
  connection: BuildingRoadConnection;
  roadPoint: THREE.Vector3;
  roadSnap: SnapTarget;
  centerRoadDistance: number;
  length: number;
  visualWidth: number;
};

/**
 * Resolves visual spurs from the same building-center road-access rule used by
 * simulation, then chooses the building-envelope entrance nearest that road.
 * Display circles deliberately sit farther out and are not physical spur
 * endpoints.
 */
export function planBuildingAccessSpurs(
  buildings: Iterable<BuildingRoadConnectionSource>,
  terrain: Pick<Terrain, 'getPointAt'>,
  network: RoadNetwork,
): BuildingAccessSpurPlan[] {
  const plans: BuildingAccessSpurPlan[] = [];
  const center = new THREE.Vector3();

  for (const building of buildings) {
    center.set(building.x, 0, building.z);
    if (!hasRoadAccess(building.x, building.z, network)) continue;
    const roadSnap = network.findSnap(center, BUILDING_ROAD_ACCESS_DISTANCE + 1e-6);
    if (!roadSnap) continue;

    const connections = getBuildingRoadEntrancePoints(building, terrain, network);
    const connection = nearestConnection(connections, roadSnap.point);
    if (!connection) continue;
    const length = distanceXZ(connection.point, roadSnap.point);
    if (length < MIN_SPUR_LENGTH) continue;

    plans.push({
      id: `building-access:${building.id}`,
      buildingId: building.id,
      connection,
      roadPoint: roadSnap.point.clone(),
      roadSnap,
      centerRoadDistance: roadSnap.distance,
      length,
      visualWidth: BUILDING_ACCESS_SPUR_WIDTH,
    });
  }

  return plans;
}

export class BuildingAccessSpurs {
  readonly group = new THREE.Group();
  private readonly terrain: Terrain;
  private readonly meshBuilder: RoadMeshBuilder;
  private signature = '';

  constructor(options: {
    parent: THREE.Object3D;
    terrain: Terrain;
    meshBuilder: RoadMeshBuilder;
  }) {
    this.terrain = options.terrain;
    this.meshBuilder = options.meshBuilder;
    this.group.name = 'Building access road spurs';
    options.parent.add(this.group);
  }

  sync(buildings: Iterable<BuildingRoadConnectionSource>, network: RoadNetwork | null): void {
    const buildingSnapshot = [...buildings];
    const signature = spurSignature(buildingSnapshot, network);
    if (signature === this.signature) return;
    this.signature = signature;
    this.clear();
    if (!network) return;

    for (const plan of planBuildingAccessSpurs(buildingSnapshot, this.terrain, network)) {
      const spur = this.meshBuilder.buildBuildingAccessSpur(
        [plan.roadPoint, plan.connection.point],
        plan.visualWidth,
        plan.buildingId,
      );
      if (!spur) continue;
      spur.userData.buildingId = plan.buildingId;
      spur.userData.connectionId = plan.connection.id;
      spur.userData.centerRoadDistance = plan.centerRoadDistance;
      spur.userData.length = plan.length;
      spur.userData.roadSnapKind = plan.roadSnap.kind;
      spur.userData.roadPoint = plan.roadPoint.toArray();
      spur.userData.buildingPoint = plan.connection.point.toArray();
      this.group.add(spur);
    }
  }

  dispose(): void {
    this.clear();
    this.signature = '';
    this.group.removeFromParent();
  }

  private clear(): void {
    for (const child of [...this.group.children]) disposeObject3D(child);
    this.group.clear();
  }
}

function nearestConnection(
  connections: BuildingRoadConnection[],
  roadPoint: THREE.Vector3,
): BuildingRoadConnection | null {
  let nearest: BuildingRoadConnection | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const connection of connections) {
    const distance = distanceXZ(connection.point, roadPoint);
    if (distance >= nearestDistance) continue;
    nearest = connection;
    nearestDistance = distance;
  }
  return nearest;
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function spurSignature(
  buildings: BuildingRoadConnectionSource[],
  network: RoadNetwork | null,
): string {
  const buildingSignature = buildings
    .map((building) => [
      building.id,
      building.kind,
      building.x.toFixed(3),
      building.z.toFixed(3),
      building.yaw?.toFixed(4) ?? 'auto',
      building.constructionComplete ?? 'complete',
    ].join(':'))
    .sort()
    .join('|');
  if (!network) return `none:${buildingSignature}`;
  return [
    network.getTopologyRevision(),
    network.nodes.size,
    network.edges.size,
    buildingSignature,
  ].join('::');
}
