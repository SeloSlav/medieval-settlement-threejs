import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  PRESERVED_FOOD_SPOILAGE_PER_DAY,
  PRESERVED_FOOD_STORAGE_CART_FACTOR,
  PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
  PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  SMOKEHOUSE_POTTERY_PER_CYCLE,
  SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE,
  SMOKEHOUSE_SALT_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import {
  computeSettlementPreservationReservePlan,
  PRESERVATION_RESERVE_DAYS,
} from '../src/economy/settlementPreservationReserve.ts';
import { MARKETPLACE_SALT_IMPORT_LOT } from '../src/economy/marketplaceMaterialProcurementPolicy.ts';
import { renderPreservationReserveRows } from '../src/resources/inspector/townHallRenderer.ts';
import {
  createEmptyStockpile,
  type BuildingKind,
  type BuildingState,
  type GameState,
  type ResidenceState,
} from '../src/resources/types.ts';

const workdaySeconds = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;
const oneResidentFallbackPerDay = RESIDENCE_FOOD_PER_PERSON_PER_SEC
  * workdaySeconds;
const reserveTarget = (
  demandPerDay: number,
  storageFactor: number,
): number => {
  const spoilage =
    PRESERVED_FOOD_SPOILAGE_PER_DAY * storageFactor;
  return demandPerDay
    * Math.expm1(spoilage * PRESERVATION_RESERVE_DAYS)
    / spoilage;
};

const targetState = emptyGameState();
targetState.physicalFoundingSiteEnabled = true;
targetState.residences.set('core-home', residence('core-home', 2, 0));
const targetPlan = computeSettlementPreservationReservePlan(targetState, {
  sabbathObserved: false,
  roadComponentFor: () => 'core',
});
approx(targetPlan.fallbackDemandPerDay, oneResidentFallbackPerDay * 2);
approx(
  targetPlan.targetStock,
  reserveTarget(
    oneResidentFallbackPerDay * 2,
    PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
  ),
);
assert.equal(targetPlan.tierThreeResidents, 2);
assert.equal(targetPlan.targetBranches, 1);
assert.equal(targetPlan.shortBranches, 1);
assert.equal(targetPlan.branchesWithoutSmokehouse, 1);
assert.equal(targetPlan.productionDaysToTarget, Number.POSITIVE_INFINITY);

const preparedState = emptyGameState();
preparedState.physicalFoundingSiteEnabled = true;
const preparedTarget = reserveTarget(
  oneResidentFallbackPerDay,
  PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
);
preparedState.residences.set(
  'prepared-home',
  residence('prepared-home', 1, preparedTarget),
);
const preparedPlan = computeSettlementPreservationReservePlan(preparedState, {
  sabbathObserved: false,
  roadComponentFor: () => 'core',
});
approx(preparedPlan.roadMatchedStock, preparedTarget);
approx(preparedPlan.roadMatchedShortfall, 0);
assert.equal(preparedPlan.preparedBranches, 1);
assert.equal(preparedPlan.productionDaysToTarget, 0);

const splitState = emptyGameState();
splitState.physicalFoundingSiteEnabled = true;
const exposedHome = residence('exposed-home', 1, 0);
exposedHome.x = 0;
splitState.residences.set(exposedHome.id, exposedHome);
const remoteSmokehouse = building('remote-smokehouse', 'smokehouse', 1);
remoteSmokehouse.x = 100;
const emptyBranchTarget = reserveTarget(
  oneResidentFallbackPerDay,
  PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
);
remoteSmokehouse.preservedFood = emptyBranchTarget * 2;
splitState.buildings.set(remoteSmokehouse.id, remoteSmokehouse);
const splitPlan = computeSettlementPreservationReservePlan(splitState, {
  sabbathObserved: false,
  roadComponentFor: (candidate) => candidate.x < 50 ? 'core' : 'remote',
});
approx(splitPlan.roadMatchedStock, 0);
approx(splitPlan.roadMatchedShortfall, emptyBranchTarget);
approx(splitPlan.unmatchedPreservedStock, emptyBranchTarget * 2);
assert.equal(splitPlan.firstExposedResidenceId, exposedHome.id);
assert.equal(splitPlan.branchesWithoutSmokehouse, 1);

