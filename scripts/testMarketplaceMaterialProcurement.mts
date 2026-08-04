import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  MARKETPLACE_IRON_IMPORT_LOT,
  MARKETPLACE_IRON_IMPORT_OFFER,
  MARKETPLACE_IRON_TARGETS,
  MARKETPLACE_SALT_IMPORT_LOT,
  MARKETPLACE_SALT_IMPORT_OFFER,
  MARKETPLACE_SALT_TARGETS,
  marketplaceIronProcurementPlan,
  marketplaceSaltProcurementPlan,
  normalizeMarketplaceIronTarget,
  normalizeMarketplaceSaltTarget,
} from '../src/economy/marketplaceMaterialProcurementPolicy.ts';
import {
  nextMarketplaceStandingOrder,
} from '../src/economy/marketplaceSeedPolicy.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../src/economy/regionalMarket.ts';
import { renderMarketplaceTradePanel } from '../src/resources/inspector/marketplaceTradeRenderer.ts';
import type { BuildingState } from '../src/resources/types.ts';

assert.deepEqual(MARKETPLACE_IRON_TARGETS, [0, 12, 24, 36, 48]);
assert.deepEqual(MARKETPLACE_SALT_TARGETS, [0, 12, 24, 48, 72]);
assert.equal(MARKETPLACE_IRON_IMPORT_OFFER.id, 'buy_iron');
assert.equal(MARKETPLACE_IRON_IMPORT_LOT, 12);
assert.equal(MARKETPLACE_SALT_IMPORT_OFFER.id, 'buy_salt');
assert.equal(MARKETPLACE_SALT_IMPORT_LOT, 12);
assert.equal(normalizeMarketplaceIronTarget(undefined), 0);
assert.equal(normalizeMarketplaceIronTarget(35), 24);
assert.equal(normalizeMarketplaceIronTarget(255), 48);
assert.equal(normalizeMarketplaceSaltTarget(undefined), 0);
assert.equal(normalizeMarketplaceSaltTarget(47), 24);
assert.equal(normalizeMarketplaceSaltTarget(255), 72);

assert.deepEqual(
  marketplaceIronProcurementPlan({
    iron: 0,
    marketplaceIronTarget: 24,
  }),
  {
    target: 24,
    stock: 0,
    ordersToTarget: 2,
    nextOrderDue: true,
  },
);
assert.deepEqual(
  marketplaceIronProcurementPlan({
    iron: 13,
    marketplaceIronTarget: 24,
  }),
  {
    target: 24,
    stock: 13,
    ordersToTarget: 0,
    nextOrderDue: false,
  },
  'standing iron orders must not overshoot the selected reserve',
);
assert.deepEqual(
  marketplaceSaltProcurementPlan({
    salt: 0,
    marketplaceSaltTarget: 72,
  }),
  {
    target: 72,
    stock: 0,
    ordersToTarget: 6,
    nextOrderDue: true,
  },
);
assert.deepEqual(
  marketplaceSaltProcurementPlan({
    salt: 61,
    marketplaceSaltTarget: 72,
  }),
  {
    target: 72,
    stock: 61,
    ordersToTarget: 0,
    nextOrderDue: false,
  },
  'standing salt orders must wait when another full lot would overshoot',
);

assert.equal(
  nextMarketplaceStandingOrder({
    grain: 0,
    marketplaceSeedGrainTarget: 48,
    salt: 0,
    marketplaceSaltTarget: 24,
    iron: 0,
    marketplaceIronTarget: 24,
    ironwork: 0,
    marketplaceIronworkTarget: 12,
  }, false),
  'seedGrain',
  'seed security should win an initial exact tie in peaceful worlds',
);
assert.equal(
  nextMarketplaceStandingOrder({
    grain: 25,
    marketplaceSeedGrainTarget: 48,
    salt: 0,
    marketplaceSaltTarget: 24,
    iron: 0,
    marketplaceIronTarget: 24,
    ironwork: 0,
    marketplaceIronworkTarget: 12,
  }, false),
  'salt',
  'preservation salt should win an exact tie with raw iron',
);
assert.equal(
  nextMarketplaceStandingOrder({
    grain: 25,
    marketplaceSeedGrainTarget: 48,
    salt: 12,
    marketplaceSaltTarget: 24,
    iron: 0,
    marketplaceIronTarget: 24,
    ironwork: 0,
    marketplaceIronworkTarget: 12,
  }, false),
  'iron',
  'raw iron should take the next broker turn once salt receives a lot',
);
assert.equal(
  nextMarketplaceStandingOrder({
    grain: 25,
    marketplaceSeedGrainTarget: 48,
    salt: 12,
    marketplaceSaltTarget: 24,
    iron: 12,
    marketplaceIronTarget: 24,
    ironwork: 0,
    marketplaceIronworkTarget: 12,
  }, true),
  'ironwork',
  'frontier fittings should enter the same queue only in conflict-enabled worlds',
);

