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

/** Maximum gap bridged from a parallel residence rail into a snapped road. */
export const ROAD_BOUNDARY_ROAD_HANDOFF_DISTANCE = 14;

const SHARED_EDGE_QUANTIZATION = 0.05;
const MIN_EDGE_LENGTH = 1e-5;
const CORNER_ARC_CONTROL_SPACING = 1.1;
const THREE_DEGREES_30 = Math.PI / 6;
const ROAD_PARALLEL_ALIGNMENT_COSINE = Math.cos(THREE_DEGREES_30);

export type RoadBoundarySnap = {
  zoneId: string;
  edgeIndex: number;
  point: Point2;
  distance: number;
  corners: readonly Point2[];
  outwardNormals: readonly Point2[];
  offset: number;
};

export type RoadAlignmentTarget = {
  point: Point2;
  tangents: readonly Point2[];
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
 * receive collinear supports. Different edges follow the shorter of the two
 * outside perimeter routes, with constant-radius controls around every crossed
 * corner. This matters when a click near either end of a rear boundary is
 * classified against the adjoining side edge rather than the rear edge itself.
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

  const forward = buildDirectionalBoundaryPath(start, end, 1, supportSpacing);
  const backward = buildDirectionalBoundaryPath(start, end, -1, supportSpacing);
  if (!forward) return backward;
  if (!backward) return forward;
  return polylineLength(forward) <= polylineLength(backward) ? forward : backward;
}

/**
 * Route a boundary-snapped road into an existing road snap without cutting
 * diagonally across the residence block. The handoff selects a nearby plot
 * edge parallel to the snapped road, follows the shorter outside perimeter to
 * it, then makes only the final short connection into the road point.
 */
export function buildRoadBoundaryToRoadPath(
  start: RoadBoundarySnap,
  target: RoadAlignmentTarget,
  supportSpacing = ROAD_BOUNDARY_SUPPORT_SPACING,
  maxHandoffDistance = ROAD_BOUNDARY_ROAD_HANDOFF_DISTANCE,
): Point2[] | null {
  const edgeCount = start.corners.length;
  if (edgeCount < 3 || start.outwardNormals.length !== edgeCount) return null;
  const tangents = target.tangents
    .map(normalizePoint)
    .filter((tangent) => Math.hypot(tangent.x, tangent.z) > MIN_EDGE_LENGTH);
  if (tangents.length === 0) return null;

  let best: { path: Point2[]; score: number } | null = null;
  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    const edgeStart = start.corners[edgeIndex];
    const edgeEnd = start.corners[(edgeIndex + 1) % edgeCount];
    const normal = start.outwardNormals[edgeIndex];
    if (!edgeStart || !edgeEnd || !normal) continue;
    const edgeDirection = normalizePoint({
      x: edgeEnd.x - edgeStart.x,
      z: edgeEnd.z - edgeStart.z,
    });
    const alignment = tangents.reduce(
      (maximum, tangent) => Math.max(maximum, Math.abs(
        edgeDirection.x * tangent.x + edgeDirection.z * tangent.z
      )),
      0,
    );
    if (alignment < ROAD_PARALLEL_ALIGNMENT_COSINE) continue;

    const railStart = addScaled(edgeStart, normal, start.offset);
    const railEnd = addScaled(edgeEnd, normal, start.offset);
    const handoffPoint = closestPointOnSegment(target.point, railStart, railEnd);
    const handoffDistance = Math.hypot(
      handoffPoint.x - target.point.x,
      handoffPoint.z - target.point.z,
    );
    if (handoffDistance > Math.max(0, maxHandoffDistance)) continue;

    const handoffSnap: RoadBoundarySnap = {
      ...start,
      edgeIndex,
      point: handoffPoint,
      distance: handoffDistance,
    };
    const path = buildRoadBoundaryPath(start, handoffSnap, supportSpacing);
    if (!path) continue;
    appendSubdividedSegment(
      path,
      path[path.length - 1],
      target.point,
      supportSpacing,
    );
    const score = polylineLength(path) + (1 - alignment) * 8;
    if (!best || score < best.score) best = { path, score };
  }
  return best?.path ?? null;
}

function buildDirectionalBoundaryPath(
  start: RoadBoundarySnap,
  end: RoadBoundarySnap,
  direction: 1 | -1,
  supportSpacing: number,
): Point2[] | null {
  const edgeCount = start.corners.length;
  if (start.outwardNormals.length !== edgeCount) return null;
  const radius = Math.max(0, Math.min(start.offset, end.offset));
  if (radius <= MIN_EDGE_LENGTH) return null;

  const result: Point2[] = [{ ...start.point }];
  let edgeIndex = start.edgeIndex;
  for (let step = 0; step < edgeCount && edgeIndex !== end.edgeIndex; step += 1) {
    const nextEdgeIndex = modulo(edgeIndex + direction, edgeCount);
    const cornerIndex = direction > 0 ? nextEdgeIndex : edgeIndex;
    const corner = start.corners[cornerIndex];
    const currentNormal = start.outwardNormals[edgeIndex];
    const nextNormal = start.outwardNormals[nextEdgeIndex];
    if (!corner || !currentNormal || !nextNormal) return null;

    const currentTangent = addScaled(corner, currentNormal, radius);
    appendSubdividedSegment(
      result,
      result[result.length - 1],
      currentTangent,
      supportSpacing,
    );
    appendCornerArc(result, corner, currentNormal, nextNormal, radius);
    edgeIndex = nextEdgeIndex;
  }

  if (edgeIndex !== end.edgeIndex) return null;
  appendSubdividedSegment(
    result,
    result[result.length - 1],
    end.point,
    supportSpacing,
  );
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

function normalizePoint(point: Point2): Point2 {
  const length = Math.hypot(point.x, point.z);
  if (length <= MIN_EDGE_LENGTH) return { x: 0, z: 0 };
  return { x: point.x / length, z: point.z / length };
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

function polylineLength(points: readonly Point2[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].z - points[index - 1].z,
    );
  }
  return length;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function undirectedEdgeKey(start: Point2, end: Point2): string {
  const first = quantizedPointKey(start);
  const second = quantizedPointKey(end);
  return first <= second ? `${first}|${second}` : `${second}|${first}`;
}

function quantizedPointKey(point: Point2): string {
  return `${Math.round(point.x / SHARED_EDGE_QUANTIZATION)},${Math.round(point.z / SHARED_EDGE_QUANTIZATION)}`;
}
