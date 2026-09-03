import {
  charcoalBurnerThroughputForWeather,
  surfaceClayThroughputForWeather,
  preservedFoodDemandMultiplierForSeason,
  preservedFoodSpoilageFractionPerDayFor,
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
  /** Shared scene-lighting/fog grade weight. This is smoothed by SceneManager. */
  atmosphericBlend: number;
  sunlightMultiplier: number;
  fogDensityMultiplier: number;
  fogTint: number;
  saturationMultiplier: number;
  warmthOffset: number;
};

export type RoadWeatherProfile = {
  /** Dark, lower-roughness surface response for rain and persistently damp autumn tracks. */
  wetness: number;
  /** Pale, cool packed-frost response used by winter roads. */
  frost: number;
};

export const WEATHER_PRESENTATION_FADE_RATE = 1.2;

/** A capped exponential response prevents both frame-rate drift and long-frame snaps. */
export function weatherPresentationBlend(dt: number): number {
  const frameDt = Math.min(0.05, Math.max(0, dt));
  return 1 - Math.exp(-frameDt * WEATHER_PRESENTATION_FADE_RATE);
}

const FAIR_PROFILE: PrecipitationProfile = {
  kind: 'none',
  intensity: 0,
  wetness: 0,
  fallSpeed: 0,
  windX: 0,
  windZ: 0,
  // Directional daylight reveals crowns and building mass. Cooler air remains
  // strongest in the distant, lower parts of the landscape.
  atmosphericBlend: 0.2,
  sunlightMultiplier: 0.65,
  fogDensityMultiplier: 1.05,
  fogTint: 0x8295a1,
  saturationMultiplier: 0.9,
  warmthOffset: 0.025,
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
      atmosphericBlend: 0.5,
      sunlightMultiplier: 0.27,
      fogDensityMultiplier: 1.44,
      fogTint: 0x788c99,
      saturationMultiplier: 0.71,
      warmthOffset: -0.04,
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
      atmosphericBlend: 0.18,
      sunlightMultiplier: 0.8,
      fogDensityMultiplier: 1.02,
      fogTint: 0xc6d4db,
      saturationMultiplier: 0.97,
      warmthOffset: -0.0144,
    };
  }

  if (environment.weather === 'drought') {
    return {
      ...FAIR_PROFILE,
      atmosphericBlend: 0.16,
      sunlightMultiplier: 1.08,
      fogDensityMultiplier: 1.18,
      fogTint: 0xd8b27d,
      saturationMultiplier: 0.92,
      warmthOffset: 0.08,
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
      groundwaterMultiplier: 1,
      preservedFoodDemandMultiplier:
        preservedFoodDemandMultiplierForSeason('spring'),
      preservedFoodSpoilageFractionPerDay:
        preservedFoodSpoilageFractionPerDayFor('spring', 'rain'),
      watermillThroughputMultiplier: watermillThroughputForWeather('rain'),
      surfaceClayThroughputMultiplier: surfaceClayThroughputForWeather('rain'),
      charcoalBurnerThroughputMultiplier:
        charcoalBurnerThroughputForWeather('rain'),
    };
  }
  if (requested === 'snow') {
    return {
      ...environment,
      season: 'winter',
      weather: 'frost',
      snowCoverage: 1,
      deciduousFoliage: deciduousFoliageForSeasonPreview('winter'),
      groundwaterMultiplier: 1,
      preservedFoodDemandMultiplier:
        preservedFoodDemandMultiplierForSeason('winter'),
      preservedFoodSpoilageFractionPerDay:
        preservedFoodSpoilageFractionPerDayFor('winter', 'frost'),
      watermillThroughputMultiplier: watermillThroughputForWeather('frost'),
      surfaceClayThroughputMultiplier: surfaceClayThroughputForWeather('frost'),
      charcoalBurnerThroughputMultiplier:
        charcoalBurnerThroughputForWeather('frost'),
    };
  }
  if (requested === 'autumn') {
    return {
      ...environment,
      season: 'autumn',
      weather: 'fair',
      snowCoverage: 0,
      deciduousFoliage: deciduousFoliageForSeasonPreview('autumn'),
      groundwaterMultiplier: 1,
      preservedFoodDemandMultiplier:
        preservedFoodDemandMultiplierForSeason('autumn'),
      preservedFoodSpoilageFractionPerDay:
        preservedFoodSpoilageFractionPerDayFor('autumn', 'fair'),
      watermillThroughputMultiplier: 1,
      surfaceClayThroughputMultiplier: 1,
      charcoalBurnerThroughputMultiplier: 1,
    };
  }
  if (requested === 'clear') {
    return {
      ...environment,
      weather: 'fair',
      snowCoverage: 0,
      groundwaterMultiplier: 1,
      preservedFoodSpoilageFractionPerDay:
        preservedFoodSpoilageFractionPerDayFor(environment.season, 'fair'),
      watermillThroughputMultiplier: 1,
      surfaceClayThroughputMultiplier: 1,
      charcoalBurnerThroughputMultiplier: 1,
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
    groundwaterMultiplier: 1,
    firewoodDemandMultiplier: 1,
    pastureCapacityMultiplier: 1,
    freshFoodSpoilageFractionPerDay: FRESH_FOOD_SPOILAGE_SPRING_PER_DAY,
    preservedFoodSpoilageFractionPerDay:
      preservedFoodSpoilageFractionPerDayFor('spring', 'fair'),
    preservedFoodDemandMultiplier:
      preservedFoodDemandMultiplierForSeason('spring'),
    roadTravelSpeedMultiplier: 1,
    watermillThroughputMultiplier: 1,
    surfaceClayThroughputMultiplier: 1,
    charcoalBurnerThroughputMultiplier: 1,
  }, search);
}
