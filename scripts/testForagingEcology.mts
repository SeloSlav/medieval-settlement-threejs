import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
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
  HARVEST_RESERVE_PRESETS,
  harvestableWildStock,
  isWildStockHarvestable,
  normalizeHarvestReservePercent,
  protectedWildStock,
} from '../src/foraging/harvestReservePolicy.ts';
import {
  BERRY_PATCH_WATER_CLEARANCE,
  GAME_HABITAT_DEPOSIT_CLEARANCE,
  GAME_HABITAT_WATER_CLEARANCE,
  MUSHROOM_FOREST_MIN,
  MUSHROOM_PATCH_WATER_CLEARANCE,
  isBerryPatchClearOfWater,
  isGameHabitatClearOfDeposits,
  isGameHabitatClearOfWater,
  isMushroomPatchClearOfWater,
} from '../src/foraging/ForagingLayout.ts';
import {
  BERRY_THICKET_MAX_SPACING,
  BERRY_THICKET_MIN_SPACING,
  MAX_RASPBERRIES_PER_CLUMP,
  MIN_VISIBLE_BERRY_CLUMPS,
  ORDINARY_BERRY_CLUMPS,
  ORDINARY_BERRY_THICKET_RADIUS_SCALE,
  RICH_BERRY_CLUMPS,
  RICH_BERRY_THICKET_RADIUS_SCALE,
  RASPBERRY_CANE_HEIGHT_MULTIPLIER,
  berryClumpTargetCount,
  berryThicketRadiusScale,
  isBerryClumpVisible,
  isBerryFruitVisible,
  resolveBerryClumpPosition,
} from '../src/foraging/berryPatchPresentation.ts';
import {
  BERRY_PATCH_MAX_YIELD,
  BERRY_PATCH_MAX_SPAWN_RADIUS,
  GAME_PATCH_MAX_YIELD,
  MUSHROOM_PATCH_MAX_SPAWN_RADIUS,
  RICH_BERRY_PATCH_MAX_YIELD,
  RICH_BERRY_PATCH_PICK_RADIUS,
  RICH_GAME_PATCH_MAX_YIELD,
  RICH_GAME_PATCH_PICK_RADIUS,
  gamePatchSpawnRadius,
  isRichForagingCapacity,
} from '../src/foraging/foragingYields.ts';
import { forestDensityAt } from '../src/props/forestField.ts';
import { MUSHROOM_ICON_HTML } from '../src/map/resourceMapIconArt.ts';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { createPhysicalDepositFootprints } from '../src/resources/physicalDepositProtection.ts';
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
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  resolveWorldDimensions,
} from '../src/world/worldGenerationSettings.ts';
import { applyTerrainPreset } from '../src/world/worldTerrainPresets.ts';
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
assert.deepEqual(HARVEST_RESERVE_PRESETS.map((preset) => preset.percent), [0, 25, 50]);
assert.equal(normalizeHarvestReservePercent(255), 90);
assert.equal(protectedWildStock('game', 12, 25), 3);
assert.equal(
  harvestableWildStock({ kind: 'game', remaining: 9, maxYield: 12 }, 25),
  6,
);
assert.equal(
  isWildStockHarvestable({ kind: 'game', remaining: 3, maxYield: 12 }, 25),
  false,
);
assert.equal(
  harvestableWildStock({ kind: 'berries', remaining: 12, maxYield: 60 }, 50),
  12,
  'wild-stock policy must not reserve seasonal forage',
);

