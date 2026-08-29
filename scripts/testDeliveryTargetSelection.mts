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

const well = read('server/src/simulation/well.rs');
assert.match(
  well,
  /distribute_well_water\(ctx, tick, &mut well\)/,
  'wells should allocate household water without starting a residence cart',
);
assert.doesNotMatch(
  well,
  /dispatch_delivery_if_ready|select_residence_for_need_delivery/,
  'routine well-to-home carts must stay removed',
);
const householdDistribution = read('server/src/simulation/household_distribution.rs');
assert.match(householdDistribution, /step_market_household_distribution/);
assert.match(householdDistribution, /distribute_well_water/);
assert.match(
  householdDistribution,
  /distance[\s\S]{0,100}residence_id/,
  'scarce abstract supply should prioritize exact distance and then stable residence id',
);
assert.doesNotMatch(
  householdDistribution,
  /try_start_delivery_trip|dispatch_delivery_if_ready/,
  'abstract allocation must not reserve a household cart crew',
);

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

const deliveryTrips = read('server/src/simulation/delivery_trips.rs');
const chapelParish = read('server/src/simulation/chapel_parish.rs');
assert.match(chapelParish, /exact_load_amount: Some\(relief_amount\)/);
assert.doesNotMatch(
  chapelParish,
  /\.is_ok\(\)/,
  'parish relief must not treat a deferred Ok(false) order as dispatched',
);

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
const marketStallPolicy = read('server/src/marketplace_stall_policy.rs');
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
  householdDistribution,
  /MARKET_NEEDS[\s\S]{0,220}ResidenceNeedKind::Firewood[\s\S]*step_market_household_distribution/,
  'household fuel allocation must originate from local Marketplace inventory only',
);
assert.match(
  marketStallPolicy,
  /MARKET_GOODS_STALL_NEEDS[\s\S]*?ResidenceNeedKind::Firewood[\s\S]*?MARKET_STALL_GROUP_GOODS/,
  'household fuel stalls must be operated by staffed village storehouses',
);
assert.match(tickContext, /MARKET_STALL_GROUP_GOODS[\s\S]*?"village_storehouse"/);
assert.match(tickContext, /building_ids_for_kinds\(ctx, owner, &\["well"\]\)/);
assert.match(
  deliveryTrips,
  /building_ids_for_kinds\(ctx,\s*owner,\s*&\["carpenter"\]\)/,
  'each cart launch should inspect only indexed carpenter candidates for its speed bonus',
);

const woodcuttersLodge = read('server/src/simulation/woodcutters_lodge.rs');
assert.match(
  woodcuttersLodge,
  /find_nearest_mature_tree/,
  'woodcutters should select a mature tree instead of a timber-supply building',
);
assert.doesNotMatch(
  woodcuttersLodge,
  /select_supply_route_candidate|local_delivery_distance|road_path_route/,
  'direct tree harvesting must not perform a mill-delivery route search',
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
  /Public Trading Post procurement[\s\S]*spends civic treasury gold/,
  'players should see that monthly public imports spend civic treasury gold',
);

console.log('one-pass household/building selection and parish delivery checks passed');
