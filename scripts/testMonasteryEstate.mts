import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  MONASTERY_ESTATE_DEPTH,
  MONASTERY_ESTATE_WIDTH,
  monasteryEstateFitsMap,
  monasteryEstateFootprintCorners,
  monasteryEstateIsNearMapEdge,
  monasteryEstateNextInvestmentCost,
  monasteryEstateYields,
  monasteryInfirmaryBeds,
  monasteryInfirmaryMortalityMultiplier,
  monasteryInfirmaryRecoveryMultiplier,
  monasteryScriptoriumRecoveryMultiplier,
  monasterySeedArchiveTargetPerCrop,
} from '../src/buildings/monasteryEstate.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { fireRecoveryCost } from '../src/fires/fireRecovery.ts';
import { BUILDING_DEFINITIONS } from '../src/generated/gameBalance.ts';
import type { BuildingState } from '../src/resources/types.ts';
import {
  collectWorkerTargets,
  pickWorkerWalkPlan,
  PRODUCTION_WORKPLACE_KINDS,
} from '../src/settlement/workerPaths.ts';

assert.equal(MONASTERY_ESTATE_WIDTH, 68);
assert.equal(MONASTERY_ESTATE_DEPTH, 53);
assert.deepEqual(monasteryEstateFootprintCorners(0, 0, 0), [
  { x: -34, z: -45.5 },
  { x: 34, z: -45.5 },
  { x: 34, z: 7.5 },
  { x: -34, z: 7.5 },
]);

const smallBounds = { minX: -408.5, maxX: 408.5, minZ: -408.5, maxZ: 408.5 };
assert.equal(monasteryEstateFitsMap(0, 350, 0, smallBounds), true);
assert.equal(monasteryEstateIsNearMapEdge(0, 350, 0, smallBounds), true);
assert.equal(monasteryEstateIsNearMapEdge(0, 0, 0, smallBounds), false);
assert.equal(monasteryEstateFitsMap(0, 405, 0, smallBounds), false);

assert.equal(monasteryEstateNextInvestmentCost(0), 18);
assert.equal(monasteryEstateNextInvestmentCost(1), 42);
assert.equal(monasteryEstateNextInvestmentCost(2), 78);
assert.equal(monasteryEstateNextInvestmentCost(3), null);
assert.ok(monasteryEstateYields(3).apples > monasteryEstateYields(0).apples);
assert.equal(monasteryEstateYields(0).cheese, 0);
assert.ok(monasteryEstateYields(1).cheese > 0);
assert.equal(monasteryEstateYields(0).wine, 0);
assert.ok(monasteryEstateYields(0, 1, 0).wine > 0);
assert.equal(monasteryEstateYields(2, 0, 1).cider, 0);
assert.ok(monasteryEstateYields(3, 0, 1).cider > 0);
assert.ok(monasteryEstateYields(0, 0, 1).ale > 0);
assert.equal(monasteryEstateYields(0, 0, 0).ale, 0);
assert.equal(monasteryInfirmaryBeds(0), 4);
assert.equal(monasteryInfirmaryBeds(3), 10);
assert.ok(monasteryInfirmaryRecoveryMultiplier(3) > monasteryInfirmaryRecoveryMultiplier(0));
assert.ok(monasteryInfirmaryMortalityMultiplier(3) < monasteryInfirmaryMortalityMultiplier(0));
assert.equal(monasterySeedArchiveTargetPerCrop(0), 8);
assert.equal(monasterySeedArchiveTargetPerCrop(3), 20);
assert.ok(monasteryScriptoriumRecoveryMultiplier(3) < monasteryScriptoriumRecoveryMultiplier(0));
assert.deepEqual(
  fireRecoveryCost(
    { timber: 100, stone: 50, ironwork: 10, roofTiles: 20 },
    1,
    true,
    false,
    0.8,
  ),
  { timber: 56, stone: 28, ironwork: 5.6, roofTiles: 11.2 },
);

