import { fullTerrainBounds } from '../terrain/terrainBounds.ts';
import { RiverLayout } from '../rivers/RiverLayout.ts';
import {
  fishPlacementTargetScore,
  ForagingLayout,
  isGameHabitatClearOfDeposits,
} from '../foraging/ForagingLayout.ts';
import { QuarryLayout } from '../quarries/QuarryLayout.ts';
import {
  clayPlacementTargetScore,
  ClayDepositLayout,
} from '../clay/ClayDepositLayout.ts';
import { MineralDepositLayout } from '../minerals/MineralDepositLayout.ts';
import {
  createForestCores,
  createForestSpawnConfig,
  mulberry32,
  type ForestCore,
} from '../props/forestField.ts';
import {
  deriveSubSeed,
  hydrologyRiverCount,
  hydrologyTributaryCount,
  resolveWorldDimensions,
  scaledRiverDrain,
  forestDensityScale,
  normalizeWorldGenerationSettings,
  type WorldGenerationSettings,
} from '../world/worldGenerationSettings.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../world/worldGenerationSettings.ts';
import {
  ORDINARY_STONE_DEPOSIT_PROTECTION_RADIUS,
  RICH_STONE_DEPOSIT_PROTECTION_RADIUS,
  createPhysicalDepositFootprints,
} from './physicalDepositProtection.ts';
import {
  createRegionalResourcePlan,
  type RegionalResourcePlan,
} from '../world/regionalResourceDistribution.ts';
import {
  createResourceRegionDistribution,
  type ResourcePlacementTarget,
  type ResourceRegionDistribution,
} from '../world/resourceRegionDistribution.ts';
import {
  createResourceTerrainAccessibility,
  type ResourceTerrainAccessibility,
} from '../world/resourceTerrainAccessibility.ts';

export { DEFAULT_WORLD_SEED } from '../world/worldGenerationSettings.ts';

export type WorldLayout = {
  settings: WorldGenerationSettings;
  seed: number;
  quarryLayout: QuarryLayout;
  clayDepositLayout: ClayDepositLayout;
  mineralDepositLayout: MineralDepositLayout;
  foragingLayout: ForagingLayout;
  riverLayout: RiverLayout;
  forestCores: ForestCore[];
  treeSeed: number;
  resourcePlan: RegionalResourcePlan;
  resourceRegionDistribution: ResourceRegionDistribution;
  resourceTerrainAccessibility: ResourceTerrainAccessibility;
};

