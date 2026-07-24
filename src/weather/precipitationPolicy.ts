import type { EnvironmentState } from '../world/seasonPolicy.ts';

export type PrecipitationKind = 'none' | 'rain' | 'snow';

export type PrecipitationProfile = {
  kind: PrecipitationKind;
  intensity: number;
  fallSpeed: number;
  windX: number;
  windZ: number;
  sunlightMultiplier: number;
  fogDensityMultiplier: number;
  fogTint: number;
  saturationMultiplier: number;
};

const FAIR_PROFILE: PrecipitationProfile = {
  kind: 'none',
  intensity: 0,
  fallSpeed: 0,
  windX: 0,
  windZ: 0,
  sunlightMultiplier: 1,
  fogDensityMultiplier: 1,
  fogTint: 0xffffff,
  saturationMultiplier: 1,
};

/**
 * Presentation-only weather profile. Seasonal mechanics remain authoritative;
 * this maps their current environment state to an efficient visual treatment.
 */
export function precipitationProfile(
  environment: EnvironmentState | null,
): PrecipitationProfile {
  if (!environment) return FAIR_PROFILE;

  if (environment.weather === 'rain') {
    return {
      kind: 'rain',
      intensity: 0.9,
      fallSpeed: 30,
      windX: 4.2,
      windZ: 1.8,
      sunlightMultiplier: 0.5,
      fogDensityMultiplier: 1.55,
      fogTint: 0x8295a1,
      saturationMultiplier: 0.78,
    };
  }

  if (environment.weather === 'frost') {
    return {
      kind: 'snow',
      intensity: 0.62,
      fallSpeed: 4.4,
      windX: 1.15,
      windZ: 0.5,
      sunlightMultiplier: 0.72,
      fogDensityMultiplier: 1.32,
      fogTint: 0xd8e3ea,
      saturationMultiplier: 0.84,
    };
  }

  if (environment.weather === 'drought') {
    return {
      ...FAIR_PROFILE,
      sunlightMultiplier: 1.08,
      fogDensityMultiplier: 1.18,
      fogTint: 0xd8b27d,
      saturationMultiplier: 0.92,
    };
  }

  return FAIR_PROFILE;
}

/** Development-only visual override used for deterministic weather art checks. */
export function precipitationPreviewEnvironment(
  environment: EnvironmentState,
  search: string,
): EnvironmentState {
  const requested = new URLSearchParams(search).get('weather');
  if (requested === 'rain') return { ...environment, season: 'spring', weather: 'rain' };
  if (requested === 'snow') return { ...environment, season: 'winter', weather: 'frost' };
  if (requested === 'clear') return { ...environment, weather: 'fair' };
  return environment;
}
