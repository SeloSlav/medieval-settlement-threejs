import {
  AUTUMN_FIREWOOD_DEMAND_MULTIPLIER,
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  AUTUMN_ROAD_SPEED_MULTIPLIER,
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_SECONDS_PER_DAY,
  DROUGHT_CROP_GROWTH_MULTIPLIER,
  DROUGHT_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
  DROUGHT_GROUNDWATER_MULTIPLIER,
  DROUGHT_PASTURE_CAPACITY_MULTIPLIER,
  DROUGHT_WATERMILL_THROUGHPUT_MULTIPLIER,
  FRESH_FOOD_SPOILAGE_AUTUMN_PER_DAY,
  FRESH_FOOD_SPOILAGE_DROUGHT_PER_DAY,
  FRESH_FOOD_SPOILAGE_SPRING_PER_DAY,
  FRESH_FOOD_SPOILAGE_SUMMER_PER_DAY,
  FRESH_FOOD_SPOILAGE_WINTER_PER_DAY,
  PRESERVED_FOOD_SPOILAGE_AUTUMN_MULTIPLIER,
  PRESERVED_FOOD_SPOILAGE_DROUGHT_MULTIPLIER,
  PRESERVED_FOOD_SPOILAGE_PER_DAY,
  PRESERVED_FOOD_SPOILAGE_SPRING_MULTIPLIER,
  PRESERVED_FOOD_SPOILAGE_SUMMER_MULTIPLIER,
  PRESERVED_FOOD_SPOILAGE_WINTER_MULTIPLIER,
  PANNAGE_AUTUMN_CAPACITY_MULTIPLIER,
  PANNAGE_DROUGHT_CAPACITY_MULTIPLIER,
  PANNAGE_SPRING_CAPACITY_MULTIPLIER,
  PANNAGE_SUMMER_CAPACITY_MULTIPLIER,
  PANNAGE_WINTER_CAPACITY_MULTIPLIER,
  RESIDENCE_PRESERVED_FOOD_AUTUMN_MULTIPLIER,
  RESIDENCE_PRESERVED_FOOD_SPRING_MULTIPLIER,
  RESIDENCE_PRESERVED_FOOD_SUMMER_MULTIPLIER,
  RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
  SPRING_FIREWOOD_DEMAND_MULTIPLIER,
  SPRING_PASTURE_CAPACITY_MULTIPLIER,
  SPRING_RAIN_CHANCE,
  SPRING_RAIN_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
  SPRING_RAIN_CROP_GROWTH_MULTIPLIER,
  SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
  SPRING_RAIN_WATERMILL_THROUGHPUT_MULTIPLIER,
  SUMMER_DROUGHT_CHANCE,
  SUMMER_DROUGHT_DURATION_DAYS,
  SUMMER_FIREWOOD_DEMAND_MULTIPLIER,
  SUMMER_PASTURE_CAPACITY_MULTIPLIER,
  SIM_TICK_SECONDS,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
  WINTER_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
  WINTER_PASTURE_CAPACITY_MULTIPLIER,
  WINTER_ROAD_SPEED_MULTIPLIER,
  WINTER_WATERMILL_THROUGHPUT_MULTIPLIER,
} from '../generated/gameBalance.ts';
import { getActiveWorldGeneration } from './worldGenerationContext.ts';
import {
  formatCalendarDate,
  gameClock,
  type GameClock,
} from './gameCalendar.ts';
import {
  deciduousFoliageForClock,
  type DeciduousFoliagePresentation,
} from './deciduousFoliagePolicy.ts';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type WeatherKind = 'fair' | 'rain' | 'drought' | 'frost';

export type EnvironmentState = {
  season: Season;
  weather: WeatherKind;
  /** Presentation-only settled snow coverage, derived from the calendar. */
  snowCoverage: number;
  /** Presentation-only color and leaf-retention state for deciduous foliage. */
  deciduousFoliage: DeciduousFoliagePresentation;
  cropGrowthMultiplier: number;
  /** Usable share of the seeded aquifer after temporary seasonal drawdown. */
  groundwaterMultiplier: number;
  firewoodDemandMultiplier: number;
  pastureCapacityMultiplier: number;
  freshFoodSpoilageFractionPerDay: number;
  /** Slow quality loss of cured provisions before the current store factor. */
  preservedFoodSpoilageFractionPerDay: number;
  /** Share of the normal prosperous-household ration rotated from cured stores. */
  preservedFoodDemandMultiplier: number;
  roadTravelSpeedMultiplier: number;
  watermillThroughputMultiplier: number;
  /** Riverbank digging pace after saturated, hardened, or frozen ground. */
  surfaceClayThroughputMultiplier: number;
  /** Covered earth-clamp pace after ambient wood-drying conditions. */
  charcoalBurnerThroughputMultiplier: number;
};

