import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_MONTHS_PER_YEAR,
  CALENDAR_SECONDS_PER_DAY,
  DROUGHT_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
  DROUGHT_WATERMILL_THROUGHPUT_MULTIPLIER,
  PRESERVED_FOOD_SPOILAGE_PER_DAY,
  RESIDENCE_PRESERVED_FOOD_AUTUMN_MULTIPLIER,
  RESIDENCE_PRESERVED_FOOD_SPRING_MULTIPLIER,
  RESIDENCE_PRESERVED_FOOD_SUMMER_MULTIPLIER,
  RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
  SIM_REALTIME_RATE,
  SPRING_RAIN_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
  SPRING_RAIN_WATERMILL_THROUGHPUT_MULTIPLIER,
  WINTER_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
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
  resolveGameSpeedHotkey,
  worldAnimationDelta,
} from '../src/world/gameSpeed.ts';
import {
  CLAY_PIT_DROUGHT_THROUGHPUT_MULTIPLIER,
  CLAY_PIT_FROST_THROUGHPUT_MULTIPLIER,
  CLAY_PIT_RAIN_THROUGHPUT_MULTIPLIER,
  charcoalBurnerThroughputForWeather,
  clayPitThroughputForWeather,
  describeEnvironment,
  describeNextDayEnvironmentOutlook,
  environmentFor,
  nextDayEnvironmentOutlook,
  preservedFoodDemandMultiplierForSeason,
  preservedFoodSpoilageFractionPerDayFor,
  seasonForMonth,
  snowCoverageForClock,
} from '../src/world/seasonPolicy.ts';
import { GAME_CONTROL_SECTIONS } from '../src/ui/gameControlsReference.ts';

assert.equal(CALENDAR_SECONDS_PER_DAY, 120);
assert.equal(CALENDAR_DAYS_PER_MONTH, 30);
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
assert.equal(WINTER_FIREWOOD_DEMAND_MULTIPLIER, 2);
assert.equal(CLAY_PIT_RAIN_THROUGHPUT_MULTIPLIER, 0.8);
assert.equal(CLAY_PIT_DROUGHT_THROUGHPUT_MULTIPLIER, 0.7);
assert.equal(CLAY_PIT_FROST_THROUGHPUT_MULTIPLIER, 0.35);
assert.equal(clayPitThroughputForWeather('fair'), 1);
assert.equal(charcoalBurnerThroughputForWeather('fair'), 1);
assert.equal(
  charcoalBurnerThroughputForWeather('rain'),
  SPRING_RAIN_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
);
assert.equal(
  charcoalBurnerThroughputForWeather('drought'),
  DROUGHT_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
);
assert.equal(
  charcoalBurnerThroughputForWeather('frost'),
  WINTER_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
);
assert.equal(
  preservedFoodDemandMultiplierForSeason('spring'),
  RESIDENCE_PRESERVED_FOOD_SPRING_MULTIPLIER,
);
assert.equal(
  preservedFoodDemandMultiplierForSeason('summer'),
  RESIDENCE_PRESERVED_FOOD_SUMMER_MULTIPLIER,
);
assert.equal(
  preservedFoodDemandMultiplierForSeason('autumn'),
  RESIDENCE_PRESERVED_FOOD_AUTUMN_MULTIPLIER,
);
assert.equal(
  preservedFoodDemandMultiplierForSeason('winter'),
  RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
);
assert.equal(
  (
    RESIDENCE_PRESERVED_FOOD_SPRING_MULTIPLIER
    + RESIDENCE_PRESERVED_FOOD_SUMMER_MULTIPLIER
    + RESIDENCE_PRESERVED_FOOD_AUTUMN_MULTIPLIER
    + RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER
  ) / 4,
  1,
);
const seasonalCuredLossRates = [
  preservedFoodSpoilageFractionPerDayFor('spring', 'fair'),
  preservedFoodSpoilageFractionPerDayFor('summer', 'fair'),
  preservedFoodSpoilageFractionPerDayFor('autumn', 'fair'),
  preservedFoodSpoilageFractionPerDayFor('winter', 'frost'),
];
assert.ok(seasonalCuredLossRates[3] < seasonalCuredLossRates[0]);
assert.ok(seasonalCuredLossRates[0] < seasonalCuredLossRates[1]);
assert.ok(
  Math.abs(
    seasonalCuredLossRates.reduce((sum, rate) => sum + rate, 0) / 4
    - PRESERVED_FOOD_SPOILAGE_PER_DAY,
  ) < 1e-12,
  'seasonal cured-food pressure must preserve the configured annual-average balance',
);
assert.ok(
  preservedFoodSpoilageFractionPerDayFor('summer', 'drought')
  > seasonalCuredLossRates[1],
  'a warm drought must age cured provisions faster than an ordinary mountain summer',
);

