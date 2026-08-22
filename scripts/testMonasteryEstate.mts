import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  MONASTERY_ESTATE_DEPTH,
  MONASTERY_ESTATE_WIDTH,
  MONASTERY_EXTENSION_ALL,
  MONASTERY_EXTENSION_GUESTHOUSE,
  MONASTERY_EXTENSION_INFIRMARY,
  MONASTERY_EXTENSION_SCRIPTORIUM,
  MONASTERY_EXTENSION_WORKSHOP,
  monasteryCroftChoiceAllowed,
  monasteryEstateFitsMap,
  monasteryEstateFootprintCorners,
  monasteryEstateIsNearMapEdge,
  monasteryEstateNextInvestmentCost,
  monasteryEstateYields,
  monasteryInfirmaryBeds,
  monasteryInfirmaryMortalityMultiplier,
  monasteryInfirmaryRecoveryMultiplier,
  monasteryOrchardReplantingAllowed,
  monasteryScriptoriumRecoveryMultiplier,
  monasterySeedArchiveTargetPerCrop,
  monasteryVisualEstateLevel,
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

assert.equal(monasteryEstateNextInvestmentCost(0, MONASTERY_EXTENSION_INFIRMARY), 24);
assert.equal(monasteryEstateNextInvestmentCost(0, MONASTERY_EXTENSION_SCRIPTORIUM), 28);
assert.equal(monasteryEstateNextInvestmentCost(0, MONASTERY_EXTENSION_GUESTHOUSE), 20);
assert.equal(monasteryEstateNextInvestmentCost(0, MONASTERY_EXTENSION_WORKSHOP), 30);
assert.equal(
  monasteryEstateNextInvestmentCost(MONASTERY_EXTENSION_ALL, MONASTERY_EXTENSION_GUESTHOUSE),
  null,
);
assert.ok(
  monasteryEstateYields(MONASTERY_EXTENSION_ALL).apples
    > monasteryEstateYields(0).apples,
);
assert.ok(monasteryEstateYields(0).cheese > 0);
assert.ok(monasteryEstateYields(0).pears > 0);
assert.ok(monasteryEstateYields(0).mead > 0);
assert.equal(monasteryEstateYields(0).wine, 0);
assert.ok(monasteryEstateYields(0, 0, 1).cider > 0);
assert.ok(
  monasteryEstateYields(MONASTERY_EXTENSION_WORKSHOP, 0, 1).cider
    > monasteryEstateYields(0, 0, 1).cider,
);
assert.equal(monasteryEstateYields(0, 0, 0).ale, 0);
assert.ok(
  monasteryEstateYields(MONASTERY_EXTENSION_WORKSHOP).mead
    > monasteryEstateYields(0).mead,
);
assert.equal(monasteryEstateYields(0, 0, 0, 0).apples, 0);
assert.ok(monasteryEstateYields(0, 0, 0, 1).apples > 0);
assert.ok(monasteryEstateYields(0, 0, 0, 1).apples < monasteryEstateYields(0, 0, 0, 2).apples);
assert.equal(monasteryOrchardReplantingAllowed(12), true);
assert.equal(monasteryOrchardReplantingAllowed(6), false);
assert.equal(monasteryCroftChoiceAllowed(2), false);
assert.equal(monasteryCroftChoiceAllowed(3), false);
assert.equal(monasteryInfirmaryBeds(0), 2);
assert.equal(monasteryInfirmaryBeds(MONASTERY_EXTENSION_INFIRMARY), 10);
assert.equal(monasteryInfirmaryBeds(MONASTERY_EXTENSION_INFIRMARY, 0), 2);
assert.ok(monasteryInfirmaryRecoveryMultiplier(MONASTERY_EXTENSION_INFIRMARY) > monasteryInfirmaryRecoveryMultiplier(0));
assert.ok(monasteryInfirmaryMortalityMultiplier(MONASTERY_EXTENSION_INFIRMARY) < monasteryInfirmaryMortalityMultiplier(0));
assert.equal(monasterySeedArchiveTargetPerCrop(0), 8);
assert.equal(monasterySeedArchiveTargetPerCrop(MONASTERY_EXTENSION_SCRIPTORIUM), 20);
assert.ok(monasteryScriptoriumRecoveryMultiplier(MONASTERY_EXTENSION_SCRIPTORIUM) < monasteryScriptoriumRecoveryMultiplier(0));
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

