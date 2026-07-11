import * as THREE from 'three';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { roadPerpendicular } from '../roads/roadEndpoint.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import { MAX_ZONE_DEPTH, MIN_ZONE_DEPTH } from './burgageLayout.ts';
import {
  depthFromBackPoint,
  inwardNormalForFrontage,
  type RectangleCorners,
} from './burgageRectangle.ts';
import {
  BURGAGE_ROAD_SETBACK,
  offsetCenterPathBesideRoad,
  pickRoadOffsetSide,
  resolveNetworkAnchor,
  resolveRoadCenterPathForFrontage,
  resolveSnapTangentAndWidth,
  slicePathByDistance,
} from './burgageFrontagePath.ts';

export { BURGAGE_ROAD_SETBACK };

const MIN_FRONTAGE_LENGTH = 4;
const HOVER_FRONTAGE_PREVIEW_HALF_LENGTH = 5;

export type CurvedZoneGeometry = {
  outline: Point2[];
  corners: RectangleCorners;
  frontagePointCount: number;
};

export type FrontagePreviewOutline = {
  points: THREE.Vector3[];
  frontagePointCount: number;
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
  const centerPath = resolveRoadCenterPathForFrontage(
    roadNetwork,
    frontStart,
    frontEnd,
    centerStart,
    centerEnd,
  );
  if (centerPath && centerPath.length >= 2) {
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

  const centerPath = resolveRoadCenterPathForFrontage(
    roadNetwork,
    frontStart,
    frontEnd,
    centerStart,
    centerEnd,
  );
  const frontEdge = centerPath && centerPath.length >= 2
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

  return { outline, corners, frontagePointCount: frontEdge.length };
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

export function resolveHoverFrontagePreview(
  center: Point2,
  roadNetwork: RoadNetwork,
  offsetSide: 1 | -1,
  getHeightAt: (x: number, z: number) => number,
): FrontagePreviewOutline | null {
  const anchor = resolveNetworkAnchor(roadNetwork, center);
  if (!anchor) return null;

  const startDist = Math.max(0, anchor.distanceAlong - HOVER_FRONTAGE_PREVIEW_HALF_LENGTH);
  const endDist = Math.min(anchor.totalLength, anchor.distanceAlong + HOVER_FRONTAGE_PREVIEW_HALF_LENGTH);
  const centerSlice = slicePathByDistance(anchor.path, startDist, endDist);
  if (centerSlice.length < 2) return null;

  const frontEdge = offsetCenterPathBesideRoad(centerSlice, offsetSide, roadNetwork);
  const points = frontEdge.map((point) => {
    const y = getHeightAt(point.x, point.z);
    return new THREE.Vector3(point.x, y, point.z);
  });
  return { points, frontagePointCount: points.length };
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
