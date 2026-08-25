import { fullTerrainBounds } from '../terrain/terrainBounds.ts';
import { RiverLayout } from '../rivers/RiverLayout.ts';
import {
  ForagingLayout,
  isGameHabitatClearOfDeposits,
} from '../foraging/ForagingLayout.ts';
import { QuarryLayout } from '../quarries/QuarryLayout.ts';
import { ClayDepositLayout } from '../clay/ClayDepositLayout.ts';
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
  );
  let resourceTargetCursor = 0;
  const takeResourceTargets = (count: number): readonly ResourcePlacementTarget[] => {
    const targets = resourceRegionDistribution.targets.slice(
      resourceTargetCursor,
      resourceTargetCursor + count,
    );
    resourceTargetCursor += count;
    return targets;
  };
  const quarryPlacementTargets = takeResourceTargets(
    resourcePlan.richStoneDepositCount + resourcePlan.ordinaryQuarryCount,
  );
  const clayPlacementTargets = takeResourceTargets(
    resourcePlan.richClayDepositCount + resourcePlan.ordinaryClayDepositCount,
  );
  const mineralPlacementTargets = takeResourceTargets(
    resourcePlan.richMineralDepositCount + resourcePlan.ordinaryMineralDepositCount,
  );
  const foragingPlacementTargets = {
    game: takeResourceTargets(resourcePlan.foragingNodeCounts.game),
    berries: takeResourceTargets(resourcePlan.foragingNodeCounts.berries),
    mushrooms: takeResourceTargets(resourcePlan.foragingNodeCounts.mushrooms),
    fish: takeResourceTargets(resourcePlan.foragingNodeCounts.fish),
  };
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
    seed: normalizedSettings.seed ^ 0x4f0d21,
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
    seed: deriveSubSeed(normalizedSettings.seed, 'rich-clay'),
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
