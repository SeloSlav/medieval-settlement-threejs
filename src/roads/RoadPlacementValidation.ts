import * as THREE from 'three';

export type RoadPlacementFailureReason = 'too_steep' | 'too_short';

export type RoadPlacementResult =
  | { ok: true }
  | { ok: false; reason: RoadPlacementFailureReason };

const MAX_SEGMENT_SLOPE = 0.45;

export function validateRoadPlacement(
  points: THREE.Vector3[],
  minCommitLength: number,
): RoadPlacementResult {
  if (points.length < 2) return { ok: false, reason: 'too_short' };
  if (pathLength(points) < minCommitLength) return { ok: false, reason: 'too_short' };

  for (let i = 1; i < points.length; i++) {
    const dxz = distanceXZ(points[i - 1], points[i]);
    const dy = Math.abs(points[i].y - points[i - 1].y);
    if (dxz > 0.1 && dy / dxz > MAX_SEGMENT_SLOPE) return { ok: false, reason: 'too_steep' };
  }

  return { ok: true };
}

export function isRoadPlacementValid(
  points: THREE.Vector3[],
  minCommitLength: number,
): boolean {
  return validateRoadPlacement(points, minCommitLength).ok;
}

function pathLength(points: THREE.Vector3[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += distanceXZ(points[i - 1], points[i]);
  return length;
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
