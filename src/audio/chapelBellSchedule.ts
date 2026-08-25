import {
  CALENDAR_WORK_START_HOUR,
} from '../generated/gameBalance.ts';

/** 6 AM — the morning Angelus. */
export const CHAPEL_BELL_MORNING_HOUR = CALENDAR_WORK_START_HOUR;

/** Noon — the midday Angelus. */
export const CHAPEL_BELL_NOON_HOUR = 12;

/** 6 PM — evening bell before night hours. */
export const CHAPEL_BELL_EVENING_HOUR = 18;

export const CHAPEL_BELL_UNPRIMED_HOUR = -1;

export function isChapelBellHour(hour: number): boolean {
  return hour === CHAPEL_BELL_MORNING_HOUR
    || hour === CHAPEL_BELL_NOON_HOUR
    || hour === CHAPEL_BELL_EVENING_HOUR;
}
