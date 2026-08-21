import * as THREE from 'three';

export const DRY_STONE_WALL_SEED = 0x5e10_1550;
export const DRY_STONE_WALL_VARIANTS = 12;
export const DRY_STONE_WALL_SHOULDER_CLEARANCE = 0.78;

export type DryStoneWallState = {
  id: string;
  seed: number;
  controlPoints: Array<[number, number, number]>;
  sampledPath: Array<[number, number, number]>;
  length: number;
  revision: number;
};

export type DryStoneWallDebugMode = 'final' | 'courses' | 'variants' | 'moss-mask';
export type DryStoneWallQuality = 'preview' | 'final';

export type DryStonePlacement = {
  wallId: string;
  stoneIndex: number;
  course: 0 | 1;
  variant: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  height: number;
  depth: number;
  tone: number;
  warmth: number;
  moss: number;
};

export type DryStoneWallPlan = {
  wallId: string;
  seed: number;
  quality: DryStoneWallQuality;
  pathLength: number;
  stones: DryStonePlacement[];
  diagnostics: {
    courseCounts: readonly [number, number];
    variantCounts: readonly number[];
    mossStoneCount: number;
    minimumStoneWidth: number;
    maximumStoneWidth: number;
    approximateHeight: number;
  };
};

export type TerrainHeightSampler = {
  getHeightAt: (x: number, z: number) => number;
};

type PathSample = {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
};

const COURSE_PROFILE = [
  { start: 0.04, minWidth: 1.14, maxWidth: 1.82, minHeight: 0.55, maxHeight: 0.74, minDepth: 0.88, maxDepth: 1.08, y: -0.1 },
  { start: 0.47, minWidth: 0.92, maxWidth: 1.58, minHeight: 0.5, maxHeight: 0.68, minDepth: 0.72, maxDepth: 0.94, y: 0.5 },
] as const;

/**
 * Produces the inspectable semantic placement plan before any triangles or
 * instances are emitted. The two independent row walks create naturally
 * staggered joints instead of a repeated brick grid.
 */
export function createDryStoneWallPlan(
  wall: DryStoneWallState,
  terrain: TerrainHeightSampler,
  quality: DryStoneWallQuality = 'final',
): DryStoneWallPlan {
  const path = wall.sampledPath.map(tupleToVector);
  const pathLength = pathLengthXZ(path);
  const stones: DryStonePlacement[] = [];
  const courseCounts: [number, number] = [0, 0];
  const variantCounts = Array.from({ length: DRY_STONE_WALL_VARIANTS }, () => 0);
  let mossStoneCount = 0;
  let minimumStoneWidth = Number.POSITIVE_INFINITY;
  let maximumStoneWidth = 0;

  if (path.length >= 2 && pathLength >= 0.8) {
    for (const course of [0, 1] as const) {
      const profile = COURSE_PROFILE[course];
      const random = mulberry32(mixSeed(wall.seed, course + 1));
      let cursor = profile.start;
      while (cursor < pathLength - 0.22) {
        const proposedWidth = THREE.MathUtils.lerp(profile.minWidth, profile.maxWidth, random());
        const remaining = pathLength - cursor;
        const width = Math.min(proposedWidth, remaining);
        if (width < 0.52) break;

        const centerDistance = Math.min(pathLength, cursor + width * 0.5);
        const sample = sampleDryStoneWallPath(path, centerDistance);
        const normalX = -sample.tangent.z;
        const normalZ = sample.tangent.x;
        const height = THREE.MathUtils.lerp(profile.minHeight, profile.maxHeight, random());
        const depth = THREE.MathUtils.lerp(profile.minDepth, profile.maxDepth, random());
        const lateralJitter = (random() - 0.5) * (course === 0 ? 0.13 : 0.18);
        const baseY = foundationHeightAt(
          terrain,
          sample.point.x,
          sample.point.z,
          sample.tangent,
          Math.min(width * 0.36, 0.62),
        );
        const variant = Math.min(
          DRY_STONE_WALL_VARIANTS - 1,
          Math.floor(random() * DRY_STONE_WALL_VARIANTS),
        );
        const moss = quality === 'final'
          ? THREE.MathUtils.clamp((random() - (course === 1 ? 0.58 : 0.82)) * 2.35, 0, 1)
          : 0;
        const stone: DryStonePlacement = {
          wallId: wall.id,
          stoneIndex: stones.length,
          course,
          variant,
          x: sample.point.x + normalX * lateralJitter,
          y: baseY + profile.y + (random() - 0.5) * 0.035,
          z: sample.point.z + normalZ * lateralJitter,
          yaw: -Math.atan2(sample.tangent.z, sample.tangent.x) + (random() - 0.5) * 0.075,
          width,
          height,
          depth,
          tone: THREE.MathUtils.lerp(0.86, 1.08, random()),
          warmth: random() - 0.5,
          moss,
        };
        stones.push(stone);
        courseCounts[course] += 1;
        variantCounts[variant] += 1;
        if (moss > 0.05) mossStoneCount += 1;
        minimumStoneWidth = Math.min(minimumStoneWidth, width);
        maximumStoneWidth = Math.max(maximumStoneWidth, width);

        const gap = THREE.MathUtils.lerp(0.055, 0.12, random());
        cursor += width + gap;
      }
    }
  }

  return {
    wallId: wall.id,
    seed: wall.seed,
    quality,
    pathLength,
    stones,
    diagnostics: {
      courseCounts,
      variantCounts,
      mossStoneCount,
      minimumStoneWidth: Number.isFinite(minimumStoneWidth) ? minimumStoneWidth : 0,
      maximumStoneWidth,
      approximateHeight: 1.18,
    },
  };
}