for (const level of [0, 1, 2, 3] as const) {
  const mesh = createBuildingMesh('monastery', level);
  const estate = mesh.getObjectByName(`Monastery enclosed estate level ${level}`);
  assert.ok(estate instanceof THREE.Group, `estate level ${level} must be rendered`);
  assert.ok(mesh.getObjectByName('Monastery precinct rear wall'));
  assert.ok(mesh.getObjectByName('Monastery east gatehouse'));
  assert.ok(mesh.getObjectByName('Monastery northwest round tower'));
  assert.ok(mesh.getObjectByName('Monastery protected cattle pasture'));
  assert.ok(mesh.getObjectByName('Monastery reserved dairy upgrade plot'));
  assert.ok(mesh.getObjectByName('Monastery reserved fruit press upgrade plot'));
  assert.ok(mesh.getObjectByName('Monastery enclosed cloister court'));
  assert.ok(mesh.getObjectByName('Monastery front cloister arcade'));
  assert.ok(mesh.getObjectByName('Monastery brewhouse and cellar yard'));
  assert.ok(mesh.getObjectByName('Monastery apple orchard'));
  assert.ok(mesh.getObjectByName('Monastery bee garden'));
  assert.ok(mesh.getObjectByName('Monastery chicken yard'));
  assert.ok(mesh.getObjectByName('Monastery infirmary wing'));
  assert.ok(mesh.getObjectByName('Monastery scriptorium and records wing'));
  assert.ok(mesh.getObjectByName('Scriptorium duplicate records chest'));
  assert.ok(mesh.getObjectByName('Monastery agricultural archive and seed vault'));
  assert.ok(mesh.getObjectByName('Rye emergency seed chest'));
  const architecturePlan = estate.userData.architecturePlan as {
    typology?: string;
    gatehouse?: { centerX?: number };
    reservedUpgradeZoneIds?: string[];
    diagnostics?: {
      pastureArea?: number;
      wallRunCount?: number;
      towerCount?: number;
      outOfBoundsZoneIds?: string[];
      overlappingZonePairs?: string[];
      triangleCount?: number;
      meshCount?: number;
    };
  };
  assert.equal(architecturePlan.typology, 'fortified-rural-monastery');
  assert.ok((architecturePlan.gatehouse?.centerX ?? 0) > 10, 'gatehouse should be offset from the cloister axis');
  assert.deepEqual(architecturePlan.reservedUpgradeZoneIds, ['dairy-upgrade', 'apple-press-upgrade']);
  assert.ok((architecturePlan.diagnostics?.pastureArea ?? 0) >= 350);
  assert.equal(architecturePlan.diagnostics?.wallRunCount, 5);
  assert.equal(architecturePlan.diagnostics?.towerCount, 4);
  assert.deepEqual(architecturePlan.diagnostics?.outOfBoundsZoneIds, []);
  assert.deepEqual(architecturePlan.diagnostics?.overlappingZonePairs, []);
  assert.ok((architecturePlan.diagnostics?.triangleCount ?? 0) > 0);
  assert.ok((architecturePlan.diagnostics?.meshCount ?? 0) > 0);
}
assert.ok(createBuildingMesh('monastery', 1).getObjectByName('Monastery invested dairy'));
assert.ok(createBuildingMesh('monastery', 3).getObjectByName('Monastery invested cider press'));
const wineAndAleEstate = createBuildingMesh('monastery', 3, { orchard: 1, croft: 1 });
assert.ok(wineAndAleEstate.getObjectByName('Monastery grapevine parcel'));
assert.ok(wineAndAleEstate.getObjectByName('Monastery brewing barley croft'));
assert.ok(wineAndAleEstate.getObjectByName('Monastery invested wine press'));
assert.equal(wineAndAleEstate.getObjectByName('Monastery apple orchard'), undefined);

const serverPolicy = readFileSync(new URL('../server/src/monastery_estate_policy.rs', import.meta.url), 'utf8');
assert.match(serverPolicy, /MONASTERY_ESTATE_HALF_WIDTH: f64 = 34\.0/);
assert.match(serverPolicy, /INVESTMENT_COSTS: \[f64; 3\] = \[18\.0, 42\.0, 78\.0\]/);
assert.match(serverPolicy, /MONASTERY_ESTATE_EXPORT_LOT: f64 = 6\.0/);
assert.match(serverPolicy, /INFIRMARY_BEDS: \[u32; 4\] = \[4, 6, 8, 10\]/);
assert.match(serverPolicy, /SEED_ARCHIVE_TARGET_PER_CROP: \[f64; 4\] = \[8\.0, 12\.0, 16\.0, 20\.0\]/);
assert.match(serverPolicy, /SCRIPTORIUM_RECOVERY_MULTIPLIERS: \[f64; 4\] = \[0\.90, 0\.84, 0\.78, 0\.72\]/);
assert.match(serverPolicy, /MONASTERY_ORCHARD_APPLES: u8 = 0/);
assert.match(serverPolicy, /MONASTERY_CROFT_BARLEY: u8 = 1/);
assert.match(serverPolicy, /pub cider: f64/);

const serverBuildings = readFileSync(new URL('../server/src/reducers/buildings.rs', import.meta.url), 'utf8');
assert.match(
  serverBuildings,
  /if kind == "monastery"[\s\S]*?\.any\(\|building\| building\.kind == "monastery"\)[\s\S]*?Only one monastery may belong to a settlement/,
);

assert.equal(BUILDING_DEFINITIONS.monastery.acceptsLabor, true);
assert.equal(BUILDING_DEFINITIONS.monastery.maxLabor, 8);
assert.equal(PRODUCTION_WORKPLACE_KINDS.includes('monastery'), true);

