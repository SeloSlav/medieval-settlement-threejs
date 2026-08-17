import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { sampleBuildingFootprintPoints } from '../src/buildings/BuildingTerrainLayout.ts';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
import {
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  FISH_REPRODUCTION_RATE_PER_DAY,
  FISH_PER_HARVEST,
  RICH_FISH_YIELD_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  isForagingHarvestAvailable,
  isForagingRegrowthSeason,
} from '../src/foraging/foragingSeason.ts';
import {
  harvestableWildStock,
  protectedWildStock,
} from '../src/foraging/harvestReservePolicy.ts';
import {
  RICH_FISH_SCHOOL_VISUAL_CAPACITY,
  SMALL_FISH_SCHOOL_VISUAL_CAPACITY,
  displayedFishSchoolCount,
  sampleFishBreach,
} from '../src/foraging/FishWildlifeVisuals.ts';
import { claimResidencesForFoodSuppliers } from '../src/logistics/roadLogistics.ts';
import { FISH_ICON_HTML } from '../src/map/resourceMapIconArt.ts';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import { RiverField } from '../src/rivers/RiverField.ts';
import { fullTerrainBounds } from '../src/terrain/terrainBounds.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  resolveWorldDimensions,
} from '../src/world/worldGenerationSettings.ts';
import { applyTerrainPreset } from '../src/world/worldTerrainPresets.ts';
import {
  RESOURCE_KINDS,
  createEmptyStockpile,
  type BuildingState,
  type ForagingNodeState,
  type ResidenceState,
} from '../src/resources/types.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';

const layout = createWorldLayout({
  ...DEFAULT_WORLD_GENERATION_SETTINGS,
  mapSize: 'large',
  resourceAbundance: 100,
  resourceVariety: 100,
});
const registry = WorldLayoutRegistry.fromWorldLayout(layout);
const fish = registry.definitionList.filter((node) => node.kind === 'fish');

assert.equal(fish.length, layout.resourcePlan.foragingNodeCounts.fish);
assert.ok(fish.length >= 2, 'a plentiful complete large region should create multiple fish shoals');
assert.equal(fish.filter((node) => node.isRich === true).length, 1);
assert.equal(fish.filter((node) => node.isRich !== true).length, fish.length - 1);
assert.ok(fish.every((node) => node.resource === 'fish'));
assert.ok(fish.every((node) => layout.riverLayout.isWaterAt(node.x, node.z)));
assert.ok(fish.every((node) => node.maxYield > 0));
assert.ok(
  fish.find((node) => node.isRich)!.maxYield
    > fish.find((node) => !node.isRich)!.maxYield,
  'rich shoal should advertise the larger yield class',
);

// Regression for the Risnjak world reported as a "shoal on land". The node
// is a river fishery, so keep its authoritative coordinate inside the exact
// rendered-water topology used by visuals and building placement.
const reportedSettings = {
  ...DEFAULT_WORLD_GENERATION_SETTINGS,
  seed: 1_901_735_437,
  mapSize: 'medium' as const,
  topography: 92,
  hydrology: 46,
  forestDensity: 84,
  resourceAbundance: 50,
  resourceVariety: 50,
};
const reportedLayout = createWorldLayout(reportedSettings);
const reportedDimensions = resolveWorldDimensions(reportedSettings.mapSize);
const reportedRiverField = RiverField.fromLayout({
  bounds: fullTerrainBounds(reportedDimensions.terrainSize),
  layout: reportedLayout.riverLayout,
});
const reportedRichShoal = reportedLayout.foragingLayout.sites.find(
  (site) => site.kind === 'fish' && site.isRich === true,
);
assert.ok(reportedRichShoal, 'the reported Risnjak world must retain its rich shoal');
assert.equal(reportedLayout.settings.terrainPreset, 'risnjak_pass');
assert.equal(
  reportedRiverField.isRenderedWetAt(reportedRichShoal.x, reportedRichShoal.z),
  true,
  'the reported rich shoal must remain inside final rendered river water',
);
assert.equal(
  reportedLayout.riverLayout.isInlandWaterAt(reportedRichShoal.x, reportedRichShoal.z),
  false,
  'the reported rich shoal belongs to a river, not a hidden pond or lake',
);

