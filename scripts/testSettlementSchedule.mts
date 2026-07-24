import assert from 'node:assert/strict';
import {
  CALENDAR_DAY_START_OFFSET_SECONDS,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_START_HOUR,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import { gameClock, gameClockAtElapsedSeconds, isLaborPaused, laborPauseLabel } from '../src/world/gameCalendar.ts';
import {
  deriveSettlementSchedule,
  expectLaborPausedLikeServer,
  settlementScheduleDirtyKey,
} from '../src/world/settlementSchedule.ts';
import { deriveInterpolatedSettlementSchedule } from '../src/world/settlementSchedule.ts';
import { DEFAULT_PARISH_POLICY } from '../src/economy/chapelParish.ts';
import { interpolatedSimElapsedSeconds } from '../src/app/settlementSchedulePresentation.ts';
import type { GameState } from '../src/resources/types.ts';

const secondsPerGameHour = CALENDAR_SECONDS_PER_DAY / 24;
const secondsPerGameMinute = secondsPerGameHour / 60;
const nightTick = Math.ceil((17 * secondsPerGameHour) / SIM_TICK_SECONDS);
const workHourTick = 0;
const middayTick = (
  12 * secondsPerGameHour - CALENDAR_DAY_START_OFFSET_SECONDS
) / SIM_TICK_SECONDS;
const mondayWorkMorningElapsed =
  CALENDAR_SECONDS_PER_DAY
  + CALENDAR_WORK_START_HOUR * secondsPerGameHour
  + secondsPerGameMinute
  - CALENDAR_DAY_START_OFFSET_SECONDS;
const workMorningTick = mondayWorkMorningElapsed / SIM_TICK_SECONDS;

const nightClock = gameClock(nightTick);
assert.equal(isLaborPaused(nightClock, false, false), true);
assert.equal(laborPauseLabel(nightClock, false, false), 'Night hours');
assert.equal(expectLaborPausedLikeServer(nightClock, false, false), true);

const workClock = gameClock(workHourTick);
assert.equal(isLaborPaused(workClock, false, false), false);
assert.equal(laborPauseLabel(workClock, false, false), null);
assert.equal(expectLaborPausedLikeServer(workClock, false, false), false);

const sundayWorkTick = workHourTick;
const sundayClock = gameClock(sundayWorkTick);
assert.equal(sundayClock.isSunday, true, 'work-hour tick should land on Sunday (day 0)');
assert.equal(sundayClock.isWorkHours, true);
assert.equal(isLaborPaused(sundayClock, true, true), true);
assert.equal(laborPauseLabel(sundayClock, true, true), 'Sunday sabbath');
assert.equal(expectLaborPausedLikeServer(sundayClock, true, true), true);

assert.equal(isLaborPaused(sundayClock, true, false), false);
assert.equal(expectLaborPausedLikeServer(sundayClock, true, false), false);

const schedule = deriveSettlementSchedule(
  { simTick: nightTick, parishPolicy: DEFAULT_PARISH_POLICY },
  null,
);
assert.equal(schedule.laborPaused, true);
assert.equal(schedule.dayNight.smokeAllowed, false);
assert.equal(schedule.dayNight.isNight, true);

const daySchedule = deriveSettlementSchedule(
  { simTick: middayTick, parishPolicy: DEFAULT_PARISH_POLICY },
  null,
);
assert.equal(daySchedule.laborPaused, false);
assert.equal(daySchedule.dayNight.smokeAllowed, true);
assert.equal(daySchedule.dayNight.isNight, false);
assert.ok(
  daySchedule.dayNight.buildingIndirectIntensity > schedule.dayNight.buildingIndirectIntensity,
  'daylight should provide more indirect building-face light than night',
);
assert.ok(daySchedule.dayNight.buildingIndirectIntensity >= 0.08);
assert.ok(schedule.dayNight.buildingIndirectIntensity <= 0.03);

const gameState = {
  buildings: new Map([
    ['chapel-1', {
      id: 'chapel-1',
      kind: 'chapel' as const,
      x: 0,
      z: 0,
      assignedLabor: 1,
      timber: 0,
      stone: 0,
      firewood: 0,
      water: 0,
      food: 0,
      gold: 0,
    }],
  ]),
} as unknown as GameState;

const staffedKey = settlementScheduleDirtyKey(
  { simTick: workHourTick, parishPolicy: { ...DEFAULT_PARISH_POLICY, sabbathObservanceEnabled: true } },
  gameState,
);
const unstaffedKey = settlementScheduleDirtyKey(
  { simTick: workHourTick, parishPolicy: { ...DEFAULT_PARISH_POLICY, sabbathObservanceEnabled: true } },
  null,
);
assert.notEqual(staffedKey, unstaffedKey);

const staffedSunday = deriveSettlementSchedule(
  { simTick: sundayWorkTick, parishPolicy: { ...DEFAULT_PARISH_POLICY, sabbathObservanceEnabled: true } },
  gameState,
);
assert.equal(staffedSunday.laborPaused, true);
assert.equal(staffedSunday.staffedChapel, true);

const elapsedAtWork = workMorningTick * SIM_TICK_SECONDS;
const interpolatedWork = deriveInterpolatedSettlementSchedule(
  elapsedAtWork + secondsPerGameMinute * 0.5,
  DEFAULT_PARISH_POLICY,
  null,
);
assert.equal(interpolatedWork.laborPaused, false);
assert.equal(interpolatedWork.clock.minute, 1);

const clockFromElapsed = gameClockAtElapsedSeconds(
  elapsedAtWork + secondsPerGameMinute * 1.01,
);
assert.equal(clockFromElapsed.hour, CALENDAR_WORK_START_HOUR);
assert.equal(clockFromElapsed.minute, 2);
assert.equal(gameClock(workMorningTick).hour, CALENDAR_WORK_START_HOUR);
assert.ok(Math.abs(interpolatedSimElapsedSeconds(0, 1, 1) - 0.4) < 1e-9);
assert.ok(Math.abs(interpolatedSimElapsedSeconds(0, 1, 4) - 1.6) < 1e-9);
assert.equal(interpolatedSimElapsedSeconds(0, 10, 0), 0);

console.log('settlement schedule tests passed');
