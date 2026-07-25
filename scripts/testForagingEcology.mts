import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  foragerPlacementCandidates,
  validateBuildingPlacement,
} from '../src/buildings/BuildingPlacementValidation.ts';
import {
  GAME_MIN_BREEDING_POPULATION,
  MUSHROOMS_PER_HARVEST,
} from '../src/generated/gameBalance.ts';
import {
  foragingSeason,
  isForagingHarvestAvailable,
  isForagingRegrowthSeason,
} from '../src/foraging/foragingSeason.ts';
import {
  GAME_HABITAT_WATER_CLEARANCE,
  isGameHabitatClearOfWater,
} from '../src/foraging/ForagingLayout.ts';
import {
  GAME_PATCH_MAX_YIELD,
  RICH_GAME_PATCH_MAX_YIELD,
  RICH_GAME_PATCH_PICK_RADIUS,
  gamePatchSpawnRadius,
} from '../src/foraging/foragingYields.ts';
import { forestDensityAt } from '../src/props/forestField.ts';
import { MUSHROOM_ICON_SVG } from '../src/map/resourceMapIconGlyphs.ts';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import { computeWorldBootstrapDataHeadless } from '../src/world/worldBootstrapData.ts';
import { RiverField } from '../src/rivers/RiverField.ts';
import {
  RESOURCE_KINDS,
  createEmptyStockpile,
  type BuildingState,
  type ForagingNodeState,
  type ResidenceState,
} from '../src/resources/types.ts';
import { resolveWorldDimensions } from '../src/world/worldGenerationSettings.ts';
import {
  collectWorkerTargets,
  pickWorkerWalkPlan,
} from '../src/settlement/workerPaths.ts';
import { Terrain } from '../src/terrain/Terrain.ts';

assert.ok(RESOURCE_KINDS.includes('mushrooms'));
assert.equal(createEmptyStockpile().mushrooms, 0);
assert.ok(MUSHROOMS_PER_HARVEST > 0);
assert.equal(GAME_MIN_BREEDING_POPULATION, 2);

assert.equal(foragingSeason(1), 'winter');
assert.equal(foragingSeason(4), 'spring');
assert.equal(foragingSeason(7), 'summer');
assert.equal(foragingSeason(10), 'autumn');
assert.equal(isForagingHarvestAvailable('berries', 1), false);
assert.equal(isForagingHarvestAvailable('mushrooms', 12), false);
assert.equal(isForagingHarvestAvailable('game', 1), true);
assert.equal(isForagingRegrowthSeason('berries', 4), true);
assert.equal(isForagingRegrowthSeason('mushrooms', 7), true);
assert.equal(isForagingRegrowthSeason('mushrooms', 10), false);

for (const mapSize of ['small', 'medium', 'large'] as const) {
  const layout = createWorldLayout({
    seed: 0x51ac71 ^ mapSize.length,
    mapSize,
    topography: 50,
    hydrology: 50,
    forestDensity: 50,
  });
  const dimensions = resolveWorldDimensions(mapSize);
  const mushrooms = layout.foragingLayout.sites.filter((site) => site.kind === 'mushrooms');
  const berries = layout.foragingLayout.sites.filter((site) => site.kind === 'berries');
  const gameHabitats = layout.foragingLayout.sites.filter((site) => site.kind === 'game');
  assert.equal(gameHabitats.length, 2, `${mapSize} maps should have two game habitats`);
  assert.equal(
    gameHabitats.filter((site) => site.isRich).length,
    1,
    `${mapSize} maps should have one large game habitat`,
  );
  assert.notDeepEqual(
    [gameHabitats[0].x, gameHabitats[0].z],
    [gameHabitats[1].x, gameHabitats[1].z],
    `${mapSize} game habitats should occupy different locations`,
  );
  assertGameHabitatsStayDry(layout, `${mapSize} map`);
  assert.equal(mushrooms.length, 2, `${mapSize} maps should have two mushroom beds`);
  assert.equal(berries.length, 2, `${mapSize} maps should have two berry patches`);

  const mushroomDensity = average(mushrooms.map((site) => forestDensityAt(
    site.x,
    site.z,
    layout.forestCores,
    dimensions.playableHalf,
    dimensions.terrainSize,
  )));
  const berryDensity = average(berries.map((site) => forestDensityAt(
    site.x,
    site.z,
    layout.forestCores,
    dimensions.playableHalf,
    dimensions.terrainSize,
  )));
  assert.ok(
    mushroomDensity > berryDensity + 0.15,
    `${mapSize} mushroom beds should sit substantially deeper in the forest than berries`,
  );
}

