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
assert.equal(buildingFreshFoodStorageFactor('granary'), FRESH_FOOD_STORAGE_GRANARY_FACTOR);
assert.ok(
  buildingFreshFoodStorageFactor('granary') < buildingFreshFoodStorageFactor('hunters_hall'),
  'granary storage should materially slow fresh-food spoilage',
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

const perfState = emptyGameState();
for (let index = 0; index < 10_000; index += 1) {
  perfState.residences.set(`home-${index}`, residence(`home-${index}`, 12));
}
const started = performance.now();
const perfResult = analyzeFreshFoodPreservation(perfState, 0.018);
const elapsedMs = performance.now() - started;
assert.equal(perfResult.totalStock, 120_000);
assert.ok(elapsedMs < 250, `10,000-home preservation analysis took ${elapsedMs.toFixed(1)} ms`);

console.log(`food preservation tests passed (${elapsedMs.toFixed(1)} ms for 10,000 homes)`);

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
