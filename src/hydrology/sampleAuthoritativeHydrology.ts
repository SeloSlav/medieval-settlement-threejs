import hydrologyGrid from '../../server/generated/hydrology_grid.json' with { type: 'json' };
import { getActiveWorldGeneration } from '../world/worldGenerationContext.ts';

type HydrologyGrid = {
  resolution: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  scores: number[];
};

const grid = hydrologyGrid as HydrologyGrid;
const MAX_SUPPORTED_WORLD_HALF = 672;

/** Matches the bilinear sampler used by the authoritative SpacetimeDB simulation. */
export function sampleAuthoritativeHydrologyScore(x: number, z: number): number {
  if (Math.abs(x) > MAX_SUPPORTED_WORLD_HALF || Math.abs(z) > MAX_SUPPORTED_WORLD_HALF) return 0;
  const baseScore = sampleEmbeddedHydrologyGrid(x, z);
  const settings = getActiveWorldGeneration();
  return applyWorldGroundwaterVariation(baseScore, x, z, settings.seed, settings.hydrology);
}

function sampleEmbeddedHydrologyGrid(x: number, z: number): number {
  if (x < grid.minX || x > grid.maxX || z < grid.minZ || z > grid.maxZ) return 0;
  const gx = ((x - grid.minX) / (grid.maxX - grid.minX)) * (grid.resolution - 1);
  const gz = ((z - grid.minZ) / (grid.maxZ - grid.minZ)) * (grid.resolution - 1);
  const ix0 = Math.max(0, Math.min(grid.resolution - 2, Math.floor(gx)));
  const iz0 = Math.max(0, Math.min(grid.resolution - 2, Math.floor(gz)));
  const tx = gx - ix0;
  const tz = gz - iz0;
  const at = (ix: number, iz: number): number => grid.scores[iz * grid.resolution + ix] ?? 0;
  const top = at(ix0, iz0) * (1 - tx) + at(ix0 + 1, iz0) * tx;
  const bottom = at(ix0, iz0 + 1) * (1 - tx) + at(ix0 + 1, iz0 + 1) * tx;
  return clamp01(top * (1 - tz) + bottom * tz);
}

/**
 * Adds the broad, seed-aware aquifer field used by the server simulation.
 * The embedded grid contributes valleys and alluvial ground; this field makes
 * inland wells depend on subsurface geology and the world's overall wetness.
 */
export function applyWorldGroundwaterVariation(
  baseScore: number,
  x: number,
  z: number,
  worldSeed: number,
  worldHydrology: number,
): number {
  const aquifer = sampleAquiferPotential(x, z, worldSeed);
  const subsurfaceScore = 0.06 + aquifer * 0.72;
  const localPotential = Math.max(clamp01(baseScore) * 0.94, subsurfaceScore);
  const wetness = clamp01(worldHydrology / 100);
  return clamp01(localPotential * (0.72 + wetness * 0.56) + (wetness - 0.5) * 0.18);
}

/** Broad pockets rather than speckled noise, so players can plan well sites. */
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
