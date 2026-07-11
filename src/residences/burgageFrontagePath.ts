import * as THREE from 'three';
import type { RoadEdge } from '../roads/RoadEdge.ts';
import type { RoadNetwork, SnapTarget } from '../roads/RoadNetwork.ts';
import { getEdgePath, roadPerpendicular } from '../roads/roadEndpoint.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';

export const BURGAGE_ROAD_SETBACK = 0.35;
const FRONTAGE_SAMPLE_SPACING = 1.1;
const ROAD_CENTER_SNAP_DISTANCE = 14;

type PathProjection = {
  segmentIndex: number;
  point: THREE.Vector3;
  distanceAlong: number;
  distance: number;
};

type NetworkAnchor = {
  edgeId: string;
  path: THREE.Vector3[];
  point: THREE.Vector3;
  distanceAlong: number;
  startNodeId: string;
  endNodeId: string;
  totalLength: number;
};

type AnchorExit = {
  nodeId: string;
  legLength: number;
};

export function pickRoadOffsetSide(
  center: THREE.Vector3,
  normal: THREE.Vector3,
  cursor: THREE.Vector3,
): 1 | -1 {
  const toCursorX = cursor.x - center.x;
  const toCursorZ = cursor.z - center.z;
  const dot = normal.x * toCursorX + normal.z * toCursorZ;
  return dot >= 0 ? 1 : -1;
}

export function resolveSnapTangentAndWidth(
  snap: SnapTarget,
  roadNetwork: RoadNetwork,
): { tangent: THREE.Vector3; halfWidth: number } {
  if (snap.kind === 'segment') {
    const edge = roadNetwork.edges.get(snap.edgeId);
    if (!edge) return { tangent: new THREE.Vector3(1, 0, 0), halfWidth: 2.1 };
    const path = getEdgePath(edge);
    const projection = projectPointToPath(path, { x: snap.point.x, z: snap.point.z });
    return {
      tangent: tangentAtPathIndex(path, projection.segmentIndex),
      halfWidth: edge.width * 0.5,
    };
  }

  const node = roadNetwork.nodes.get(snap.nodeId);
  if (!node) return { tangent: new THREE.Vector3(1, 0, 0), halfWidth: 2.1 };

  let tangent = new THREE.Vector3(1, 0, 0);
  let halfWidth = 2.1;
  let count = 0;
  for (const edgeId of node.edgeIds) {
    const edge = roadNetwork.edges.get(edgeId);
    if (!edge) continue;
    halfWidth = Math.max(halfWidth, edge.width * 0.5);
    const path = getEdgePath(edge);
    const nodeIndex = edge.startNodeId === snap.nodeId ? 0 : path.length - 1;
    const edgeTangent = tangentAtPathIndex(path, Math.max(0, nodeIndex - 1));
    tangent.add(edgeTangent);
    count += 1;
  }
  if (count > 0) tangent.normalize();
  return { tangent, halfWidth };
}

export function resolveNetworkAnchor(roadNetwork: RoadNetwork, point: Point2): NetworkAnchor | null {
  const snap = roadNetwork.findSnap(
    new THREE.Vector3(point.x, 0, point.z),
    ROAD_CENTER_SNAP_DISTANCE,
  );
  if (!snap) return null;

  if (snap.kind === 'segment') {
    const edge = roadNetwork.edges.get(snap.edgeId);
    if (!edge) return null;
    const path = getEdgePath(edge);
    if (path.length < 2) return null;
    const projection = projectPointToPath(path, point);
    const distances = cumulativeDistances(path);
    return {
      edgeId: snap.edgeId,
      path,
      point: projection.point,
      distanceAlong: projection.distanceAlong,
      startNodeId: edge.startNodeId,
      endNodeId: edge.endNodeId,
      totalLength: distances[distances.length - 1],
    };
  }

  const node = roadNetwork.nodes.get(snap.nodeId);
  if (!node || node.edgeIds.size === 0) return null;

  let bestEdge: RoadEdge | null = null;
  let bestPath: THREE.Vector3[] | null = null;
  let bestDistance = Infinity;
  for (const edgeId of node.edgeIds) {
    const edge = roadNetwork.edges.get(edgeId);
    if (!edge) continue;
    const path = getEdgePath(edge);
    const projection = projectPointToPath(path, point);
    if (projection.distance < bestDistance) {
      bestDistance = projection.distance;
      bestEdge = edge;
      bestPath = path;
    }
  }
  if (!bestEdge || !bestPath || bestPath.length < 2) return null;

  const distances = cumulativeDistances(bestPath);
  const distanceAlong = bestEdge.startNodeId === snap.nodeId
    ? 0
    : distances[distances.length - 1];

  return {
    edgeId: bestEdge.id,
    path: bestPath,
    point: snap.point.clone(),
    distanceAlong,
    startNodeId: bestEdge.startNodeId,
    endNodeId: bestEdge.endNodeId,
    totalLength: distances[distances.length - 1],
  };
}

