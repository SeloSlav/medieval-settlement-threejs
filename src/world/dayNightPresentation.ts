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
  grade: DayNightGrade;
  skyAnimationTime: number;
  isNight: boolean;
  smokeAllowed: boolean;
  eveningWindowGlow: number;
};

const SUN_DIRECTION = new THREE.Vector3();
const SETTLEMENT_LATITUDE_RAD = THREE.MathUtils.degToRad(45.6);
const SOLAR_NOON_HOUR = 12.75;
const AXIAL_TILT_DEG = 23.44;
const DAYS_PER_YEAR = CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;
// The compressed calendar keeps the familiar month names. Its winter solstice
// falls late in December, just as it does in the northern hemisphere.
const WINTER_SOLSTICE_DAY = DAYS_PER_YEAR - CALENDAR_DAYS_PER_MONTH * 0.35;

export function fractionalHour(clock: GameClock): number {
  return clock.hour + clock.minute / 60;
}

export function computeDayNightState(
  clock: GameClock,
  laborPaused: boolean,
): DayNightLightingState {
  const hour = fractionalHour(clock);
  const smokeAllowed = !laborPaused;
  const { direction, elevationDeg } = computeSolarPosition(clock, hour);
  SUN_DIRECTION.copy(direction);

  const dayAmount = smoothstep(-8, 9, elevationDeg);
  const night = 1 - smoothstep(-12, -4, elevationDeg);
  const twilight = smoothstep(-14, -2, elevationDeg)
    * (1 - smoothstep(7, 25, elevationDeg));
  const dawn = hour < SOLAR_NOON_HOUR ? twilight : 0;
  const dusk = hour >= SOLAR_NOON_HOUR ? twilight : 0;
  const goldenHour = Math.max(dawn, dusk);
  const isNight = elevationDeg < -6;

  const sunVisible = smoothstep(-1.5, 4, elevationDeg);
  const highSun = smoothstep(7, 48, elevationDeg);
  let sunWarm = lerpColor(0x8299c5, 0xfff2dc, dayAmount);
  sunWarm = lerpColor(sunWarm, 0xffb36b, dawn * 0.8);
  sunWarm = lerpColor(sunWarm, 0xd95b2f, dusk * 0.94);
  const sunIntensity = lerp(0.025, 4.9, Math.pow(sunVisible, 0.55))
    * lerp(0.84, 1, highSun);

  let hemiSkyColor = lerpColor(0x111c38, 0xdff0ff, dayAmount);
  hemiSkyColor = lerpColor(hemiSkyColor, 0xe8a06d, dawn * 0.34);
  hemiSkyColor = lerpColor(hemiSkyColor, 0xc7593c, dusk * 0.46);
  let hemiGroundColor = lerpColor(0x151d20, 0x56644a, dayAmount);
  hemiGroundColor = lerpColor(hemiGroundColor, 0x704437, dusk * 0.32);
  const hemiIntensity = lerp(0.34, 1.9, dayAmount) + goldenHour * 0.12;

  let ambientColor = lerpColor(0x354b78, 0xb8d1ff, dayAmount);
  ambientColor = lerpColor(ambientColor, 0x986b73, dawn * 0.24);
  ambientColor = lerpColor(ambientColor, 0x8f4f4b, dusk * 0.34);
  const ambientIntensity = lerp(0.14, 0.2, dayAmount) + night * 0.045;
  const buildingIndirectIntensity = lerp(0.016, 0.11, dayAmount);

  let fillColor = lerpColor(0x506fa9, 0x9fc8ff, dayAmount);
  fillColor = lerpColor(fillColor, 0x8d7099, goldenHour * 0.28);
  const fillIntensity = lerp(0.14, 0.45, dayAmount);

  let fogColor = lerpColor(0x111b35, 0xc8def1, dayAmount);
  fogColor = lerpColor(fogColor, 0xc48972, dawn * 0.42);
  fogColor = lerpColor(fogColor, 0xa94b39, dusk * 0.62);
  const fogDensity = lerp(0.00155, 0.00082, dayAmount) + goldenHour * 0.00008;
  const eveningWindowGlow = computeEveningWindowGlow(hour, night);

  return {
    sunDirection: SUN_DIRECTION.clone(),
    sunColor: sunWarm,
    sunIntensity,
    hemiSkyColor,
    hemiGroundColor,
    hemiIntensity,
    ambientColor,
    ambientIntensity,
    buildingIndirectIntensity,
    fillColor,
    fillIntensity,
    fogColor,
    fogDensity,
    dawnAmount: dawn,
    duskAmount: dusk,
    solarElevationDeg: elevationDeg,
    grade: {
      saturation: lerp(0.7, 1.02, dayAmount) + dawn * 0.08 + dusk * 0.14,
      contrast: lerp(0.95, 1.05, dayAmount) + dusk * 0.025,
      warmth: dawn * 0.48 + dusk * 0.78,
      nightBlue: night * 0.62,
      vignette: lerp(0.2, 0.1, dayAmount) + night * 0.08,
    },
    skyAnimationTime: simElapsedSeconds(clock.simTick),
    isNight,
    smokeAllowed,
    eveningWindowGlow,
  };
}

function computeSolarPosition(
  clock: Pick<GameClock, 'month' | 'monthDay'>,
  hour: number,
): { direction: THREE.Vector3; elevationDeg: number } {
  const calendarDay = (clock.month - 1) * CALENDAR_DAYS_PER_MONTH
    + Math.max(0, clock.monthDay - 0.5);
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
  const direction = new THREE.Vector3(east, up, north).normalize();

  return {
    direction,
    elevationDeg: THREE.MathUtils.radToDeg(Math.asin(clamp(up, -1, 1))),
  };
}

/** Darkness envelope for household-controlled lamps; sleep schedules turn individual homes off. */
function computeEveningWindowGlow(hour: number, night: number): number {
  const darkness = blendPhases(hour, [
    { at: 0, value: 1 },
    { at: CALENDAR_WORK_START_HOUR - 1.25, value: 1 },
    { at: CALENDAR_WORK_START_HOUR + 0.25, value: 0 },
    { at: CALENDAR_WORK_END_HOUR - 2.5, value: 0 },
    { at: CALENDAR_WORK_END_HOUR - 1.5, value: 0.55 },
    { at: CALENDAR_WORK_END_HOUR - 0.5, value: 1 },
    { at: CALENDAR_HOURS_PER_DAY, value: 1 },
  ]);
  return clamp01(darkness * (0.82 + night * 0.18));
}

function blendPhases(hour: number, phases: { at: number; value: number }[]): number {
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