const cartState = emptyGameState();
cartState.physicalFoundingSiteEnabled = true;
const cartHome = residence('cart-home', 1, 0);
cartHome.x = 0;
cartState.residences.set(cartHome.id, cartHome);
const cartOrigin = building('cart-origin', 'smokehouse', 1);
cartOrigin.x = 100;
cartState.buildings.set(cartOrigin.id, cartOrigin);
cartState.deliveryTrips.set(
  'preserved-cart',
  deliveryTrip({
    id: 'preserved-cart',
    originId: cartOrigin.id,
    residenceId: cartHome.id,
    cargoKind: 'preservedFood',
    amount: reserveTarget(
      oneResidentFallbackPerDay,
      PRESERVED_FOOD_STORAGE_CART_FACTOR,
    ),
    phase: 'outbound',
  }),
);
const cartPlan = computeSettlementPreservationReservePlan(cartState, {
  sabbathObserved: false,
  roadComponentFor: (candidate) => candidate.x < 50 ? 'core' : 'remote',
});
const cartTarget = reserveTarget(
  oneResidentFallbackPerDay,
  PRESERVED_FOOD_STORAGE_CART_FACTOR,
);
approx(cartPlan.preservedInTransit, cartTarget);
approx(cartPlan.roadMatchedStock, cartTarget);
assert.equal(cartPlan.preparedBranches, 1);

const returningState = emptyGameState();
returningState.physicalFoundingSiteEnabled = true;
const returningHome = residence('returning-home', 1, 0);
returningHome.x = 0;
returningState.residences.set(returningHome.id, returningHome);
const returningOrigin = building('returning-origin', 'smokehouse', 1);
returningOrigin.x = 100;
returningState.buildings.set(returningOrigin.id, returningOrigin);
returningState.deliveryTrips.set(
  'returning-cart',
  deliveryTrip({
    id: 'returning-cart',
    originId: returningOrigin.id,
    residenceId: returningHome.id,
    cargoKind: 'preservedFood',
    amount: preparedTarget,
    phase: 'inbound',
  }),
);
const returningPlan = computeSettlementPreservationReservePlan(
  returningState,
  {
    sabbathObserved: false,
    roadComponentFor: (candidate) => candidate.x < 50 ? 'core' : 'remote',
  },
);
approx(returningPlan.roadMatchedStock, 0);
approx(returningPlan.unmatchedPreservedStock, preparedTarget);

const fireState = emptyGameState();
fireState.physicalFoundingSiteEnabled = true;
const healthyHome = residence('healthy-home', 1, 0);
fireState.residences.set(healthyHome.id, healthyHome);
const burningHome = residence('burning-home', 3, 9);
fireState.residences.set(burningHome.id, burningHome);
const burningStore = building('burning-store', 'smokehouse', 1);
burningStore.preservedFood = 7;
fireState.buildings.set(burningStore.id, burningStore);
fireState.fireIncidents.set(
  'home-fire',
  fireIncident('home-fire', 'residence', burningHome.id),
);
fireState.fireIncidents.set(
  'store-fire',
  fireIncident('store-fire', 'building', burningStore.id),
);
const firePlan = computeSettlementPreservationReservePlan(fireState, {
  sabbathObserved: false,
  roadComponentFor: () => 'core',
});
assert.equal(firePlan.tierThreeResidents, 1);
assert.equal(firePlan.quarantinedPreservedStock, 16);
assert.equal(firePlan.preservedStock, 0);
assert.equal(firePlan.staffedSmokehouses, 0);

const recipeState = emptyGameState();
recipeState.physicalFoundingSiteEnabled = true;
recipeState.residences.set('recipe-home', residence('recipe-home', 1, 0));
const recipeSmokehouse = building('recipe-smokehouse', 'smokehouse', 1);
recipeState.buildings.set(recipeSmokehouse.id, recipeSmokehouse);
const recipeMarket = building('recipe-market', 'marketplace', 1);
recipeMarket.marketplaceSaltTarget = 24;
recipeMarket.salt = 1;
recipeState.buildings.set(recipeMarket.id, recipeMarket);
const recipePotter = building('recipe-potter', 'potter_kiln', 1);
recipePotter.pottery = 0.5;
recipeState.buildings.set(recipePotter.id, recipePotter);
const recipePlan = computeSettlementPreservationReservePlan(recipeState, {
  sabbathObserved: false,
  roadComponentFor: () => 'core',
});
const cyclesRequired = recipePlan.roadMatchedShortfall
  <= 1e-9
  ? 0
  : recipePlan.smokehouseOutputPerDay
    * recipePlan.productionDaysToTarget
    / SMOKEHOUSE_PRESERVED_FOOD_PER_CYCLE;
