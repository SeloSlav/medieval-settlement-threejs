import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  canAffordCommodityTrade,
  canAffordMarketplaceTrade,
  canReceiveCommodityTrade,
  canReceiveMarketplaceTrade,
  describeMarketplaceTradeOffer,
  formatTradeAvailabilitySummary,
  marketplaceManualTradeCooldown,
  marketplaceManualTradeStatus,
  marketplaceTradeOfferCost,
  marketplaceTradeOffersBySection,
  tradeResourceSpendScope,
} from '../src/economy/marketplaceTrade.ts';
import { MARKETPLACE_TRADE_OFFERS, MARKET_COMMODITIES } from '../src/generated/gameBalance.ts';
import { computeMarketplaceTradeAvailability } from '../src/resources/resourceTotals.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type GameState,
} from '../src/resources/types.ts';
import {
  DEFAULT_REGIONAL_MARKET_STATE,
  effectiveCommodityGoldCost,
  formatMarketDepthHint,
  formatRegionalRateSummary,
  priceMultiplierFor,
  scaledGoldCost,
} from '../src/economy/regionalMarket.ts';

const buyTimber = MARKETPLACE_TRADE_OFFERS.find((offer) => offer.id === 'buy_timber');
const buySeedGrain = MARKETPLACE_TRADE_OFFERS.find((offer) => offer.id === 'buy_seed_grain');
const buyIronwork = MARKETPLACE_TRADE_OFFERS.find((offer) => offer.id === 'buy_ironwork');
const sellStone = MARKETPLACE_TRADE_OFFERS.find((offer) => offer.id === 'sell_stone');
const timberForStone = MARKETPLACE_TRADE_OFFERS.find((offer) => offer.id === 'timber_for_stone');
const buyPork = MARKET_COMMODITIES.find((commodity) => commodity.id === 'buy_pork');

function makeBuilding(
  partial: Partial<BuildingState> & Pick<BuildingState, 'id' | 'kind' | 'x' | 'z'>,
): BuildingState {
  return {
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
    ironwork: 0,
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
    ...partial,
  };
}

function makeState(buildings: BuildingState[]): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: {
      ...createEmptyStockpile(),
      timber: 20,
      stone: 12,
      firewood: 2,
      food: 1,
      gold: 30,
    },
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(buildings.map((building) => [building.id, building])),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: buildings.length + 1,
  };
}

assert.ok(buyTimber, 'buy_timber offer exists');
assert.ok(buySeedGrain, 'buy_seed_grain offer exists');
assert.ok(buyIronwork, 'buy_ironwork offer exists');
assert.ok(sellStone, 'sell_stone offer exists');
assert.ok(timberForStone, 'timber_for_stone offer exists');
assert.ok(buyPork, 'buy_pork commodity exists');

assert.equal(describeMarketplaceTradeOffer(buyTimber), 'Buy 10 timber for 16 gold');
assert.equal(describeMarketplaceTradeOffer(buySeedGrain), 'Import 24 seed grain for 18 gold');
assert.equal(describeMarketplaceTradeOffer(buyIronwork), 'Buy 6 ironwork for 12 gold');
assert.equal(marketplaceTradeOfferCost(buyTimber).resource, 'gold');
assert.equal(tradeResourceSpendScope('timber'), 'marketAccessible');
assert.equal(tradeResourceSpendScope('food'), 'marketAccessible');
assert.equal(tradeResourceSpendScope('grain'), 'marketAccessible');
assert.equal(tradeResourceSpendScope('ironwork'), 'marketAccessible');
assert.equal(priceMultiplierFor(DEFAULT_REGIONAL_MARKET_STATE, 'ironwork'), DEFAULT_REGIONAL_MARKET_STATE.stonePriceMult);
assert.equal(priceMultiplierFor(DEFAULT_REGIONAL_MARKET_STATE, 'grain'), DEFAULT_REGIONAL_MARKET_STATE.foodPriceMult);
assert.equal(
  marketplaceTradeOffersBySection(false).goldBuy.some((offer) => offer.id === 'buy_ironwork'),
  false,
  'peaceful markets hide military ironwork orders',
);
assert.equal(
  marketplaceTradeOffersBySection(true).goldBuy.some((offer) => offer.id === 'buy_ironwork'),
  true,
  'frontier markets expose military ironwork orders',
);

