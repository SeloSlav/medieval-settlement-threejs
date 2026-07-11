import * as THREE from 'three';
import type { RoadNetwork, SnapTarget } from '../roads/RoadNetwork.ts';
import { getEdgePath, roadPerpendicular } from '../roads/roadEndpoint.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import { MAX_ZONE_DEPTH, MIN_ZONE_DEPTH } from './burgageLayout.ts';
import {
  depthFromBackPoint,
  inwardNormalForFrontage,
  type RectangleCorners,
} from './burgageRectangle.ts';

/** Setback from the paved road edge to the frontage line. */
export const BURGAGE_ROAD_SETBACK = 0.35;
const FRONTAGE_SAMPLE_SPACING = 1.1;
const MIN_FRONTAGE_LENGTH = 4;
const MAX_CENTER_PATH_MATCH_DISTANCE = 8;

export type CurvedZoneGeometry = {
  outline: Point2[];
  corners: RectangleCorners;
};

type PathProjection = {
  segmentIndex: number;
  point: THREE.Vector3;
  distanceAlong: number;
  distance: number;
};

export function snapBurgagePointBesideRoad(
  cursor: THREE.Vector3,
  roadNetwork: RoadNetwork,
  maxDistance: number,
  lockedSide: 1 | -1 | null,
): { point: THREE.Vector3; center: THREE.Vector3; side: 1 | -1 } {
  const snap = roadNetwork.findSnap(cursor, maxDistance);
  if (!snap) {
    return { point: cursor.clone(), center: cursor.clone(), side: lockedSide ?? 1 };
  }

  const { tangent, halfWidth } = resolveSnapTangentAndWidth(snap, roadNetwork);
  const normal = roadPerpendicular(tangent);
  const side = lockedSide ?? pickRoadOffsetSide(snap.point, normal, cursor);
  const offset = halfWidth + BURGAGE_ROAD_SETBACK;
  const point = new THREE.Vector3(
    snap.point.x + normal.x * offset * side,
    cursor.y,
    snap.point.z + normal.z * offset * side,
  );
  return { point, center: snap.point.clone(), side };
}

export function resolveCurvedFrontageLine(
  frontStart: Point2,
  frontEnd: Point2,
  roadNetwork: RoadNetwork,
  centerStart?: Point2,
  centerEnd?: Point2,
  offsetSide: 1 | -1 = 1,
): Point2[] {
  const centerPath = centerStart && centerEnd
    ? extractRoadCenterPathBetween(roadNetwork, centerStart, centerEnd)
    : null;
  if (centerPath) {
    return offsetCenterPathBesideRoad(centerPath, offsetSide, roadNetwork);
  }
  return [frontStart, frontEnd];
}

export function buildCurvedZoneFromFrontage(
  frontStart: Point2,
  frontEnd: Point2,
  backPoint: Point2,
  roadNetwork: RoadNetwork,
  centerStart?: Point2,
  centerEnd?: Point2,
  offsetSide: 1 | -1 = 1,
): CurvedZoneGeometry | null {
  const frontLength = Math.hypot(frontEnd.x - frontStart.x, frontEnd.z - frontStart.z);
  if (frontLength < MIN_FRONTAGE_LENGTH) return null;

  const inward = inwardNormalForFrontage(frontStart, frontEnd, roadNetwork);
  const depth = depthFromBackPoint(frontStart, frontEnd, backPoint, inward);
  if (depth < MIN_ZONE_DEPTH - 0.05 || depth > MAX_ZONE_DEPTH + 0.05) return null;

  const centerPath = centerStart && centerEnd
    ? extractRoadCenterPathBetween(roadNetwork, centerStart, centerEnd)
    : null;
  const frontEdge = centerPath
    ? offsetCenterPathBesideRoad(centerPath, offsetSide, roadNetwork)
    : [frontStart, frontEnd];

  const rearEdge = frontEdge.map((point) => ({
    x: point.x + inward.x * depth,
    z: point.z + inward.z * depth,
  }));

  const outline = [...frontEdge, ...rearEdge.slice().reverse()];
  const corners: RectangleCorners = {
    a: frontEdge[0],
    b: frontEdge[frontEdge.length - 1],
    c: rearEdge[rearEdge.length - 1],
    d: rearEdge[0],
  };

  return { outline, corners };
}

export function resolveCurvedZoneOutline(
  corners: RectangleCorners,
  roadNetwork: RoadNetwork,
): Point2[] {
  const geometry = buildCurvedZoneFromFrontage(
    corners.a,
    corners.b,
    corners.d,
    roadNetwork,
    undefined,
    undefined,
    inwardSideForCorners(corners, roadNetwork),
  );
  return geometry?.outline ?? [corners.a, corners.b, corners.c, corners.d];
}

function inwardSideForCorners(corners: RectangleCorners, roadNetwork: RoadNetwork): 1 | -1 {
  const inward = inwardNormalForFrontage(corners.a, corners.b, roadNetwork);
  const mid = {
    x: (corners.a.x + corners.b.x) * 0.5,
    z: (corners.a.z + corners.b.z) * 0.5,
  };
  const rearMid = {
    x: (corners.d.x + corners.c.x) * 0.5,
    z: (corners.d.z + corners.c.z) * 0.5,
  };
  const toRearX = rearMid.x - mid.x;
  const toRearZ = rearMid.z - mid.z;
  const dot = inward.x * toRearX + inward.z * toRearZ;
  return dot >= 0 ? 1 : -1;
}

function pickRoadOffsetSide(
  center: THREE.Vector3,
  normal: THREE.Vector3,
  cursor: THREE.Vector3,
): 1 | -1 {
  const toCursorX = cursor.x - center.x;
  const toCursorZ = cursor.z - center.z;
  const dot = normal.x * toCursorX + normal.z * toCursorZ;
  return dot >= 0 ? 1 : -1;
}

function resolveSnapTangentAndWidth(
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

function extractRoadCenterPathBetween(
  roadNetwork: RoadNetwork,
  start: Point2,
  end: Point2,
): THREE.Vector3[] | null {
  let bestPath: THREE.Vector3[] | null = null;
  let bestProjA: PathProjection | null = null;
  let bestProjB: PathProjection | null = null;
  let bestScore = Infinity;

  for (const edge of roadNetwork.edges.values()) {
    const path = getEdgePath(edge);
    if (path.length < 2) continue;
    const projA = projectPointToPath(path, start);
    const projB = projectPointToPath(path, end);
    const score = projA.distance + projB.distance;
    if (score >= bestScore) continue;
    bestScore = score;
    bestPath = path;
    bestProjA = projA;
    bestProjB = projB;
  }

  if (!bestPath || !bestProjA || !bestProjB || bestScore > MAX_CENTER_PATH_MATCH_DISTANCE) {
    return null;
  }

  const forward = bestProjA.distanceAlong <= bestProjB.distanceAlong;
  const startDist = forward ? bestProjA.distanceAlong : bestProjB.distanceAlong;
  const endDist = forward ? bestProjB.distanceAlong : bestProjA.distanceAlong;
  const startPoint = forward ? bestProjA.point : bestProjB.point;
  const endPoint = forward ? bestProjB.point : bestProjA.point;

  const sliced = slicePathByDistance(bestPath, startDist, endDist);
  if (sliced.length === 0) return null;
  sliced[0] = startPoint.clone();
  sliced[sliced.length - 1] = endPoint.clone();
  return densifyPath(sliced, FRONTAGE_SAMPLE_SPACING);
}

function offsetCenterPathBesideRoad(
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

function slicePathByDistance(path: THREE.Vector3[], startDist: number, endDist: number): THREE.Vector3[] {
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
