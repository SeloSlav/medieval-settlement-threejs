import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import {
  getBuildingRoadEntrancePoints,
  type BuildingRoadConnection,
  type BuildingRoadConnectionSource,
} from './BuildingRoadConnections.ts';
import { BUILDING_ROAD_ACCESS_DISTANCE, hasRoadAccess } from './roadConnectivity.ts';
import { BUILDING_ACCESS_SPUR_WIDTH, ROAD_CORE_EDGE_JITTER_RATIO } from './roadDimensions.ts';
import type { RoadMeshBuilder } from './RoadMeshBuilder.ts';
import type { RoadNetwork, SnapTarget } from './RoadNetwork.ts';

const MIN_SPUR_LENGTH = 0.2;
const CLEARANCE_CELL_SIZE = 8;
// Clear rooted tufts from the walked strip while allowing blade tips to
// overlap its feathered verge. Main-road clearance stays independent.
const SPUR_GRASS_ROOT_MARGIN = 0.18;
type SpurClearance = {
  x: number; z: number; dx: number; dz: number;
  inverseLengthSquared: number; radiusSquared: number;
};

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
  private readonly clearanceCells = new Map<number, SpurClearance[]>();

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

  sync(buildings: Iterable<BuildingRoadConnectionSource>, network: RoadNetwork | null): boolean {
    const buildingSnapshot = [...buildings];
    const signature = spurSignature(buildingSnapshot, network);
    if (signature === this.signature) return false;
    this.signature = signature;
    this.clear();
    if (!network) return true;

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
      this.indexGrassClearance(plan);
    }
    return true;
  }

  /** Placement-time query only; no per-frame traversal or scene geometry. */
  isGrassBlockedAt(x: number, z: number): boolean {
    if (this.clearanceCells.size === 0) return false;
    const bucket = this.clearanceCells.get(clearanceCellKey(
      Math.floor(x / CLEARANCE_CELL_SIZE), Math.floor(z / CLEARANCE_CELL_SIZE),
    ));
    if (!bucket) return false;
    for (const strip of bucket) {
      const offsetX = x - strip.x;
      const offsetZ = z - strip.z;
      const t = Math.max(0, Math.min(1,
        (offsetX * strip.dx + offsetZ * strip.dz) * strip.inverseLengthSquared,
      ));
      const dx = offsetX - strip.dx * t;
      const dz = offsetZ - strip.dz * t;
      if (dx * dx + dz * dz <= strip.radiusSquared) return true;
    }
    return false;
  }

  private indexGrassClearance(plan: BuildingAccessSpurPlan): void {
    const a = plan.roadPoint;
    const b = plan.connection.point;
    const radius = plan.visualWidth * (0.5 + ROAD_CORE_EDGE_JITTER_RATIO) + SPUR_GRASS_ROOT_MARGIN;
    const strip: SpurClearance = {
      x: a.x, z: a.z, dx: b.x - a.x, dz: b.z - a.z,
      inverseLengthSquared: 1 / (plan.length * plan.length), radiusSquared: radius * radius,
    };
    for (let cz = Math.floor((Math.min(a.z, b.z) - radius) / CLEARANCE_CELL_SIZE);
      cz <= Math.floor((Math.max(a.z, b.z) + radius) / CLEARANCE_CELL_SIZE); cz++) {
      for (let cx = Math.floor((Math.min(a.x, b.x) - radius) / CLEARANCE_CELL_SIZE);
        cx <= Math.floor((Math.max(a.x, b.x) + radius) / CLEARANCE_CELL_SIZE); cx++) {
        const key = clearanceCellKey(cx, cz);
        const bucket = this.clearanceCells.get(key);
        if (bucket) bucket.push(strip);
        else this.clearanceCells.set(key, [strip]);
      }
    }
  }

  dispose(): void {
    this.clear();
    this.signature = '';
    this.group.removeFromParent();
  }

  private clear(): void {
    this.clearanceCells.clear();
    for (const child of [...this.group.children]) disposeObject3D(child);
    this.group.clear();
  }
}

function clearanceCellKey(x: number, z: number): number {
  return ((x + 32768) & 0xffff) | (((z + 32768) & 0xffff) << 16);
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
