import {
  clayPitThroughputForWeather,
  preservedFoodDemandMultiplierForSeason,
  watermillThroughputForWeather,
  type EnvironmentState,
} from '../world/seasonPolicy.ts';
import { FRESH_FOOD_SPOILAGE_SPRING_PER_DAY } from '../generated/gameBalance.ts';
import { deciduousFoliageForSeasonPreview } from '../world/deciduousFoliagePolicy.ts';

export type PrecipitationKind = 'none' | 'rain' | 'snow';

export type PrecipitationProfile = {
  kind: PrecipitationKind;
  intensity: number;
  /** Full-scene wet-surface presentation; unlike road dampness this is rain-only. */
  wetness: number;
  fallSpeed: number;
  windX: number;
  windZ: number;
  sunlightMultiplier: number;
  fogDensityMultiplier: number;
  fogTint: number;
  saturationMultiplier: number;
};

export type RoadWeatherProfile = {
  /** Dark, lower-roughness surface response for rain and persistently damp autumn tracks. */
  wetness: number;
  /** Pale, cool packed-frost response used by winter roads. */
  frost: number;
};

const FAIR_PROFILE: PrecipitationProfile = {
  kind: 'none',
  intensity: 0,
  wetness: 0,
  fallSpeed: 0,
  windX: 0,
  windZ: 0,
  sunlightMultiplier: 1,
  fogDensityMultiplier: 1,
  fogTint: 0xffffff,
  saturationMultiplier: 1,
};

const FAIR_ROAD_PROFILE: RoadWeatherProfile = {
  wetness: 0,
  frost: 0,
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
      intensity: 0.78,
      wetness: 1,
      fallSpeed: 30,
      windX: 4.2,
      windZ: 1.8,
      sunlightMultiplier: 0.32,
      fogDensityMultiplier: 1.38,
      fogTint: 0x8295a1,
      saturationMultiplier: 0.74,
    };
  }

  if (environment.weather === 'frost') {
    return {
      kind: 'snow',
      intensity: 0.78,
      wetness: 0,
      fallSpeed: 4.4,
      windX: 1.15,
      windZ: 0.5,
      sunlightMultiplier: 0.8,
      fogDensityMultiplier: 1.02,
      fogTint: 0xc6d4db,
      saturationMultiplier: 0.97,
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

/**
 * Mirrors the authoritative road-condition bands with two material parameters.
 * Autumn remains mildly damp even on a fair day, making its persistent cart
 * penalty readable without inventing another weather event.
 */
export function roadWeatherProfile(
  environment: EnvironmentState | null,
): RoadWeatherProfile {
  if (!environment) return FAIR_ROAD_PROFILE;
  const settledSnow = Math.max(0, Math.min(1, environment.snowCoverage));
  if (environment.weather === 'rain') {
    return { wetness: 1, frost: settledSnow };
  }
  if (environment.weather === 'frost') {
    return { wetness: 0, frost: settledSnow };
  }
  if (environment.season === 'autumn') {
    return { wetness: 0.55, frost: settledSnow };
  }
  return { wetness: 0, frost: settledSnow };
}

/** Development-only visual override used for deterministic weather art checks. */
export function precipitationPreviewEnvironment(
  environment: EnvironmentState,
  search: string,
): EnvironmentState {
  const requested = new URLSearchParams(search).get('weather');
  if (requested === 'rain') {
    return {
      ...environment,
      season: 'spring',
      weather: 'rain',
      snowCoverage: 0,
      deciduousFoliage: deciduousFoliageForSeasonPreview('spring'),
      preservedFoodDemandMultiplier:
        preservedFoodDemandMultiplierForSeason('spring'),
      watermillThroughputMultiplier: watermillThroughputForWeather('rain'),
      clayPitThroughputMultiplier: clayPitThroughputForWeather('rain'),
    };
  }
  if (requested === 'snow') {
    return {
      ...environment,
      season: 'winter',
      weather: 'frost',
      snowCoverage: 1,
      deciduousFoliage: deciduousFoliageForSeasonPreview('winter'),
      preservedFoodDemandMultiplier:
        preservedFoodDemandMultiplierForSeason('winter'),
      watermillThroughputMultiplier: watermillThroughputForWeather('frost'),
      clayPitThroughputMultiplier: clayPitThroughputForWeather('frost'),
    };
  }
  if (requested === 'autumn') {
    return {
      ...environment,
      season: 'autumn',
      weather: 'fair',
      snowCoverage: 0,
      deciduousFoliage: deciduousFoliageForSeasonPreview('autumn'),
      preservedFoodDemandMultiplier:
        preservedFoodDemandMultiplierForSeason('autumn'),
      watermillThroughputMultiplier: 1,
      clayPitThroughputMultiplier: 1,
    };
  }
  if (requested === 'clear') {
    return {
      ...environment,
      weather: 'fair',
      snowCoverage: 0,
      watermillThroughputMultiplier: 1,
      clayPitThroughputMultiplier: 1,
    };
  }
  return environment;
}

export function standalonePrecipitationPreview(
  search: string,
): EnvironmentState | null {
  const requested = new URLSearchParams(search).get('weather');
  if (requested !== 'rain' && requested !== 'snow' && requested !== 'autumn') return null;
  return precipitationPreviewEnvironment({
    season: 'spring',
    weather: 'fair',
    snowCoverage: 0,
    deciduousFoliage: deciduousFoliageForSeasonPreview('spring'),
    cropGrowthMultiplier: 1,
    firewoodDemandMultiplier: 1,
    pastureCapacityMultiplier: 1,
    freshFoodSpoilageFractionPerDay: FRESH_FOOD_SPOILAGE_SPRING_PER_DAY,
    preservedFoodDemandMultiplier:
      preservedFoodDemandMultiplierForSeason('spring'),
    roadTravelSpeedMultiplier: 1,
    watermillThroughputMultiplier: 1,
    clayPitThroughputMultiplier: 1,
  }, search);
}
