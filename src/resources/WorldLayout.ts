import { fullTerrainBounds } from '../terrain/terrainBounds.ts';
import { RiverLayout } from '../rivers/RiverLayout.ts';
import { ForagingLayout } from '../foraging/ForagingLayout.ts';
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
  createRegionalResourcePlan,
  type RegionalResourcePlan,
} from '../world/regionalResourceDistribution.ts';

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
};

export function createWorldLayout(settings: WorldGenerationSettings = DEFAULT_WORLD_GENERATION_SETTINGS): WorldLayout {
  const normalizedSettings = normalizeWorldGenerationSettings(settings);
  const dims = resolveWorldDimensions(normalizedSettings.mapSize);
  const riverBounds = fullTerrainBounds(dims.terrainSize);
  const riverSeed = deriveSubSeed(normalizedSettings.seed, 'river');
  const forestSeed = deriveSubSeed(normalizedSettings.seed, 'forest');
  const treeSeed = deriveSubSeed(normalizedSettings.seed, 'trees');
  const resourcePlan = createRegionalResourcePlan(normalizedSettings);
  const riverLayout = RiverLayout.create({
    bounds: riverBounds,
    seed: riverSeed,
    riverCount: normalizedSettings.terrainPreset === 'risnjak_pass'
      ? 3
      : hydrologyRiverCount(normalizedSettings.hydrology),
    tributaryCount: normalizedSettings.terrainPreset === 'risnjak_pass'
      ? 2
      : hydrologyTributaryCount(normalizedSettings.hydrology),
    drain: scaledRiverDrain(dims.playableHalf),
    terrainPreset: normalizedSettings.terrainPreset,
  });
  const quarryLayout = QuarryLayout.create({
    bounds: riverBounds,
    seed: normalizedSettings.seed,
    riverLayout,
    playableHalf: dims.playableHalf,
    ordinarySiteCount: resourcePlan.ordinaryQuarryCount,
    richSiteCount: resourcePlan.richStoneDepositCount,
  });
  const densityScale = forestDensityScale(normalizedSettings.forestDensity);
  const spawnConfig = createForestSpawnConfig(dims.playableSize, dims.terrainSize, densityScale);
  const forestCores = createForestCores(mulberry32(forestSeed), spawnConfig);
  const foragingLayout = ForagingLayout.create({
    forestCores,
    riverLayout,
    playableHalf: dims.playableHalf,
    seed: normalizedSettings.seed ^ 0x4f0d21,
    nodeCounts: resourcePlan.foragingNodeCounts,
  });
  const clayDepositLayout = ClayDepositLayout.create({
    riverLayout,
    quarrySites: quarryLayout.sites,
    foragingSites: foragingLayout.sites,
    playableHalf: dims.playableHalf,
    seed: deriveSubSeed(normalizedSettings.seed, 'rich-clay'),
    ordinarySiteCount: resourcePlan.ordinaryClayDepositCount,
    richSiteCount: resourcePlan.richClayDepositCount,
  });
  const mineralDepositLayout = MineralDepositLayout.create({
    riverLayout,
    richSiteCount: resourcePlan.richMineralDepositCount,
    ordinarySiteCount: resourcePlan.ordinaryMineralDepositCount,
    quarrySites: quarryLayout.sites,
    foragingSites: foragingLayout.sites,
    claySites: clayDepositLayout.sites,
    playableHalf: dims.playableHalf,
    seed: deriveSubSeed(normalizedSettings.seed, 'iron-salt-deposits'),
    mapSize: normalizedSettings.mapSize,
    resourceVariety: normalizedSettings.resourceVariety,
  });
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
  };
}
