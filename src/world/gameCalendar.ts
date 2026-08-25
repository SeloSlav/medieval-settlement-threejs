import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_DAYS_PER_WEEK,
  CALENDAR_DAY_START_OFFSET_SECONDS,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_MONTHS_PER_YEAR,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_START_MONTH,
  CALENDAR_SUNDAY_WEEKDAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import { holidayObservanceForClock } from './holidayCalendar.ts';

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export type GameClock = {
  simTick: number;
  totalDays: number;
  hour: number;
  minute: number;
  /** Continuous hour used by presentation systems; HUD and schedules stay minute-based. */
  preciseHour?: number;
  /** Continuous zero-based day within the fictional year, including time-of-day. */
  preciseCalendarDay?: number;
  weekday: number;
  monthDay: number;
  month: number;
  year: number;
  isSunday: boolean;
  isWorkHours: boolean;
};

export function simElapsedSeconds(simTick: number): number {
  return Math.max(0, simTick) * SIM_TICK_SECONDS;
}

export function gameClock(simTick: number): GameClock {
  return gameClockAtElapsedSeconds(simElapsedSeconds(simTick));
}

export function gameClockAtElapsedSeconds(
  elapsedSeconds: number,
  target?: GameClock,
): GameClock {
  const elapsed = Math.max(0, elapsedSeconds);
  const calendarElapsed = elapsed + CALENDAR_DAY_START_OFFSET_SECONDS;
  const simTick = elapsed / SIM_TICK_SECONDS;
  const totalDays = Math.floor(calendarElapsed / CALENDAR_SECONDS_PER_DAY);
  const secondsIntoDay = calendarElapsed % CALENDAR_SECONDS_PER_DAY;
  const hoursIntoDay = secondsIntoDay / CALENDAR_SECONDS_PER_DAY * CALENDAR_HOURS_PER_DAY;
  const hour = Math.min(CALENDAR_HOURS_PER_DAY - 1, Math.floor(hoursIntoDay));
  const minute = Math.min(59, Math.floor((hoursIntoDay - hour) * 60));
  const weekday = totalDays % CALENDAR_DAYS_PER_WEEK;
  const daysPerYear = CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
  const startDayOfYear = (CALENDAR_START_MONTH - 1) * CALENDAR_DAYS_PER_MONTH;
  const absoluteCalendarDay = startDayOfYear + totalDays;
  const dayOfYear = absoluteCalendarDay % daysPerYear;
  const month = Math.floor(dayOfYear / CALENDAR_DAYS_PER_MONTH) + 1;
  const monthDay = (dayOfYear % CALENDAR_DAYS_PER_MONTH) + 1;
  const year = Math.floor(absoluteCalendarDay / daysPerYear) + 1;
  const isSunday = weekday === CALENDAR_SUNDAY_WEEKDAY;
  const isWorkHours = hour >= CALENDAR_WORK_START_HOUR && hour < CALENDAR_WORK_END_HOUR;

  const clock = target ?? {
    simTick: 0,
    totalDays: 0,
    hour: 0,
    minute: 0,
    weekday: 0,
    monthDay: 0,
    month: 0,
    year: 0,
    isSunday: false,
    isWorkHours: false,
  };
  clock.simTick = simTick;
  clock.totalDays = totalDays;
  clock.hour = hour;
  clock.minute = minute;
  clock.preciseHour = hoursIntoDay;
  clock.preciseCalendarDay = dayOfYear + hoursIntoDay / CALENDAR_HOURS_PER_DAY;
  clock.weekday = weekday;
  clock.monthDay = monthDay;
  clock.month = month;
  clock.year = year;
  clock.isSunday = isSunday;
  clock.isWorkHours = isWorkHours;
  return clock;
}

export function formatClockTime(clock: GameClock): string {
  const hours = String(clock.hour).padStart(2, '0');
  const minutes = String(clock.minute).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function formatCalendarMonthDay(clock: GameClock): string {
  const monthName = MONTH_NAMES[clock.month - 1] ?? `Month ${clock.month}`;
  return `${clock.monthDay} ${monthName}`;
}

export function formatCalendarDate(clock: GameClock): string {
  return `${formatCalendarMonthDay(clock)}, Year ${clock.year}`;
}

export function formatWeekday(clock: GameClock): string {
  return WEEKDAY_NAMES[clock.weekday] ?? `Day ${clock.weekday}`;
}

export function formatSettlementClock(simTick: number): string {
  const clock = gameClock(simTick);
  return `${formatCalendarDate(clock)} · ${formatClockTime(clock)}`;
}

export function isLaborPaused(
  clock: GameClock,
  sabbathObservanceEnabled: boolean,
  staffedChapel: boolean,
): boolean {
  if (holidayObservanceForClock(clock)) {
    return true;
  }
  if (clock.isSunday && sabbathObservanceEnabled && staffedChapel) {
    return true;
  }
  return false;
}

export function laborPauseLabel(
  clock: GameClock,
  sabbathObservanceEnabled: boolean,
  staffedChapel: boolean,
): string | null {
  const holiday = holidayObservanceForClock(clock);
  if (holiday) {
    return holiday.label;
  }
  if (clock.isSunday && sabbathObservanceEnabled && staffedChapel) {
    return 'Sunday sabbath';
  }
  return null;
}

/** One in-game day for runway and per-day economy displays. */
export const GAME_DAY_SECONDS = CALENDAR_SECONDS_PER_DAY;
export const SECONDS_PER_DAY = CALENDAR_SECONDS_PER_DAY;
