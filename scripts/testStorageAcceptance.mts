import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GRANARY_STORAGE_COMMODITIES,
  GRANARY_STORAGE_GROUPS,
  renderStorageAcceptanceControls,
  STORAGE_COMMODITY_CODES,
  STOREHOUSE_STORAGE_COMMODITIES,
  STOREHOUSE_STORAGE_GROUPS,
  storageAcceptsCommodity,
} from '../src/economy/storageAcceptancePolicy.ts';
import type { BuildingState } from '../src/resources/types.ts';

const all = (1n << 64n) - 1n;
const storehouse = {
  kind: 'village_storehouse',
  storageAcceptanceMask: all.toString(),
  storehouseAcceptsTimber: true,
  storehouseAcceptsStone: true,
  storehouseAcceptsFirewood: true,
  storehouseAcceptsCharcoal: true,
  storehouseAcceptsIron: true,
  storehouseAcceptsClay: true,
  storehouseAcceptsSalt: true,
} as BuildingState;

assert.equal(STOREHOUSE_STORAGE_COMMODITIES.length, 9);
assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes('cloth'));
assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes('pottery'));
assert.equal(GRANARY_STORAGE_COMMODITIES.length, 30);
assert.equal(storageAcceptsCommodity(storehouse, 'charcoal'), true);
assert.equal(
  storageAcceptsCommodity({
    ...storehouse,
    storageAcceptanceMask: (all & ~(1n << BigInt(STORAGE_COMMODITY_CODES.charcoal))).toString(),
  }, 'charcoal'),
  false,
);
assert.equal(
  storageAcceptsCommodity({ ...storehouse, storehouseAcceptsTimber: false }, 'timber'),
  false,
  'legacy policy must remain effective for old saves',
);
assert.equal(storageAcceptsCommodity({ ...storehouse, storageAcceptanceMask: undefined }, 'cloth'), true);

const meatOnlyGranary = {
  kind: 'granary',
  storageAcceptanceMask: (1n << BigInt(STORAGE_COMMODITY_CODES.meat)).toString(),
  granaryAcceptsFreshFood: true,
} as BuildingState;
assert.equal(storageAcceptsCommodity(meatOnlyGranary, 'meat'), true);
assert.equal(storageAcceptsCommodity(meatOnlyGranary, 'fish'), false);

const storehouseControls = renderStorageAcceptanceControls(
  storehouse,
  STOREHOUSE_STORAGE_GROUPS,
);
assert.equal((storehouseControls.match(/data-storage-commodity=/g) ?? []).length, 9);
assert.match(storehouseControls, /data-storage-commodity="cloth"/);
assert.match(storehouseControls, /data-storage-commodity="pottery"/);
assert.match(storehouseControls, /data-storage-accept-all="true"/);
assert.match(storehouseControls, /data-storage-accept-all="false"/);

const granaryControls = renderStorageAcceptanceControls(
  meatOnlyGranary,
  GRANARY_STORAGE_GROUPS,
);
assert.match(granaryControls, /Fresh provisions/);
assert.match(granaryControls, /Harvest and grain/);
assert.match(granaryControls, /data-storage-commodity="meat"[^>]*aria-pressed="true"/);
assert.match(granaryControls, /data-storage-commodity="fish"[^>]*is-blocked|class="[^"]*is-blocked[^"]*"[^>]*data-resource-cost="fish"/);

const deliveryTrips = readFileSync('server/src/simulation/delivery_trips.rs', 'utf8');
assert.match(
  deliveryTrips,
  /if !storage_accepts_commodity\(target, commodity\) \{\s*return false;/,
  'new carts must be rejected at the shared physical dispatch boundary',
);
assert.match(
  deliveryTrips,
  /if !storage_accepts_commodity\(&target, commodity\) \{\s*return;/,
  'a policy change while a cart is travelling must block unloading',
);

const tradingPostTrade = readFileSync('server/src/simulation/trading_post_trade.rs', 'utf8');
const expandedEconomy = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(tradingPostTrade, /stage_one_export[\s\S]*try_start_building_supply_trip/);
assert.match(tradingPostTrade, /settle_export[\s\S]*building_commodity_stock\(&post, commodity\)/);
assert.match(tradingPostTrade, /settle_import[\s\S]*building_commodity_room\(&post, commodity\)/);
assert.match(tradingPostTrade, /settle_import[\s\S]*deposit_building_commodity\(&mut post, commodity, units\)/);
assert.match(
  expandedEconomy,
  /has_linked_export_post[\s\S]*CommodityKind::Charcoal[\s\S]*storehouse_stock_target/,
  'a filtered Storehouse can deliberately buffer charcoal for a linked export post',
);

console.log('granular storage acceptance and physical Trading Post staging checks passed');
