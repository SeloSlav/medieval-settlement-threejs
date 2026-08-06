import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  computeDayNightState,
  FAIR_DAY_FOG_COLOR,
  NIGHT_FOG_COLOR,
} from '../src/world/dayNightPresentation.ts';
import { gameClockAtElapsedSeconds, type GameClock } from '../src/world/gameCalendar.ts';
import {
  DIRECTIONAL_SHADOW_MAX_STEP_DEGREES,
  DIRECTIONAL_SHADOW_MIN_REFRESH_INTERVAL_MS,
  DIRECTIONAL_SHADOW_TARGET_STEP_DEGREES,
  shouldRefreshDirectionalShadow,
} from '../src/scene/directionalShadowRefreshPolicy.ts';
import { computeFixedSkyState } from '../src/scene/fixedSkyPresentation.ts';
import {
  DEFAULT_FIXED_SKY_PRESET,
  FIXED_SKY_PRESETS,
} from '../src/scene/skyPresentationPreference.ts';

const directionDotAtDegrees = (degrees: number): number => Math.cos(
  THREE.MathUtils.degToRad(degrees),
);

assert.equal(DIRECTIONAL_SHADOW_TARGET_STEP_DEGREES, 0.12);
assert.equal(DIRECTIONAL_SHADOW_MAX_STEP_DEGREES, 0.5);
assert.equal(DIRECTIONAL_SHADOW_MIN_REFRESH_INTERVAL_MS, 100);
assert.equal(shouldRefreshDirectionalShadow(Number.NaN, 0), true);
assert.equal(shouldRefreshDirectionalShadow(directionDotAtDegrees(0.08), 1_000), false);
assert.equal(shouldRefreshDirectionalShadow(directionDotAtDegrees(0.13), 99), false);
assert.equal(shouldRefreshDirectionalShadow(directionDotAtDegrees(0.13), 100), true);
assert.equal(shouldRefreshDirectionalShadow(directionDotAtDegrees(0.51), 0), true);

const springDawn = computeDayNightState(clockAt(6.65, 3), false);
const springNoon = computeDayNightState(clockAt(12.75, 3), false);
const springDusk = computeDayNightState(clockAt(19, 3), false);
const springNight = computeDayNightState(clockAt(23, 3), true);
const fixedSummerMoonlight = computeDayNightState(clockAt(23, 8, 15), true);
const fixedWinterDaylight = computeDayNightState(clockAt(13, 1, 15), false);

assert.ok(springDawn.dawnAmount > 0.7, 'sunrise should have a strong dawn envelope');
assert.ok(springDusk.duskAmount > 0.7, 'sunset should have a strong dusk envelope');
assert.equal(springDawn.duskAmount, 0, 'morning twilight must not use the dusk palette');
assert.equal(springDusk.dawnAmount, 0, 'evening twilight must not use the dawn palette');
assert.ok(springDawn.sunDirection.x > 0, 'the sun should rise in the east');
assert.ok(springDusk.sunDirection.x < 0, 'the sun should set in the west');
assert.ok(
  springNoon.solarElevationDeg > 38,
  'the early-March midday sun should be high for the settlement latitude',
);
assert.equal(springNight.isNight, true);
assert.ok(springNight.nightAmount > 0.99);
assert.equal(springNoon.nightAmount, 0);
assert.ok(springNight.solarElevationDeg < -25, 'late night should place the sun well below the horizon');
assert.equal(fixedSummerMoonlight.fogColor, NIGHT_FOG_COLOR);
assert.equal(fixedSummerMoonlight.fogDensity, 0.0007);
assert.equal(fixedSummerMoonlight.grade.saturation, 0.88);
assert.equal(fixedSummerMoonlight.grade.contrast, 0.98);
assert.equal(fixedSummerMoonlight.grade.nightBlue, 0.24);
assert.equal(fixedSummerMoonlight.grade.vignette, 0.065);
assert.equal(fixedSummerMoonlight.hemiSkyColor, 0x6888a7);
assert.equal(fixedSummerMoonlight.hemiGroundColor, 0x516773);
assert.equal(fixedSummerMoonlight.ambientColor, 0x778fa9);
assert.equal(fixedSummerMoonlight.fillColor, 0xaccbe2);
assert.equal(fixedSummerMoonlight.fillIntensity, 0.68);
assert.equal(springNoon.fogColor, FAIR_DAY_FOG_COLOR);
assert.ok(
  rgb(springNoon.fogColor).b > rgb(springNoon.fogColor).r + 35,
  'daytime fog should read as a natural blue atmospheric haze rather than white',
);
assert.equal(
  fixedWinterDaylight.grade.nightBlue,
  0.055,
  'winter daylight should retain a restrained cool shadow floor',
);

const sunriseRgb = rgb(springDawn.sunColor);
const sunsetRgb = rgb(springDusk.sunColor);
assert.ok(
  sunriseRgb.r > sunriseRgb.g && sunriseRgb.g > sunriseRgb.b,
  'sunrise light should be peach-gold',
);
assert.ok(
  sunsetRgb.r > sunsetRgb.g * 1.6 && sunsetRgb.g > sunsetRgb.b,
  'sunset light should be distinctly rust-red/orange',
);
assert.ok(
  springDusk.grade.warmth > springDawn.grade.warmth,
  'sunset grading should be warmer than sunrise grading',
);