for (const mapSize of ['small', 'medium', 'large'] as const) {
  const layout = createWorldLayout({
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    seed: 0x51ac71 ^ mapSize.length,
    mapSize,
    topography: 50,
    hydrology: 50,
    forestDensity: 50,
    resourceAbundance: 100,
    resourceVariety: 100,
  });
  const dimensions = resolveWorldDimensions(mapSize);
  const mushrooms = layout.foragingLayout.sites.filter((site) => site.kind === 'mushrooms');
  const berries = layout.foragingLayout.sites.filter((site) => site.kind === 'berries');
  const gameHabitats = layout.foragingLayout.sites.filter((site) => site.kind === 'game');
  assert.equal(gameHabitats.length, layout.resourcePlan.foragingNodeCounts.game);
  assert.ok(gameHabitats.length > 0, `${mapSize} maps should retain a winter game habitat`);
  assert.equal(
    gameHabitats.filter((site) => site.isRich).length,
    1,
    `${mapSize} maps should have one large game habitat`,
  );
  if (gameHabitats.length > 1) {
    assert.notDeepEqual(
      [gameHabitats[0].x, gameHabitats[0].z],
      [gameHabitats[1].x, gameHabitats[1].z],
      `${mapSize} game habitats should occupy different locations`,
    );
  }
  assertGameHabitatsStayDry(layout, `${mapSize} map`);
  assertBerryPatchesStayDry(layout, `${mapSize} map`);
  assertMushroomPatchesStayInDryDeepForest(layout, `${mapSize} map`);
  assert.equal(mushrooms.length, layout.resourcePlan.foragingNodeCounts.mushrooms);
  assert.equal(berries.length, layout.resourcePlan.foragingNodeCounts.berries);
  assert.ok(mushrooms.length > 0, 'complete regions should retain mushrooms');
  assert.ok(berries.length > 0, 'complete regions should retain berries');
  assert.equal(
    berries.filter((site) => site.isRich).length,
    1,
    `${mapSize} maps should have one rich raspberry thicket`,
  );

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
assertBerryPatchesStayDry(layout, 'default map');
assertMushroomPatchesStayInDryDeepForest(layout, 'default map');
for (const preset of ['kupa_valley', 'risnjak_pass', 'delnice_meadow', 'vinodol_coast'] as const) {
  const presetLayout = createWorldLayout(applyTerrainPreset({
      ...DEFAULT_WORLD_GENERATION_SETTINGS,
      seed: 0x52a91,
      resourceAbundance: 100,
      resourceVariety: 100,
    }, preset));
  assertGameHabitatsStayDry(presetLayout, `${preset} preset`);
  assertMushroomPatchesStayInDryDeepForest(presetLayout, `${preset} preset`);
}
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
const berryDefinitions = registry.definitionList.filter((node) => node.kind === 'berries');
assert.deepEqual(
  berryDefinitions.map((node) => node.maxYield),
  [BERRY_PATCH_MAX_YIELD, RICH_BERRY_PATCH_MAX_YIELD],
);
assert.equal(berryDefinitions[1].label, 'Rich raspberry thicket');
assert.equal(berryDefinitions[1].pickRadius, RICH_BERRY_PATCH_PICK_RADIUS);
assert.equal(berryDefinitions[1].isRich, true);
assert.equal(isRichForagingCapacity('berries', BERRY_PATCH_MAX_YIELD), false);
assert.equal(isRichForagingCapacity('berries', RICH_BERRY_PATCH_MAX_YIELD), true);
const mushroomDefinitions = registry.definitionList.filter((node) => node.kind === 'mushrooms');
assert.equal(mushroomDefinitions.length, layout.resourcePlan.foragingNodeCounts.mushrooms);
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
assert.deepEqual(
  validateBuildingPlacement('foragers_shed', firstMushroom.x, firstMushroom.z, {
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
  { ok: false, reason: 'on_resource_deposit' },
  'the player-chosen shed footprint must not cover the mushroom bed',
);
assert.deepEqual(
  validateBuildingPlacement('foragers_shed', firstMushroom.x + 12, firstMushroom.z, {
    buildings: [] as BuildingState[],
    residences: [] as ResidenceState[],
    burgageZones: [],
    farmFields: [],
    pastures: [],
    quarries: [],
    // GameState supplies Map.values(), a one-shot iterator. Checking berries
    // must not consume it before the validator can see mushrooms.
    foragingNodes: new Map(
      mushroomStates.map((node) => [node.nodeId, node] as const),
    ).values(),
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

const protectedGame = {
  nodeId: 'protected-game',
  kind: 'game',
  resource: 'game',
  remaining: 3,
  maxYield: 12,
  x: 20,
  z: 0,
} as ForagingNodeState;
const hunter = {
  id: 'hunter-test',
  kind: 'hunters_hall',
  x: 0,
  z: 0,
  workRadius: 48,
  assignedLabor: 1,
  constructionComplete: true,
  harvestReservePercent: 25,
} as BuildingState;
assert.equal(
  collectWorkerTargets(hunter, {
    ...workerTargetInputs,
    foragingNodes: [protectedGame],
  }).length,
  0,
  'visible hunters must rest when a population reaches its protected floor',
);
assert.ok(
  collectWorkerTargets(hunter, {
    ...workerTargetInputs,
    foragingNodes: [{ ...protectedGame, remaining: 4 }],
  }).some((target) => target.kind === 'game'),
  'visible hunters should return when population growth creates harvestable surplus',
);

assert.ok(MUSHROOM_ICON_HTML.includes('map-resource-icon-glyph--mushrooms'));
assert.ok(!MUSHROOM_ICON_HTML.includes('<img'));

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
assert.match(foodSupplier, /harvestable_wild_stock/);
assert.match(foodSupplier, /building\.harvest_reserve_percent/);

const harvestInspector = readFileSync(
  `${projectRoot}src/resources/inspector/harvestBuildingRenderer.ts`,
  'utf8',
);
assert.match(harvestInspector, /data-harvest-reserve-percent/);
assert.match(harvestInspector, /Wild-stock reserve/);

const granary = readFileSync(
  `${projectRoot}server/src/simulation/expanded_economy.rs`,
  'utf8',
);
assert.match(
  granary,
  /pub fn step_institutional_food_dispatch[\s\S]*?\["guardhouse", "smokehouse", "granary"\]/s,
  'wild-food producer carts should consider enabled road-linked granaries in shared institutional arbitration',
);
assert.equal(
  isBerryClumpVisible(MIN_VISIBLE_BERRY_CLUMPS - 1, 0, 60, false, 0.99),
  true,
  'the physical berry bush patch must remain visible while dormant or depleted',
);
assert.equal(
  isBerryClumpVisible(MIN_VISIBLE_BERRY_CLUMPS, 60, 60, true, 0.99),
  true,
);
assert.equal(
  isBerryClumpVisible(MIN_VISIBLE_BERRY_CLUMPS, 0, 60, true, 0),
  false,
);
assert.equal(berryClumpTargetCount(false), ORDINARY_BERRY_CLUMPS);
assert.equal(berryClumpTargetCount(true), RICH_BERRY_CLUMPS);
assert.equal(MAX_RASPBERRIES_PER_CLUMP, 8);
assert.equal(RASPBERRY_CANE_HEIGHT_MULTIPLIER, 1.9);
assert.equal(ORDINARY_BERRY_THICKET_RADIUS_SCALE, 0.5);
assert.equal(RICH_BERRY_THICKET_RADIUS_SCALE, 0.58);
assert.equal(berryThicketRadiusScale(false), ORDINARY_BERRY_THICKET_RADIUS_SCALE);
assert.equal(berryThicketRadiusScale(true), RICH_BERRY_THICKET_RADIUS_SCALE);
assert.ok(BERRY_THICKET_MIN_SPACING < BERRY_THICKET_MAX_SPACING);
assert.equal(isBerryFruitVisible(0, 60, true, 0), false);
assert.equal(isBerryFruitVisible(60, 60, true, 0.99), true);
assert.equal(isBerryFruitVisible(30, 60, true, 0.8), false);
assert.equal(isBerryFruitVisible(30, 60, true, 0.7), true);
assert.equal(isBerryFruitVisible(60, 60, false, 0), false);
assert.deepEqual(
  resolveBerryClumpPosition(10, 20, 13, 18, 110, -40),
  { x: 113, z: -42 },
  'berry clump offsets must follow the authoritative replicated node center',
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
assert.match(berryVisuals, /createGorskiShrubPrototype\('raspberry'/);
assert.match(berryVisuals, /raspberry_cluster\.glb/);
assert.match(berryVisuals, /new THREE\.InstancedMesh/);
assert.match(berryVisuals, /fruitMesh\.count = visibleFruitCount/);
assert.match(berryVisuals, /targetDiameterM = \[0\.017, 0\.022\]/);
assert.match(berryVisuals, /RASPBERRY_CANE_HEIGHT_MULTIPLIER/);
assert.match(berryVisuals, /berryThicketRadiusScale/);
assert.doesNotMatch(
  berryVisuals,
  /raspberry_patch_albedo\.png|createSeedThreeCardClumpGeometry|appendBerryIcosahedron/,
  'harvestable raspberry resources must use generated cane geometry and real GLB fruit, not whole-bush cards',
);
assert.ok(existsSync(
  `${projectRoot}vendor/seedthree/assets/fruits/raspberry_cluster.glb`,
));
assert.ok(existsSync(
  `${projectRoot}vendor/seedthree/assets/leaves/raspberry_spray_albedo.png`,
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
assert.match(undergrowthVisuals, /createGorskiShrubPrototype/);
assert.doesNotMatch(
  undergrowthVisuals,
  /createCardClumpGeometry/,
  'bilberry and juniper undergrowth must not regress to crossed card clumps',
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
  const deposits = createPhysicalDepositFootprints(worldLayout);

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
    assert.equal(
      isGameHabitatClearOfDeposits(deposits, habitat.x, habitat.z),
      true,
      `${label} game habitat should clear stone, clay, iron, and salt deposits by ${GAME_HABITAT_DEPOSIT_CLEARANCE} m beyond their protected edges`,
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
  assert.ok(
    worldLayout.foragingLayout.gameRespawnCandidates.every((candidate) =>
      isGameHabitatClearOfDeposits(deposits, candidate.x, candidate.z)
    ),
    `${label} migration candidates should also clear every physical deposit`,
  );
}

function assertBerryPatchesStayDry(
  worldLayout: ReturnType<typeof createWorldLayout>,
  label: string,
): void {
  const dimensions = resolveWorldDimensions(worldLayout.settings.mapSize);
  const riverField = RiverField.fromLayout({
    bounds: Terrain.fullBounds(dimensions.terrainSize),
    layout: worldLayout.riverLayout,
  });
  const patches = worldLayout.foragingLayout.sites.filter((site) => site.kind === 'berries');

  for (const patch of patches) {
    assert.equal(
      isBerryPatchClearOfWater(
        worldLayout.riverLayout,
        patch.x,
        patch.z,
        BERRY_PATCH_WATER_CLEARANCE,
      ),
      true,
      `${label} berry patch should clear the river`,
    );
    for (let radius = 0; radius <= BERRY_PATCH_MAX_SPAWN_RADIUS; radius += 1) {
      for (let angleIndex = 0; angleIndex < 24; angleIndex++) {
        const angle = angleIndex * Math.PI * 2 / 24;
        assert.equal(
          riverField.isRenderedWetAt(
            patch.x + Math.sin(angle) * radius,
            patch.z + Math.cos(angle) * radius,
          ),
          false,
          `${label} berry patch footprint should stay on dry land`,
        );
      }
    }
  }
}

function assertMushroomPatchesStayInDryDeepForest(
  worldLayout: ReturnType<typeof createWorldLayout>,
  label: string,
): void {
  const dimensions = resolveWorldDimensions(worldLayout.settings.mapSize);
  const riverField = RiverField.fromLayout({
    bounds: Terrain.fullBounds(dimensions.terrainSize),
    layout: worldLayout.riverLayout,
  });
  const patches = worldLayout.foragingLayout.sites.filter((site) => site.kind === 'mushrooms');

  for (const patch of patches) {
    assert.ok(
      forestDensityAt(
        patch.x,
        patch.z,
        worldLayout.forestCores,
        dimensions.playableHalf,
        dimensions.terrainSize,
      ) >= MUSHROOM_FOREST_MIN,
      `${label} mushroom patch should remain in deep forest`,
    );
    assert.equal(
      isMushroomPatchClearOfWater(
        worldLayout.riverLayout,
        patch.x,
        patch.z,
        MUSHROOM_PATCH_WATER_CLEARANCE,
      ),
      true,
      `${label} mushroom patch should clear the river`,
    );
    for (let radius = 0; radius <= MUSHROOM_PATCH_MAX_SPAWN_RADIUS; radius += 1) {
      for (let angleIndex = 0; angleIndex < 24; angleIndex++) {
        const angle = angleIndex * Math.PI * 2 / 24;
        assert.equal(
          riverField.isRenderedWetAt(
            patch.x + Math.sin(angle) * radius,
            patch.z + Math.cos(angle) * radius,
          ),
          false,
          `${label} mushroom patch footprint should stay on dry land`,
        );
      }
    }
  }
}