assert.ok(RESOURCE_KINDS.includes('fish'));
assert.equal(createEmptyStockpile().fish, 0);
assert.equal(BUILDING_DEFINITIONS.fishing_camp.requiresFish, true);
assert.equal(BUILDING_DEFINITIONS.fishing_camp.workRadius, 64);
assert.equal(BUILDING_STORAGE_CAPS.fishing_camp.food, 120);
assert.ok(FISH_PER_HARVEST > 0);
assert.ok(RICH_FISH_YIELD_MULTIPLIER > 1);
assert.ok(FISH_REPRODUCTION_RATE_PER_DAY > 0);
assert.equal(isForagingHarvestAvailable('fish', 1), false);
assert.equal(isForagingHarvestAvailable('fish', 4), true);
assert.equal(isForagingRegrowthSeason('fish', 4), true);
assert.equal(isForagingRegrowthSeason('fish', 7), false);
assert.equal(protectedWildStock('fish', 120, 25), 30);
assert.equal(
  harvestableWildStock({ kind: 'fish', remaining: 30, maxYield: 120 }, 25),
  0,
);

for (const mapSize of ['small', 'medium', 'large'] as const) {
  for (const hydrology of [0, 50, 100]) {
    const variantLayout = createWorldLayout({
      ...DEFAULT_WORLD_GENERATION_SETTINGS,
      seed: 0x71a2e0d ^ hydrology ^ mapSize.length,
      mapSize,
      topography: 50,
      hydrology,
      forestDensity: 50,
      resourceAbundance: 100,
      resourceVariety: 100,
    });
    const variantFish = WorldLayoutRegistry.fromWorldLayout(variantLayout)
      .definitionList
      .filter((node) => node.kind === 'fish');
    assert.equal(variantFish.length, variantLayout.resourcePlan.foragingNodeCounts.fish);
    assert.ok(variantFish.length > 0, 'complete regions should retain a fishery at every map size');
    for (const shoal of variantFish) {
      assert.ok(variantLayout.riverLayout.isWaterAt(shoal.x, shoal.z));
      assert.ok(
        findDryCampSite(shoal.x, shoal.z, variantLayout.riverLayout),
        `${mapSize}/${hydrology} ${shoal.id} should have a reachable dry shoreline`,
      );
    }
  }
}

for (const variation of [0x1, 0x52a91, 0xfffff]) {
  const delniceLayout = createWorldLayout(applyTerrainPreset({
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    seed: variation,
    mapSize: 'medium',
    resourceAbundance: 100,
    resourceVariety: 100,
  }, 'delnice_meadow'));
  const delniceFish = WorldLayoutRegistry.fromWorldLayout(delniceLayout)
    .definitionList
    .filter((node) => node.kind === 'fish');
  assert.ok(delniceLayout.resourcePlan.foragingNodeCounts.fish >= 1);
  assert.equal(delniceFish.length, delniceLayout.resourcePlan.foragingNodeCounts.fish);
  assert.ok(
    delniceFish.every((shoal) =>
      delniceLayout.riverLayout.isInlandWaterAt(shoal.x, shoal.z)
    ),
    'Delnice fish must live in its inland pond rather than an absent river',
  );
  assert.ok(
    delniceFish.every((shoal) =>
      findDryCampSite(shoal.x, shoal.z, delniceLayout.riverLayout)
    ),
    'Delnice pond fisheries need reachable dry camp sites',
  );
}

for (const variation of [0x1, 0x52a91, 0xfffff]) {
  const vinodolLayout = createWorldLayout(applyTerrainPreset({
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    seed: variation,
    mapSize: 'medium',
    resourceAbundance: 100,
    resourceVariety: 100,
  }, 'vinodol_coast'));
  const vinodolFish = WorldLayoutRegistry.fromWorldLayout(vinodolLayout)
    .definitionList
    .filter((node) => node.kind === 'fish');
  assert.equal(vinodolFish.length, vinodolLayout.resourcePlan.foragingNodeCounts.fish);
  assert.ok(vinodolFish.length > 0, 'Vinodol should use its Adriatic frontage for fish');
  for (const shoal of vinodolFish) {
    assert.ok(
      vinodolLayout.riverLayout.isWaterAt(shoal.x, shoal.z),
      `${shoal.id} must be in Vinodol's actual sea mask`,
    );
    assert.ok(
      findDryCampSite(shoal.x, shoal.z, vinodolLayout.riverLayout),
      `${shoal.id} needs a reachable dry coastal camp site`,
    );
  }
}

