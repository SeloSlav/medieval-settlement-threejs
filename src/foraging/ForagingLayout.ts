import type { ForestCore } from '../props/forestField.ts';
import {
  CENTRAL_CLEARING_RADIUS,
  forestDensityAt,
  hasMinimumDistance,
  mulberry32,
} from '../props/forestField.ts';
import { hashF64 } from '../rivers/riverHash.ts';

export type ForagingNodeKind = 'game' | 'berries';

export type ForagingSite = {
  x: number;
  z: number;
  kind: ForagingNodeKind;
};

export type ForagingLayoutOptions = {
  forestCores: ForestCore[];
  playableHalf?: number;
  seed?: number;
};

const DENSE_FOREST_MIN = 0.55;
const BERRY_EDGE_MIN = 0.28;
const BERRY_EDGE_MAX = 0.48;
const GAME_RESPAWN_CANDIDATE_TARGET = 48;
const MIN_FORAGING_SPACING = 180;

export class ForagingLayout {
  readonly sites: ForagingSite[];
  readonly gameRespawnCandidates: Array<{ x: number; z: number }>;
  readonly seed: number;

  private constructor(
    seed: number,
    sites: ForagingSite[],
    gameRespawnCandidates: Array<{ x: number; z: number }>,
  ) {
    this.seed = seed;
    this.sites = sites;
    this.gameRespawnCandidates = gameRespawnCandidates;
  }

  static create(options: ForagingLayoutOptions): ForagingLayout {
    const seed = options.seed ?? 0x8f3c21a7;
    const playableHalf = options.playableHalf ?? 410;
    const extent = playableHalf;
    const forestCores = options.forestCores;
    const rng = mulberry32(seed);

    const gameRespawnCandidates = collectDenseForestCandidates(
      rng,
      seed,
      extent,
      forestCores,
      GAME_RESPAWN_CANDIDATE_TARGET,
    );

    const sites: ForagingSite[] = [];
    const gameSite = pickGameSite(rng, seed, extent, forestCores, gameRespawnCandidates, sites);
    if (gameSite) sites.push(gameSite);

    const berrySite = pickBerrySite(rng, seed ^ 0x9e37, extent, forestCores, sites);
    if (berrySite) sites.push(berrySite);

    return new ForagingLayout(seed, sites, gameRespawnCandidates);
  }
}

function collectDenseForestCandidates(
  rng: () => number,
  seed: number,
  extent: number,
  forestCores: ForestCore[],
  targetCount: number,
): Array<{ x: number; z: number }> {
  const candidates: Array<{ x: number; z: number }> = [];
  const margin = extent * 0.08;
  const maxAttempts = targetCount * 60;

  for (let attempt = 0; attempt < maxAttempts && candidates.length < targetCount; attempt++) {
    const x = (rng() * 2 - 1) * (extent - margin);
    const z = (rng() * 2 - 1) * (extent - margin);
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 36) continue;

    const density = forestDensityAt(x, z, forestCores, extent, extent * (1080 / 820));
    if (density < DENSE_FOREST_MIN) continue;
    if (!hasMinimumDistance(candidates, x, z, 85)) continue;

    candidates.push({ x, z });
  }

  if (candidates.length === 0) {
    return createFallbackDenseCandidates(seed, extent);
  }

  return candidates;
}

function pickGameSite(
  rng: () => number,
  seed: number,
  extent: number,
  forestCores: ForestCore[],
  denseCandidates: Array<{ x: number; z: number }>,
  existing: ForagingSite[],
): ForagingSite | null {
  const shuffled = [...denseCandidates].sort(
    () => hashF64(seed, Math.floor(rng() * 997), 1) - 0.5,
  );

  for (const candidate of shuffled) {
    if (!hasMinimumDistance(existing, candidate.x, candidate.z, MIN_FORAGING_SPACING)) continue;
    return { x: candidate.x, z: candidate.z, kind: 'game' };
  }

  for (let attempt = 0; attempt < 320; attempt++) {
    const margin = extent * 0.08;
    const x = (rng() * 2 - 1) * (extent - margin);
    const z = (rng() * 2 - 1) * (extent - margin);
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 36) continue;
    const density = forestDensityAt(x, z, forestCores, extent, extent * (1080 / 820));
    if (density < DENSE_FOREST_MIN) continue;
    if (!hasMinimumDistance(existing, x, z, MIN_FORAGING_SPACING)) continue;
    return { x, z, kind: 'game' };
  }

  const fallback = denseCandidates[0] ?? { x: -186, z: 148 };
  return { x: fallback.x, z: fallback.z, kind: 'game' };
}

