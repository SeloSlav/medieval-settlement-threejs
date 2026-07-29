import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
} from '../generated/gameBalance.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import { deciduousFoliageForSeasonPreview } from '../world/deciduousFoliagePolicy.ts';
import {
  clayPitThroughputForWeather,
  preservedFoodDemandMultiplierForSeason,
  watermillThroughputForWeather,
  type EnvironmentState,
  type Season,
  type WeatherKind,
} from '../world/seasonPolicy.ts';

export type VisualQaPreset = 'daylight' | 'moonlight' | 'rain' | 'autumn' | 'winter';

export type VisualQaConditions = {
  preset: VisualQaPreset;
  label: string;
  month: number;
  monthDay: number;
  hour: number;
  season: Season;
  weather: WeatherKind;
};

const PRESETS: Readonly<Record<VisualQaPreset, VisualQaConditions>> = {
  daylight: {
    preset: 'daylight',
    label: 'Clear summer daylight',
    month: 6,
    monthDay: 15,
    hour: 13,
    season: 'summer',
    weather: 'fair',
  },
  moonlight: {
    preset: 'moonlight',
    label: 'Clear summer moonlight',
    month: 8,
    monthDay: 15,
    hour: 23,
    season: 'summer',
    weather: 'fair',
  },
  rain: {
    preset: 'rain',
    label: 'Spring rain at midday',
    month: 4,
    monthDay: 15,
    hour: 13,
    season: 'spring',
    weather: 'rain',
  },
  autumn: {
    preset: 'autumn',
    label: 'Peak autumn foliage at midday',
    month: 10,
    monthDay: 6,
    hour: 13,
    season: 'autumn',
    weather: 'fair',
  },
  winter: {
    preset: 'winter',
    label: 'Winter frost and snow at midday',
    month: 1,
    monthDay: 15,
    hour: 13,
    season: 'winter',
    weather: 'frost',
  },
};

/**
 * Development-only visual capture presets. Normal play has no override unless
 * an explicit `visualQa` query parameter selects one of the known conditions.
 */
export function parseVisualQaConditions(search: string): VisualQaConditions | null {
  const requested = new URLSearchParams(search).get('visualQa');
  if (!requested || !isVisualQaPreset(requested)) return null;
  return PRESETS[requested];
}

export function applyVisualQaEnvironment(
  environment: EnvironmentState,
  conditions: VisualQaConditions,
): EnvironmentState {
  return {
    ...environment,
    season: conditions.season,
    weather: conditions.weather,
    snowCoverage: conditions.weather === 'frost' ? 1 : 0,
    deciduousFoliage: deciduousFoliageForSeasonPreview(conditions.season),
    preservedFoodDemandMultiplier:
      preservedFoodDemandMultiplierForSeason(conditions.season),
    watermillThroughputMultiplier: watermillThroughputForWeather(
      conditions.weather,
    ),
    clayPitThroughputMultiplier: clayPitThroughputForWeather(
      conditions.weather,
    ),
  };
}

export function standaloneVisualQaEnvironment(
  conditions: VisualQaConditions,
): EnvironmentState {
  return applyVisualQaEnvironment({
    season: 'summer',
    weather: 'fair',
    snowCoverage: 0,
    deciduousFoliage: deciduousFoliageForSeasonPreview('summer'),
    cropGrowthMultiplier: 1,
    firewoodDemandMultiplier: 1,
    pastureCapacityMultiplier: 1,
    freshFoodSpoilageFractionPerDay: 0,
    preservedFoodDemandMultiplier:
      preservedFoodDemandMultiplierForSeason('summer'),
    roadTravelSpeedMultiplier: 1,
    watermillThroughputMultiplier: 1,
    clayPitThroughputMultiplier: 1,
  }, conditions);
}

export function applyVisualQaClock(
  clock: GameClock,
  conditions: VisualQaConditions,
): GameClock {
  const hour = Math.floor(conditions.hour);
  const minute = Math.floor((conditions.hour - hour) * 60);
  const dayOfYear = (conditions.month - 1) * CALENDAR_DAYS_PER_MONTH
    + conditions.monthDay - 1;
  const preciseHour = hour + minute / 60;
  const weekday = ((clock.year - 1) * CALENDAR_DAYS_PER_MONTH * 12 + dayOfYear) % 7;
  const isWorkHours = preciseHour >= CALENDAR_WORK_START_HOUR
    && preciseHour < CALENDAR_WORK_END_HOUR;

  return {
    ...clock,
    hour,
    minute,
    preciseHour,
    preciseCalendarDay: dayOfYear + preciseHour / CALENDAR_HOURS_PER_DAY,
    weekday,
    monthDay: conditions.monthDay,
    month: conditions.month,
    isSunday: weekday === 0,
    isWorkHours,
  };
}

function isVisualQaPreset(value: string): value is VisualQaPreset {
  return value === 'daylight'
    || value === 'moonlight'
    || value === 'rain'
    || value === 'autumn'
    || value === 'winter';
}
