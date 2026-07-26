import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getBuildingSiteClearanceSearchRadius } from '../src/buildings/BuildingTerrainLayout.ts';
import { PlacementClearanceSpatialIndex } from '../src/placement/PlacementClearanceSpatialIndex.ts';
import { QuarryLayout, quarrySiteOverlapsRiver } from '../src/quarries/QuarryLayout.ts';
import { burgageZoneTouchesWater } from '../src/residences/burgagePlacementValidation.ts';
import { RiverLayout } from '../src/rivers/RiverLayout.ts';
import {
  deriveSubSeed,
  hydrologyRiverCount,
  hydrologyTributaryCount,
  MAP_SIZE_PRESETS,
  scaledRiverDrain,
} from '../src/world/worldGenerationSettings.ts';

function testClearanceSpatialIndexKeepsNearbyCandidates(): void {
  const stonecutter = { kind: 'stone_quarry' as const, x: 47, z: -47 };
  const burgage = [
    { x: -72, z: -12 },
    { x: 72, z: -12 },
    { x: 72, z: 12 },
    { x: -72, z: 12 },
  ];
  const field = [
    { x: 90, z: 90 },
    { x: 160, z: 90 },
    { x: 160, z: 140 },
    { x: 90, z: 140 },
  ];
  const index = new PlacementClearanceSpatialIndex([stonecutter], [burgage], [field]);

  assert(index.buildingsNear(20, -47, 5).includes(stonecutter));
  assert(index.burgageParcelsNear(0, 13, 2).includes(burgage));
  assert(index.farmFieldsNear(88, 100, 3).includes(field));
  assert(index.someBuildingNear(20, -47, 5, (candidate) => candidate === stonecutter));
  assert(index.someBurgageParcelNear(0, 13, 2, (candidate) => candidate === burgage));
  assert(index.someFarmFieldNear(88, 100, 3, (candidate) => candidate === field));
  assert.equal(index.buildingsNear(
    stonecutter.x + getBuildingSiteClearanceSearchRadius() + 96,
    stonecutter.z,
  ).length, 0);
}

function testQuarryFootprintsAvoidRivers(): void {
  let checkedWorlds = 0;
  for (const [mapSize, dimensions] of Object.entries(MAP_SIZE_PRESETS)) {
    const halfTerrain = dimensions.terrainSize * 0.5;
    const bounds = {
      minX: -halfTerrain,
      maxX: halfTerrain,
      minZ: -halfTerrain,
      maxZ: halfTerrain,
    };
    for (let seed = 1; seed <= 12; seed++) {
      const riverLayout = RiverLayout.create({
        bounds,
        seed: deriveSubSeed(seed, 'river'),
        riverCount: hydrologyRiverCount(100),
        tributaryCount: hydrologyTributaryCount(100),
        drain: scaledRiverDrain(dimensions.playableHalf),
      });
      const quarries = QuarryLayout.create({
        bounds,
        seed,
        riverLayout,
        playableHalf: dimensions.playableHalf,
      });
      assert.equal(
        quarries.sites.length,
        3,
        `${mapSize} seed ${seed} should still produce all quarry sites`,
      );
      for (const site of quarries.sites) {
        assert.equal(
          quarrySiteOverlapsRiver(site, riverLayout),
          false,
          `${mapSize} seed ${seed} placed a ${site.kind} quarry across a river`,
        );
      }
      checkedWorlds++;
    }
  }
  assert.equal(checkedWorlds, 36);
}

function testBurgageWaterValidationSamplesTheWholeZone(): void {
  const zone = {
    a: { x: 0, z: 0 },
    b: { x: 24, z: 0 },
    c: { x: 24, z: 20 },
    d: { x: 0, z: 20 },
  };

  assert.equal(
    burgageZoneTouchesWater(zone, (x, z) => Math.abs(x - 12) <= 0.8 && z >= 4 && z <= 16),
    true,
    'water crossing only the middle of a zone must be detected',
  );
  assert.equal(
    burgageZoneTouchesWater(zone, (x, z) => Math.abs(z - 10) <= 0.8 && x >= 20 && x <= 28),
    true,
    'water crossing a zone edge between dry corners must be detected',
  );
  assert.equal(
    burgageZoneTouchesWater(zone, (x, z) => x >= 25.5 && z >= 4 && z <= 16),
    false,
    'nearby water outside the parcel must not block dry shoreline placement',
  );
}

testClearanceSpatialIndexKeepsNearbyCandidates();
testQuarryFootprintsAvoidRivers();
testBurgageWaterValidationSamplesTheWholeZone();

const buildingReducer = readFileSync('server/src/reducers/buildings.rs', 'utf8');
const placementValidation = readFileSync('server/src/placement_validation.rs', 'utf8');
const residenceReducer = readFileSync('server/src/reducers/residences.rs', 'utf8');
const farmFieldReducer = readFileSync('server/src/reducers/farm_fields.rs', 'utf8');
const livestockReducer = readFileSync('server/src/reducers/livestock.rs', 'utf8');

assert.match(
  buildingReducer,
  /fn overlaps_same_kind_functional_extent\([\s\S]{0,220}owner: spacetimedb::Identity[\s\S]{0,300}building\(\)\.owner\(\)\.filter\(&owner\)/,
  'functional extents from an invisible foreign settlement must not block placement',
);
assert.match(
  buildingReducer,
  /fn is_too_close_to_buildings\([\s\S]{0,220}owner: spacetimedb::Identity[\s\S]{0,300}building\(\)\.owner\(\)\.filter\(&owner\)/,
);
assert.match(
  buildingReducer,
  /farm_field\(\)\.owner\(\)\.filter\(&owner\)\.any/,
);
assert.match(
  buildingReducer,
  /pasture\(\)\.owner\(\)\.filter\(&owner\)\.any/,
);
assert.match(
  placementValidation,
  /building_overlaps_residence_zone\([\s\S]{0,260}burgage_zone\(\)\.owner\(\)\.filter\(&owner\)/,
);
assert.match(
  placementValidation,
  /burgage_zone_overlaps_buildings\([\s\S]{0,260}building\(\)\.owner\(\)\.filter\(&owner\)/,
);
assert.match(
  residenceReducer,
  /burgage_zone\(\)\.owner\(\)\.filter\(&owner\)[\s\S]*burgage_zone_overlaps_buildings\(ctx, owner, &corners\)[\s\S]*farm_field\(\)\.owner\(\)\.filter\(&owner\)/,
);
for (const [label, source] of [
  ['farm fields', farmFieldReducer],
  ['pastures', livestockReducer],
] as const) {
  assert.match(source, /building\(\)\.owner\(\)\.filter\(&owner\)/, `${label} must ignore foreign buildings`);
  assert.match(source, /burgage_zone\(\)\.owner\(\)\.filter\(&owner\)/, `${label} must ignore foreign homes`);
  assert.match(source, /farm_field\(\)\.owner\(\)\.filter\(&owner\)/, `${label} must ignore foreign fields`);
}
assert.match(
  livestockReducer,
  /pasture\(\)\.owner\(\)\.filter\(&owner\)/,
  'pastures must ignore foreign grazing parcels',
);

console.log('Placement regression tests passed.');
