import type { WeatherKind } from '../world/seasonPolicy.ts';

const PRIMARY_CELL_SIZE = 112;
const DETAIL_CELL_SIZE = 47;

/**
 * Stable, continuous exposure field shared conceptually with the authoritative
 * Rust simulation. A windmill's position therefore matters without requiring
 * a large per-tick weather grid.
 */
export function windSiteScore(seed: number, x: number, z: number): number {
  const primary = valueNoise(seed ^ 0x6a09e667, x / PRIMARY_CELL_SIZE, z / PRIMARY_CELL_SIZE);
  const detail = valueNoise(seed ^ 0xbb67ae85, x / DETAIL_CELL_SIZE, z / DETAIL_CELL_SIZE);
  return clamp01(0.12 + (primary * 0.72 + detail * 0.28) * 0.88);
}

export function windSiteThroughputMultiplier(seed: number, x: number, z: number): number {
  return 0.6 + windSiteScore(seed, x, z) * 0.8;
}

export function windWeatherThroughputMultiplier(weather: WeatherKind): number {
  if (weather === 'rain') return 1.15;
  if (weather === 'drought') return 0.8;
  if (weather === 'frost') return 1.08;
  return 1;
}

export function windmillThroughputMultiplier(
  seed: number,
  x: number,
  z: number,
  weather: WeatherKind = 'fair',
): number {
  return windSiteThroughputMultiplier(seed, x, z)
    * windWeatherThroughputMultiplier(weather);
}

function valueNoise(seed: number, x: number, z: number): number {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  const tx = smoothstep(x - cellX);
  const tz = smoothstep(z - cellZ);
  const north = lerp(
    hashF64(seed, cellX, cellZ),
    hashF64(seed, cellX + 1, cellZ),
    tx,
  );
  const south = lerp(
    hashF64(seed, cellX, cellZ + 1),
    hashF64(seed, cellX + 1, cellZ + 1),
    tx,
  );
  return lerp(north, south, tz);
}

function hashF64(seed: number, x: number, z: number): number {
  let hash = Math.imul((seed + x) | 0, 0x85ebca6b);
  hash = Math.imul((hash + z) | 0, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffffffff;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
