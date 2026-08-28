import { mulberry32 } from '../props/forestField.ts';
import {
  MAP_SIZE_PRESETS,
  deriveSubSeed,
  type WorldGenerationSettings,
} from './worldGenerationSettings.ts';

export type ResourceTerritory = {
  index: number;
  centerX: number;
  centerZ: number;
  plannedNodeCount: number;
  plannedRichNodeCount: number;
};

export type ResourcePlacementTarget = {
  territoryIndex: number;
  x: number;
  z: number;
  searchRadius: number;
};

export type ResourceRegionDistribution = {
  territories: readonly ResourceTerritory[];
  targets: readonly ResourcePlacementTarget[];
  richTargets: readonly ResourcePlacementTarget[];
  ordinaryTargets: readonly ResourcePlacementTarget[];
  smallRegionSide: number;
};

type Point = { x: number; z: number };

/**
 * Builds soft, small-map-sized resource territories. Medium and large maps do
 * not enforce five nodes inside hard borders: each territory receives four
 * baseline targets and competes for the remaining slots, then terrain-aware
 * placement may move a site away from its target. Rich targets are allocated
 * in balanced territory rounds before resource families receive them. This
 * keeps expansion-worthy rolls distributed without creating a rigid grid.
 */
export function createResourceRegionDistribution(
  settings: WorldGenerationSettings,
  playableHalf: number,
  totalNodeCount: number,
  richNodeCount: number,
): ResourceRegionDistribution {
  const territoryCount = MAP_SIZE_PRESETS[settings.mapSize].smallMapAreas;
  const smallRegionSide = playableHalf * 2 / Math.sqrt(territoryCount);
  const rng = mulberry32(deriveSubSeed(settings.seed, 'resource-territories'));
  const centers = createTerritoryCenters(territoryCount, playableHalf, smallRegionSide, rng);
  const counts = allocateTerritoryCounts(territoryCount, totalNodeCount, rng);
  const richCounts = allocateBalancedTerritoryCounts(counts, richNodeCount, rng);
  const targetLimit = playableHalf - Math.max(18, smallRegionSide * 0.08);
  const ordinarySearchRadius = smallRegionSide * 0.34;
  const richSearchRadius = territoryCount === 1
    ? ordinarySearchRadius
    : smallRegionSide * 0.24;
  const richTargetBuckets = centers.map(() => [] as ResourcePlacementTarget[]);
  const ordinaryTargetBuckets = centers.map(() => [] as ResourcePlacementTarget[]);

  for (let territoryIndex = 0; territoryIndex < centers.length; territoryIndex++) {
    const center = centers[territoryIndex];
    for (let index = 0; index < counts[territoryIndex]; index++) {
      const rich = index < richCounts[territoryIndex];
      const point = territoryCount === 1
        ? sampleAcrossSmallMap(rng, targetLimit)
        : sampleAroundTerritory(
            rng,
            center,
            smallRegionSide,
            targetLimit,
            rich ? 0.2 : 0.26,
          );
      (rich ? richTargetBuckets[territoryIndex] : ordinaryTargetBuckets[territoryIndex]).push({
        territoryIndex,
        ...point,
        searchRadius: rich ? richSearchRadius : ordinarySearchRadius,
      });
    }
  }
  const richTargets = interleaveTerritoryTargets(richTargetBuckets, rng);
  const ordinaryTargets = interleaveTerritoryTargets(ordinaryTargetBuckets, rng);
  const targets = [...richTargets, ...ordinaryTargets];
  shuffleInPlace(targets, rng);

  return {
    smallRegionSide,
    richTargets,
    ordinaryTargets,
    territories: centers.map((center, index) => ({
      index,
      centerX: center.x,
      centerZ: center.z,
      plannedNodeCount: counts[index],
      plannedRichNodeCount: richCounts[index],
    })),
    targets,
  };
}

/** Samples near a territory target first, then relaxes to the whole map. */
export function sampleRegionalPlacementCandidate(
  random: () => number,
  target: ResourcePlacementTarget | undefined,
  limit: number,
  attempt: number,
  maxAttempts: number,
): Point | null {
  if (!target || attempt >= maxAttempts * 0.82) {
    return {
      x: (random() * 2 - 1) * limit,
      z: (random() * 2 - 1) * limit,
    };
  }

  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * target.searchRadius;
  const x = target.x + Math.cos(angle) * radius;
  const z = target.z + Math.sin(angle) * radius;
  return Math.abs(x) <= limit && Math.abs(z) <= limit ? { x, z } : null;
}