const summerMorning = computeDayNightState(clockAt(5.5, 6), false);
const winterMorning = computeDayNightState(clockAt(5.5, 12), false);
assert.ok(
  summerMorning.solarElevationDeg > winterMorning.solarElevationDeg + 18,
  'seasonal solar motion should produce an earlier summer sunrise',
);
assert.equal(summerMorning.isNight, false);
assert.equal(winterMorning.isNight, true);

let previous = computeDayNightState(clockAt(0, 3), false);
let largestStepRadians = 0;
for (let step = 1; step <= 24 * 12; step += 1) {
  const current = computeDayNightState(clockAt((step % (24 * 12)) / 12, 3), false);
  largestStepRadians = Math.max(
    largestStepRadians,
    previous.sunDirection.angleTo(current.sunDirection),
  );
  assert.ok(Number.isFinite(current.sunIntensity));
  assert.ok(Math.abs(current.sunDirection.length() - 1) < 1e-6);
  previous = current;
}
assert.ok(
  largestStepRadians < THREE.MathUtils.degToRad(1.4),
  `solar motion should be continuous; largest five-minute step was ${THREE.MathUtils.radToDeg(largestStepRadians).toFixed(2)} deg`,
);

const subMinuteA = gameClockAtElapsedSeconds(0.01);
const subMinuteB = gameClockAtElapsedSeconds(0.02);
assert.equal(subMinuteA.minute, subMinuteB.minute, 'test samples must remain in one displayed minute');
const subMinuteAngle = computeDayNightState(subMinuteA, false).sunDirection.angleTo(
  computeDayNightState(subMinuteB, false).sunDirection,
);
assert.ok(
  subMinuteAngle > 0,
  'solar motion must retain sub-minute precision instead of waiting for the HUD minute to change',
);
assert.ok(
  subMinuteAngle < THREE.MathUtils.degToRad(0.1),
  'sub-minute solar motion should advance smoothly without a large step',
);

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sceneSource = readFileSync(`${projectRoot}src/scene/SceneManager.ts`, 'utf8');
assert.match(sceneSource, /const moonKey = 0\.68/);
assert.match(sceneSource, /lerp\(1,\s*0\.56,\s*state\.nightAmount\)/);
assert.match(sceneSource, /lerp\(1,\s*0\.28,\s*state\.nightAmount\)/);
assert.match(sceneSource, /lerp\(1,\s*0\.5,\s*state\.nightAmount\)/);
assert.equal(
  (sceneSource.match(/new THREE\.DirectionalLight\(/g) ?? []).length,
  2,
  'night readability must reuse the existing key and fill lights',
);

const fixedNoon = computeFixedSkyState('high_noon');
const fixedDawn = computeFixedSkyState('rose_dawn');
const fixedSunset = computeFixedSkyState('ember_sunset');
const fixedBlueHour = computeFixedSkyState('blue_hour');
const fixedMidnight = computeFixedSkyState('moonlit_midnight');
assert.equal(DEFAULT_FIXED_SKY_PRESET, 'high_noon');
assert.deepEqual(
  FIXED_SKY_PRESETS.map((preset) => preset.id),
  ['high_noon', 'rose_dawn', 'ember_sunset', 'blue_hour', 'moonlit_midnight'],
);
assert.equal(fixedNoon.skyAnimationTime, 0, 'fixed sky presets must also freeze cloud motion');
assert.ok(fixedNoon.solarElevationDeg > 60 && fixedNoon.nightAmount === 0);
assert.ok(fixedDawn.dawnAmount > 0.95 && fixedDawn.sunDirection.x > 0);
assert.ok(fixedSunset.duskAmount > 0.95 && fixedSunset.sunDirection.x < 0);
assert.ok(fixedSunset.grade.warmth > fixedDawn.grade.warmth);
assert.ok(fixedBlueHour.nightAmount > 0.55 && fixedBlueHour.duskAmount > 0.35);
assert.ok(fixedMidnight.nightAmount > 0.99 && fixedMidnight.duskAmount === 0);
assert.notEqual(fixedBlueHour.siderealAngle, fixedMidnight.siderealAngle);

console.log('Day/night presentation tests passed.');

function clockAt(hourValue: number, month: number, monthDay = 8): GameClock {
  const hour = Math.floor(hourValue);
  const minute = Math.round((hourValue - hour) * 60);
  return {
    simTick: 0,
    totalDays: 0,
    hour,
    minute,
    weekday: 0,
    monthDay,
    month,
    year: 1,
    isSunday: true,
    isWorkHours: hour >= 6 && hour < 20,
  };
}

function rgb(hex: number): { r: number; g: number; b: number } {
  return {
    r: (hex >> 16) & 255,
    g: (hex >> 8) & 255,
    b: hex & 255,
  };
}