export function resolveRoadCenterPathForFrontage(
  roadNetwork: RoadNetwork,
  frontStart: Point2,
  frontEnd: Point2,
  centerStart?: Point2,
  centerEnd?: Point2,
): THREE.Vector3[] | null {
  const resolvedStart = centerStart ?? resolveRoadCenterFromFrontagePoint(frontStart, roadNetwork);
  const resolvedEnd = centerEnd ?? resolveRoadCenterFromFrontagePoint(frontEnd, roadNetwork);
  if (!resolvedStart || !resolvedEnd) return null;
  return extractRoadCenterPathBetween(roadNetwork, resolvedStart, resolvedEnd);
}

export function offsetCenterPathBesideRoad(
  centerPath: THREE.Vector3[],
  side: 1 | -1,
  roadNetwork: RoadNetwork,
): Point2[] {
  const result: Point2[] = [];
  for (let i = 0; i < centerPath.length; i++) {
    const center = centerPath[i];
    const halfWidth = resolveHalfWidthAtPoint(center, roadNetwork);
    const tangent = tangentAtPathIndex(centerPath, Math.min(i, centerPath.length - 2));
    const normal = roadPerpendicular(tangent);
    const offset = halfWidth + BURGAGE_ROAD_SETBACK;
    result.push({
      x: center.x + normal.x * offset * side,
      z: center.z + normal.z * offset * side,
    });
  }
  return result;
}

export function slicePathByDistance(path: THREE.Vector3[], startDist: number, endDist: number): THREE.Vector3[] {
  if (path.length < 2 || endDist <= startDist + 1e-3) {
    return path.length >= 2 ? [path[0].clone(), path[path.length - 1].clone()] : [];
  }

  const distances = cumulativeDistances(path);
  const result: THREE.Vector3[] = [];

  for (let i = 0; i < path.length - 1; i++) {
    const segStart = distances[i];
    const segEnd = distances[i + 1];
    if (segEnd < startDist || segStart > endDist) continue;

    const a = path[i];
    const b = path[i + 1];
    const segLen = segEnd - segStart;
    if (segLen <= 1e-6) continue;

    const localStart = THREE.MathUtils.clamp((startDist - segStart) / segLen, 0, 1);
    const localEnd = THREE.MathUtils.clamp((endDist - segStart) / segLen, 0, 1);
    if (result.length === 0) {
      result.push(new THREE.Vector3(
        a.x + (b.x - a.x) * localStart,
        a.y + (b.y - a.y) * localStart,
        a.z + (b.z - a.z) * localStart,
      ));
    }
    result.push(new THREE.Vector3(
      a.x + (b.x - a.x) * localEnd,
      a.y + (b.y - a.y) * localEnd,
      a.z + (b.z - a.z) * localEnd,
    ));
  }

  return result.length >= 2 ? result : [];
}

