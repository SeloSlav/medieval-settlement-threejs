import { computeForestTreePlacements } from '../props/forestPlacements.ts';
import { RiverField } from '../rivers/RiverField.ts';
import { treeWoodYield } from '../resources/treeYield.ts';
import { createWorldLayout, type WorldLayout } from '../resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import { Terrain } from '../terrain/Terrain.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  forestDensityScale,
  resolveWorldDimensions,
  type WorldGenerationSettings,
} from './worldGenerationSettings.ts';
import {
  clayDepositMaxYield,
  clayDepositNodeId,
} from '../clay/ClayDepositLayout.ts';

export type WorldBootstrapQuarry = {
  quarryId: string;
  x: number;
  z: number;
  maxYield: number;
  isRich: boolean;
};

export type WorldBootstrapForagingNode = {
  nodeId: string;
  nodeKind: 'game' | 'berries' | 'mushrooms' | 'fish' | 'clay';
  x: number;
  z: number;
  maxYield: number;
  anchorX: number;
  anchorZ: number;
};

export type WorldBootstrapTree = {
  treeId: string;
  layoutIndex: number;
  woodYield: number;
  x: number;
  z: number;
};

export type WorldBootstrapData = {
  seed: number;
  quarries: WorldBootstrapQuarry[];
  foragingNodes: WorldBootstrapForagingNode[];
  gameRespawnCandidates: Array<{ x: number; z: number }>;
  trees: WorldBootstrapTree[];
};

export type FoundingSitePosition = {
  x: number;
  z: number;
};

const FOUNDING_SITE_SAMPLE_OFFSETS = [
  [0, 0],
  [10, 0],
  [-10, 0],
  [0, 10],
  [0, -10],
  [7, 7],
  [-7, 7],
  [7, -7],
  [-7, -7],
] as const;

/** Headless bootstrap for scripts — rebuilds river/quarry blocking without full terrain mesh. */
export function computeWorldBootstrapDataHeadless(
  settings: WorldGenerationSettings = DEFAULT_WORLD_GENERATION_SETTINGS,
): WorldBootstrapData {
  const worldLayout = createWorldLayout(settings);
  return computeWorldBootstrapDataFromLayout(worldLayout);
}

export function computeWorldBootstrapDataFromLayout(worldLayout: WorldLayout): WorldBootstrapData {
  const dims = resolveWorldDimensions(worldLayout.settings.mapSize);
  const registry = WorldLayoutRegistry.fromWorldLayout(worldLayout);
  const riverBounds = Terrain.fullBounds(dims.terrainSize);
  const riverField = RiverField.fromLayout({ bounds: riverBounds, layout: worldLayout.riverLayout });
  const isBlockedAt = (x: number, z: number) =>
    riverField.isBlockedForProps(x, z)
    || worldLayout.quarryLayout.isBlockedForProps(x, z)
    || worldLayout.clayDepositLayout.isBlockedForProps(x, z)
    || worldLayout.mineralDepositLayout.isBlockedForProps(x, z);

  const quarries: WorldBootstrapQuarry[] = registry.definitionList
    .filter((definition) => definition.kind === 'quarry')
    .map((definition) => ({
      quarryId: definition.id,
      x: definition.x,
      z: definition.z,
      maxYield: definition.maxYield,
      isRich: definition.isRich === true,
    }));

  const foragingNodes: WorldBootstrapForagingNode[] = registry.definitionList
    .filter((definition) =>
      definition.kind === 'game'
      || definition.kind === 'berries'
      || definition.kind === 'mushrooms'
      || definition.kind === 'fish'
    )
    .map((definition) => ({
      nodeId: definition.id,
      nodeKind: definition.kind as 'game' | 'berries' | 'mushrooms' | 'fish',
      x: definition.x,
      z: definition.z,
      maxYield: definition.maxYield,
      anchorX: definition.x,
      anchorZ: definition.z,
    }));
  for (let index = 0; index < worldLayout.clayDepositLayout.sites.length; index++) {
    const site = worldLayout.clayDepositLayout.sites[index];
    foragingNodes.push({
      nodeId: clayDepositNodeId(site, index),
      nodeKind: 'clay',
      x: site.x,
      z: site.z,
      maxYield: clayDepositMaxYield(site),
      anchorX: site.x,
      anchorZ: site.z,
    });
  }

  const treePlacements = computeForestTreePlacements(dims.generationSize, dims.terrainSize, isBlockedAt, {
    treeSeed: worldLayout.treeSeed,
    densityScale: forestDensityScale(worldLayout.settings.forestDensity),
    // Use the same authored woodland cores as the visual forest. Recreating a
    // second core set from the tree seed makes authoritative tree positions and
    // rendered trunks disagree even when their layout indices happen to match.
    forestCores: worldLayout.forestCores,
  });
  const trees: WorldBootstrapTree[] = treePlacements.map((placement, layoutIndex) => ({
    treeId: `tree-${layoutIndex}`,
    layoutIndex,
    x: placement.x,
    z: placement.z,
    woodYield: treeWoodYield({
      form: placement.form,
      species: placement.species,
      scale: placement.scale,
    }),
  }));

  return {
    seed: worldLayout.seed,
    quarries,
    foragingNodes,
    gameRespawnCandidates: worldLayout.foragingLayout.gameRespawnCandidates,
    trees,
  };
}

