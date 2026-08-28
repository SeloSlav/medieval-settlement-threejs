import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  APIARY_WAX_PER_HARVEST,
  APIARY_WAX_PER_HONEY_CYCLES,
  BACKYARD_GARDEN_DEFINITIONS,
  BUILDING_COSTS,
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  CANDLE_TRANSFER_PER_TRIP,
  CHANDLERY_CANDLES_PER_CYCLE,
  CHANDLERY_FIREWOOD_PER_CYCLE,
  CHANDLERY_WAX_PER_CYCLE,
  MARKETPLACE_TRADE_OFFERS,
  TRADE_RESOURCE_KINDS,
  TRADE_RESOURCE_SPEND_SCOPES,
} from '../src/generated/gameBalance.ts';
import {
  PROCESSOR_OUTPUT_TARGET_KINDS,
  processorInputCommodities,
  processorOutputCommodity,
} from '../src/economy/processorOutputPolicy.ts';
import {
  STORAGE_COMMODITY_CODES,
  STOREHOUSE_STORAGE_GROUPS,
} from '../src/economy/storageAcceptancePolicy.ts';
import {
  MARKET_FOOD_STALL_NEEDS,
  marketStallLabel,
  marketStallRepresentative,
  marketStallStock,
} from '../src/economy/marketStallAssignments.ts';
import { TRADE_RESOURCE_COMMODITY_CODES } from '../src/economy/tradingPostTrade.ts';
import { DELIVERY_CARGO_KINDS, cargoKindFromId } from '../src/logistics/deliveryTrips.ts';
import { RESOURCE_KINDS } from '../src/resources/types.ts';
import { activeResidenceNeedKinds } from '../src/residences/residenceNeedState.ts';
import { INDUSTRY_BUILD_MENU_ENTRIES, renderBuildMenuCards } from '../src/ui/buildMenuCards.ts';

type RawTradeOffer = {
  id: string;
  kind: 'goldBuy' | 'goldSell' | 'barter';
  resource?: string;
  amount?: number;
  goldCost?: number;
  goldYield?: number;
};
type RawBalance = {
  production: Record<string, number>;
  buildings: Record<string, {
    cost: Record<string, number>;
    storage: Record<string, number>;
    harvestInterval: number;
    maxLabor: number;
  }>;
  backyardGardens: Record<string, Record<string, number | string | boolean>>;
  marketplaceTrade: {
    resourceSpendScopes: Record<string, string>;
    offers: RawTradeOffer[];
  };
};

const balance = JSON.parse(readFileSync('balance/gameBalance.json', 'utf8')) as RawBalance;
const generatedRust = readFileSync('server/src/balance_generated.rs', 'utf8');

function rustNumericConstant(name: string): number {
  const match = generatedRust.match(
    new RegExp(`pub\\s+const\\s+${name}\\s*:[^=]+=[\\s]*([0-9]+(?:\\.[0-9]+)?)`),
  );
  assert.ok(match, `missing generated Rust constant ${name}`);
  return Number(match[1]);
}

function source(path: string): string {
  assert.ok(existsSync(path), `missing candle-economy source: ${path}`);
  return readFileSync(path, 'utf8');
}

function blockBetween(text: string, start: string, end: string): string {
  const startIndex = text.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source boundary: ${start}`);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing source boundary: ${end}`);
  return text.slice(startIndex, endIndex);
}

// balance/gameBalance.json is authoritative; both generated targets must carry
// the same cadence, recipe, cart size, workshop definition, and storage caps.
const productionContract = {
  chandleryWaxPerCycle: CHANDLERY_WAX_PER_CYCLE,
  chandleryFirewoodPerCycle: CHANDLERY_FIREWOOD_PER_CYCLE,
  chandleryCandlesPerCycle: CHANDLERY_CANDLES_PER_CYCLE,
  candleTransferPerTrip: CANDLE_TRANSFER_PER_TRIP,
  apiaryWaxPerHoneyCycles: APIARY_WAX_PER_HONEY_CYCLES,
  apiaryWaxPerHarvest: APIARY_WAX_PER_HARVEST,
};
for (const [key, generatedValue] of Object.entries(productionContract)) {
  assert.equal(generatedValue, balance.production[key], `${key} drifted from authoritative balance`);
}
assert.deepEqual(
  [CHANDLERY_WAX_PER_CYCLE, CHANDLERY_FIREWOOD_PER_CYCLE, CHANDLERY_CANDLES_PER_CYCLE],
  [2, 1, 6],
);
assert.deepEqual([APIARY_WAX_PER_HONEY_CYCLES, APIARY_WAX_PER_HARVEST], [3, 1]);
assert.equal(CANDLE_TRANSFER_PER_TRIP, 12);

