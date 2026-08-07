import type { Point2 } from '../utils/polygonGeometry.ts';
import { polygonCentroid2 } from '../utils/polygonGeometry.ts';

export type OrganicParcelEdgeOptions = {
  seed: number;
  spacing?: number;
  amplitude?: number;
  inwardTarget?: Point2;
};

export function hashParcelSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function noiseSigned(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (((value ^ (value >>> 15)) >>> 0) / 2_147_483_648) - 1;
}

/**
 * Adds restrained, deterministic hand-laid variation between two authored
 * corners. Endpoints never move, so the visual edge remains faithful to the
 * authoritative parcel used by placement and simulation.
 */
export function organicParcelEdgePoints(
  start: Point2,
  end: Point2,
  options: OrganicParcelEdgeOptions,
): Point2[] {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length <= 1e-5) return [{ ...start }];

  const spacing = Math.max(1.4, options.spacing ?? 4.2);
  const amplitude = Math.min(
    Math.max(0, options.amplitude ?? 0.28),
    length * 0.045,
  );
  const segmentCount = Math.max(1, Math.ceil(length / spacing));
  const normal = { x: -dz / length, z: dx / length };
  const midpoint = { x: (start.x + end.x) * 0.5, z: (start.z + end.z) * 0.5 };
  const inwardSign = options.inwardTarget
    ? Math.sign(
        (options.inwardTarget.x - midpoint.x) * normal.x
        + (options.inwardTarget.z - midpoint.z) * normal.z,
      ) || 1
    : 0;
  const phase = (options.seed % 1024) / 1024 * Math.PI * 2;
  const points: Point2[] = [];

  for (let index = 0; index <= segmentCount; index += 1) {
    const t = index / segmentCount;
    const envelope = Math.sin(Math.PI * t);
    const broadWave = Math.sin(t * Math.PI * 2 + phase) * 0.56;
    const fineWave = Math.sin(t * Math.PI * 5 - phase * 0.73) * 0.22;
    const grain = noiseSigned(options.seed, index) * 0.22;
    const signedVariation = broadWave + fineWave + grain;
    const offset = inwardSign === 0
      ? signedVariation * amplitude * envelope
      : inwardSign * amplitude * envelope * (0.36 + Math.abs(signedVariation) * 0.64);
    points.push({
      x: start.x + dx * t + normal.x * offset,
      z: start.z + dz * t + normal.z * offset,
    });
  }
  points[0] = { ...start };
  points[points.length - 1] = { ...end };
  return points;
}

export function organicParcelBoundaryPoints(
  corners: readonly Point2[],
  seed: number,
  options: Omit<OrganicParcelEdgeOptions, 'seed' | 'inwardTarget'> = {},
): Point2[] {
  if (corners.length < 3) return corners.map((point) => ({ ...point }));
  const center = polygonCentroid2([...corners]);
  const boundary: Point2[] = [];
  for (let edge = 0; edge < corners.length; edge += 1) {
    const points = organicParcelEdgePoints(
      corners[edge]!,
      corners[(edge + 1) % corners.length]!,
      {
        ...options,
        seed: (seed ^ Math.imul(edge + 1, 0x45d9f3b)) >>> 0,
        inwardTarget: center,
      },
    );
    boundary.push(...points.slice(0, -1));
  }
  return boundary;
}

export function polylineSegments(
  points: readonly Point2[],
  closeLoop = false,
): Array<readonly [Point2, Point2]> {
  const segments: Array<readonly [Point2, Point2]> = [];
  for (let index = 1; index < points.length; index += 1) {
    segments.push([points[index - 1]!, points[index]!]);
  }
  if (closeLoop && points.length >= 3) {
    segments.push([points[points.length - 1]!, points[0]!]);
  }
  return segments;
}

export function samplePolylineAtFraction(
  points: readonly Point2[],
  fraction: number,
): Point2 {
  if (points.length === 0) return { x: 0, z: 0 };
  if (points.length === 1) return { ...points[0]! };
  const lengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = Math.hypot(
      points[index]!.x - points[index - 1]!.x,
      points[index]!.z - points[index - 1]!.z,
    );
    lengths.push(length);
    totalLength += length;
  }
  if (totalLength <= 1e-6) return { ...points[0]! };
  const target = Math.max(0, Math.min(1, fraction)) * totalLength;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const segmentLength = lengths[index]!;
    if (traversed + segmentLength >= target || index === lengths.length - 1) {
      const t = segmentLength <= 1e-6 ? 0 : (target - traversed) / segmentLength;
      const start = points[index]!;
      const end = points[index + 1]!;
      return {
        x: start.x + (end.x - start.x) * t,
        z: start.z + (end.z - start.z) * t,
      };
    }
    traversed += segmentLength;
  }
  return { ...points[points.length - 1]! };
}