approx(recipePlan.freshFoodRequired, cyclesRequired * SMOKEHOUSE_FOOD_PER_CYCLE);
approx(recipePlan.firewoodRequired, cyclesRequired * SMOKEHOUSE_FIREWOOD_PER_CYCLE);
approx(recipePlan.saltRequired, cyclesRequired * SMOKEHOUSE_SALT_PER_CYCLE);
approx(recipePlan.potteryRequired, cyclesRequired * SMOKEHOUSE_POTTERY_PER_CYCLE);
approx(recipePlan.saltImportShortfall, Math.max(0, recipePlan.saltRequired - 1));
approx(recipePlan.potteryShortfall, Math.max(0, recipePlan.potteryRequired - 0.5));
assert.equal(
  recipePlan.saltImportLots,
  Math.ceil(recipePlan.saltImportShortfall / MARKETPLACE_SALT_IMPORT_LOT),
);
assert.equal(recipePlan.standingSaltMarkets, 1);
assert.equal(recipePlan.branchesWithoutStandingSalt, 0);
assert.ok(Number.isFinite(recipePlan.productionDaysToTarget));
assert.ok(recipePlan.productionDaysToTarget > 0);

const noOrderState = emptyGameState();
noOrderState.physicalFoundingSiteEnabled = true;
noOrderState.residences.set('no-order-home', residence('no-order-home', 1, 0));
const noOrderSmokehouse = building('no-order-smokehouse', 'smokehouse', 1);
noOrderState.buildings.set(noOrderSmokehouse.id, noOrderSmokehouse);
const noOrderMarket = building('no-order-market', 'marketplace', 1);
noOrderState.buildings.set(noOrderMarket.id, noOrderMarket);
const noOrderPlan = computeSettlementPreservationReservePlan(noOrderState, {
  sabbathObserved: false,
  roadComponentFor: () => 'core',
});
assert.equal(noOrderPlan.branchesWithoutStandingSalt, 1);
assert.equal(noOrderPlan.firstSaltMarketId, noOrderMarket.id);

const rendered = renderPreservationReserveRows(recipePlan, 14);
assert.match(rendered, /30-day winter fallback/);
assert.match(rendered, /Reserve completion/);
assert.match(rendered, /Adriatic salt burden/);
assert.match(rendered, /Preserving vessels/);
assert.match(rendered, /data-inspect-residence="recipe-home"/);
assert.match(rendered, /data-inspect-building="recipe-smokehouse"/);
assert.match(rendered, /data-inspect-building="recipe-market"/);
assert.match(
  rendered,
  new RegExp(`&asymp; ${(recipePlan.saltImportLots * 14).toFixed(0)} gold`),
);
assert.match(rendered, /repeated imports can tighten the regional rate/);
assert.match(rendered, /kiln cart priorities decide/);
assert.match(rendered, /including cured-stock aging while the reserve builds/);

const noResidentsRows = renderPreservationReserveRows(
  computeSettlementPreservationReservePlan(emptyGameState(), {
    sabbathObserved: false,
  }),
  14,
);
assert.match(noResidentsRows, /No active prosperous residents yet/);