function resolveRoadCenterFromFrontagePoint(
  point: Point2,
  roadNetwork: RoadNetwork,
): Point2 | null {
  const snap = roadNetwork.findSnap(
    new THREE.Vector3(point.x, 0, point.z),
    ROAD_CENTER_SNAP_DISTANCE,
  );
  if (!snap) return null;
  return { x: snap.point.x, z: snap.point.z };
}

function extractRoadCenterPathBetween(
  roadNetwork: RoadNetwork,
  start: Point2,
  end: Point2,
): THREE.Vector3[] | null {
  const anchorA = resolveNetworkAnchor(roadNetwork, start);
  const anchorB = resolveNetworkAnchor(roadNetwork, end);
  if (!anchorA || !anchorB) return null;

  if (anchorA.edgeId === anchorB.edgeId) {
    const sliced = sliceBetweenAnchorsOnSameEdge(anchorA, anchorB);
    return sliced ? densifyPath(sliced, FRONTAGE_SAMPLE_SPACING) : null;
  }

  const routed = routeCenterPathBetweenAnchors(anchorA, anchorB, roadNetwork);
  return routed ? densifyPath(routed, FRONTAGE_SAMPLE_SPACING) : null;
}

function sliceBetweenAnchorsOnSameEdge(
  anchorA: NetworkAnchor,
  anchorB: NetworkAnchor,
): THREE.Vector3[] | null {
  const forward = anchorA.distanceAlong <= anchorB.distanceAlong;
  const startDist = forward ? anchorA.distanceAlong : anchorB.distanceAlong;
  const endDist = forward ? anchorB.distanceAlong : anchorA.distanceAlong;
  const startPoint = forward ? anchorA.point : anchorB.point;
  const endPoint = forward ? anchorB.point : anchorA.point;

  const sliced = slicePathByDistance(anchorA.path, startDist, endDist);
  if (sliced.length < 2) return null;
  sliced[0] = startPoint.clone();
  sliced[sliced.length - 1] = endPoint.clone();
  return sliced;
}

function routeCenterPathBetweenAnchors(
  anchorA: NetworkAnchor,
  anchorB: NetworkAnchor,
  roadNetwork: RoadNetwork,
): THREE.Vector3[] | null {
  const exitsA = anchorExits(anchorA);
  const exitsB = anchorExits(anchorB);
  let bestPath: THREE.Vector3[] | null = null;
  let bestLength = Infinity;

  for (const exitA of exitsA) {
    for (const exitB of exitsB) {
      const nodePath = shortestNodePath(roadNetwork, exitA.nodeId, exitB.nodeId);
      if (!nodePath) continue;

      const stitched = stitchCenterPath(anchorA, exitA, nodePath, exitB, anchorB, roadNetwork);
      if (!stitched || stitched.length < 2) continue;

      const length = polylineLength(stitched);
      if (length < bestLength) {
        bestLength = length;
        bestPath = stitched;
      }
    }
  }

  return bestPath;
}

function anchorExits(anchor: NetworkAnchor): AnchorExit[] {
  const toStart = anchor.distanceAlong;
  const toEnd = anchor.totalLength - anchor.distanceAlong;
  return [
    { nodeId: anchor.startNodeId, legLength: toStart },
    { nodeId: anchor.endNodeId, legLength: toEnd },
  ];
}

function stitchCenterPath(
  anchorA: NetworkAnchor,
  exitA: AnchorExit,
  nodePath: string[],
  exitB: AnchorExit,
  anchorB: NetworkAnchor,
  roadNetwork: RoadNetwork,
): THREE.Vector3[] | null {
  const parts: THREE.Vector3[] = [];
  const legA = sliceAnchorToNode(anchorA, exitA);
  if (legA.length > 0) appendPath(parts, legA);

  for (let i = 0; i < nodePath.length - 1; i++) {
    const edgeLeg = edgePathBetweenNodes(roadNetwork, nodePath[i], nodePath[i + 1]);
    if (!edgeLeg) return null;
    appendPath(parts, edgeLeg);
  }

  const legB = sliceNodeToAnchor(anchorB, exitB);
  if (legB.length > 0) appendPath(parts, legB);

  return parts.length >= 2 ? parts : null;
}