const fishStates: ForagingNodeState[] = fish.map((node) => ({
  nodeId: node.id,
  kind: 'fish',
  resource: 'fish',
  remaining: node.maxYield,
  maxYield: node.maxYield,
  x: node.x,
  z: node.z,
  isRich: node.isRich,
}));

const basePlacementContext = {
  buildings: [] as BuildingState[],
  residences: [] as ResidenceState[],
  burgageZones: [],
  farmFields: [],
  pastures: [],
  quarries: [],
  foragingNodes: fishStates,
  stockpile: { timber: 10_000, stone: 10_000 },
  isWaterAt: (x: number, z: number) => layout.riverLayout.isWaterAt(x, z),
  getNaturalHeightAt: () => 0,
};

for (const shoal of fishStates) {
  const campSite = findDryCampSite(shoal.x, shoal.z, layout.riverLayout);
  assert.ok(campSite, `${shoal.nodeId} should have a dry camp site inside the 64 m work radius`);
  assert.deepEqual(
    validateBuildingPlacement('fishing_camp', campSite.x, campSite.z, basePlacementContext),
    { ok: true },
  );
}

assert.deepEqual(
  validateBuildingPlacement('fishing_camp', 0, 0, {
    ...basePlacementContext,
    foragingNodes: [],
    isWaterAt: () => false,
  }),
  { ok: false, reason: 'no_fish_in_range' },
);

assert.deepEqual(
  validateBuildingPlacement('fishing_camp', 0, 0, {
    ...basePlacementContext,
    foragingNodes: [{
      nodeId: 'test-fish',
      kind: 'fish',
      resource: 'fish',
      remaining: 120,
      maxYield: 120,
      x: 20,
      z: 0,
    }],
    isWaterAt: (x: number) => x > 4,
  }),
  { ok: false, reason: 'water' },
  'the full fishing-camp footprint—not just its center—must remain on land',
);

const camp = {
  id: 'camp-1',
  kind: 'fishing_camp',
  x: 0,
  z: 0,
  food: 12,
  assignedLabor: 1,
  constructionComplete: true,
} as BuildingState;
const residence = { id: 'home-1', x: 20, z: 0 } as ResidenceState;
const market = {
  ...camp,
  id: 'market-1',
  kind: 'marketplace',
  assignedLabor: 0,
} as BuildingState;
const connectedNetwork = {
  getPathfinder: () => ({
    roadPathDistance: () => 20,
  }),
} as RoadNetwork;
assert.equal(
  claimResidencesForFoodSuppliers(connectedNetwork, [camp, market], [residence]).get(residence.id),
  market.id,
  'fishing output must reach a Marketplace food stall before serving homes',
);
assert.equal(
  claimResidencesForFoodSuppliers(
    connectedNetwork,
    [camp],
    [residence],
  ).has(residence.id),
  false,
  'a fishing camp must never bypass granary and Marketplace logistics',
);

assert.ok(FISH_ICON_HTML.includes('map-resource-icon-glyph--fish'));
assert.ok(!FISH_ICON_HTML.includes('<img'), 'resource marker should use the shared atlas-backed glyph treatment');

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
assert.ok(
  existsSync(`${projectRoot}public/assets/ui/build-menu/cards/fishing-camp.webp`),
  'fishing camp build card should exist',
);

assert.equal(displayedFishSchoolCount(0, 120), 0);
assert.equal(displayedFishSchoolCount(120, 120), SMALL_FISH_SCHOOL_VISUAL_CAPACITY);
assert.equal(displayedFishSchoolCount(240, 240, true), RICH_FISH_SCHOOL_VISUAL_CAPACITY);
assert.equal(displayedFishSchoolCount(60, 120), Math.ceil(SMALL_FISH_SCHOOL_VISUAL_CAPACITY / 2));
assert.equal(displayedFishSchoolCount(0.01, 120), 1);

const breachStart = sampleFishBreach(0, 0.9);
const breachQuarter = sampleFishBreach(0.25, 0.9);
const breachApex = sampleFishBreach(0.5, 0.9);
const breachEnd = sampleFishBreach(1, 0.9);
assert.equal(breachStart.heightOffset, 0);
assert.ok(breachQuarter.heightOffset > 0 && breachQuarter.pitch < 0);
assert.ok(Math.abs(breachApex.heightOffset - 0.9) < 1e-9);
assert.ok(Math.abs(breachEnd.heightOffset) < 1e-9);

