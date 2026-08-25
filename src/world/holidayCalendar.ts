import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_DAYS_PER_WEEK,
  CALENDAR_MONTHS_PER_YEAR,
  CALENDAR_START_MONTH,
  CALENDAR_SUNDAY_WEEKDAY,
} from '../generated/gameBalance.ts';
import type { GameClock } from './gameCalendar.ts';

export const HISTORICAL_HOLIDAY_BASE_YEAR = 1550;
export const HISTORICAL_HOLIDAY_CYCLE_YEARS = 10;

export type HolidayCelebrationKind =
  | 'solemn'
  | 'procession'
  | 'bonfire'
  | 'fair'
  | 'household'
  | 'carnival';

export type HolidayObservance = {
  readonly id: string;
  readonly label: string;
  readonly periodLabel: string;
  readonly kind: HolidayCelebrationKind;
  readonly periodDay: number;
  readonly periodLength: number;
  readonly historicalYear: number;
};

type HolidayDefinition = Omit<HolidayObservance, 'historicalYear'>;

const FIXED_HOLIDAYS = new Map<string, HolidayDefinition>([
  fixed(1, 1, 'circumcision', 'Circumcision of the Lord', 'New Year holy day', 'solemn'),
  fixed(1, 6, 'epiphany', 'Epiphany', 'Christmas holy days', 'procession'),
  fixed(2, 2, 'candlemas', 'Candlemas', 'Candlemas', 'procession'),
  fixed(3, 25, 'annunciation', 'Annunciation', 'Annunciation', 'solemn'),
  fixed(4, 23, 'jurjevo', 'Jurjevo · St George', 'Jurjevo', 'bonfire'),
  fixed(6, 24, 'ivanje', 'Ivanje · St John', 'Ivanje', 'bonfire'),
  fixed(6, 29, 'peter-and-paul', 'Sts Peter and Paul', 'Sts Peter and Paul', 'solemn'),
  fixed(8, 15, 'assumption', 'Assumption of Mary', 'Assumption', 'procession'),
  fixed(9, 8, 'nativity-of-mary', 'Nativity of Mary', 'Nativity of Mary', 'solemn'),
  fixed(9, 29, 'michaelmas', 'Michaelmas', 'Michaelmas', 'solemn'),
  fixed(11, 1, 'all-saints', 'All Saints', 'All Saints', 'solemn'),
  fixed(11, 11, 'martinje', 'Martinje · St Martin', 'Martinje', 'fair'),
  fixed(12, 6, 'st-nicholas', 'St Nicholas', 'St Nicholas', 'solemn'),
  fixed(12, 24, 'christmas-eve', 'Christmas Eve', 'Christmas holy days', 'household', 1, 3),
  fixed(12, 25, 'christmas', 'Christmas Day', 'Christmas holy days', 'household', 2, 3),
  fixed(12, 26, 'st-stephen', 'St Stephen', 'Christmas holy days', 'household', 3, 3),
]);

const MOVABLE_HOLIDAYS = new Map<number, HolidayDefinition>([
  [-48, movable('shrove-monday', 'Shrove Monday', 'Shrovetide', 'carnival', 1, 2)],
  [-47, movable('shrove-tuesday', 'Shrove Tuesday', 'Shrovetide', 'carnival', 2, 2)],
  [-2, movable('good-friday', 'Good Friday', 'Paschal holy days', 'solemn', 1, 4)],
  [-1, movable('holy-saturday', 'Holy Saturday', 'Paschal holy days', 'solemn', 2, 4)],
  [0, movable('easter', 'Easter Sunday', 'Paschal holy days', 'procession', 3, 4)],
  [1, movable('easter-monday', 'Easter Monday', 'Paschal holy days', 'household', 4, 4)],
  [39, movable('ascension', 'Ascension', 'Ascension', 'procession')],
  [49, movable('pentecost', 'Pentecost', 'Whitsun holy days', 'procession', 1, 2)],
  [50, movable('whit-monday', 'Whit Monday', 'Whitsun holy days', 'household', 2, 2)],
  [60, movable('corpus-christi', 'Corpus Christi', 'Corpus Christi', 'procession')],
]);

/**
 * Maps simulation years onto a repeating 1550-1559 Julian computus. The game
 * deliberately keeps rational 30-day months, so a real-world day 31 is folded
 * onto day 30 while relative Easter feasts retain their proper spacing.
 */
export function historicalHolidayYear(gameYear: number): number {
  const zeroBased = Math.max(0, Math.floor(gameYear) - 1);
  return HISTORICAL_HOLIDAY_BASE_YEAR
    + zeroBased % HISTORICAL_HOLIDAY_CYCLE_YEARS;
}

