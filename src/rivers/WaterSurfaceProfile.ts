import type { WorldTerrainPreset } from '../world/worldTerrainPresets.ts';

export type WaterSurfaceProfileId = 'river' | 'inland' | 'coastal';
export type WaterSurfaceProfile = Readonly<{
  id: WaterSurfaceProfileId;
  openWaterWaveScale: number;
  spectralHeightScale: number;
  shoreBreakStrength: number;
  /** Extinction coefficients in inverse metres, in linear RGB. */
  absorption: readonly [number, number, number];
  scatteringColor: readonly [number, number, number];
  /** Shore wave angular frequency (rad/s), wavenumber (rad/m), height and reach. */
  shoreFrequency: number;
  shoreWavenumber: number;
  shoreAmplitude: number;
  shoreDecay: number;
  roughness: number;
  specularIntensity: number;
}>;

export const RIVER_WATER_PROFILE: WaterSurfaceProfile = {
  id:'river',openWaterWaveScale:0.38,spectralHeightScale:0,shoreBreakStrength:0,
  absorption:[0.26,0.09,0.145],scatteringColor:[0.035,0.20,0.155],
  shoreFrequency:2.8,shoreWavenumber:3.8,shoreAmplitude:0.007,shoreDecay:0.8,
  roughness:0.285,specularIntensity:0.54,
};
export const INLAND_WATER_PROFILE: WaterSurfaceProfile = {
  id:'inland',openWaterWaveScale:0.38,spectralHeightScale:0.12,shoreBreakStrength:0.26,
  absorption:[0.39,0.13,0.19],scatteringColor:[0.035,0.20,0.155],
  shoreFrequency:2.3,shoreWavenumber:3.8,shoreAmplitude:0.016,shoreDecay:0.8,
  roughness:0.28,specularIntensity:0.54,
};
export const COASTAL_WATER_PROFILE: WaterSurfaceProfile = {
  id:'coastal',openWaterWaveScale:1,spectralHeightScale:0.72,shoreBreakStrength:1,
  absorption:[0.24,0.065,0.04],scatteringColor:[0.025,0.17,0.22],
  shoreFrequency:1.45,shoreWavenumber:1.7,shoreAmplitude:0.085,shoreDecay:0.24,
  roughness:0.22,specularIntensity:0.64,
};
export const WATER_SURFACE_PROFILES = {river:RIVER_WATER_PROFILE,inland:INLAND_WATER_PROFILE,coastal:COASTAL_WATER_PROFILE};

/** Channel presence selects river motion per pixel within mixed maps. */
export function waterSurfaceProfileForPreset(terrainPreset:WorldTerrainPreset):WaterSurfaceProfile {
  if(terrainPreset==='vinodol_coast')return COASTAL_WATER_PROFILE;
  if(terrainPreset==='kupa_valley'||terrainPreset==='gomirje_meadows')return RIVER_WATER_PROFILE;
  return INLAND_WATER_PROFILE;
}