export type NextDayEnvironmentOutlook = {
  clock: GameClock;
  environment: EnvironmentState;
};

export function seasonForMonth(month: number): Season {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

/** Woodland forage follows the mast calendar rather than grass growth. */
export function pannageCapacityMultiplierFor(
  season: Season,
  weather: WeatherKind,
): number {
  if (weather === 'drought') return PANNAGE_DROUGHT_CAPACITY_MULTIPLIER;
  return {
    spring: PANNAGE_SPRING_CAPACITY_MULTIPLIER,
    summer: PANNAGE_SUMMER_CAPACITY_MULTIPLIER,
    autumn: PANNAGE_AUTUMN_CAPACITY_MULTIPLIER,
    winter: PANNAGE_WINTER_CAPACITY_MULTIPLIER,
  }[season];
}

export function watermillThroughputForWeather(weather: WeatherKind): number {
  if (weather === 'rain') return SPRING_RAIN_WATERMILL_THROUGHPUT_MULTIPLIER;
  if (weather === 'drought') return DROUGHT_WATERMILL_THROUGHPUT_MULTIPLIER;
  if (weather === 'frost') return WINTER_WATERMILL_THROUGHPUT_MULTIPLIER;
  return 1;
}

export const SURFACE_CLAY_RAIN_THROUGHPUT_MULTIPLIER = 0.8;
export const SURFACE_CLAY_DROUGHT_THROUGHPUT_MULTIPLIER = 0.7;
export const SURFACE_CLAY_FROST_THROUGHPUT_MULTIPLIER = 0.35;

export function surfaceClayThroughputForWeather(weather: WeatherKind): number {
  if (weather === 'rain') return SURFACE_CLAY_RAIN_THROUGHPUT_MULTIPLIER;
  if (weather === 'drought') return SURFACE_CLAY_DROUGHT_THROUGHPUT_MULTIPLIER;
  if (weather === 'frost') return SURFACE_CLAY_FROST_THROUGHPUT_MULTIPLIER;
  return 1;
}

export function charcoalBurnerThroughputForWeather(weather: WeatherKind): number {
  if (weather === 'rain') {
    return SPRING_RAIN_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER;
  }
  if (weather === 'drought') {
    return DROUGHT_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER;
  }
  if (weather === 'frost') {
    return WINTER_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER;
  }
  return 1;
}

export function preservedFoodDemandMultiplierForSeason(season: Season): number {
  return {
    spring: RESIDENCE_PRESERVED_FOOD_SPRING_MULTIPLIER,
    summer: RESIDENCE_PRESERVED_FOOD_SUMMER_MULTIPLIER,
    autumn: RESIDENCE_PRESERVED_FOOD_AUTUMN_MULTIPLIER,
    winter: RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
  }[season];
}

export function preservedFoodSpoilageFractionPerDayFor(
  season: Season,
  weather: WeatherKind,
): number {
  const multiplier = weather === 'drought'
    ? PRESERVED_FOOD_SPOILAGE_DROUGHT_MULTIPLIER
    : {
        spring: PRESERVED_FOOD_SPOILAGE_SPRING_MULTIPLIER,
        summer: PRESERVED_FOOD_SPOILAGE_SUMMER_MULTIPLIER,
        autumn: PRESERVED_FOOD_SPOILAGE_AUTUMN_MULTIPLIER,
        winter: PRESERVED_FOOD_SPOILAGE_WINTER_MULTIPLIER,
      }[season];
  return PRESERVED_FOOD_SPOILAGE_PER_DAY * multiplier;
}

export function snowCoverageForClock(clock: GameClock): number {
  const dayProgress = Math.max(
    0,
    Math.min(
      1,
      (
        clock.monthDay
        - 1
        + (clock.preciseHour ?? clock.hour) / 24
      ) / CALENDAR_DAYS_PER_MONTH,
    ),
  );
  const smooth = (progress: number): number =>
    progress * progress * (3 - 2 * progress);
  // First dusting during the last third of November. Starting at zero with a
  // flat easing tangent prevents a visible seasonal pop.
  if (clock.month === 11) {
    const onset = Math.max(0, Math.min(1, (dayProgress - 0.64) / 0.36));
    return 0.16 * smooth(onset);
  }
  if (clock.month === 12) return 0.16 + 0.56 * smooth(dayProgress);
  if (clock.month === 1) return 0.72 + 0.28 * smooth(dayProgress);
  // Let the winter cover retreat completely during February so a new game can
  // open on 1 March with readable green ground and no lingering snow patches.
  if (clock.month === 2) return 1 - smooth(dayProgress);
  return 0;
}

export function environmentFor(
  seed: number,
  hydrology: number,
  clock: GameClock,
  severeWeatherEnabled = false,
  foodSpoilageRate = getActiveWorldGeneration().foodSpoilageRate,
): EnvironmentState {
  const season = seasonForMonth(clock.month);
  const weather: WeatherKind = season === 'spring' && springRain(seed, hydrology, clock)
    ? 'rain'
    : season === 'summer' && severeWeatherEnabled && summerDrought(seed, hydrology, clock)
      ? 'drought'
      : season === 'winter'
        ? 'frost'
        : 'fair';

  const spoilageMultiplier = Math.max(0, foodSpoilageRate) / 100;
  return {
    season,
    weather,
    snowCoverage: snowCoverageForClock(clock),
    deciduousFoliage: deciduousFoliageForClock(clock),
    cropGrowthMultiplier: weather === 'rain'
      ? SPRING_RAIN_CROP_GROWTH_MULTIPLIER
      : weather === 'drought'
        ? DROUGHT_CROP_GROWTH_MULTIPLIER
        : 1,
    groundwaterMultiplier: weather === 'drought'
      ? DROUGHT_GROUNDWATER_MULTIPLIER
      : 1,
    firewoodDemandMultiplier: {
      spring: SPRING_FIREWOOD_DEMAND_MULTIPLIER,
      summer: SUMMER_FIREWOOD_DEMAND_MULTIPLIER,
      autumn: AUTUMN_FIREWOOD_DEMAND_MULTIPLIER,
      winter: WINTER_FIREWOOD_DEMAND_MULTIPLIER,
    }[season],
    pastureCapacityMultiplier: weather === 'drought'
      ? DROUGHT_PASTURE_CAPACITY_MULTIPLIER
      : {
        spring: SPRING_PASTURE_CAPACITY_MULTIPLIER,
        summer: SUMMER_PASTURE_CAPACITY_MULTIPLIER,
        autumn: AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
        winter: WINTER_PASTURE_CAPACITY_MULTIPLIER,
      }[season],
    freshFoodSpoilageFractionPerDay: spoilageMultiplier * (weather === 'drought'
      ? FRESH_FOOD_SPOILAGE_DROUGHT_PER_DAY
      : {
        spring: FRESH_FOOD_SPOILAGE_SPRING_PER_DAY,
        summer: FRESH_FOOD_SPOILAGE_SUMMER_PER_DAY,
        autumn: FRESH_FOOD_SPOILAGE_AUTUMN_PER_DAY,
        winter: FRESH_FOOD_SPOILAGE_WINTER_PER_DAY,
      }[season]),
    preservedFoodSpoilageFractionPerDay:
      preservedFoodSpoilageFractionPerDayFor(season, weather) * spoilageMultiplier,
    preservedFoodDemandMultiplier:
      preservedFoodDemandMultiplierForSeason(season),
    roadTravelSpeedMultiplier: weather === 'rain'
      ? SPRING_RAIN_ROAD_SPEED_MULTIPLIER
      : weather === 'frost'
        ? WINTER_ROAD_SPEED_MULTIPLIER
        : season === 'autumn'
          ? AUTUMN_ROAD_SPEED_MULTIPLIER
          : 1,
    watermillThroughputMultiplier: watermillThroughputForWeather(weather),
    surfaceClayThroughputMultiplier: surfaceClayThroughputForWeather(weather),
    charcoalBurnerThroughputMultiplier:
      charcoalBurnerThroughputForWeather(weather),
  };
}

export function nextDayEnvironmentOutlook(
  seed: number,
  hydrology: number,
  clock: GameClock,
  severeWeatherEnabled = false,
): NextDayEnvironmentOutlook {
  const nextClock = gameClock(
    clock.simTick + CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS,
  );
  return {
    clock: nextClock,
    environment: environmentFor(seed, hydrology, nextClock, severeWeatherEnabled),
  };
}

export function describeNextDayEnvironmentOutlook(
  current: EnvironmentState,
  outlook: NextDayEnvironmentOutlook,
): string {
  const next = outlook.environment;
  const title = describeEnvironment(next).title;
  const currentRoad = Math.round(current.roadTravelSpeedMultiplier * 100);
  const nextRoad = Math.round(next.roadTravelSpeedMultiplier * 100);
  const road = nextRoad < currentRoad
    ? `road-linked movement falls ${currentRoad}% → ${nextRoad}%; pre-haul remote stock and regional orders`
    : nextRoad > currentRoad
      ? `road-linked movement recovers ${currentRoad}% → ${nextRoad}%`
      : nextRoad < 100
        ? `road-linked movement remains ${nextRoad}%`
        : 'road-linked movement remains at full pace';
  const pressures: string[] = [];
  if (Math.abs(next.cropGrowthMultiplier - 1) > 1e-6) {
    pressures.push(`crop growth ${Math.round(next.cropGrowthMultiplier * 100)}%`);
  }
  if (Math.abs(next.pastureCapacityMultiplier - 1) > 1e-6) {
    pressures.push(`pasture ${Math.round(next.pastureCapacityMultiplier * 100)}%`);
  }
  if (Math.abs(next.watermillThroughputMultiplier - 1) > 1e-6) {
    pressures.push(next.watermillThroughputMultiplier <= 1e-6
      ? 'watermills stop'
      : `watermill power ${Math.round(next.watermillThroughputMultiplier * 100)}%`);
  }
  if (Math.abs(next.surfaceClayThroughputMultiplier - 1) > 1e-6) {
    pressures.push(`surface clay digging ${Math.round(next.surfaceClayThroughputMultiplier * 100)}%`);
  }
  if (Math.abs(next.charcoalBurnerThroughputMultiplier - 1) > 1e-6) {
    pressures.push(
      `charcoal burning ${Math.round(next.charcoalBurnerThroughputMultiplier * 100)}%`,
    );
  }
  if (Math.abs(next.firewoodDemandMultiplier - 1) > 1e-6) {
    pressures.push(`firewood demand ${Math.round(next.firewoodDemandMultiplier * 100)}%`);
  }
  pressures.push(
    `fresh-food loss ${(next.freshFoodSpoilageFractionPerDay * 100).toFixed(1)}%/day`,
  );
  pressures.push(
    `cured-food aging ${(next.preservedFoodSpoilageFractionPerDay * 100).toFixed(2)}%/day before storage protection`,
  );
  return `Next dawn, ${formatCalendarDate(outlook.clock)}: ${title} · ${road} · ${pressures.join(' · ')}`;
}

export function describeEnvironment(
  environment: EnvironmentState,
  severeWeatherEnabled = environment.weather === 'drought',
): {
  title: string;
  detail: string;
  symbol: string;
} {
  const roadPenalty = Math.max(0, Math.round((1 - environment.roadTravelSpeedMultiplier) * 100));
  const roadDetail = roadPenalty > 0
    ? ` Dirt-road carts travel ${roadPenalty}% slower; regional caravans and long watch musters face the same ground conditions, so remote branches need earlier dispatch and deeper local reserves.`
    : '';
  if (environment.weather === 'drought') {
    return {
      title: 'Summer drought',
      detail: `Crops and forage grow slowly; the usable aquifer falls to ${Math.round(environment.groundwaterMultiplier * 100)}%, reducing well refill and field moisture; ponds lose fish; fresh food spoils faster, and warm stores age cured provisions fastest. Low streams hold watermills to ${Math.round(environment.watermillThroughputMultiplier * 100)}% throughput, while hardened riverbank clay limits Mining Camp clay work to ${Math.round(environment.surfaceClayThroughputMultiplier * 100)}%. Dry billets raise covered charcoal-clamp pace to ${Math.round(environment.charcoalBurnerThroughputMultiplier * 100)}%, but drought also makes these hot yards most dangerous to surrounding buildings.`,
      symbol: '☀',
    };
  }
  if (environment.weather === 'rain') {
    return {
      title: 'Spring rain',
      detail: `Crops grow faster, shallow groundwater recharges more quickly, raspberries and mushrooms replenish, and mill streams reach ${Math.round(environment.watermillThroughputMultiplier * 100)}% power. Saturated banks hold Mining Camp clay work to ${Math.round(environment.surfaceClayThroughputMultiplier * 100)}%, while damp billets slow covered charcoal clamps to ${Math.round(environment.charcoalBurnerThroughputMultiplier * 100)}%.${roadDetail}`,
      symbol: '☂',
    };
  }
  if (environment.season === 'winter') {
    const snowCover = Math.round(environment.snowCoverage * 100);
    return {
      title: 'Winter frost',
      detail: `Settled snow cover is ${snowCover}% and changes through the winter. Raspberries, mushrooms, fishing, field work, sheep shearing, cattle milking, and watermills stop; release those crews to logging, construction, hunting, wind milling, or baking stockpiled flour. Higher-tier homes burn twice their normal firewood, while cold stores halve cured-food aging. Pasture is scarce, frozen mill races stop water-powered flour production entirely, frozen clay banks limit Mining Camp clay work to ${Math.round(environment.surfaceClayThroughputMultiplier * 100)}%, and snowbound charcoal tending falls to ${Math.round(environment.charcoalBurnerThroughputMultiplier * 100)}%. A well-exposed windmill preserves winter milling capacity, while stockpiled autumn flour, clay, and charcoal keep sheltered processors working.${roadDetail}`,
      symbol: '❄',
    };
  }
  if (environment.season === 'autumn') {
    return {
      title: 'Autumn',
      detail: `Finish the late harvest, then plough and sow winter crops during October and November or lose unfinished fields at winter. Gather the last raspberries, stock firewood, and begin threshing grain and processing the harvest; the first light snow can settle late in November.${roadDetail}`,
      symbol: '♨',
    };
  }
  if (environment.season === 'summer') {
    return {
      title: 'Summer',
      detail: `Crops and forage continue growing while most farm labor is free, and sheep receive their single annual shearing during June–July. Finish manpower-heavy construction and industry, gather remaining raspberries, and recall distant militia before September.${
        severeWeatherEnabled
          ? ' Severe-weather maps can still bring drought that cuts crop growth, well yield, pasture, fish, and mill power.'
          : ''
      }`,
      symbol: '☀',
    };
  }
  return {
    title: 'Spring',
    detail: `The settled snow has cleared and fresh canopy is returning as raspberries and mushrooms replenish, fish reproduce, cattle milking resumes, and autumn-sown crops grow again. March and April are the emergency window for spring oats; frequent rain boosts crop growth and shallow-groundwater recharge but slows dirt roads and threatens exposed supplies${
      severeWeatherEnabled ? ', while severe storms can bring lightning fires' : ''
    }.`,
    symbol: '❀',
  };
}

function springRain(seed: number, hydrology: number, clock: GameClock): boolean {
  const chance = Math.min(0.8, SPRING_RAIN_CHANCE + hydrology / 100 * 0.12);
  const key = (seed >>> 0)
    ^ Math.imul(clock.year, 0x9e3779b9)
    ^ Math.imul(clock.totalDays >>> 0, 0x85ebca6b);
  return unitRoll(key) < chance;
}

function summerDrought(seed: number, hydrology: number, clock: GameClock): boolean {
  const chance = Math.max(0.12, Math.min(0.65, SUMMER_DROUGHT_CHANCE * (1.15 - hydrology / 100 * 0.5)));
  const yearKey = ((seed >>> 0) ^ Math.imul(clock.year, 0xc2b2ae35) ^ 0x7f4a7c15) >>> 0;
  if (unitRoll(yearKey) >= chance) return false;
  const summerDays = CALENDAR_DAYS_PER_MONTH * 3;
  const duration = Math.max(1, Math.min(summerDays, SUMMER_DROUGHT_DURATION_DAYS));
  const possibleStarts = Math.max(1, summerDays - duration + 1);
  const start = mix32(yearKey ^ 0x27d4eb2d) % possibleStarts;
  const summerDay = (clock.month - 6) * CALENDAR_DAYS_PER_MONTH + clock.monthDay - 1;
  return summerDay >= start && summerDay < start + duration;
}

function unitRoll(value: number): number {
  return (mix32(value) % 10_000) / 10_000;
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed = (mixed ^ (mixed >>> 16)) >>> 0;
  mixed = Math.imul(mixed, 0x7feb352d) >>> 0;
  mixed = (mixed ^ (mixed >>> 15)) >>> 0;
  mixed = Math.imul(mixed, 0x846ca68b) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
}