function pickBerrySite(
  rng: () => number,
  seed: number,
  extent: number,
  forestCores: ForestCore[],
  existing: ForagingSite[],
): ForagingSite | null {
  const margin = extent * 0.08;
  const terrainExtent = extent * (1080 / 820);
  let best: ForagingSite | null = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 420; attempt++) {
    const x = (rng() * 2 - 1) * (extent - margin);
    const z = (rng() * 2 - 1) * (extent - margin);
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 28) continue;
    if (!hasMinimumDistance(existing, x, z, MIN_FORAGING_SPACING)) continue;

    const density = forestDensityAt(x, z, forestCores, extent, terrainExtent);
    if (density < BERRY_EDGE_MIN || density > BERRY_EDGE_MAX) continue;

    const edgeScore = berryEdgeScore(x, z, forestCores, extent, terrainExtent);
    const meadowBias = meadowProximityScore(x, z, extent);
    const score = edgeScore * 0.62 + meadowBias * 0.28 + density * 0.1;
    if (score > bestScore && rng() < 0.42 + score * 0.5) {
      bestScore = score;
      best = { x, z, kind: 'berries' };
    }
  }

  if (best) return best;

  const presets = [
    { x: 142, z: -96 },
    { x: -118, z: 164 },
    { x: 88, z: 178 },
  ];
  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i];
    if (!hasMinimumDistance(existing, preset.x, preset.z, MIN_FORAGING_SPACING)) continue;
    const density = forestDensityAt(preset.x, preset.z, forestCores, extent, terrainExtent);
    if (density >= BERRY_EDGE_MIN && density <= BERRY_EDGE_MAX + 0.08) {
      return { x: preset.x, z: preset.z, kind: 'berries' };
    }
  }

  const offset = hashF64(seed, 3, 7) * 60 - 30;
  return { x: 120 + offset, z: -88 - offset * 0.3, kind: 'berries' };
}

function berryEdgeScore(
  x: number,
  z: number,
  forestCores: ForestCore[],
  extent: number,
  terrainExtent: number,
): number {
  const center = forestDensityAt(x, z, forestCores, extent, terrainExtent);
  const probes = [
    { dx: 18, dz: 0 },
    { dx: -18, dz: 0 },
    { dx: 0, dz: 18 },
    { dx: 0, dz: -18 },
  ];
  let maxDelta = 0;
  for (const probe of probes) {
    const neighbor = forestDensityAt(
      x + probe.dx,
      z + probe.dz,
      forestCores,
      extent,
      terrainExtent,
    );
    maxDelta = Math.max(maxDelta, Math.abs(neighbor - center));
  }
  return maxDelta;
}

function meadowProximityScore(x: number, z: number, extent: number): number {
  const meadowWave = Math.abs(z + Math.sin(x * 0.012) * 34 - extent * 0.16);
  return 1 - smoothstep(8, 72, meadowWave);
}

function createFallbackDenseCandidates(
  seed: number,
  _extent: number,
): Array<{ x: number; z: number }> {
  const presets = [
    { x: -186, z: 148 },
    { x: 204, z: -132 },
    { x: -96, z: -176 },
    { x: 168, z: 88 },
  ];
  return presets.map((preset, index) => ({
    x: preset.x + (hashF64(seed, index, 11) - 0.5) * 24,
    z: preset.z + (hashF64(seed, index, 12) - 0.5) * 24,
  }));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
