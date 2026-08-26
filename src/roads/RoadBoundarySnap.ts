import type { BurgageZoneState } from '../resources/types.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import { ROAD_WIDTH } from './roadDimensions.ts';

/** Cursor reach for the invisible road-center rails around residence plots. */
export const ROAD_BOUNDARY_SNAP_DISTANCE = 5.6;

/**
 * Keep the logical road footprint outside the authored parcel. The feathered
 * shoulder may still soften the seam, but navigation and placement remain on
 * the public side of the boundary.
 */
export const ROAD_BOUNDARY_CENTERLINE_OFFSET = ROAD_WIDTH * 0.5;

/** Collinear controls keep Catmull-Rom smoothing flat along long plot edges. */
export const ROAD_BOUNDARY_SUPPORT_SPACING = 4.25;

const SHARED_EDGE_QUANTIZATION = 0.05;
const MIN_EDGE_LENGTH = 1e-5;
const CORNER_ARC_CONTROL_SPACING = 1.1;

export type RoadBoundarySnap = {
  zoneId: string;
  edgeIndex: number;
  point: Point2;
  distance: number;
  corners: readonly Point2[];
  outwardNormals: readonly Point2[];
  offset: number;
};

type BoundaryEdge = {
  zoneId: string;
  edgeIndex: number;
  start: Point2;
  end: Point2;
  railStart: Point2;
  railEnd: Point2;
  corners: readonly Point2[];
  outwardNormals: readonly Point2[];
};

/**
 * Find the nearest outward, parallel road-center rail around a burgage zone.
 * Exact shared zone edges are omitted so roads do not magnetize into the seam
 * between adjoining residence blocks.
 */
export function findRoadBoundarySnap(
  point: Point2,
  zones: Iterable<BurgageZoneState>,
  maxDistance = ROAD_BOUNDARY_SNAP_DISTANCE,
  offset = ROAD_BOUNDARY_CENTERLINE_OFFSET,
): RoadBoundarySnap | null {
  const edges = collectBoundaryEdges(zones, Math.max(0, offset));
  if (edges.length === 0) return null;

  const edgeCounts = new Map<string, number>();
  for (const edge of edges) {
    const key = undirectedEdgeKey(edge.start, edge.end);
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  let best: RoadBoundarySnap | null = null;
  const reach = Math.max(0, maxDistance);
  for (const edge of edges) {
    if ((edgeCounts.get(undirectedEdgeKey(edge.start, edge.end)) ?? 0) > 1) continue;
    const projected = closestPointOnSegment(point, edge.railStart, edge.railEnd);
    const distance = Math.hypot(projected.x - point.x, projected.z - point.z);
    if (distance > reach || (best && distance >= best.distance)) continue;
    best = {
      zoneId: edge.zoneId,
      edgeIndex: edge.edgeIndex,
      point: projected,
      distance,
      corners: edge.corners,
      outwardNormals: edge.outwardNormals,
      offset: Math.max(0, offset),
    };
  }
  return best;
}

/**
 * Expand two snaps on the same perimeter into spline controls. Same-edge runs
 * receive collinear supports; adjacent edges receive a short constant-radius
 * turn around their shared plot corner. Opposite or unrelated edges are left
 * to the player's authored straight segment.
 */
export function buildRoadBoundaryPath(
  start: RoadBoundarySnap,
  end: RoadBoundarySnap,
  supportSpacing = ROAD_BOUNDARY_SUPPORT_SPACING,
): Point2[] | null {
  if (start.zoneId !== end.zoneId) return null;
  if (start.corners.length !== end.corners.length || start.corners.length < 3) return null;
  if (start.edgeIndex === end.edgeIndex) {
    return subdividePolylineSegment(start.point, end.point, supportSpacing);
  }

  const edgeCount = start.corners.length;
  const forward = end.edgeIndex === (start.edgeIndex + 1) % edgeCount;
  const backward = start.edgeIndex === (end.edgeIndex + 1) % edgeCount;
  if (!forward && !backward) return null;

  const cornerIndex = forward ? end.edgeIndex : start.edgeIndex;
  const corner = start.corners[cornerIndex];
  const startNormal = start.outwardNormals[start.edgeIndex];
  const endNormal = start.outwardNormals[end.edgeIndex];
  if (!corner || !startNormal || !endNormal) return null;

  const radius = Math.max(0, Math.min(start.offset, end.offset));
  if (radius <= MIN_EDGE_LENGTH) return null;
  const arcStart = addScaled(corner, startNormal, radius);
  const arcEnd = addScaled(corner, endNormal, radius);
  const result = subdividePolylineSegment(start.point, arcStart, supportSpacing);
  appendCornerArc(result, corner, startNormal, endNormal, radius);
  appendSubdividedSegment(result, arcEnd, end.point, supportSpacing);
  return result;
}

function collectBoundaryEdges(
  zones: Iterable<BurgageZoneState>,
  offset: number,
): BoundaryEdge[] {
  const edges: BoundaryEdge[] = [];
  for (const zone of zones) {
    const corners = [zone.cornerA, zone.cornerB, zone.cornerC, zone.cornerD]
      .map((corner) => ({ x: corner.x, z: corner.z }));
    const winding = Math.sign(signedArea(corners));
    if (winding === 0) continue;
    const outwardNormals = corners.map((start, index) => {
      const end = corners[(index + 1) % corners.length];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length <= MIN_EDGE_LENGTH) return { x: 0, z: 0 };
      return winding > 0
        ? { x: dz / length, z: -dx / length }
        : { x: -dz / length, z: dx / length };
    });

    for (let edgeIndex = 0; edgeIndex < corners.length; edgeIndex += 1) {
      const start = corners[edgeIndex];
      const end = corners[(edgeIndex + 1) % corners.length];
      const normal = outwardNormals[edgeIndex];
      if (Math.hypot(end.x - start.x, end.z - start.z) <= MIN_EDGE_LENGTH) continue;
      edges.push({
        zoneId: zone.id,
        edgeIndex,
        start,
        end,
        railStart: addScaled(start, normal, offset),
        railEnd: addScaled(end, normal, offset),
        corners,
        outwardNormals,
      });
    }
  }
  return edges;
}

