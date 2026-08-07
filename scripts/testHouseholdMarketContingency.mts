import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  BUILDING_STORAGE_CAPS,
  CALENDAR_SECONDS_PER_DAY,
  HOUSEHOLD_AUTO_BUY_COOLDOWN_TICKS,
  HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import { householdFoodPerDay } from '../src/economy/foodInventory.ts';
import {
  bestAffordableHouseholdFoodQuote,
  bestAffordableHouseholdWaterQuote,
  computeSettlementHouseholdMarketPlan,
  formatHouseholdMarketBottlenecks,
  formatHouseholdMarketBranch,
  formatHouseholdMarketResidenceStatus,
  formatHouseholdMarketSettlementSummary,
} from '../src/economy/settlementHouseholdMarket.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../src/economy/regionalMarket.ts';
import { createDefaultNeeds } from '../src/residences/residenceNeedState.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';
import { gameClock, type GameClock } from '../src/world/gameCalendar.ts';

function market(
  id: string,
  x: number,
  overrides: Partial<BuildingState> = {},
): BuildingState {
  return {
    id,
    kind: 'trading_post',
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
    storehouseAcceptsTimber: false,
    storehouseAcceptsStone: false,
    storehouseAcceptsFirewood: false,
    ...overrides,
  };
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
    needs: {
      ...createDefaultNeeds(),
      water: { stock: 1_000, deficitTicks: 0 },
    },
    abandoned: false,
    householdWealth: 20,
    lastHouseholdMarketTick: 0,
    ...overrides,
  };
}

