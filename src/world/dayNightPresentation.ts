import * as THREE from 'three';
import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_MONTHS_PER_YEAR,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
} from '../generated/gameBalance.ts';
import type { GameClock } from './gameCalendar.ts';
import { simElapsedSeconds } from './gameCalendar.ts';

export type DayNightGrade = {
  saturation: number;
  contrast: number;
  warmth: number;
  nightBlue: number;
  vignette: number;
};

export type DayNightLightingState = {
  sunDirection: THREE.Vector3;
  sunColor: number;
  sunIntensity: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
  buildingIndirectIntensity: number;
  fillColor: number;
  fillIntensity: number;
  fogColor: number;
  fogDensity: number;
  dawnAmount: number;
  duskAmount: number;
  solarElevationDeg: number;
  nightAmount: number;
  grade: DayNightGrade;
  skyAnimationTime: number;
  siderealAngle: number;
  isNight: boolean;
  smokeAllowed: boolean;
  eveningWindowGlow: number;
};

const SUN_DIRECTION = new THREE.Vector3();
const SETTLEMENT_LATITUDE_RAD = THREE.MathUtils.degToRad(45.6);
const SOLAR_NOON_HOUR = 12.75;
const AXIAL_TILT_DEG = 23.44;
const DAYS_PER_YEAR = CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
// The fixed 30-day calendar keeps familiar month names. Its winter solstice
// falls late in December, just as it does in the northern hemisphere.
const WINTER_SOLSTICE_DAY = DAYS_PER_YEAR - CALENDAR_DAYS_PER_MONTH * 0.35;
const LOCAL_SIDEREAL_PHASE_HOURS = 8;
const EVENING_WINDOW_PHASES = [
  { at: 0, value: 1 },
  { at: CALENDAR_WORK_START_HOUR - 1.25, value: 1 },
  { at: CALENDAR_WORK_START_HOUR + 0.25, value: 0 },
  { at: CALENDAR_WORK_END_HOUR - 2.5, value: 0 },
  { at: CALENDAR_WORK_END_HOUR - 1.5, value: 0.55 },
  { at: CALENDAR_WORK_END_HOUR - 0.5, value: 1 },
  { at: CALENDAR_HOURS_PER_DAY, value: 1 },
] as const;
export const FAIR_DAY_FOG_COLOR = 0x9fbccc;
export const NIGHT_FOG_COLOR = 0x506b80;

export function fractionalHour(clock: GameClock): number {
  return clock.preciseHour ?? clock.hour + clock.minute / 60;
}