assert.deepEqual(GAME_SPEEDS, [0, 1, 4, 8]);
assert.deepEqual(PLAYER_GAME_SPEEDS, [1, 4, 8]);
assert.deepEqual(PLAYER_GAME_SPEED_HOTKEYS, ['1', '2', '3']);
assert.equal(gameSpeedForHotkey(' '), 0);
assert.equal(gameSpeedForHotkey('1'), 1);
assert.equal(gameSpeedForHotkey('2'), 4);
assert.equal(gameSpeedForHotkey('3'), 8);
assert.equal(gameSpeedForHotkey('4'), null);
assert.equal(gameSpeedForHotkey('0'), null);
assert.equal(gameSpeedForHotkey('5'), null);
assert.equal(resolveGameSpeedHotkey(' ', 4, 4, false), 0);
assert.equal(resolveGameSpeedHotkey(' ', 0, 4, false), 4);
assert.equal(resolveGameSpeedHotkey(' ', 4, 4, true), null);
assert.equal(resolveGameSpeedHotkey(' ', 0, 4, true), null);
assert.equal(resolveGameSpeedHotkey('2', 0, 4, true), 4);
assert.equal(hotkeyForGameSpeed(0), 'Space');
assert.equal(hotkeyForGameSpeed(1), '1');
assert.equal(hotkeyForGameSpeed(4), '2');
assert.equal(hotkeyForGameSpeed(8), '3');
assert.deepEqual(
  GAME_CONTROL_SECTIONS.find((section) => section.title === 'Simulation speed')?.entries,
  [
    { action: 'Pause', keys: 'Space' },
    { action: 'Normal (1×)', keys: '1' },
    { action: 'Fast (4×)', keys: '2' },
    { action: 'Fastest (8×)', keys: '3' },
  ],
);
assert.equal(normalizeGameSpeed(99), 1);
assert.equal(normalizeGameSpeed(4), 4);
assert.equal(normalizeGameSpeed(5), 4);
assert.equal(normalizeGameSpeed(12), 8);
assert.equal(normalizeGameSpeed(20), 8);
assert.equal(normalizeGameSpeed(120), 8);
assert.equal(gameSpeedLabel(0), 'Pause');
assert.equal(gameSpeedLabel(1), 'Normal');
assert.equal(gameSpeedLabel(4), 'Fast');
assert.equal(gameSpeedLabel(8), 'Fastest');
assert.equal(worldAnimationDelta(0.05, 0), 0);
assert.equal(worldAnimationDelta(0.05, 1), 0.05);
assert.equal(worldAnimationDelta(-1, 8), 0);

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
    assert.equal(
      environment.clayPitThroughputMultiplier,
      CLAY_PIT_DROUGHT_THROUGHPUT_MULTIPLIER,
    );
    assert.equal(
      environment.charcoalBurnerThroughputMultiplier,
      DROUGHT_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
    );
    assert.match(describeEnvironment(environment).detail, /charcoal-clamp pace to 110%/i);
    assert.match(describeEnvironment(environment).detail, /most dangerous/i);
    assert.equal(
      environment.preservedFoodSpoilageFractionPerDay,
      preservedFoodSpoilageFractionPerDayFor('summer', 'drought'),
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
  assert.equal(
    environment.clayPitThroughputMultiplier,
    CLAY_PIT_RAIN_THROUGHPUT_MULTIPLIER,
  );
  assert.equal(
    environment.charcoalBurnerThroughputMultiplier,
    SPRING_RAIN_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
  );
  assert.match(describeEnvironment(environment).detail, /carts travel 18% slower/i);
  assert.match(describeEnvironment(environment).detail, /mill streams reach 115% power/i);
  assert.match(describeEnvironment(environment).detail, /charcoal clamps to 80%/i);
  break;
}
assert.equal(rainFound, true, 'a wet Gorski Kotar spring should expose muddy-road logistics');