const layout = createWorldLayout();
assertGameHabitatsStayDry(layout, 'default map');
const registry = WorldLayoutRegistry.fromWorldLayout(layout);
const gameDefinitions = registry.definitionList.filter((node) => node.kind === 'game');
assert.deepEqual(gameDefinitions.map((node) => node.id), ['foraging-game-0', 'foraging-game-1']);
assert.deepEqual(
  gameDefinitions.map((node) => node.maxYield),
  [GAME_PATCH_MAX_YIELD, RICH_GAME_PATCH_MAX_YIELD],
);
assert.equal(gameDefinitions[1].label, 'Large game habitat');
assert.equal(gameDefinitions[1].pickRadius, RICH_GAME_PATCH_PICK_RADIUS);
assert.ok(gameDefinitions[1].pickRadius > gameDefinitions[0].pickRadius);
const mushroomDefinitions = registry.definitionList.filter((node) => node.kind === 'mushrooms');
assert.equal(mushroomDefinitions.length, 2);
assert.ok(mushroomDefinitions.every((node) => node.resource === 'mushrooms'));
assert.ok(mushroomDefinitions.every((node) => node.label.includes('Deep-forest')));

const mushroomStates: ForagingNodeState[] = mushroomDefinitions.map((node) => ({
  nodeId: node.id,
  kind: 'mushrooms',
  resource: 'mushrooms',
  remaining: node.maxYield,
  maxYield: node.maxYield,
  x: node.x,
  z: node.z,
}));
const firstMushroom = mushroomStates[0];
const snappedForagerSites = foragerPlacementCandidates(
  firstMushroom.x,
  firstMushroom.z,
  mushroomStates,
);
assert.ok(snappedForagerSites.length >= 24, 'clicking mushrooms should offer nearby hut sites');
assert.ok(
  snappedForagerSites.every((site) => {
    const distance = Math.hypot(
      site.x - firstMushroom.x,
      site.z - firstMushroom.z,
    );
    return distance > 8 && distance < 48;
  }),
  'forager snap candidates should preserve the patch while staying inside work range',
);
assert.deepEqual(
  validateBuildingPlacement('foragers_shed', firstMushroom.x + 12, firstMushroom.z, {
    buildings: [] as BuildingState[],
    residences: [] as ResidenceState[],
    burgageZones: [],
    farmFields: [],
    pastures: [],
    quarries: [],
    foragingNodes: mushroomStates,
    stockpile: { timber: 10_000, stone: 10_000 },
    isWaterAt: () => false,
    getNaturalHeightAt: () => 0,
  }),
  { ok: true },
  'the existing forager shed must accept a mushroom bed in its work extent',
);
assert.deepEqual(
  validateBuildingPlacement('foragers_shed', firstMushroom.x + 12, firstMushroom.z, {
    buildings: [] as BuildingState[],
    residences: [] as ResidenceState[],
    burgageZones: [],
    farmFields: [],
    pastures: [],
    quarries: [],
    foragingNodes: mushroomStates.map((node) => ({ ...node, remaining: 0 })),
    stockpile: { timber: 10_000, stone: 10_000 },
    isWaterAt: () => false,
    getNaturalHeightAt: () => 0,
  }),
  { ok: true },
  'an empty seasonal patch must remain a valid persistent forager location',
);

const forager = {
  id: 'forager-test',
  kind: 'foragers_shed',
  x: firstMushroom.x + 12,
  z: firstMushroom.z,
  workRadius: 48,
  constructionComplete: true,
} as BuildingState;
const workerTargetInputs = {
  quarries: [],
  foragingNodes: mushroomStates,
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
};
assert.equal(
  collectWorkerTargets(forager, { ...workerTargetInputs, foragingMonth: 1 }).length,
  0,
  'forager actors should remain idle while mushroom beds are dormant in winter',
);
assert.ok(
  collectWorkerTargets(forager, { ...workerTargetInputs, foragingMonth: 4 })
    .some((target) => target.kind === 'mushrooms'),
  'forager actors should walk to mushroom beds during the growing season',
);
const gatherTargets = collectWorkerTargets(
  forager,
  { ...workerTargetInputs, foragingMonth: 4 },
);
const gatherPlan = Array.from({ length: 32 }, (_, seed) =>
  pickWorkerWalkPlan(forager, 0, gatherTargets, seed)
).find((plan) => plan?.activity === 'gather');
assert.ok(gatherPlan, 'foragers should stop and gather at berry or mushroom targets');

assert.ok(MUSHROOM_ICON_SVG.includes('currentColor'));
assert.ok(!MUSHROOM_ICON_SVG.includes('<image'));
assert.ok(MUSHROOM_ICON_SVG.includes('foraging-map-icon-glyph--mushrooms'));

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const generatedForaging = JSON.parse(readFileSync(
  `${projectRoot}server/generated/world_foraging.json`,
  'utf8',
));
const currentBootstrap = computeWorldBootstrapDataHeadless();
assert.deepEqual(
  generatedForaging,
  {
    foragingNodes: currentBootstrap.foragingNodes,
    gameRespawnCandidates: currentBootstrap.gameRespawnCandidates,
  },
  'server forage bootstrap coordinates must match the client world layout',
);

