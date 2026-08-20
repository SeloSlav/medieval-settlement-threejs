import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const balance = JSON.parse(read('balance/gameBalance.json')) as {
  production: {
    potterClayPerCycle: number;
    potterFirewoodPerCycle: number;
    potterWaterPerCycle: number;
    potterRoofTilesPerCycle: number;
  };
  buildings: Record<string, { cost: { roofTiles?: number } }>;
};

const expectedRoofTileCosts = {
  monastery: 72,
} as const;

const actualTiledKinds = Object.entries(balance.buildings)
  .filter(([, definition]) => (definition.cost.roofTiles ?? 0) > 0)
  .map(([kind]) => kind)
  .sort();
assert.deepEqual(
  actualTiledKinds,
  Object.keys(expectedRoofTileCosts).sort(),
  'only the elite Monastery building card should consume roof tiles at placement',
);
for (const [kind, expected] of Object.entries(expectedRoofTileCosts)) {
  const actual = balance.buildings[kind]?.cost.roofTiles;
  assert.equal(actual, expected, `${kind} must pay for its elite fired-clay roof`);
  assert.equal(
    expected % balance.production.potterRoofTilesPerCycle,
    0,
    `${kind} must consume a whole number of kiln batches`,
  );
}

assert.ok(balance.production.potterClayPerCycle > 0, 'roof-tile firing must consume clay');
assert.ok(balance.production.potterFirewoodPerCycle > 0, 'roof-tile firing must consume fuel');
assert.ok(balance.production.potterWaterPerCycle > 0, 'roof-tile firing must consume puddling water');
assert.ok(balance.production.potterRoofTilesPerCycle > 0, 'the kiln must output physical roof tiles');

const serverBalance = read('server/src/balance_generated.rs');
assert.match(serverBalance, /pub cost_roof_tiles: f64/);
assert.match(serverBalance, /cost_roof_tiles: 72\.0/);

const buildingSchema = read('server/src/tables.rs');
for (const field of [
  'construction_required_roof_tiles',
  'construction_delivered_roof_tiles',
  'construction_reserved_roof_tiles',
  'construction_treasury_roof_tiles',
]) {
  assert.match(buildingSchema, new RegExp(`pub ${field}: f64`));
}

const construction = read('server/src/simulation/construction.rs');
assert.match(construction, /dispatch_reserved_stock[\s\S]*CommodityKind::RoofTiles/);
assert.match(construction, /construction_delivered_roof_tiles/);
assert.match(construction, /roof_tiles_ready/);

const deliveryTrips = read('server/src/simulation/delivery_trips.rs');
assert.match(
  deliveryTrips,
  /CommodityKind::RoofTiles[\s\S]*construction_reserved_roof_tiles/,
  'roof tiles must be reserved and physically hauled to building sites',
);
assert.match(
  deliveryTrips,
  /construction_required_roof_tiles[\s\S]*construction_delivered_roof_tiles/,
  'roof-tile carts must unload into construction progress',
);

const reducers = read('server/src/reducers/buildings.rs');
assert.match(reducers, /total_roof_tiles[\s\S]*cost\.roof_tiles/);
assert.match(reducers, /construction_required_roof_tiles: cost\.roof_tiles/);
assert.match(reducers, /refund\.roof_tiles/);

const clientBindings = read('src/generated/building_table.ts');
assert.match(clientBindings, /constructionRequiredRoofTiles/);
assert.match(clientBindings, /constructionDeliveredRoofTiles/);
const clientEconomy = read('src/resources/buildingEconomy.ts');
assert.match(clientEconomy, /totals\.roofTiles >= \(cost\.roofTiles \?\? 0\)/);
assert.match(clientEconomy, /roof tiles/);
const inspector = read('src/resources/inspector/constructionRenderer.ts');
assert.match(inspector, /Fired roof tiles delivered/);
const siteMesh = read('src/buildings/ConstructionSiteMesh.ts');
assert.match(siteMesh, /Construction roof tile stack/);

const expandedMeshes = read('src/buildings/meshes/expandedBuildingMeshes.ts');
assert.match(
  expandedMeshes,
  /createThreshingBarnMesh[\s\S]*roofMaterial: shingleMaterial\(\)/,
  'the ordinary threshing barn must use a shingle roof',
);
assert.match(
  expandedMeshes,
  /createMonasteryMesh[\s\S]*roofMaterial: tileMaterial\(0\)/,
  'the Monastery must retain its elite fired-clay roof',
);
assert.match(
  expandedMeshes,
  /createCarpenterMesh[\s\S]*roofMaterial: shingleMaterial\(\)/,
  'the ordinary carpenter must use a shingle roof',
);
const chapelMesh = read('src/buildings/meshes/chapelMesh.ts');
assert.match(chapelMesh, /stoneTier[\s\S]*sharedBuildingMaterial\('clayRed'\)[\s\S]*sharedBuildingMaterial\('shingle'\)/);
assert.match(chapelMesh, /createLargeStoneChurchMesh[\s\S]*sharedBuildingMaterial\('clayRed'\)/);

const chapelUpgrades = read('server/src/chapel_upgrade_policy.rs');
assert.match(chapelUpgrades, /CHAPEL_TIER2_UPGRADE_ROOF_TILES/);
assert.match(chapelUpgrades, /CHAPEL_TIER3_UPGRADE_ROOF_TILES/);
const residenceReducer = read('server/src/reducers/residences.rs');
assert.match(
  residenceReducer,
  /if residence\.tier < 3[\s\S]*Only a prosperous tier-3 house can support a fired-tile roof/,
  'roof-tile residence retrofits must remain exclusive to tier-3 houses',
);

console.log('Roof-tile construction tests passed.');
