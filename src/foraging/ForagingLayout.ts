import type { ForestCore } from '../props/forestField.ts';
import {
  CENTRAL_CLEARING_RADIUS,
  forestDensityAt,
  hasMinimumDistance,
  mulberry32,
} from '../props/forestField.ts';
import { hashF64 } from '../rivers/riverHash.ts';
import type { RiverLayout, RiverPoint } from '../rivers/RiverLayout.ts';
import {
  RICH_RESOURCE_MIN_SPACING,
  regionalPlacementAffinity,
  sampleRegionalPlacementCandidate,
  strictRegionalPlacementAffinity,
  type ResourcePlacementTarget,
} from '../world/resourceRegionDistribution.ts';
import {
  BERRY_PATCH_MAX_SPAWN_RADIUS,
  MUSHROOM_PATCH_MAX_SPAWN_RADIUS,
  gamePatchSpawnRadius,
} from './foragingYields.ts';
import type { ResourceTerrainAccessibilityTest } from '../world/resourceTerrainAccessibility.ts';

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
  wildlifeDepositFootprints?: ReadonlyArray<{ x: number; z: number; radius: number }>;
  playableHalf?: number;
  seed?: number;
  nodeCounts?: Partial<Record<ForagingNodeKind, number>>;
  richNodeCounts?: Partial<Record<ForagingNodeKind, number>>;
  placementTargets?: Partial<Record<ForagingNodeKind, readonly ResourcePlacementTarget[]>>;
  richExclusionSites?: ReadonlyArray<{ x: number; z: number }>;
  isTerrainAccessible?: ResourceTerrainAccessibilityTest;
};

const DENSE_FOREST_MIN = 0.55;
export const MUSHROOM_FOREST_MIN = 0.68;
const BERRY_EDGE_MIN = 0.28;
const BERRY_EDGE_MAX = 0.48;
const GAME_RESPAWN_CANDIDATE_TARGET = 48;
const MIN_FORAGING_SPACING = 180;
const FORAGING_WATER_PROBE_SPACING = 3;
const FISH_MASK_SCAN_SPACING = 12;
const FISH_CAMP_FOOTPRINT_RADIUS = 7;
const FISH_MAX_SHORE_DISTANCE = 58;

/**
 * Keeps the full initial herd footprint off the rendered river. The extra
 * padding covers the river field's shoreline dilation beyond the layout mask.
 */
