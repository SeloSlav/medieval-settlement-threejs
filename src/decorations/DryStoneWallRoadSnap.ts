import * as THREE from 'three';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork, SnapTarget } from '../roads/RoadNetwork.ts';
import { roadVisualWidth } from '../roads/roadDimensions.ts';
import type { TerrainHeightSampler } from './DryStoneWall.ts';
import { DRY_STONE_WALL_SHOULDER_CLEARANCE } from './DryStoneWall.ts';

export type DryStoneWallRoadSnap = {
  point: THREE.Vector3;
  roadPoint: THREE.Vector3;
  tangent: THREE.Vector3;
  edgeId: string;
  side: -1 | 1;
  distance: number;
};

/** Snaps to either shoulder, choosing the side nearest the cursor. */
export function findDryStoneWallRoadSnap(
  network: RoadNetwork,
  terrain: TerrainHeightSampler,
  cursor: THREE.Vector3,
  maxDistance = 6.8,
): DryStoneWallRoadSnap | null {
  const target = network.findSnap(cursor, maxDistance);
  if (!target) return null;
  const candidates = target.kind === 'segment'
    ? candidatesForEdge(network.edges.get(target.edgeId), target, terrain, cursor)
    : network.getConnectedEdges(network.nodes.get(target.nodeId)!)
      .flatMap((edge) => candidatesForEdge(edge, target, terrain, cursor));
  let best: DryStoneWallRoadSnap | null = null;
  for (const candidate of candidates) {
    if (!best || candidate.distance < best.distance) best = candidate;
  }
  return best;
}

export function alignSecondWallAnchorParallel(
  start: THREE.Vector3,
  tangent: THREE.Vector3,
  candidate: THREE.Vector3,
  terrain: TerrainHeightSampler,
): THREE.Vector3 {
  const dx = candidate.x - start.x;
  const dz = candidate.z - start.z;
  const signedDistance = dx * tangent.x + dz * tangent.z;
  const direction = Math.abs(signedDistance) < 0.001 ? 1 : Math.sign(signedDistance);
  const distance = Math.max(0.001, Math.abs(signedDistance));
  const x = start.x + tangent.x * distance * direction;
  const z = start.z + tangent.z * distance * direction;
  return new THREE.Vector3(x, terrain.getHeightAt(x, z), z);
}

function candidatesForEdge(
  edge: RoadEdge | undefined,
  target: SnapTarget,
  terrain: TerrainHeightSampler,
  cursor: THREE.Vector3,
): DryStoneWallRoadSnap[] {
  if (!edge) return [];
  const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
  if (path.length < 2) return [];
  const roadPoint = target.point;
  const tangent = tangentAt(path, roadPoint, target.kind === 'segment' ? target.t : undefined);
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
  const offset = roadVisualWidth(edge.width) * 0.5 + DRY_STONE_WALL_SHOULDER_CLEARANCE;
  return ([-1, 1] as const).map((side) => {
    const x = roadPoint.x + normal.x * offset * side;
    const z = roadPoint.z + normal.z * offset * side;
    const point = new THREE.Vector3(x, terrain.getHeightAt(x, z), z);
    return {
      point,
      roadPoint: roadPoint.clone(),
      tangent: tangent.clone(),
      edgeId: edge.id,
      side,
      distance: Math.hypot(cursor.x - x, cursor.z - z),
    };
  });
}

function tangentAt(
  path: readonly THREE.Vector3[],
  point: THREE.Vector3,
  normalizedT?: number,
): THREE.Vector3 {
  let bestIndex = 0;
  if (normalizedT !== undefined) {
    bestIndex = THREE.MathUtils.clamp(
      Math.floor(normalizedT * Math.max(1, path.length - 1)),
      0,
      path.length - 2,
    );
  } else {
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < path.length - 1; index += 1) {
      const distance = distanceToSegmentXZ(point, path[index], path[index + 1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  }
  return new THREE.Vector3(
    path[bestIndex + 1].x - path[bestIndex].x,
    0,
    path[bestIndex + 1].z - path[bestIndex].z,
  ).normalize();
}

function distanceToSegmentXZ(point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq <= 1e-6
    ? 0
    : THREE.MathUtils.clamp(
      ((point.x - a.x) * abx + (point.z - a.z) * abz) / lengthSq,
      0,
      1,
    );
  return Math.hypot(point.x - (a.x + abx * t), point.z - (a.z + abz * t));
}