assert.equal(canAffordMarketplaceTrade({ timber: 0, stone: 0, gold: 16, firewood: 0, food: 0, grain: 0, ironwork: 0 }, buyTimber), true);
assert.equal(canAffordMarketplaceTrade({ timber: 0, stone: 0, gold: 10, firewood: 0, food: 0, grain: 0, ironwork: 0 }, buyTimber), false);

assert.equal(canAffordMarketplaceTrade({ timber: 0, stone: 10, gold: 0, firewood: 0, food: 0, grain: 0, ironwork: 0 }, sellStone), true);
assert.equal(canAffordMarketplaceTrade({ timber: 0, stone: 5, gold: 0, firewood: 0, food: 0, grain: 0, ironwork: 0 }, sellStone), false);

assert.equal(canAffordMarketplaceTrade({ timber: 25, stone: 0, gold: 0, firewood: 0, food: 0, grain: 0, ironwork: 0 }, timberForStone), true);
assert.equal(canAffordMarketplaceTrade({ timber: 20, stone: 0, gold: 0, firewood: 0, food: 0, grain: 0, ironwork: 0 }, timberForStone), false);

assert.equal(canAffordCommodityTrade({ timber: 0, stone: 0, gold: 10, firewood: 0, food: 0, grain: 0, ironwork: 0 }, buyPork!), true);
assert.equal(
  canAffordCommodityTrade({ timber: 0, stone: 0, gold: 9, firewood: 0, food: 0, grain: 0, ironwork: 0 }, buyPork!),
  false,
);

assert.equal(effectiveCommodityGoldCost(buyPork!, DEFAULT_REGIONAL_MARKET_STATE), 10);
assert.equal(scaledGoldCost(10, 1.21), 13);
assert.equal(
  formatRegionalRateSummary({
    ...DEFAULT_REGIONAL_MARKET_STATE,
    timberPriceMult: 1.12,
    foodPriceMult: 0.91,
  }),
  'Timber +12% market · Stone steady · Firewood steady · Food & seed grain -9% market · Specialties steady',
);
assert.match(formatMarketDepthHint(), /each 10-unit trade/i);
assert.match(formatMarketDepthHint(), /4 points/);

assert.match(
  formatTradeAvailabilitySummary({ timber: 12, stone: 8, gold: 3.5, firewood: 40, food: 6, grain: 24, ironwork: 0 }),
  /Timber 12/,
);
const marketplace = makeBuilding({
  id: 'market',
  kind: 'marketplace',
  x: 0,
  z: 0,
  timber: 5,
  stone: 4,
  firewood: 3,
  food: 2,
  grain: 24,
  ironwork: 5,
});
const connectedStore = makeBuilding({
  id: 'connected',
  kind: 'village_storehouse',
  x: 10,
  z: 0,
  timber: 20,
  stone: 16,
  firewood: 12,
  food: 8,
  grain: 6,
  ironwork: 4,
});
const connectedGranary = makeBuilding({
  id: 'connected-granary',
  kind: 'granary',
  x: 12,
  z: 0,
  grain: 150,
  granaryGrainReserve: 120,
});
const disconnectedStore = makeBuilding({
  id: 'disconnected',
  kind: 'village_storehouse',
  x: 100,
  z: 0,
  timber: 50,
  stone: 40,
  firewood: 50,
  food: 40,
  grain: 50,
  ironwork: 40,
});
const constructionSite = makeBuilding({
  id: 'site',
  kind: 'chapel',
  x: 8,
  z: 0,
  assignedLabor: 0,
  constructionComplete: false,
  constructionProgress: 0.2,
  constructionReservedTimber: 8,
  constructionReservedStone: 6,
  constructionTreasuryTimber: 3,
  constructionTreasuryStone: 2,
});
const tradeState = makeState([
  marketplace,
  connectedStore,
  connectedGranary,
  disconnectedStore,
  constructionSite,
]);
const roadConnected = (_ax: number, _az: number, bx: number) => bx <= 20;
const availability = computeMarketplaceTradeAvailability(
  tradeState,
  marketplace,
  roadConnected,
);
assert.deepEqual(availability, {
  timber: 42,
  stone: 30,
  gold: 30,
  firewood: 17,
  food: 11,
  grain: 60,
  ironwork: 9,
});

