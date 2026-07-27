import * as THREE from 'three';
import type { Point2 } from '../utils/polygonGeometry.ts';

export type TerrainOverlaySegment = readonly [Point2, Point2];

type TerrainRibbonOptions = {
  width: number;
  lift: number;
  sampleSpacing?: number;
  dashLength?: number;
  gapLength?: number;
};

export function clearOverlayGeometry(geometry: THREE.BufferGeometry): void {
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

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.setDrawRange(0, indices.length);
  geometry.computeBoundingSphere();
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

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.setDrawRange(0, indices.length);
  geometry.computeBoundingSphere();
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
      const dashLength = Math.max(0.25, options.dashLength!);
      const gapLength = Math.max(0.15, options.gapLength!);
      const stride = dashLength + gapLength;
      for (let cursor = gapLength * 0.5; cursor < length; cursor += stride) {
        visibleRanges.push([cursor, Math.min(length, cursor + dashLength)]);
      }
    } else {
      visibleRanges.push([0, length]);
    }

    for (const [rangeStart, rangeEnd] of visibleRanges) {
      const visibleLength = rangeEnd - rangeStart;
      if (visibleLength <= 0.08) continue;
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

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setIndex(indices);
  geometry.setDrawRange(0, indices.length);
  geometry.computeBoundingSphere();
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
