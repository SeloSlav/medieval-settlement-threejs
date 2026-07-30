import type { ForagingNodeKind } from '../foraging/ForagingLayout.ts';
import { deriveSubSeed, type WorldGenerationSettings, type WorldMapSize } from './worldGenerationSettings.ts';

export type ForagingNodeCounts = Record<ForagingNodeKind, number>;

export type RegionalResourcePlan = {
  /** Finite surface-stone deposits. At least one is present in every region. */
  ordinaryQuarryCount: number;
  /** Optional deep stone source, rolled from the seed and regional settings. */
  richStoneDepositCount: number;
  /** Finite ordinary alluvial banks. At least one is present in every region. */
  ordinaryClayDepositCount: number;
  /** Optional high-output deep alluvial source, rolled independently from stone. */
  richClayDepositCount: number;
  /** Rich iron-or-salt sites rolled from the mineral budget. */
  richMineralDepositCount: number;
  /** Supporting finite iron-or-salt deposits vary with map size and abundance. */
  ordinaryMineralDepositCount: number;
  foragingNodeCounts: ForagingNodeCounts;
  presentForagingKinds: ForagingNodeKind[];
  totalForagingNodes: number;
};

type SizeResourceBudget = {
  ordinaryQuarries: number;
  ordinaryClayBanks: number;
  ordinaryMineralDeposits: number;
  richMineralSlots: number;
  foragingNodes: number;
  varietyBonus: number;
  maxForagingNodes: number;
  perKindCap: number;
};

const SIZE_RESOURCE_BUDGETS: Record<WorldMapSize, SizeResourceBudget> = {
  small: {
    ordinaryQuarries: 1,
    ordinaryClayBanks: 1,
    ordinaryMineralDeposits: 2,
    richMineralSlots: 1,
    foragingNodes: 8,
    varietyBonus: -10,
    maxForagingNodes: 8,
    perKindCap: 3,
  },
  medium: {
    ordinaryQuarries: 2,
    ordinaryClayBanks: 2,
    ordinaryMineralDeposits: 2,
    richMineralSlots: 1,
    foragingNodes: 8,
    varietyBonus: 0,
    maxForagingNodes: 10,
    perKindCap: 3,
  },
  large: {
    ordinaryQuarries: 3,
    ordinaryClayBanks: 3,
    ordinaryMineralDeposits: 3,
    richMineralSlots: 2,
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
    // Every material has an ordinary physical source. Rich grades are separate
    // deterministic seed rolls so map size improves the odds without making
    // any particular rich resource compulsory.
    ordinaryQuarryCount: Math.max(
      1,
      Math.min(4, sizeBudget.ordinaryQuarries + Math.round((abundance - 50) / 50)),
    ),
    richStoneDepositCount: seededRichCount(
      settings,
      'stone',
      1,
      richnessChance(settings.mapSize, abundance, 0.28),
    ),
    ordinaryClayDepositCount: Math.max(
      1,
      Math.min(4, sizeBudget.ordinaryClayBanks + Math.round((abundance - 50) / 50)),
    ),
    richClayDepositCount: seededRichCount(
      settings,
      'clay',
      1,
      richnessChance(
        settings.mapSize,
        Math.round((abundance * 2 + clampPercent(settings.hydrology)) / 3),
        0.32,
      ),
    ),
    richMineralDepositCount: seededRichCount(
      settings,
      'iron-salt',
      sizeBudget.richMineralSlots,
      richnessChance(settings.mapSize, abundance, 0.34),
    ),
    ordinaryMineralDepositCount: Math.max(
      2,
      Math.min(
        4,
        sizeBudget.ordinaryMineralDeposits + Math.round((abundance - 50) / 50),
      ),
    ),
    foragingNodeCounts,
    presentForagingKinds,
    totalForagingNodes: allocated,
  };
}

function richnessChance(
  mapSize: WorldMapSize,
  abundance: number,
  baseChance: number,
): number {
  const sizeBonus = mapSize === 'large' ? 0.36 : mapSize === 'medium' ? 0.2 : 0;
  const abundanceAdjustment = (clampPercent(abundance) - 50) / 250;
  return Math.max(0.08, Math.min(0.9, baseChance + sizeBonus + abundanceAdjustment));
}

function seededRichCount(
  settings: WorldGenerationSettings,
  resource: string,
  slots: number,
  chance: number,
): number {
  let richCount = 0;
  for (let slot = 0; slot < slots; slot++) {
    const roll = (deriveSubSeed(settings.seed, `rich-deposit:${resource}:${slot}`) >>> 0)
      / 0x1_0000_0000;
    if (roll < chance) richCount++;
  }
  return richCount;
}

export function describeResourceAbundance(value: number): string {
  if (value <= 25) return 'Lean';
  if (value >= 75) return 'Plentiful';
  return 'Balanced';
}

export function describeResourceVariety(value: number): string {
  if (value <= 25) return 'Specialized';
  if (value >= 80) return 'Broad mix';
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
