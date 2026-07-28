import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FRESH_FOOD_STORAGE_GRANARY_FACTOR,
  FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR,
  FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
  FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
  FRESH_FOOD_STORAGE_TREASURY_FACTOR,
} from '../src/generated/gameBalance.ts';
import {
  analyzeFreshFoodPreservation,
  buildingFreshFoodStorageFactor,
  spoilageAdjustedRunwayDays,
} from '../src/economy/foodPreservation.ts';
import { renderFreshFoodPreservationRows } from '../src/resources/inspector/townHallRenderer.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';

const state = emptyGameState();
state.stockpile.food = 10;
state.buildings.set('granary', building('granary', 'granary', 20));
state.buildings.set('market', building('market', 'marketplace', 10));
state.buildings.set('smokehouse', building('smokehouse', 'smokehouse', 10));
state.buildings.set('hunter', building('hunter', 'hunters_hall', 10));
state.residences.set('home', residence('home', 10));

const ambientSpoilage = 0.01;
const preservation = analyzeFreshFoodPreservation(state, ambientSpoilage);
const expectedWeightedStock = 10 * FRESH_FOOD_STORAGE_TREASURY_FACTOR
  + 20 * FRESH_FOOD_STORAGE_GRANARY_FACTOR
  + 10 * FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR
  + 10 * FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR
  + 10
  + 10 * FRESH_FOOD_STORAGE_RESIDENCE_FACTOR;

assert.equal(preservation.totalStock, 70);
assert.equal(preservation.protectedStock, 40);
assert.ok(Math.abs(preservation.protectedShare - 4 / 7) < 1e-9);
assert.ok(Math.abs(preservation.effectiveStorageFactor - expectedWeightedStock / 70) < 1e-9);
assert.ok(Math.abs(preservation.spoilagePerDay - expectedWeightedStock * ambientSpoilage) < 1e-9);
assert.equal(preservation.largestLossSite?.source, 'treasury');
assert.ok(Math.abs((preservation.largestLossSite?.spoilagePerDay ?? 0) - 0.12) < 1e-9);
assert.deepEqual(preservation.granaryNetwork, {
  completedGranaries: 1,
  fireDisabledGranaries: 0,
  collectingGranaries: 1,
  staffedCollectingGranaries: 1,
  targetStock: 255,
  stockTowardTarget: 20,
  targetShortfall: 235,
  stockAboveTarget: 0,
});
assert.equal(buildingFreshFoodStorageFactor('granary'), FRESH_FOOD_STORAGE_GRANARY_FACTOR);
assert.ok(
  buildingFreshFoodStorageFactor('granary') < buildingFreshFoodStorageFactor('hunters_hall'),
  'granary storage should materially slow fresh-food spoilage',
);
const physicalLedgerState = emptyGameState();
physicalLedgerState.physicalFoundingSiteEnabled = true;
physicalLedgerState.stockpile.food = 50;
assert.equal(
  analyzeFreshFoodPreservation(physicalLedgerState, ambientSpoilage).totalStock,
  0,
  'physical food planning must ignore compatibility-ledger stock',
);

const adjustedRunway = spoilageAdjustedRunwayDays(
  preservation.totalStock,
  7,
  preservation.spoilageFractionPerDay,
);
assert.ok(adjustedRunway < 10, 'spoilage must shorten the naive ten-day food runway');
assert.ok(adjustedRunway > 9, 'the configured storage mix should not erase more than a day of runway');
assert.equal(spoilageAdjustedRunwayDays(70, 7, 0), 10);
assert.equal(spoilageAdjustedRunwayDays(0, 7, 0.01), 0);
assert.equal(spoilageAdjustedRunwayDays(70, 0, 0.01), Number.POSITIVE_INFINITY);