export const GAME_HABITAT_WATER_CLEARANCE = gamePatchSpawnRadius(true) + 6;
/** Full rich-herd reach plus a quiet buffer beyond a physical deposit edge. */
export const GAME_HABITAT_DEPOSIT_CLEARANCE = gamePatchSpawnRadius(true) + 14;
/** Keeps every visible raspberry clump beyond the rendered shoreline. */
export const BERRY_PATCH_WATER_CLEARANCE = BERRY_PATCH_MAX_SPAWN_RADIUS + 6;
/** Keeps every visible mushroom in its deep-forest bed beyond the rendered shoreline. */
export const MUSHROOM_PATCH_WATER_CLEARANCE = MUSHROOM_PATCH_MAX_SPAWN_RADIUS + 6;

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

  withGameRespawnCandidates(
    predicate: (candidate: { x: number; z: number }) => boolean,
  ): ForagingLayout {
    return new ForagingLayout(
      this.seed,
      this.sites,
      this.gameRespawnCandidates.filter(predicate),
    );
  }

  static create(options: ForagingLayoutOptions): ForagingLayout {
    const seed = options.seed ?? 0x8f3c21a7;
    const playableHalf = options.playableHalf ?? 410;
    const extent = playableHalf;
    const forestCores = options.forestCores;
    const wildlifeDeposits = options.wildlifeDepositFootprints ?? [];
    const isTerrainAccessible = options.isTerrainAccessible ?? (() => true);
    const rng = mulberry32(seed);
    const nodeCounts = normalizeNodeCounts(options.nodeCounts);
    const richNodeCounts = normalizeRichNodeCounts(options.richNodeCounts, nodeCounts);
    const richExclusionSites = options.richExclusionSites ?? [];
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
      isTerrainAccessible,
    );
    const gameRespawnCandidates = denseForestCandidates.filter((candidate) =>
      isTerrainAccessible(candidate.x, candidate.z)
      && isGameHabitatClearOfWater(options.riverLayout, candidate.x, candidate.z)
      && isGameHabitatClearOfDeposits(wildlifeDeposits, candidate.x, candidate.z)
    );
    if (gameRespawnCandidates.length < nodeCounts.game) {
      for (const candidate of createFallbackGameCandidates(
        extent,
        options.riverLayout,
        wildlifeDeposits,
        isTerrainAccessible,
      )) {
        if (gameRespawnCandidates.length >= nodeCounts.game) break;
        if (!hasMinimumDistance(gameRespawnCandidates, candidate.x, candidate.z, 85)) continue;
        gameRespawnCandidates.push(candidate);
      }
    }
    const gameSiteCandidates = [...gameRespawnCandidates];

    const sites: ForagingSite[] = [];
    for (let gameIndex = 0; gameIndex < nodeCounts.game; gameIndex++) {
      const isRich = gameIndex >= nodeCounts.game - richNodeCounts.game;
      const richClearanceSites = isRich
        ? [...richExclusionSites, ...sites.filter((site) => site.isRich === true)]
        : [];
      const gameSite = pickGameSite(
        rng,
        seed ^ gameIndex * 0x7f4a,
        extent,
        forestCores,
        options.riverLayout,
        wildlifeDeposits,
        gameSiteCandidates,
        sites,
        options.placementTargets?.game?.[gameIndex],
        isTerrainAccessible,
        isRich,
        richClearanceSites,
      );
      if (gameSite) {
        sites.push({
          ...gameSite,
          isRich,
        });
      }
    }

    for (let i = 0; i < nodeCounts.berries; i++) {
      const isRich = i >= nodeCounts.berries - richNodeCounts.berries;
      const richClearanceSites = isRich
        ? [...richExclusionSites, ...sites.filter((site) => site.isRich === true)]
        : [];
      const berrySite = pickBerrySite(
        rng,
        seed ^ (0x9e37 + i * 0x5151),
        extent,
        forestCores,
        options.riverLayout,
        sites,
        options.placementTargets?.berries?.[i],
        isTerrainAccessible,
        isRich,
        richClearanceSites,
      );
      if (berrySite) {
        sites.push({
          ...berrySite,
          isRich,
        });
      }
    }
    for (let i = 0; i < nodeCounts.mushrooms; i++) {
      const isRich = i >= nodeCounts.mushrooms - richNodeCounts.mushrooms;
      const richClearanceSites = isRich
        ? [...richExclusionSites, ...sites.filter((site) => site.isRich === true)]
        : [];
      const mushroomSite = pickMushroomSite(
        seed ^ (0x6d21 + i * 0x3137),
        extent,
        forestCores,
        options.riverLayout,
        denseForestCandidates,
        sites,
        options.placementTargets?.mushrooms?.[i],
        isTerrainAccessible,
        isRich,
        richClearanceSites,
      );
      if (mushroomSite) {
        sites.push({
          ...mushroomSite,
          isRich,
        });
      }
    }
    sites.push(...pickFishSites(
      options.riverLayout,
      extent,
      seed ^ 0x46a91d,
      nodeCounts.fish,
      richNodeCounts.fish,
      options.placementTargets?.fish,
      [...richExclusionSites, ...sites.filter((site) => site.isRich === true)],
      isTerrainAccessible,
    ));

    return new ForagingLayout(seed, sites, gameRespawnCandidates);
  }
}

function normalizeNodeCounts(
  requested: ForagingLayoutOptions['nodeCounts'],
): Record<ForagingNodeKind, number> {
  const count = (kind: ForagingNodeKind) => Math.max(
    0,
    Math.min(6, Math.floor(requested?.[kind] ?? 2)),
  );
  return {
    game: count('game'),
    berries: count('berries'),
    mushrooms: count('mushrooms'),
    fish: count('fish'),
  };
}

