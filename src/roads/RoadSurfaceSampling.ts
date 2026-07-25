import * as THREE from 'three';
import type { RoadEdge } from './RoadEdge.ts';

type RoadSurfaceEdge = Pick<RoadEdge, 'width' | 'controlPoints' | 'sampledPath' | 'surfacePath'>;

/**
 * Samples the top of a displayed road in XZ. Bridge-aware `surfacePath` data is
 * preferred, while older/unbuilt edges gracefully fall back to their normal
 * sampled centerline.
 */
export function sampleRoadSurfaceY(
  edges: Iterable<RoadSurfaceEdge>,
  x: number,
  z: number,
): number | null {
  let best: number | null = null;
  for (const edge of edges) {
    const path = roadSurfacePath(edge);
    if (path.length < 2) continue;

    const projection = projectPointToPathXZ(x, z, path);
    if (projection.distance > edge.width * 0.52) continue;
    best = best == null ? projection.y : Math.max(best, projection.y);
  }
  return best;
}

/** Terrain remains authoritative anywhere it rises above a road surface. */
export function resolveRoadAwareGroundY(terrainY: number, roadSurfaceY: number | null): number {
  return roadSurfaceY == null ? terrainY : Math.max(terrainY, roadSurfaceY);
}

export function roadSurfacePath(edge: RoadSurfaceEdge): THREE.Vector3[] {
  if (edge.surfacePath && edge.surfacePath.length >= 2) return edge.surfacePath;
  if (edge.sampledPath.length >= 2) return edge.sampledPath;
  return edge.controlPoints;
}

function projectPointToPathXZ(
  x: number,
  z: number,
  path: THREE.Vector3[],
): { distance: number; y: number } {
  let bestDistance = Infinity;
  let bestY = path[0].y;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lengthSq = abx * abx + abz * abz;
    const t = lengthSq <= 1e-6
      ? 0
      : THREE.MathUtils.clamp(
        ((x - a.x) * abx + (z - a.z) * abz) / lengthSq,
        0,
        1,
      );
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const distance = Math.hypot(x - px, z - pz);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    bestY = THREE.MathUtils.lerp(a.y, b.y, t);
  }
  return { distance: bestDistance, y: bestY };
}
