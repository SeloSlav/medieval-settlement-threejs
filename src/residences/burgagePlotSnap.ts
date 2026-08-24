import type { BurgageZoneState } from '../resources/types.ts';
import {
  convexPolygonsOverlap2,
  isConvexQuad2,
  type Point2,
} from '../utils/polygonGeometry.ts';
import { getZoneEdge, type BurgageZoneCorners } from './burgageLayout.ts';

/** Keep residence-land authoring as forgiving as the other parcel tools. */
export const BURGAGE_PLOT_SNAP_DISTANCE = 6;

type CandidateFilter = (candidate: Point2) => boolean;

function zoneCorners(zone: BurgageZoneState): BurgageZoneCorners {
  return {
    a: zone.cornerA,
    b: zone.cornerB,
    c: zone.cornerC,
    d: zone.cornerD,
  };
}

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

function nearestCandidate(
  point: Point2,
  candidates: Iterable<Point2>,
  maxDistance: number,
  candidateFilter?: CandidateFilter,
): Point2 {
  let result = point;
  let bestDistance = Math.max(0, maxDistance);
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - point.x, candidate.z - point.z);
    if (distance > bestDistance) continue;
    if (candidateFilter && !candidateFilter(candidate)) continue;
    bestDistance = distance;
    result = candidate;
  }
  return { ...result };
}

function boundaryCandidates(point: Point2, zones: Iterable<BurgageZoneState>): Point2[] {
  const candidates: Point2[] = [];
  for (const zone of zones) {
    const corners = [zone.cornerA, zone.cornerB, zone.cornerC, zone.cornerD];
    for (let index = 0; index < corners.length; index += 1) {
      candidates.push(closestPointOnSegment(
        point,
        corners[index],
        corners[(index + 1) % corners.length],
      ));
    }
  }
  return candidates;
}

/**
 * A new frontage may join an existing row at either end. Restricting frontage
 * snapping to endpoints avoids pulling a new zone into the middle of occupied
 * road frontage, while the normal overlap check remains authoritative.
 */
export function snapBurgageFrontagePoint(
  point: Point2,
  zones: Iterable<BurgageZoneState>,
  maxDistance = BURGAGE_PLOT_SNAP_DISTANCE,
): Point2 {
  const endpoints: Point2[] = [];
  for (const zone of zones) {
    endpoints.push(...getZoneEdge(zoneCorners(zone), zone.frontageEdge));
  }
  return nearestCandidate(point, endpoints, maxDistance);
}

/** Magnetize a rear corner to the outer boundary of any existing burgage zone. */
export function snapBurgageBoundaryPoint(
  point: Point2,
  zones: Iterable<BurgageZoneState>,
  maxDistance = BURGAGE_PLOT_SNAP_DISTANCE,
  candidateFilter?: CandidateFilter,
): Point2 {
  return nearestCandidate(
    point,
    boundaryCandidates(point, zones),
    maxDistance,
    candidateFilter,
  );
}

/**
 * Keeps the final rear corner coherent with the accepted draft. A nearer edge
 * on the same zone must not win when it would pull the closing side through
 * that existing residence plot.
 */
export function snapBurgageBoundaryDraftPoint(
  point: Point2,
  acceptedPoints: readonly Point2[],
  zones: Iterable<BurgageZoneState>,
  maxDistance = BURGAGE_PLOT_SNAP_DISTANCE,
  candidateFilter?: CandidateFilter,
): Point2 {
  const existingZones = [...zones];
  if (acceptedPoints.length !== 3) {
    return snapBurgageBoundaryPoint(
      point,
      existingZones,
      maxDistance,
      candidateFilter,
    );
  }

  return nearestCandidate(
    point,
    boundaryCandidates(point, existingZones),
    maxDistance,
    (candidate) => {
      if (candidateFilter && !candidateFilter(candidate)) return false;
      const draft = [
        acceptedPoints[0],
        acceptedPoints[1],
        acceptedPoints[2],
        candidate,
      ];
      return isConvexQuad2(draft[0], draft[1], draft[2], draft[3])
        && existingZones.every((zone) => !convexPolygonsOverlap2(draft, [
          zone.cornerA,
          zone.cornerB,
          zone.cornerC,
          zone.cornerD,
        ]));
    },
  );
}
