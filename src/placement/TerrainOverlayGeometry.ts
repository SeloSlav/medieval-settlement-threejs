import * as THREE from 'three';
import type { Point2 } from '../utils/polygonGeometry.ts';

export type TerrainOverlaySegment = readonly [Point2, Point2];

export type TerrainRibbonOptions = {
  width: number;
  lift: number;
  sampleSpacing?: number;
  dashLength?: number;
  gapLength?: number;
};

export type TerrainCircleRibbonOptions = TerrainRibbonOptions & {
  segmentCount?: number;
};

export type TerrainCircleFillOptions = {
  lift: number;
  /** Approximate spacing between concentric terrain-sampled rings. */
  radialSpacing?: number;
  /** Optional fixed angular resolution; otherwise derived from circumference. */
  segmentCount?: number;
};

export function clearOverlayGeometry(geometry: THREE.BufferGeometry): void {
  if (geometry.getIndex() || geometry.getAttribute('position')) {
    // WebGPU caches GPU buffers by BufferAttribute identity. Invalidate that
    // cache before removing a live overlay's attributes.
    geometry.dispose();
  }
  geometry.setIndex(null);
  geometry.deleteAttribute('position');
  geometry.setDrawRange(0, 0);
  geometry.computeBoundingSphere();
}

export function updateTerrainQuadGeometry(
  geometry: THREE.BufferGeometry,
  corners: readonly [Point2, Point2, Point2, Point2],
  getHeightAt: (x: number, z: number) => number,
  lift: number,
  stepsU = 8,
  stepsV = 8,
): void {
  const columns = stepsU + 1;
  const rows = stepsV + 1;
  const positions = new Float32Array(columns * rows * 3);
  const indices: number[] = [];
  let offset = 0;

  for (let vStep = 0; vStep <= stepsV; vStep += 1) {
    const v = vStep / stepsV;
    for (let uStep = 0; uStep <= stepsU; uStep += 1) {
      const u = uStep / stepsU;
      const point = bilinearPoint(corners, u, v);
      positions[offset++] = point.x;
      positions[offset++] = getHeightAt(point.x, point.z) + lift;
      positions[offset++] = point.z;
    }
  }

  for (let v = 0; v < stepsV; v += 1) {
    for (let u = 0; u < stepsU; u += 1) {
      const a = v * columns + u;
      const b = a + 1;
      const d = (v + 1) * columns + u;
      const c = d + 1;
      indices.push(a, d, b, b, d, c);
    }
  }

  updateOverlayGeometry(geometry, positions, indices);
}

export function updateTerrainPolygonFanGeometry(
  geometry: THREE.BufferGeometry,
  polygon: readonly Point2[],
  getHeightAt: (x: number, z: number) => number,
  lift: number,
): void {
  if (polygon.length < 3) {
    clearOverlayGeometry(geometry);
    return;
  }

  const positions = new Float32Array(polygon.length * 3);
  const indices: number[] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const point = polygon[index]!;
    const offset = index * 3;
    positions[offset] = point.x;
    positions[offset + 1] = getHeightAt(point.x, point.z) + lift;
    positions[offset + 2] = point.z;
  }
  for (let index = 1; index < polygon.length - 1; index += 1) {
    indices.push(0, index, index + 1);
  }

  updateOverlayGeometry(geometry, positions, indices);
}

