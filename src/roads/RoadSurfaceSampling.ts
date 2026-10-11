import * as THREE from 'three';
import type { RoadEdge } from './RoadEdge.ts';

type RoadSurfaceEdge = Pick<RoadEdge, 'width' | 'controlPoints' | 'sampledPath' | 'surfacePath'>;

type SurfaceSegment = { a: THREE.Vector3; b: THREE.Vector3; edge: SurfaceEdge };
type SurfaceEdge = { widthSq: number; stamp: number; distanceSq: number; y: number };

/** Immutable geometry snapshot, rebuilt only after road edits or bridge rebuilds. */
export class RoadSurfaceIndex {
  private readonly cells = new Map<string, SurfaceSegment[]>();
  private readonly touched: SurfaceEdge[] = [];
  private stamp = 0;
  private static readonly CELL_SIZE = 16;

  constructor(edges: Iterable<RoadSurfaceEdge>) {
    for (const source of edges) {
      const path = roadSurfacePath(source);
      const radius = source.width * 0.52;
      const edge: SurfaceEdge = { widthSq: radius * radius, stamp: -1, distanceSq: Infinity, y: 0 };
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]; const b = path[i];
        const segment = { a, b, edge };
        const minX = Math.floor((Math.min(a.x, b.x) - radius) / RoadSurfaceIndex.CELL_SIZE);
        const maxX = Math.floor((Math.max(a.x, b.x) + radius) / RoadSurfaceIndex.CELL_SIZE);
        const minZ = Math.floor((Math.min(a.z, b.z) - radius) / RoadSurfaceIndex.CELL_SIZE);
        const maxZ = Math.floor((Math.max(a.z, b.z) + radius) / RoadSurfaceIndex.CELL_SIZE);
        for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) {
          const key = `${cx},${cz}`;
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(segment); else this.cells.set(key, [segment]);
        }
      }
    }
  }

  sample(x: number, z: number): number | null {
    const bucket = this.cells.get(`${Math.floor(x / RoadSurfaceIndex.CELL_SIZE)},${Math.floor(z / RoadSurfaceIndex.CELL_SIZE)}`);
    if (!bucket) return null;
    this.stamp++;
    this.touched.length = 0;
    for (const { a, b, edge } of bucket) {
      const dx = b.x - a.x; const dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq <= 1e-6 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq));
      const px = x - (a.x + dx * t); const pz = z - (a.z + dz * t);
      const distanceSq = px * px + pz * pz;
      if (edge.stamp !== this.stamp) {
        edge.stamp = this.stamp; edge.distanceSq = Infinity; this.touched.push(edge);
      }
      if (distanceSq >= edge.distanceSq) continue;
      edge.distanceSq = distanceSq; edge.y = THREE.MathUtils.lerp(a.y, b.y, t);
    }
    let best: number | null = null;
    for (const edge of this.touched) {
      if (edge.distanceSq > edge.widthSq) continue;
      best = best == null ? edge.y : Math.max(best, edge.y);
    }
    return best;
  }
}

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
