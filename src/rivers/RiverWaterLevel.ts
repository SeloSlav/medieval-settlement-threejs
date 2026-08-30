import type { RiverField } from './RiverField.ts';
import type { Terrain } from '../terrain/Terrain.ts';

export const RIVER_WATER_DEPTH = 1.05;
export const RIVER_CENTER_DEPTH_BOOST = 0.2;
export const RIVER_SHORE_DEPTH_LIFT = 0.06;

export function getRiverWaterColumnDepth(
  riverField: RiverField,
  x: number,
  z: number,
  organicSignedDistance = riverField.sampleOrganicSignedDistance(x, z),
): number {
  const authoredDepth = riverField.layout.getWaterColumnDepth(x, z);
  if (authoredDepth !== null) return authoredDepth;
  const shore = 1 - Math.min(1, Math.max(0, organicSignedDistance) / 6);
  const centerDepth = 1 - shore;
  return RIVER_WATER_DEPTH
    + shore * RIVER_SHORE_DEPTH_LIFT
    + centerDepth * RIVER_CENTER_DEPTH_BOOST;
}

/** Still water surface Y at world XZ — matches RiverWaterMesh base depth formula. */
export function getStillWaterSurfaceY(terrain: Terrain, riverField: RiverField, x: number, z: number): number {
  if (!riverField.isRenderedWetAt(x, z)) {
    return terrain.getHeightAt(x, z);
  }
  const surfaceOverride = riverField.layout.getWaterSurfaceOverride(x, z);
  if (surfaceOverride !== null) return surfaceOverride;
  const bed = terrain.getHeightAt(x, z);
  return bed + getRiverWaterColumnDepth(riverField, x, z);
}