const staffedEstate = {
  id: 'staffed-monastery',
  kind: 'monastery',
  x: 0,
  z: 0,
  workRadius: 0,
  actionCooldown: 0,
  timber: 0,
  firewood: 0,
  stone: 0,
  water: 0,
  food: 0,
  ale: 0,
  preservedFood: 0,
  honey: 0,
  wine: 0,
  gold: 0,
  waterCapacity: 0,
  assignedLabor: 8,
  constructionComplete: true,
} as BuildingState;
const estateWorkTargets = collectWorkerTargets(staffedEstate, {
  quarries: [],
  foragingNodes: [],
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
});
for (const station of ['orchard', 'croft', 'pasture', 'infirmary', 'outer-gate']) {
  assert.ok(
    estateWorkTargets.some((target) => target.id.endsWith(`:${station}`)),
    `assigned monks need a visible ${station} duty target`,
  );
}
const outsidePlan = Array.from({ length: 512 }, (_, seed) =>
  pickWorkerWalkPlan(staffedEstate, 0, estateWorkTargets, seed)
).find((plan) => plan?.target?.id.endsWith(':outer-gate'));
assert.ok(
  outsidePlan?.path.some((point) => Math.hypot(point.x, point.z) > 15),
  'the porter or almoner should sometimes walk beyond the monastery wall',
);

const workerPaths = readFileSync(new URL('../src/settlement/workerPaths.ts', import.meta.url), 'utf8');
assert.match(workerPaths, /'monastery',[\s\S]*?PRODUCTION_WORKPLACE_KINDS/);
assert.match(workerPaths, /outer-gate[\s\S]*?localZ: 14\.5/);

const simulation = readFileSync(new URL('../server/src/simulation/expanded_economy.rs', import.meta.url), 'utf8');
assert.match(simulation, /let onsite_labor = onsite_building_labor\(ctx, &building\);[\s\S]*?if onsite_labor == 0[\s\S]*?return;/);
assert.match(simulation, /productive_labor[\s\S]*?definition\.max_labor[\s\S]*?amount \* productivity \* staffing/);
assert.match(simulation, /fn reinvest_monastery_estate/);
assert.match(simulation, /fn dispatch_monastery_estate_export/);
assert.match(simulation, /CommodityKind::Apples, yields\.apples/);
assert.match(simulation, /CommodityKind::Wine, yields\.wine/);
assert.match(simulation, /CommodityKind::Cider, yields\.cider/);
assert.match(simulation, /CommodityKind::Milk, food_exportable/);
assert.match(simulation, /CommodityKind::Wine,[\s\S]*monastery_estate_exportable\(monastery\.wine, wine_floor\)/);
assert.match(simulation, /CommodityKind::Cider,[\s\S]*monastery_estate_exportable\(monastery\.cider, 3\.0\)/);
assert.match(simulation, /monastery_infirmary_beds[\s\S]*MONASTERY_INFIRMARY_FOOD_PER_BED_DAY/);
assert.match(simulation, /start_regional_market_export_trip/);
assert.match(simulation, /fn request_monastery_seed_archive/);
assert.match(simulation, /"granary" \| "trading_post" \| "monastery"/);

const fireRecovery = readFileSync(new URL('../server/src/reducers/fire_recovery.rs', import.meta.url), 'utf8');
assert.match(fireRecovery, /fn operational_scriptorium_recovery_multiplier/);
assert.match(fireRecovery, /MONASTERY_COVERAGE_RADIUS/);

const healthSimulation = readFileSync(new URL('../server/src/simulation/residence_needs/mod.rs', import.meta.url), 'utf8');
assert.match(healthSimulation, /fund_monastery_infirmary_care/);
assert.match(healthSimulation, /infirmary_recovery_multiplier/);

const deliveryTrips = readFileSync(new URL('../server/src/simulation/delivery_trips.rs', import.meta.url), 'utf8');
assert.match(deliveryTrips, /credit_monastery_export_receipt/);

const marketplaceTrade = readFileSync(new URL('../server/src/economy/marketplace_trade.rs', import.meta.url), 'utf8');
assert.match(
  marketplaceTrade,
  /CommodityKind::Apples[\s\S]*CommodityKind::Vegetables[\s\S]*CommodityKind::Eggs[\s\S]*CommodityKind::Milk[\s\S]*CommodityKind::Meat/,
);
assert.match(marketplaceTrade, /marketplace_trade_offer_for_resource/);
assert.match(marketplaceTrade, /price_multiplier_for/);
assert.match(marketplaceTrade, /record_market_trade[\s\S]*MarketTradeDirection::Export/);

const resourceTotals = readFileSync(new URL('../src/resources/resourceTotals.ts', import.meta.url), 'utf8');
assert.match(resourceTotals, /building\.kind === 'monastery'[\s\S]*reservedHoney[\s\S]*reservedCheese/);

console.log('monastery estate tests passed');