for (const extensions of [
  0,
  MONASTERY_EXTENSION_INFIRMARY,
  MONASTERY_EXTENSION_SCRIPTORIUM,
  MONASTERY_EXTENSION_GUESTHOUSE,
  MONASTERY_EXTENSION_WORKSHOP,
  MONASTERY_EXTENSION_ALL,
]) {
  const level = monasteryVisualEstateLevel(extensions);
  const mesh = createBuildingMesh('monastery', level, {
    orchard: 0,
    croft: 0,
    extensions,
    orchardMaturity: 2,
  });
  const estate = mesh.getObjectByName(`Monastery enclosed estate level ${level}`);
  assert.ok(estate instanceof THREE.Group, `estate level ${level} must be rendered`);
  assert.ok(mesh.getObjectByName('Monastery precinct rear wall'));
  assert.ok(mesh.getObjectByName('Monastery east gatehouse'));
  assert.ok(mesh.getObjectByName('Monastery northwest round tower'));
  assert.ok(mesh.getObjectByName('Monastery protected cattle and sheep pasture'));
  assert.ok(mesh.getObjectByName('Monastery reserved dairy upgrade plot'));
  assert.ok(mesh.getObjectByName('Monastery enclosed cloister court'));
  assert.ok(mesh.getObjectByName('Monastery front cloister arcade'));
  assert.ok(mesh.getObjectByName('Monastery mixed apple and pear orchard'));
  assert.ok(mesh.getObjectByName('Monastery apple orchard rows'));
  assert.ok(mesh.getObjectByName('Monastery pear orchard rows'));
  assert.ok(mesh.getObjectByName('Monastery mead brewhouse and honey cellar'));
  assert.ok(mesh.getObjectByName('Monastery orchard cider press and cellar bay'));
  assert.ok(mesh.getObjectByName('Monastery vintner and wine cellar'));
  assert.ok(mesh.getObjectByName('Monastery vintner screw press'));
  assert.ok(mesh.getObjectByName('Monastery bee garden'));
  assert.ok(mesh.getObjectByName('Monastery chicken yard'));
  assert.ok(mesh.getObjectByName('Monastery dairy cow'));
  assert.ok(mesh.getObjectByName('Monastery pasture sheep'));
  assert.equal(
    mesh.getObjectByName('Monastery infirmary wing') != null,
    (extensions & MONASTERY_EXTENSION_INFIRMARY) !== 0,
  );
  assert.equal(
    mesh.getObjectByName('Monastery scriptorium and records wing') != null,
    (extensions & MONASTERY_EXTENSION_SCRIPTORIUM) !== 0,
  );
  assert.equal(
    mesh.getObjectByName('Scriptorium duplicate records chest') != null,
    (extensions & MONASTERY_EXTENSION_SCRIPTORIUM) !== 0,
  );
  assert.equal(
    mesh.getObjectByName('Monastery guesthouse') != null,
    (extensions & MONASTERY_EXTENSION_GUESTHOUSE) !== 0,
  );
  assert.equal(
    mesh.getObjectByName('Monastery estate workshop and root cellar') != null,
    (extensions & MONASTERY_EXTENSION_WORKSHOP) !== 0,
  );
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
  assert.deepEqual(architecturePlan.reservedUpgradeZoneIds, ['dairy-upgrade']);
  assert.ok((architecturePlan.diagnostics?.pastureArea ?? 0) >= 350);
  assert.equal(architecturePlan.diagnostics?.wallRunCount, 5);
  assert.equal(architecturePlan.diagnostics?.towerCount, 4);
  assert.deepEqual(architecturePlan.diagnostics?.outOfBoundsZoneIds, []);
  assert.deepEqual(architecturePlan.diagnostics?.overlappingZonePairs, []);
  assert.ok((architecturePlan.diagnostics?.triangleCount ?? 0) > 0);
  assert.ok((architecturePlan.diagnostics?.meshCount ?? 0) > 0);
}
const fullyDevelopedEstate = createBuildingMesh('monastery', 3, {
  orchard: 0,
  croft: 0,
  extensions: MONASTERY_EXTENSION_ALL,
  orchardMaturity: 2,
});
assert.ok(fullyDevelopedEstate.getObjectByName('Monastery estate workshop and root cellar'));
assert.ok(fullyDevelopedEstate.getObjectByName('Monastery estate workshop bench'));
const legacyPlantingValuesAreIgnored = createBuildingMesh('monastery', 3, {
  orchard: 1,
  croft: 1,
  extensions: MONASTERY_EXTENSION_ALL,
  orchardMaturity: 2,
});
assert.ok(legacyPlantingValuesAreIgnored.getObjectByName('Monastery mixed apple and pear orchard'));
assert.ok(legacyPlantingValuesAreIgnored.getObjectByName('Monastery apple orchard rows'));
assert.ok(legacyPlantingValuesAreIgnored.getObjectByName('Monastery pear orchard rows'));
assert.ok(legacyPlantingValuesAreIgnored.getObjectByName('Monastery vintner and wine cellar'));
assert.equal(legacyPlantingValuesAreIgnored.getObjectByName('Monastery brewing barley croft'), undefined);