function state(input: {
  tick?: number;
  markets?: BuildingState[];
  homes?: ResidenceState[];
}): GameState {
  return {
    seed: 1,
    tick: input.tick ?? 1_000,
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
    buildings: new Map((input.markets ?? []).map((building) => [building.id, building])),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map((input.homes ?? []).map((residence) => [residence.id, residence])),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}

function workClock(): GameClock {
  return {
    ...gameClock(1_000),
    isWorkHours: true,
    isSunday: false,
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

const foodQuote = bestAffordableHouseholdFoodQuote(
  20,
  DEFAULT_REGIONAL_MARKET_STATE,
);
assert.deepEqual(
  foodQuote && {
    id: foodQuote.offerId,
    amount: foodQuote.amount,
    cost: foodQuote.goldCost,
  },
  { id: 'buy_pork', amount: 8, cost: 10 },
  'households should choose the best food per current gold, not the fanciest lot',
);
const waterQuote = bestAffordableHouseholdWaterQuote(
  20,
  DEFAULT_REGIONAL_MARKET_STATE,
);
assert.deepEqual(
  waterQuote && {
    id: waterQuote.offerId,
    amount: waterQuote.amount,
    cost: waterQuote.goldCost,
  },
  { id: 'buy_water_barrel', amount: 10, cost: 8 },
);
assert.equal(
  HOUSEHOLD_AUTO_BUY_COOLDOWN_TICKS * SIM_TICK_SECONDS,
  90,
  'the generated client cooldown must remain the authoritative 90 simulation seconds',
);

const exactTriggerStock =
  householdFoodPerDay(4)
  * HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS;
const exactTriggerHome = home('trigger', 20);
exactTriggerHome.needs.food.stock = exactTriggerStock;
const exactTriggerState = state({
  markets: [market('10', 0)],
  homes: [exactTriggerHome],
});
const exactTrigger = computeSettlementHouseholdMarketPlan({
  state: exactTriggerState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(exactTrigger.criticalHomes, 1, 'the 0.75-day boundary is inclusive');
assert.equal(exactTrigger.readyHomes, 1);
assert.equal(exactTrigger.residences.get('trigger')?.quote?.kind, 'food');
assert.equal(exactTrigger.branches.get('10')?.assignedHomes, 1);
assert.equal(
  exactTrigger.completedMarketplaces,
  1,
  'a staffed completed Trading Post enables one regional household route',
);

const coolingState = state({
  tick: 1_000,
  markets: [market('10', 0)],
  homes: [home('cooling', 20, { lastHouseholdMarketTick: 900 })],
});
const cooling = computeSettlementHouseholdMarketPlan({
  state: coolingState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(cooling.cooldownHomes, 1);
assert.equal(
  cooling.residences.get('cooling')?.cooldownTicksRemaining,
  HOUSEHOLD_AUTO_BUY_COOLDOWN_TICKS - 100,
);
assert.match(
  formatHouseholdMarketResidenceStatus(
    cooling.residences.get('cooling') ?? null,
  ),
  /cools down/,
);

const unfinished = computeSettlementHouseholdMarketPlan({
  state: state({
    markets: [market('10', 0, { constructionComplete: false })],
    homes: [home('stranded', 20)],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(unfinished.completedMarketplaces, 0);
assert.equal(unfinished.unroutedHomes, 1);

const splitNetwork = network((originX, _originZ, targetX) =>
  Math.floor(originX / 100) === Math.floor(targetX / 100)
    ? Math.abs(targetX - originX)
    : null);
const split = computeSettlementHouseholdMarketPlan({
  state: state({
    markets: [market('10', 0)],
    homes: [home('west', 20), home('east', 120)],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: splitNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(split.routedCriticalHomes, 2);
assert.equal(split.unroutedHomes, 0);
assert.equal(
  split.firstAttentionResidenceId,
  'east',
  'the slower open-ground household should remain the first logistics warning',
);
assert.doesNotMatch(formatHouseholdMarketBottlenecks(split), /off market roads/);

const tied = computeSettlementHouseholdMarketPlan({
  state: state({
    markets: [market('20', 100), market('10', 0)],
    homes: [home('middle', 50)],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
  includeBranchResidenceIds: true,
});
assert.equal(
  tied.residences.get('middle')?.marketplaceId,
  '10',
  'equal road distance must resolve to the lower stable marketplace id',
);
assert.deepEqual(
  tied.branches.get('10')?.assignedResidenceIds,
  ['middle'],
  'market inspectors should be able to retain the exact authoritative branch membership',
);
assert.deepEqual(tied.branches.get('20')?.assignedResidenceIds, []);

const unaffordable = computeSettlementHouseholdMarketPlan({
  state: state({
    markets: [market('10', 0)],
    homes: [home('poor', 20, { householdWealth: 4 })],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(unaffordable.unaffordableHomes, 1);
assert.equal(unaffordable.affordableCriticalHomes, 0);

const busyState = state({
  markets: [market('10', 0)],
  homes: [home('busy-home', 20)],
});
busyState.deliveryTrips.set('cart', {
  id: 'cart',
  buildingId: '10',
} as GameState['deliveryTrips'] extends Map<string, infer Trip> ? Trip : never);
const busy = computeSettlementHouseholdMarketPlan({
  state: busyState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(busy.busyCartHomes, 1);
assert.equal(busy.branches.get('10')?.blockedHomes, 1);

const marketFull = computeSettlementHouseholdMarketPlan({
  state: state({
    markets: [market('10', 0, {
      curedMeat: BUILDING_STORAGE_CAPS.trading_post.preservedFood,
    })],
    homes: [home('market-full-home', 20)],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(marketFull.marketStorageBlockedHomes, 1);

const fullLotHome = home('home-full-lot', 20, {
  population: 100,
  populationCapacity: 100,
});
fullLotHome.curedMeat = 21;
fullLotHome.needs.food.stock = 21;
fullLotHome.needs.preservedFood.stock = 21;
const householdFull = computeSettlementHouseholdMarketPlan({
  state: state({
    markets: [market('10', 0)],
    homes: [fullLotHome],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(householdFull.householdStorageBlockedHomes, 1);

const waterFallbackHome = home('water-fallback', 20, {
  tier: 1,
});
waterFallbackHome.needs.food.stock = 0;
waterFallbackHome.needs.water.stock = 0;
const waterFallback = computeSettlementHouseholdMarketPlan({
  state: state({
    markets: [market('10', 0, {
      curedMeat: BUILDING_STORAGE_CAPS.trading_post.preservedFood,
    })],
    homes: [waterFallbackHome],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(
  waterFallback.residences.get('water-fallback')?.quote?.kind,
  'water',
  'a blocked food-first attempt may fall through to a viable critical water lot',
);
assert.equal(waterFallback.readyHomes, 1);

const closed = computeSettlementHouseholdMarketPlan({
  state: state({
    markets: [market('10', 0)],
    homes: [home('resting', 20)],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: {
    ...workClock(),
    isWorkHours: false,
  },
  sabbathObserved: false,
});
assert.equal(closed.closedHomes, 1);
assert.equal(closed.currentLogisticsPaused, true);

const sabbath = computeSettlementHouseholdMarketPlan({
  state: state({
    markets: [market('10', 0)],
    homes: [home('sabbath-home', 20)],
  }),
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: {
    ...workClock(),
    isSunday: true,
  },
  sabbathObserved: true,
});
assert.equal(sabbath.closedHomes, 1);

const fireState = state({
  markets: [market('10', 0)],
  homes: [home('burned', 20)],
});
fireState.fireIncidents.set('fire', {
  id: 'fire',
  targetKind: 'residence',
  targetId: 'burned',
} as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
const fireBlocked = computeSettlementHouseholdMarketPlan({
  state: fireState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(fireBlocked.fireDisabledHomes, 1);
assert.equal(fireBlocked.routedCriticalHomes, 0);

const marketFireState = state({
  markets: [market('burned-market', 0)],
  homes: [home('market-fire-home', 20)],
});
marketFireState.fireIncidents.set('market-fire', {
  id: 'market-fire',
  targetKind: 'building',
  targetId: 'burned-market',
} as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
const marketFireBlocked = computeSettlementHouseholdMarketPlan({
  state: marketFireState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(marketFireBlocked.completedMarketplaces, 1);
assert.equal(marketFireBlocked.operationalMarketplaces, 0);
assert.equal(marketFireBlocked.fireDisabledMarketplaces, 1);
assert.equal(marketFireBlocked.marketFireBlockedHomes, 1);
assert.equal(marketFireBlocked.routedCriticalHomes, 0);
assert.equal(
  marketFireBlocked.residences.get('market-fire-home')?.status,
  'market-fire-disabled',
);
assert.match(
  formatHouseholdMarketResidenceStatus(
    marketFireBlocked.residences.get('market-fire-home') ?? null,
  ),
  /only reachable marketplace is fire-damaged/,
);
assert.match(
  formatHouseholdMarketBranch(
    marketFireBlocked.branches.get('burned-market') ?? null,
  ),
  /Fire disabled/,
);
assert.match(
  formatHouseholdMarketBottlenecks(marketFireBlocked),
  /behind fire-disabled markets/,
);

const marketFireFallbackState = state({
  markets: [
    market('burned-near-market', 0),
    market('safe-far-market', 100),
  ],
  homes: [home('rerouted-home', 20)],
});
marketFireFallbackState.fireIncidents.set('near-market-fire', {
  id: 'near-market-fire',
  targetKind: 'building',
  targetId: 'burned-near-market',
} as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
const marketFireFallback = computeSettlementHouseholdMarketPlan({
  state: marketFireFallbackState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
assert.equal(
  marketFireFallback.residences.get('rerouted-home')?.marketplaceId,
  'safe-far-market',
  'households must reroute to a longer operational market instead of claiming a closer fire-disabled one',
);
assert.equal(
  marketFireFallback.residences.get('rerouted-home')?.status,
  'ready',
);
assert.equal(marketFireFallback.marketFireBlockedHomes, 0);

assert.match(formatHouseholdMarketSettlementSummary(split), /2 critical/);
assert.match(
  formatHouseholdMarketResidenceStatus(
    exactTrigger.residences.get('trigger') ?? null,
    'Highland market',
  ),
  /Smoked pork: 8 cured meat for 10\.00 gold - ready from Highland market/,
);

const perfMarkets = Array.from(
  { length: 8 },
  (_, index) => market(String(index + 1), index * 1_000),
);
const perfHomes = Array.from(
  { length: 100_000 },
  (_, index) => home(String(index + 100), index % 8 * 1_000 + 20),
);
const perfState = state({ markets: perfMarkets, homes: perfHomes });
const perfStart = performance.now();
const perfPlan = computeSettlementHouseholdMarketPlan({
  state: perfState,
  marketState: DEFAULT_REGIONAL_MARKET_STATE,
  roadNetwork: euclideanNetwork,
  clock: workClock(),
  sabbathObserved: false,
});
const perfMs = performance.now() - perfStart;
assert.equal(perfPlan.occupiedHomes, 100_000);
assert.equal(perfPlan.readyHomes, 100_000);
assert.equal(
  perfPlan.branches.get('1')?.assignedResidenceIds,
  undefined,
  'non-coverage forecasts should not retain a second 100,000-home membership ledger',
);
assert.ok(
  perfMs < 2_500,
  `100,000 homes across 8 market routes took ${perfMs.toFixed(1)} ms`,
);

const householdServer = readFileSync(
  'server/src/simulation/household_market_orders.rs',
  'utf8',
);
const tickContextServer = readFileSync(
  'server/src/simulation/tick_context.rs',
  'utf8',
);
assert.match(householdServer, /marketplace_for_residence\(/);
assert.match(
  tickContextServer,
  /build_marketplace_claims[\s\S]*claim_residences_by_nearest_supplier\(/,
  'household imports should share one exact nearest-Trading-Post territory',
);
assert.match(tickContextServer, /build_local_marketplace_claims/);
assert.match(householdServer, /labor_and_logistics_paused\(ctx, tick, owner, clock\)/);
assert.match(householdServer, /building_disabled_by_fire\(ctx, building\.id\)/);
assert.doesNotMatch(householdServer, /residence_has_marketplace_access/);
assert.doesNotMatch(householdServer, /nearest_marketplace_for_residence/);

const caravanServer = readFileSync(
  'server/src/simulation/marketplace_caravan.rs',
  'utf8',
);
assert.match(caravanServer, /building_disabled_by_fire\(ctx, building\.id\)/);
assert.match(
  caravanServer,
  /match dispatch\.priority_residence_id[\s\S]{0,220}\.residence\(\)[\s\S]{0,80}\.id\(\)[\s\S]{0,80}\.find\(&residence_id\)/,
  'a named paid delivery must fetch only its indexed household',
);

const residenceInspector = readFileSync(
  'src/resources/inspector/residenceRenderer.ts',
  'utf8',
);
assert.match(residenceInspector, /Emergency market/);
assert.match(residenceInspector, /Standing-order rule/);
const marketplaceInspector = readFileSync(
  'src/resources/inspector/marketplaceInspector.ts',
  'utf8',
);
assert.match(marketplaceInspector, /Emergency branch/);
assert.match(marketplaceInspector, /household import duty; public and parish orders are exempt/);
const townHallInspector = readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);
assert.match(townHallInspector, /Emergency purchasing power/);
assert.match(townHallInspector, /data-inspect-residence/);

console.log(
  `household market contingency parity and routing tests passed (${perfMs.toFixed(1)} ms for 100,000 homes / 8 markets)`,
);
