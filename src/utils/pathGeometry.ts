import * as THREE from 'three';

export type PointXZ = { x: number; z: number };
export type PolylineSampleXZ = PointXZ & { yaw: number };

export function polylineLengthXZ(path: readonly PointXZ[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
  }
  return total;
}

export function samplePolylineXZ(
  path: readonly PointXZ[],
  distance: number,
  target?: PolylineSampleXZ,
): PolylineSampleXZ | null {
  if (path.length === 0) return null;
  if (path.length === 1) {
    const sample = target ?? { x: 0, z: 0, yaw: 0 };
    sample.x = path[0].x;
    sample.z = path[0].z;
    sample.yaw = 0;
    return sample;
  }

  let remaining = Math.max(0, distance);
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segmentLength = Math.hypot(b.x - a.x, b.z - a.z);
    if (segmentLength <= 1e-6) continue;
    if (remaining <= segmentLength + 1e-6) {
      const t = remaining / segmentLength;
      const sample = target ?? { x: 0, z: 0, yaw: 0 };
      sample.x = a.x + (b.x - a.x) * t;
      sample.z = a.z + (b.z - a.z) * t;
      sample.yaw = Math.atan2(b.x - a.x, b.z - a.z);
      return sample;
    }
    remaining -= segmentLength;
  }

  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  const sample = target ?? { x: 0, z: 0, yaw: 0 };
  sample.x = last.x;
  sample.z = last.z;
  sample.yaw = Math.atan2(last.x - prev.x, last.z - prev.z);
  return sample;
}

export type RockObstacle = {
  x: number;
  z: number;
  scale: number;
  /** Optional visual-derived collision radius for first-person movement. */
  collisionRadius?: number;
  /** Optional visual-derived bottom/top, in world-space metres. */
  collisionMinY?: number;
  collisionMaxY?: number;
};

export function setRockObstacleCollisionBounds(
  rock: RockObstacle,
  geometry: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4,
): void {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingBox) return;
  const bounds = geometry.boundingBox.clone().applyMatrix4(worldMatrix);
  rock.collisionRadius = Math.max(
    Math.abs(bounds.min.x - rock.x),
    Math.abs(bounds.max.x - rock.x),
    Math.abs(bounds.min.z - rock.z),
    Math.abs(bounds.max.z - rock.z),
  );
  rock.collisionMinY = bounds.min.y;
  rock.collisionMaxY = bounds.max.y;
}

export function distancePointToPolylineXZ(x: number, z: number, path: THREE.Vector3[]): number {
  let minDistance = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    minDistance = Math.min(minDistance, distancePointToSegmentXZ(x, z, path[i], path[i + 1]));
  }
  return minDistance;
}

export function distancePointToSegmentXZ(x: number, z: number, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq <= 1e-6 ? 0 : THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / lengthSq, 0, 1);
  const px = a.x + abx * t;
  const pz = a.z + abz * t;
  return Math.hypot(x - px, z - pz);
}

export function isRockNearPath(
  rock: RockObstacle,
  path: THREE.Vector3[],
  roadHalfWidth: number,
  margin = 0.8,
): boolean {
  const rockRadius = rock.scale * 1.35;
  const threshold = roadHalfWidth + rockRadius + margin;
  return distancePointToPolylineXZ(rock.x, rock.z, path) <= threshold;
}

export type PathBoundsXZ = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export function computePathBoundsXZ(path: THREE.Vector3[], padding: number): PathBoundsXZ {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of path) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.z < minZ) minZ = point.z;
    if (point.z > maxZ) maxZ = point.z;
  }
  return {
    minX: minX - padding,
    maxX: maxX + padding,
    minZ: minZ - padding,
    maxZ: maxZ + padding,
  };
}

export function isPointInsideBoundsXZ(x: number, z: number, bounds: PathBoundsXZ): boolean {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

export function downsamplePath(
  path: THREE.Vector3[],
  minSpacing: number,
  out?: THREE.Vector3[],
): THREE.Vector3[] {
  if (path.length <= 2) return path;

  if (out) {
    out.length = 0;
    out.push(path[0]);
    let last = path[0];
    for (let i = 1; i < path.length; i++) {
      const point = path[i];
      const isLast = i === path.length - 1;
      if (isLast || Math.hypot(point.x - last.x, point.z - last.z) >= minSpacing) {
        out.push(point);
        last = point;
      }
    }
    return out;
  }

  const result = [path[0]];
  let last = path[0];
  for (let i = 1; i < path.length; i++) {
    const point = path[i];
    const isLast = i === path.length - 1;
    if (isLast || Math.hypot(point.x - last.x, point.z - last.z) >= minSpacing) {
      result.push(point);
      last = point;
    }
  }
  return result;
}