for (const [rustName, jsonName] of [
  ['CHANDLERY_WAX_PER_CYCLE', 'chandleryWaxPerCycle'],
  ['CHANDLERY_FIREWOOD_PER_CYCLE', 'chandleryFirewoodPerCycle'],
  ['CHANDLERY_CANDLES_PER_CYCLE', 'chandleryCandlesPerCycle'],
  ['CANDLE_TRANSFER_PER_TRIP', 'candleTransferPerTrip'],
  ['APIARY_WAX_PER_HONEY_CYCLES', 'apiaryWaxPerHoneyCycles'],
  ['APIARY_WAX_PER_HARVEST', 'apiaryWaxPerHarvest'],
] as const) {
  assert.equal(rustNumericConstant(rustName), balance.production[jsonName]);
}

assert.deepEqual(BUILDING_COSTS.chandlery, balance.buildings.chandlery.cost);
for (const kind of ['apiary', 'chandlery', 'marketplace', 'trading_post', 'village_storehouse'] as const) {
  const generatedStorage = BUILDING_STORAGE_CAPS[kind] as unknown as Record<string, number | undefined>;
  const authoritativeStorage = balance.buildings[kind].storage;
  const commodities = new Set([...Object.keys(generatedStorage), ...Object.keys(authoritativeStorage)]);
  for (const commodity of commodities) {
    assert.equal(
      generatedStorage[commodity] ?? 0,
      authoritativeStorage[commodity] ?? 0,
      `${kind}.${commodity} storage drift`,
    );
  }
}
assert.deepEqual(BUILDING_STORAGE_CAPS.chandlery, {
  timber: 0,
  firewood: 12,
  stone: 0,
  total: 60,
  wax: 24,
  candles: 36,
});
assert.equal(BUILDING_STORAGE_CAPS.apiary.wax, 12);
assert.ok((BUILDING_STORAGE_CAPS.marketplace.candles ?? 0) > 0);
assert.ok((BUILDING_STORAGE_CAPS.trading_post.candles ?? 0) > 0);
assert.ok((BUILDING_STORAGE_CAPS.village_storehouse.candles ?? 0) > 0);
assert.equal(BUILDING_DEFINITIONS.chandlery.harvestInterval, balance.buildings.chandlery.harvestInterval);
assert.equal(BUILDING_DEFINITIONS.chandlery.maxLabor, 2);

const rawBackyardApiary = balance.backyardGardens.backyard_apiary;
const generatedBackyardApiary = BACKYARD_GARDEN_DEFINITIONS.backyard_apiary;
assert.deepEqual(
  {
    interval: generatedBackyardApiary.secondaryProductionIntervalDays,
    startMonth: generatedBackyardApiary.secondaryHarvestStartMonth,
    endMonth: generatedBackyardApiary.secondaryHarvestEndMonth,
    wax: generatedBackyardApiary.waxPerSecondaryHarvest,
    capacity: generatedBackyardApiary.waxCapacity,
  },
  {
    interval: rawBackyardApiary.secondaryProductionIntervalDays,
    startMonth: rawBackyardApiary.secondaryHarvestStartMonth,
    endMonth: rawBackyardApiary.secondaryHarvestEndMonth,
    wax: rawBackyardApiary.waxPerSecondaryHarvest,
    capacity: rawBackyardApiary.waxCapacity,
  },
);
assert.deepEqual(
  [
    generatedBackyardApiary.secondaryProductionIntervalDays,
    generatedBackyardApiary.secondaryHarvestStartMonth,
    generatedBackyardApiary.secondaryHarvestEndMonth,
    generatedBackyardApiary.waxPerSecondaryHarvest,
    generatedBackyardApiary.waxCapacity,
  ],
  [90, 3, 11, 1, 8],
);