const residenceNeedAuthority = readFileSync(
  new URL('../server/src/simulation/residence_needs/mod.rs', import.meta.url),
  'utf8',
);
assert.match(
  residenceNeedAuthority,
  /food_unmet = consume_food_with_preserved/,
  'the planner target must remain tied to the authoritative fallback meal path',
);
assert.match(
  residenceNeedAuthority,
  /kind == ResidenceNeedKind::PreservedFood[\s\S]*need\.stock/,
  'preserved-food status should remain stock-aware after the shared meal withdrawal',
);
assert.match(
  residenceNeedAuthority,
  /consume_food_with_preserved[\s\S]*allocate_preserved_meal/,
);
assert.match(
  residenceNeedAuthority,
  /preserved_food_demand\([\s\S]*environment\.preserved_food_demand_multiplier\(\)[\s\S]*allocation\.fresh_used[\s\S]*allocation\.preserved_used\(\)/,
);
const preservedMealPolicy = readFileSync(
  new URL('../server/src/preserved_food_policy.rs', import.meta.url),
  'utf8',
);
assert.match(preservedMealPolicy, /without inventing a second calorie demand/);
assert.match(
  preservedMealPolicy,
  /fresh_used \+ plan\.preserved_used\(\), 3\.0/,
);

const townHallSource = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
const residenceSource = readFileSync(
  new URL('../src/resources/inspector/residenceRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(
  townHallSource,
  /computeSettlementPreservationReservePlan\([\s\S]*renderPreservationReserveRows\([\s\S]*\$\{preservationReserveRows\}/,
);
assert.doesNotMatch(
  townHallSource,
  /Preservation capacity<\/span><span>[^<]*tier-3 demand/,
);
assert.match(townHallSource, /winter design peak/);
assert.match(townHallSource, /rotated rations displace the same fresh-food calories/);
assert.match(residenceSource, /Prosperity planning load/);
assert.match(residenceSource, /winter-peak preserved ration/);
assert.match(residenceSource, /replaces the same amount of fresh food rather than adding a second meal/);

const perfState = emptyGameState();
perfState.physicalFoundingSiteEnabled = true;
for (let index = 0; index < 50_000; index += 1) {
  const home = residence(`perf-home-${index}`, 1, index % 5);
  home.x = index % 200;
  perfState.residences.set(home.id, home);
  const smokehouse = building(`perf-smokehouse-${index}`, 'smokehouse', 1);
  smokehouse.x = index % 200;
  smokehouse.preservedFood = index % 7;
  smokehouse.salt = index % 3;
  smokehouse.pottery = index % 2;
  perfState.buildings.set(smokehouse.id, smokehouse);
}
const started = performance.now();
const perfPlan = computeSettlementPreservationReservePlan(perfState, {
  sabbathObserved: false,
  roadComponentFor: (candidate) => Math.floor(candidate.x / 2),
});
const elapsedMs = performance.now() - started;
assert.equal(perfPlan.tierThreeResidents, 50_000);
assert.equal(perfPlan.targetBranches, 100);
assert.ok(
  elapsedMs < 750,
  `100,000-entity preservation reserve planning took ${elapsedMs.toFixed(1)} ms`,
);

console.log(
  `settlement preservation reserve tests passed (${elapsedMs.toFixed(1)} ms for 100,000 entities across 100 branches)`,
);

function approx(actual: number, expected: number, message?: string): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    message ?? `expected ${actual} to equal ${expected}`,
  );
}

function building(
  id: string,
  kind: BuildingKind,
  assignedLabor: number,
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
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    polearms: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor,
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
  };
}

function residence(
  id: string,
  population: number,
  preservedFood: number,
): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: population,
    tier: 3,
    settlementTicks: 0,
    needs: {
      firewood: { stock: 0, deficitSeconds: 0 },
      water: { stock: 0, deficitSeconds: 0 },
      food: { stock: 0, deficitSeconds: 0 },
      preservedFood: { stock: preservedFood, deficitSeconds: 0 },
      ale: { stock: 0, deficitSeconds: 0 },
      cloth: { stock: 0, deficitSeconds: 0 },
      pottery: { stock: 0, deficitSeconds: 0 },
    },
    abandoned: false,
    householdWealth: 0,
  };
}

function deliveryTrip(options: {
  id: string;
  originId: string;
  residenceId: string;
  cargoKind: DeliveryTripState['cargoKind'];
  amount: number;
  phase: DeliveryTripState['phase'];
}): DeliveryTripState {
  return {
    id: options.id,
    buildingId: options.originId,
    residenceId: options.residenceId,
    destinationKind: 'residence',
    targetBuildingId: null,
    cargoKind: options.cargoKind,
    amount: options.amount,
    phase: options.phase,
    x: 0,
    z: 0,
    progress: 0,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 1,
    deliveryWorkers: 1,
    freeHaulerWorkers: 0,
    pathDistance: 1,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[]',
  };
}

function fireIncident(
  id: string,
  targetKind: FireIncidentState['targetKind'],
  targetId: string,
): FireIncidentState {
  return {
    id,
    targetKind,
    targetId,
    x: 0,
    z: 0,
    ignitionSource: 'accident',
    status: 'burning',
    intensity: 1,
    damage: 0,
    waterDelivered: 0,
    requiredWater: 10,
    extinguishChance: 0,
    startedTick: 0,
    discoveredTick: 0,
    lastWaterTick: 0,
    resolvedTick: 0,
    responseWellId: null,
  };
}

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: createEmptyStockpile(),
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
