import {
  AUTUMN_FIREWOOD_DEMAND_MULTIPLIER,
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  AUTUMN_ROAD_SPEED_MULTIPLIER,
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_SECONDS_PER_DAY,
  DROUGHT_CROP_GROWTH_MULTIPLIER,
  DROUGHT_PASTURE_CAPACITY_MULTIPLIER,
  FRESH_FOOD_SPOILAGE_AUTUMN_PER_DAY,
  FRESH_FOOD_SPOILAGE_DROUGHT_PER_DAY,
  FRESH_FOOD_SPOILAGE_SPRING_PER_DAY,
  FRESH_FOOD_SPOILAGE_SUMMER_PER_DAY,
  FRESH_FOOD_SPOILAGE_WINTER_PER_DAY,
  SPRING_FIREWOOD_DEMAND_MULTIPLIER,
  SPRING_PASTURE_CAPACITY_MULTIPLIER,
  SPRING_RAIN_CHANCE,
  SPRING_RAIN_CROP_GROWTH_MULTIPLIER,
  SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
  SUMMER_DROUGHT_CHANCE,
  SUMMER_DROUGHT_DURATION_DAYS,
  SUMMER_FIREWOOD_DEMAND_MULTIPLIER,
  SUMMER_PASTURE_CAPACITY_MULTIPLIER,
  SIM_TICK_SECONDS,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
  WINTER_PASTURE_CAPACITY_MULTIPLIER,
  WINTER_ROAD_SPEED_MULTIPLIER,
} from '../generated/gameBalance.ts';
import {
  formatCalendarDate,
  gameClock,
  type GameClock,
} from './gameCalendar.ts';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type WeatherKind = 'fair' | 'rain' | 'drought' | 'frost';

export type EnvironmentState = {
  season: Season;
  weather: WeatherKind;
  cropGrowthMultiplier: number;
  firewoodDemandMultiplier: number;
  pastureCapacityMultiplier: number;
  freshFoodSpoilageFractionPerDay: number;
  roadTravelSpeedMultiplier: number;
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

export function environmentFor(
  seed: number,
  hydrology: number,
  clock: GameClock,
): EnvironmentState {
  const season = seasonForMonth(clock.month);
  const weather: WeatherKind = season === 'spring' && springRain(seed, hydrology, clock)
    ? 'rain'
    : season === 'summer' && summerDrought(seed, hydrology, clock)
      ? 'drought'
      : season === 'winter'
        ? 'frost'
        : 'fair';

  return {
    season,
    weather,
    cropGrowthMultiplier: weather === 'rain'
      ? SPRING_RAIN_CROP_GROWTH_MULTIPLIER
      : weather === 'drought'
        ? DROUGHT_CROP_GROWTH_MULTIPLIER
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
    freshFoodSpoilageFractionPerDay: weather === 'drought'
      ? FRESH_FOOD_SPOILAGE_DROUGHT_PER_DAY
      : {
        spring: FRESH_FOOD_SPOILAGE_SPRING_PER_DAY,
        summer: FRESH_FOOD_SPOILAGE_SUMMER_PER_DAY,
        autumn: FRESH_FOOD_SPOILAGE_AUTUMN_PER_DAY,
        winter: FRESH_FOOD_SPOILAGE_WINTER_PER_DAY,
      }[season],
    roadTravelSpeedMultiplier: weather === 'rain'
      ? SPRING_RAIN_ROAD_SPEED_MULTIPLIER
      : weather === 'frost'
        ? WINTER_ROAD_SPEED_MULTIPLIER
        : season === 'autumn'
          ? AUTUMN_ROAD_SPEED_MULTIPLIER
          : 1,
  };
}

export function nextDayEnvironmentOutlook(
  seed: number,
  hydrology: number,
  clock: GameClock,
): NextDayEnvironmentOutlook {
  const nextClock = gameClock(
    clock.simTick + CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS,
  );
  return {
    clock: nextClock,
    environment: environmentFor(seed, hydrology, nextClock),
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
  if (Math.abs(next.firewoodDemandMultiplier - 1) > 1e-6) {
    pressures.push(`firewood demand ${Math.round(next.firewoodDemandMultiplier * 100)}%`);
  }
  pressures.push(
    `fresh-food loss ${(next.freshFoodSpoilageFractionPerDay * 100).toFixed(1)}%/day`,
  );
  return `Next dawn, ${formatCalendarDate(outlook.clock)}: ${title} · ${road} · ${pressures.join(' · ')}`;
}

export function describeEnvironment(environment: EnvironmentState): {
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
      detail: 'Crops and forage grow slowly; ponds lose fish; wells refill slowly; fresh food spoils faster.',
      symbol: '☀',
    };
  }
  if (environment.weather === 'rain') {
    return {
      title: 'Spring rain',
      detail: `Crops grow faster, wells refill faster, and berries and mushrooms replenish.${roadDetail}`,
      symbol: '☂',
    };
  }
  if (environment.season === 'winter') {
    return {
      title: 'Winter frost',
      detail: `Forage and fishing stop, pasture is scarce, sheep cannot be shorn, and homes burn more firewood.${roadDetail}`,
      symbol: '❄',
    };
  }
  if (environment.season === 'autumn') {
    return {
      title: 'Autumn',
      detail: `Harvest crops in September; plough and sow during October and November.${roadDetail}`,
      symbol: '♨',
    };
  }
  if (environment.season === 'summer') {
    return {
      title: 'Summer',
      detail: 'Crops and forage continue growing; drought remains the main seasonal risk.',
      symbol: '☀',
    };
  }
  return {
    title: 'Spring',
    detail: 'Crops resume growth; fish reproduce; berries and mushrooms replenish.',
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
