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
  marketplacePendingTradeOffer,
  marketplaceTradeOfferCost,
  marketplaceTradeStagingPlan,
  marketplaceTradeOffersBySection,
  tradeResourceSpendScope,
} from '../src/economy/marketplaceTrade.ts';
import {
  BUILDING_STORAGE_CAPS,
  MARKETPLACE_TRADE_OFFERS,
  MARKET_COMMODITIES,
  SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  computeGoldAwaitingCollection,
  computeMarketplaceTradeAvailability,
  computeResourceTotals,
} from '../src/resources/resourceTotals.ts';
import { buildingMarkerCollectionSignature } from '../src/buildings/buildingMarkerSignature.ts';
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
import { renderMarketplaceTradePanel } from '../src/resources/inspector/marketplaceTradeRenderer.ts';
import {
  createMarketplaceMesh,
  MARKET_RECEIPT_VISUAL_SEGMENTS,
  MARKET_STAGING_VISUAL_SEGMENTS,
} from '../src/buildings/meshes/marketplaceMesh.ts';
import {
  MARKETPLACE_GOLD_RESERVE_DEFAULT,
  MARKETPLACE_GOLD_RESERVE_TARGETS,
  marketplaceGoldReserveShortfall,
  marketplaceGoldReserveTarget,
  marketplaceGoldSweepSurplus,
  normalizeMarketplaceGoldReserveTarget,
} from '../src/economy/marketplaceGoldReserve.ts';

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
      bread: 1,
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
assert.equal(buyPork.resourceKind, 'curedMeat');

const marketplaceMesh = createMarketplaceMesh();
const marketProceedsChest = marketplaceMesh.getObjectByName('MarketProceedsChest');
assert.ok(marketProceedsChest, 'market exports need a visible proceeds lockbox');
assert.equal(
  marketProceedsChest.visible,
  false,
  'the market lockbox should remain hidden until export gold is physically present',
);
assert.equal(
  marketProceedsChest.children.filter((child) => child.name === 'MarketReceiptSegment').length,
  MARKET_RECEIPT_VISUAL_SEGMENTS,
  'market receipts should show a bounded number of cartload-sized lockboxes',
);
for (const [groupName, segmentPrefix] of [
  ['MarketTimberStaging', 'MarketTimberStageSegment'],
  ['MarketStoneStaging', 'MarketStoneStageSegment'],
  ['MarketCratedGoodsStaging', 'MarketCratedStageSegment'],
] as const) {
  assert.ok(marketplaceMesh.getObjectByName(groupName), `${groupName} should be modeled`);
  for (let index = 0; index < MARKET_STAGING_VISUAL_SEGMENTS; index++) {
    assert.equal(
      marketplaceMesh.getObjectByName(`${segmentPrefix}${index}`)?.visible,
      false,
      `${segmentPrefix}${index} should remain hidden until physical stock arrives`,
    );
  }
}

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
  'Timber +12% market · Stone steady · Iron steady · Firewood steady · Food & seed grain -9% market · Salt -9% market · Drinks steady · Provisions steady · Wares steady',
);
assert.match(formatMarketDepthHint(), /each 10-unit trade/i);
assert.match(formatMarketDepthHint(), /4 points/);