export function updateTerrainRibbonGeometry(
  geometry: THREE.BufferGeometry,
  segments: readonly TerrainOverlaySegment[],
  getHeightAt: (x: number, z: number) => number,
  options: TerrainRibbonOptions,
): void {
  const positions: number[] = [];
  const indices: number[] = [];
  const sampleSpacing = Math.max(0.35, options.sampleSpacing ?? 1.35);
  const halfWidth = Math.max(0.01, options.width * 0.5);
  const dashed = options.dashLength != null && options.gapLength != null;

  for (const [start, end] of segments) {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (length <= 1e-4) continue;

    const dirX = dx / length;
    const dirZ = dz / length;
    const normalX = -dirZ * halfWidth;
    const normalZ = dirX * halfWidth;
    const visibleRanges: Array<readonly [number, number]> = [];

    if (dashed) {
      const dashLength = Math.max(0.04, options.dashLength!);
      const gapLength = Math.max(0.03, options.gapLength!);
      const stride = dashLength + gapLength;
      for (let cursor = gapLength * 0.5; cursor < length; cursor += stride) {
        visibleRanges.push([cursor, Math.min(length, cursor + dashLength)]);
      }
    } else {
      visibleRanges.push([0, length]);
    }

    for (const [rangeStart, rangeEnd] of visibleRanges) {
      const visibleLength = rangeEnd - rangeStart;
      if (visibleLength <= 0.01) continue;
      const pieceCount = Math.max(1, Math.ceil(visibleLength / sampleSpacing));

      for (let piece = 0; piece < pieceCount; piece += 1) {
        const startDistance = THREE.MathUtils.lerp(
          rangeStart,
          rangeEnd,
          piece / pieceCount,
        );
        const endDistance = THREE.MathUtils.lerp(
          rangeStart,
          rangeEnd,
          (piece + 1) / pieceCount,
        );
        const startX = start.x + dirX * startDistance;
        const startZ = start.z + dirZ * startDistance;
        const endX = start.x + dirX * endDistance;
        const endZ = start.z + dirZ * endDistance;
        const quad = [
          { x: startX + normalX, z: startZ + normalZ },
          { x: startX - normalX, z: startZ - normalZ },
          { x: endX + normalX, z: endZ + normalZ },
          { x: endX - normalX, z: endZ - normalZ },
        ] as const;
        const vertexBase = positions.length / 3;

        for (const point of quad) {
          positions.push(
            point.x,
            getHeightAt(point.x, point.z) + options.lift,
            point.z,
          );
        }
        indices.push(
          vertexBase,
          vertexBase + 1,
          vertexBase + 2,
          vertexBase + 2,
          vertexBase + 1,
          vertexBase + 3,
        );
      }
    }
  }

  if (positions.length === 0) {
    clearOverlayGeometry(geometry);
    return;
  }

  updateOverlayGeometry(geometry, new Float32Array(positions), indices);
}

export function updateTerrainCircleRibbonGeometry(
  geometry: THREE.BufferGeometry,
  center: Point2,
  radius: number,
  getHeightAt: (x: number, z: number) => number,
  options: TerrainCircleRibbonOptions,
): void {
  if (!Number.isFinite(radius) || radius <= 0) {
    clearOverlayGeometry(geometry);
    return;
  }
  const circumference = Math.PI * 2 * radius;
  const segmentCount = Math.max(
    32,
    Math.floor(options.segmentCount ?? Math.min(128, Math.ceil(circumference / 7))),
  );
  const points = Array.from({ length: segmentCount }, (_, index) => {
    const angle = index / segmentCount * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radius,
      z: center.z + Math.sin(angle) * radius,
    };
  });
  updateTerrainRibbonGeometry(
    geometry,
    polygonSegments(points),
    getHeightAt,
    options,
  );
}

/**
 * Builds a terrain-following disk from concentric rings. A simple perimeter
 * fan is not sufficient for work areas that can span hills: its large central
 * triangles would visibly cut through relief instead of hugging the ground.
 */
