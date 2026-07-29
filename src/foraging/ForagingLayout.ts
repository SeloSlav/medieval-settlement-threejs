import type { ForestCore } from '../props/forestField.ts';
import {
  CENTRAL_CLEARING_RADIUS,
  forestDensityAt,
  hasMinimumDistance,
  mulberry32,
} from '../props/forestField.ts';
import { hashF64 } from '../rivers/riverHash.ts';
import type { RiverLayout, RiverPoint } from '../rivers/RiverLayout.ts';
import { gamePatchSpawnRadius } from './foragingYields.ts';

export type ForagingNodeKind = 'game' | 'berries' | 'mushrooms' | 'fish';

export type ForagingSite = {
  x: number;
  z: number;
  kind: ForagingNodeKind;
  isRich?: boolean;
};

export type ForagingLayoutOptions = {
  forestCores: ForestCore[];
  riverLayout: RiverLayout;
  playableHalf?: number;
  seed?: number;
  nodeCounts?: Partial<Record<ForagingNodeKind, number>>;
};

const DENSE_FOREST_MIN = 0.55;
const MUSHROOM_FOREST_MIN = 0.68;
const BERRY_EDGE_MIN = 0.28;
const BERRY_EDGE_MAX = 0.48;
const GAME_RESPAWN_CANDIDATE_TARGET = 48;
const MIN_FORAGING_SPACING = 180;
const GAME_HABITAT_WATER_PROBE_SPACING = 3;

/**
 * Keeps the full initial herd footprint off the rendered river. The extra
 * padding covers the river field's shoreline dilation beyond the layout mask.
 */
export const GAME_HABITAT_WATER_CLEARANCE = gamePatchSpawnRadius(true) + 6;

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
    const nodeCounts = normalizeNodeCounts(options.nodeCounts);
    const desiredGameCandidateCount = Math.max(
      GAME_RESPAWN_CANDIDATE_TARGET,
      nodeCounts.game * 16,
    );

    const denseForestCandidates = collectDenseForestCandidates(
      rng,
      seed,
      extent,
      forestCores,
      desiredGameCandidateCount,
    );
    const gameRespawnCandidates = denseForestCandidates.filter((candidate) =>
      isGameHabitatClearOfWater(options.riverLayout, candidate.x, candidate.z)
    );
    if (gameRespawnCandidates.length < nodeCounts.game) {
      for (const candidate of createFallbackGameCandidates(extent, options.riverLayout)) {
        if (gameRespawnCandidates.length >= nodeCounts.game) break;
        if (!hasMinimumDistance(gameRespawnCandidates, candidate.x, candidate.z, 85)) continue;
        gameRespawnCandidates.push(candidate);
      }
    }
    const gameSiteCandidates = [
      ...denseForestCandidates,
      ...gameRespawnCandidates.filter((candidate) =>
        !denseForestCandidates.some((dense) => dense.x === candidate.x && dense.z === candidate.z)
      ),
    ];

    const sites: ForagingSite[] = [];
    for (let gameIndex = 0; gameIndex < nodeCounts.game; gameIndex++) {
      const gameSite = pickGameSite(
        rng,
        seed ^ gameIndex * 0x7f4a,
        extent,
        forestCores,
        options.riverLayout,
        gameSiteCandidates,
        sites,
      );
      if (gameSite) {
        sites.push({ ...gameSite, isRich: gameIndex === nodeCounts.game - 1 });
      }
    }

    for (let i = 0; i < nodeCounts.berries; i++) {
      const berrySite = pickBerrySite(rng, seed ^ (0x9e37 + i * 0x5151), extent, forestCores, sites);
      if (berrySite) sites.push(berrySite);
    }
    for (let i = 0; i < nodeCounts.mushrooms; i++) {
      const mushroomSite = pickMushroomSite(
        seed ^ (0x6d21 + i * 0x3137),
        extent,
        forestCores,
        denseForestCandidates,
        sites,
      );
      if (mushroomSite) sites.push(mushroomSite);
    }
    sites.push(...pickFishSites(
      options.riverLayout,
      extent,
      seed ^ 0x46a91d,
      nodeCounts.fish,
    ));

    return new ForagingLayout(seed, sites, gameRespawnCandidates);
  }
}

function normalizeNodeCounts(
  requested: ForagingLayoutOptions['nodeCounts'],
): Record<ForagingNodeKind, number> {
  const count = (kind: ForagingNodeKind) => Math.max(
    0,
    Math.min(3, Math.floor(requested?.[kind] ?? 2)),
  );
  return {
    game: count('game'),
    berries: count('berries'),
    mushrooms: count('mushrooms'),
    fish: count('fish'),
  };
}