// A full wax shelf cannot block the primary honey output. Wax accrues on its
// own progress field after a successful honey cycle and retains a due batch.
const expandedEconomy = source('server/src/simulation/expanded_economy.rs');
const apiaryStep = blockBetween(expandedEconomy, 'pub fn step_apiary', 'fn record_apiary_honey_harvest_wax');
const honeyProducerCall = apiaryStep.match(
  /step_simple_producer_at_rate\([\s\S]*?&\[\(CommodityKind::Honey,\s*APIARY_HONEY_PER_CYCLE\)\][\s\S]*?\)/,
);
assert.ok(honeyProducerCall, 'the Apiary primary producer must remain a Honey-only batch');
assert.doesNotMatch(honeyProducerCall[0], /CommodityKind::Wax/);
assert.match(
  apiaryStep,
  /apiary\.honey\s*-\s*honey_before_cycle[\s\S]*?record_apiary_honey_harvest_wax\(&mut apiary\)/,
);
const waxPlanner = blockBetween(expandedEconomy, 'fn record_apiary_honey_harvest_wax', '#[cfg(test)]\nmod apiary_wax_tests');
assert.match(waxPlanner, /apiary_wax_cycle_progress/);
assert.match(waxPlanner, /building_commodity_room\(apiary,\s*CommodityKind::Wax\)/);
assert.match(waxPlanner, /current_progress[\s\S]*?saturating_add\(1\)[\s\S]*?else\s*\{\s*current_progress/);
assert.match(waxPlanner, /can_fit\.then_some\(wax_batch\)/);
assert.match(expandedEconomy, /due_wax_progress_waits_for_whole_batch_room/);
assert.match(
  apiaryStep,
  /CommodityKind::Wax[\s\S]*?&\["chandlery"\][\s\S]*?target\.assigned_labor\s*>\s*0/,
);

const backyard = source('server/src/simulation/backyard_garden.rs');
assert.match(
  backyard,
  /BackyardGardenKind::BackyardApiary[\s\S]*?gross_food\s*>=\s*1\.0[\s\S]*?collect_backyard_apiary_wax/,
);
const backyardWax = blockBetween(backyard, 'fn collect_backyard_apiary_wax', 'fn livestock_primary_commodity');
assert.match(
  backyardWax,
  /backyard_interval_harvest_due\([\s\S]*?def\.secondary_production_interval_days[\s\S]*?def\.secondary_harvest_start_month[\s\S]*?def\.secondary_harvest_end_month/,
);
assert.match(
  backyardWax,
  /let Some\(next_wax_stock\)[\s\S]*?else\s*\{\s*return;[\s\S]*?last_secondary_production_day\s*=\s*clock\.total_days/,
);
assert.match(backyard, /transfer_backyard_wax_to_storehouse[\s\S]*?CommodityKind::Wax/);

// The staffed Chandlery consumes the exact recipe and participates in the
// ordinary processor scheduler, input staging, and output dispatch systems.
assert.ok(PROCESSOR_OUTPUT_TARGET_KINDS.includes('chandlery'));
assert.equal(processorOutputCommodity('chandlery'), 'candles');
assert.deepEqual(processorInputCommodities('chandlery'), ['wax', 'firewood']);
const chandleryStep = blockBetween(expandedEconomy, 'pub fn step_chandlery', 'pub fn step_smokehouse');
assert.match(chandleryStep, /CommodityKind::Wax,\s*CHANDLERY_WAX_PER_CYCLE/);
assert.match(chandleryStep, /CommodityKind::Firewood,\s*CHANDLERY_FIREWOOD_PER_CYCLE/);
assert.match(chandleryStep, /CommodityKind::Candles,\s*CHANDLERY_CANDLES_PER_CYCLE/);
assert.match(chandleryStep, /CommodityKind::Candles[\s\S]*?"village_storehouse"/);
assert.match(chandleryStep, /CommodityKind::Candles[\s\S]*?"trading_post"/);
const simulationReducer = source('server/src/reducers/simulation.rs');
assert.match(simulationReducer, /BuildingSimKind::Chandlery[\s\S]*?step_chandlery\(ctx,\s*&tick,\s*&clock,\s*building\)/);
const processorInputs = source('src/logistics/processorInputLogistics.ts');
assert.match(processorInputs, /wax:\s*\['chandlery'\]/);
assert.match(processorInputs, /targetKind\s*===\s*'chandlery'\s*\?\s*CHANDLERY_WAX_PER_CYCLE/);

// Codes 64 and 65 intentionally use the companion high acceptance mask.
assert.deepEqual(
  [STORAGE_COMMODITY_CODES.wax, STORAGE_COMMODITY_CODES.candles],
  [64, 65],
);
assert.deepEqual(
  [TRADE_RESOURCE_COMMODITY_CODES.wax, TRADE_RESOURCE_COMMODITY_CODES.candles],
  [64, 65],
);
assert.equal(cargoKindFromId(64), 'wax');
assert.equal(cargoKindFromId(65), 'candles');
assert.ok(DELIVERY_CARGO_KINDS.includes('wax'));
assert.ok(DELIVERY_CARGO_KINDS.includes('candles'));
assert.ok(STOREHOUSE_STORAGE_GROUPS.some((group) => group.commodities.includes('wax')));
assert.ok(STOREHOUSE_STORAGE_GROUPS.some((group) => group.commodities.includes('candles')));
const storagePolicy = source('server/src/storage_acceptance_policy.rs');
assert.match(storagePolicy, /STOREHOUSE_ACCEPTANCE_MASK_HIGH[\s\S]*?high_bit\(64\)[\s\S]*?high_bit\(65\)/);
assert.match(storagePolicy, /storage_masks_accept\(low:\s*u64,\s*high:\s*u64,\s*commodity_code:\s*u8\)/);
assert.match(storagePolicy, /set_storage_masks_commodity/);
assert.match(source('server/src/tables.rs'), /storage_acceptance_mask_high:\s*u64[\s\S]*?wax:\s*f64[\s\S]*?candles:\s*f64/);

// Candles are a Tier-4 Luxury alternative, but their physical Marketplace
// table and worker are the existing Pottery/Household wares stall.
assert.equal(activeResidenceNeedKinds(3).includes('luxury'), false);
assert.equal(activeResidenceNeedKinds(4).includes('luxury'), true);
assert.ok(MARKET_FOOD_STALL_NEEDS.includes('luxury'));
assert.equal(marketStallLabel('luxury'), 'Luxury provisions');
assert.equal(marketStallLabel('pottery'), 'Household wares');
type StallBuilding = Parameters<typeof marketStallStock>[0];
const stallBuilding = (stock: Partial<StallBuilding>): StallBuilding => stock as StallBuilding;
const noStallStock = stallBuilding({});
const splitStallStock = stallBuilding({ wine: 3, honey: 2, candles: 7, pottery: 11 });
assert.equal(marketStallStock(splitStallStock, 'luxury'), 5);
assert.equal(marketStallStock(splitStallStock, 'pottery'), 18);
assert.equal(
  marketStallRepresentative(stallBuilding({ wine: 3 }), noStallStock, 'luxury')?.commodityKind,
  'wine',
);
assert.equal(
  marketStallRepresentative(stallBuilding({ honey: 3 }), noStallStock, 'luxury')?.commodityKind,
  'honey',
);
assert.equal(
  marketStallRepresentative(stallBuilding({ candles: 7 }), noStallStock, 'luxury'),
  null,
  'candles must not appear on the food-side Luxury provisions stall',
);
assert.equal(
  marketStallRepresentative(stallBuilding({ candles: 7 }), noStallStock, 'pottery')?.commodityKind,
  'candles',
  'candles must remain visible on the goods-side Household wares stall',
);
const deliveryCargo = source('server/src/simulation/delivery_cargo.rs');
assert.match(deliveryCargo, /ResidenceNeedKind::Luxury\s*=>\s*building\.candles\s*\+\s*building\.wine\s*\+\s*building\.honey/);
const deliveryStock = blockBetween(deliveryCargo, 'pub fn building_delivery_stock', 'pub fn withdraw_delivery_cargo');
assert.match(deliveryStock, /ResidenceNeedKind::Pottery\s*=>\s*building\.pottery,/);
assert.doesNotMatch(
  deliveryStock.match(/ResidenceNeedKind::Pottery[\s\S]*?ResidenceNeedKind::Luxury/)?.[0] ?? '',
  /building\.candles/,
  'candles share a stall with pottery but must not satisfy the Pottery need',
);
assert.match(
  deliveryCargo,
  /ResidenceNeedKind::Luxury\s*=>\s*\{[\s\S]*?CommodityKind::Candles[\s\S]*?CommodityKind::Wine[\s\S]*?CommodityKind::Honey/,
  'Luxury withdrawal must spend candles before the flexible food/beverage alternatives',
);
const tickContext = source('server/src/simulation/tick_context.rs');
const serverStallPolicy = source('server/src/marketplace_stall_policy.rs');
assert.match(
  serverStallPolicy,
  /MARKET_FOOD_STALL_NEEDS[^=]*=\s*\[[\s\S]*?ResidenceNeedKind::Food[\s\S]*?ResidenceNeedKind::PreservedFood[\s\S]*?ResidenceNeedKind::Luxury[\s\S]*?\];/,
  'the authoritative food-side stall roster must include Luxury provisions',
);
assert.match(tickContext, /CommodityKind::Candles\s*=>\s*Some\(ResidenceNeedKind::Pottery\)/);
assert.match(
  tickContext,
  /fn marketplace_stall_stock[\s\S]*?need_kind\s*==\s*ResidenceNeedKind::Pottery[\s\S]*?building\.pottery\s*\+\s*building\.candles/,
  'either pottery or candles must be able to bootstrap the shared Household wares stall',
);
const serverLuxuryStallStock = tickContext.match(
  /else if need_kind\s*==\s*ResidenceNeedKind::Luxury\s*\{([\s\S]*?)\n\s*\}\s*else\s*\{/,
);
assert.ok(serverLuxuryStallStock, 'missing authoritative Luxury provisions stock branch');
assert.match(serverLuxuryStallStock[1], /building\.wine\s*\+\s*building\.honey/);
assert.doesNotMatch(
  serverLuxuryStallStock[1],
  /building\.candles/,
  'candle-only stock belongs exclusively to Household wares, not the food-side Luxury table',
);
assert.match(
  tickContext,
  /stall_need\s*==\s*ResidenceNeedKind::Luxury[\s\S]*?building\.candles[\s\S]*?ResidenceNeedKind::Pottery/,
);
const storehouseMarket = source('server/src/simulation/village_storehouse.rs');
const storehouseStalls = blockBetween(
  storehouseMarket,
  'pub fn step_storehouse_market_stalls',
  'pub fn step_village_storehouse_overflow_collection',
);
assert.match(
  storehouseStalls,
  /CommodityKind::Candles,[\s\S]*?storehouse\.candles[\s\S]*?CANDLE_TRANSFER_PER_TRIP/,
  'Storehouse keepers must deliver candles to their staffed Household wares stall',
);
const caravan = source('server/src/simulation/marketplace_caravan.rs');
assert.match(caravan, /ResidenceNeedKind::Luxury,\s*Some\(CommodityKind::Candles\)/);
const caravanEligibility = blockBetween(
  caravan,
  'pub fn step_marketplace_caravans',
  'fn try_dispatch_marketplace_proceeds',
);
assert.match(
  caravanEligibility,
  /building\.kind\s*==\s*"trading_post"[\s\S]*?building\.assigned_labor\s*>\s*0[\s\S]*?building\.candles\s*>\s*1e-6/,
  'a staffed Trading Post holding only candles must remain eligible for local-service caravan dispatch',
);

const householdDistribution = source('server/src/simulation/household_distribution.rs');
const staffedLuxuryStock = blockBetween(
  householdDistribution,
  'fn market_stock',
  'fn withdraw_staffed_market_luxury',
);
assert.match(
  staffedLuxuryStock,
  /marketplace_stall_workplace_id_for_commodity\(ctx,\s*building,\s*CommodityKind::Candles\)[\s\S]*?then_some\(building\.candles\)/,
  'routine household distribution may count candles only behind their staffed Household wares stall',
);
assert.match(
  staffedLuxuryStock,
  /marketplace_stall_workplace_id\(ctx,\s*building,\s*ResidenceNeedKind::Luxury\)[\s\S]*?then_some\(building\.wine\s*\+\s*building\.honey\)/,
  'wine and honey must remain behind the staffed Luxury stall',
);
assert.match(staffedLuxuryStock, /candle_stock\s*\+\s*food_luxury_stock/);

const staffedLuxuryWithdrawal = blockBetween(
  householdDistribution,
  'fn withdraw_staffed_market_luxury',
  '#[cfg(test)]',
);
assert.match(
  staffedLuxuryWithdrawal,
  /marketplace_stall_workplace_id_for_commodity\(ctx,\s*source,\s*CommodityKind::Candles\)[\s\S]*?withdraw_building_commodity\(source,\s*CommodityKind::Candles,\s*remaining\)/,
  'candle-first withdrawal must be authorized by the staffed Household wares stall',
);
assert.match(
  staffedLuxuryWithdrawal,
  /marketplace_stall_workplace_id\(ctx,\s*source,\s*ResidenceNeedKind::Luxury\)[\s\S]*?\[CommodityKind::Wine,\s*CommodityKind::Honey\][\s\S]*?withdraw_building_commodity\(source,\s*commodity,\s*remaining\)/,
  'wine/honey withdrawal must be authorized independently by the staffed Luxury stall',
);
assert.match(source('server/src/reducers/residences.rs'), /ResidenceNeedKind::Luxury[\s\S]*?CommodityKind::Candles/);

// Frontier raid valuation and plunder must stay in parity with physical candle cargo.
const serverSecurity = source('server/src/security_policy.rs');
assert.match(serverSecurity, /positive_store\(self\.wax\)\s*\*\s*1\.5/);
assert.match(serverSecurity, /positive_store\(self\.candles\)\s*\*\s*2\.0/);
assert.match(serverSecurity, /plunder_good!\(wax\)[\s\S]*plunder_good!\(candles\)/);

const clientSecurity = source('src/security/frontierSecurity.ts');
assert.match(clientSecurity, /positivePortableAmount\(stores\.wax\)\s*\*\s*1\.5/);
assert.match(clientSecurity, /positivePortableAmount\(stores\.candles\)\s*\*\s*2/);
assert.match(clientSecurity, /\['wax',\s*'beeswax',\s*1\.5\][\s\S]*\['candles',\s*'candles',\s*2\]/);
assert.match(clientSecurity, /wax:\s*1\.5[\s\S]*candles:\s*2/);

// Regional trade and all physical stock surfaces remain exact-commodity aware.
assert.ok(TRADE_RESOURCE_KINDS.includes('wax'));
assert.ok(TRADE_RESOURCE_KINDS.includes('candles'));
assert.equal(TRADE_RESOURCE_SPEND_SCOPES.wax, 'marketAccessible');
assert.equal(TRADE_RESOURCE_SPEND_SCOPES.candles, 'marketAccessible');
for (const id of ['buy_wax', 'sell_wax', 'buy_candles', 'sell_candles']) {
  const authoritative = balance.marketplaceTrade.offers.find((offer) => offer.id === id);
  const generated = MARKETPLACE_TRADE_OFFERS.find((offer) => offer.id === id);
  assert.ok(authoritative, `missing authoritative ${id} offer`);
  assert.deepEqual(generated, authoritative, `${id} generated offer drift`);
}
assert.ok((MARKETPLACE_TRADE_OFFERS.find((offer) => offer.id === 'buy_wax') as RawTradeOffer).goldCost! >
  (MARKETPLACE_TRADE_OFFERS.find((offer) => offer.id === 'sell_wax') as RawTradeOffer).goldYield!);
assert.ok((MARKETPLACE_TRADE_OFFERS.find((offer) => offer.id === 'buy_candles') as RawTradeOffer).goldCost! >
  (MARKETPLACE_TRADE_OFFERS.find((offer) => offer.id === 'sell_candles') as RawTradeOffer).goldYield!);

assert.ok(RESOURCE_KINDS.includes('wax'));
assert.ok(RESOURCE_KINDS.includes('candles'));
for (const path of [
  'src/generated/building_table.ts',
  'src/generated/player_resources_table.ts',
  'src/generated/backyard_garden_table.ts',
  'src/data/spacetimeTableSync/syncBuildings.ts',
  'src/data/spacetimeTableSync/syncPlayerResources.ts',
  'src/data/spacetimeTableSync/syncBackyardGardens.ts',
  'src/resources/resourceTotals.ts',
  'src/resources/ResourceInspector.ts',
  'src/ui/SettlementHud.ts',
]) {
  const text = source(path);
  assert.match(text, /wax/i, `${path} must expose wax`);
  if (!path.toLowerCase().includes('backyard')) {
    assert.match(text, /candles/i, `${path} must expose candles`);
  }
}

const industryKinds = INDUSTRY_BUILD_MENU_ENTRIES.map((entry) => entry.artKey);
assert.ok(industryKinds.includes('chandlery'));
const cards = renderBuildMenuCards();
assert.match(cards, /data-action="chandlery"/);
assert.ok(cards.includes('%22wax%22'));
assert.ok(cards.includes('%22candles%22'));
const buildingMeshes = source('src/buildings/BuildingMeshes.ts');
assert.match(buildingMeshes, /createChandleryMesh/);
assert.match(buildingMeshes, /case\s+'chandlery'\s*:\s*return\s+createChandleryMesh\(\)/);

const iconography = source('src/ui/iconography.css');
for (const [resource, asset] of [
  ['wax', 'beeswax.png'],
  ['candles', 'candles.png'],
] as const) {
  const path = `public/assets/ui/icons/materials/${asset}`;
  const png = readFileSync(path);
  assert.ok(png.byteLength > 20_000, `${resource} needs substantive painted resource artwork`);
  assert.equal(png.readUInt32BE(16), 256, `${resource} icon must be 256 pixels wide`);
  assert.equal(png.readUInt32BE(20), 256, `${resource} icon must be 256 pixels tall`);
  assert.equal(png[25], 6, `${resource} icon must preserve an RGBA transparency channel`);
  assert.match(
    iconography,
    new RegExp(`settlement-hud__stat\\[data-resource='${resource}'\\][\\s\\S]{0,180}${asset.replace('.', '\\.')}`),
    `${resource} HUD totals must use their painted resource icon`,
  );
  assert.match(
    iconography,
    new RegExp(`resource-cost__item\\[data-resource-cost='${resource}'\\][\\s\\S]{0,220}${asset.replace('.', '\\.')}`),
    `${resource} inspector and cost tokens must use their painted resource icon`,
  );
}
assert.match(
  source('src/resources/ResourceInspector.ts'),
  /chandlery:\s*'\/assets\/ui\/build-menu\/cards\/chandlery\.webp'/,
  'the Chandlery inspector must use its own building artwork',
);

const candleMeshPath = 'src/buildings/meshes/chandleryBuildingMesh.ts';
assert.ok(existsSync(candleMeshPath), 'the Chandlery needs a dedicated procedural mesh module');
const { createChandleryMesh } = await import('../src/buildings/meshes/chandleryBuildingMesh.ts');
const mesh = createChandleryMesh();
assert.match(String(mesh.userData.architecturePlan?.signature ?? ''), /chandlery/i);
assert.equal(mesh.userData.architecturePlan?.deterministic, true);
assert.ok((mesh.userData.architectureDiagnostics?.triangleCount ?? 0) > 100);
const meshNames: string[] = [];
mesh.traverse((part) => meshNames.push(part.name));
assert.ok(meshNames.some((name) => /wax/i.test(name)), 'Chandlery mesh needs a semantic wax module');
assert.ok(meshNames.some((name) => /candle|dipping/i.test(name)), 'Chandlery mesh needs visible candle craft');

console.log('Candle economy source, balance, routing, trade, schema, UI, and mesh contracts passed.');