function sliceAnchorToNode(anchor: NetworkAnchor, exit: AnchorExit): THREE.Vector3[] {
  if (exit.nodeId === anchor.startNodeId) {
    const leg = slicePathByDistance(anchor.path, 0, anchor.distanceAlong);
    if (leg.length < 2) return [anchor.point.clone(), leg[0]?.clone() ?? anchor.path[0].clone()];
    leg[leg.length - 1] = anchor.point.clone();
    return leg.reverse();
  }

  if (exit.nodeId === anchor.endNodeId) {
    const leg = slicePathByDistance(anchor.path, anchor.distanceAlong, anchor.totalLength);
    if (leg.length < 2) return [anchor.point.clone(), leg[leg.length - 1]?.clone() ?? anchor.path[anchor.path.length - 1].clone()];
    leg[0] = anchor.point.clone();
    return leg;
  }

  return [];
}

function sliceNodeToAnchor(anchor: NetworkAnchor, exit: AnchorExit): THREE.Vector3[] {
  if (exit.nodeId === anchor.startNodeId) {
    const leg = slicePathByDistance(anchor.path, 0, anchor.distanceAlong);
    if (leg.length < 2) return [leg[0]?.clone() ?? anchor.path[0].clone(), anchor.point.clone()];
    leg[leg.length - 1] = anchor.point.clone();
    return leg;
  }

  if (exit.nodeId === anchor.endNodeId) {
    const leg = slicePathByDistance(anchor.path, anchor.distanceAlong, anchor.totalLength);
    if (leg.length < 2) return [leg[0]?.clone() ?? anchor.point.clone(), anchor.point.clone()];
    leg[0] = anchor.point.clone();
    return leg;
  }

  return [];
}

function edgePathBetweenNodes(
  roadNetwork: RoadNetwork,
  startNodeId: string,
  endNodeId: string,
): THREE.Vector3[] | null {
  const startNode = roadNetwork.nodes.get(startNodeId);
  if (!startNode) return null;

  for (const edgeId of startNode.edgeIds) {
    const edge = roadNetwork.edges.get(edgeId);
    if (!edge) continue;
    const forward = edge.startNodeId === startNodeId && edge.endNodeId === endNodeId;
    const reverse = edge.endNodeId === startNodeId && edge.startNodeId === endNodeId;
    if (!forward && !reverse) continue;

    const path = getEdgePath(edge).map((point) => point.clone());
    if (path.length < 2) return null;
    return reverse ? path.reverse() : path;
  }

  return null;
}

function shortestNodePath(
  roadNetwork: RoadNetwork,
  startNodeId: string,
  endNodeId: string,
): string[] | null {
  if (startNodeId === endNodeId) return [startNodeId];

  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const heap: Array<{ cost: number; id: string }> = [{ cost: 0, id: startNodeId }];
  dist.set(startNodeId, 0);
  prev.set(startNodeId, null);

  while (heap.length > 0) {
    heap.sort((a, b) => a.cost - b.cost);
    const current = heap.shift();
    if (!current) break;
    if (current.cost > (dist.get(current.id) ?? Infinity)) continue;
    if (current.id === endNodeId) break;

    const node = roadNetwork.nodes.get(current.id);
    if (!node) continue;

    for (const edgeId of node.edgeIds) {
      const edge = roadNetwork.edges.get(edgeId);
      if (!edge) continue;
      const neighbor = edge.startNodeId === current.id ? edge.endNodeId : edge.startNodeId;
      const weight = edge.length > 0
        ? edge.length
        : polylineLength(getEdgePath(edge));
      const nextCost = current.cost + weight;
      if (nextCost >= (dist.get(neighbor) ?? Infinity)) continue;
      dist.set(neighbor, nextCost);
      prev.set(neighbor, current.id);
      heap.push({ cost: nextCost, id: neighbor });
    }
  }

  if (!dist.has(endNodeId)) return null;

  const path: string[] = [];
  let cursor: string | null = endNodeId;
  while (cursor) {
    path.push(cursor);
    cursor = prev.get(cursor) ?? null;
  }
  path.reverse();
  return path;
}