assert.match(
  formatTradeAvailabilitySummary({ timber: 12, stone: 8, gold: 3.5, firewood: 40, food: 6, grain: 24, ironwork: 0 }),
  /Timber 12/,
);
const marketplace = makeBuilding({
  id: 'market',
  kind: 'trading_post',
  x: 0,
  z: 0,
  timber: 5,
  stone: 4,
  firewood: 3,
  bread: 2,
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
  bread: 8,
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
  barley: 0,
  ironwork: 9,
  iron: 0,
  salt: 0,
  pottery: 0,
});
const physicalTradeState: GameState = {
  ...tradeState,
  physicalFoundingSiteEnabled: true,
  stockpile: {
    ...tradeState.stockpile,
    gold: 0,
  },
};
const marketWithProceeds = {
  ...marketplace,
  gold: 14,
};
const townHallWithTreasury = makeBuilding({
  id: 'town-hall',
  kind: 'town_hall',
  x: 6,
  z: 0,
  gold: 5,
});
const proceedsState: GameState = {
  ...makeState([marketWithProceeds, townHallWithTreasury]),
  physicalFoundingSiteEnabled: true,
  stockpile: createEmptyStockpile(),
};
assert.equal(
  computeResourceTotals(proceedsState).gold,
  5,
  'market working cash must not appear as spendable central treasury gold',
);
assert.equal(
  computeGoldAwaitingCollection(proceedsState.buildings.values()),
  14,
  'the HUD should account separately for physical coin held at markets',
);
assert.equal(
  computeMarketplaceTradeAvailability(proceedsState, marketWithProceeds, roadConnected).gold,
  14,
  'a physical market must fund imports from its own coffer',
);
assert.notEqual(
  buildingMarkerCollectionSignature(new Map([[marketplace.id, marketplace]])),
  buildingMarkerCollectionSignature(new Map([[marketWithProceeds.id, marketWithProceeds]])),
  'a market lockbox must refresh when market receipts arrive or depart',
);
assert.notEqual(
  buildingMarkerCollectionSignature(new Map([[marketWithProceeds.id, marketWithProceeds]])),
  buildingMarkerCollectionSignature(new Map([[
    marketWithProceeds.id,
    { ...marketWithProceeds, gold: 50 },
  ]])),
  'market receipt visuals must grow and decline in bounded cartload-sized steps',
);
assert.notEqual(
  buildingMarkerCollectionSignature(new Map([[marketplace.id, marketplace]])),
  buildingMarkerCollectionSignature(new Map([[
    marketplace.id,
    { ...marketplace, timber: marketplace.timber + 40 },
  ]])),
  'physical market staging piles must refresh when their visible stock level changes',
);
assert.deepEqual(
  computeMarketplaceTradeAvailability(physicalTradeState, marketplace, roadConnected),
  {
    timber: 25,
    stone: 20,
    gold: 0,
    firewood: 15,
    food: 10,
    grain: 60,
    barley: 0,
    ironwork: 9,
    iron: 0,
    salt: 0,
    pottery: 0,
  },
  'physical markets must not promise goods left in the compatibility ledger',
);
const fittingReservationSite = makeBuilding({
  id: 'fitting-reservation-site',
  kind: 'town_hall',
  x: 8,
  z: 0,
  constructionComplete: false,
  constructionRequiredIronwork: 6,
  constructionReservedIronwork: 6,
});
const fittingReservationState: GameState = {
  ...makeState([marketplace, connectedStore, fittingReservationSite]),
  physicalFoundingSiteEnabled: true,
  stockpile: createEmptyStockpile(),
};
assert.equal(
  computeResourceTotals(fittingReservationState).ironwork,
  3,
  'HUD availability must remove fittings already committed to construction',
);
assert.equal(
  computeMarketplaceTradeAvailability(
    fittingReservationState,
    marketplace,
    roadConnected,
  ).ironwork,
  3,
  'market actions must not promise construction-reserved fittings',
);
assert.deepEqual(MARKETPLACE_GOLD_RESERVE_TARGETS, [0, 16, 32, 64]);
assert.equal(MARKETPLACE_GOLD_RESERVE_DEFAULT, 32);
assert.equal(normalizeMarketplaceGoldReserveTarget(undefined), 32);
assert.equal(normalizeMarketplaceGoldReserveTarget(47), 32);
assert.equal(marketplaceGoldReserveTarget(marketplace), 32);
assert.equal(marketplaceGoldReserveShortfall(8, 4, 32), 20);
assert.equal(marketplaceGoldReserveShortfall(40, 0, 32), 0);
assert.equal(marketplaceGoldSweepSurplus(40, 32), 8);
assert.equal(marketplaceGoldSweepSurplus(Number.NaN, 32), 0);
const fireBlockedTradeState: GameState = {
  ...physicalTradeState,
  fireIncidents: new Map([[
    'connected-store-fire',
    {
      id: 'connected-store-fire',
      targetKind: 'building',
      targetId: connectedStore.id,
      x: connectedStore.x,
      z: connectedStore.z,
      ignitionSource: 'accident',
      status: 'extinguished',
      intensity: 0,
      damage: 0.4,
      waterDelivered: 0,
      requiredWater: 0,
      extinguishChance: 0,
      startedTick: 1,
      lastWaterTick: 0,
      resolvedTick: 2,
      responseWellId: null,
    },
  ]]),
};
assert.deepEqual(
  computeMarketplaceTradeAvailability(fireBlockedTradeState, marketplace, roadConnected),
  {
    timber: 5,
    stone: 4,
    gold: 0,
    firewood: 3,
    food: 2,
    grain: 54,
    barley: 0,
    ironwork: 5,
    iron: 0,
    salt: 0,
    pottery: 0,
  },
  'fire-damaged stores remain owned but cannot promise cart-ready export lots',
);