/** Positive near the target, neutral at one search radius, bounded when far away. */
export function regionalPlacementAffinity(
  x: number,
  z: number,
  target: ResourcePlacementTarget | undefined,
): number {
  if (!target) return 0;
  const normalizedDistance = Math.hypot(x - target.x, z - target.z)
    / Math.max(1, target.searchRadius);
  return Math.max(-1, 1 - normalizedDistance);
}

function allocateTerritoryCounts(
  territoryCount: number,
  totalNodeCount: number,
  random: () => number,
): number[] {
  const target = Math.max(0, Math.floor(totalNodeCount));
  if (territoryCount <= 1) return [target];
  const baseline = Math.min(4, Math.floor(target / territoryCount));
  const counts = Array.from({ length: territoryCount }, () => baseline);
  let allocated = baseline * territoryCount;
  while (allocated < target) {
    const weights = counts.map((count) => count >= 7 ? 0 : (8 - count) ** 2);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    if (totalWeight <= 0) break;
    let roll = random() * totalWeight;
    let selectedIndex = 0;
    for (let index = 0; index < weights.length; index++) {
      roll -= weights[index];
      if (roll > 0) continue;
      selectedIndex = index;
      break;
    }
    counts[selectedIndex] += 1;
    allocated++;
  }
  return counts;
}

function allocateBalancedTerritoryCounts(
  capacities: readonly number[],
  requestedCount: number,
  random: () => number,
): number[] {
  const counts = capacities.map(() => 0);
  const target = Math.max(
    0,
    Math.min(
      capacities.reduce((sum, capacity) => sum + capacity, 0),
      Math.floor(requestedCount),
    ),
  );

  for (let allocated = 0; allocated < target; allocated++) {
    const eligible = counts
      .map((count, index) => ({ count, index }))
      .filter(({ count, index }) => count < capacities[index]);
    const lowestCount = eligible.reduce(
      (lowest, entry) => Math.min(lowest, entry.count),
      Number.POSITIVE_INFINITY,
    );
    const leastFilled = eligible.filter((entry) => entry.count === lowestCount);
    const selected = leastFilled[Math.floor(random() * leastFilled.length)];
    counts[selected.index] += 1;
  }

  return counts;
}

function createTerritoryCenters(
  territoryCount: number,
  playableHalf: number,
  smallRegionSide: number,
  random: () => number,
): Point[] {
  if (territoryCount === 1) return [{ x: 0, z: 0 }];
  const normalized = territoryCount === 4
    ? [
        { x: -0.5, z: -0.5 },
        { x: 0.5, z: -0.5 },
        { x: -0.5, z: 0.5 },
        { x: 0.5, z: 0.5 },
      ]
    : [
        { x: -0.66, z: -0.66 },
        { x: 0, z: -0.66 },
        { x: 0.66, z: -0.66 },
        { x: -0.66, z: 0 },
        { x: 0.66, z: 0 },
        { x: -0.66, z: 0.66 },
        { x: 0, z: 0.66 },
        { x: 0.66, z: 0.66 },
      ];
  const quarterTurns = Math.floor(random() * 4);
  const mirror = random() < 0.5 ? -1 : 1;
  const jitter = smallRegionSide * 0.045;

  return normalized.slice(0, territoryCount).map((point) => {
    let x = point.x * playableHalf;
    let z = point.z * playableHalf * mirror;
    for (let turn = 0; turn < quarterTurns; turn++) {
      [x, z] = [-z, x];
    }
    return {
      x: x + (random() * 2 - 1) * jitter,
      z: z + (random() * 2 - 1) * jitter,
    };
  });
}

function sampleAcrossSmallMap(random: () => number, limit: number): Point {
  return {
    x: (random() * 2 - 1) * limit,
    z: (random() * 2 - 1) * limit,
  };
}

function sampleAroundTerritory(
  random: () => number,
  center: Point,
  smallRegionSide: number,
  limit: number,
  radialScale: number,
): Point {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * smallRegionSide * radialScale;
  return {
    x: clamp(center.x + Math.cos(angle) * radius, -limit, limit),
    z: clamp(center.z + Math.sin(angle) * radius, -limit, limit),
  };
}

function shuffleInPlace<T>(values: T[], random: () => number): void {
  for (let index = values.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
}

function interleaveTerritoryTargets(
  buckets: ResourcePlacementTarget[][],
  random: () => number,
): ResourcePlacementTarget[] {
  const targets: ResourcePlacementTarget[] = [];
  while (buckets.some((bucket) => bucket.length > 0)) {
    const territoryOrder = buckets
      .map((bucket, territoryIndex) => ({ bucket, territoryIndex }))
      .filter(({ bucket }) => bucket.length > 0);
    shuffleInPlace(territoryOrder, random);
    for (const { bucket } of territoryOrder) {
      const target = bucket.shift();
      if (target) targets.push(target);
    }
  }
  return targets;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
