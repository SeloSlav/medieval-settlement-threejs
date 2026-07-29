import type { ForagingNodeKind } from '../foraging/ForagingLayout.ts';
import { deriveSubSeed, type WorldGenerationSettings, type WorldMapSize } from './worldGenerationSettings.ts';

export type ForagingNodeCounts = Record<ForagingNodeKind, number>;

export type RegionalResourcePlan = {
  /** A rich stone deposit is invariant; this is the number of additional ordinary deposits. */
  ordinaryQuarryCount: number;
  foragingNodeCounts: ForagingNodeCounts;
  presentForagingKinds: ForagingNodeKind[];
  totalForagingNodes: number;
};

type SizeResourceBudget = {
  ordinaryQuarries: number;
  foragingNodes: number;
  varietyBonus: number;
  maxForagingNodes: number;
  perKindCap: number;
};

const SIZE_RESOURCE_BUDGETS: Record<WorldMapSize, SizeResourceBudget> = {
  small: {
    ordinaryQuarries: 2,
    foragingNodes: 8,
    varietyBonus: -10,
    maxForagingNodes: 8,
    perKindCap: 3,
  },
  medium: {
    ordinaryQuarries: 2,
    foragingNodes: 8,
    varietyBonus: 0,
    maxForagingNodes: 10,
    perKindCap: 3,
  },
  large: {
    ordinaryQuarries: 2,
    foragingNodes: 8,
    varietyBonus: 10,
    maxForagingNodes: 12,
    perKindCap: 3,
  },
};

const OPTIONAL_FORAGING_KINDS: Array<Exclude<ForagingNodeKind, 'game'>> = [
  'berries',
  'mushrooms',
  'fish',
];

/**
 * Turns the setup sliders into a deterministic regional economy.
 *
 * Game is the local safety-net resource because it remains available in winter.
 * Farms, wells, and managed woodland remain universally buildable. Optional wild
 * foods provide regional character and reasons to import food through a market.
 */
export function createRegionalResourcePlan(
  settings: WorldGenerationSettings,
): RegionalResourcePlan {
  const sizeBudget = SIZE_RESOURCE_BUDGETS[settings.mapSize];
  const abundance = clampPercent(settings.resourceAbundance);
  const variety = clampPercent(settings.resourceVariety);
  const adjustedVariety = clampPercent(variety + sizeBudget.varietyBonus);
  const varietyKindCount = adjustedVariety >= 40
    ? 4
    : adjustedVariety >= 20
      ? 3
      : 2;
  const presentForagingKinds: ForagingNodeKind[] = [
    'game',
    ...rankOptionalKinds(settings).slice(0, varietyKindCount - 1),
  ];

  const abundanceAdjustment = Math.round((abundance - 50) / 30);
  const totalForagingNodes = Math.max(
    presentForagingKinds.length,
    Math.min(
      sizeBudget.maxForagingNodes,
      sizeBudget.foragingNodes + abundanceAdjustment,
    ),
  );
  const foragingNodeCounts: ForagingNodeCounts = {
    game: 0,
    berries: 0,
    mushrooms: 0,
    fish: 0,
  };
  for (const kind of presentForagingKinds) {
    foragingNodeCounts[kind] = 1;
  }

  let allocated = presentForagingKinds.length;
  while (allocated < totalForagingNodes) {
    const eligibleKinds = presentForagingKinds
      .filter((kind) => foragingNodeCounts[kind] < sizeBudget.perKindCap);
    const lowestCount = eligibleKinds.reduce(
      (lowest, kind) => Math.min(lowest, foragingNodeCounts[kind]),
      Number.POSITIVE_INFINITY,
    );
    const candidate = eligibleKinds
      .filter((kind) => foragingNodeCounts[kind] === lowestCount)
      .sort((a, b) =>
        allocationScore(settings.seed, b, foragingNodeCounts[b])
        - allocationScore(settings.seed, a, foragingNodeCounts[a])
      )[0];
    if (!candidate) break;
    foragingNodeCounts[candidate] += 1;
    allocated++;
  }

  return {
    // Every world gets one rich deposit. Abundance only changes the supporting sites.
    ordinaryQuarryCount: Math.max(
      0,
      Math.min(3, sizeBudget.ordinaryQuarries + Math.round((abundance - 50) / 50)),
    ),
    foragingNodeCounts,
    presentForagingKinds,
    totalForagingNodes: allocated,
  };
}

export function describeResourceAbundance(value: number): string {
  if (value <= 25) return 'Lean';
  if (value >= 75) return 'Plentiful';
  return 'Balanced';
}

export function describeResourceVariety(value: number): string {
  if (value <= 25) return 'Specialized';
  if (value >= 80) return 'Complete';
  return 'Regional mix';
}

function rankOptionalKinds(settings: WorldGenerationSettings): ForagingNodeKind[] {
  return [...OPTIONAL_FORAGING_KINDS].sort((a, b) =>
    regionalAffinity(settings, b) - regionalAffinity(settings, a)
  );
}

function regionalAffinity(
  settings: WorldGenerationSettings,
  kind: Exclude<ForagingNodeKind, 'game'>,
): number {
  const seedNoise = (deriveSubSeed(settings.seed, `regional-resource:${kind}`) >>> 0)
    / 0x1_0000_0000;
  if (kind === 'fish') {
    return seedNoise + settings.hydrology / 180;
  }
  if (kind === 'mushrooms') {
    return seedNoise + settings.forestDensity / 180;
  }
  return seedNoise + (100 - Math.abs(settings.forestDensity - 50)) / 360;
}

function allocationScore(seed: number, kind: ForagingNodeKind, count: number): number {
  const noise = (deriveSubSeed(seed, `regional-allocation:${kind}:${count}`) >>> 0)
    / 0x1_0000_0000;
  return noise;
}

function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}
