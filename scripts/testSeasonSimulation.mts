import assert from 'node:assert/strict';
import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_MONTHS_PER_YEAR,
  CALENDAR_SECONDS_PER_DAY,
  SIM_REALTIME_RATE,
} from '../src/generated/gameBalance.ts';
import { gameClock } from '../src/world/gameCalendar.ts';
import {
  GAME_SPEEDS,
  PLAYER_GAME_SPEEDS,
  gameSpeedLabel,
  normalizeGameSpeed,
} from '../src/world/gameSpeed.ts';
import { environmentFor, seasonForMonth } from '../src/world/seasonPolicy.ts';

assert.equal(CALENDAR_SECONDS_PER_DAY, 120);
assert.equal(CALENDAR_DAYS_PER_MONTH, 10);
assert.equal(CALENDAR_MONTHS_PER_YEAR, 12);

const start = gameClock(0);
assert.deepEqual(
  { month: start.month, day: start.monthDay, hour: start.hour, minute: start.minute },
  { month: 3, day: 1, hour: 6, minute: 0 },
);

assert.equal(seasonForMonth(3), 'spring');
assert.equal(seasonForMonth(8), 'summer');
assert.equal(seasonForMonth(9), 'autumn');
assert.equal(seasonForMonth(12), 'winter');

assert.deepEqual(GAME_SPEEDS, [0, 1, 4, 12]);
assert.deepEqual(PLAYER_GAME_SPEEDS, [1, 4, 12]);
assert.equal(normalizeGameSpeed(99), 1);
assert.equal(gameSpeedLabel(0), 'Paused');
assert.equal(gameSpeedLabel(1), 'Leisurely');
assert.equal(gameSpeedLabel(12), 'Very fast');

const dayTicks = CALENDAR_SECONDS_PER_DAY / 0.2;
const springClock = gameClock(2 * dayTicks);
assert.deepEqual(
  environmentFor(12345, 50, springClock),
  environmentFor(12345, 50, springClock),
  'weather must be deterministic for the same world and day',
);

let droughtFound = false;
for (let year = 1; year <= 20 && !droughtFound; year += 1) {
  for (let summerDay = 0; summerDay < CALENDAR_DAYS_PER_MONTH * 3; summerDay += 1) {
    const elapsedDays = (year - 1) * CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR
      + (6 - 3) * CALENDAR_DAYS_PER_MONTH
      + summerDay;
    const clock = gameClock(elapsedDays * dayTicks);
    const environment = environmentFor(12345, 35, clock);
    if (environment.weather !== 'drought') continue;
    droughtFound = true;
    assert.ok(environment.cropGrowthMultiplier < 1);
    assert.ok(environment.pastureCapacityMultiplier < 1);
    break;
  }
}
assert.equal(droughtFound, true, 'deterministic climate should produce drought years');

const durations = {
  leisurely: {
    dayMinutes: CALENDAR_SECONDS_PER_DAY / SIM_REALTIME_RATE / 60,
    monthMinutes: CALENDAR_SECONDS_PER_DAY * CALENDAR_DAYS_PER_MONTH / SIM_REALTIME_RATE / 60,
    yearMinutes: CALENDAR_SECONDS_PER_DAY * CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR / SIM_REALTIME_RATE / 60,
  },
  veryFastYearMinutes:
    CALENDAR_SECONDS_PER_DAY * CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR / SIM_REALTIME_RATE / 60 / 12,
};
assert.ok(Math.abs(durations.leisurely.dayMinutes - 5) < 1e-9);
assert.ok(Math.abs(durations.leisurely.monthMinutes - 50) < 1e-9);
assert.ok(Math.abs(durations.leisurely.yearMinutes - 600) < 1e-9);
assert.ok(Math.abs(durations.veryFastYearMinutes - 50) < 1e-9);

console.log('season and simulation-speed tests passed');