export function holidayObservanceForClock(
  clock: Pick<GameClock, 'month' | 'monthDay' | 'year'>,
): HolidayObservance | null {
  const historicalYear = historicalHolidayYear(clock.year);
  const dayOfYear = rationalDayOfYear(clock.month, clock.monthDay);
  const easterDay = julianEasterRationalDayOfYear(historicalYear);
  const movable = MOVABLE_HOLIDAYS.get(dayOfYear - easterDay);
  const definition = movable ?? FIXED_HOLIDAYS.get(dateKey(clock.month, clock.monthDay));
  return definition ? { ...definition, historicalYear } : null;
}

export function isHoliday(clock: Pick<GameClock, 'month' | 'monthDay' | 'year'>): boolean {
  return holidayObservanceForClock(clock) !== null;
}

export function holidayObservanceAtDayOffset(
  clock: Pick<GameClock, 'month' | 'monthDay' | 'year'>,
  dayOffset: number,
): HolidayObservance | null {
  const daysPerYear = CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
  const absoluteDay = Math.max(
    0,
    (Math.max(1, Math.floor(clock.year)) - 1) * daysPerYear
      + (clock.month - 1) * CALENDAR_DAYS_PER_MONTH
      + Math.max(0, clock.monthDay - 1)
      + Math.floor(dayOffset),
  );
  const year = Math.floor(absoluteDay / daysPerYear) + 1;
  const dayOfYear = absoluteDay % daysPerYear;
  return holidayObservanceForClock({
    year,
    month: Math.floor(dayOfYear / CALENDAR_DAYS_PER_MONTH) + 1,
    monthDay: dayOfYear % CALENDAR_DAYS_PER_MONTH + 1,
  });
}

const PRODUCTIVE_SHARE_CYCLE_YEARS = 70;
const PRODUCTIVE_DAY_SHARES = computeAverageProductiveDayShares();

/** Long-run labor-day share including every named holiday and optional Sabbath. */
export function averageProductiveCalendarDayShare(
  sabbathObserved: boolean,
): number {
  return sabbathObserved
    ? PRODUCTIVE_DAY_SHARES.withSabbath
    : PRODUCTIVE_DAY_SHARES.withoutSabbath;
}

export function julianEasterDate(year: number): { month: number; day: number } {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const value = d + e + 114;
  return {
    month: Math.floor(value / 31),
    day: value % 31 + 1,
  };
}

function julianEasterRationalDayOfYear(year: number): number {
  const easter = julianEasterDate(year);
  return rationalDayOfYear(easter.month, Math.min(easter.day, CALENDAR_DAYS_PER_MONTH));
}

function rationalDayOfYear(month: number, day: number): number {
  return (month - 1) * CALENDAR_DAYS_PER_MONTH + day - 1;
}

function fixed(
  month: number,
  day: number,
  id: string,
  label: string,
  periodLabel: string,
  kind: HolidayCelebrationKind,
  periodDay = 1,
  periodLength = 1,
): [string, HolidayDefinition] {
  return [dateKey(month, day), {
    id,
    label,
    periodLabel,
    kind,
    periodDay,
    periodLength,
  }];
}

function movable(
  id: string,
  label: string,
  periodLabel: string,
  kind: HolidayCelebrationKind,
  periodDay = 1,
  periodLength = 1,
): HolidayDefinition {
  return { id, label, periodLabel, kind, periodDay, periodLength };
}

function dateKey(month: number, day: number): string {
  return `${month}:${day}`;
}

function computeAverageProductiveDayShares(): {
  withoutSabbath: number;
  withSabbath: number;
} {
  const daysPerYear = CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
  const totalDays = PRODUCTIVE_SHARE_CYCLE_YEARS * daysPerYear;
  let withoutSabbath = 0;
  let withSabbath = 0;
  for (let year = 1; year <= PRODUCTIVE_SHARE_CYCLE_YEARS; year += 1) {
    for (let dayOfYear = 0; dayOfYear < daysPerYear; dayOfYear += 1) {
      const month = Math.floor(dayOfYear / CALENDAR_DAYS_PER_MONTH) + 1;
      const monthDay = dayOfYear % CALENDAR_DAYS_PER_MONTH + 1;
      if (isHoliday({ year, month, monthDay })) continue;
      withoutSabbath += 1;
      const daysSinceSimulationStart = (year - 1) * daysPerYear
        + (month - CALENDAR_START_MONTH) * CALENDAR_DAYS_PER_MONTH
        + monthDay - 1;
      const weekday = (
        daysSinceSimulationStart % CALENDAR_DAYS_PER_WEEK
        + CALENDAR_DAYS_PER_WEEK
      ) % CALENDAR_DAYS_PER_WEEK;
      if (weekday !== CALENDAR_SUNDAY_WEEKDAY) withSabbath += 1;
    }
  }
  return {
    withoutSabbath: withoutSabbath / totalDays,
    withSabbath: withSabbath / totalDays,
  };
}
