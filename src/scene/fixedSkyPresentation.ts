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
  const preset = fixedSkyPreset(presetId);
  const hour = Math.floor(preset.hour);
  const minute = Math.floor((preset.hour - hour) * 60);
  const preciseCalendarDay = (preset.month - 1) * CALENDAR_DAYS_PER_MONTH
    + (preset.monthDay - 1)
    + preset.hour / CALENDAR_HOURS_PER_DAY;
  const clock: GameClock = {
    simTick: 0,
    totalDays: Math.floor(preciseCalendarDay),
    hour,
    minute,
    preciseHour: preset.hour,
    preciseCalendarDay,
    weekday: 0,
    monthDay: preset.monthDay,
    month: preset.month,
    year: 1,
    isSunday: false,
    isWorkHours: hour >= CALENDAR_WORK_START_HOUR && hour < CALENDAR_WORK_END_HOUR,
  };
  return computeDayNightState(clock, false, target);
}