const serverPolicy = readFileSync(new URL('../server/src/monastery_estate_policy.rs', import.meta.url), 'utf8');
assert.match(serverPolicy, /MONASTERY_ESTATE_HALF_WIDTH: f64 = 34\.0/);
assert.match(serverPolicy, /MONASTERY_ESTATE_EXPORT_LOT: f64 = 6\.0/);
assert.match(serverPolicy, /MONASTERY_EXTENSION_INFIRMARY: u8 = 1/);
assert.match(serverPolicy, /MONASTERY_EXTENSION_SCRIPTORIUM: u8 = 2/);
assert.match(serverPolicy, /MONASTERY_EXTENSION_GUESTHOUSE: u8 = 4/);
assert.match(serverPolicy, /MONASTERY_EXTENSION_WORKSHOP: u8 = 8/);
assert.match(serverPolicy, /MONASTERY_EXTENSION_INFIRMARY => Some\(24\.0\)/);
assert.match(serverPolicy, /MONASTERY_EXTENSION_SCRIPTORIUM => Some\(28\.0\)/);
assert.match(serverPolicy, /MONASTERY_EXTENSION_GUESTHOUSE => Some\(20\.0\)/);
assert.match(serverPolicy, /MONASTERY_EXTENSION_WORKSHOP => Some\(30\.0\)/);
assert.match(serverPolicy, /MONASTERY_ORCHARD_REPLANT_COST: f64 = 12\.0/);
assert.match(serverPolicy, /monastery_orchard_replanting_allowed/);
assert.match(serverPolicy, /monastery_croft_choice_allowed/);
assert.match(serverPolicy, /MONASTERY_ORCHARD_APPLES: u8 = 0/);
assert.match(serverPolicy, /pub pears: f64/);
assert.match(serverPolicy, /pub cider: f64/);
assert.match(serverPolicy, /pub mead: f64/);

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
  cider: 0,
  mead: 0,
  preservedFood: 0,
  honey: 0,
  wine: 0,
  gold: 0,
  waterCapacity: 0,
  assignedLabor: 8,
  constructionComplete: true,
  monasteryExtensions: MONASTERY_EXTENSION_ALL,
} as BuildingState;
const estateWorkTargets = collectWorkerTargets(staffedEstate, {
  quarries: [],
  foragingNodes: [],
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
});
for (const station of ['mead-brewhouse', 'cider-press', 'orchard', 'croft', 'pasture', 'infirmary', 'outer-gate']) {
  assert.ok(
    estateWorkTargets.some((target) => target.id.endsWith(`:${station}`)),
    `assigned monks need a visible ${station} duty target`,
  );
}
const vineyardWorkTargets = collectWorkerTargets(staffedEstate, {
  quarries: [],
  foragingNodes: [],
  trees: new Map(),
  treeRegistry: null,
  farmFields: [],
  pastures: [],
  vineyardParcels: [{
    id: 'parcel-1',
    monasteryId: staffedEstate.id,
    corners: [
      { x: -8, z: -60 },
      { x: 8, z: -60 },
      { x: 8, z: -50 },
      { x: -8, z: -50 },
    ],
    area: 160,
    averageSlopeDegrees: 4,
    moisture: 0.6,
    southExposure: 0.7,
    siteSuitability: 0.8,
    shapeEfficiency: 1,
  }],
});
assert.ok(vineyardWorkTargets.some((target) => target.id.endsWith(':vintner')));
assert.ok(vineyardWorkTargets.some((target) => target.id.includes(':monastery:vineyard:parcel-1:')));
const baseEstateWorkTargets = collectWorkerTargets(
  { ...staffedEstate, monasteryExtensions: 0 },
  {
    quarries: [],
    foragingNodes: [],
    trees: new Map(),
    treeRegistry: null,
    farmFields: [],
    pastures: [],
  },
);
for (const unbuiltStation of ['infirmary', 'scriptorium', 'guesthouse']) {
  assert.equal(
    baseEstateWorkTargets.some((target) => target.id.endsWith(`:${unbuiltStation}`)),
    false,
    `monks must not walk into the unbuilt ${unbuiltStation}`,
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
assert.match(simulation, /CommodityKind::Pears, yields\.pears/);
assert.match(simulation, /CommodityKind::Cider, yields\.cider/);
assert.match(simulation, /CommodityKind::Mead, yields\.mead/);
assert.doesNotMatch(simulation, /CommodityKind::Wine, yields\.wine/);
assert.match(simulation, /CommodityKind::Milk,\s*food_exportable/);
assert.match(simulation, /fn dispatch_monastery_vineyard_wine[\s\S]*MONASTERY_FEAST_DRINK[\s\S]*monastery\.cider[\s\S]*monastery\.mead[\s\S]*monastery\.wine/);
assert.match(simulation, /fn advance_monastery_vineyard_fermentation[\s\S]*CommodityKind::Wine/);
const estateExportSource = simulation.slice(
  simulation.indexOf('fn dispatch_monastery_estate_export'),
  simulation.indexOf('fn request_monastery_seed_archive'),
);
assert.doesNotMatch(estateExportSource, /CommodityKind::(?:Mead|Wine|Ale|Cider)/);
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