export function createWorldLayout(settings: WorldGenerationSettings = DEFAULT_WORLD_GENERATION_SETTINGS): WorldLayout {
  const normalizedSettings = normalizeWorldGenerationSettings(settings);
  const dims = resolveWorldDimensions(normalizedSettings.mapSize);
  const riverBounds = fullTerrainBounds(dims.terrainSize);
  const riverSeed = deriveSubSeed(normalizedSettings.seed, 'river');
  const forestSeed = deriveSubSeed(normalizedSettings.seed, 'forest');
  const treeSeed = deriveSubSeed(normalizedSettings.seed, 'trees');
  const resourcePlan = createRegionalResourcePlan(normalizedSettings);
  const resourceRegionDistribution = createResourceRegionDistribution(
    normalizedSettings,
    dims.generationHalf,
    resourcePlan.totalResourceNodes,
    resourcePlan.richResourceNodeCount,
  );
  const riverLayout = RiverLayout.create({
    bounds: riverBounds,
    seed: riverSeed,
    riverCount: normalizedSettings.terrainPreset === 'risnjak_pass'
      ? 3
      : hydrologyRiverCount(normalizedSettings.hydrology),
    tributaryCount: normalizedSettings.terrainPreset === 'risnjak_pass'
      ? 2
      : hydrologyTributaryCount(normalizedSettings.hydrology),
    drain: scaledRiverDrain(dims.generationHalf),
    terrainPreset: normalizedSettings.terrainPreset,
  });
  const resourceTerrainAccessibility = createResourceTerrainAccessibility(
    normalizedSettings,
    dims,
    riverLayout,
  );
  const isTerrainAccessible = resourceTerrainAccessibility.isAccessible;
  const availableRichTargets = [...resourceRegionDistribution.richTargets];
  let ordinaryTargetCursor = 0;
  const reserveRichTargets = (
    count: number,
    score?: (target: ResourcePlacementTarget) => number,
  ): ResourcePlacementTarget[] => {
    const reserved: ResourcePlacementTarget[] = [];
    for (let index = 0; index < count && availableRichTargets.length > 0; index++) {
      let selectedIndex = 0;
      if (score) {
        for (let candidateIndex = 1; candidateIndex < availableRichTargets.length; candidateIndex++) {
          if (score(availableRichTargets[candidateIndex]) <= score(availableRichTargets[selectedIndex])) {
            continue;
          }
          selectedIndex = candidateIndex;
        }
      }
      reserved.push(availableRichTargets.splice(selectedIndex, 1)[0]);
    }
    return reserved;
  };
  const takeResourceTargets = (
    richTargets: readonly ResourcePlacementTarget[],
    ordinaryCount: number,
    richFirst: boolean,
  ): readonly ResourcePlacementTarget[] => {
    const ordinaryTargets = resourceRegionDistribution.ordinaryTargets.slice(
      ordinaryTargetCursor,
      ordinaryTargetCursor + ordinaryCount,
    );
    ordinaryTargetCursor += ordinaryCount;
    return richFirst
      ? [...richTargets, ...ordinaryTargets]
      : [...ordinaryTargets, ...richTargets];
  };
  // Reserve targets where each constrained family can really place a site.
  // Flexible deposits then consume the remaining territories, so a water- or
  // habitat-bound rich roll cannot drift across the map and create a hole.
  const foragingSeed = normalizedSettings.seed ^ 0x4f0d21;
  const fishSeed = foragingSeed ^ 0x46a91d;
  const richFishTargets = reserveRichTargets(
    resourcePlan.foragingRichNodeCounts.fish,
    (target) => fishPlacementTargetScore({
      riverLayout,
      extent: dims.generationHalf,
      seed: fishSeed,
      requestedCount: resourcePlan.foragingNodeCounts.fish,
      target,
      isTerrainAccessible,
    }),
  );
  const claySeed = deriveSubSeed(normalizedSettings.seed, 'rich-clay');
  const richClayTargets = reserveRichTargets(
    resourcePlan.richClayDepositCount,
    (target) => clayPlacementTargetScore({
      riverLayout,
      playableHalf: dims.generationHalf,
      seed: claySeed,
      target,
      isTerrainAccessible,
    }),
  );
  const quarryPlacementTargets = takeResourceTargets(
    reserveRichTargets(resourcePlan.richStoneDepositCount),
    resourcePlan.ordinaryQuarryCount,
    true,
  );
  const mineralPlacementTargets = takeResourceTargets(
    reserveRichTargets(resourcePlan.richMineralDepositCount),
    resourcePlan.ordinaryMineralDepositCount,
    true,
  );
  const gamePlacementTargets = takeResourceTargets(
    reserveRichTargets(resourcePlan.foragingRichNodeCounts.game),
    resourcePlan.foragingNodeCounts.game - resourcePlan.foragingRichNodeCounts.game,
    false,
  );
  const berryPlacementTargets = takeResourceTargets(
    reserveRichTargets(resourcePlan.foragingRichNodeCounts.berries),
    resourcePlan.foragingNodeCounts.berries - resourcePlan.foragingRichNodeCounts.berries,
    false,
  );
  const mushroomPlacementTargets = takeResourceTargets(
    reserveRichTargets(resourcePlan.foragingRichNodeCounts.mushrooms),
    resourcePlan.foragingNodeCounts.mushrooms - resourcePlan.foragingRichNodeCounts.mushrooms,
    false,
  );
  const clayPlacementTargets = takeResourceTargets(
    richClayTargets,
    resourcePlan.ordinaryClayDepositCount,
    true,
  );
  const fishPlacementTargets = takeResourceTargets(
    richFishTargets,
    resourcePlan.foragingNodeCounts.fish - resourcePlan.foragingRichNodeCounts.fish,
    true,
  );
  const foragingPlacementTargets = {
    game: gamePlacementTargets,
    berries: berryPlacementTargets,
    mushrooms: mushroomPlacementTargets,
    fish: fishPlacementTargets,
  };
  const quarryLayout = QuarryLayout.create({
    bounds: riverBounds,
    seed: normalizedSettings.seed,
    riverLayout,
    playableHalf: dims.generationHalf,
    ordinarySiteCount: resourcePlan.ordinaryQuarryCount,
    richSiteCount: resourcePlan.richStoneDepositCount,
    placementTargets: quarryPlacementTargets,
    isTerrainAccessible,
  });
  const densityScale = forestDensityScale(normalizedSettings.forestDensity);
  const spawnConfig = createForestSpawnConfig(dims.generationSize, dims.terrainSize, densityScale);
  const forestCores = createForestCores(mulberry32(forestSeed), spawnConfig);
  let foragingLayout = ForagingLayout.create({
    forestCores,
    riverLayout,
    wildlifeDepositFootprints: quarryLayout.sites.map((site) => ({
      x: site.x,
      z: site.z,
      radius: site.kind === 'large'
        ? RICH_STONE_DEPOSIT_PROTECTION_RADIUS
        : ORDINARY_STONE_DEPOSIT_PROTECTION_RADIUS,
    })),
    playableHalf: dims.generationHalf,
    seed: foragingSeed,
    nodeCounts: resourcePlan.foragingNodeCounts,
    richNodeCounts: resourcePlan.foragingRichNodeCounts,
    placementTargets: foragingPlacementTargets,
    isTerrainAccessible,
  });
  const clayDepositLayout = ClayDepositLayout.create({
    riverLayout,
    quarrySites: quarryLayout.sites,
    foragingSites: foragingLayout.sites,
    playableHalf: dims.generationHalf,
    seed: claySeed,
    ordinarySiteCount: resourcePlan.ordinaryClayDepositCount,
    richSiteCount: resourcePlan.richClayDepositCount,
    placementTargets: clayPlacementTargets,
    isTerrainAccessible,
  });
  const mineralDepositLayout = MineralDepositLayout.create({
    riverLayout,
    richSiteCount: resourcePlan.richMineralDepositCount,
    ordinarySiteCount: resourcePlan.ordinaryMineralDepositCount,
    quarrySites: quarryLayout.sites,
    foragingSites: foragingLayout.sites,
    claySites: clayDepositLayout.sites,
    playableHalf: dims.generationHalf,
    seed: deriveSubSeed(normalizedSettings.seed, 'iron-salt-deposits'),
    mapSize: normalizedSettings.mapSize,
    resourceVariety: normalizedSettings.resourceVariety,
    placementTargets: mineralPlacementTargets,
    isTerrainAccessible,
  });
  const physicalDeposits = createPhysicalDepositFootprints({
    quarryLayout,
    clayDepositLayout,
    mineralDepositLayout,
  });
  foragingLayout = foragingLayout.withGameRespawnCandidates((candidate) =>
    isGameHabitatClearOfDeposits(physicalDeposits, candidate.x, candidate.z)
  );
  return {
    settings: normalizedSettings,
    seed: normalizedSettings.seed,
    quarryLayout,
    clayDepositLayout,
    mineralDepositLayout,
    foragingLayout,
    riverLayout,
    forestCores,
    treeSeed,
    resourcePlan,
    resourceRegionDistribution,
    resourceTerrainAccessibility,
  };
}