export function computeDayNightState(
  clock: GameClock,
  laborPaused: boolean,
  target?: DayNightLightingState,
): DayNightLightingState {
  const hour = fractionalHour(clock);
  const smokeAllowed = !laborPaused;
  const elevationDeg = computeSolarPosition(clock, hour);

  const dayAmount = smoothstep(-8, 9, elevationDeg);
  const night = 1 - smoothstep(-12, -4, elevationDeg);
  const twilight = smoothstep(-14, -2, elevationDeg)
    * (1 - smoothstep(7, 25, elevationDeg));
  const dawn = hour < SOLAR_NOON_HOUR ? twilight : 0;
  const dusk = hour >= SOLAR_NOON_HOUR ? twilight : 0;
  const goldenHour = Math.max(dawn, dusk);
  const isNight = elevationDeg < -6;
  const winterShadowFloor = clock.month === 12 || clock.month <= 2 ? 0.055 : 0;

  const sunVisible = smoothstep(-1.5, 4, elevationDeg);
  const highSun = smoothstep(7, 48, elevationDeg);
  let sunWarm = lerpColor(0x8299c5, 0xfff2dc, dayAmount);
  sunWarm = lerpColor(sunWarm, 0xffb36b, dawn * 0.8);
  sunWarm = lerpColor(sunWarm, 0xd95b2f, dusk * 0.9);
  const sunIntensity = lerp(0.018, 5.2, Math.pow(sunVisible, 0.58))
    * lerp(0.8, 1, highSun);

  let hemiSkyColor = lerpColor(0x6888a7, 0xd9e8ec, dayAmount);
  hemiSkyColor = lerpColor(hemiSkyColor, 0xdfa17a, dawn * 0.28);
  hemiSkyColor = lerpColor(hemiSkyColor, 0xb9634d, dusk * 0.36);
  let hemiGroundColor = lerpColor(0x516773, 0x59634f, dayAmount);
  hemiGroundColor = lerpColor(hemiGroundColor, 0x6a5147, dusk * 0.16);
  const hemiIntensity = lerp(1.35, 1.55, dayAmount) + goldenHour * 0.08;

  let ambientColor = lerpColor(0x778fa9, 0xb8c8d2, dayAmount);
  ambientColor = lerpColor(ambientColor, 0x8f7472, dawn * 0.2);
  ambientColor = lerpColor(ambientColor, 0x7c5751, dusk * 0.27);
  const ambientIntensity = lerp(0.5, 0.18, dayAmount);
  const buildingIndirectIntensity = lerp(0.02, 0.105, dayAmount);

  let fillColor = lerpColor(0xaccbe2, 0xa8c6d8, dayAmount);
  fillColor = lerpColor(fillColor, 0x88768e, goldenHour * 0.22);
  const fillIntensity = lerp(0.68, 0.34, dayAmount);

  let fogColor = lerpColor(NIGHT_FOG_COLOR, FAIR_DAY_FOG_COLOR, dayAmount);
  fogColor = lerpColor(fogColor, 0xbc8c77, dawn * 0.34);
  fogColor = lerpColor(fogColor, 0xa36b5a, dusk * 0.3);
  const fogDensity = lerp(0.0007, 0.00072, dayAmount) + goldenHour * 0.00008;
  const eveningWindowGlow = computeEveningWindowGlow(hour, night);

  const state = target ?? {
    sunDirection: new THREE.Vector3(),
    sunColor: 0,
    sunIntensity: 0,
    hemiSkyColor: 0,
    hemiGroundColor: 0,
    hemiIntensity: 0,
    ambientColor: 0,
    ambientIntensity: 0,
    buildingIndirectIntensity: 0,
    fillColor: 0,
    fillIntensity: 0,
    fogColor: 0,
    fogDensity: 0,
    dawnAmount: 0,
    duskAmount: 0,
    solarElevationDeg: 0,
    nightAmount: 0,
    grade: {
      saturation: 0,
      contrast: 0,
      warmth: 0,
      nightBlue: 0,
      vignette: 0,
    },
    skyAnimationTime: 0,
    siderealAngle: 0,
    isNight: false,
    smokeAllowed: false,
    eveningWindowGlow: 0,
  };
  state.sunDirection.copy(SUN_DIRECTION);
  state.sunColor = sunWarm;
  state.sunIntensity = sunIntensity;
  state.hemiSkyColor = hemiSkyColor;
  state.hemiGroundColor = hemiGroundColor;
  state.hemiIntensity = hemiIntensity;
  state.ambientColor = ambientColor;
  state.ambientIntensity = ambientIntensity;
  state.buildingIndirectIntensity = buildingIndirectIntensity;
  state.fillColor = fillColor;
  state.fillIntensity = fillIntensity;
  state.fogColor = fogColor;
  state.fogDensity = fogDensity;
  state.dawnAmount = dawn;
  state.duskAmount = dusk;
  state.solarElevationDeg = elevationDeg;
  state.nightAmount = night;
  state.grade.saturation = lerp(0.88, 1, dayAmount) + dawn * 0.035 + dusk * 0.07;
  state.grade.contrast = lerp(0.98, 1.035, dayAmount) + dusk * 0.012;
  state.grade.warmth = dawn * 0.28 + dusk * 0.4;
  state.grade.nightBlue = Math.max(night * 0.24, winterShadowFloor);
  state.grade.vignette = lerp(0.065, 0.05, dayAmount);
  state.skyAnimationTime = simElapsedSeconds(clock.simTick);
  state.siderealAngle = computeSiderealAngle(clock, hour);
  state.isNight = isNight;
  state.smokeAllowed = smokeAllowed;
  state.eveningWindowGlow = eveningWindowGlow;
  return state;
}

