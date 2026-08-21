import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILDING_DEFINITIONS,
  MARKETPLACE_TRADE_OFFERS,
  TRADE_RESOURCE_KINDS,
  type TradeResourceKind,
} from '../src/generated/gameBalance.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../src/economy/regionalMarket.ts';
import {
  buildingTradeStock,
  settlementTradeStock,
  tradingPostRule,
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
  'the monthly ledger must categorize every tradeable commodity exactly once',
);
assert.equal(
  BUILDING_DEFINITIONS.trading_post.maxLabor,
  2,
  'Trading Posts use two dedicated cart-hauler slots',
);

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
  assert.ok(buy, `${resource} needs a monthly import price`);
  assert.ok(sell, `${resource} needs a monthly export price`);
  assert.ok(
    buy.goldCost / buy.amount > sell.goldYield / sell.amount,
    `${resource} needs a positive merchant spread`,
  );
  const prices = tradingPostUnitPrices(resource, DEFAULT_REGIONAL_MARKET_STATE);
  assert.ok(prices.importGold > prices.exportGold && prices.exportGold > 0);
}

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

const panel = renderMarketplaceTradePanel(post, state, DEFAULT_REGIONAL_MARKET_STATE);
assert.match(panel, /Monthly trade ledger/);
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
assert.equal(
  (panel.match(/data-trade-rule-row/g) ?? []).length,
  TRADE_RESOURCE_KINDS.length,
  'the rendered scroll ledger must contain one rule row per commodity',
);
for (const section of TRADING_POST_TRADE_CATEGORIES) {
  assert.ok(panel.includes(section.label), `${section.label} section should render`);
}

const serverLoop = readFileSync('server/src/simulation/trading_post_trade.rs', 'utf8');
assert.match(serverLoop, /absolute_calendar_month/);
assert.match(serverLoop, /settle_due_rules/);
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
  'monthly regional settlement must not create an off-map caravan unit',
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
  `Marketplace trade tests passed (${TRADE_RESOURCE_KINDS.length} commodities, monthly abstract settlement, local export staging).`,
);
