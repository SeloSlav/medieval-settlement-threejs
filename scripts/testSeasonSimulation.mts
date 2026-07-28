import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_MONTHS_PER_YEAR,
  CALENDAR_SECONDS_PER_DAY,
  DROUGHT_WATERMILL_THROUGHPUT_MULTIPLIER,
  SIM_REALTIME_RATE,
  SPRING_RAIN_WATERMILL_THROUGHPUT_MULTIPLIER,
  WINTER_WATERMILL_THROUGHPUT_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import { gameClock } from '../src/world/gameCalendar.ts';
import {
  GAME_SPEEDS,
  PLAYER_GAME_SPEED_HOTKEYS,
  PLAYER_GAME_SPEEDS,
  gameSpeedForHotkey,
  gameSpeedLabel,
  hotkeyForGameSpeed,
  normalizeGameSpeed,
} from '../src/world/gameSpeed.ts';
import {
  describeEnvironment,
  describeNextDayEnvironmentOutlook,
  environmentFor,
  nextDayEnvironmentOutlook,
  seasonForMonth,
} from '../src/world/seasonPolicy.ts';
import { GAME_CONTROL_SECTIONS } from '../src/ui/gameControlsReference.ts';

assert.equal(CALENDAR_SECONDS_PER_DAY, 120);
assert.equal(CALENDAR_DAYS_PER_MONTH, 10);
assert.equal(CALENDAR_MONTHS_PER_YEAR, 12);

const start = gameClock(0);
assert.deepEqual(
  { month: start.month, day: start.monthDay, hour: start.hour, minute: start.minute },
  { month: 3, day: 1, hour: 8, minute: 0 },
);

assert.equal(seasonForMonth(3), 'spring');
assert.equal(seasonForMonth(8), 'summer');
assert.equal(seasonForMonth(9), 'autumn');
assert.equal(seasonForMonth(12), 'winter');

assert.deepEqual(GAME_SPEEDS, [0, 1, 5, 20, 120]);
assert.deepEqual(PLAYER_GAME_SPEEDS, [1, 5, 20, 120]);
assert.deepEqual(PLAYER_GAME_SPEED_HOTKEYS, ['1', '2', '3', '4']);
assert.equal(gameSpeedForHotkey('1'), 1);
assert.equal(gameSpeedForHotkey('2'), 5);
assert.equal(gameSpeedForHotkey('3'), 20);
assert.equal(gameSpeedForHotkey('4'), 120);
assert.equal(gameSpeedForHotkey('0'), null);
assert.equal(gameSpeedForHotkey('5'), null);
assert.equal(hotkeyForGameSpeed(0), null);
assert.equal(hotkeyForGameSpeed(1), '1');
assert.equal(hotkeyForGameSpeed(5), '2');
assert.equal(hotkeyForGameSpeed(20), '3');
assert.equal(hotkeyForGameSpeed(120), '4');
assert.deepEqual(
  GAME_CONTROL_SECTIONS.find((section) => section.title === 'Simulation speed')?.entries,
  [
    { action: 'Scenic (1×)', keys: '1' },
    { action: 'Normal (5×)', keys: '2' },
    { action: 'Fast (20×)', keys: '3' },
    { action: 'Ultra (120×)', keys: '4' },
  ],
);
assert.equal(normalizeGameSpeed(99), 1);
assert.equal(normalizeGameSpeed(4), 5);
assert.equal(normalizeGameSpeed(12), 20);
assert.equal(gameSpeedLabel(0), 'Paused');
assert.equal(gameSpeedLabel(1), 'Scenic');
assert.equal(gameSpeedLabel(5), 'Normal');
assert.equal(gameSpeedLabel(20), 'Fast');
assert.equal(gameSpeedLabel(120), 'Ultra');

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
    assert.equal(
      environment.watermillThroughputMultiplier,
      DROUGHT_WATERMILL_THROUGHPUT_MULTIPLIER,
    );
    break;
  }
}
assert.equal(droughtFound, true, 'deterministic climate should produce drought years');

let rainFound = false;
for (let springDay = 0; springDay < CALENDAR_DAYS_PER_MONTH * 3; springDay += 1) {
  const clock = gameClock(springDay * dayTicks);
  const environment = environmentFor(12345, 100, clock);
  if (environment.weather !== 'rain') continue;
  rainFound = true;
  assert.equal(environment.roadTravelSpeedMultiplier, 0.82);
  assert.equal(
    environment.watermillThroughputMultiplier,
    SPRING_RAIN_WATERMILL_THROUGHPUT_MULTIPLIER,
  );
  assert.match(describeEnvironment(environment).detail, /carts travel 18% slower/i);
  assert.match(describeEnvironment(environment).detail, /mill streams reach 115% power/i);
  break;
}
assert.equal(rainFound, true, 'a wet Gorski Kotar spring should expose muddy-road logistics');

