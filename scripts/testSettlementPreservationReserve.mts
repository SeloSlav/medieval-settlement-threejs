import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  PRESERVED_FOOD_SPOILAGE_PER_DAY,
  PRESERVED_FOOD_STORAGE_CART_FACTOR,
  PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
  PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
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
import { householdFoodPerDay } from '../src/economy/foodInventory.ts';
import { renderPreservationReserveRows } from '../src/resources/inspector/townHallRenderer.ts';
import {
  createEmptyStockpile,
  type BuildingKind,
  type BuildingState,
  type GameState,
  type ResourceNodeState,
  type ResidenceState,
} from '../src/resources/types.ts';

const oneResidentFallbackPerDay = householdFoodPerDay(1);
const reserveTarget = (
  demandPerDay: number,
  storageFactor: number,
  ambientSpoilagePerDay = PRESERVED_FOOD_SPOILAGE_PER_DAY,
): number => {
  const spoilage =
    ambientSpoilagePerDay * storageFactor;
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
assert.equal(targetPlan.tierFourResidents, 2);
assert.equal(targetPlan.targetBranches, 1);
assert.equal(targetPlan.shortBranches, 1);
assert.equal(targetPlan.branchesWithoutSmokehouse, 1);
assert.equal(targetPlan.productionDaysToTarget, Number.POSITIVE_INFINITY);
const winterTargetPlan = computeSettlementPreservationReservePlan(targetState, {
  sabbathObserved: false,
  roadComponentFor: () => 'core',
  preservedFoodSpoilageFractionPerDay:
    PRESERVED_FOOD_SPOILAGE_PER_DAY * 0.5,
});
approx(
  winterTargetPlan.targetStock,
  reserveTarget(
    oneResidentFallbackPerDay * 2,
    PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
    PRESERVED_FOOD_SPOILAGE_PER_DAY * 0.5,
  ),
);
assert.ok(
  winterTargetPlan.targetStock < targetPlan.targetStock,
  'cold-season reserve targets must retain less replacement stock for aging losses',
);

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
remoteSmokehouse.curedMeat = emptyBranchTarget * 2;
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
    cargoKind: 'curedMeat',
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
    cargoKind: 'smokedFish',
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
burningStore.cheese = 7;
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
assert.equal(firePlan.tierFourResidents, 1);
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

const localSaltState = emptyGameState();
localSaltState.physicalFoundingSiteEnabled = true;
localSaltState.residences.set(
  'local-salt-home',
  residence('local-salt-home', 1, 0),
);
localSaltState.buildings.set(
  'local-salt-smokehouse',
  building('local-salt-smokehouse', 'smokehouse', 1),
);
const localSaltMine = building('local-salt-mine', 'mine', 4);
localSaltMine.timber = 1;
localSaltState.buildings.set(localSaltMine.id, localSaltMine);
localSaltState.quarries.set(
  'local-rich-salt',
  mineralDeposit('local-rich-salt', 'salt', 0, 0, 0, 1_080, true),
);
const localSaltPlan = computeSettlementPreservationReservePlan(
  localSaltState,
  {
    sabbathObserved: false,
    roadComponentFor: () => 'core',
  },
);
assert.equal(localSaltPlan.staffedSaltMines, 1);
assert.ok(localSaltPlan.localSaltOutputPerDay > 0);
approx(localSaltPlan.localSaltProduction, localSaltPlan.saltRequired);
approx(localSaltPlan.saltImportShortfall, 0);
assert.equal(localSaltPlan.saltImportLots, 0);
assert.equal(localSaltPlan.firstSaltMineId, localSaltMine.id);

const finiteSaltState = emptyGameState();
finiteSaltState.physicalFoundingSiteEnabled = true;
finiteSaltState.residences.set(
  'finite-salt-home',
  residence('finite-salt-home', 1, 0),
);
finiteSaltState.buildings.set(
  'finite-salt-smokehouse',
  building('finite-salt-smokehouse', 'smokehouse', 1),
);
const finiteSaltMine = building('finite-salt-pit', 'stone_quarry', 4);
finiteSaltState.buildings.set(finiteSaltMine.id, finiteSaltMine);
finiteSaltState.quarries.set(
  'finite-salt-seam',
  mineralDeposit('finite-salt-seam', 'salt', 0, 0, 0.25, 300, false),
);
const finiteSaltPlan = computeSettlementPreservationReservePlan(
  finiteSaltState,
  {
    sabbathObserved: false,
    roadComponentFor: () => 'core',
  },
);
approx(finiteSaltPlan.localSaltProduction, 0.25);
approx(
  finiteSaltPlan.saltImportShortfall,
  Math.max(0, finiteSaltPlan.saltRequired - 0.25),
);

const layeredSaltState = emptyGameState();
layeredSaltState.physicalFoundingSiteEnabled = true;
layeredSaltState.residences.set(
  'layered-salt-home',
  residence('layered-salt-home', 1, 0),
);
layeredSaltState.buildings.set(
  'layered-salt-smokehouse',
  building('layered-salt-smokehouse', 'smokehouse', 1),
);
const layeredSaltPit = building('layered-salt-pit', 'stone_quarry', 1);
const layeredSaltMineworks = building('layered-salt-mineworks', 'mine', 1);
layeredSaltMineworks.timber = 1;
layeredSaltState.buildings.set(layeredSaltPit.id, layeredSaltPit);
layeredSaltState.buildings.set(layeredSaltMineworks.id, layeredSaltMineworks);
layeredSaltState.quarries.set(
  'layered-rich-salt',
  mineralDeposit('layered-rich-salt', 'salt', 0, 0, 0.25, 300, true),
);
const layeredSaltPlan = computeSettlementPreservationReservePlan(
  layeredSaltState,
  {
    sabbathObserved: false,
    roadComponentFor: () => 'core',
  },
);
assert.equal(layeredSaltPlan.staffedSaltMines, 2);
assert.ok(
  layeredSaltPlan.localSaltProduction > 0.25,
  'Mineworks deep output must not be overwritten or capped by the same rich marker\'s finite Mining Camp surface row',
);
assert.equal(layeredSaltPlan.saltImportShortfall, 0);
layeredSaltState.buildings.delete(layeredSaltMineworks.id);
const layeredSurfaceOnlyPlan = computeSettlementPreservationReservePlan(
  layeredSaltState,
  {
    sabbathObserved: false,
    roadComponentFor: () => 'core',
  },
);
assert.ok(
  layeredSaltPlan.localSaltProduction > layeredSurfaceOnlyPlan.localSaltProduction,
  'the finite surface and non-depleting deep forecasts must coexist as distinct sources',
);

const remoteSaltState = emptyGameState();
remoteSaltState.physicalFoundingSiteEnabled = true;
remoteSaltState.residences.set(
  'remote-salt-home',
  residence('remote-salt-home', 1, 0),
);
remoteSaltState.buildings.set(
  'remote-salt-smokehouse',
  building('remote-salt-smokehouse', 'smokehouse', 1),
);
const remoteSaltMine = building('remote-salt-mine', 'mine', 4);
remoteSaltMine.x = 100;
remoteSaltMine.salt = 12;
remoteSaltMine.timber = 1;
remoteSaltState.buildings.set(remoteSaltMine.id, remoteSaltMine);
remoteSaltState.quarries.set(
  'remote-rich-salt',
  mineralDeposit('remote-rich-salt', 'salt', 100, 0, 0, 1_080, true),
);
const remoteSaltPlan = computeSettlementPreservationReservePlan(
  remoteSaltState,
  {
    sabbathObserved: false,
    roadComponentFor: (candidate) => candidate.x < 50 ? 'core' : 'remote',
  },
);
assert.equal(remoteSaltPlan.staffedSaltMines, 0);
approx(remoteSaltPlan.saltStock, 0);
approx(remoteSaltPlan.localSaltProduction, 0);
approx(remoteSaltPlan.saltImportShortfall, remoteSaltPlan.saltRequired);

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
assert.match(rendered, /Salt supply/);
assert.match(rendered, /no staffed same-branch salt extraction site/);
assert.doesNotMatch(rendered, /Preserving vessels/);
assert.match(rendered, /data-inspect-residence="recipe-home"/);
assert.match(rendered, /data-inspect-building="recipe-smokehouse"/);
assert.match(rendered, /data-inspect-building="recipe-market"/);
assert.match(
  rendered,
  new RegExp(`&asymp; ${(recipePlan.saltImportLots * 14).toFixed(0)} gold`),
);
assert.match(rendered, /repeated imports can tighten the regional rate/);
assert.doesNotMatch(rendered, /pottery|kiln cart priorities decide/i);
assert.match(rendered, /including cured-stock aging while the reserve builds/);
assert.doesNotMatch(rendered, /Adriatic salt burden/);

const localSaltRows = renderPreservationReserveRows(localSaltPlan, 14);
assert.match(localSaltRows, /forecast from 1 staffed same-branch salt extraction site/);
assert.match(localSaltRows, /no Adriatic import required/);
assert.match(localSaltRows, /market import reserve not needed/);
assert.match(localSaltRows, /data-inspect-building="local-salt-mine"/);
assert.doesNotMatch(localSaltRows, /repeated imports can tighten/);

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
  /monthly_food\s*=\s*Some\(consume_monthly_food_slots\(&mut residence, tier\)\)/,
  'the planner target must remain tied to the authoritative monthly meal path',
);
assert.match(
  residenceNeedAuthority,
  /ResidenceNeedKind::SavoryPreserves[\s\S]*preserved\.deficit_ticks\s*=\s*u32::from\(!result\.preserved_slot_met\)/,
  'savory-preserve status should remain tied to the shared monthly meal withdrawal',
);
assert.match(
  residenceNeedAuthority,
  /tier\s*>=\s*4[\s\S]*first_food_for_slot\(residence, \*slot, true\)[\s\S]*preserved_slot_met\s*=\s*true/,
);
assert.match(
  residenceNeedAuthority,
  /all_slots_met:\s*slots_consumed as usize == slots\.len\(\) && preserved_slot_met/,
  'the savory-preserve ration must replace a normal category slot instead of adding a second meal',
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
assert.match(townHallSource, /before tier-4 promotions/);
assert.match(townHallSource, /winter design peak/);
assert.match(townHallSource, /rotated rations displace the same fresh-food calories/);
assert.match(residenceSource, /Prosperity planning load/);
assert.match(residenceSource, /winter-peak savory preserves/);

const perfState = emptyGameState();
perfState.physicalFoundingSiteEnabled = true;
for (let index = 0; index < 50_000; index += 1) {
  const home = residence(`perf-home-${index}`, 1, index % 5);
  home.x = index % 200;
  perfState.residences.set(home.id, home);
  const smokehouse = building(`perf-smokehouse-${index}`, 'smokehouse', 1);
  smokehouse.x = index % 200;
  smokehouse.curedMeat = index % 7;
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
assert.equal(perfPlan.tierFourResidents, 50_000);
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
    curedMeat: 0,
    smokedFish: 0,
    cheese: 0,
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
  savoryPreserves: number,
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
    tier: 4,
    settlementTicks: 0,
    needs: {
      firewood: { stock: 0, deficitSeconds: 0 },
      water: { stock: 0, deficitSeconds: 0 },
      food: { stock: 0, deficitSeconds: 0 },
      savoryPreserves: { stock: savoryPreserves, deficitSeconds: 0 },
      ale: { stock: 0, deficitSeconds: 0 },
      cloth: { stock: 0, deficitSeconds: 0 },
      pottery: { stock: 0, deficitSeconds: 0 },
    },
    abandoned: false,
    householdWealth: 0,
    curedMeat: savoryPreserves,
  };
}

function mineralDeposit(
  nodeId: string,
  resource: 'iron' | 'salt',
  x: number,
  z: number,
  remaining: number,
  maxYield: number,
  isRich: boolean,
): ResourceNodeState {
  return {
    nodeId,
    kind: 'quarry',
    resource,
    x,
    z,
    remaining,
    maxYield,
    isRich,
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
    stableOxen: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}