const lifecycle = readFileSync(
  `${projectRoot}server/src/simulation/foraging_respawn.rs`,
  'utf8',
);
assert.match(lifecycle, /population_growth_per_second/);
assert.match(lifecycle, /migrate_disrupted_game_habitats/);
assert.doesNotMatch(lifecycle, /\.delete\(/, 'persistent wild-resource nodes must never be deleted');

const foodSupplier = readFileSync(
  `${projectRoot}server/src/simulation/food_supplier.rs`,
  'utf8',
);
assert.match(foodSupplier, /&\["berries",\s*"mushrooms"\]/);
assert.match(foodSupplier, /GAME_ANIMALS_PER_HARVEST/);

const granary = readFileSync(
  `${projectRoot}server/src/simulation/expanded_economy.rs`,
  'utf8',
);
assert.match(
  granary,
  /CommodityKind::Food,\s*&\["hunters_hall",\s*"foragers_shed",\s*"fishing_camp",\s*"swineherd"\]/s,
  'the granary should collect road-linked wild-food surplus',
);

const mushroomVisuals = readFileSync(
  `${projectRoot}src/foraging/MushroomPatchVisuals.ts`,
  'utf8',
);
assert.match(mushroomVisuals, /InstancedMesh/);
assert.match(mushroomVisuals, /CLOSE_WORLD_MAX_CAMERA_DISTANCE/);
assert.match(mushroomVisuals, /placement\.visibilityNoise\s*<\s*ratio/);

const berryVisuals = readFileSync(
  `${projectRoot}src/foraging/BerryPatchVisuals.ts`,
  'utf8',
);
assert.match(berryVisuals, /raspberry_patch_albedo\.png/);
assert.match(berryVisuals, /raspberryMatrices/);
assert.doesNotMatch(berryVisuals, /createHarvestableBerryGeometry|appendBerryIcosahedron|Bright red harvestable/);
assert.ok(existsSync(
  `${projectRoot}public/assets/textures/vegetation/raspberry_patch_albedo.png`,
));

const undergrowthVisuals = readFileSync(
  `${projectRoot}src/props/ForestUndergrowth.ts`,
  'utf8',
);
assert.match(
  undergrowthVisuals,
  /juniper_scrub_albedo\.png/,
  'ordinary juniper undergrowth must keep its original texture',
);

const deerVisuals = readFileSync(
  `${projectRoot}src/foraging/DeerWildlifeVisuals.ts`,
  'utf8',
);
assert.match(deerVisuals, /herdSexCounts\(visiblePopulation\)/);
assert.match(deerVisuals, /visual\.sexIndex\s*<\s*visibleSexCounts\.(stagCount|doeCount)/);
assert.match(deerVisuals, /node\.x\s*-\s*visual\.motion\.homeX/);

console.log('foraging ecology tests passed');

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function assertGameHabitatsStayDry(
  worldLayout: ReturnType<typeof createWorldLayout>,
  label: string,
): void {
  const dimensions = resolveWorldDimensions(worldLayout.settings.mapSize);
  const riverField = RiverField.fromLayout({
    bounds: Terrain.fullBounds(dimensions.terrainSize),
    layout: worldLayout.riverLayout,
  });
  const habitats = worldLayout.foragingLayout.sites.filter((site) => site.kind === 'game');

  for (const habitat of habitats) {
    assert.equal(
      isGameHabitatClearOfWater(
        worldLayout.riverLayout,
        habitat.x,
        habitat.z,
        GAME_HABITAT_WATER_CLEARANCE,
      ),
      true,
      `${label} ${habitat.isRich ? 'large' : 'standard'} game habitat should clear the river`,
    );
    const spawnRadius = gamePatchSpawnRadius(habitat.isRich === true);
    for (let radius = 0; radius <= spawnRadius; radius += 2) {
      for (let angleIndex = 0; angleIndex < 24; angleIndex++) {
        const angle = angleIndex * Math.PI * 2 / 24;
        assert.equal(
          riverField.isRenderedWetAt(
            habitat.x + Math.sin(angle) * radius,
            habitat.z + Math.cos(angle) * radius,
          ),
          false,
          `${label} game herd footprint should stay on dry land`,
        );
      }
    }
  }

  assert.ok(
    worldLayout.foragingLayout.gameRespawnCandidates.length >= 2,
    `${label} should retain dry migration destinations`,
  );
  assert.ok(
    worldLayout.foragingLayout.gameRespawnCandidates.every((candidate) =>
      isGameHabitatClearOfWater(worldLayout.riverLayout, candidate.x, candidate.z)
    ),
    `${label} migration candidates should also clear the river`,
  );
}
