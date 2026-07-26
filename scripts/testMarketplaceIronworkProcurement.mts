import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  MARKETPLACE_IRONWORK_IMPORT_LOT,
  MARKETPLACE_IRONWORK_IMPORT_OFFER,
  MARKETPLACE_IRONWORK_TARGETS,
  marketplaceIronworkProcurementPlan,
  normalizeMarketplaceIronworkTarget,
} from '../src/economy/marketplaceIronworkPolicy.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../src/economy/regionalMarket.ts';
import { renderMarketplaceTradePanel } from '../src/resources/inspector/marketplaceTradeRenderer.ts';
import type { BuildingState } from '../src/resources/types.ts';

assert.deepEqual(MARKETPLACE_IRONWORK_TARGETS, [0, 6, 12, 24, 48]);
assert.equal(MARKETPLACE_IRONWORK_IMPORT_OFFER.id, 'buy_ironwork');
assert.equal(MARKETPLACE_IRONWORK_IMPORT_LOT, 6);
assert.equal(MARKETPLACE_IRONWORK_IMPORT_OFFER.goldCost, 12);
assert.equal(normalizeMarketplaceIronworkTarget(undefined), 0);
assert.equal(normalizeMarketplaceIronworkTarget(18), 12);
assert.equal(normalizeMarketplaceIronworkTarget(255), 48);

assert.deepEqual(
  marketplaceIronworkProcurementPlan({
    ironwork: 0,
    marketplaceIronworkTarget: undefined,
  }),
  {
    target: 0,
    stock: 0,
    ordersToTarget: 0,
    nextOrderDue: false,
  },
);
assert.deepEqual(
  marketplaceIronworkProcurementPlan({
    ironwork: 0,
    marketplaceIronworkTarget: 12,
  }),
  {
    target: 12,
    stock: 0,
    ordersToTarget: 2,
    nextOrderDue: true,
  },
);
assert.deepEqual(
  marketplaceIronworkProcurementPlan({
    ironwork: 7,
    marketplaceIronworkTarget: 12,
  }),
  {
    target: 12,
    stock: 7,
    ordersToTarget: 0,
    nextOrderDue: false,
  },
  'whole-lot procurement must not overshoot the selected market target',
);

const marketplace = {
  id: 'building:42',
  kind: 'marketplace',
  constructionComplete: true,
  assignedLabor: 1,
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
  ironwork: 0,
  marketplaceIronworkTarget: 12,
} as BuildingState;
const tradeAvailability = {
  timber: 0,
  stone: 0,
  firewood: 0,
  food: 0,
  grain: 0,
  ironwork: 0,
  gold: 100,
};
const manualTrade = { ready: true, label: 'Trade desk ready', reason: null };
const frontierPanel = renderMarketplaceTradePanel(
  marketplace,
  tradeAvailability,
  DEFAULT_REGIONAL_MARKET_STATE,
  manualTrade,
  true,
);
assert.match(frontierPanel, /Frontier ironwork procurement/);
assert.match(frontierPanel, /data-marketplace-ironwork-target="12" disabled/);
assert.match(frontierPanel, /Next six-unit lot ready for 12 gold; 2 lots remain/);
assert.doesNotMatch(
  renderMarketplaceTradePanel(
    marketplace,
    tradeAvailability,
    DEFAULT_REGIONAL_MARKET_STATE,
    manualTrade,
    false,
  ),
  /Frontier ironwork procurement/,
  'peaceful-world markets must not expose military procurement',
);

const tablesSource = fs.readFileSync('server/src/tables.rs', 'utf8');
const reducerSource = fs.readFileSync('server/src/reducers/buildings.rs', 'utf8');
const tradeSource = fs.readFileSync('server/src/economy/marketplace_trade.rs', 'utf8');
const caravanSource = fs.readFileSync('server/src/simulation/marketplace_caravan.rs', 'utf8');
const generatedTable = fs.readFileSync('src/generated/building_table.ts', 'utf8');
const generatedReducer = fs.readFileSync(
  'src/generated/set_marketplace_ironwork_target_reducer.ts',
  'utf8',
);
const rendererSource = fs.readFileSync(
  'src/resources/inspector/marketplaceTradeRenderer.ts',
  'utf8',
);
const inspectorSource = fs.readFileSync('src/resources/ResourceInspector.ts', 'utf8');

assert.match(
  tablesSource,
  /#\[default\(0u8\)\]\s+pub marketplace_ironwork_target: u8/,
  'existing saves must remain manual-only after the additive migration',
);
assert.match(
  reducerSource,
  /set_marketplace_ironwork_target[\s\S]*?is_valid_marketplace_ironwork_target[\s\S]*?building\.marketplace_ironwork_target = ironwork_target/,
  'the authoritative reducer must validate and persist only bounded targets',
);
const standingImportSource = tradeSource.slice(
  tradeSource.indexOf('pub fn try_execute_standing_ironwork_import'),
  tradeSource.indexOf('fn execute_food_commodity_trade'),
);
for (const contract of [
  'conflict_enabled',
  'standing_ironwork_import_due',
  'apply_marketplace_trade',
  'start_manual_trade_cooldown',
]) {
  assert.ok(
    standingImportSource.includes(contract),
    `standing procurement must retain ${contract}`,
  );
}
assert.ok(
  standingImportSource.indexOf('apply_marketplace_trade')
    < standingImportSource.indexOf('start_manual_trade_cooldown'),
  'broker cooldown starts only after a regional trade commits',
);
assert.match(
  caravanSource,
  /clock\.sim_tick % 5 == building_id % 5[\s\S]*?try_execute_standing_ironwork_import/,
  'market procurement checks must be staggered rather than run for every market every tick',
);
assert.match(generatedTable, /marketplaceIronworkTarget: __t\.u8\(\)/);
assert.match(generatedReducer, /ironworkTarget: __t\.u8\(\)/);
for (const feedbackContract of [
  'Frontier ironwork procurement',
  'data-marketplace-ironwork-target',
  'current regional rates',
  'carpenters must still collect the fittings by road',
]) {
  assert.ok(
    rendererSource.includes(feedbackContract),
    `marketplace inspector must explain ${feedbackContract}`,
  );
}
assert.match(
  inspectorSource,
  /data-marketplace-ironwork-target[\s\S]*?onSetMarketplaceIronworkTarget/,
);

const performanceStarted = performance.now();
let orders = 0;
for (let index = 0; index < 100_000; index += 1) {
  orders += marketplaceIronworkProcurementPlan({
    ironwork: index % 49,
    marketplaceIronworkTarget: 48,
  }).ordersToTarget;
}
const performanceElapsed = performance.now() - performanceStarted;
assert.ok(orders > 0);
assert.ok(
  performanceElapsed < 250,
  `100k marketplace procurement forecasts regressed (${performanceElapsed.toFixed(1)} ms)`,
);

console.log(
  `marketplace ironwork procurement tests passed (${performanceElapsed.toFixed(1)} ms for 100k forecasts)`,
);
