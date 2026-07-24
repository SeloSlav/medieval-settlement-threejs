import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeDayNightState } from '../src/world/dayNightPresentation.ts';
import type { GameClock } from '../src/world/gameCalendar.ts';

const springDawn = computeDayNightState(clockAt(6.65, 3), false);
const springNoon = computeDayNightState(clockAt(12.75, 3), false);
const springDusk = computeDayNightState(clockAt(19, 3), false);
const springNight = computeDayNightState(clockAt(23, 3), true);

assert.ok(springDawn.dawnAmount > 0.7, 'sunrise should have a strong dawn envelope');
assert.ok(springDusk.duskAmount > 0.7, 'sunset should have a strong dusk envelope');
assert.equal(springDawn.duskAmount, 0, 'morning twilight must not use the dusk palette');
assert.equal(springDusk.dawnAmount, 0, 'evening twilight must not use the dawn palette');
assert.ok(springDawn.sunDirection.x > 0, 'the sun should rise in the east');
assert.ok(springDusk.sunDirection.x < 0, 'the sun should set in the west');
assert.ok(springNoon.solarElevationDeg > 40, 'the spring midday sun should be high');
assert.equal(springNight.isNight, true);
assert.ok(springNight.solarElevationDeg < -25, 'late night should place the sun well below the horizon');

const sunriseRgb = rgb(springDawn.sunColor);
const sunsetRgb = rgb(springDusk.sunColor);
assert.ok(
  sunriseRgb.r > sunriseRgb.g && sunriseRgb.g > sunriseRgb.b,
  'sunrise light should be peach-gold',
);
assert.ok(
  sunsetRgb.r > sunsetRgb.g * 1.7 && sunsetRgb.g > sunsetRgb.b,
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

console.log('Day/night presentation tests passed.');

function clockAt(hourValue: number, month: number): GameClock {
  const hour = Math.floor(hourValue);
  const minute = Math.round((hourValue - hour) * 60);
  return {
    simTick: 0,
    totalDays: 0,
    hour,
    minute,
    weekday: 0,
    monthDay: 8,
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