const stoneStaging = marketplaceTradeStagingPlan(
  marketplace,
  sellStone,
  true,
);
assert.deepEqual(stoneStaging, {
  resource: 'stone',
  required: 10,
  localStock: 4,
  missing: 6,
  requiresStaging: true,
  inbound: false,
});
assert.equal(
  marketplaceTradeStagingPlan(marketplace, sellStone, true, new Set(['stone'])).inbound,
  true,
);
assert.equal(
  marketplaceTradeStagingPlan({ ...marketplace, stone: 10 }, sellStone, true).requiresStaging,
  false,
);
assert.equal(
  marketplaceTradeStagingPlan(marketplace, sellStone, false).requiresStaging,
  false,
  'legacy saves retain their direct road-linked export behavior',
);
const stagingPanel = renderMarketplaceTradePanel(
  marketplace,
  availability,
  DEFAULT_REGIONAL_MARKET_STATE,
  marketplaceManualTradeStatus(marketplace, true),
  false,
  undefined,
  true,
  new Set(),
);
assert.match(stagingPanel, /Order 6 stone staged at this Trading Post/);
assert.match(stagingPanel, /visible source carts/);
const inboundStagingPanel = renderMarketplaceTradePanel(
  marketplace,
  availability,
  DEFAULT_REGIONAL_MARKET_STATE,
  marketplaceManualTradeStatus(marketplace, true),
  false,
  undefined,
  true,
  new Set(['stone']),
);
assert.match(inboundStagingPanel, /stone staging cart inbound/);
assert.match(
  inboundStagingPanel,
  /disabled aria-disabled="true"[\s\S]*Order 6 stone staged at this Trading Post/,
  'the same commodity cannot order a second inbound staging cart',
);
assert.equal(marketplacePendingTradeOffer(2)?.id, 'sell_stone');
assert.equal(marketplacePendingTradeOffer(0), null);
assert.equal(marketplacePendingTradeOffer(99), null);
const pendingMarketplace = {
  ...marketplace,
  marketplacePendingTradeCode: 2,
};
const pendingTradeStatus = marketplaceManualTradeStatus(pendingMarketplace, true);
assert.equal(pendingTradeStatus.ready, false);
assert.equal(pendingTradeStatus.label, 'Bulk order staging');
const pendingTradePanel = renderMarketplaceTradePanel(
  pendingMarketplace,
  availability,
  DEFAULT_REGIONAL_MARKET_STATE,
  pendingTradeStatus,
  false,
  undefined,
  true,
  new Set(['stone']),
);
assert.match(pendingTradePanel, /Active bulk order/);
assert.match(pendingTradePanel, /Sell 10 stone for 14 gold/);
assert.match(pendingTradePanel, /stone cart inbound · 4 of 10 physically staged/);
assert.match(pendingTradePanel, /aria-valuenow="40"/);
assert.match(pendingTradePanel, /Cancel bulk order/);
assert.match(pendingTradePanel, /Already-dispatched carts still unload here/);
assert.match(
  pendingTradePanel,
  /final receipt follows the rate and surviving load at the regional exchange/,
);
assert.match(
  pendingTradePanel,
  /disabled aria-disabled="true"[\s\S]*This Trading Post is already staging a bulk order/,
  'a pending bulk order occupies the manual trade desk',
);

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
const regionalCaravanTrade = marketplaceManualTradeStatus(
  marketplace,
  true,
  1,
  false,
  true,
);
assert.equal(regionalCaravanTrade.ready, false);
assert.equal(regionalCaravanTrade.label, 'All regional routes occupied');
assert.match(regionalCaravanTrade.reason ?? '', /import or export merchant/);
const fireDisabledTrade = marketplaceManualTradeStatus(
  marketplace,
  true,
  1,
  true,
);
assert.equal(fireDisabledTrade.ready, false);
assert.match(fireDisabledTrade.label, /fire-disabled/i);
assert.match(fireDisabledTrade.reason ?? '', /Repair the fire-damaged Trading Post/);
assert.equal(marketplaceManualTradeCooldown(1), 8);
assert.equal(marketplaceManualTradeCooldown(2), 4);
assert.equal(
  marketplaceManualTradeCooldown(1, SPRING_RAIN_ROAD_SPEED_MULTIPLIER),
  8 / SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
);
const wetTradeStatus = marketplaceManualTradeStatus(
  marketplace,
  true,
  SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
);
assert.equal(wetTradeStatus.roadSpeedMultiplier, SPRING_RAIN_ROAD_SPEED_MULTIPLIER);
assert.equal(
  wetTradeStatus.nextCooldownSeconds,
  8 / SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
);

