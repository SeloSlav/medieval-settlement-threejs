import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  MARKETPLACE_SPECIALTY_EXPORT_POLICIES,
  marketplaceSpecialtyExportPlan,
  marketplaceSpecialtyExportPolicy,
  marketplaceSpecialtyQueue,
  specialtyExportPolicyAllows,
} from '../src/economy/specialtyTrade.ts';
import {
  MARKET_PRICE_MULTIPLIER_MAX,
  MARKET_PRICE_MULTIPLIER_MIN,
} from '../src/generated/gameBalance.ts';
import { specialtyPriceMultiplier } from '../src/economy/regionalMarket.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../src/economy/regionalMarket.ts';
import type { BuildingState } from '../src/resources/types.ts';
import { renderMarketplaceTradePanel } from '../src/resources/inspector/marketplaceTradeRenderer.ts';

function makeMarket(partial: Partial<BuildingState> = {}): BuildingState {
  return {
    id: 'market-1',
    kind: 'marketplace',
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
    ale: 10,
    preservedFood: 0,
    honey: 5,
    wine: 2,
    wool: 0,
    cloth: 4,
    ironwork: 0,
    polearms: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 2,
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

assert.deepEqual(
  MARKETPLACE_SPECIALTY_EXPORT_POLICIES.map(({ value, minRate }) => [value, minRate]),
  [[0, 0], [1, 0.98], [2, 1.05]],
);
assert.equal(marketplaceSpecialtyExportPolicy(undefined).value, 0);
assert.equal(marketplaceSpecialtyExportPolicy(99).value, 0);
assert.equal(specialtyExportPolicyAllows(99, 0.78), true);
assert.equal(specialtyExportPolicyAllows(0, 0.78), true);
assert.equal(specialtyExportPolicyAllows(1, 0.97), false);
assert.equal(specialtyExportPolicyAllows(1, 0.98), true);
assert.equal(specialtyExportPolicyAllows(2, 1.049), false);
assert.equal(specialtyExportPolicyAllows(2, 1.05), true);

const market = makeMarket({ marketplaceSpecialtyExportPolicy: 2 });
const heldPlan = marketplaceSpecialtyExportPlan(market, 1.04);
assert.equal(heldPlan.saleAllowed, false);
assert.ok(Math.abs(heldPlan.rateShortfall - 0.01) < 1e-9);
assert.equal(marketplaceSpecialtyExportPlan(market, 1.05).saleAllowed, true);

const neutralQueue = marketplaceSpecialtyQueue(market, 1);
const strongQueue = marketplaceSpecialtyQueue(market, 1.2);
assert.equal(neutralQueue.units, 21);
assert.equal(neutralQueue.goldValue, 24.7);
assert.ok(Math.abs(strongQueue.goldValue - neutralQueue.goldValue * 1.2) < 1e-9);
assert.equal(strongQueue.unitsPerSecond, neutralQueue.unitsPerSecond);
assert.equal(strongQueue.clearSeconds, neutralQueue.clearSeconds);

assert.equal(specialtyPriceMultiplier(0), MARKET_PRICE_MULTIPLIER_MIN);
assert.equal(specialtyPriceMultiplier(0.5), 1);
assert.equal(specialtyPriceMultiplier(1), MARKET_PRICE_MULTIPLIER_MAX);

const heldPanel = renderMarketplaceTradePanel(
  market,
  {
    timber: 0,
    stone: 0,
    firewood: 0,
    food: 0,
    grain: 0,
    ironwork: 0,
    gold: 0,
  },
  {
    ...DEFAULT_REGIONAL_MARKET_STATE,
    specialtyPriceMult: 1.04,
    regionalSpecialtyDemand: 0.536,
  },
  { ready: true, label: 'Trade desk ready', reason: null },
);
assert.match(heldPanel, /Specialty export policy/);
assert.match(heldPanel, /data-marketplace-specialty-export-policy="2"[^>]*disabled/);
assert.match(heldPanel, /Holding 21\.0 units/);
assert.match(heldPanel, /current rate 104% is 1 point below this floor/);
assert.match(heldPanel, /Specialties \+4% market/);

const tablesSource = readFileSync('server/src/tables.rs', 'utf8');
const policySource = readFileSync('server/src/specialty_trade_policy.rs', 'utf8');
const marketSource = readFileSync('server/src/economy/regional_market.rs', 'utf8');
const caravanSource = readFileSync('server/src/simulation/marketplace_caravan.rs', 'utf8');
const reducerSource = readFileSync('server/src/reducers/buildings.rs', 'utf8');
const rendererSource = readFileSync(
  'src/resources/inspector/marketplaceTradeRenderer.ts',
  'utf8',
);
const inspectorSource = readFileSync('src/resources/ResourceInspector.ts', 'utf8');
const generatedBuilding = readFileSync('src/generated/building_table.ts', 'utf8');
const generatedMarket = readFileSync('src/generated/market_state_table.ts', 'utf8');
const generatedReducer = readFileSync(
  'src/generated/set_marketplace_specialty_export_policy_reducer.ts',
  'utf8',
);

assert.match(
  tablesSource,
  /#\[default\(0u8\)\]\s+pub marketplace_specialty_export_policy: u8/,
  'existing marketplaces must retain the prior sell-at-any-rate behavior',
);
assert.match(tablesSource, /#\[default\(1\.0\)\]\s+pub specialty_price_mult: f64/);
assert.match(tablesSource, /#\[default\(0\.5\)\]\s+pub regional_specialty_demand: f64/);
assert.match(policySource, /SPECIALTY_EXPORT_FAIR_RATE_MIN: f64 = 0\.98/);
assert.match(policySource, /SPECIALTY_EXPORT_FAVORABLE_RATE_MIN: f64 = 1\.05/);
assert.match(
  reducerSource,
  /set_marketplace_specialty_export_policy[\s\S]*?is_valid_specialty_export_policy[\s\S]*?marketplace_specialty_export_policy = export_policy/,
);

const continuousMarketUpdate = marketSource.slice(
  marketSource.indexOf('pub fn record_specialty_market_export'),
  marketSource.indexOf('fn refresh_market_prices'),
);
assert.match(continuousMarketUpdate, /adjust_demand_index/);
assert.match(continuousMarketUpdate, /MarketTradeDirection::Export/);
assert.match(continuousMarketUpdate, /specialty_price_multiplier/);
assert.doesNotMatch(
  continuousMarketUpdate,
  /local_food_demand_pressure/,
  'continuous specialty sales must not rescan every household',
);
assert.match(marketSource, /drift_index\(state\.regional_specialty_demand/);

const specialtySale = caravanSource.slice(
  caravanSource.indexOf('fn sell_marketplace_specialties'),
);
assert.match(specialtySale, /specialty_export_policy_allows/);
assert.match(specialtySale, /gold_per_unit \* market_rate/);
assert.match(specialtySale, /record_specialty_market_export/);

assert.match(rendererSource, /data-marketplace-specialty-export-policy/);
assert.match(rendererSource, /Selling deepens regional supply and lowers the next rate/);
assert.match(inspectorSource, /onSetMarketplaceSpecialtyExportPolicy/);
assert.match(generatedBuilding, /marketplaceSpecialtyExportPolicy/);
assert.match(generatedMarket, /specialtyPriceMult/);
assert.match(generatedMarket, /regionalSpecialtyDemand/);
assert.match(generatedReducer, /exportPolicy/);

const start = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  const rate = 0.78 + (index % 61) / 100;
  checksum += marketplaceSpecialtyQueue(market, rate).goldValue;
  checksum += marketplaceSpecialtyExportPlan(market, rate).rateShortfall;
}
const elapsed = performance.now() - start;
assert.ok(checksum > 0);
assert.ok(elapsed < 250, `100k specialty policy projections took ${elapsed.toFixed(1)}ms`);

console.log(
  `marketplace specialty policy tests passed (${elapsed.toFixed(1)}ms for 100k projections)`,
);