const marketplace = {
  id: 'building:material-market',
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
  gold: 100,
  ironwork: 0,
  iron: 0,
  salt: 0,
  marketplaceSeedGrainTarget: 0,
  marketplaceIronworkTarget: 0,
  marketplaceIronTarget: 24,
  marketplaceSaltTarget: 24,
} as BuildingState;
const panel = renderMarketplaceTradePanel(
  marketplace,
  {
    timber: 0,
    stone: 0,
    firewood: 0,
    food: 0,
    grain: 0,
    ironwork: 0,
    gold: 100,
  },
  DEFAULT_REGIONAL_MARKET_STATE,
  { ready: true, label: 'Trade desk ready', reason: null },
  false,
);
assert.match(panel, /Workshop input reserves/);
assert.match(panel, /Iron reserve for smithing/);
assert.match(panel, /Salt reserve/);
assert.match(panel, /data-marketplace-iron-target="24" disabled/);
assert.match(panel, /data-marketplace-salt-target="24" disabled/);
assert.match(panel, /Queued behind the more depleted salt reserve; 2 iron lots remain/);
assert.match(panel, /Next twelve-unit lot ready for 14 gold; 2 lots remain/);
assert.match(
  panel,
  /Mine carts restore staffed workshop buffers first[\s\S]*carry surplus iron or salt to a staffed road-linked Trading Post/,
  'the inspector must explain local-first physical reserve logistics',
);
assert.match(panel, /Pottery promised to an active export order stays at the Trading Post/);

const tablesSource = fs.readFileSync('server/src/tables.rs', 'utf8');
const reducerSource = fs.readFileSync('server/src/reducers/buildings.rs', 'utf8');
const tradeSource = fs.readFileSync('server/src/economy/marketplace_trade.rs', 'utf8');
const caravanSource = fs.readFileSync('server/src/simulation/marketplace_caravan.rs', 'utf8');
const deliveryTripSource = fs.readFileSync(
  'server/src/simulation/delivery_trips.rs',
  'utf8',
);
const tradePolicySource = fs.readFileSync(
  'server/src/economy/marketplace_trade_policy.rs',
  'utf8',
);
const generatedTable = fs.readFileSync('src/generated/building_table.ts', 'utf8');
const generatedIronReducer = fs.readFileSync(
  'src/generated/set_marketplace_iron_target_reducer.ts',
  'utf8',
);
const generatedSaltReducer = fs.readFileSync(
  'src/generated/set_marketplace_salt_target_reducer.ts',
  'utf8',
);
const inspectorSource = fs.readFileSync('src/resources/ResourceInspector.ts', 'utf8');
const syncSource = fs.readFileSync('src/data/spacetimeTableSync/syncBuildings.ts', 'utf8');
const settlementForecastSource = fs.readFileSync(
  'src/economy/settlementSeedProcurement.ts',
  'utf8',
);