/**
 * Approximate local sidereal time for Gorski Kotar. The extra yearly turn is
 * what brings different classical constellations into the evening sky each season.
 */
export function computeSiderealAngle(
  clock: Pick<GameClock, 'month' | 'monthDay' | 'preciseCalendarDay'>,
  hour: number,
): number {
  const calendarDay = clock.preciseCalendarDay
    ?? (clock.month - 1) * CALENDAR_DAYS_PER_MONTH + Math.max(0, clock.monthDay - 0.5);
  const siderealHours = hour
    + calendarDay / DAYS_PER_YEAR * CALENDAR_HOURS_PER_DAY
    + LOCAL_SIDEREAL_PHASE_HOURS;
  return positiveModulo(siderealHours, CALENDAR_HOURS_PER_DAY)
    / CALENDAR_HOURS_PER_DAY
    * Math.PI * 2;
}

function computeSolarPosition(
  clock: Pick<GameClock, 'month' | 'monthDay' | 'preciseCalendarDay'>,
  hour: number,
): number {
  // Include time-of-day so solar declination also remains continuous across
  // midnight instead of taking a small step when the calendar date changes.
  const calendarDay = clock.preciseCalendarDay
    ?? (clock.month - 1) * CALENDAR_DAYS_PER_MONTH + Math.max(0, clock.monthDay - 0.5);
  const annualAngle = (calendarDay - WINTER_SOLSTICE_DAY) / DAYS_PER_YEAR * Math.PI * 2;
  const declinationRad = THREE.MathUtils.degToRad(-AXIAL_TILT_DEG * Math.cos(annualAngle));
  const hourAngleRad = THREE.MathUtils.degToRad((hour - SOLAR_NOON_HOUR) * 15);

  const sinLatitude = Math.sin(SETTLEMENT_LATITUDE_RAD);
  const cosLatitude = Math.cos(SETTLEMENT_LATITUDE_RAD);
  const sinDeclination = Math.sin(declinationRad);
  const cosDeclination = Math.cos(declinationRad);
  const sinHourAngle = Math.sin(hourAngleRad);
  const cosHourAngle = Math.cos(hourAngleRad);

  // Local horizon coordinates: +X east, +Z north, +Y up. This formulation
  // remains continuous through midnight and avoids azimuth singularities.
  const east = -cosDeclination * sinHourAngle;
  const north = cosLatitude * sinDeclination
    - sinLatitude * cosDeclination * cosHourAngle;
  const up = sinLatitude * sinDeclination
    + cosLatitude * cosDeclination * cosHourAngle;
  SUN_DIRECTION.set(east, up, north).normalize();
  return THREE.MathUtils.radToDeg(Math.asin(clamp(up, -1, 1)));
}

/** Darkness envelope for household-controlled lamps; sleep schedules turn individual homes off. */
function computeEveningWindowGlow(hour: number, night: number): number {
  const darkness = blendPhases(hour, EVENING_WINDOW_PHASES);
  return clamp01(darkness * (0.82 + night * 0.18));
}

function blendPhases(
  hour: number,
  phases: readonly { readonly at: number; readonly value: number }[],
): number {
  if (phases.length === 0) return 0;
  if (hour <= phases[0].at) return phases[0].value;
  for (let i = 1; i < phases.length; i += 1) {
    const prev = phases[i - 1];
    const next = phases[i];
    if (hour <= next.at) {
      const span = next.at - prev.at;
      if (span <= 1e-6) return next.value;
      const t = clamp01((hour - prev.at) / span);
      const smooth = t * t * (3 - 2 * t);
      return prev.value + (next.value - prev.value) * smooth;
    }
  }
  return phases[phases.length - 1].value;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 1e-6));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const mix = clamp01(t);
  const r = Math.round(lerp(ar, br, mix));
  const g = Math.round(lerp(ag, bg, mix));
  const bl = Math.round(lerp(ab, bb, mix));
  return (r << 16) | (g << 8) | bl;
}