/**
 * Select a deterministic, buildable village origin near the centre of the map.
 * Terrain height is supplied by the rendered terrain when available, so the
 * opening camp favours a broad bench instead of an arbitrary steep hillside.
 */
export function selectFoundingSite(
  worldLayout: WorldLayout,
  getHeightAt: (x: number, z: number) => number = () => 0,
): FoundingSitePosition {
  const dims = resolveWorldDimensions(worldLayout.settings.mapSize);
  const riverField = RiverField.fromLayout({
    bounds: Terrain.fullBounds(dims.terrainSize),
    layout: worldLayout.riverLayout,
  });
  const resourceAnchors = [
    ...WorldLayoutRegistry.fromWorldLayout(worldLayout).definitionList,
    ...worldLayout.clayDepositLayout.sites,
    ...worldLayout.mineralDepositLayout.sites,
  ];
  const candidates: FoundingSitePosition[] = [];
  const seedAngle = ((worldLayout.seed >>> 0) / 0x1_0000_0000) * Math.PI * 2;

  for (let ring = 0; ring <= 8; ring += 1) {
    const count = ring === 0 ? 1 : 12 + ring * 4;
    const radius = ring * 22;
    for (let index = 0; index < count; index += 1) {
      const angle = seedAngle + (index / count) * Math.PI * 2 + ring * 0.31;
      candidates.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
      });
    }
  }

  let best: { position: FoundingSitePosition; score: number } | null = null;
  for (const position of candidates) {
    if (
      Math.abs(position.x) > dims.playableHalf - 18
      || Math.abs(position.z) > dims.playableHalf - 18
      || resourceAnchors.some(
        (resource) => Math.hypot(resource.x - position.x, resource.z - position.z) < 18,
      )
    ) {
      continue;
    }
    const footprintIsClear = FOUNDING_SITE_SAMPLE_OFFSETS.every(([offsetX, offsetZ]) => {
      const x = position.x + offsetX;
      const z = position.z + offsetZ;
      return !riverField.isBlockedForProps(x, z)
        && !worldLayout.quarryLayout.isBlockedForProps(x, z)
        && !worldLayout.clayDepositLayout.isBlockedForProps(x, z)
        && !worldLayout.mineralDepositLayout.isBlockedForProps(x, z);
    });
    if (!footprintIsClear) continue;

    const heights = FOUNDING_SITE_SAMPLE_OFFSETS.map(([offsetX, offsetZ]) =>
      getHeightAt(position.x + offsetX, position.z + offsetZ)
    );
    const relief = Math.max(...heights) - Math.min(...heights);
    const centreDistance = Math.hypot(position.x, position.z);
    const score = relief * 48 + centreDistance * 0.14;
    if (!best || score < best.score) {
      best = { position, score };
    }
  }

  return best?.position ?? { x: 0, z: 0 };
}
