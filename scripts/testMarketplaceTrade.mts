import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  MARKETPLACE_TRADE_OFFERS,
  REGIONAL_EXCHANGE_INTERVAL_SECONDS,
  SIM_REALTIME_RATE,
  SIM_TICK_SECONDS,
  TRADE_RESOURCE_KINDS,
  type TradeResourceKind,
} from '../src/generated/gameBalance.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../src/economy/regionalMarket.ts';
import {
  buildingTradeStock,
  fairImportGoldBudget,
  formatRegionalExchangeCountdown,
  importTargetFulfillment,
  tradingPostServiceRouteOrder,
  regionalExchangeRealSecondsAt4x,
  regionalExchangeSecondsUntilNext,
  regionalExchangeSequence,
  settlementTradeStock,
  tradingPostRule,
  tradingPostExchangeDue,
  tradingPostImportFundingOrder,
  tradingPostRuleId,
  tradingPostUnitPrices,
  TRADE_MODE_EXPORT,
  TRADE_RESOURCE_COMMODITY_CODES,
  TRADE_RESOURCE_LABELS,
  TRADING_POST_TRADE_CATEGORIES,
  validateTradingPostCommodityCatalog,
  type TradingPostTradeRuleState,
} from '../src/economy/tradingPostTrade.ts';
import { renderMarketplaceTradePanel } from '../src/resources/inspector/marketplaceTradeRenderer.ts';
import { marketplaceManualTradeStatus } from '../src/economy/marketplaceTrade.ts';
import type { BuildingState, GameState } from '../src/resources/types.ts';
import { computeMarketplaceTradeAvailability } from '../src/resources/resourceTotals.ts';

function building(
  id: string,
  kind: string,
  stock: Partial<Record<TradeResourceKind, number>> = {},
): BuildingState {
  return {
    id,
    kind,
    constructionComplete: true,
    assignedLabor: 2,
    ...stock,
  } as BuildingState;
}

assert.equal(
  validateTradingPostCommodityCatalog(),
  true,
  'the regional ledger must categorize every tradeable commodity exactly once',
);
assert.equal(
  BUILDING_DEFINITIONS.trading_post.maxLabor,
  2,
  'Trading Posts use two dedicated cart-hauler slots',
);
assert.equal(BUILDING_STORAGE_CAPS.trading_post.cider, 180);
assert.equal(BUILDING_STORAGE_CAPS.trading_post.pearCider, 180);
assert.equal(BUILDING_STORAGE_CAPS.tavern.cider, 60);
assert.equal(BUILDING_STORAGE_CAPS.tavern.pearCider, 60);

const categorized = TRADING_POST_TRADE_CATEGORIES.flatMap((section) => section.resources);
assert.deepEqual(
  [...categorized].sort(),
  [...TRADE_RESOURCE_KINDS].sort(),
  'the scroll ledger must expose every generated non-currency trade resource',
);
assert.equal(new Set(Object.values(TRADE_RESOURCE_COMMODITY_CODES)).size, TRADE_RESOURCE_KINDS.length);
assert.equal('gold' in TRADE_RESOURCE_COMMODITY_CODES, false, 'gold is currency, not a trade commodity');
assert.equal(TRADE_RESOURCE_COMMODITY_CODES.wine, 9, 'wine must be exposed as a trade commodity');