function normalizeRichNodeCounts(
  requested: ForagingLayoutOptions['richNodeCounts'],
  nodeCounts: Record<ForagingNodeKind, number>,
): Record<ForagingNodeKind, number> {
  const count = (kind: ForagingNodeKind) => Math.max(
    0,
    Math.min(nodeCounts[kind], Math.floor(requested?.[kind] ?? 0)),
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
  riverLayout: RiverLayout,
  denseCandidates: ReadonlyArray<{ x: number; z: number }>,
  existing: ReadonlyArray<ForagingSite>,
  placementTarget?: ResourcePlacementTarget,
  isTerrainAccessible: ResourceTerrainAccessibilityTest = () => true,
  strictRegional = false,
  richExclusionSites: ReadonlyArray<{ x: number; z: number }> = [],
): ForagingSite | null {
  const terrainExtent = extent * (1080 / 820);
  const validCandidates = denseCandidates.filter((candidate) =>
    forestDensityAt(
      candidate.x,
      candidate.z,
      forestCores,
      extent,
      terrainExtent,
    ) >= MUSHROOM_FOREST_MIN
    && isTerrainAccessible(candidate.x, candidate.z)
    && isMushroomPatchClearOfWater(riverLayout, candidate.x, candidate.z)
    && hasMinimumDistance(
      richExclusionSites,
      candidate.x,
      candidate.z,
      RICH_RESOURCE_MIN_SPACING,
    )
  );
  const sufficientlySpaced = validCandidates.filter((candidate) =>
    hasMinimumDistance(existing, candidate.x, candidate.z, 118)
  );
  const pool = sufficientlySpaced.length > 0 ? sufficientlySpaced : validCandidates;
  let best: { x: number; z: number } | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const affinity = strictRegional
    ? strictRegionalPlacementAffinity
    : regionalPlacementAffinity;

  for (let index = 0; index < pool.length; index++) {
    const candidate = pool[index];
    const density = forestDensityAt(
      candidate.x,
      candidate.z,
      forestCores,
      extent,
      terrainExtent,
    );
    const edgeDistance = Math.min(extent - Math.abs(candidate.x), extent - Math.abs(candidate.z));
    const score = density * 100
      + Math.min(edgeDistance, 90) * 0.08
      + hashF64(seed, index, 19) * 4
      + affinity(candidate.x, candidate.z, placementTarget) * 58;
    if (score <= bestScore) continue;
    best = candidate;
    bestScore = score;
  }

  return best ? { ...best, kind: 'mushrooms' } : null;
}

type FishCandidate = RiverPoint & { corridorIndex: number };

export function fishPlacementTargetScore(options: {
  riverLayout: RiverLayout;
  extent: number;
  seed: number;
  requestedCount: number;
  target: ResourcePlacementTarget;
  isTerrainAccessible?: ResourceTerrainAccessibilityTest;
}): number {
  const candidates = collectFishSiteCandidates(
    options.riverLayout,
    options.extent,
    options.seed,
    options.requestedCount,
    options.isTerrainAccessible ?? (() => true),
  );
  return candidates.reduce(
    (best, candidate) => Math.max(
      best,
      fishRegionalScore(options.seed, candidate, [], options.target, true),
    ),
    Number.NEGATIVE_INFINITY,
  );
}

function pickFishSites(
  riverLayout: RiverLayout,
  extent: number,
  seed: number,
  requestedCount: number,
  requestedRichCount: number,
  placementTargets?: readonly ResourcePlacementTarget[],
  richExclusionSites: ReadonlyArray<{ x: number; z: number }> = [],
  isTerrainAccessible: ResourceTerrainAccessibilityTest = () => true,
): ForagingSite[] {
  if (requestedCount <= 0) return [];
  const candidates = collectFishSiteCandidates(
    riverLayout,
    extent,
    seed,
    requestedCount,
    isTerrainAccessible,
  );

  // A fish node without actual surface water is worse than a missing optional
  // resource: its camp can never be placed and its marker lies to the player.
  if (candidates.length === 0) return [];

  const selected: FishCandidate[] = [];
  while (selected.length < requestedCount) {
    const strictRegional = selected.length < requestedRichCount;
    const remaining = candidates.filter((candidate) =>
      !selected.includes(candidate)
      && (!strictRegional || hasMinimumDistance(
        richExclusionSites,
        candidate.x,
        candidate.z,
        RICH_RESOURCE_MIN_SPACING,
      ))
    );
    if (remaining.length === 0) break;
    const placementTarget = placementTargets?.[selected.length];
    const next = remaining.reduce((best, candidate) =>
      fishRegionalScore(seed, candidate, selected, placementTarget, strictRegional)
        > fishRegionalScore(seed, best, selected, placementTarget, strictRegional)
        ? candidate
        : best
    );
    selected.push(next);
  }

  const richCount = Math.max(0, Math.min(selected.length, requestedRichCount));
  return selected.map((site, index) => ({
    x: site.x,
    z: site.z,
    kind: 'fish' as const,
    isRich: index < richCount,
  }));
}

function collectFishSiteCandidates(
  riverLayout: RiverLayout,
  extent: number,
  seed: number,
  requestedCount: number,
  isTerrainAccessible: ResourceTerrainAccessibilityTest,
): FishCandidate[] {
  const margin = Math.max(24, extent * 0.06);
  const candidates: FishCandidate[] = [];
  for (let corridorIndex = 0; corridorIndex < riverLayout.corridors.length; corridorIndex++) {
    const corridor = riverLayout.corridors[corridorIndex];
    for (let pointIndex = 0; pointIndex < corridor.points.length; pointIndex += 7) {
      const point = corridor.points[pointIndex];
      if (point.progress < 0.18 || point.progress > 0.82) continue;
      if (Math.abs(point.x) > extent - margin || Math.abs(point.z) > extent - margin) continue;
      if (!riverLayout.isWaterAt(point.x, point.z)) continue;
      if (!hasReachableDryFishingShore(
        riverLayout,
        point.x,
        point.z,
        isTerrainAccessible,
      )) continue;
      candidates.push({ ...point, corridorIndex });
    }
  }

  if (candidates.length < requestedCount) {
    for (const candidate of collectSurfaceWaterFishCandidates(
      riverLayout,
      extent,
      seed,
      isTerrainAccessible,
    )) {
      if (candidates.some((existing) =>
        Math.hypot(existing.x - candidate.x, existing.z - candidate.z) < 18
      )) continue;
      candidates.push(candidate);
    }
  }
  return candidates;
}

function fishRegionalScore(
  seed: number,
  candidate: FishCandidate,
  selected: readonly FishCandidate[],
  placementTarget: ResourcePlacementTarget | undefined,
  strictRegional = false,
): number {
  const spacing = selected.length > 0
    ? fishSpacingScore(seed, candidate, selected) * 0.16
    : 0;
  const affinity = strictRegional
    ? strictRegionalPlacementAffinity
    : regionalPlacementAffinity;
  return affinity(candidate.x, candidate.z, placementTarget) * 72
    + candidate.halfWidth * 8
    - Math.abs(candidate.progress - 0.62) * 10
    + spacing
    + fishCandidateNoise(seed, candidate, 1);
}

function collectSurfaceWaterFishCandidates(
  riverLayout: RiverLayout,
  extent: number,
  seed: number,
  isTerrainAccessible: ResourceTerrainAccessibilityTest = () => true,
): FishCandidate[] {
  const candidates: FishCandidate[] = [];
  const margin = Math.max(24, extent * 0.06);
  const limit = extent - margin;
  const offsetX = (hashF64(seed, 71, 3) - 0.5) * FISH_MASK_SCAN_SPACING;
  const offsetZ = (hashF64(seed, 83, 5) - 0.5) * FISH_MASK_SCAN_SPACING;

  for (let z = -limit + offsetZ; z <= limit; z += FISH_MASK_SCAN_SPACING) {
    for (let x = -limit + offsetX; x <= limit; x += FISH_MASK_SCAN_SPACING) {
      if (!riverLayout.isWaterAt(x, z)) continue;
      if (!hasReachableDryFishingShore(riverLayout, x, z, isTerrainAccessible)) continue;
      candidates.push({
        x,
        z,
        progress: (z + limit) / Math.max(limit * 2, 1),
        halfWidth: estimateWaterClearance(riverLayout, x, z),
        channelDepth: 1,
        corridorIndex: -1,
      });
    }
  }

  return candidates;
}

function estimateWaterClearance(riverLayout: RiverLayout, x: number, z: number): number {
  let clearance = 1;
  for (let radius = 3; radius <= 15; radius += 3) {
    let ringIsWet = true;
    for (let index = 0; index < 12; index++) {
      const angle = index / 12 * Math.PI * 2;
      if (!riverLayout.isWaterAt(
        x + Math.cos(angle) * radius,
        z + Math.sin(angle) * radius,
      )) {
        ringIsWet = false;
        break;
      }
    }
    if (!ringIsWet) break;
    clearance = radius;
  }
  return clearance;
}

function hasReachableDryFishingShore(
  riverLayout: RiverLayout,
  shoalX: number,
  shoalZ: number,
  isTerrainAccessible: ResourceTerrainAccessibilityTest = () => true,
): boolean {
  for (let radius = 8; radius <= FISH_MAX_SHORE_DISTANCE; radius += 4) {
    const samples = Math.max(32, Math.ceil(Math.PI * 2 * radius / 4));
    for (let index = 0; index < samples; index++) {
      const angle = index / samples * Math.PI * 2;
      const x = shoalX + Math.cos(angle) * radius;
      const z = shoalZ + Math.sin(angle) * radius;
      if (
        isTerrainAccessible(x, z)
        && isDryFishingCampFootprint(riverLayout, x, z)
      ) return true;
    }
  }
  return false;
}

function isDryFishingCampFootprint(
  riverLayout: RiverLayout,
  x: number,
  z: number,
): boolean {
  if (riverLayout.isWaterAt(x, z)) return false;
  for (let index = 0; index < 16; index++) {
    const angle = index / 16 * Math.PI * 2;
    if (riverLayout.isWaterAt(
      x + Math.cos(angle) * FISH_CAMP_FOOTPRINT_RADIUS,
      z + Math.sin(angle) * FISH_CAMP_FOOTPRINT_RADIUS,
    )) return false;
  }
  return true;
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
  isTerrainAccessible: ResourceTerrainAccessibilityTest = () => true,
): Array<{ x: number; z: number }> {
  const candidates: Array<{ x: number; z: number }> = [];
  const margin = extent * 0.08;
  const maxAttempts = targetCount * 60;

  for (let attempt = 0; attempt < maxAttempts && candidates.length < targetCount; attempt++) {
    const x = (rng() * 2 - 1) * (extent - margin);
    const z = (rng() * 2 - 1) * (extent - margin);
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 36) continue;
    if (!isTerrainAccessible(x, z)) continue;

    const density = forestDensityAt(x, z, forestCores, extent, extent * (1080 / 820));
    if (density < DENSE_FOREST_MIN) continue;
    if (!hasMinimumDistance(candidates, x, z, 85)) continue;

    candidates.push({ x, z });
  }

  if (candidates.length === 0) {
    return createFallbackDenseCandidates(seed).filter((candidate) =>
      isTerrainAccessible(candidate.x, candidate.z)
    );
  }

  return candidates;
}

