import type { WorldLayout } from '../resources/WorldLayout.ts';
import { QuarryLayout } from '../quarries/QuarryLayout.ts';
import { ClayDepositLayout } from '../clay/ClayDepositLayout.ts';
import { MineralDepositLayout } from '../minerals/MineralDepositLayout.ts';
import { ForagingLayout, type ForagingSite } from '../foraging/ForagingLayout.ts';
import { RiverLayout } from '../rivers/RiverLayout.ts';
import { REALM } from './realmPolicy.ts';
import { realmCamp, realmForestCores } from './realmLandscape.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS, type WorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import type { RegionalResourcePlan } from '../world/regionalResourceDistribution.ts';

export function realmSettings(): WorldGenerationSettings {
  return { ...DEFAULT_WORLD_GENERATION_SETTINGS, seed: REALM.seed, terrainPreset: 'gomirje_meadows',
    mapSize: 'realm', topography: 12, hydrology: 40, forestDensity: 32,
    conflictMode: 'peaceful', enemyPressure: 0, banditCampsEnabled: false, wildAnimalAttacksEnabled: false };
}

export function createRealmWorldLayout(): WorldLayout {
  const camps = Array.from({ length: 81 }, (_, slot) => realmCamp(slot));
  const half = REALM.size / 2;
  const riverLayout = RiverLayout.create({ bounds: { minX: -half, minZ: -half, maxX: half, maxZ: half },
    seed: REALM.seed, riverCount: 0, tributaryCount: 0, drain: { x: 0, z: -half }, terrainPreset: 'gomirje_meadows' });
  const quarryLayout = QuarryLayout.fromSerialized({ seed: REALM.seed, sites: camps.map(c => ({
    x: c.x + 210, z: c.z + 100, rotation: c.slot * 0.4, kind: c.slot % 3 === 0 ? 'large' : 'small',
    radiusX: c.slot % 3 === 0 ? 43 : 20, radiusZ: c.slot % 3 === 0 ? 34 : 16, pitDepth: 3,
  })) });
  const clayDepositLayout = ClayDepositLayout.fromSites(REALM.seed, camps.map(c => ({
    x: c.x - 190, z: c.z + 90, rotation: c.slot, kind: c.slot % 3 === 1 ? 'rich' : 'ordinary',
    formation: 'inland_basin', radiusX: 14, radiusZ: 9,
  })));
  const mineralDepositLayout = MineralDepositLayout.fromSites(REALM.seed, camps.map(c => ({
    x: c.x + 50, z: c.z - 250, rotation: c.slot, resource: c.slot % 2 ? 'iron' : 'salt',
    grade: c.slot % 3 === 2 ? 'rich' : 'ordinary', formation: c.slot % 2 ? 'bedrock' : 'rock_salt', radiusX: 17, radiusZ: 12,
  })));
  const foragingLayout = ForagingLayout.fromSites(REALM.seed, camps.flatMap(c => [
    { x: c.x - 100, z: c.z - 120, kind: 'game' },
    { x: c.x + 85, z: c.z + 125, kind: 'berries' },
    { x: c.x - 260, z: c.z - 95, kind: 'mushrooms' },
  ] as ForagingSite[]));
  const resourcePlan: RegionalResourcePlan = {
    ordinaryQuarryCount: 54, richStoneDepositCount: 27, ordinaryClayDepositCount: 54, richClayDepositCount: 27,
    ordinaryMineralDepositCount: 54, richMineralDepositCount: 27,
    foragingNodeCounts: { game: 81, berries: 81, mushrooms: 81, fish: 0 },
    foragingRichNodeCounts: { game: 0, berries: 0, mushrooms: 0, fish: 0 },
    presentForagingKinds: ['game', 'berries', 'mushrooms'], totalForagingNodes: 243,
    minimumFoodNodeCount: 162, totalResourceNodes: 486, richResourceNodeCount: 81,
  };
  return { settings: realmSettings(), seed: REALM.seed, treeSeed: REALM.seed, riverLayout, quarryLayout,
    clayDepositLayout, mineralDepositLayout, foragingLayout, forestCores: realmForestCores(), resourcePlan,
    resourceTerrainAccessibility: { isAccessible: (x, z) => Math.abs(x) < half && Math.abs(z) < half },
    resourceRegionDistribution: { territories: camps.map(c => ({ index: c.slot, centerX: c.x, centerZ: c.z,
      plannedNodeCount: 6, plannedRichNodeCount: 1 })), targets: [], richTargets: [], ordinaryTargets: [],
      smallRegionSide: REALM.regionSpacing, richMinimumSpacing: 150 },
  };
}
