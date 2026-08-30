import assert from 'node:assert/strict';
import type {
  BuildingState,
  FarmFieldState,
  PastureState,
} from '../src/resources/types.ts';
import { DEFAULT_WORLD_GENERATION_SETTINGS } from '../src/world/worldGenerationSettings.ts';
import { computeLandUseProfile } from '../src/regions/landUseProfile.ts';
import { buildingLandUseAffinities } from '../src/regions/buildingLandUseAffinity.ts';
import { withBuildingLandUseAffinities } from '../src/resources/inspector/buildingLandUseAffinityRenderer.ts';
import {
  rasterizeSubregions,
  rasterizeSubregionsWithStats,
} from '../src/regions/SubregionOverlay.ts';
import {
  SUBREGION_DEFINITIONS,
  WOODLAND_FOREST_BLEND_MIN,
  naturalSubregionFromForestBlend,
} from '../src/regions/subregionField.ts';

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

assert.equal(naturalSubregionFromForestBlend(0), 'meadow');
assert.equal(
  naturalSubregionFromForestBlend(WOODLAND_FOREST_BLEND_MIN - Number.EPSILON),
  'meadow',
);
assert.equal(
  naturalSubregionFromForestBlend(WOODLAND_FOREST_BLEND_MIN),
  'woodland',
);
assert.equal(naturalSubregionFromForestBlend(1), 'woodland');

const naturalAlignment = rasterizeSubregionsWithStats({
  resolution: 101,
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
  realmBounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
  sampleForestBlend: (x) => x < 0 ? 0.9 : 0.1,
  state: {
    buildings: [], residences: [], farmFields: [], pastures: [], vineyardParcels: [],
  },
});
const meadowColor = SUBREGION_DEFINITIONS.find((entry) => entry.kind === 'meadow')!.rgb;
const woodlandColor = SUBREGION_DEFINITIONS.find((entry) => entry.kind === 'woodland')!.rgb;
assert.deepEqual(
  [...naturalAlignment.data.subarray((100 * 101) * 4, (100 * 101) * 4 + 3)],
  [...woodlandColor],
  'forest-dominant terrain must rasterize as Woodland',
);
assert.deepEqual(
  [...naturalAlignment.data.subarray((100 * 101 + 100) * 4, (100 * 101 + 100) * 4 + 3)],
  [...meadowColor],
  'open terrain must rasterize as Meadow',
);
assert.equal(
  Object.values(naturalAlignment.realmCounts).reduce((sum, count) => sum + count, 0),
  51 * 51,
  'legend shares must count only samples inside the realm bounds',
);
assert.ok(naturalAlignment.realmCounts.woodland > 0);
assert.ok(naturalAlignment.realmCounts.meadow > 0);
const naturalRealmCount = naturalAlignment.realmCounts.woodland
  + naturalAlignment.realmCounts.meadow;
assert.ok(
  Math.abs(naturalAlignment.realmCounts.woodland / naturalRealmCount - empty.shares.woodland) < 0.001,
  'the spatial woodland quota must match the authoritative global woodland share',
);

const pastoralEffects = buildingLandUseAffinities('pastoral_farmstead', empty);
assert.deepEqual(
  pastoralEffects.map((entry) => entry.kind),
  ['meadow', 'rural'],
  'pastoral holdings should receive global meadow grazing and rural husbandry benefits',
);
const swineEffects = buildingLandUseAffinities('swineherd', empty);
assert.deepEqual(
  swineEffects.map((entry) => entry.kind),
  ['woodland', 'rural'],
  'swineherds should receive global woodland mast and rural husbandry benefits',
);
assert.ok(swineEffects[0]!.bonus > 0);
assert.equal(buildingLandUseAffinities('fishing_camp', empty).length, 0);
assert.equal(buildingLandUseAffinities('lumber_mill', empty)[0]?.kind, 'woodland');
assert.equal(buildingLandUseAffinities('weaponsmith_armorer', industrial)[0]?.kind, 'urban');
const swineAffinityView = withBuildingLandUseAffinities(
  {
    eyebrow: 'Building',
    title: 'Swineherd',
    statusText: '',
    statusState: 'positive',
    detailsHtml: '',
    demolish: { visible: false, hint: '' },
    labor: {
      visible: false,
      count: 0,
      hint: '',
      decreaseDisabled: true,
      increaseDisabled: true,
    },
  },
  { kind: 'swineherd' } as BuildingState,
  empty,
);
assert.match(swineAffinityView.detailsHtml, /data-land-use-kind="woodland"/);
assert.match(swineAffinityView.detailsHtml, /data-tooltip-title="Mast and pannage/);
assert.match(swineAffinityView.detailsHtml, /Placement inside the colored zone is not required/);
assert.match(swineAffinityView.detailsHtml, /tabindex="0"/);

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
  sampleForestBlend: (x, z) => x + z < 0 ? 0.85 : 0.15,
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