for (const resource of TRADE_RESOURCE_KINDS) {
  assert.ok(TRADE_RESOURCE_LABELS[resource], `${resource} needs a player-facing ledger label`);
  assert.ok(Number.isInteger(TRADE_RESOURCE_COMMODITY_CODES[resource]), `${resource} needs a server commodity code`);
  const buy = MARKETPLACE_TRADE_OFFERS.find(
    (offer) => offer.kind === 'goldBuy' && offer.resource === resource,
  );
  const sell = MARKETPLACE_TRADE_OFFERS.find(
    (offer) => offer.kind === 'goldSell' && offer.resource === resource,
  );
  assert.ok(buy, `${resource} needs a regional import price`);
  assert.ok(sell, `${resource} needs a regional export price`);
  assert.ok(
    buy.goldCost / buy.amount > sell.goldYield / sell.amount,
    `${resource} needs a positive merchant spread`,
  );
  const prices = tradingPostUnitPrices(resource, DEFAULT_REGIONAL_MARKET_STATE);
  assert.ok(prices.importGold > prices.exportGold && prices.exportGold > 0);
  const urbanPrices = tradingPostUnitPrices(resource, DEFAULT_REGIONAL_MARKET_STATE, 1.12);
  assert.ok(
    urbanPrices.importGold > urbanPrices.exportGold,
    `${resource} must retain a positive merchant spread at maximum Urban affinity`,
  );
}

const regionalExchangeTicks = Math.ceil(
  REGIONAL_EXCHANGE_INTERVAL_SECONDS / SIM_TICK_SECONDS,
);
assert.equal(regionalExchangeSequence(regionalExchangeTicks - 1), 0);
assert.equal(regionalExchangeSequence(regionalExchangeTicks), 1);
assert.equal(regionalExchangeSecondsUntilNext(0), REGIONAL_EXCHANGE_INTERVAL_SECONDS);
assert.equal(regionalExchangeSecondsUntilNext(regionalExchangeTicks), REGIONAL_EXCHANGE_INTERVAL_SECONDS);
assert.equal(regionalExchangeRealSecondsAt4x(REGIONAL_EXCHANGE_INTERVAL_SECONDS), 10);
assert.ok(
  2 * REGIONAL_EXCHANGE_INTERVAL_SECONDS / (SIM_REALTIME_RATE * 4) < 30,
  'two exchange opportunities must fit inside 30 real seconds at 4×',
);
assert.match(formatRegionalExchangeCountdown(0), /30 simulation seconds.*10 real seconds at 4×/);
const ordinaryAlePrices = tradingPostUnitPrices('ale', DEFAULT_REGIONAL_MARKET_STATE);
const urbanAlePrices = tradingPostUnitPrices('ale', DEFAULT_REGIONAL_MARKET_STATE, 1.12);
assert.ok(urbanAlePrices.importGold < ordinaryAlePrices.importGold);
assert.equal(urbanAlePrices.exportGold, ordinaryAlePrices.exportGold);

const post = building('building-9', 'trading_post', { firewood: 11, charcoal: 4 });
const storehouse = building('building-10', 'village_storehouse', { firewood: 42, charcoal: 8 });
const exportFirewood: TradingPostTradeRuleState = {
  id: tradingPostRuleId(post.id, 'firewood'),
  buildingId: post.id,
  commodityKind: TRADE_RESOURCE_COMMODITY_CODES.firewood,
  commodity: 'firewood',
  mode: TRADE_MODE_EXPORT,
  targetSurplus: 30,
  lastSettledMonth: 7,
  lastTradeAmount: 9,
  lastTradeGold: 4.5,
};
const state = {
  tick: 0,
  buildings: new Map([[post.id, post], [storehouse.id, storehouse]]),
  tradingPostTradeRules: new Map([[exportFirewood.id, exportFirewood]]),
} as GameState;

function oatTradeAvailability(
  source: BuildingState,
  headCount?: number,
): number {
  const tradeState = {
    physicalFoundingSiteEnabled: true,
    stockpile: {},
    buildings: new Map([[post.id, post], [source.id, source]]),
    livestockHerds: new Map(headCount === undefined
      ? []
      : [['pasture-feed-test', {
          pastureId: 'pasture-feed-test',
          buildingId: source.id,
          headCount,
        }]]),
    fireIncidents: new Map(),
    residences: new Map(),
  } as unknown as GameState;
  return computeMarketplaceTradeAvailability(
    tradeState,
    post,
    () => true,
  ).oatGrain;
}