function pickGameSite(
  rng: () => number,
  seed: number,
  extent: number,
  forestCores: ForestCore[],
  riverLayout: RiverLayout,
  wildlifeDeposits: ReadonlyArray<{ x: number; z: number; radius: number }>,
  denseCandidates: Array<{ x: number; z: number }>,
  existing: ForagingSite[],
  placementTarget?: ResourcePlacementTarget,
  isTerrainAccessible: ResourceTerrainAccessibilityTest = () => true,
  strictRegional = false,
  richExclusionSites: ReadonlyArray<{ x: number; z: number }> = [],
): ForagingSite | null {
  const affinity = strictRegional
    ? strictRegionalPlacementAffinity
    : regionalPlacementAffinity;
  const shuffled = denseCandidates
    .map((candidate, index) => ({
      candidate,
      score: affinity(candidate.x, candidate.z, placementTarget) * 100
        + hashF64(seed, index, 1) * 8,
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.candidate);

  for (const candidate of shuffled) {
    if (!isTerrainAccessible(candidate.x, candidate.z)) continue;
    if (!hasMinimumDistance(
      richExclusionSites,
      candidate.x,
      candidate.z,
      RICH_RESOURCE_MIN_SPACING,
    )) continue;
    if (!hasMinimumDistance(existing, candidate.x, candidate.z, MIN_FORAGING_SPACING)) continue;
    if (!isGameHabitatClearOfWater(riverLayout, candidate.x, candidate.z)) continue;
    if (!isGameHabitatClearOfDeposits(wildlifeDeposits, candidate.x, candidate.z)) continue;
    return { x: candidate.x, z: candidate.z, kind: 'game' };
  }

  for (let attempt = 0; attempt < 320; attempt++) {
    const margin = extent * 0.08;
    const point = sampleRegionalPlacementCandidate(
      rng,
      placementTarget,
      extent - margin,
      attempt,
      320,
    );
    if (!point) continue;
    const { x, z } = point;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 36) continue;
    if (!isTerrainAccessible(x, z)) continue;
    if (!hasMinimumDistance(
      richExclusionSites,
      x,
      z,
      RICH_RESOURCE_MIN_SPACING,
    )) continue;
    if (!isGameHabitatClearOfWater(riverLayout, x, z)) continue;
    if (!isGameHabitatClearOfDeposits(wildlifeDeposits, x, z)) continue;
    const density = forestDensityAt(x, z, forestCores, extent, extent * (1080 / 820));
    if (density < DENSE_FOREST_MIN) continue;
    if (!hasMinimumDistance(existing, x, z, MIN_FORAGING_SPACING)) continue;
    return { x, z, kind: 'game' };
  }

  const fallback = denseCandidates
    .filter((candidate) =>
      isTerrainAccessible(candidate.x, candidate.z)
      && hasMinimumDistance(
        richExclusionSites,
        candidate.x,
        candidate.z,
        RICH_RESOURCE_MIN_SPACING,
      )
      && isGameHabitatClearOfWater(riverLayout, candidate.x, candidate.z)
      && isGameHabitatClearOfDeposits(wildlifeDeposits, candidate.x, candidate.z)
    )
    .reduce<{ x: number; z: number } | null>(
      (best, candidate) => {
        if (!best) return candidate;
        const candidateScore = nearestSiteDistance(candidate, existing)
          + affinity(candidate.x, candidate.z, placementTarget) * extent;
        const bestScore = nearestSiteDistance(best, existing)
          + affinity(best.x, best.z, placementTarget) * extent;
        return candidateScore > bestScore
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
  riverLayout: RiverLayout,
  existing: ForagingSite[],
  placementTarget?: ResourcePlacementTarget,
  isTerrainAccessible: ResourceTerrainAccessibilityTest = () => true,
  strictRegional = false,
  richExclusionSites: ReadonlyArray<{ x: number; z: number }> = [],
): ForagingSite | null {
  const margin = extent * 0.08;
  const terrainExtent = extent * (1080 / 820);
  let best: ForagingSite | null = null;
  let bestScore = -Infinity;
  const affinity = strictRegional
    ? strictRegionalPlacementAffinity
    : regionalPlacementAffinity;

  for (let attempt = 0; attempt < 420; attempt++) {
    const point = sampleRegionalPlacementCandidate(
      rng,
      placementTarget,
      extent - margin,
      attempt,
      420,
    );
    if (!point) continue;
    const { x, z } = point;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 28) continue;
    if (!isTerrainAccessible(x, z)) continue;
    if (!hasMinimumDistance(
      richExclusionSites,
      x,
      z,
      RICH_RESOURCE_MIN_SPACING,
    )) continue;
    if (!hasMinimumDistance(existing, x, z, MIN_FORAGING_SPACING)) continue;

    const density = forestDensityAt(x, z, forestCores, extent, terrainExtent);
    if (density < BERRY_EDGE_MIN || density > BERRY_EDGE_MAX) continue;

    const edgeScore = berryEdgeScore(x, z, forestCores, extent, terrainExtent);
    const meadowBias = meadowProximityScore(x, z, extent);
    const score = edgeScore * 0.62
      + meadowBias * 0.28
      + density * 0.1
      + affinity(x, z, placementTarget) * 1.25;
    const accepted = rng() < 0.42 + score * 0.5;
    if (!isBerryPatchClearOfWater(riverLayout, x, z)) continue;
    if (score > bestScore && accepted) {
      bestScore = score;
      best = { x, z, kind: 'berries' };
    }
  }

  if (best) return best;

  const presets = placementTarget
    ? []
    : [
        { x: 142, z: -96 },
        { x: -118, z: 164 },
        { x: 88, z: 178 },
      ];
  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i];
    if (!isTerrainAccessible(preset.x, preset.z)) continue;
    if (!hasMinimumDistance(existing, preset.x, preset.z, MIN_FORAGING_SPACING)) continue;
    if (!isBerryPatchClearOfWater(riverLayout, preset.x, preset.z)) continue;
    const density = forestDensityAt(preset.x, preset.z, forestCores, extent, terrainExtent);
    if (density >= BERRY_EDGE_MIN && density <= BERRY_EDGE_MAX + 0.08) {
      return { x: preset.x, z: preset.z, kind: 'berries' };
    }
  }

  return pickFallbackBerrySite(
    seed,
    extent,
    forestCores,
    riverLayout,
    existing,
    placementTarget,
    isTerrainAccessible,
    strictRegional,
    richExclusionSites,
  );
}

