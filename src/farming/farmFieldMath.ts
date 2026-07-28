import {
  FARM_BASE_GRAIN_PER_SQUARE_METER,
  FARM_CROP_DEFINITIONS,
  FARM_LARGE_FIELD_EFFICIENCY_EXPONENT,
  FARM_LARGE_FIELD_EFFICIENCY_FLOOR,
  FARM_OPTIMAL_FIELD_AREA,
  FARM_SLOPE_PENALTY_PER_DEGREE,
  type FarmCropDefinition,
  type FarmCropProduce,
} from '../generated/gameBalance.ts';
import type { FarmCrop, FarmFieldState } from '../resources/types.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';

export type FarmFieldCorners = [Point2, Point2, Point2, Point2];

export function rectangleFromBaseline(a: Point2, b: Point2, depthPoint: Point2): FarmFieldCorners | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length <= 1e-6) return null;
  const nx = -dz / length;
  const nz = dx / length;
  const depth = (depthPoint.x - a.x) * nx + (depthPoint.z - a.z) * nz;
  return [
    { x: a.x, z: a.z },
    { x: b.x, z: b.z },
    { x: b.x + nx * depth, z: b.z + nz * depth },
    { x: a.x + nx * depth, z: a.z + nz * depth },
  ];
}

export function fieldCentroid(corners: readonly Point2[]): Point2 {
  return {
    x: corners.reduce((sum, point) => sum + point.x, 0) / corners.length,
    z: corners.reduce((sum, point) => sum + point.z, 0) / corners.length,
  };
}

export function fieldEdgeLengths(corners: FarmFieldCorners): [number, number, number, number] {
  return corners.map((point, index) => {
    const next = corners[(index + 1) % 4];
    return Math.hypot(next.x - point.x, next.z - point.z);
  }) as [number, number, number, number];
}

export function fieldArea(corners: FarmFieldCorners): number {
  const edges = fieldEdgeLengths(corners);
  return edges[0] * edges[1];
}

export function fieldShapeEfficiency(corners: FarmFieldCorners): number {
  const [width, depth] = fieldEdgeLengths(corners);
  const aspect = Math.max(width, depth) / Math.max(1e-6, Math.min(width, depth));
  return Math.max(0.72, Math.min(1, 1 - Math.max(0, aspect - 1) * 0.035));
}

export function fieldSizeEfficiency(area: number): number {
  if (area <= FARM_OPTIMAL_FIELD_AREA) return 1;
  const efficiency = (FARM_OPTIMAL_FIELD_AREA / Math.max(area, 1)) ** FARM_LARGE_FIELD_EFFICIENCY_EXPONENT;
  return Math.max(FARM_LARGE_FIELD_EFFICIENCY_FLOOR, Math.min(1, efficiency));
}

export function moistureSuitability(crop: FarmCrop, moisture: number): number {
  const definition = cropDefinition(crop);
  if (definition.produce === 'none') return 1;
  const ideal = definition.moistureIdeal;
  const tolerance = definition.moistureTolerance;
  const base = 1 - Math.abs(Math.max(0, Math.min(1, moisture)) - ideal) / Math.max(1e-6, tolerance);
  return Math.max(0.25, Math.min(1, 0.25 + Math.max(0, Math.min(1, base)) * 0.75));
}

/** Mirrors the authoritative starting-fertility rule used when a field is placed. */
export function initialFieldFertility(
  moisture: number,
  averageSlopeDegrees: number,
): number {
  return Math.max(
    0.35,
    Math.min(
      0.95,
      0.62
        + Math.max(0, Math.min(1, moisture)) * 0.30
        - Math.max(0, averageSlopeDegrees) * 0.006,
    ),
  );
}

/**
 * Normalized first-crop productivity at a point before parcel shape and size.
 * Fallow shows predicted starting soil because it has no crop yield.
 */
export function cropSiteSuitability(
  crop: FarmCrop,
  moisture: number,
  averageSlopeDegrees: number,
): number {
  const fertility = initialFieldFertility(moisture, averageSlopeDegrees);
  if (cropProduce(crop) === 'none') return fertility / 0.95;
  const slope = Math.max(
    0.35,
    Math.min(1, 1 - Math.max(0, averageSlopeDegrees) * FARM_SLOPE_PENALTY_PER_DEGREE),
  );
  return Math.max(
    0,
    Math.min(1, moistureSuitability(crop, moisture) * (fertility / 0.95) * slope),
  );
}

export function expectedFieldYield(field: Pick<FarmFieldState, 'area' | 'crop' | 'moisture' | 'fertility' | 'averageSlopeDegrees' | 'corners'>): number {
  const definition = cropDefinition(field.crop);
  if (definition.produce === 'none') return 0;
  const slope = Math.max(0.35, Math.min(1, 1 - field.averageSlopeDegrees * FARM_SLOPE_PENALTY_PER_DEGREE));
  return field.area
    * FARM_BASE_GRAIN_PER_SQUARE_METER
    * definition.yieldMultiplier
    * moistureSuitability(field.crop, field.moisture)
    * Math.max(0.2, Math.min(1, field.fertility))
    * slope
    * fieldShapeEfficiency(field.corners)
    * fieldSizeEfficiency(field.area);
}

export function sampleAverageSlopeDegrees(
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
): number {
  const samples = 4;
  const slopes: number[] = [];
  for (let zIndex = 0; zIndex <= samples; zIndex++) {
    for (let xIndex = 0; xIndex <= samples; xIndex++) {
      const u = xIndex / samples;
      const v = zIndex / samples;
      const point = bilinearPoint(corners, u, v);
      const hx = getHeightAt(point.x + 0.5, point.z) - getHeightAt(point.x - 0.5, point.z);
      const hz = getHeightAt(point.x, point.z + 0.5) - getHeightAt(point.x, point.z - 0.5);
      slopes.push(Math.atan(Math.hypot(hx, hz)) * 180 / Math.PI);
    }
  }
  return slopes.reduce((sum, value) => sum + value, 0) / Math.max(1, slopes.length);
}

export function bilinearPoint(corners: FarmFieldCorners, u: number, v: number): Point2 {
  const topX = corners[0].x + (corners[1].x - corners[0].x) * u;
  const topZ = corners[0].z + (corners[1].z - corners[0].z) * u;
  const bottomX = corners[3].x + (corners[2].x - corners[3].x) * u;
  const bottomZ = corners[3].z + (corners[2].z - corners[3].z) * u;
  return { x: topX + (bottomX - topX) * v, z: topZ + (bottomZ - topZ) * v };
}

export function cropLabel(crop: FarmCrop): string {
  return cropDefinition(crop).label;
}

export function cropDefinition(crop: FarmCrop): FarmCropDefinition {
  return FARM_CROP_DEFINITIONS[crop];
}

export function cropProduce(crop: FarmCrop): FarmCropProduce {
  return cropDefinition(crop).produce;
}

export function cropHarvestUnit(crop: FarmCrop): string {
  const produce = cropProduce(crop);
  return produce === 'fibre' ? 'flax fibre' : produce === 'grain' ? 'grain' : 'fertility';
}
