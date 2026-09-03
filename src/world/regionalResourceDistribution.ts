import type { ForagingNodeKind } from '../foraging/ForagingLayout.ts';
import {
  createMineralDepositRoster,
  type MineralDepositResource,
} from '../minerals/MineralDepositLayout.ts';
import { deriveSubSeed, type WorldGenerationSettings, type WorldMapSize } from './worldGenerationSettings.ts';

export type ForagingNodeCounts = Record<ForagingNodeKind, number>;

export type RegionalResourcePlan = {
  /** Finite surface-stone deposits. */
  ordinaryQuarryCount: number;
  /** Deep stone sources selected from this map size's fixed rich-node budget. */
  richStoneDepositCount: number;
  /** Finite ordinary river, coastal, or inland-basin clay. */
  ordinaryClayDepositCount: number;
  /** High-output deep clay sources selected from the rich-node budget. */
  richClayDepositCount: number;
  /** Rich iron-or-salt sites selected from the rich-node budget. */
  richMineralDepositCount: number;
  /** Supporting finite iron-or-salt deposits. */
  ordinaryMineralDepositCount: number;
  foragingNodeCounts: ForagingNodeCounts;
  /** Rich grades assigned across wild food, with one reserved on small maps. */
  foragingRichNodeCounts: ForagingNodeCounts;
  presentForagingKinds: ForagingNodeKind[];
  totalForagingNodes: number;
  /** Food nodes specifically guaranteed from game, berries, and mushrooms. */
  minimumFoodNodeCount: number;
  /** Exact physical-node budget for this map size, including clay and wild food. */
  totalResourceNodes: number;
  /** Exact number of nodes that receive a rich grade. */
  richResourceNodeCount: number;
};

export type RegionalDepositResource = 'stone' | 'clay' | MineralDepositResource;

export type RegionalDepositSurveyEntry = {
  resource: RegionalDepositResource;
  ordinary: number;
  rich: number;
  total: number;
};

type SizeResourceBudget = {
  totalResourceNodes: number;
  richResourceNodes: number;
  minimumFoodNodes: number;
  maximumWildFoodNodes: number;
  varietyBonus: number;
};

const SIZE_RESOURCE_BUDGETS: Record<WorldMapSize, SizeResourceBudget> = {
  small: {
    totalResourceNodes: 5,
    richResourceNodes: 2,
    minimumFoodNodes: 1,
    maximumWildFoodNodes: 3,
    varietyBonus: -10,
  },
  medium: {
    totalResourceNodes: 20,
    richResourceNodes: 4,
    minimumFoodNodes: 4,
    maximumWildFoodNodes: 8,
    varietyBonus: 0,
  },
  large: {
    totalResourceNodes: 40,
    richResourceNodes: 8,
    minimumFoodNodes: 8,
    maximumWildFoodNodes: 16,
    varietyBonus: 10,
  },
};

const OPTIONAL_FOOD_KINDS: Array<Extract<ForagingNodeKind, 'berries' | 'mushrooms'>> = [
  'berries',
  'mushrooms',
];

type GeologicalCategory = 'stone' | 'clay' | 'minerals';
type GeologicalCategoryCounts = Record<GeologicalCategory, number>;
type RichAllocation = {
  geological: GeologicalCategoryCounts;
  foraging: ForagingNodeCounts;
};

const MAX_NODES_PER_FORAGING_KIND = 6;

/**
 * Turns the setup sliders into a deterministic regional economy.
 *
 * Map size owns the exact total and rich-node budgets. The seed and regional
 * variety settings decide which physical families receive those rolls. The
 * abundance setting can add food nodes above the guaranteed floor. Game is
 * always part of that floor because it remains available in winter; berries and
 * mushrooms join on broader regional mixes. Fish may supplement the wild-food
 * roster, but never substitutes for the requested game/berry/mushroom minimum.
 * Rich grades are then rolled across every physical node, including every wild
 * food family. Small maps reserve one of their rich rolls for wild food so a
 * lean geological roll cannot leave the opening settlement without a strong
 * renewable food source.
 */