function pickMushroomSite(
  seed: number,
  extent: number,
  forestCores: ForestCore[],
  denseCandidates: ReadonlyArray<{ x: number; z: number }>,
  existing: ReadonlyArray<ForagingSite>,
): ForagingSite | null {
  const terrainExtent = extent * (1080 / 820);
  const sufficientlySpaced = denseCandidates.filter((candidate) =>
    hasMinimumDistance(existing, candidate.x, candidate.z, 118)
  );
  const pool = sufficientlySpaced.length > 0 ? sufficientlySpaced : denseCandidates;
  let best: { x: number; z: number } | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < pool.length; index++) {
    const candidate = pool[index];
    const density = forestDensityAt(
      candidate.x,
      candidate.z,
      forestCores,
      extent,
      terrainExtent,
    );
    if (density < MUSHROOM_FOREST_MIN && sufficientlySpaced.length > 0) continue;
    const edgeDistance = Math.min(extent - Math.abs(candidate.x), extent - Math.abs(candidate.z));
    const score = density * 100
      + Math.min(edgeDistance, 90) * 0.08
      + hashF64(seed, index, 19) * 4;
    if (score <= bestScore) continue;
    best = candidate;
    bestScore = score;
  }

  return best ? { ...best, kind: 'mushrooms' } : null;
}

type FishCandidate = RiverPoint & { corridorIndex: number };

function pickFishSites(
  riverLayout: RiverLayout,
  extent: number,
  seed: number,
  requestedCount: number,
): ForagingSite[] {
  if (requestedCount <= 0) return [];
  const margin = Math.max(24, extent * 0.06);
  const candidates: FishCandidate[] = [];
  for (let corridorIndex = 0; corridorIndex < riverLayout.corridors.length; corridorIndex++) {
    const corridor = riverLayout.corridors[corridorIndex];
    for (let pointIndex = 0; pointIndex < corridor.points.length; pointIndex += 7) {
      const point = corridor.points[pointIndex];
      if (point.progress < 0.18 || point.progress > 0.82) continue;
      if (Math.abs(point.x) > extent - margin || Math.abs(point.z) > extent - margin) continue;
      if (!riverLayout.isWaterAt(point.x, point.z)) continue;
      candidates.push({ ...point, corridorIndex });
    }
  }

  if (candidates.length < requestedCount) {
    const fallback = riverLayout.corridors[0]?.points ?? [];
    const fallbackSites: ForagingSite[] = [];
    for (let index = 0; index < requestedCount; index++) {
      const progress = 0.25 + (index / Math.max(1, requestedCount - 1)) * 0.5;
      const point = fallback[Math.floor(fallback.length * progress)]
        ?? (index === requestedCount - 1 ? riverLayout.drain : { x: -36, z: -72 });
      fallbackSites.push({
        x: point.x,
        z: point.z,
        kind: 'fish',
        isRich: index === requestedCount - 1,
      });
    }
    return fallbackSites;
  }

  const rich = candidates.reduce((best, candidate) => {
    const score = fishCandidateNoise(seed, candidate, 1)
      + candidate.halfWidth * 12
      - Math.abs(candidate.progress - 0.68) * 24;
    const bestScore = fishCandidateNoise(seed, best, 1)
      + best.halfWidth * 12
      - Math.abs(best.progress - 0.68) * 24;
    return score > bestScore ? candidate : best;
  });

  const selected: FishCandidate[] = [rich];
  while (selected.length < requestedCount) {
    const remaining = candidates.filter((candidate) => !selected.includes(candidate));
    if (remaining.length === 0) break;
    const next = remaining.reduce((best, candidate) =>
      fishSpacingScore(seed, candidate, selected)
        > fishSpacingScore(seed, best, selected)
        ? candidate
        : best
    );
    selected.push(next);
  }

  return [
    ...selected.slice(1).map((site) => ({
      x: site.x,
      z: site.z,
      kind: 'fish' as const,
      isRich: false,
    })),
    { x: rich.x, z: rich.z, kind: 'fish', isRich: true },
  ];
}

function fishSpacingScore(
  seed: number,
  candidate: FishCandidate,
  selected: readonly FishCandidate[],
): number {
  const nearestDistance = selected.reduce(
    (nearest, site) => Math.min(
      nearest,
      Math.hypot(candidate.x - site.x, candidate.z - site.z),
    ),
    Number.POSITIVE_INFINITY,
  );
  return nearestDistance - candidate.halfWidth * 5 + fishCandidateNoise(seed, candidate, 2);
}