function appendCornerArc(
  result: Point2[],
  center: Point2,
  startNormal: Point2,
  endNormal: Point2,
  radius: number,
): void {
  const startAngle = Math.atan2(startNormal.z, startNormal.x);
  const signedTurn = Math.atan2(
    startNormal.x * endNormal.z - startNormal.z * endNormal.x,
    startNormal.x * endNormal.x + startNormal.z * endNormal.z,
  );
  const segments = Math.max(
    3,
    Math.ceil(Math.abs(signedTurn) * radius / CORNER_ARC_CONTROL_SPACING),
  );
  for (let index = 1; index <= segments; index += 1) {
    const angle = startAngle + signedTurn * index / segments;
    pushUnique(result, {
      x: center.x + Math.cos(angle) * radius,
      z: center.z + Math.sin(angle) * radius,
    });
  }
}

function subdividePolylineSegment(
  start: Point2,
  end: Point2,
  spacing: number,
): Point2[] {
  const result: Point2[] = [{ ...start }];
  appendSubdividedSegment(result, start, end, spacing);
  return result;
}

function appendSubdividedSegment(
  result: Point2[],
  start: Point2,
  end: Point2,
  spacing: number,
): void {
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  const divisions = Math.max(1, Math.ceil(length / Math.max(0.25, spacing)));
  for (let index = 1; index <= divisions; index += 1) {
    const t = index / divisions;
    pushUnique(result, {
      x: start.x + (end.x - start.x) * t,
      z: start.z + (end.z - start.z) * t,
    });
  }
}

function pushUnique(points: Point2[], point: Point2): void {
  const last = points[points.length - 1];
  if (last && Math.hypot(last.x - point.x, last.z - point.z) <= 1e-5) return;
  points.push(point);
}

function addScaled(point: Point2, direction: Point2, scale: number): Point2 {
  return {
    x: point.x + direction.x * scale,
    z: point.z + direction.z * scale,
  };
}

function closestPointOnSegment(point: Point2, start: Point2, end: Point2): Point2 {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq <= MIN_EDGE_LENGTH * MIN_EDGE_LENGTH
    ? 0
    : Math.max(0, Math.min(1, (
      (point.x - start.x) * dx + (point.z - start.z) * dz
    ) / lengthSq));
  return { x: start.x + dx * t, z: start.z + dz * t };
}

function signedArea(points: readonly Point2[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.z - next.x * points[index].z;
  }
  return area * 0.5;
}

function undirectedEdgeKey(start: Point2, end: Point2): string {
  const first = quantizedPointKey(start);
  const second = quantizedPointKey(end);
  return first <= second ? `${first}|${second}` : `${second}|${first}`;
}

function quantizedPointKey(point: Point2): string {
  return `${Math.round(point.x / SHARED_EDGE_QUANTIZATION)},${Math.round(point.z / SHARED_EDGE_QUANTIZATION)}`;
}