const fishModelBytes = readFileSync(
  `${projectRoot}public/assets/models/fish/quaternius-fish.glb`,
);
assert.ok(fishModelBytes.byteLength > 100_000, 'the local fish GLB should not be a placeholder');
const fishModelBuffer = fishModelBytes.buffer.slice(
  fishModelBytes.byteOffset,
  fishModelBytes.byteOffset + fishModelBytes.byteLength,
) as ArrayBuffer;
const fishGltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
  new GLTFLoader().parse(fishModelBuffer, '', resolve, reject);
});
const fishClipNames = new Set(fishGltf.animations.map((clip) => clip.name));
for (const suffix of ['Swimming_Normal', 'Swimming_Fast', 'Out_Of_Water']) {
  assert.ok(
    [...fishClipNames].some((name) => name.endsWith(suffix)),
    `the fish GLB should contain its ${suffix} animation`,
  );
}
let sourceFishMesh: THREE.SkinnedMesh | null = null;
fishGltf.scene.traverse((object) => {
  const skinnedMesh = object as THREE.SkinnedMesh;
  if (!sourceFishMesh && skinnedMesh.isSkinnedMesh) sourceFishMesh = skinnedMesh;
});
assert.ok(sourceFishMesh, 'the fish GLB should contain a skinned mesh');
assert.ok(sourceFishMesh.skeleton.bones.length >= 6, 'the fish GLB should retain its articulated rig');
const clonedFish = cloneSkinned(fishGltf.scene);
let clonedFishMesh: THREE.SkinnedMesh | null = null;
clonedFish.traverse((object) => {
  const skinnedMesh = object as THREE.SkinnedMesh;
  if (!clonedFishMesh && skinnedMesh.isSkinnedMesh) clonedFishMesh = skinnedMesh;
});
assert.ok(clonedFishMesh, 'runtime fish clones should remain skinned');
assert.notEqual(
  clonedFishMesh.skeleton,
  sourceFishMesh.skeleton,
  'each visible fish should have an independent skeleton',
);

const sceneManagerSource = readFileSync(`${projectRoot}src/scene/SceneManager.ts`, 'utf8');
assert.match(sceneManagerSource, /createFishWildlifeVisuals/);
assert.match(sceneManagerSource, /fishWildlifeVisuals\?\.sync/);
assert.match(sceneManagerSource, /fishWildlifeVisuals\?\.update/);

const serverFoodSupplier = readFileSync(
  `${projectRoot}server/src/simulation/food_supplier.rs`,
  'utf8',
);
assert.match(
  serverFoodSupplier,
  /&\["fish"\],\s*FISH_PER_HARVEST,\s*1\.0/s,
  'the authoritative fishing step must use the finite fish-population branch',
);
assert.match(
  serverFoodSupplier,
  /requested\.min\(available\)\.min\(max_resource_for_room\)/,
  'each catch must be capped by stock above the protected reserve',
);

const foragingPolicy = readFileSync(
  `${projectRoot}server/src/foraging_policy.rs`,
  'utf8',
);
assert.match(foragingPolicy, /"fish"\s+if\s+is_spring\(month\)\s+&&\s+remaining\s*>\s*0\.0/);
assert.match(
  foragingPolicy,
  /population_growth_per_second\("fish",\s*0\.0,\s*120\.0,\s*4\),\s*0\.0/,
  'an extinct fish population must not reproduce',
);

console.log('fishing system tests passed');

function findDryCampSite(
  shoalX: number,
  shoalZ: number,
  river: { isWaterAt: (x: number, z: number) => boolean },
): { x: number; z: number } | null {
  const workRadius = BUILDING_DEFINITIONS.fishing_camp.workRadius;
  for (let radius = 8; radius <= workRadius; radius += 2) {
    const samples = Math.max(48, Math.ceil(Math.PI * 2 * radius / 2));
    for (let index = 0; index < samples; index++) {
      const angle = index * Math.PI * 2 / samples;
      const x = shoalX + Math.cos(angle) * radius;
      const z = shoalZ + Math.sin(angle) * radius;
      if (
        sampleBuildingFootprintPoints('fishing_camp', x, z)
          .every((point) => !river.isWaterAt(point.x, point.z))
      ) {
        return { x, z };
      }
    }
  }
  return null;
}
