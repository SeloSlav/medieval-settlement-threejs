import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  BUILDING_STORAGE_CAPS,
  CALENDAR_SECONDS_PER_DAY,
  CHAPEL_CHARITY_MIN_COFFER_GOLD,
  CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH,
  CHAPEL_POOR_RELIEF_INTERVAL_DAYS,
  RESIDENCE_FOOD_CAPACITY,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../src/economy/regionalMarket.ts';
import {
  chapelPoorReliefDaysUntilDispatch,
  computeSettlementParishReliefPlan,
  formatChapelPoorRelief,
  isChapelPoorReliefDue,
} from '../src/economy/settlementParishRelief.ts';
import { findServingChapel } from '../src/logistics/landmarkAccess.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';
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
assert.equal(readyParish?.targetResidenceId, 'abandoned');
assert.equal(readyParish?.marketplaceId, 'market');
assert.equal(readyParish?.reliefBudget, CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH);
assert.equal(readyParish?.quote?.offerId, 'buy_pork');
assert.equal(readyParish?.status, 'ready');
assert.equal(readyPlan.readyParishes, 1);
assert.match(formatChapelPoorRelief(readyParish!), /dispatching this Monday/);

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
assert.equal(perfPlan.assignedHomes, 100_000);
assert.equal(perfPlan.reliefHomes, 10_000);
assert.equal(perfPlan.readyParishes, 8);
assert.ok(
  perfMs < 2_500,
  `100,000 homes across 8 parishes and markets took ${perfMs.toFixed(1)} ms`,
);

const serverParish = readFileSync(
  'server/src/simulation/chapel_parish.rs',
  'utf8',
);
assert.match(serverParish, /chapel_poor_relief_due\(sim_tick\)/);
assert.match(serverParish, /claim_residences_by_nearest_supplier\(/);
assert.match(serverParish, /tick\.chapel_for_residence\(ctx,/);
assert.match(serverParish, /building_disabled_by_fire\(ctx, building\.id\)/);
assert.doesNotMatch(serverParish, /CHAPEL_CHARITY_(?:RELIEF|WEALTH)_FRACTION/);
assert.match(
  serverParish,
  /let relief_spent =[\s\S]{0,800}try_chapel_poor_relief[\s\S]{0,800}withdraw_coffer_in_place\(&mut chapel_row, relief_spent\)/,
  'the coffer must be debited only after a physical relief cart departs',
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
assert.match(chapelInspector, /low auto-sweep reserve prioritizes the treasury/);

const townHallInspector = readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
assert.match(townHallInspector, /Parish territories/);
assert.match(townHallInspector, /Daily parish alms/);
assert.match(townHallInspector, /Monday poor relief/);

console.log(
  `parish relief territory, cadence, blocker, and performance tests passed (${perfMs.toFixed(1)} ms for 100,000 homes / 8 parishes / 8 markets)`,
);