const pastoralFeedOats = building(
  'pastoral-feed-oats',
  'pastoral_farmstead',
  { oatGrain: 18 },
);
assert.equal(
  oatTradeAvailability(pastoralFeedOats, 4),
  0,
  'a live pastoral herd must protect every staged oat unit from Trading Post export',
);
assert.equal(
  oatTradeAvailability(pastoralFeedOats, 0),
  18,
  'an empty pastoral holding must release all 18 physical oat units, not 9 meal-equivalents',
);
const reserveGranary = {
  ...building('reserve-granary', 'granary', { oatGrain: 20 }),
  granaryGrainReserve: 5,
} as BuildingState;
assert.equal(
  oatTradeAvailability(reserveGranary),
  15,
  'the existing granary export floor must remain unchanged',
);

assert.equal(
  marketplaceManualTradeStatus({ ...post, actionCooldown: 7 }, true).ready,
  true,
  'the saved Trading Post service-route cursor must never masquerade as a timed regional cooldown',
);

assert.equal(buildingTradeStock(post, 'firewood'), 11);
assert.equal(settlementTradeStock(state, 'firewood'), 53);
assert.equal(settlementTradeStock(state, 'firewood', false), 42);
assert.equal(tradingPostRule(state.tradingPostTradeRules, post.id, 'firewood'), exportFirewood);
assert.equal(tradingPostRule(state.tradingPostTradeRules, post.id, 'charcoal'), null);
assert.equal(tradingPostExchangeDue([exportFirewood], state.tick), false);
assert.equal(tradingPostExchangeDue(
  [{ ...exportFirewood, lastSettledMonth: 0 }],
  regionalExchangeTicks,
), true);

const importRules = [
  {
    ...exportFirewood,
    id: tradingPostRuleId(post.id, 'ale'),
    commodityKind: TRADE_RESOURCE_COMMODITY_CODES.ale,
    commodity: 'ale' as const,
    mode: 1 as const,
    lastSettledMonth: 0,
  },
  {
    ...exportFirewood,
    id: tradingPostRuleId(post.id, 'cloth'),
    commodityKind: TRADE_RESOURCE_COMMODITY_CODES.cloth,
    commodity: 'cloth' as const,
    mode: 1 as const,
    lastSettledMonth: 0,
  },
];
assert.deepEqual(
  tradingPostImportFundingOrder(importRules, regionalExchangeTicks),
  ['cloth', 'ale'],
  'the next exchange must rotate its first-funded import away from the stable lowest commodity code',
);
assert.deepEqual(
  tradingPostImportFundingOrder(
    importRules.map((rule) => ({ ...rule, lastSettledMonth: 1 })),
    regionalExchangeTicks,
  ),
  ['ale', 'cloth'],
  'after the current boundary settles, the inspector must forecast the following server rotation',
);
assert.deepEqual(
  tradingPostImportFundingOrder(importRules, regionalExchangeTicks * 2),
  ['ale', 'cloth'],
  'a due second exchange must use that current server settlement sequence',
);
assert.deepEqual(
  tradingPostImportFundingOrder(
    [importRules[0], { ...importRules[1], lastSettledMonth: 1 }],
    regionalExchangeTicks,
  ),
  ['ale'],
  'the inspector must rotate only the currently due cohort when a newer rule is staggered',
);
assert.equal(importTargetFulfillment(0, 12), 0);
assert.equal(importTargetFulfillment(3, 12), 0.25);
assert.equal(importTargetFulfillment(20, 12), 1);
assert.equal(fairImportGoldBudget(1, 3), 0.33);
assert.equal(fairImportGoldBudget(0.67, 2), 0.33);
assert.deepEqual(tradingPostServiceRouteOrder(4, 12).slice(0, 5), [4, 5, 6, 7, 8]);
assert.deepEqual(tradingPostServiceRouteOrder(Number.NaN, 3), [0, 1, 2]);
assert.deepEqual(
  tradingPostImportFundingOrder(
    importRules,
    regionalExchangeTicks,
    (resource) => resource === 'cloth' ? 4.85 : 0,
  ),
  ['ale', 'cloth'],
  'an unserved import must outrank the rotated tie-break that previously starved it',
);