for (const field of ['marketplace_iron_target', 'marketplace_salt_target']) {
  assert.match(
    tablesSource,
    new RegExp(`#\\[default\\(0u8\\)\\]\\s+pub ${field}: u8`),
    `${field} must be an additive, manual-only save default`,
  );
}
for (const contract of [
  'set_marketplace_iron_target',
  'is_valid_marketplace_iron_target',
  'building.marketplace_iron_target = iron_target',
  'set_marketplace_salt_target',
  'is_valid_marketplace_salt_target',
  'building.marketplace_salt_target = salt_target',
]) {
  assert.ok(reducerSource.includes(contract), `missing authoritative reducer contract: ${contract}`);
}
for (const contract of [
  'StandingMarketplaceImport::Iron',
  'StandingMarketplaceImport::Salt',
  '"buy_iron"',
  '"buy_salt"',
  'MARKETPLACE_IRON_IMPORT_LOT',
  'MARKETPLACE_SALT_IMPORT_LOT',
  'apply_marketplace_trade',
  'start_manual_trade_cooldown',
]) {
  assert.ok(tradeSource.includes(contract), `standing material imports must retain ${contract}`);
}
assert.match(
  tradeSource,
  /TradeReceive::Resource\(leg\)[\s\S]*external_import_route[\s\S]*start_external_market_import_trip/,
  'physical bulk imports must dispatch an authoritative map-edge cart instead of crediting market stock',
);
assert.match(
  `${deliveryTripSource}\n${tradeSource}`,
  /active_routes[\s\S]*assigned_labor\.min\(5\)[\s\S]*active_routes >= route_capacity[\s\S]*All regional trader route slots are occupied/,
  'each assigned Trading Post worker must open one concurrent regional route slot, capped at five',
);
assert.match(
  tradeSource,
  /matching_local_material[\s\S]*building_has_inbound_commodity_trip[\s\S]*remaining whole-lot shortfall/,
  'standing iron and salt imports must wait for an approaching matching mine cart',
);
assert.match(
  deliveryTripSource,
  /fn is_external_market_import_trip[\s\S]*trip\.building_id == trip\.target_building_id/,
  'regional imports must remain identifiable without a new save field',
);
assert.match(
  deliveryTripSource,
  /pub fn building_has_active_trip[\s\S]*!is_regional_market_trip/,
  'an external merchant must not occupy the marketplace settlement cart',
);
assert.match(
  deliveryTripSource,
  /pub fn start_external_market_import_trip[\s\S]*labor_source: DeliveryLaborSource::External/,
  'the live merchant cart must use an external crew rather than consuming settlement labor',
);
assert.match(
  deliveryTripSource,
  /!external_market_import[\s\S]*owner_has_active_raider_threat/,
  'regional cargo must stay physically exposed instead of teleporting home on a raid warning',
);
assert.match(
  deliveryTripSource,
  /external_market_import && trip\.amount > 1e-6[\s\S]*trip\.unload_remaining = trip\.unload_seconds/,
  'paid regional cargo must wait physically at a full market instead of disappearing on return',
);
assert.match(
  tradePolicySource,
  /pub fn adriatic_trade_entry_point[\s\S]*RAID_APPROACH_WEST[\s\S]*RAID_APPROACH_SOUTH/,
  'regional imports must enter from a stable Adriatic-facing map edge',
);
assert.match(
  caravanSource,
  /marketplace_iron_target > 0[\s\S]*marketplace_salt_target > 0[\s\S]*clock\.sim_tick % 5 == building_id % 5/,
  'material targets must reuse the staggered marketplace heartbeat',
);
assert.match(generatedTable, /marketplaceIronTarget: __t\.u8\(\)/);
assert.match(generatedTable, /marketplaceSaltTarget: __t\.u8\(\)/);
assert.match(generatedIronReducer, /ironTarget: __t\.u8\(\)/);
assert.match(generatedSaltReducer, /saltTarget: __t\.u8\(\)/);
assert.match(
  inspectorSource,
  /data-marketplace-iron-target[\s\S]*onSetMarketplaceIronTarget/,
);
assert.match(
  inspectorSource,
  /data-marketplace-salt-target[\s\S]*onSetMarketplaceSaltTarget/,
);
assert.match(syncSource, /marketplaceIronTarget: row\.marketplaceIronTarget/);
assert.match(syncSource, /marketplaceSaltTarget: row\.marketplaceSaltTarget/);
assert.match(
  settlementForecastSource,
  /ironQueuedMarkets[\s\S]*saltQueuedMarkets[\s\S]*nextStandingOrder !== 'seedGrain'/,
  'the Town Hall seed-recovery forecast must reveal competition from material orders',
);
assert.match(
  panel,
  /Adriatic merchant carts buy only the remaining whole-lot shortfall[\s\S]*cargo becomes usable on arrival/,
  'the material policy must explain that physical regional trade supplements local deposits',
);
assert.match(
  panel,
  /Salt reserve/,
  'the import control must not imply that Adriatic trade replaces local salt deposits',
);

const performanceBuilding = {
  ...marketplace,
  marketplaceIronTarget: 48,
  marketplaceSaltTarget: 72,
} as BuildingState;
const performanceStarted = performance.now();
let plannedLots = 0;
let selectedOrders = 0;
for (let index = 0; index < 100_000; index += 1) {
  performanceBuilding.iron = index % 49;
  performanceBuilding.salt = index % 73;
  plannedLots += marketplaceIronProcurementPlan(performanceBuilding).ordersToTarget;
  plannedLots += marketplaceSaltProcurementPlan(performanceBuilding).ordersToTarget;
  if (nextMarketplaceStandingOrder(performanceBuilding, true) !== null) {
    selectedOrders += 1;
  }
}
const performanceElapsed = performance.now() - performanceStarted;
assert.ok(plannedLots > 0 && selectedOrders > 0);
assert.ok(
  performanceElapsed < 250,
  `100k shared material procurement forecasts regressed (${performanceElapsed.toFixed(1)} ms)`,
);

console.log(
  `marketplace material procurement tests passed (${performanceElapsed.toFixed(1)} ms for 100k shared forecasts)`,
);
