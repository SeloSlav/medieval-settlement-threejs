import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const policy = read('server/src/supply_policy.rs');
assert.match(policy, /pub fn select_need_delivery_candidate/);
assert.match(policy, /pub fn select_supply_route_candidate/);
assert.match(
  policy,
  /\.into_iter\(\)\s*\.min_by\(compare_need_delivery_candidate_records\)/,
  'the authoritative target policy should select one candidate in a single pass',
);
assert.match(policy, /b\.explicit_priority[\s\S]{0,80}\.cmp\(&a\.explicit_priority\)/);
assert.match(policy, /a\.abandoned\.cmp\(&b\.abandoned\)/);
assert.match(
  policy,
  /select_supply_route_candidate<T>[\s\S]{0,500}\.min_by/,
  'single-cart building supply should have an allocation-free one-pass selector',
);

const roadLogistics = read('server/src/simulation/road_logistics.rs');
assert.match(roadLogistics, /pub fn select_residence_for_need_delivery/);
assert.match(roadLogistics, /select_need_delivery_candidate\(/);
assert.match(roadLogistics, /explicit_priority_residence_id == Some\(residence\.id\)/);
assert.match(
  roadLogistics,
  /explicit_priority_residence_id[\s\S]{0,100}\.is_some_and\(\|priority_id\| residence\.id != priority_id\)/,
  'a named paid order must not fall back to a different reachable home',
);
assert.doesNotMatch(
  roadLogistics,
  /pub fn sort_residences_for_(?:delivery|water_delivery|food_delivery)/,
  'routine server dispatch must not sort a whole claimed branch to start one cart',
);

for (const path of [
  'server/src/simulation/well.rs',
] as const) {
  const source = read(path);
  assert.match(source, /select_residence_for_need_delivery\(/, `${path} must use one-pass selection`);
  assert.match(source, /has_delivery_stock_room\(/, `${path} must discard already-full homes`);
  assert.doesNotMatch(source, /sort_residences_for_/, `${path} must not restore full-branch sorting`);
}

const marketplace = read('server/src/simulation/marketplace_caravan.rs');
assert.match(
  marketplace,
  /select_residence_for_need_delivery\([\s\S]{0,220}dispatch\.priority_residence_id/,
  'paid household and parish relief carts must pass their intended home into selection',
);
assert.doesNotMatch(
  marketplace,
  /targets\.(?:sort|sort_by|remove|insert)/,
  'emergency priority must not be reordered after it is applied',
);
assert.match(
  marketplace,
  /exact_load_amount[\s\S]{0,500}delivery_stock_room/,
  'a targeted household lot must fit in the named home in full',
);
assert.match(
  marketplace,
  /amount \/ delivery_workers\.max\(1\) as f64/,
  'worker-scaled cart machinery must still load the exact purchased lot',
);

const marketplaceOrders = read('server/src/economy/marketplace_orders.rs');
assert.match(marketplaceOrders, /market_order_should_commit/);
assert.match(
  marketplaceOrders,
  /if !market_order_should_commit\([\s\S]{0,220}refund_market_gold/,
  'a targeted order that cannot depart must restore its stock and payment',
);
assert.match(
  marketplaceOrders,
  /validate_order_marketplace\(ctx, tick, &building, owner\)\?;[\s\S]*order_physical_market_import/,
  'marketplace validation must happen before any payer is debited',
);
assert.ok(
  marketplaceOrders.indexOf('regional_market_import_route_to_residence')
    < marketplaceOrders.indexOf('pay_market_gold(ctx, owner, gold_cost'),
  'the exact map-edge, marketplace, and household route must validate before payment',
);
assert.match(
  marketplaceOrders,
  /order_physical_market_import[\s\S]*start_external_market_import_trip_to_residence/,
  'named household and parish orders must use one physical regional merchant agent',
);
assert.match(
  marketplaceOrders,
  /delivery_stock_room\(need_kind, current_stock\)[\s\S]*named household needs room/,
  'a paid physical household load must fit before the merchant departs',
);

const deliveryTrips = read('server/src/simulation/delivery_trips.rs');
assert.match(
  deliveryTrips,
  /ExternalResidence[\s\S]*market_id[\s\S]*DELIVERY_DESTINATION_RESIDENCE, id, market_id/,
  'the existing destination row must retain the contracting market without a new save column',
);
assert.match(
  deliveryTrips,
  /regional_market_import_route_to_residence[\s\S]*regional_market_import_route[\s\S]*road_path_route/,
  'named imports must enter through their marketplace branch before continuing to the home',
);
const deliverySync = read('src/data/spacetimeTableSync/syncDeliveryTrips.ts');
assert.match(
  deliverySync,
  /targetBuildingId: row\.targetBuildingId > 0n/,
  'the client must retain the market marker on a regional household trip',
);

for (const path of [
  'server/src/simulation/household_market_orders.rs',
  'server/src/simulation/chapel_parish.rs',
] as const) {
  const source = read(path);
  assert.match(source, /exact_load_amount: Some\(commodity\.(?:food|water)_amount\)/);
  assert.doesNotMatch(
    source,
    /\.is_ok\(\)/,
    `${path} must not treat a deferred Ok(false) order as paid or on cooldown`,
  );
}

const deliveryCargo = read('server/src/simulation/delivery_cargo.rs');
assert.doesNotMatch(
  deliveryCargo,
  /any_target_needs_delivery/,
  'selection should not perform a second whole-branch need scan',
);

const expandedEconomy = read('server/src/simulation/expanded_economy.rs');
assert.ok(
  (expandedEconomy.match(/select_supply_route_candidate\(/g) ?? []).length >= 1,
  'processor input pull routes should choose one source in one pass',
);
assert.match(
  expandedEconomy,
  /dispatch_polearms_to_guardhouse[\s\S]*?select_guardhouse_armament_candidate\(/,
  'polearm push routes should use the one-pass company-priority selector',
);
const frontierEconomyPolicy = read('server/src/frontier_economy_policy.rs');
assert.match(
  frontierEconomyPolicy,
  /select_guardhouse_armament_candidate<T>[\s\S]{0,700}\.min_by/,
  'company-priority armament dispatch must remain a one-pass minimum selection',
);
assert.doesNotMatch(expandedEconomy, /(?:targets|sources)\.sort_by/);
assert.ok(
  (expandedEconomy.match(/tick\s*\.building_ids_for_kinds\(/g) ?? []).length >= 7,
  'grain, guard, processor, and market routes should share the tick-local role index',
);
assert.doesNotMatch(
  expandedEconomy,
  /ctx\.db\s*\.building\(\)\s*\.owner\(\)/,
  'expanded-economy routes must not rescan every owner building for each cart decision',
);

const tickContext = read('server/src/simulation/tick_context.rs');
assert.match(
  tickContext,
  /building_index:\s*RefCell<Option<HashMap<Identity,\s*OwnerBuildingIndex>>>/,
  'the role index should stay lazy so delivery-only heartbeats do not pay for it',
);
assert.match(tickContext, /pub fn building_ids_for_kinds/);
assert.match(tickContext, /pub fn owner_building_ids/);
assert.match(tickContext, /pub fn construction_source_ids/);
assert.equal(
  (tickContext.match(/for building in ctx\.db\.building\(\)\.iter\(\)/g) ?? []).length,
  1,
  'all role lookups in one simulation substep should share one building-table scan',
);
assert.match(
  tickContext,
  /filter_map\(\|building_id\| ctx\.db\.building\(\)\.id\(\)\.find\(&building_id\)\)/,
  'indexed ids must still resolve fresh authoritative rows after earlier substep mutations',
);
assert.match(
  tickContext,
  /fn build_firewood_claims[\s\S]*?building_ids_for_kinds\(ctx, owner, &\["marketplace"\]\)[\s\S]*?ResidenceNeedKind::Firewood/,
  'household fuel claims must route through staffed Marketplace stalls only',
);
assert.match(tickContext, /building_ids_for_kinds\(ctx, owner, &\["well"\]\)/);
assert.match(
  deliveryTrips,
  /building_ids_for_kinds\(ctx,\s*owner,\s*&\["carpenter"\]\)/,
  'each cart launch should inspect only indexed carpenter candidates for its speed bonus',
);

const woodcuttersLodge = read('server/src/simulation/woodcutters_lodge.rs');
assert.match(woodcuttersLodge, /select_supply_route_candidate\(/);
assert.match(
  woodcuttersLodge,
  /local_delivery_distance/,
  'mill selection should use the shared road-first, off-road-fallback delivery cost',
);
assert.doesNotMatch(
  woodcuttersLodge,
  /road_path_route/,
  'mill selection should not build a route polyline merely to compare distance',
);
assert.doesNotMatch(roadLogistics, /sort_mills_by_road_path/);

const storehouse = read('server/src/simulation/village_storehouse.rs');
assert.match(storehouse, /\.min_by\(\|\(index_a, distance_a\), \(index_b, distance_b\)\|/);
assert.doesNotMatch(storehouse, /candidates\.sort_by/);

const fires = read('server/src/simulation/fires.rs');
assert.match(fires, /\.min_by\(\|\(a, distance_a\), \(b, distance_b\)\|/);
assert.doesNotMatch(fires, /candidates\.sort_by/);

const marketplaceInspector = read('src/resources/inspector/marketplaceInspector.ts');
assert.match(
  marketplaceInspector,
  /wait without charging/,
  'players should be told that blocked household orders remain unpaid',
);

console.log('one-pass household/building selection and transactional emergency-order tests passed');
