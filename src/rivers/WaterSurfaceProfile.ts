import type { WorldTerrainPreset } from '../world/worldTerrainPresets.ts';

export type WaterSurfaceProfileId = 'river' | 'inland' | 'coastal';

export type WaterSurfaceProfile = Readonly<{
  id: WaterSurfaceProfileId;
  /** Strength of the multi-band open-water spectrum. Flowing pixels ignore it. */
  openWaterWaveScale: number;
  /** 0 = travelling waves, 1 = sheltered standing interference. */
  standingWaveRatio: number;
  /** Blend from the green river palette toward clear blue open water. */
  seaTintStrength: number;
  /** Multiplier for crest and depth-band shoreline foam. */
  shoreBreakStrength: number;
  transmission: number;
  attenuationDistance: number;
  attenuationColor: readonly [number, number, number];
  roughness: number;
  specularIntensity: number;
}>;

export const RIVER_WATER_PROFILE: WaterSurfaceProfile = {
  id: 'river',
  openWaterWaveScale: 0,
  standingWaveRatio: 0,
  seaTintStrength: 0,
  shoreBreakStrength: 0,
  transmission: 0.7,
  attenuationDistance: 1.9,
  attenuationColor: [0.12, 0.28, 0.24],
  roughness: 0.3,
  specularIntensity: 0.5,
};

export const INLAND_WATER_PROFILE: WaterSurfaceProfile = {
  id: 'inland',
  openWaterWaveScale: 0.38,
  standingWaveRatio: 0.72,
  seaTintStrength: 0.28,
  shoreBreakStrength: 0.26,
  transmission: 0.72,
  attenuationDistance: 3.1,
  attenuationColor: [0.1, 0.3, 0.28],
  roughness: 0.28,
  specularIntensity: 0.54,
};

export const COASTAL_WATER_PROFILE: WaterSurfaceProfile = {
  id: 'coastal',
  openWaterWaveScale: 1,
  standingWaveRatio: 0.08,
  seaTintStrength: 1,
  shoreBreakStrength: 1,
  transmission: 0.64,
  attenuationDistance: 6.2,
  attenuationColor: [0.045, 0.23, 0.32],
  roughness: 0.22,
  specularIntensity: 0.64,
};

/**
 * Selects the world-wide optical profile. Flow-map presence still selects
 * river motion per pixel, so mixed procedural maps can render a current in
 * their channels and sheltered standing waves in their basin with one mesh.
 */
export function waterSurfaceProfileForPreset(
  terrainPreset: WorldTerrainPreset,
): WaterSurfaceProfile {
  if (terrainPreset === 'vinodol_coast') return COASTAL_WATER_PROFILE;
  if (terrainPreset === 'kupa_valley') return RIVER_WATER_PROFILE;
  return INLAND_WATER_PROFILE;
}
