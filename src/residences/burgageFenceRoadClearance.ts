import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import { BURGAGE_ROAD_SETBACK } from './burgageFrontagePath.ts';

type Segment = readonly [Point2, Point2];
type Interval = [number, number];
const EPSILON = 1e-8;

/**
 * Subtract the logical road surface plus the frontage setback from fence runs.
 * The setback also keeps timber thickness and rail/gate overhangs off the road.
 * Capsule intersections are analytic: even a short/grazing crossing between
 * two clear endpoints must be removed before terrain bays and posts are built.
 */
export function createBurgageFenceRoadClipper(roads: RoadNetwork): {
  clip: (segment: Segment) => Segment[];
  isClear: (segment: Segment) => boolean;
} {
  const index = roads.getSpatialIndex();
  let maxRadius = 0;
  for (const edge of roads.edges.values()) {
    maxRadius = Math.max(maxRadius, edge.width * 0.5 + BURGAGE_ROAD_SETBACK);
  }

  function blockedIntervals([start, end]: Segment): Interval[] {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSq = dx * dx + dz * dz;
    if (lengthSq <= EPSILON) return [];
    const candidates = index.collectSnapCandidates(
      (start.x + end.x) * 0.5,
      (start.z + end.z) * 0.5,
      Math.sqrt(lengthSq) * 0.5 + maxRadius,
    );
    const intervals: Interval[] = [];
    for (const edge of candidates.edges) {
      // Leave a fence exactly on the snapped verge untouched despite roundoff.
      const radius = edge.halfWidth + BURGAGE_ROAD_SETBACK - EPSILON;
      for (let i = 1; i < edge.path.length; i++) {
        const a = edge.path[i - 1];
        const b = edge.path[i];
        if (
          Math.max(start.x, end.x) < Math.min(a.x, b.x) - radius
          || Math.min(start.x, end.x) > Math.max(a.x, b.x) + radius
          || Math.max(start.z, end.z) < Math.min(a.z, b.z) - radius
          || Math.min(start.z, end.z) > Math.max(a.z, b.z) + radius
        ) continue;

        addCircleInterval(intervals, start, dx, dz, lengthSq, a, radius);
        addCircleInterval(intervals, start, dx, dz, lengthSq, b, radius);
        const roadLength = Math.hypot(b.x - a.x, b.z - a.z);
        if (roadLength <= EPSILON) continue;
        const ux = (b.x - a.x) / roadLength;
        const uz = (b.z - a.z) / roadLength;
        const offsetX = start.x - a.x;
        const offsetZ = start.z - a.z;
        const along = linearInterval(offsetX * ux + offsetZ * uz, dx * ux + dz * uz, 0, roadLength);
        const across = linearInterval(-offsetX * uz + offsetZ * ux, -dx * uz + dz * ux, -radius, radius);
        if (along && across) {
          addInterval(intervals, Math.max(along[0], across[0]), Math.min(along[1], across[1]));
        }
      }
    }
    return intervals;
  }

  return {
    isClear: (segment) => blockedIntervals(segment).length === 0,
    clip: (segment) => {
      const blocked = blockedIntervals(segment).sort((a, b) => a[0] - b[0]);
      if (blocked.length === 0) return [segment];
      const result: Segment[] = [];
      let cursor = 0;
      for (const [start, end] of blocked) {
        if (start > cursor + EPSILON) {
          result.push([pointAt(segment, cursor), pointAt(segment, start)]);
        }
        cursor = Math.max(cursor, end);
        if (cursor >= 1) break;
      }
      if (cursor < 1 - EPSILON) result.push([pointAt(segment, cursor), segment[1]]);
      return result;
    },
  };
}

function pointAt([start, end]: Segment, t: number): Point2 {
  return { x: start.x + (end.x - start.x) * t, z: start.z + (end.z - start.z) * t };
}

function addInterval(intervals: Interval[], start: number, end: number): void {
  const lo = Math.max(0, start);
  const hi = Math.min(1, end);
  if (hi > lo + EPSILON) intervals.push([lo, hi]);
}

function linearInterval(origin: number, delta: number, min: number, max: number): Interval | null {
  if (Math.abs(delta) <= EPSILON) return origin > min && origin < max ? [0, 1] : null;
  const a = (min - origin) / delta;
  const b = (max - origin) / delta;
  return [Math.min(a, b), Math.max(a, b)];
}

function addCircleInterval(
  intervals: Interval[],
  start: Point2,
  dx: number,
  dz: number,
  lengthSq: number,
  center: Point2,
  radius: number,
): void {
  const ox = start.x - center.x;
  const oz = start.z - center.z;
  const t = -(ox * dx + oz * dz) / lengthSq;
  const closestX = ox + dx * t;
  const closestZ = oz + dz * t;
  const remaining = radius * radius - closestX * closestX - closestZ * closestZ;
  if (remaining <= 0) return;
  const halfSpan = Math.sqrt(remaining / lengthSq);
  addInterval(intervals, t - halfSpan, t + halfSpan);
}