const panel = renderMarketplaceTradePanel(post, state, DEFAULT_REGIONAL_MARKET_STATE);
assert.match(panel, /Regional trade ledger/);
assert.match(panel, /In 30 simulation seconds.*10 real seconds at 4×/);
assert.match(panel, /staged exports sell before imports/);
assert.match(panel, /shared in conserved partial tranches across every due import/);
assert.match(panel, /successful local cart advances a saved fair route cursor/);
assert.match(panel, /regional exchange is abstract/i);
assert.match(panel, /only local collection and distribution use visible haulers/i);
assert.match(panel, /data-trading-post-scroll/);
assert.match(panel, /2\/2<\/strong> cart haulers/);
assert.match(panel, /units per collection cart/);
assert.match(panel, /data-trade-surplus-input/);
assert.match(panel, /data-trade-surplus-delta="-1"/);
assert.match(panel, /data-trade-surplus-delta="1"/);
assert.match(panel, /Keep in settlement/);
assert.match(panel, /last sold 9 for 4\.5g/);
assert.match(panel, /data-resource-token="firewood"/);
assert.match(panel, /data-tooltip-title="Firewood"/);
assert.match(panel, /data-tooltip="Settlement: 42 · Trading Post: 11 · Buy:/);
assert.doesNotMatch(panel, /title="Current regional unit prices"/);
assert.doesNotMatch(panel, /trading-post-ledger__rates/);
assert.doesNotMatch(panel, /trading-post-ledger__status/);
assert.equal(
  (panel.match(/trading-post-ledger__resource-anchor/g) ?? []).length,
  TRADE_RESOURCE_KINDS.length,
  'every commodity row must expose one resource-icon hover anchor',
);
assert.equal(
  (panel.match(/data-trade-rule-row/g) ?? []).length,
  TRADE_RESOURCE_KINDS.length,
  'the rendered scroll ledger must contain one rule row per commodity',
);
for (const section of TRADING_POST_TRADE_CATEGORIES) {
  assert.ok(panel.includes(section.label), `${section.label} section should render`);
}

const serverLoop = readFileSync('server/src/simulation/trading_post_trade.rs', 'utf8');
assert.match(serverLoop, /regional_exchange_sequence/);
assert.match(serverLoop, /settle_due_rules/);
assert.match(
  serverLoop,
  /sort_by_key\(\|rule\| trade_rule_settlement_key\(rule\.mode, rule\.commodity_kind\)\)/,
  'exports must settle before imports so real export proceeds can fund the same exchange',
);
assert.match(
  serverLoop,
  /fair_whole_import_gold_budget\([\s\S]*?treasury_gold\(ctx, post\.owner\)[\s\S]*?remaining_imports/,
  'each due import must receive a conserved share of the real treasury rather than a first-rule monopoly',
);
assert.match(
  serverLoop,
  /import_rule_rotation_offset\(current_exchange, import_count\)[\s\S]*?rotate_left\(rotation\)/,
  'authority must rotate the first-funded import every exchange when civic gold is constrained',
);
assert.match(
  serverLoop,
  /imports\.sort_by[\s\S]*?import_rule_fulfillment/,
  'authority must fund the least-fulfilled due import before applying its rotated tie-break',
);
assert.match(serverLoop, /stage_one_export/);
assert.match(serverLoop, /credit_treasury_gold/);
assert.match(serverLoop, /spend_treasury_gold/);
assert.match(
  serverLoop,
  /protected_outside_stock[\s\S]*?exportable_surplus\(available, rule\.target_surplus\)/,
  'export collection must leave the configured settlement-wide stock floor outside the post',
);
assert.match(
  serverLoop,
  /source\.id != post\.id[\s\S]*?source_exportable_stock\(ctx, source, commodity\)[\s\S]*?try_start_building_supply_trip/,
  'export haulers must collect directly from any connected producer or storage building',
);
assert.match(
  serverLoop,
  /pasture_herd\(\)[\s\S]*?farmstead_id\(\)[\s\S]*?filter\(&building\.id\)[\s\S]*?herd\.head_count > 0[\s\S]*?livestock_feed_oat_exportable_stock/,
  'authoritative oat export collection must aggregate the source holding\'s live pasture herds',
);
assert.match(
  serverLoop,
  /building\.kind == "granary"[\s\S]*?granary_exportable_grain\(stock, protected\)/,
  'pastoral feed protection must preserve the existing granary reserve branch',
);
assert.doesNotMatch(
  serverLoop,
  /start_regional_market_export_trip|regional_market_export_route/,
  'bounded abstract regional settlement must not create an off-map caravan unit',
);

const tradeRuleReducer = readFileSync('server/src/reducers/trading_post_trade.rs', 'utf8');
assert.match(
  tradeRuleReducer,
  /regional_exchange_sequence\(config\.sim_tick\)/,
);
assert.match(tradeRuleReducer, /last_settled_month: current_exchange/);

const localDistribution = readFileSync('server/src/simulation/marketplace_caravan.rs', 'utf8');
assert.match(
  localDistribution,
  /trading_post_service_route_order\([\s\S]*?trading_post\.action_cooldown[\s\S]*?trading_post_service_cursor_after_success/,
  'Trading Post last-mile carts must advance a saved cursor only after a successful physical dispatch',
);
assert.match(
  localDistribution,
  /ResidenceNeedKind::Ale, Some\(CommodityKind::Ale\)[\s\S]*ResidenceNeedKind::Ale, Some\(CommodityKind::Cider\)[\s\S]*ResidenceNeedKind::Ale, Some\(CommodityKind::PearCider\)/,
  'all imported beverage identities must remain distinct in local routing',
);
assert.match(
  localDistribution,
  /ResidenceNeedKind::Ale => Some\("tavern"\)[\s\S]*market\.kind != "tavern" \|\| onsite_building_labor\(ctx, market\) > 0/,
  'imported beverages must use a staffed reachable Tavern, not a Marketplace',
);
assert.match(
  localDistribution,
  /building\.ale > 1e-6[\s\S]*building\.cider > 1e-6[\s\S]*building\.pear_cider > 1e-6/,
  'a cider-only Trading Post must remain eligible for local distribution',
);

const simulationReducer = readFileSync('server/src/reducers/simulation.rs', 'utf8');
const exportStep = simulationReducer.lastIndexOf('step_trading_post_trade(ctx, &tick, &clock);');
const householdStep = simulationReducer.lastIndexOf('step_household_discretionary_trade(ctx, &tick, &clock);');
assert.ok(exportStep >= 0 && exportStep < householdStep, 'export staging must run before local trade and later logistics');

const householdTrade = readFileSync('server/src/simulation/household_discretionary_trade.rs', 'utf8');
assert.match(
  householdTrade,
  /trading_post_exports_commodity\(ctx, trading_post\.id, commodity\)/,
  'local shoppers must not consume stock committed to an export rule',
);

const legacyReducer = readFileSync('server/src/reducers/marketplace_trade.rs', 'utf8');
assert.match(legacyReducer, /Immediate regional trade has been retired/);
assert.doesNotMatch(legacyReducer, /execute_marketplace_trade/);

console.log(
  `Marketplace trade tests passed (${TRADE_RESOURCE_KINDS.length} commodities, bounded abstract exchange, local export staging and Tavern beverage routing).`,
);