const hotspotState = emptyGameState();
hotspotState.buildings.set('hunter-hotspot', building('hunter-hotspot', 'hunters_hall', 80));
hotspotState.buildings.set('granary-buffer', building('granary-buffer', 'granary', 20));
const hotspot = analyzeFreshFoodPreservation(hotspotState, 0.01);
assert.equal(hotspot.largestLossSite?.source, 'building');
assert.equal(hotspot.largestLossSite?.id, 'hunter-hotspot');
assert.equal(hotspot.largestLossSite?.buildingKind, 'hunters_hall');
assert.ok(Math.abs((hotspot.largestLossSite?.spoilagePerDay ?? 0) - 0.8) < 1e-9);
const hotspotRows = renderFreshFoodPreservationRows(
  hotspot,
  (kind) => kind === 'hunters_hall' ? "Hunter's hall" : kind,
  () => null,
);
assert.match(hotspotRows, /Largest fresh-food loss/);
assert.match(hotspotRows, /Hunter's hall · 80\.0 food · 0\.8 food \/ day/);
assert.match(hotspotRows, /data-inspect-building="hunter-hotspot"/);
assert.match(hotspotRows, /Granary intake network/);
assert.match(hotspotRows, /20\.0 \/ 255\.0 sheltered toward selected targets/);
assert.match(hotspotRows, /235\.0 collection headroom/);
assert.match(hotspotRows, /1 \/ 1 collectors staffed/);

const householdHotspotState = emptyGameState();
householdHotspotState.residences.set(
  'household-hotspot',
  residence('household-hotspot', 40),
);
const householdHotspotRows = renderFreshFoodPreservationRows(
  analyzeFreshFoodPreservation(householdHotspotState, 0.01),
  (kind) => kind,
  () => 6,
);
assert.match(householdHotspotRows, /Residence parcel #7/);
assert.match(householdHotspotRows, /data-inspect-residence="household-hotspot"/);

const disabledGranaryState = emptyGameState();
const disabledGranary = building('disabled-granary', 'granary', 20);
disabledGranary.granaryAcceptsFreshFood = false;
disabledGranaryState.buildings.set(disabledGranary.id, disabledGranary);
const disabledGranaryRows = renderFreshFoodPreservationRows(
  analyzeFreshFoodPreservation(disabledGranaryState, 0.01),
  (kind) => kind,
  () => null,
);
assert.match(disabledGranaryRows, /1 completed · fresh-food collection disabled at every granary/);

const deepGranaryState = emptyGameState();
const deepGranary = building('deep-granary', 'granary', 310);
deepGranary.granaryFreshFoodTargetPercent = 90;
deepGranaryState.buildings.set(deepGranary.id, deepGranary);
const deepGranaryRows = renderFreshFoodPreservationRows(
  analyzeFreshFoodPreservation(deepGranaryState, 0.01),
  (kind) => kind,
  () => null,
);
assert.match(deepGranaryRows, /306\.0 \/ 306\.0 sheltered toward selected targets/);
assert.match(deepGranaryRows, /4\.0 above targets from baking or earlier stock/);

const fireQuarantineState = emptyGameState();
fireQuarantineState.stockpile.food = 10;
fireQuarantineState.buildings.set(
  'fire-granary',
  building('fire-granary', 'granary', 20),
);
fireQuarantineState.buildings.set(
  'fire-hunter',
  building('fire-hunter', 'hunters_hall', 30),
);
fireQuarantineState.buildings.set(
  'healthy-market',
  building('healthy-market', 'marketplace', 10),
);
fireQuarantineState.residences.set(
  'fire-home',
  residence('fire-home', 40),
);
const fireQuarantine = analyzeFreshFoodPreservation(
  fireQuarantineState,
  ambientSpoilage,
  {
    fireDisabledBuildingIds: new Set(['fire-granary', 'fire-hunter']),
    fireDisabledResidenceIds: new Set(['fire-home']),
  },
);
assert.equal(fireQuarantine.totalStock, 110);
assert.equal(fireQuarantine.usableStock, 20);
assert.equal(fireQuarantine.quarantinedStock, 90);
assert.equal(fireQuarantine.granaryNetwork.completedGranaries, 1);
assert.equal(fireQuarantine.granaryNetwork.fireDisabledGranaries, 1);
assert.equal(fireQuarantine.granaryNetwork.collectingGranaries, 0);
assert.equal(fireQuarantine.largestLossSite?.id, 'fire-hunter');
assert.ok(
  Math.abs(
    fireQuarantine.quarantinedSpoilagePerDay
    - ambientSpoilage * (
      20 * FRESH_FOOD_STORAGE_GRANARY_FACTOR
      + 30
    ),
  ) < 1e-9,
  'food in damaged buildings must remain in authoritative spoilage',
);
assert.ok(
  Math.abs(
    fireQuarantine.usableSpoilageFractionPerDay
    - ambientSpoilage * (
      (
        10 * FRESH_FOOD_STORAGE_TREASURY_FACTOR
        + 10 * FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR
      ) / 20
    ),
  ) < 1e-9,
);
const fireQuarantineRows = renderFreshFoodPreservationRows(
  fireQuarantine,
  (kind) => kind,
  () => null,
);
assert.match(fireQuarantineRows, /Fire-quarantined food/);
assert.match(fireQuarantineRows, /90\.0 inaccessible until recovery/);
assert.match(fireQuarantineRows, /every completed granary is fire-disabled/);

const residenceNeeds = readFileSync(
  new URL('../server/src/simulation/residence_needs/mod.rs', import.meta.url),
  'utf8',
);
const residenceFood = readFileSync(
  new URL('../server/src/simulation/residence_needs/food.rs', import.meta.url),
  'utf8',
);
const expandedEconomy = readFileSync(
  new URL('../server/src/simulation/expanded_economy.rs', import.meta.url),
  'utf8',
);
const buildingTable = readFileSync(
  new URL('../server/src/tables.rs', import.meta.url),
  'utf8',
);
const buildingReducers = readFileSync(
  new URL('../server/src/reducers/buildings.rs', import.meta.url),
  'utf8',
);
const generatedBuilding = readFileSync(
  new URL('../src/generated/building_table.ts', import.meta.url),
  'utf8',
);
const clientReducers = readFileSync(
  new URL('../src/data/spacetimeReducers.ts', import.meta.url),
  'utf8',
);
const granaryInspector = readFileSync(
  new URL('../src/resources/inspector/expandedBuildingRenderer.ts', import.meta.url),
  'utf8',
);
const townHallInspector = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
const serverFoodSpoilage = readFileSync(
  new URL('../server/src/simulation/food_spoilage.rs', import.meta.url),
  'utf8',
);

assert.match(residenceFood, /pub fn spoil\(/);
assert.match(
  residenceNeeds,
  /general_consumption_paused[\s\S]*food::spoil\(/,
  'household stores must keep spoiling outside consumption hours',
);
assert.match(
  expandedEconomy,
  /supplier\.assigned_labor == 0[\s\S]*building_has_active_trip/,
  'unstaffed processors must not dispatch household provision carts',
);
assert.match(
  expandedEconomy,
  /target\.assigned_labor == 0[\s\S]*building_has_inbound_supply_trip/,
  'unstaffed processors must not request input carts',
);
assert.match(expandedEconomy, /if granary\.granary_accepts_fresh_food/);
assert.match(buildingTable, /#\[default\(true\)\][\s\S]*pub granary_accepts_fresh_food: bool/);
assert.match(buildingReducers, /pub fn set_granary_policy\(/);
assert.match(generatedBuilding, /granaryAcceptsFreshFood:[\s\S]*granary_accepts_fresh_food/);
assert.match(clientReducers, /callReducer\('setGranaryPolicy', 'set_granary_policy'/);
assert.match(granaryInspector, /data-granary-accepts-fresh-food/);
assert.match(
  townHallInspector,
  /const freshFoodPreservationRows = renderFreshFoodPreservationRows\([\s\S]*\$\{freshFoodPreservationRows\}/,
  'the Town Hall must render the shared preservation diagnostic rows',
);
assert.match(townHallInspector, /data-inspect-building=/);
assert.match(townHallInspector, /data-inspect-residence=/);
assert.match(
  serverFoodSpoilage,
  /for building in ctx\.db\.building\(\)\.iter\(\)[\s\S]*building\.food[\s\S]*storage_factor/,
  'damaged building stores remain in the server-wide fresh-food spoilage pass',
);

const perfState = emptyGameState();
for (let index = 0; index < 10_000; index += 1) {
  perfState.residences.set(`home-${index}`, residence(`home-${index}`, 12));
}
const started = performance.now();
const perfResult = analyzeFreshFoodPreservation(perfState, 0.018);
const elapsedMs = performance.now() - started;
assert.equal(perfResult.totalStock, 120_000);
assert.ok(elapsedMs < 250, `10,000-home preservation analysis took ${elapsedMs.toFixed(1)} ms`);

const granaryPerfState = emptyGameState();
const fireDisabledGranaries = new Set<string>();
for (let index = 0; index < 100_000; index += 1) {
  const granary = building(`granary-${index}`, 'granary', index % 341);
  granary.granaryFreshFoodTargetPercent = [25, 50, 75, 90][index % 4];
  granaryPerfState.buildings.set(granary.id, granary);
  if (index % 2 === 0) fireDisabledGranaries.add(granary.id);
}
const granaryStarted = performance.now();
const granaryPerfResult = analyzeFreshFoodPreservation(
  granaryPerfState,
  0.018,
  { fireDisabledBuildingIds: fireDisabledGranaries },
);
const granaryElapsedMs = performance.now() - granaryStarted;
assert.equal(granaryPerfResult.granaryNetwork.completedGranaries, 100_000);
assert.equal(granaryPerfResult.granaryNetwork.fireDisabledGranaries, 50_000);
assert.equal(granaryPerfResult.granaryNetwork.collectingGranaries, 50_000);
assert.ok(
  granaryElapsedMs < 500,
  `100,000-granary preservation diagnostics took ${granaryElapsedMs.toFixed(1)} ms`,
);

console.log(
  `food preservation tests passed (${elapsedMs.toFixed(1)} ms for 10,000 homes; `
  + `${granaryElapsedMs.toFixed(1)} ms for 100,000 granaries)`,
);

function building(
  id: string,
  kind: BuildingState['kind'],
  food: number,
): BuildingState {
  return {
    id,
    kind,
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    polearms: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 1,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
    granaryAcceptsFreshFood: true,
  };
}

function residence(id: string, food: number): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population: 1,
    populationCapacity: 1,
    tier: 1,
    settlementTicks: 0,
    needs: {
      firewood: { stock: 0, deficitSeconds: 0 },
      water: { stock: 0, deficitSeconds: 0 },
      food: { stock: food, deficitSeconds: 0 },
      preservedFood: { stock: 0, deficitSeconds: 0 },
      ale: { stock: 0, deficitSeconds: 0 },
    },
    abandoned: false,
    householdWealth: 0,
  };
}

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: {
      timber: 0,
      stone: 0,
      firewood: 0,
      water: 0,
      game: 0,
      berries: 0,
      mushrooms: 0,
      fish: 0,
      food: 0,
      grain: 0,
      flour: 0,
      ale: 0,
      preservedFood: 0,
      honey: 0,
      wine: 0,
      polearms: 0,
      gold: 0,
    },
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}