function fishCandidateNoise(seed: number, candidate: FishCandidate, salt: number): number {
  return hashF64(
    seed ^ salt * 0x9e37,
    candidate.corridorIndex,
    Math.round(candidate.progress * 10_000),
  ) * 3;
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
    return createFallbackDenseCandidates(seed);
  }

  return candidates;
}

function pickGameSite(
  rng: () => number,
  seed: number,
  extent: number,
  forestCores: ForestCore[],
  riverLayout: RiverLayout,
  denseCandidates: Array<{ x: number; z: number }>,
  existing: ForagingSite[],
): ForagingSite | null {
  const shuffled = [...denseCandidates].sort(
    () => hashF64(seed, Math.floor(rng() * 997), 1) - 0.5,
  );

  for (const candidate of shuffled) {
    if (!hasMinimumDistance(existing, candidate.x, candidate.z, MIN_FORAGING_SPACING)) continue;
    if (!isGameHabitatClearOfWater(riverLayout, candidate.x, candidate.z)) continue;
    return { x: candidate.x, z: candidate.z, kind: 'game' };
  }

  for (let attempt = 0; attempt < 320; attempt++) {
    const margin = extent * 0.08;
    const x = (rng() * 2 - 1) * (extent - margin);
    const z = (rng() * 2 - 1) * (extent - margin);
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 36) continue;
    if (!isGameHabitatClearOfWater(riverLayout, x, z)) continue;
    const density = forestDensityAt(x, z, forestCores, extent, extent * (1080 / 820));
    if (density < DENSE_FOREST_MIN) continue;
    if (!hasMinimumDistance(existing, x, z, MIN_FORAGING_SPACING)) continue;
    return { x, z, kind: 'game' };
  }

  const fallback = denseCandidates
    .filter((candidate) => isGameHabitatClearOfWater(riverLayout, candidate.x, candidate.z))
    .reduce<{ x: number; z: number } | null>(
      (best, candidate) => {
        if (!best) return candidate;
        return nearestSiteDistance(candidate, existing) > nearestSiteDistance(best, existing)
          ? candidate
          : best;
      },
      null,
    );
  return fallback ? { x: fallback.x, z: fallback.z, kind: 'game' } : null;
}

function nearestSiteDistance(
  point: { x: number; z: number },
  sites: ReadonlyArray<ForagingSite>,
): number {
  if (sites.length === 0) return Number.POSITIVE_INFINITY;
  return sites.reduce(
    (nearest, site) => Math.min(nearest, Math.hypot(point.x - site.x, point.z - site.z)),
    Number.POSITIVE_INFINITY,
  );
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
): Array<{ x: number; z: number }> {
  const presets = [
    { x: -186, z: 148 },
    { x: 204, z: -132 },
    { x: -96, z: -176 },
    { x: 168, z: 88 },
  ];
  const candidates = presets.map((preset, index) => ({
    x: preset.x + (hashF64(seed, index, 11) - 0.5) * 24,
    z: preset.z + (hashF64(seed, index, 12) - 0.5) * 24,
  }));
  return candidates;
}

function createFallbackGameCandidates(
  extent: number,
  riverLayout: RiverLayout,
): Array<{ x: number; z: number }> {
  const candidates: Array<{ x: number; z: number }> = [];
  const limit = extent - GAME_HABITAT_WATER_CLEARANCE;
  const gridStep = 34;
  for (let z = -limit; z <= limit && candidates.length < 12; z += gridStep) {
    for (let x = -limit; x <= limit && candidates.length < 12; x += gridStep) {
      if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 36) continue;
      if (!hasMinimumDistance(candidates, x, z, 85)) continue;
      if (!isGameHabitatClearOfWater(riverLayout, x, z)) continue;
      candidates.push({ x, z });
    }
  }
  return candidates;
}

export function isGameHabitatClearOfWater(
  riverLayout: RiverLayout,
  x: number,
  z: number,
  clearance = GAME_HABITAT_WATER_CLEARANCE,
): boolean {
  const probeReach = Math.ceil(clearance / GAME_HABITAT_WATER_PROBE_SPACING);
  const clearanceSq = clearance * clearance;
  for (let gridZ = -probeReach; gridZ <= probeReach; gridZ++) {
    const dz = gridZ * GAME_HABITAT_WATER_PROBE_SPACING;
    for (let gridX = -probeReach; gridX <= probeReach; gridX++) {
      const dx = gridX * GAME_HABITAT_WATER_PROBE_SPACING;
      if (dx * dx + dz * dz > clearanceSq) continue;
      if (riverLayout.sampleRiverMask(x + dx, z + dz) > 0) return false;
    }
  }
  return true;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
