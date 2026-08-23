import { getActiveWorldGeneration } from '../world/worldGenerationContext.ts';
import { DROUGHT_GROUNDWATER_MULTIPLIER } from '../generated/gameBalance.ts';

// Covers the current large-map playable half (about 1,155.4 m) with a small guard margin.
const MAX_SUPPORTED_WORLD_HALF = 1_156;
export const UNIFORM_GROUNDWATER_SCORE = 1;

/**
 * Authoritative seeded subsurface moisture used by farms, pastures, vineyards, and clay.
 *
 * This deliberately has no dependency on RiverField, shore distance, ponds,
 * or the sea. The server runs the same seeded subsurface-network sampler.
 */
export function sampleAuthoritativeGroundwaterScore(x: number, z: number): number {
  const settings = getActiveWorldGeneration();
  return sampleWorldGroundwaterScore(x, z, settings.seed, settings.hydrology);
}

/** Authoritative well yield after applying the world's optional placement rule. */
export function sampleAuthoritativeWellGroundwaterScore(x: number, z: number): number {
  const settings = getActiveWorldGeneration();
  return sampleWellGroundwaterScoreForWorldRules(
    x,
    z,
    settings.seed,
    settings.hydrology,
    settings.wellAquiferNetworksEnabled,
  );
}

/** Compatibility alias for systems that still use the broader hydrology name. */
export const sampleAuthoritativeHydrologyScore = sampleAuthoritativeGroundwaterScore;

/** Applies the world's opt-in well-aquifer rule while preserving map bounds. */
export function sampleWellGroundwaterScoreForWorldRules(
  x: number,
  z: number,
  worldSeed: number,
  worldHydrology: number,
  wellAquiferNetworksEnabled: boolean,
): number {
  if (!isSupportedWorldPosition(x, z)) return 0;
  return wellAquiferNetworksEnabled
    ? sampleWorldGroundwaterScore(x, z, worldSeed, worldHydrology)
    : UNIFORM_GROUNDWATER_SCORE;
}

/**
 * Seeded underground aquifer score used by both client planning and server
 * simulation. World hydrology raises or lowers this network's water table;
 * it never injects visible surface-water features into the result.
 */
export function sampleWorldGroundwaterScore(
  x: number,
  z: number,
  worldSeed: number,
  worldHydrology: number,
): number {
  if (!isSupportedWorldPosition(x, z)) return 0;
  const aquifer = sampleAquiferPotential(x, z, worldSeed);
  const localPotential = 0.06 + aquifer * 0.72;
  const wetness = clamp01(worldHydrology / 100);
  return clamp01(localPotential * (0.72 + wetness * 0.56) + (wetness - 0.5) * 0.18);
}

/** Mirrors the server's temporary severe-summer aquifer drawdown. */
export function droughtGroundwaterScore(groundwaterScore: number): number {
  return clamp01(groundwaterScore) * DROUGHT_GROUNDWATER_MULTIPLIER;
}

/** Broad basins crossed by sinuous seams, forming a readable well-water network. */
export function sampleAquiferPotential(x: number, z: number, worldSeed: number): number {
  const seed = worldSeed >>> 0;
  const broad = valueNoise(x / 145 + 11.7, z / 145 - 8.3, seed ^ 0x68bc21eb);
  const local = valueNoise(
    (x + z * 0.28) / 58 - 17.1,
    (z - x * 0.19) / 58 + 23.4,
    seed ^ 0x02e5be93,
  );
  const seam = 1 - Math.abs(
    valueNoise(
      (x - z * 0.46) / 92 + 4.6,
      (z + x * 0.31) / 92 - 12.8,
      seed ^ 0x7f4a7c15,
    ) * 2 - 1,
  );
  return smoothstep(0.22, 0.78, broad * 0.5 + local * 0.32 + seam * 0.18);
}

function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothCurve(x - x0);
  const tz = smoothCurve(z - z0);
  const a = aquiferHash(x0, z0, seed);
  const b = aquiferHash(x0 + 1, z0, seed);
  const c = aquiferHash(x0, z0 + 1, seed);
  const d = aquiferHash(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}

function aquiferHash(x: number, z: number, seed: number): number {
  let hash = (seed >>> 0)
    ^ Math.imul(x | 0, 0x9e3779b1)
    ^ Math.imul(z | 0, 0x85ebca77);
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff;
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  return smoothCurve(clamp01((value - edge0) / (edge1 - edge0)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isSupportedWorldPosition(x: number, z: number): boolean {
  return Math.abs(x) <= MAX_SUPPORTED_WORLD_HALF && Math.abs(z) <= MAX_SUPPORTED_WORLD_HALF;
}