const autumnClock = gameClock(CALENDAR_DAYS_PER_MONTH * 6 * dayTicks);
const autumnEnvironment = environmentFor(12345, 50, autumnClock);
assert.equal(autumnEnvironment.season, 'autumn');
assert.equal(autumnEnvironment.roadTravelSpeedMultiplier, 0.9);
assert.equal(autumnEnvironment.watermillThroughputMultiplier, 1);
assert.equal(
  autumnEnvironment.preservedFoodDemandMultiplier,
  RESIDENCE_PRESERVED_FOOD_AUTUMN_MULTIPLIER,
);
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
assert.match(autumnOutlookDescription, /cured-food aging/);

const winterClock = gameClock(CALENDAR_DAYS_PER_MONTH * 9 * dayTicks);
const winterEnvironment = environmentFor(12345, 50, winterClock);
assert.equal(winterEnvironment.season, 'winter');
assert.equal(
  winterEnvironment.preservedFoodDemandMultiplier,
  RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
);
const lateNovemberSnow = snowCoverageForClock(
  gameClock((CALENDAR_DAYS_PER_MONTH * 9 - 1) * dayTicks),
);
assert.ok(lateNovemberSnow > 0.1);
assert.ok(winterEnvironment.snowCoverage > lateNovemberSnow);
const lateDecemberSnow = snowCoverageForClock(
  gameClock((CALENDAR_DAYS_PER_MONTH * 10 - 1) * dayTicks),
);
const lateJanuarySnow = snowCoverageForClock(
  gameClock((CALENDAR_DAYS_PER_MONTH * 11 - 1) * dayTicks),
);
const lateFebruarySnow = snowCoverageForClock(
  gameClock((CALENDAR_DAYS_PER_MONTH * 12 - 1) * dayTicks),
);
assert.ok(lateDecemberSnow > winterEnvironment.snowCoverage);
assert.ok(lateJanuarySnow > lateDecemberSnow);
assert.ok(lateJanuarySnow > 0.95);
assert.ok(lateFebruarySnow < 0.02);
assert.ok(lateFebruarySnow < lateDecemberSnow);
const openingMarchSnow = snowCoverageForClock(
  gameClock(CALENDAR_DAYS_PER_MONTH * 12 * dayTicks),
);
const lateMarchSnow = snowCoverageForClock(
  gameClock((CALENDAR_DAYS_PER_MONTH * 13 - 1) * dayTicks),
);
assert.equal(openingMarchSnow, 0);
assert.equal(lateMarchSnow, 0);
assert.equal(winterEnvironment.roadTravelSpeedMultiplier, 0.72);
assert.equal(
  winterEnvironment.preservedFoodSpoilageFractionPerDay,
  seasonalCuredLossRates[3],
);
assert.equal(
  winterEnvironment.watermillThroughputMultiplier,
  WINTER_WATERMILL_THROUGHPUT_MULTIPLIER,
);
assert.equal(
  winterEnvironment.clayPitThroughputMultiplier,
  CLAY_PIT_FROST_THROUGHPUT_MULTIPLIER,
);
assert.equal(
  winterEnvironment.charcoalBurnerThroughputMultiplier,
  WINTER_CHARCOAL_BURNER_THROUGHPUT_MULTIPLIER,
);
assert.match(describeEnvironment(winterEnvironment).detail, /carts travel 28% slower/i);
assert.match(describeEnvironment(winterEnvironment).detail, /flour throughput to 45%/i);
assert.match(describeEnvironment(winterEnvironment).detail, /halve cured-food aging/i);
assert.match(describeEnvironment(winterEnvironment).detail, /charcoal tending falls to 80%/i);

