import type { BurgageZoneState } from '../resources/types.ts';
import {
  convexPolygonsOverlap2,
  isConvexQuad2,
  type Point2,
} from '../utils/polygonGeometry.ts';
import { getZoneEdge, type BurgageZoneCorners } from './burgageLayout.ts';

/** Keep residence-land authoring as forgiving as the other parcel tools. */
export const BURGAGE_PLOT_SNAP_DISTANCE = 6;

const FRONTAGE_ENDPOINT_MATCH_EPSILON = 1e-5;

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

function pairedSideBoundaryCandidates(
  point: Point2,
  acceptedPoints: readonly Point2[],
  zones: Iterable<BurgageZoneState>,
): Point2[] {
  if (acceptedPoints.length !== 2 && acceptedPoints.length !== 3) return [];
  // Point C is paired with frontage B; point D is paired with frontage A.
  const frontageAnchor = acceptedPoints.length === 2
    ? acceptedPoints[1]
    : acceptedPoints[0];
  const candidates: Point2[] = [];

  for (const zone of zones) {
    const corners = [zone.cornerA, zone.cornerB, zone.cornerC, zone.cornerD];
    const frontageStartIndex = zone.frontageEdge;
    const frontageEndIndex = (frontageStartIndex + 1) % corners.length;
    const frontageStart = corners[frontageStartIndex];
    const frontageEnd = corners[frontageEndIndex];

    if (Math.hypot(
      frontageAnchor.x - frontageStart.x,
      frontageAnchor.z - frontageStart.z,
    ) <= FRONTAGE_ENDPOINT_MATCH_EPSILON) {
      candidates.push(closestPointOnSegment(
        point,
        frontageStart,
        corners[(frontageStartIndex + corners.length - 1) % corners.length],
      ));
    }
    if (Math.hypot(
      frontageAnchor.x - frontageEnd.x,
      frontageAnchor.z - frontageEnd.z,
    ) <= FRONTAGE_ENDPOINT_MATCH_EPSILON) {
      candidates.push(closestPointOnSegment(
        point,
        frontageEnd,
        corners[(frontageEndIndex + 1) % corners.length],
      ));
    }
  }

  return candidates;
}

/**
 * A new frontage may join an existing row at either end. Restricting frontage
 * snapping to endpoints avoids pulling a new zone into the middle of occupied
 * road frontage. Filter targets before choosing the nearest so an invalid
 * opposite-side endpoint cannot hide a valid same-side join.
 */
export function snapBurgageFrontagePoint(
  point: Point2,
  zones: Iterable<BurgageZoneState>,
  maxDistance = BURGAGE_PLOT_SNAP_DISTANCE,
  candidateFilter?: CandidateFilter,
): Point2 {
  const endpoints: Point2[] = [];
  for (const zone of zones) {
    endpoints.push(...getZoneEdge(zoneCorners(zone), zone.frontageEdge));
  }
  return nearestCandidate(point, endpoints, maxDistance, candidateFilter);
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
 * Keeps either rear corner coherent with the accepted frontage. When its
 * frontage anchor joined an existing row endpoint, prefer that row's matching
 * side boundary; on the final point, also reject any completed overlapping
 * quad.
 */
export function snapBurgageBoundaryDraftPoint(
  point: Point2,
  acceptedPoints: readonly Point2[],
  zones: Iterable<BurgageZoneState>,
  maxDistance = BURGAGE_PLOT_SNAP_DISTANCE,
  candidateFilter?: CandidateFilter,
): Point2 {
  const existingZones = [...zones];
  if (acceptedPoints.length !== 2 && acceptedPoints.length !== 3) {
    return snapBurgageBoundaryPoint(
      point,
      existingZones,
      maxDistance,
      candidateFilter,
    );
  }

  const acceptsCandidate = (candidate: Point2): boolean => {
    if (candidateFilter && !candidateFilter(candidate)) return false;
    if (acceptedPoints.length !== 3) return true;
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
  };

  let pairedCandidateAccepted = false;
  const paired = nearestCandidate(
    point,
    pairedSideBoundaryCandidates(point, acceptedPoints, existingZones),
    maxDistance,
    (candidate) => {
      const accepted = acceptsCandidate(candidate);
      pairedCandidateAccepted ||= accepted;
      return accepted;
    },
  );
  if (pairedCandidateAccepted) return paired;

  return nearestCandidate(
    point,
    boundaryCandidates(point, existingZones),
    maxDistance,
    acceptsCandidate,
  );
}