export function pathLengthXZ(path: readonly THREE.Vector3[]): number {
  let length = 0;
  for (let index = 1; index < path.length; index += 1) {
    length += distanceXZ(path[index - 1], path[index]);
  }
  return length;
}

export function sampleDryStoneWallPath(
  path: readonly THREE.Vector3[],
  distance: number,
): PathSample {
  if (path.length < 2) {
    return {
      point: path[0]?.clone() ?? new THREE.Vector3(),
      tangent: new THREE.Vector3(1, 0, 0),
    };
  }
  const total = pathLengthXZ(path);
  const target = THREE.MathUtils.clamp(distance, 0, total);
  let walked = 0;
  for (let index = 0; index < path.length - 1; index += 1) {
    const a = path[index];
    const b = path[index + 1];
    const segmentLength = distanceXZ(a, b);
    if (segmentLength <= 1e-5) continue;
    if (walked + segmentLength >= target || index === path.length - 2) {
      const t = THREE.MathUtils.clamp((target - walked) / segmentLength, 0, 1);
      return {
        point: new THREE.Vector3().lerpVectors(a, b, t),
        tangent: new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize(),
      };
    }
    walked += segmentLength;
  }
  const last = path[path.length - 1];
  const previous = path[path.length - 2];
  return {
    point: last.clone(),
    tangent: new THREE.Vector3(last.x - previous.x, 0, last.z - previous.z).normalize(),
  };
}

export function dryStoneWallSeed(id: number, path: readonly THREE.Vector3[]): number {
  let seed = Math.imul(id ^ DRY_STONE_WALL_SEED, 0x45d9f3b);
  for (const point of path) {
    seed ^= Math.imul(Math.round(point.x * 10), 0x27d4eb2d);
    seed ^= Math.imul(Math.round(point.z * 10), 0x165667b1);
    seed = Math.imul(seed ^ (seed >>> 15), 0x7feb352d);
  }
  return seed >>> 0;
}

function foundationHeightAt(
  terrain: TerrainHeightSampler,
  x: number,
  z: number,
  tangent: THREE.Vector3,
  halfSpan: number,
): number {
  const center = terrain.getHeightAt(x, z);
  const before = terrain.getHeightAt(x - tangent.x * halfSpan, z - tangent.z * halfSpan);
  const after = terrain.getHeightAt(x + tangent.x * halfSpan, z + tangent.z * halfSpan);
  // Seat stones into the lower of the three samples; the small shoulder ring
  // hides any residual gap while retaining the stepped dry-wall silhouette.
  return Math.min(center, before, after) - 0.035;
}

function mixSeed(seed: number, salt: number): number {
  let value = seed ^ Math.imul(salt, 0x9e3779b9);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return value >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function tupleToVector(tuple: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}
