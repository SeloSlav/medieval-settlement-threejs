import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  BUILDING_STORAGE_CAPS,
  CALENDAR_SECONDS_PER_DAY,
  CHAPEL_CHARITY_GOLD_PER_DAY,
  CHAPEL_CHARITY_MIN_COFFER_GOLD,
  CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH,
  CHAPEL_POOR_RELIEF_INTERVAL_DAYS,
  RESIDENCE_FOOD_CAPACITY,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../src/economy/regionalMarket.ts';
import { DEFAULT_PARISH_POLICY } from '../src/economy/chapelParish.ts';
import { buildVillageAdminReadout } from '../src/economy/villageAdminReadout.ts';
import {
  chapelPoorReliefDaysUntilDispatch,
  computeSettlementParishReliefPlan,
  formatChapelDailyAlms,
  formatChapelParishTerritory,
  formatChapelPoorRelief,
  formatSettlementParishCoverage,
  formatSettlementParishRelief,
  isChapelPoorReliefDue,
} from '../src/economy/settlementParishRelief.ts';
import { findServingChapel } from '../src/logistics/landmarkAccess.ts';
import { destinationKindFromId } from '../src/logistics/deliveryTrips.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';
import type { WorldQueries } from '../src/resources/WorldQueries.ts';
import { gameClock } from '../src/world/gameCalendar.ts';

const dayTicks = Math.round(CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS);
const mondayTick = dayTicks;

function building(
  id: string,
  kind: BuildingState['kind'],
  x: number,
  overrides: Partial<BuildingState> = {},
): BuildingState {
  return {
    id,
    kind,
    x,
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
    gold: 0,
    waterCapacity: 48,
    assignedLabor: 0,
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
    storehouseAcceptsTimber: false,
    storehouseAcceptsStone: false,
    storehouseAcceptsFirewood: false,
    ...overrides,
  };
}

function chapel(
  id: string,
  x: number,
  overrides: Partial<BuildingState> = {},
): BuildingState {
  return building(id, 'chapel', x, {
    assignedLabor: 1,
    gold: 150,
    ...overrides,
  });
}

function market(
  id: string,
  x: number,
  overrides: Partial<BuildingState> = {},
): BuildingState {
  return building(id, 'marketplace', x, overrides);
}

function home(
  id: string,
  x: number,
  overrides: Partial<ResidenceState> = {},
): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x,
    z: 0,
    yaw: 0,
    population: 4,
    populationCapacity: 5,
    tier: 1,
    settlementTicks: 0,
    needs: createDefaultNeeds(),
    abandoned: false,
    householdWealth: 20,
    lastHouseholdMarketTick: 0,
    ...overrides,
  };
}

function state(input: {
  tick?: number;
  buildings?: BuildingState[];
  homes?: ResidenceState[];
}): GameState {
  return {
    seed: 1,
    tick: input.tick ?? mondayTick,
    stockpile: {
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
      gold: 0,
    },
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(
      (input.buildings ?? []).map((entry) => [entry.id, entry]),
    ),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(
      (input.homes ?? []).map((residence) => [residence.id, residence]),
    ),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    physicalFoundingSiteEnabled: true,
    nextBuildingId: 1,
  };
}

function network(
  distanceFor: (
    originX: number,
    originZ: number,
    targetX: number,
    targetZ: number,
  ) => number | null,
): RoadNetwork {
  return {
    getPathfinder: () => ({
      roadPathDistancesFrom: (
        originX: number,
        originZ: number,
        targets: readonly { x: number; z: number }[],
      ) => targets.map((target) =>
        distanceFor(originX, originZ, target.x, target.z)),
      roadPathDistance: (
        originX: number,
        originZ: number,
        targetX: number,
        targetZ: number,
      ) => distanceFor(originX, originZ, targetX, targetZ),
    }),
  } as unknown as RoadNetwork;
}

const euclideanNetwork = network(
  (originX, originZ, targetX, targetZ) =>
    Math.hypot(targetX - originX, targetZ - originZ),
);

assert.equal(isChapelPoorReliefDue(0), false);
assert.equal(isChapelPoorReliefDue(mondayTick), true);
assert.equal(isChapelPoorReliefDue(dayTicks * 2), false);
assert.equal(
  isChapelPoorReliefDue(dayTicks * (CHAPEL_POOR_RELIEF_INTERVAL_DAYS + 1)),
  true,
);
assert.equal(chapelPoorReliefDaysUntilDispatch(0), 1);