const autumnClock = gameClock(CALENDAR_DAYS_PER_MONTH * 6 * dayTicks);
const autumnEnvironment = environmentFor(12345, 50, autumnClock);
assert.equal(autumnEnvironment.season, 'autumn');
assert.equal(autumnEnvironment.roadTravelSpeedMultiplier, 0.9);
assert.equal(autumnEnvironment.watermillThroughputMultiplier, 1);
assert.match(describeEnvironment(autumnEnvironment).detail, /carts travel 10% slower/i);

const lastSummerDay = gameClock((CALENDAR_DAYS_PER_MONTH * 6 - 1) * dayTicks);
const autumnOutlook = nextDayEnvironmentOutlook(12345, 50, lastSummerDay);
assert.equal(autumnOutlook.clock.month, 9);
assert.equal(autumnOutlook.clock.monthDay, 1);
assert.deepEqual(
  autumnOutlook.environment,
  environmentFor(12345, 50, gameClock(lastSummerDay.simTick + dayTicks)),
  'the outlook must reuse the same deterministic environment policy as the next day',
);
const autumnOutlookDescription = describeNextDayEnvironmentOutlook(
  environmentFor(12345, 50, lastSummerDay),
  autumnOutlook,
);
assert.match(autumnOutlookDescription, /Next dawn/);
assert.match(autumnOutlookDescription, /100% → 90%/);
assert.match(autumnOutlookDescription, /pre-haul remote stock and regional orders/);
assert.match(autumnOutlookDescription, /fresh-food loss/);

const winterClock = gameClock(CALENDAR_DAYS_PER_MONTH * 9 * dayTicks);
const winterEnvironment = environmentFor(12345, 50, winterClock);
assert.equal(winterEnvironment.season, 'winter');
assert.equal(winterEnvironment.roadTravelSpeedMultiplier, 0.72);
assert.equal(
  winterEnvironment.watermillThroughputMultiplier,
  WINTER_WATERMILL_THROUGHPUT_MULTIPLIER,
);
assert.match(describeEnvironment(winterEnvironment).detail, /carts travel 28% slower/i);
assert.match(describeEnvironment(winterEnvironment).detail, /flour throughput to 45%/i);

const lastAutumnDay = gameClock((CALENDAR_DAYS_PER_MONTH * 9 - 1) * dayTicks);
const winterOutlookDescription = describeNextDayEnvironmentOutlook(
  environmentFor(12345, 50, lastAutumnDay),
  nextDayEnvironmentOutlook(12345, 50, lastAutumnDay),
);
assert.match(winterOutlookDescription, /watermill power 45%/i);

let outlookChecksum = 0;
const outlookStarted = performance.now();
for (let day = 0; day < 100_000; day += 1) {
  const clock = gameClock(day * dayTicks);
  outlookChecksum += nextDayEnvironmentOutlook(12345, 50, clock)
    .environment.roadTravelSpeedMultiplier;
}
const outlookElapsedMs = performance.now() - outlookStarted;
assert.ok(outlookChecksum > 0);
assert.ok(
  outlookElapsedMs < 250,
  `100,000 constant-time next-dawn outlooks took ${outlookElapsedMs.toFixed(1)} ms`,
);

const settlementHudSource = readFileSync('src/ui/SettlementHud.ts', 'utf8');
const townHallSource = readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
assert.match(settlementHudSource, /describeNextDayEnvironmentOutlook/);
assert.match(townHallSource, /Next dawn outlook/);

const durations = {
  scenic: {
    dayMinutes: CALENDAR_SECONDS_PER_DAY / SIM_REALTIME_RATE / 60,
    monthMinutes: CALENDAR_SECONDS_PER_DAY * CALENDAR_DAYS_PER_MONTH / SIM_REALTIME_RATE / 60,
    yearMinutes: CALENDAR_SECONDS_PER_DAY * CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR / SIM_REALTIME_RATE / 60,
  },
  fastYearMinutes:
    CALENDAR_SECONDS_PER_DAY * CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR / SIM_REALTIME_RATE / 60 / 20,
  ultraDaySeconds:
    CALENDAR_SECONDS_PER_DAY / SIM_REALTIME_RATE / 120,
  ultraYearMinutes:
    CALENDAR_SECONDS_PER_DAY * CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR / SIM_REALTIME_RATE / 60 / 120,
};
assert.ok(Math.abs(durations.scenic.dayMinutes - 60) < 1e-9);
assert.ok(Math.abs(durations.scenic.monthMinutes - 600) < 1e-9);
assert.ok(Math.abs(durations.scenic.yearMinutes - 7200) < 1e-9);
assert.ok(Math.abs(durations.fastYearMinutes - 360) < 1e-9);
assert.ok(Math.abs(durations.ultraDaySeconds - 30) < 1e-9);
assert.ok(Math.abs(durations.ultraYearMinutes - 60) < 1e-9);

console.log(
  `season and simulation-speed tests passed (${outlookElapsedMs.toFixed(1)} ms for 100,000 outlooks)`,
);