assert.equal(marketplaceManualTradeStatus({ ...marketplace, assignedLabor: 0 }, true).ready, false);
assert.match(
  marketplaceManualTradeStatus({ ...marketplace, assignedLabor: 0 }, true).label,
  /unstaffed/i,
);
assert.match(marketplaceManualTradeStatus(marketplace, false).label, /no road/i);
assert.match(
  marketplaceManualTradeStatus({ ...marketplace, actionCooldown: 2.5 }, true).label,
  /2\.5s/,
);
assert.equal(marketplaceManualTradeStatus(marketplace, true).ready, true);
assert.equal(marketplaceManualTradeCooldown(1), 8);
assert.equal(marketplaceManualTradeCooldown(2), 4);

assert.equal(canReceiveMarketplaceTrade({ ...marketplace, timber: 50 }, buyTimber), true);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, timber: 51 }, buyTimber), false);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, ironwork: 42 }, buyIronwork), true);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, ironwork: 43 }, buyIronwork), false);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, grain: 24 }, buySeedGrain), true);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, grain: 25 }, buySeedGrain), false);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, stone: 60 }, sellStone), true);
assert.equal(canReceiveCommodityTrade({ ...marketplace, food: 88 }, buyPork!), true);
assert.equal(canReceiveCommodityTrade({ ...marketplace, food: 89 }, buyPork!), false);

const manyBuildings = Array.from({ length: 10_000 }, (_, index) => makeBuilding({
  id: `store-${index}`,
  kind: 'village_storehouse',
  x: index % 2 === 0 ? 10 : 100,
  z: index,
  timber: 1,
  stone: 1,
  firewood: 1,
  food: 1,
}));
const largeState = makeState([marketplace, ...manyBuildings]);
const started = performance.now();
const largeAvailability = computeMarketplaceTradeAvailability(
  largeState,
  marketplace,
  (_ax, _az, bx) => bx <= 20,
);
const elapsed = performance.now() - started;
assert.equal(largeAvailability.firewood, 5_005);
assert.ok(elapsed < 250, `10k-building market stock scan took ${elapsed.toFixed(1)}ms`);

const longRoad = new RoadNetwork();
longRoad.restore({
  nextNodeId: 5,
  nextEdgeId: 3,
  nodes: [
    { id: 'node-1', position: [0, 0, 0] },
    { id: 'node-2', position: [0, 0, 10_000] },
    { id: 'node-3', position: [100, 0, 0] },
    { id: 'node-4', position: [100, 0, 100] },
  ],
  edges: [
    {
      id: 'edge-1',
      startNodeId: 'node-1',
      endNodeId: 'node-2',
      width: 4.2,
      controlPoints: [[0, 0, 0], [0, 0, 10_000]],
      sampledPath: [[0, 0, 0], [0, 0, 10_000]],
      length: 10_000,
      revision: 1,
    },
    {
      id: 'edge-2',
      startNodeId: 'node-3',
      endNodeId: 'node-4',
      width: 4.2,
      controlPoints: [[100, 0, 0], [100, 0, 100]],
      sampledPath: [[100, 0, 0], [100, 0, 100]],
      length: 100,
      revision: 1,
    },
  ],
});
const pathfinder = longRoad.getPathfinder();
assert.equal(pathfinder.roadConnected(0, 0, 100, 0), false);
const connectivityStarted = performance.now();
for (let index = 0; index < 10_000; index++) {
  assert.equal(pathfinder.roadConnected(0, 0, 10, index), true);
}
const connectivityElapsed = performance.now() - connectivityStarted;
assert.ok(
  connectivityElapsed < 400,
  `10k spatial road-component checks took ${connectivityElapsed.toFixed(1)}ms`,
);

const marketplaceTradeSource = readFileSync(
  new URL('../server/src/economy/marketplace_trade.rs', import.meta.url),
  'utf8',
);
const marketplaceOrderSource = readFileSync(
  new URL('../server/src/economy/marketplace_orders.rs', import.meta.url),
  'utf8',
);
assert.match(marketplaceTradeSource, /road_connected/);
assert.match(marketplaceTradeSource, /deposit_marketplace_resource/);
assert.match(marketplaceTradeSource, /market-accessible/);
assert.match(marketplaceTradeSource, /contested-frontier worlds/);
assert.doesNotMatch(marketplaceTradeSource, /spend_aggregate_(?:food|firewood)/);
assert.doesNotMatch(marketplaceOrderSource, /credit_treasury_(?:food|water)/);

console.log(
  `marketplace trade tests passed (10k stock scan ${elapsed.toFixed(1)}ms; `
  + `10k road checks ${connectivityElapsed.toFixed(1)}ms)`,
);