const lastAutumnDay = gameClock((CALENDAR_DAYS_PER_MONTH * 9 - 1) * dayTicks);
const winterOutlookDescription = describeNextDayEnvironmentOutlook(
  environmentFor(12345, 50, lastAutumnDay),
  nextDayEnvironmentOutlook(12345, 50, lastAutumnDay),
);
assert.match(winterOutlookDescription, /watermill power 45%/i);
assert.match(winterOutlookDescription, /clay digging 35%/i);
assert.match(winterOutlookDescription, /charcoal burning 80%/i);

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
const appSource = readFileSync('src/app/App.ts', 'utf8');
const serverSimulationSource = readFileSync('server/src/reducers/simulation.rs', 'utf8');
const sceneManagerSource = readFileSync('src/scene/SceneManager.ts', 'utf8');
const riverWaterMaterialSource = readFileSync('src/rivers/RiverWaterMaterial.ts', 'utf8');
const grassWindSource = readFileSync(
  'src/vegetation/seedthree/seedThreeGrass.ts',
  'utf8',
);
const foliageWindSource = readFileSync(
  'src/vegetation/seedthree/seedThreeFoliageWind.ts',
  'utf8',
);
assert.match(settlementHudSource, /describeNextDayEnvironmentOutlook/);
assert.match(settlementHudSource, /GAME_SPEEDS\.map/);
assert.match(townHallSource, /Next dawn outlook/);
assert.match(appSource, /worldAnimationDelta\([\s\S]*?sceneManager\?\.render\(worldDt/);
assert.match(appSource, /tickSettlementWorld\([\s\S]*?worldDt,/);
assert.match(sceneManagerSource, /setWorldAnimationTime\(this\.worldAnimationElapsedSeconds\)/);
for (const shaderSource of [
  riverWaterMaterialSource,
  grassWindSource,
  foliageWindSource,
]) {
  assert.match(
    shaderSource,
    /worldAnimationTime/,
    'world shaders must use the pause-aware animation clock',
  );
  assert.doesNotMatch(
    shaderSource,
    /import\s*\{[\s\S]*?\btime\b[\s\S]*?\}\s*from\s*['"]three\/tsl['"]/,
    'world shaders must not animate from wall-clock time',
  );
}
assert.ok(
  serverSimulationSource.indexOf('if config.game_speed == 0')
    < serverSimulationSource.indexOf('materialize_all_physical_resource_ledgers(ctx)'),
  'pause must return before any authoritative simulation migration or mutation',
);
assert.match(
  serverSimulationSource,
  /step_delivery_trips\([\s\S]*?heartbeat_sim_seconds[\s\S]*?step_live_raids\([\s\S]*?heartbeat_sim_seconds/,
  'deliveries and live combat must use the same authoritative speed rate as the calendar',
);

const durations = {
  normal: {
    daySeconds: CALENDAR_SECONDS_PER_DAY / SIM_REALTIME_RATE,
    monthMinutes: CALENDAR_SECONDS_PER_DAY * CALENDAR_DAYS_PER_MONTH / SIM_REALTIME_RATE / 60,
    yearMinutes: CALENDAR_SECONDS_PER_DAY * CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR / SIM_REALTIME_RATE / 60,
  },
  fastMonthMinutes:
    CALENDAR_SECONDS_PER_DAY * CALENDAR_DAYS_PER_MONTH / SIM_REALTIME_RATE / 60 / 4,
  fastestDaySeconds:
    CALENDAR_SECONDS_PER_DAY / SIM_REALTIME_RATE / 8,
  fastestYearMinutes:
    CALENDAR_SECONDS_PER_DAY * CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR / SIM_REALTIME_RATE / 60 / 8,
};
assert.ok(Math.abs(durations.normal.daySeconds - 300) < 1e-9);
assert.ok(Math.abs(durations.normal.monthMinutes - 150) < 1e-9);
assert.ok(Math.abs(durations.normal.yearMinutes - 1_800) < 1e-9);
assert.ok(Math.abs(durations.fastMonthMinutes - 37.5) < 1e-9);
assert.ok(Math.abs(durations.fastestDaySeconds - 37.5) < 1e-9);
assert.ok(Math.abs(durations.fastestYearMinutes - 225) < 1e-9);

console.log(
  `season and simulation-speed tests passed (${outlookElapsedMs.toFixed(1)} ms for 100,000 outlooks)`,
);
