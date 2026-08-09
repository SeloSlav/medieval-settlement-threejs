import * as THREE from 'three';

export type RoadPlacementFailureReason = 'too_short';

export type RoadPlacementResult =
  | { ok: true }
  | { ok: false; reason: RoadPlacementFailureReason };

export function validateRoadPlacement(
  points: THREE.Vector3[],
  minCommitLength: number,
): RoadPlacementResult {
  if (points.length < 2) return { ok: false, reason: 'too_short' };
  if (pathLength(points) < minCommitLength) return { ok: false, reason: 'too_short' };

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
