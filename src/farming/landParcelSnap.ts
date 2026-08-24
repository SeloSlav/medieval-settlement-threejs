import {
  convexPolygonsOverlap2,
  type Point2,
} from '../utils/polygonGeometry.ts';
import {
  isValidFarmFieldCorners,
  type FarmFieldCorners,
} from './farmFieldMath.ts';

/** Matches the forgiving magnetic range used while authoring residence land. */
export const LAND_PARCEL_SNAP_DISTANCE = 6;

/** Slightly favor vertices when two adjacent edge projections compete near a corner. */
const LAND_PARCEL_CORNER_PRIORITY_BIAS = 1.5;

function closestPointOnSegment(point: Point2, start: Point2, end: Point2): Point2 {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 1e-9) return { ...start };
  const t = Math.max(0, Math.min(1, (
    (point.x - start.x) * dx + (point.z - start.z) * dz
  ) / lengthSq));
  return { x: start.x + dx * t, z: start.z + dz * t };
}

type CandidateFilter = (candidate: Point2) => boolean;

function snapToNearestLandParcelBoundary(
  point: Point2,
  linkedParcels: Iterable<FarmFieldCorners>,
  maxDistance: number,
  candidateFilter?: CandidateFilter,
): Point2 {
  let edgeSnap = point;
  let bestEdgeDistance = Math.max(0, maxDistance);
  let cornerSnap: Point2 | null = null;
  let bestCornerDistance = Math.max(0, maxDistance);
  for (const corners of linkedParcels) {
    for (const corner of corners) {
      const distance = Math.hypot(corner.x - point.x, corner.z - point.z);
      if (distance > bestCornerDistance) continue;
      if (candidateFilter && !candidateFilter(corner)) continue;
      bestCornerDistance = distance;
      cornerSnap = corner;
    }
    for (let index = 0; index < corners.length; index += 1) {
      const candidate = closestPointOnSegment(
        point,
        corners[index],
        corners[(index + 1) % corners.length],
      );
      const distance = Math.hypot(candidate.x - point.x, candidate.z - point.z);
      if (distance > bestEdgeDistance) continue;
      if (candidateFilter && !candidateFilter(candidate)) continue;
      bestEdgeDistance = distance;
      edgeSnap = candidate;
    }
  }
  if (
    cornerSnap
    && bestCornerDistance <= bestEdgeDistance + LAND_PARCEL_CORNER_PRIORITY_BIAS
  ) {
    return { ...cornerSnap };
  }
  return { ...edgeSnap };
}

/**
 * Magnetically joins a drawn corner to the nearest boundary of a parcel owned
 * by the same originating building. Placement remains free-form when no
 * boundary lies within range.
 */
export function snapLandParcelPoint(
  point: Point2,
  linkedParcels: Iterable<FarmFieldCorners>,
  maxDistance = LAND_PARCEL_SNAP_DISTANCE,
): Point2 {
  return snapToNearestLandParcelBoundary(point, linkedParcels, maxDistance);
}

/**
 * Snaps the final corner without letting an independently chosen boundary
 * projection pull the closing edge through an existing linked parcel.
 */
export function snapLandParcelDraftPoint(
  point: Point2,
  acceptedPoints: readonly Point2[],
  linkedParcels: Iterable<FarmFieldCorners>,
  maxDistance = LAND_PARCEL_SNAP_DISTANCE,
): Point2 {
  const parcels = [...linkedParcels];
  if (acceptedPoints.length !== 3) {
    return snapLandParcelPoint(point, parcels, maxDistance);
  }

  return snapToNearestLandParcelBoundary(
    point,
    parcels,
    maxDistance,
    (candidate) => {
      const draft: FarmFieldCorners = [
        acceptedPoints[0],
        acceptedPoints[1],
        acceptedPoints[2],
        candidate,
      ];
      return isValidFarmFieldCorners(draft)
        && parcels.every((parcel) => !convexPolygonsOverlap2(draft, parcel));
    },
  );
}