export function createRegionalResourcePlan(
  settings: WorldGenerationSettings,
): RegionalResourcePlan {
  const sizeBudget = SIZE_RESOURCE_BUDGETS[settings.mapSize];
  const variety = clampPercent(settings.resourceVariety);
  const adjustedVariety = clampPercent(variety + sizeBudget.varietyBonus);
  const abundance = clampPercent(settings.resourceAbundance);
  const includeFish = settings.terrainPreset === 'delnice_meadow'
    || settings.terrainPreset === 'mrkopalj_polje'
    || settings.terrainPreset === 'gomirje_meadows'
    || adjustedVariety >= 40;
  const requestedFishCount = includeFish
    ? Math.max(1, Math.min(3, Math.round(sizeBudget.minimumFoodNodes / 4)))
    : 0;
  const minimumWildFoodNodes = sizeBudget.minimumFoodNodes + requestedFishCount;
  const totalForagingTarget = Math.min(
    sizeBudget.maximumWildFoodNodes,
    Math.max(
      minimumWildFoodNodes,
      sizeBudget.minimumFoodNodes + rollBonusFoodNodes(
        settings.seed,
        sizeBudget.maximumWildFoodNodes - sizeBudget.minimumFoodNodes,
        abundance,
      ),
    ),
  );
  const fishCount = Math.min(
    requestedFishCount,
    Math.max(0, totalForagingTarget - sizeBudget.minimumFoodNodes),
  );
  const namedFoodTarget = totalForagingTarget - fishCount;
  const foodKindCount = Math.min(
    3,
    namedFoodTarget,
    Math.max(
      Math.ceil(namedFoodTarget / MAX_NODES_PER_FORAGING_KIND),
      adjustedVariety >= 40 ? 3 : adjustedVariety >= 20 ? 2 : 1,
    ),
  );
  const foodKinds: Array<Extract<ForagingNodeKind, 'game' | 'berries' | 'mushrooms'>> = [
    'game',
    ...rankOptionalFoodKinds(settings).slice(0, Math.max(0, foodKindCount - 1)),
  ];
  const foragingNodeCounts: ForagingNodeCounts = {
    game: 0,
    berries: 0,
    mushrooms: 0,
    fish: 0,
  };
  for (const kind of foodKinds) {
    foragingNodeCounts[kind] = 1;
  }

  let allocatedFood = foodKinds.length;
  while (allocatedFood < namedFoodTarget) {
    const eligibleKinds = foodKinds.filter(
      (kind) => foragingNodeCounts[kind] < MAX_NODES_PER_FORAGING_KIND,
    );
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
    allocatedFood++;
  }

  foragingNodeCounts.fish = fishCount;
  const presentForagingKinds = (Object.keys(foragingNodeCounts) as ForagingNodeKind[])
    .filter((kind) => foragingNodeCounts[kind] > 0);
  const totalForagingNodes = Object.values(foragingNodeCounts)
    .reduce((sum, count) => sum + count, 0);
  const geologicalNodeCount = sizeBudget.totalResourceNodes - totalForagingNodes;
  const geologicalCounts = allocateGeologicalCounts(settings, geologicalNodeCount);
  const richAllocation = allocateRichCounts(
    settings,
    geologicalCounts,
    foragingNodeCounts,
    sizeBudget.richResourceNodes,
  );
  const geologicalRichCounts = richAllocation.geological;

  return {
    ordinaryQuarryCount: geologicalCounts.stone - geologicalRichCounts.stone,
    richStoneDepositCount: geologicalRichCounts.stone,
    ordinaryClayDepositCount: geologicalCounts.clay - geologicalRichCounts.clay,
    richClayDepositCount: geologicalRichCounts.clay,
    richMineralDepositCount: geologicalRichCounts.minerals,
    ordinaryMineralDepositCount:
      geologicalCounts.minerals - geologicalRichCounts.minerals,
    foragingNodeCounts,
    foragingRichNodeCounts: richAllocation.foraging,
    presentForagingKinds,
    totalForagingNodes,
    minimumFoodNodeCount: sizeBudget.minimumFoodNodes,
    totalResourceNodes: sizeBudget.totalResourceNodes,
    richResourceNodeCount: sizeBudget.richResourceNodes,
  };
}

/**
 * Resolves the seed's actual four-family geological roster for setup and
 * planning UI. Ordinary counts are guaranteed physical sites; rich counts are
 * the optional deep-source rolls that survived the regional budget.
 */