export function updateTerrainCircleFillGeometry(
  geometry: THREE.BufferGeometry,
  center: Point2,
  radius: number,
  getHeightAt: (x: number, z: number) => number,
  options: TerrainCircleFillOptions,
): void {
  if (!Number.isFinite(radius) || radius <= 0) {
    clearOverlayGeometry(geometry);
    return;
  }

  const radialSpacing = Math.max(2.5, options.radialSpacing ?? 7);
  const ringCount = Math.max(1, Math.ceil(radius / radialSpacing));
  const circumference = Math.PI * 2 * radius;
  const segmentCount = Math.max(
    32,
    Math.floor(options.segmentCount ?? Math.min(160, Math.ceil(circumference / 6))),
  );
  const positions = new Float32Array((1 + ringCount * segmentCount) * 3);
  const indices: number[] = [];

  positions[0] = center.x;
  positions[1] = getHeightAt(center.x, center.z) + options.lift;
  positions[2] = center.z;

  for (let ring = 1; ring <= ringCount; ring += 1) {
    const ringRadius = radius * ring / ringCount;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angle = segment / segmentCount * Math.PI * 2;
      const x = center.x + Math.cos(angle) * ringRadius;
      const z = center.z + Math.sin(angle) * ringRadius;
      const vertex = 1 + (ring - 1) * segmentCount + segment;
      const offset = vertex * 3;
      positions[offset] = x;
      positions[offset + 1] = getHeightAt(x, z) + options.lift;
      positions[offset + 2] = z;
    }
  }

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const next = (segment + 1) % segmentCount;
    indices.push(0, 1 + segment, 1 + next);
  }
  for (let ring = 2; ring <= ringCount; ring += 1) {
    const innerStart = 1 + (ring - 2) * segmentCount;
    const outerStart = 1 + (ring - 1) * segmentCount;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const next = (segment + 1) % segmentCount;
      const inner = innerStart + segment;
      const innerNext = innerStart + next;
      const outer = outerStart + segment;
      const outerNext = outerStart + next;
      indices.push(inner, outer, innerNext, innerNext, outer, outerNext);
    }
  }

  updateOverlayGeometry(geometry, positions, indices);
}

export function polygonSegments(
  points: readonly Point2[],
  closeLoop = true,
): TerrainOverlaySegment[] {
  const segments: TerrainOverlaySegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    segments.push([points[index]!, points[index + 1]!]);
  }
  if (closeLoop && points.length >= 3) {
    segments.push([points[points.length - 1]!, points[0]!]);
  }
  return segments;
}

function bilinearPoint(
  corners: readonly [Point2, Point2, Point2, Point2],
  u: number,
  v: number,
): Point2 {
  const topX = THREE.MathUtils.lerp(corners[0].x, corners[1].x, u);
  const topZ = THREE.MathUtils.lerp(corners[0].z, corners[1].z, u);
  const bottomX = THREE.MathUtils.lerp(corners[3].x, corners[2].x, u);
  const bottomZ = THREE.MathUtils.lerp(corners[3].z, corners[2].z, u);
  return {
    x: THREE.MathUtils.lerp(topX, bottomX, v),
    z: THREE.MathUtils.lerp(topZ, bottomZ, v),
  };
}

/**
 * Keep live overlays non-indexed. Three's WebGPU backend can render a newly
 * indexed dynamic geometry before its index attribute has an uploaded
 * GPUBuffer, which aborts the whole render loop. These overlays are small, so
 * expanding their shared vertices into triangles is a cheap, robust tradeoff.
 */
function updateOverlayGeometry(
  geometry: THREE.BufferGeometry,
  positions: Float32Array,
  indices: readonly number[],
): void {
  const trianglePositions = new Float32Array(indices.length * 3);
  for (let indexOffset = 0; indexOffset < indices.length; indexOffset += 1) {
    const sourceOffset = indices[indexOffset]! * 3;
    const targetOffset = indexOffset * 3;
    trianglePositions[targetOffset] = positions[sourceOffset]!;
    trianglePositions[targetOffset + 1] = positions[sourceOffset + 1]!;
    trianglePositions[targetOffset + 2] = positions[sourceOffset + 2]!;
  }

  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const canReusePosition = position instanceof THREE.BufferAttribute
    && position.itemSize === 3
    && position.array instanceof Float32Array
    && position.array.length === trianglePositions.length;

  if (canReusePosition && !index) {
    position.array.set(trianglePositions);
    position.needsUpdate = true;
  } else {
    if (position || index) {
      geometry.dispose();
    }
    geometry.setIndex(null);
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(trianglePositions, 3),
    );
  }

  geometry.setDrawRange(0, trianglePositions.length / 3);
  geometry.computeBoundingSphere();
}
