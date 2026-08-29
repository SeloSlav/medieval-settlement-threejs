import assert from 'node:assert/strict';
import type {
  BuildingState,
  FarmFieldState,
  PastureState,
} from '../src/resources/types.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../src/world/worldGenerationSettings.ts';
import { computeLandUseProfile } from '../src/regions/landUseProfile.ts';
import { rasterizeSubregions } from '../src/regions/SubregionOverlay.ts';
import { SUBREGION_DEFINITIONS } from '../src/regions/subregionField.ts';

const settings = { ...DEFAULT_WORLD_GENERATION_SETTINGS, mapSize: 'medium' as const };
const empty = computeLandUseProfile(settings, {
  buildings: [], residences: [], farmFields: [], pastures: [], vineyardParcels: [],
});
assert.ok(Math.abs(sumShares(empty) - 1) < 1e-12);
assert.equal(empty.shares.farmland, 0);
assert.equal(empty.shares.rural, 0);
assert.equal(empty.shares.urban, 0);
assert.ok(empty.shares.meadow > empty.shares.woodland);

const industrialBuildings = Array.from({ length: 300 }, (_, index) => ({
  id: `smithy-${index}`,
  kind: 'smithy',
  x: 0,
  z: 0,
  constructionComplete: true,
})) as unknown as BuildingState[];
const industrial = computeLandUseProfile(settings, {
  buildings: industrialBuildings,
  residences: [],
  farmFields: [],
  pastures: [],
  vineyardParcels: [],
});
assert.ok(Math.abs(sumShares(industrial) - 1) < 1e-12);
assert.ok(industrial.shares.urban > empty.shares.urban);
assert.ok(industrial.shares.meadow < empty.shares.meadow);
assert.ok(industrial.bonuses.urban > empty.bonuses.urban);
assert.ok(
  industrial.bonuses.meadow < empty.bonuses.meadow,
  'urban and industrial expansion must diminish the global meadow/pollination benefit',
);

const fields = [{ area: empty.totalArea * 0.22 }] as FarmFieldState[];
const agrarian = computeLandUseProfile(settings, {
  buildings: [], residences: [], farmFields: fields, pastures: [], vineyardParcels: [],
});
assert.ok(Math.abs(sumShares(agrarian) - 1) < 1e-12);
assert.ok(agrarian.shares.farmland >= 0.219);
assert.ok(agrarian.bonuses.farmland > empty.bonuses.farmland);
assert.ok(agrarian.bonuses.meadow < empty.bonuses.meadow);

const rasterField = {
  area: 8_000,
  corners: [
    { x: -95, z: -95 },
    { x: -8, z: -95 },
    { x: -8, z: 95 },
    { x: -95, z: 95 },
  ],
} as FarmFieldState;
const rasterPasture = {
  area: 8_000,
  corners: [
    { x: 8, z: -95 },
    { x: 95, z: -95 },
    { x: 95, z: 95 },
    { x: 8, z: 95 },
  ],
} as PastureState;
const rasterUrban = {
  id: 'urban-workshop',
  kind: 'smithy',
  x: 0,
  z: 0,
  constructionComplete: true,
} as unknown as BuildingState;
const raster = rasterizeSubregions({
  resolution: 101,
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
  worldSeed: settings.seed,
  forestDensity: settings.forestDensity,
  state: {
    buildings: [rasterUrban],
    residences: [],
    farmFields: [rasterField],
    pastures: [rasterPasture],
    vineyardParcels: [],
  },
});
const presentColors = new Set<string>();
for (let index = 0; index < raster.length; index += 4) {
  presentColors.add(`${raster[index]},${raster[index + 1]},${raster[index + 2]}`);
}
for (const kind of ['farmland', 'rural', 'urban'] as const) {
  const definition = SUBREGION_DEFINITIONS.find((entry) => entry.kind === kind)!;
  assert.ok(
    presentColors.has(definition.rgb.join(',')),
    `the combined overlay must render ${definition.label} in its distinct color`,
  );
}

console.log('global subregion land-use tests passed');

function sumShares(profile: ReturnType<typeof computeLandUseProfile>): number {
  return Object.values(profile.shares).reduce((sum, share) => sum + share, 0);
}