assert.equal(canReceiveMarketplaceTrade({ ...marketplace, timber: BUILDING_STORAGE_CAPS.trading_post.timber - 10 }, buyTimber), true);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, timber: BUILDING_STORAGE_CAPS.trading_post.timber - 9 }, buyTimber), false);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, ironwork: BUILDING_STORAGE_CAPS.trading_post.ironwork - 6 }, buyIronwork), true);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, ironwork: BUILDING_STORAGE_CAPS.trading_post.ironwork - 5 }, buyIronwork), false);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, grain: BUILDING_STORAGE_CAPS.trading_post.grain - 24 }, buySeedGrain), true);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, grain: BUILDING_STORAGE_CAPS.trading_post.grain - 23 }, buySeedGrain), false);
assert.equal(canReceiveMarketplaceTrade({ ...marketplace, stone: 60 }, sellStone), true);
assert.equal(canReceiveCommodityTrade({ ...marketplace, curedMeat: BUILDING_STORAGE_CAPS.trading_post.preservedFood - 8 }, buyPork!), true);
assert.equal(canReceiveCommodityTrade({ ...marketplace, curedMeat: BUILDING_STORAGE_CAPS.trading_post.preservedFood - 7 }, buyPork!), false);

const manyBuildings = Array.from({ length: 10_000 }, (_, index) => makeBuilding({
  id: `store-${index}`,
  kind: 'village_storehouse',
  x: index % 2 === 0 ? 10 : 100,
  z: index,
  timber: 1,
  stone: 1,
  firewood: 1,
  bread: 1,
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
const proceedsStarted = performance.now();
assert.equal(
  computeGoldAwaitingCollection([
    ...manyBuildings,
    marketWithProceeds,
  ]),
  14,
);
const proceedsElapsed = performance.now() - proceedsStarted;
assert.ok(
  proceedsElapsed < 100,
  `10k-building market proceeds scan took ${proceedsElapsed.toFixed(1)}ms`,
);
const reservePolicyStarted = performance.now();
for (let index = 0; index < 100_000; index++) {
  marketplaceGoldReserveShortfall(index % 40, index % 8, 32);
  marketplaceGoldSweepSurplus(index % 80, 32);
}
const reservePolicyElapsed = performance.now() - reservePolicyStarted;
assert.ok(
  reservePolicyElapsed < 100,
  `100k market cash-reserve policy checks took ${reservePolicyElapsed.toFixed(1)}ms`,
);

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
const marketplaceInspectorSource = readFileSync(
  new URL('../src/resources/inspector/marketplaceInspector.ts', import.meta.url),
  'utf8',
);
const marketplaceTradeRendererSource = readFileSync(
  new URL('../src/resources/inspector/marketplaceTradeRenderer.ts', import.meta.url),
  'utf8',
);
const marketplaceCaravanSource = readFileSync(
  new URL('../server/src/simulation/marketplace_caravan.rs', import.meta.url),
  'utf8',
);
const marketplaceReducerSource = readFileSync(
  new URL('../server/src/reducers/marketplace_trade.rs', import.meta.url),
  'utf8',
);
const buildingTableSource = readFileSync(
  new URL('../server/src/tables.rs', import.meta.url),
  'utf8',
);
const generatedBuildingSource = readFileSync(
  new URL('../src/generated/building_table.ts', import.meta.url),
  'utf8',
);
const generatedCancelReducerSource = readFileSync(
  new URL('../src/generated/cancel_marketplace_trade_order_reducer.ts', import.meta.url),
  'utf8',
);
const generatedGoldReserveReducerSource = readFileSync(
  new URL('../src/generated/set_marketplace_gold_reserve_target_reducer.ts', import.meta.url),
  'utf8',
);
const buildingSyncSource = readFileSync(
  new URL('../src/data/spacetimeTableSync/syncBuildings.ts', import.meta.url),
  'utf8',
);
const supplementalPanelSource = readFileSync(
  new URL('../src/resources/inspector/supplementalPanel.ts', import.meta.url),
  'utf8',
);
const inspectorActionsSource = readFileSync(
  new URL('../src/app/inspectorSpacetimeActions.ts', import.meta.url),
  'utf8',
);
const spacetimeReducersSource = readFileSync(
  new URL('../src/data/spacetimeReducers.ts', import.meta.url),
  'utf8',
);
assert.match(marketplaceTradeSource, /road_connected/);
assert.match(marketplaceTradeSource, /deposit_marketplace_resource/);
assert.match(marketplaceTradeSource, /market-accessible/);
assert.match(marketplaceTradeSource, /physical_founding_site_enabled/);
assert.match(marketplaceTradeSource, /stage_physical_market_resource/);
assert.match(marketplaceTradeSource, /try_start_building_supply_trip/);
assert.match(marketplaceTradeSource, /building_has_inbound_commodity_trip/);
assert.match(
  marketplaceOrderSource,
  /physical_market_orders_enabled[\s\S]*order_physical_market_import/,
  'provender and water purchases must use the physical import path in developed settlements',
);
assert.match(
  marketplaceOrderSource,
  /None => start_external_market_import_trip\(/,
  'manual provender and water orders must arrive at the Trading Post on a map-edge cart',
);
assert.match(
  marketplaceOrderSource,
  /Some\(target\) => start_external_market_import_trip_to_residence/,
  'named household and parish orders must remain attached to one live merchant cart',
);
assert.match(
  marketplaceTradeSource,
  /local_delivery_distances_from/,
  'staging-source selection should batch road routes while retaining off-road fallback per store',
);
assert.match(
  marketplaceTradeSource,
  /PhysicalMarketSpend::Staged[\s\S]*return Ok\(MarketplaceTradeOutcome::Staged\)/,
  'staging must not record a sale or regional price movement before the cart unloads',
);
assert.match(
  marketplaceTradeSource,
  /dispatch_physical_market_export[\s\S]*regional_market_export_route[\s\S]*start_regional_market_export_trip/,
  'a staged physical export must depart on one live regional merchant cart',
);
assert.match(
  marketplaceTradeSource,
  /settle_regional_market_export[\s\S]*proportional_regional_trade_receipt/,
  'regional receipts must scale to cargo that physically survives the outbound road',
);
assert.match(
  marketplaceTradeSource,
  /TradeReceive::Resource\(receive\)[\s\S]*received_amount[\s\S]*Ok\(\(trade_commodity\(receive\.resource\), received_amount\)\)/,
  'barter receipts must return as physical cargo on the same merchant row',
);
assert.match(marketplaceTradeSource, /try_advance_pending_marketplace_trade/);
assert.match(marketplaceTradeSource, /credit_marketplace_receipt_gold/);
assert.match(marketplaceTradeSource, /pending_trade_code[\s\S]*"sell_timber" => Some\(1\)/);
assert.match(marketplaceTradeSource, /MarketplaceTradeOutcome::Settled[\s\S]*clear_pending_marketplace_trade/);
assert.match(
  marketplaceCaravanSource,
  /clock\.sim_tick % 5 == building_id % 5[\s\S]*try_advance_pending_marketplace_trade/,
  'only active orders should advance on the existing staggered market cadence',
);
assert.match(
  marketplaceCaravanSource,
  /Routine household goods are allocated from Marketplace stock in one[\s\S]*No market-to-home cart departs here/,
  'routine household availability must stay separate from Trading Post export stock and pending regional orders',
);
assert.match(marketplaceCaravanSource, /try_dispatch_marketplace_proceeds/);
assert.match(marketplaceCaravanSource, /try_dispatch_marketplace_cash_reserve/);
assert.match(marketplaceCaravanSource, /marketplace_gold_reserve_shortfall/);
assert.match(marketplaceCaravanSource, /marketplace_gold_sweep_surplus/);
assert.match(
  marketplaceCaravanSource,
  /marketplace_stall_workplace[\s\S]*ResidenceNeedKind::Food[\s\S]*"granary"[\s\S]*ResidenceNeedKind::Firewood[\s\S]*"village_storehouse"/,
  'Marketplace stall deliveries must use the matching staffed granary or storehouse workforce',
);
assert.doesNotMatch(
  marketplaceCaravanSource,
  /fn marketplace_caravan_workers/,
  'the unstaffed Marketplace must not synthesize its own delivery workforce',
);
assert.match(marketplaceCaravanSource, /CommodityKind::Gold/);
assert.match(marketplaceCaravanSource, /onsite_building_labor/);
assert.match(
  marketplaceCaravanSource,
  /physical_founding_site_enabled[\s\S]*start_regional_market_export_trip/,
  'physical specialty stock must leave on discrete live regional merchant loads',
);
assert.match(
  marketplaceCaravanSource,
  /regional_export_cart_load/,
  'specialty exporters must use one bounded handcart load per trip',
);
assert.doesNotMatch(
  marketplaceCaravanSource,
  /credit_treasury_gold/,
  'market exports must not teleport income into a civic treasury',
);
assert.match(marketplaceReducerSource, /cancel_marketplace_trade_order/);
assert.match(marketplaceReducerSource, /already withdrawn into a delivery trip remains/);
assert.match(buildingTableSource, /#\[default\(0u8\)\][\s\S]*marketplace_pending_trade_code: u8/);
assert.match(buildingTableSource, /#\[default\(32u8\)\][\s\S]*marketplace_gold_reserve_target: u8/);
assert.match(generatedBuildingSource, /marketplacePendingTradeCode: __t\.u8\(\)/);
assert.match(generatedBuildingSource, /marketplaceGoldReserveTarget: __t\.u8\(\)/);
assert.match(generatedCancelReducerSource, /buildingId: __t\.u64\(\)/);
assert.match(generatedGoldReserveReducerSource, /goldReserveTarget: __t\.u8\(\)/);
assert.match(buildingSyncSource, /marketplacePendingTradeCode: row\.marketplacePendingTradeCode/);
assert.match(buildingSyncSource, /marketplaceGoldReserveTarget: row\.marketplaceGoldReserveTarget/);
assert.match(supplementalPanelSource, /cancel-marketplace-trade-order/);
assert.match(supplementalPanelSource, /onCancelMarketplaceTradeOrder/);
assert.match(inspectorActionsSource, /store\.cancelMarketplaceTradeOrder\(buildingId\)/);
assert.match(
  spacetimeReducersSource,
  /cancelMarketplaceTradeOrder[\s\S]*cancel_marketplace_trade_order/,
);
assert.match(
  spacetimeReducersSource,
  /setMarketplaceGoldReserveTarget[\s\S]*set_marketplace_gold_reserve_target/,
);
assert.match(marketplaceTradeSource, /contested-frontier worlds/);
assert.match(marketplaceTradeSource, /current_road_speed_multiplier/);
assert.match(marketplaceTradeSource, /manual_trade_cooldown_seconds\(assigned_labor, road_speed_multiplier\)/);
assert.match(
  marketplaceTradeSource,
  /building_disabled_by_fire\(ctx, (?:marketplace|building)\.id\)/,
);
assert.doesNotMatch(marketplaceTradeSource, /spend_aggregate_(?:food|firewood)/);
assert.doesNotMatch(marketplaceOrderSource, /credit_treasury_(?:food|water)/);
assert.match(marketplaceOrderSource, /marketplace\.gold = \(marketplace\.gold - gold_cost\)/);
assert.match(marketplaceTradeSource, /spend_marketplace_coffer_gold/);
assert.match(marketplaceOrderSource, /building_disabled_by_fire\(ctx, building\.id\)/);
assert.match(marketplaceInspectorSource, /Active regional routes/);
assert.match(marketplaceInspectorSource, /physically outbound to the regional exchange/);
assert.match(
  marketplaceTradeRendererSource,
  /returns with raid-vulnerable coin or barter cargo/,
);
assert.match(marketplaceInspectorSource, /getRoadConditionSpeedMultiplier/);
assert.match(marketplaceInspectorSource, /marketFireDisabled/);
assert.match(marketplaceInspectorSource, /Trading Post coffer/);
assert.match(marketplaceInspectorSource, /working gold/);
assert.match(marketplaceInspectorSource, /inboundCashTrip/);
assert.match(marketplaceTradeRendererSource, /current road conditions/);
assert.match(marketplaceTradeRendererSource, /visible source carts/);
assert.match(marketplaceTradeRendererSource, /regional merchant departure queued/);
assert.match(marketplaceTradeRendererSource, /final receipt follows the rate and surviving load/);
assert.match(marketplaceTradeRendererSource, /Trading Post cash reserve/);
assert.match(marketplaceTradeRendererSource, /data-marketplace-gold-reserve-target/);
assert.match(marketplaceTradeRendererSource, /physically held in this Trading Post coffer/);
assert.match(
  marketplaceTradeRendererSource,
  /Every paid import is carried from the map edge/,
  'the trade panel must explain the same physical rule for bulk, provender, and water orders',
);
assert.match(marketplaceTradeRendererSource, /cancel-marketplace-trade-order/);
assert.doesNotMatch(marketplaceTradeRendererSource, /click again after unloading/);

console.log(
  `marketplace trade tests passed (10k stock scan ${elapsed.toFixed(1)}ms; `
  + `proceeds scan ${proceedsElapsed.toFixed(1)}ms; `
  + `100k reserve checks ${reservePolicyElapsed.toFixed(1)}ms; `
  + `10k road checks ${connectivityElapsed.toFixed(1)}ms)`,
);
