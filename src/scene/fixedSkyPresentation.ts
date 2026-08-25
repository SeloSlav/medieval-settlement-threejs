import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
} from '../generated/gameBalance.ts';
import {
  computeDayNightState,
  type DayNightLightingState,
} from '../world/dayNightPresentation.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import {
  fixedSkyPreset,
  type FixedSkyPresetId,
} from './skyPresentationPreference.ts';

/** Builds a completely static client-side sky without altering the simulation clock. */
export function computeFixedSkyState(
  presetId: FixedSkyPresetId,
  target?: DayNightLightingState,
): DayNightLightingState {
  return computeDayNightState(fixedSkyPresentationClock(presetId), false, target);
}

/** Cosmetic clock paired with a fixed sky for household lights and smoke. */
export function fixedSkyPresentationClock(
  presetId: FixedSkyPresetId,
  target?: GameClock,
): GameClock {
  const preset = fixedSkyPreset(presetId);
  const hour = Math.floor(preset.hour);
  const minute = Math.floor((preset.hour - hour) * 60);
  const preciseCalendarDay = (preset.month - 1) * CALENDAR_DAYS_PER_MONTH
    + (preset.monthDay - 1)
    + preset.hour / CALENDAR_HOURS_PER_DAY;
  const clock = target ?? {
    simTick: 0,
    totalDays: 0,
    hour: 0,
    minute: 0,
    weekday: 0,
    monthDay: 0,
    month: 0,
    year: 1,
    isSunday: false,
    isWorkHours: false,
  };
  clock.simTick = 0;
  clock.totalDays = Math.floor(preciseCalendarDay);
  clock.hour = hour;
  clock.minute = minute;
  clock.preciseHour = preset.hour;
  clock.preciseCalendarDay = preciseCalendarDay;
  clock.weekday = 0;
  clock.monthDay = preset.monthDay;
  clock.month = preset.month;
  clock.year = 1;
  clock.isSunday = false;
  clock.isWorkHours = hour >= CALENDAR_WORK_START_HOUR && hour < CALENDAR_WORK_END_HOUR;
  return clock;
}