const tieHome = home('home-tie', 50);
const tieLow = chapel('1', 0);
const tieHigh = chapel('2', 100);
assert.equal(
  findServingChapel(
    tieHome,
    [tieHigh, tieLow],
    (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az),
  )?.id,
  '1',
  'equal road routes must resolve to the stable lower chapel id',
);
const nearHome = home('home-near', 85);
assert.equal(
  findServingChapel(
    nearHome,
    [tieLow, tieHigh],
    (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az),
  )?.id,
  '2',
  'the shortest exact road route must define the serving parish',
);

const poor = home('poor', 18, { householdWealth: 2 });
const comfortable = home('comfortable', 22, { householdWealth: 20 });
const abandoned = home('abandoned', 25, {
  abandoned: true,
  population: 0,
  householdWealth: 0,
});
const readyState = state({
  buildings: [chapel('chapel', 0), market('market', 10)],
  homes: [comfortable, poor, abandoned],
});
const readyPlan = computeSettlementParishReliefPlan({
  state: readyState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
const readyParish = readyPlan.parishes.get('chapel');
assert.equal(readyParish?.assignedHomes, 3);
assert.equal(readyParish?.assignedPopulation, 8);
assert.equal(readyParish?.almsRecipientId, 'poor');
assert.equal(readyParish?.almsStatus, 'ready');
assert.equal(readyParish?.almsAmount, CHAPEL_CHARITY_GOLD_PER_DAY);
assert.equal(readyParish?.almsRoadDistance, 18);
assert.equal(readyParish?.targetResidenceId, 'abandoned');
assert.equal(readyParish?.marketplaceId, 'market');
assert.equal(readyParish?.reliefBudget, CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH);
assert.equal(readyParish?.quote?.offerId, 'buy_pork');
assert.equal(readyParish?.status, 'ready');
assert.equal(readyPlan.readyParishes, 1);
assert.equal(readyPlan.almsDueParishes, 1);
assert.equal(readyPlan.almsBlockedParishes, 0);
assert.match(formatChapelDailyAlms(readyParish!), /18 m road/);
assert.match(formatChapelDailyAlms(readyParish!), /one free villager/);
assert.match(formatChapelPoorRelief(readyParish!), /dispatching this Monday/);
assert.equal(destinationKindFromId(3), 'wealth');

const almsTripState = state({
  buildings: [chapel('chapel', 0), market('market', 10)],
  homes: [poor, abandoned],
});
almsTripState.deliveryTrips.set('alms-trip', {
  id: 'alms-trip',
  buildingId: 'chapel',
  residenceId: 'poor',
  destinationKind: 'wealth',
  cargoKind: 'gold',
  amount: CHAPEL_CHARITY_GOLD_PER_DAY,
  phase: 'outbound',
} as GameState['deliveryTrips'] extends Map<string, infer Trip> ? Trip : never);
const almsTripPlan = computeSettlementParishReliefPlan({
  state: almsTripState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
const travellingAlms = almsTripPlan.parishes.get('chapel');
assert.equal(travellingAlms?.almsStatus, 'in-transit');
assert.equal(travellingAlms?.almsTripId, 'alms-trip');
assert.equal(almsTripPlan.activeAlmsTrips, 1);
assert.equal(almsTripPlan.almsGoldInTransit, CHAPEL_CHARITY_GOLD_PER_DAY);
assert.match(formatChapelDailyAlms(travellingAlms!), /purse en route/);

const coolingState = state({
  buildings: [chapel('chapel', 0, { actionCooldown: 35 })],
  homes: [poor],
});
const coolingPlan = computeSettlementParishReliefPlan({
  state: coolingState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
const coolingAlms = coolingPlan.parishes.get('chapel');
assert.equal(coolingAlms?.almsStatus, 'cooling-down');
assert.match(formatChapelDailyAlms(coolingAlms!), /0.5 parish workdays/);

const chapelBusyState = state({
  buildings: [chapel('chapel', 0)],
  homes: [poor],
});
chapelBusyState.deliveryTrips.set('treasury-trip', {
  id: 'treasury-trip',
  buildingId: 'chapel',
  destinationKind: 'building',
  cargoKind: 'gold',
  amount: 25,
  phase: 'outbound',
} as GameState['deliveryTrips'] extends Map<string, infer Trip> ? Trip : never);
const chapelBusyPlan = computeSettlementParishReliefPlan({
  state: chapelBusyState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
assert.equal(
  chapelBusyPlan.parishes.get('chapel')?.almsStatus,
  'chapel-cart-busy',
);
assert.equal(chapelBusyPlan.almsDueParishes, 1);
assert.equal(chapelBusyPlan.almsBlockedParishes, 1);

const legacyAlmsState = state({
  buildings: [chapel('chapel', 0)],
  homes: [poor],
});
legacyAlmsState.physicalFoundingSiteEnabled = false;
const legacyAlmsPlan = computeSettlementParishReliefPlan({
  state: legacyAlmsState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
assert.equal(legacyAlmsPlan.parishes.get('chapel')?.almsStatus, 'legacy');
assert.match(
  formatChapelDailyAlms(legacyAlmsPlan.parishes.get('chapel')!),
  /gold\/day/,
);

const notDueState = state({
  tick: dayTicks * 2,
  buildings: [chapel('chapel', 0), market('market', 10)],
  homes: [poor, abandoned],
});
const notDuePlan = computeSettlementParishReliefPlan({
  state: notDueState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(notDueState.tick),
  sabbathObserved: false,
});
assert.equal(notDuePlan.parishes.get('chapel')?.status, 'not-due');

const shortCoffer = computeSettlementParishReliefPlan({
  state: state({
    buildings: [
      chapel('chapel', 0, { gold: CHAPEL_CHARITY_MIN_COFFER_GOLD - 0.1 }),
      market('market', 10),
    ],
    homes: [abandoned],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
assert.equal(
  shortCoffer.parishes.get('chapel')?.status,
  'below-coffer-threshold',
);
assert.equal(shortCoffer.reserveShortParishes, 1);

const marketDisconnectedNetwork = network(
  (originX, originZ, targetX, targetZ) =>
    originX === 10 ? null : Math.hypot(targetX - originX, targetZ - originZ),
);
const noMarketRoute = computeSettlementParishReliefPlan({
  state: readyState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: marketDisconnectedNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
assert.equal(
  noMarketRoute.parishes.get('chapel')?.status,
  'no-market-route',
);

const fullHome = home('full-home', 25, {
  abandoned: true,
  population: 0,
});
fullHome.needs.food.stock = RESIDENCE_FOOD_CAPACITY;
const householdFull = computeSettlementParishReliefPlan({
  state: state({
    buildings: [chapel('chapel', 0), market('market', 10)],
    homes: [fullHome],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
assert.equal(
  householdFull.parishes.get('chapel')?.status,
  'household-storage-full',
);

const marketFull = computeSettlementParishReliefPlan({
  state: state({
    buildings: [
      chapel('chapel', 0),
      market('market', 10, {
        food: BUILDING_STORAGE_CAPS.marketplace.food,
      }),
    ],
    homes: [abandoned],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
assert.equal(
  marketFull.parishes.get('chapel')?.status,
  'market-storage-full',
);

const busyState = state({
  buildings: [chapel('chapel', 0), market('market', 10)],
  homes: [abandoned],
});
busyState.deliveryTrips.set('trip', {
  id: 'trip',
  buildingId: 'market',
} as GameState['deliveryTrips'] extends Map<string, infer Trip> ? Trip : never);
const marketBusy = computeSettlementParishReliefPlan({
  state: busyState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
assert.equal(
  marketBusy.parishes.get('chapel')?.status,
  'market-cart-busy',
);

const marketFireState = state({
  buildings: [chapel('chapel', 0), market('burned-market', 10)],
  homes: [abandoned],
});
marketFireState.fireIncidents.set('market-fire', {
  id: 'market-fire',
  targetKind: 'building',
  targetId: 'burned-market',
} as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
const marketFireBlocked = computeSettlementParishReliefPlan({
  state: marketFireState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
assert.equal(
  marketFireBlocked.parishes.get('chapel')?.status,
  'market-fire-disabled',
);
assert.equal(
  marketFireBlocked.parishes.get('chapel')?.marketplaceId,
  'burned-market',
);
assert.equal(marketFireBlocked.marketFireBlockedParishes, 1);
assert.match(
  formatChapelPoorRelief(marketFireBlocked.parishes.get('chapel')!),
  /marketplace is fire-damaged/,
);

const marketFireFallbackState = state({
  buildings: [
    chapel('chapel', 0),
    market('burned-near-market', 10),
    market('safe-far-market', 100),
  ],
  homes: [abandoned],
});
marketFireFallbackState.fireIncidents.set('near-market-fire', {
  id: 'near-market-fire',
  targetKind: 'building',
  targetId: 'burned-near-market',
} as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
const marketFireFallback = computeSettlementParishReliefPlan({
  state: marketFireFallbackState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
assert.equal(
  marketFireFallback.parishes.get('chapel')?.marketplaceId,
  'safe-far-market',
);
assert.equal(marketFireFallback.parishes.get('chapel')?.status, 'ready');

const chapelFireState = state({
  buildings: [chapel('burned-chapel', 0, { gold: 175 }), market('market', 10)],
  homes: [poor],
});
chapelFireState.fireIncidents.set('chapel-fire', {
  id: 'chapel-fire',
  targetKind: 'building',
  targetId: 'burned-chapel',
} as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
const chapelFirePlan = computeSettlementParishReliefPlan({
  state: chapelFireState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
const burnedParish = chapelFirePlan.parishes.get('burned-chapel');
assert.equal(chapelFirePlan.completedChapels, 1);
assert.equal(chapelFirePlan.activeParishes, 0);
assert.equal(chapelFirePlan.fireDisabledChapels, 1);
assert.equal(chapelFirePlan.reconstructingChapels, 0);
assert.equal(chapelFirePlan.structurallyQuarantinedCofferGold, 175);
assert.equal(chapelFirePlan.firstUnavailableChapelId, 'burned-chapel');
assert.equal(burnedParish?.status, 'fire-disabled');
assert.equal(burnedParish?.assignedHomes, 0);
assert.match(formatChapelParishTerritory(burnedParish!), /structural recovery/);
assert.match(formatChapelDailyAlms(burnedParish!), /coffer sealed/);
assert.match(formatSettlementParishCoverage(chapelFirePlan), /fire-disabled/);
assert.match(formatSettlementParishRelief(chapelFirePlan), /175.0 sealed gold/);

const reconstructionPlan = computeSettlementParishReliefPlan({
  state: state({
    buildings: [
      chapel('reconstructing-chapel', 0, {
        constructionComplete: false,
        gold: 90,
      }),
    ],
    homes: [comfortable],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
assert.equal(reconstructionPlan.completedChapels, 0);
assert.equal(reconstructionPlan.activeParishes, 0);
assert.equal(reconstructionPlan.fireDisabledChapels, 0);
assert.equal(reconstructionPlan.reconstructingChapels, 1);
assert.equal(reconstructionPlan.structurallyQuarantinedCofferGold, 90);
assert.equal(
  reconstructionPlan.firstUnavailableChapelId,
  'reconstructing-chapel',
);
assert.match(formatSettlementParishRelief(reconstructionPlan), /90.0 sealed gold/);

const fireDisabledPoor = home('fire-disabled-poor', 18, {
  householdWealth: 0,
});
const fireDisabledAbandoned = home('fire-disabled-abandoned', 24, {
  abandoned: true,
  population: 0,
  householdWealth: 0,
});
const householdFireState = state({
  buildings: [chapel('chapel', 0), market('market', 10)],
  homes: [comfortable, fireDisabledPoor, fireDisabledAbandoned],
});
for (const residence of [fireDisabledPoor, fireDisabledAbandoned]) {
  householdFireState.fireIncidents.set(`fire-${residence.id}`, {
    id: `fire-${residence.id}`,
    targetKind: 'residence',
    targetId: residence.id,
  } as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
}
const householdFirePlan = computeSettlementParishReliefPlan({
  state: householdFireState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
const operationalParish = householdFirePlan.parishes.get('chapel');
assert.equal(operationalParish?.assignedHomes, 1);
assert.equal(operationalParish?.assignedPopulation, comfortable.population);
assert.equal(operationalParish?.almsRecipientId, comfortable.id);
assert.equal(operationalParish?.reliefHomes, 0);
assert.equal(operationalParish?.targetResidenceId, null);
assert.equal(operationalParish?.status, 'no-relief-home');
assert.equal(householdFirePlan.fireDisabledHomes, 2);
assert.equal(householdFirePlan.fireDisabledResidents, fireDisabledPoor.population);
assert.equal(householdFirePlan.fireDisabledReliefHomes, 1);
assert.equal(householdFirePlan.unassignedHomes, 0);
assert.match(
  formatSettlementParishCoverage(householdFirePlan),
  /2 fire-disabled homes/,
);

const adminFireState = state({
  buildings: [
    chapel('safe-chapel', 0, { gold: 25 }),
    chapel('burned-chapel', 100, { gold: 175 }),
  ],
  homes: [comfortable, fireDisabledPoor],
});
adminFireState.fireIncidents.set('admin-chapel-fire', {
  id: 'admin-chapel-fire',
  targetKind: 'building',
  targetId: 'burned-chapel',
} as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
adminFireState.fireIncidents.set('admin-home-fire', {
  id: 'admin-home-fire',
  targetKind: 'residence',
  targetId: fireDisabledPoor.id,
} as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
const adminReadout = buildVillageAdminReadout({
  gameState: adminFireState,
  worldQueries: {
    getRoadNetworkSnapshot: () => euclideanNetwork,
  } as unknown as WorldQueries,
  taxRate: 0.2,
  parishPolicy: DEFAULT_PARISH_POLICY,
});
assert.match(
  adminReadout.cofferBalanceLabel,
  /25.0 gold collectable \/ 200.0 owned · 175.0 sealed pending structural recovery/,
);
assert.match(adminReadout.chapelTitheLabel, /gold \/ day/);

const perfChapels = Array.from(
  { length: 8 },
  (_, index) => chapel(`chapel-${index}`, index * 1_000),
);
const perfMarkets = Array.from(
  { length: 8 },
  (_, index) => market(`market-${index}`, index * 1_000 + 10),
);
const perfHomes = Array.from(
  { length: 100_000 },
  (_, index) => home(
    `home-${index}`,
    (index % 8) * 1_000 + 20,
    Math.floor(index / 8) % 10 === 0
      ? { abandoned: true, population: 0, householdWealth: 0 }
      : { householdWealth: index % 30 },
  ),
);
const perfState = state({
  buildings: [...perfChapels, ...perfMarkets],
  homes: perfHomes,
});
for (let index = 0; index < perfHomes.length; index += 1) {
  if (Math.floor(index / 8) % 4 !== 0) continue;
  const residence = perfHomes[index];
  perfState.fireIncidents.set(`fire-${residence.id}`, {
    id: `fire-${residence.id}`,
    targetKind: 'residence',
    targetId: residence.id,
  } as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
}
const perfStart = performance.now();
const perfPlan = computeSettlementParishReliefPlan({
  state: perfState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: gameClock(mondayTick),
  sabbathObserved: false,
});
const perfMs = performance.now() - perfStart;
assert.equal(perfPlan.activeParishes, 8);
assert.equal(perfPlan.assignedHomes, 75_000);
assert.equal(perfPlan.fireDisabledHomes, 25_000);
assert.equal(
  perfPlan.reliefHomes,
  perfHomes.filter(
    (residence, index) =>
      residence.abandoned && Math.floor(index / 8) % 4 !== 0,
  ).length,
);
assert.equal(perfPlan.readyParishes, 8);
assert.ok(
  perfMs < 2_500,
  `100,000 homes with 25,000 fire outages across 8 parishes and markets took ${perfMs.toFixed(1)} ms`,
);
const adminPerfStart = performance.now();
const adminPerf = buildVillageAdminReadout({
  gameState: perfState,
  worldQueries: {
    getRoadNetworkSnapshot: () => euclideanNetwork,
  } as unknown as WorldQueries,
  taxRate: 0.2,
  parishPolicy: DEFAULT_PARISH_POLICY,
});
const adminPerfMs = performance.now() - adminPerfStart;
assert.match(adminPerf.chapelTitheLabel, /gold \/ day/);
assert.ok(
  adminPerfMs < 2_500,
  `100,000-home fire-aware tithe readout took ${adminPerfMs.toFixed(1)} ms`,
);

const serverParish = readFileSync(
  'server/src/simulation/chapel_parish.rs',
  'utf8',
);
assert.match(serverParish, /chapel_poor_relief_due\(sim_tick\)/);
assert.match(serverParish, /claim_residences_by_nearest_supplier\(/);
assert.match(serverParish, /tick\.chapel_for_residence\(ctx,/);
assert.match(serverParish, /building_disabled_by_fire\(ctx, building\.id\)/);
assert.match(serverParish, /physical_founding_site_enabled/);
assert.match(serverParish, /try_chapel_alms_delivery/);
assert.match(serverParish, /try_start_residence_wealth_trip/);
assert.match(serverParish, /action_cooldown/);
assert.match(
  serverParish,
  /else \{[\s\S]{0,600}distribute_wealth_charity/,
  'legacy saves must retain direct charity when the physical economy is disabled',
);
assert.doesNotMatch(serverParish, /CHAPEL_CHARITY_(?:RELIEF|WEALTH)_FRACTION/);
assert.match(
  serverParish,
  /let relief_spent =[\s\S]{0,800}try_chapel_poor_relief[\s\S]{0,800}withdraw_coffer_in_place\(&mut chapel_row, relief_spent\)/,
  'the coffer must be debited only after a physical relief cart departs',
);

const deliveryTrips = readFileSync(
  'server/src/simulation/delivery_trips.rs',
  'utf8',
);
assert.match(
  deliveryTrips,
  /DELIVERY_DESTINATION_RESIDENCE_WEALTH: u8 = 3/,
);
assert.match(deliveryTrips, /TripDestination::ResidenceWealth/);
assert.match(deliveryTrips, /try_start_residence_wealth_trip/);
assert.match(
  deliveryTrips,
  /fn unload_wealth_to_residence[\s\S]{0,1800}credit_residence_wealth[\s\S]{0,900}record_parish_ledger/,
  'parish charity must enter the ledger only after a household physically receives the gold',
);

const tickContext = readFileSync(
  'server/src/simulation/tick_context.rs',
  'utf8',
);
assert.match(tickContext, /chapel_claims:/);
assert.match(tickContext, /claim_residences_by_nearest_supplier\(/);

const householdWealth = readFileSync(
  'server/src/economy/household_wealth.rs',
  'utf8',
);
assert.match(
  householdWealth,
  /credit_residence_wealth[\s\S]{0,120}-> f64/,
  'daily alms accounting must use the amount actually credited under the wealth cap',
);

const chapelInspector = readFileSync(
  'src/resources/inspector/chapelRenderer.ts',
  'utf8',
);
assert.match(chapelInspector, /Parish territory/);
assert.match(chapelInspector, /Monday poor relief/);
assert.match(chapelInspector, /visible purse carried by a free villager/);
assert.match(chapelInspector, /Daily alms purse/);
assert.match(chapelInspector, /sealed until structural recovery/);

const buildingReducers = readFileSync(
  'server/src/reducers/buildings.rs',
  'utf8',
);
assert.match(
  buildingReducers,
  /collect_chapel_coffer[\s\S]{0,1600}building_fire_state\(ctx, building_id\)[\s\S]{0,300}sealed coffer/,
  'manual collection must not bypass the fire quarantine on chapel gold',
);

const worldQueries = readFileSync(
  'src/resources/WorldQueries.ts',
  'utf8',
);
assert.match(
  worldQueries,
  /getServingChapelForResidence[\s\S]{0,300}fireDisabledResidenceIds/,
  'client parish claims must exclude fire-disabled residences like the server tick cache',
);

const townHallInspector = readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
assert.match(townHallInspector, /Parish territories/);
assert.match(townHallInspector, /Parish alms carts/);
assert.match(townHallInspector, /Monday poor relief/);
assert.match(townHallInspector, /Parish structural outages/);
assert.match(townHallInspector, /coffer gold sealed until structural recovery/);

const residenceInspector = readFileSync(
  'src/resources/inspector/residenceRenderer.ts',
  'utf8',
);
assert.match(
  residenceInspector,
  /no tithe, alms, or relief claim until structural recovery/,
);

console.log(
  `parish relief territory, fire quarantine, cadence, blocker, and performance tests passed (${perfMs.toFixed(1)} ms relief + ${adminPerfMs.toFixed(1)} ms tithe for 100,000 homes / 25,000 outages / 8 parishes / 8 markets)`,
);
