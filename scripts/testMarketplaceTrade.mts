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
  formatRegionalExchangeCountdown,
  regionalExchangeRealSecondsAt4x,
  regionalExchangeSecondsUntilNext,
  regionalExchangeSequence,
  settlementTradeStock,
  tradingPostRule,
  tradingPostExchangeDue,
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
import type { BuildingState, GameState } from '../src/resources/types.ts';

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
assert.equal(BUILDING_STORAGE_CAPS.tavern.cider, 180);
assert.equal(BUILDING_STORAGE_CAPS.tavern.pearCider, 180);

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

const panel = renderMarketplaceTradePanel(post, state, DEFAULT_REGIONAL_MARKET_STATE);
assert.match(panel, /Regional trade ledger/);
assert.match(panel, /In 30 simulation seconds.*10 real seconds at 4×/);
assert.match(panel, /staged exports sell before imports/);
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
  /source\.id != post\.id[\s\S]*?source_exportable_stock\(source, commodity\)[\s\S]*?try_start_building_supply_trip/,
  'export haulers must collect directly from any connected producer or storage building',
);
assert.doesNotMatch(
  serverLoop,
  /start_regional_market_export_trip|regional_market_export_route/,
  'bounded abstract regional settlement must not create an off-map caravan unit',
);

const tradeRuleReducer = readFileSync('server/src/reducers/trading_post_trade.rs', 'utf8');
assert.match(tradeRuleReducer, /regional_exchange_sequence\(config\.sim_tick\)/);
assert.match(tradeRuleReducer, /last_settled_month: current_exchange/);

const localDistribution = readFileSync('server/src/simulation/marketplace_caravan.rs', 'utf8');
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