function appendPath(target: THREE.Vector3[], source: THREE.Vector3[]): void {
  for (let i = 0; i < source.length; i++) {
    const point = source[i];
    const last = target[target.length - 1];
    if (last && last.distanceToSquared(point) <= 1e-4) continue;
    target.push(point.clone());
  }
}

function polylineLength(path: THREE.Vector3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += path[i].distanceTo(path[i - 1]);
  }
  return total;
}

function resolveHalfWidthAtPoint(center: THREE.Vector3, roadNetwork: RoadNetwork): number {
  let halfWidth = 2.1;
  for (const edge of roadNetwork.edges.values()) {
    const path = getEdgePath(edge);
    const distance = projectPointToPath(path, { x: center.x, z: center.z }).distance;
    if (distance <= edge.width * 0.5 + 1.5) {
      halfWidth = Math.max(halfWidth, edge.width * 0.5);
    }
  }
  return halfWidth;
}

function projectPointToPath(path: THREE.Vector3[], point: Point2): PathProjection {
  const distances = cumulativeDistances(path);
  let best: PathProjection = {
    segmentIndex: 0,
    point: path[0].clone(),
    distanceAlong: 0,
    distance: Infinity,
  };

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lengthSq = abx * abx + abz * abz;
    const t = lengthSq <= 1e-6
      ? 0
      : THREE.MathUtils.clamp(((point.x - a.x) * abx + (point.z - a.z) * abz) / lengthSq, 0, 1);
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const distance = Math.hypot(point.x - px, point.z - pz);
    if (distance < best.distance) {
      best = {
        segmentIndex: i,
        point: new THREE.Vector3(px, a.y, pz),
        distanceAlong: distances[i] + Math.hypot(px - a.x, pz - a.z),
        distance,
      };
    }
  }

  return best;
}

function densifyPath(path: THREE.Vector3[], spacing: number): THREE.Vector3[] {
  if (path.length < 2) return path.map((point) => point.clone());
  const distances = cumulativeDistances(path);
  const total = distances[distances.length - 1];
  if (total <= spacing * 1.5) return path.map((point) => point.clone());

  const count = Math.max(2, Math.ceil(total / spacing) + 1);
  const result: THREE.Vector3[] = [];
  for (let step = 0; step < count; step++) {
    const target = (step / (count - 1)) * total;
    result.push(samplePathAtDistance(path, distances, target));
  }
  return result;
}

function samplePathAtDistance(
  path: THREE.Vector3[],
  distances: number[],
  target: number,
): THREE.Vector3 {
  for (let i = 0; i < path.length - 1; i++) {
    const segStart = distances[i];
    const segEnd = distances[i + 1];
    if (target > segEnd) continue;
    const a = path[i];
    const b = path[i + 1];
    const segLen = segEnd - segStart;
    const t = segLen <= 1e-6 ? 0 : (target - segStart) / segLen;
    return new THREE.Vector3(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t,
    );
  }
  return path[path.length - 1].clone();
}

function cumulativeDistances(path: THREE.Vector3[]): number[] {
  const result = [0];
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const next = path[i];
    result.push(result[i - 1] + Math.hypot(next.x - prev.x, next.z - prev.z));
  }
  return result;
}

function tangentAtPathIndex(path: THREE.Vector3[], index: number): THREE.Vector3 {
  if (path.length < 2) return new THREE.Vector3(1, 0, 0);
  const i = Math.min(Math.max(index, 0), path.length - 2);
  const dx = path[i + 1].x - path[i].x;
  const dz = path[i + 1].z - path[i].z;
  const length = Math.hypot(dx, dz);
  if (length <= 1e-6) return new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3(dx / length, 0, dz / length);
}