function pickFallbackBerrySite(
  seed: number,
  extent: number,
  forestCores: ForestCore[],
  riverLayout: RiverLayout,
  existing: ReadonlyArray<ForagingSite>,
  placementTarget?: ResourcePlacementTarget,
  isTerrainAccessible: ResourceTerrainAccessibilityTest = () => true,
  strictRegional = false,
  richExclusionSites: ReadonlyArray<{ x: number; z: number }> = [],
): ForagingSite | null {
  const rng = mulberry32(seed ^ 0x62b97);
  const limit = extent * 0.92;
  const terrainExtent = extent * (1080 / 820);
  let best: ForagingSite | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const affinity = strictRegional
    ? strictRegionalPlacementAffinity
    : regionalPlacementAffinity;

  for (let attempt = 0; attempt < 1_200; attempt++) {
    const point = sampleRegionalPlacementCandidate(
      rng,
      placementTarget,
      limit,
      attempt,
      1_200,
    );
    if (!point) continue;
    const { x, z } = point;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 28) continue;
    if (!isTerrainAccessible(x, z)) continue;
    if (!hasMinimumDistance(
      richExclusionSites,
      x,
      z,
      RICH_RESOURCE_MIN_SPACING,
    )) continue;
    if (!hasMinimumDistance(existing, x, z, MIN_FORAGING_SPACING)) continue;
    if (!isBerryPatchClearOfWater(riverLayout, x, z)) continue;

    const density = forestDensityAt(x, z, forestCores, extent, terrainExtent);
    const edgeFit = 1 - Math.min(
      1,
      Math.abs(density - (BERRY_EDGE_MIN + BERRY_EDGE_MAX) * 0.5) / 0.38,
    );
    const score = edgeFit * 0.62
      + berryEdgeScore(x, z, forestCores, extent, terrainExtent) * 0.24
      + meadowProximityScore(x, z, extent) * 0.14
      + affinity(x, z, placementTarget) * 1.25;
    if (score <= bestScore) continue;
    bestScore = score;
    best = { x, z, kind: 'berries' };
  }

  return best;
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
  wildlifeDeposits: ReadonlyArray<{ x: number; z: number; radius: number }>,
  isTerrainAccessible: ResourceTerrainAccessibilityTest = () => true,
): Array<{ x: number; z: number }> {
  const candidates: Array<{ x: number; z: number }> = [];
  const limit = extent - GAME_HABITAT_WATER_CLEARANCE;
  const gridStep = 34;
  for (let z = -limit; z <= limit && candidates.length < 12; z += gridStep) {
    for (let x = -limit; x <= limit && candidates.length < 12; x += gridStep) {
      if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 36) continue;
      if (!isTerrainAccessible(x, z)) continue;
      if (!hasMinimumDistance(candidates, x, z, 85)) continue;
      if (!isGameHabitatClearOfWater(riverLayout, x, z)) continue;
      if (!isGameHabitatClearOfDeposits(wildlifeDeposits, x, z)) continue;
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
  return isForagingFootprintClearOfWater(riverLayout, x, z, clearance);
}

export function isGameHabitatClearOfDeposits(
  deposits: ReadonlyArray<{ x: number; z: number; radius: number }>,
  x: number,
  z: number,
  clearance = GAME_HABITAT_DEPOSIT_CLEARANCE,
): boolean {
  return deposits.every((deposit) =>
    Math.hypot(x - deposit.x, z - deposit.z) > deposit.radius + clearance
  );
}

export function isBerryPatchClearOfWater(
  riverLayout: RiverLayout,
  x: number,
  z: number,
  clearance = BERRY_PATCH_WATER_CLEARANCE,
): boolean {
  return isForagingFootprintClearOfWater(riverLayout, x, z, clearance);
}

export function isMushroomPatchClearOfWater(
  riverLayout: RiverLayout,
  x: number,
  z: number,
  clearance = MUSHROOM_PATCH_WATER_CLEARANCE,
): boolean {
  return isForagingFootprintClearOfWater(riverLayout, x, z, clearance);
}

function isForagingFootprintClearOfWater(
  riverLayout: RiverLayout,
  x: number,
  z: number,
  clearance: number,
): boolean {
  const probeReach = Math.ceil(clearance / FORAGING_WATER_PROBE_SPACING);
  const clearanceSq = clearance * clearance;
  for (let gridZ = -probeReach; gridZ <= probeReach; gridZ++) {
    const dz = gridZ * FORAGING_WATER_PROBE_SPACING;
    for (let gridX = -probeReach; gridX <= probeReach; gridX++) {
      const dx = gridX * FORAGING_WATER_PROBE_SPACING;
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
