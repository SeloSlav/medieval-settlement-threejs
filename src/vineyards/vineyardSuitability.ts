import { sampleAuthoritativeGroundwaterScore } from '../hydrology/sampleAuthoritativeHydrology.ts';
import type { VineyardParcelState } from '../resources/types.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import {
  effectiveFieldMoisture,
  fieldShapeEfficiency,
  sampleArableLandConditions,
  sampleParcelPoints,
  type FarmFieldCorners,
} from '../farming/farmFieldMath.ts';

export const VINEYARD_MIN_AREA = 220;
export const VINEYARD_MAX_AREA = 1_200;
export const VINEYARD_MIN_EDGE = 10;
export const VINEYARD_MAX_SLOPE_DEGREES = 28;
export const VINEYARD_REFERENCE_AREA = 220;
export const VINEYARD_MONASTERY_MAX_DISTANCE = 120;

export type VineyardSiteFactors = {
  score: number;
  soil: number;
  drainage: number;
  slope: number;
  sun: number;
  frost: number;
};

/**
 * Grapes favor light, reasonably deep, free-draining soils, sunny slopes, and
 * ground that is not a wet frost pocket. Mirrored by `server/src/vineyard.rs`.
 */
export function vineyardSiteFactors(
  groundwater: number,
  averageSlopeDegrees: number,
  southExposure: number,
  x: number,
  z: number,
): VineyardSiteFactors {
  const conditions = sampleArableLandConditions(x, z);
  const moisture = effectiveFieldMoisture(groundwater, x, z);
  const textureMatch = 1 - Math.abs(conditions.texture - 0.28) / 0.62;
  const lightSoil = 0.45 + clamp01(textureMatch) * 0.55;
  const depth = 0.62 + conditions.depth * 0.38;
  const soil = clamp01(lightSoil * depth);

  const moistureMatch = 1 - Math.abs(moisture - 0.37) / 0.46;
  const drainage = 0.38 + clamp01(moistureMatch) * 0.62;
  const slopeMatch = 1 - Math.abs(Math.max(0, averageSlopeDegrees) - 8) / 20;
  const slope = 0.55 + clamp01(slopeMatch) * 0.45;
  const sun = 0.72 + clamp01(southExposure) * 0.28;

  const flatness = 1 - clamp01(Math.max(0, averageSlopeDegrees) / 7);
  const wetness = clamp01((moisture - 0.48) / 0.38);
  const frost = 1 - flatness * wetness * 0.32;
  const score = clamp01(
    (soil * 0.38 + drainage * 0.30 + slope * 0.18 + sun * 0.14) * frost,
  );
  return { score, soil, drainage, slope, sun, frost };
}

export function vineyardSiteSuitability(
  groundwater: number,
  averageSlopeDegrees: number,
  southExposure: number,
  x: number,
  z: number,
): number {
  return vineyardSiteFactors(
    groundwater,
    averageSlopeDegrees,
    southExposure,
    x,
    z,
  ).score;
}

export function vineyardAreaEfficiency(area: number): number {
  return clamp(
    Math.sqrt(Math.max(0, area) / VINEYARD_REFERENCE_AREA),
    0.55,
    2.6,
  );
}

export function vineyardProductionMultiplier(
  parcel: Pick<VineyardParcelState, 'area' | 'siteSuitability' | 'shapeEfficiency'>,
): number {
  const site = 0.45 + clamp01(parcel.siteSuitability) * 1.10;
  return vineyardAreaEfficiency(parcel.area)
    * clamp(parcel.shapeEfficiency, 0.72, 1)
    * site;
}

export function sampleAverageSouthExposure(
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
): number {
  const samples = sampleParcelPoints(corners, 3);
  let total = 0;
  let weighted = 0;
  for (const point of samples) {
    const hx = getHeightAt(point.x + 1, point.z) - getHeightAt(point.x - 1, point.z);
    const hz = getHeightAt(point.x, point.z + 1) - getHeightAt(point.x, point.z - 1);
    const gradient = Math.hypot(hx, hz);
    const facingSouth = gradient <= 1e-6 ? 0.5 : 0.5 + (-hz / gradient) * 0.5;
    const slopeWeight = Math.min(1, gradient * 0.75);
    total += (0.5 * (1 - slopeWeight) + facingSouth * slopeWeight);
    weighted += 1;
  }
  return clamp01(total / Math.max(1, weighted));
}

export function samplePointVineyardSuitability(
  point: Point2,
  sampleSlopeDegrees: (x: number, z: number) => number,
  sampleSouthExposure: (x: number, z: number) => number,
): number {
  return vineyardSiteSuitability(
    sampleAuthoritativeGroundwaterScore(point.x, point.z),
    sampleSlopeDegrees(point.x, point.z),
    sampleSouthExposure(point.x, point.z),
    point.x,
    point.z,
  );
}

export function vineyardShapeEfficiency(corners: FarmFieldCorners): number {
  return fieldShapeEfficiency(corners);
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