export function createRegionalDepositSurvey(
  settings: WorldGenerationSettings,
  plan: RegionalResourcePlan = createRegionalResourcePlan(settings),
): RegionalDepositSurveyEntry[] {
  const mineralRoster = createMineralDepositRoster({
    seed: deriveSubSeed(settings.seed, 'iron-salt-deposits'),
    mapSize: settings.mapSize,
    richSiteCount: plan.richMineralDepositCount,
    ordinarySiteCount: plan.ordinaryMineralDepositCount,
    resourceVariety: settings.resourceVariety,
  });
  const mineralEntry = (
    resource: MineralDepositResource,
  ): RegionalDepositSurveyEntry => {
    const sites = mineralRoster.filter((site) => site.resource === resource);
    const rich = sites.filter((site) => site.grade === 'rich').length;
    const ordinary = sites.length - rich;
    return { resource, ordinary, rich, total: sites.length };
  };

  return [
    {
      resource: 'stone',
      ordinary: plan.ordinaryQuarryCount,
      rich: plan.richStoneDepositCount,
      total: plan.ordinaryQuarryCount + plan.richStoneDepositCount,
    },
    {
      resource: 'clay',
      ordinary: plan.ordinaryClayDepositCount,
      rich: plan.richClayDepositCount,
      total: plan.ordinaryClayDepositCount + plan.richClayDepositCount,
    },
    mineralEntry('iron'),
    mineralEntry('salt'),
  ];
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

function rankOptionalFoodKinds(
  settings: WorldGenerationSettings,
): Array<Extract<ForagingNodeKind, 'berries' | 'mushrooms'>> {
  return [...OPTIONAL_FOOD_KINDS].sort((a, b) =>
    regionalAffinity(settings, b) - regionalAffinity(settings, a)
  );
}

function allocateGeologicalCounts(
  settings: WorldGenerationSettings,
  total: number,
): GeologicalCategoryCounts {
  const target = Math.max(0, Math.floor(total));
  const counts: GeologicalCategoryCounts = { stone: 0, clay: 0, minerals: 0 };
  if (target === 0) return counts;

  // Two mineral slots preserve one iron and one salt roll whenever the overall
  // budget has room. Stone and clay then receive one slot each before extras.
  counts.minerals = Math.min(2, target);
  let allocated = counts.minerals;
  if (allocated < target) {
    const firstSurface = allocationScore(settings.seed, 'stone', 0)
      >= allocationScore(settings.seed, 'clay', 0)
      ? 'stone'
      : 'clay';
    counts[firstSurface] += 1;
    allocated++;
  }
  if (allocated < target) {
    const secondSurface = counts.stone === 0 ? 'stone' : 'clay';
    counts[secondSurface] += 1;
    allocated++;
  }

  const weights: GeologicalCategoryCounts = { stone: 1, clay: 1, minerals: 2 };
  while (allocated < target) {
    const category = (Object.keys(counts) as GeologicalCategory[])
      .sort((a, b) => {
        const normalizedDelta = counts[a] / weights[a] - counts[b] / weights[b];
        if (Math.abs(normalizedDelta) > 1e-9) return normalizedDelta;
        return allocationScore(settings.seed, b, counts[b])
          - allocationScore(settings.seed, a, counts[a]);
      })[0];
    counts[category] += 1;
    allocated++;
  }
  return counts;
}

function allocateRichCounts(
  settings: WorldGenerationSettings,
  geologicalCounts: GeologicalCategoryCounts,
  foragingCounts: ForagingNodeCounts,
  requestedRichCount: number,
): RichAllocation {
  const geologicalSlots = (Object.keys(geologicalCounts) as GeologicalCategory[])
    .flatMap((category) =>
      Array.from({ length: geologicalCounts[category] }, (_, index) => ({
        family: 'geological' as const,
        category,
        score: allocationScore(settings.seed, `rich:${category}`, index),
      }))
    );
  const foragingSlots = (Object.keys(foragingCounts) as ForagingNodeKind[])
    .flatMap((category) => Array.from({ length: foragingCounts[category] }, (_, index) => ({
      family: 'foraging' as const,
      category,
      score: allocationScore(settings.seed, `rich:${category}`, index),
    })));
  const slots = [...geologicalSlots, ...foragingSlots];
  const richTarget = Math.max(0, Math.min(slots.length, Math.floor(requestedRichCount)));
  const richAllocation: RichAllocation = {
    geological: { stone: 0, clay: 0, minerals: 0 },
    foraging: { game: 0, berries: 0, mushrooms: 0, fish: 0 },
  };
  const selectedSlots: typeof slots = [];
  for (const slot of slots.sort((a, b) => b.score - a.score)) {
    // Water-bound deep sources are valuable special cases, not a family that
    // should consume several of the deliberately scarce regional rich rolls.
    // One rich clay bank and one rich fishery per world preserve both variety
    // and the one-roll-per-territory expansion contract.
    if (
      slot.family === 'geological'
      && slot.category === 'clay'
      && selectedSlots.some((selected) =>
        selected.family === 'geological' && selected.category === 'clay'
      )
    ) {
      continue;
    }
    if (
      slot.family === 'foraging'
      && slot.category === 'fish'
      && selectedSlots.some((selected) =>
        selected.family === 'foraging' && selected.category === 'fish'
      )
    ) {
      continue;
    }
    selectedSlots.push(slot);
    if (selectedSlots.length >= richTarget) break;
  }

  if (
    settings.mapSize === 'small'
    && richTarget > 0
    && foragingSlots.length > 0
    && !selectedSlots.some((slot) => slot.family === 'foraging')
  ) {
    const bestForagingSlot = [...foragingSlots]
      .sort((a, b) => b.score - a.score)[0];
    // selectedSlots is still score-ordered, so the final entry is the weakest
    // winning geological roll. Replacing it retains the exact rich-node budget.
    selectedSlots[selectedSlots.length - 1] = bestForagingSlot;
  }

  selectedSlots.forEach((slot) => {
    if (slot.family === 'geological') {
      richAllocation.geological[slot.category] += 1;
    } else {
      richAllocation.foraging[slot.category] += 1;
    }
  });
  return richAllocation;
}

function rollBonusFoodNodes(seed: number, availableSlots: number, abundance: number): number {
  const chance = 0.15 + abundance * 0.005;
  let count = 0;
  for (let index = 0; index < Math.max(0, availableSlots); index++) {
    if (allocationScore(seed, 'bonus-food', index) < chance) count++;
  }
  return count;
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

function allocationScore(seed: number, kind: string, count: number): number {
  const noise = (deriveSubSeed(seed, `regional-allocation:${kind}:${count}`) >>> 0)
    / 0x1_0000_0000;
  return noise;
}

function clampPercent(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}
