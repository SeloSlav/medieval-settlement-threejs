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
import {
  BUILDING_KINDS,
  BUILDING_STORAGE_CAPS,
  STARTING_BREAD,
  STARTING_FIREWOOD,
  STARTING_GOLD,
  STARTING_IRONWORK,
  STARTING_STONE,
  STARTING_TIMBER,
} from '../src/generated/gameBalance.ts';
import {
  buildingSharedStorageCapacity,
  buildingSharedStorageRoom,
  buildingStoredResourceTotal,
} from '../src/economy/sharedStorageCapacity.ts';
import type { BuildingState } from '../src/resources/types.ts';
import { withBuildingLocalStorage } from '../src/resources/inspector/buildingLocalStorageRenderer.ts';
import type { InspectorView } from '../src/resources/inspector/renderInspectableTarget.ts';

const all = (1n << 64n) - 1n;
const storehouse = {
  kind: 'village_storehouse',
  storageAcceptanceMask: all.toString(),
  storageAcceptanceMaskHigh: all.toString(),
  storehouseAcceptsTimber: true,
  storehouseAcceptsStone: true,
  storehouseAcceptsFirewood: true,
  storehouseAcceptsCharcoal: true,
  storehouseAcceptsIron: true,
  storehouseAcceptsClay: true,
  storehouseAcceptsSalt: true,
} as BuildingState;

assert.equal(STOREHOUSE_STORAGE_COMMODITIES.length, 28);
for (const militaryStore of [
  'polearms', 'sidearms', 'shields', 'bows', 'crossbows',
  'paddedArmor', 'mailArmor', 'ammunition',
] as const) {
  assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes(militaryStore));
}
assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes('cloth'));
assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes('hides'));
assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes('leather'));
assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes('shoes'));
assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes('pottery'));
assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes('remedies'));
assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes('wax'));
assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes('candles'));
assert.ok(STOREHOUSE_STORAGE_COMMODITIES.includes('pelts'));
assert.equal(GRANARY_STORAGE_COMMODITIES.length, 39);
assert.equal(GRANARY_STORAGE_COMMODITIES.includes('food'), false);
assert.equal(GRANARY_STORAGE_COMMODITIES.includes('vegetables'), false);
assert.equal((GRANARY_STORAGE_COMMODITIES as readonly string[]).includes('preservedFood'), false);
assert.ok(GRANARY_STORAGE_COMMODITIES.includes('mead'));
assert.equal(
  'animalFeed' in STORAGE_COMMODITY_CODES,
  false,
  'Animal Feed must not become a configurable Storehouse or Granary commodity',
);
assert.equal((STOREHOUSE_STORAGE_COMMODITIES as readonly string[]).includes('animalFeed'), false);
assert.equal((GRANARY_STORAGE_COMMODITIES as readonly string[]).includes('animalFeed'), false);
assert.equal(BUILDING_STORAGE_CAPS.pastoral_farmstead.animalFeed, 100);
assert.equal(BUILDING_STORAGE_CAPS.swineherd.animalFeed, 80);
assert.equal(BUILDING_STORAGE_CAPS.granary.animalFeed ?? 0, 0);
assert.equal(BUILDING_STORAGE_CAPS.village_storehouse.animalFeed ?? 0, 0);
for (const commodity of [
  'pears', 'aronia', 'rosehips', 'cabbage', 'carrots', 'beetroot',
  'aroniaJam', 'rosehipJam', 'cider', 'pearCider', 'mead', 'wine',
] as const) {
  assert.ok(GRANARY_STORAGE_COMMODITIES.includes(commodity));
}
assert.equal(BUILDING_STORAGE_CAPS.granary.total, 2500);
assert.equal(BUILDING_STORAGE_CAPS.village_storehouse.total, 2500);
assert.equal(BUILDING_STORAGE_CAPS.granary.mead, 2500);
assert.equal(BUILDING_STORAGE_CAPS.granary.cider, 2500);
assert.equal(BUILDING_STORAGE_CAPS.granary.pearCider, 2500);
assert.equal(BUILDING_STORAGE_CAPS.trading_post.cider, 180);
assert.equal(BUILDING_STORAGE_CAPS.trading_post.pearCider, 180);
assert.equal(BUILDING_STORAGE_CAPS.tavern.cider, 60);
assert.equal(BUILDING_STORAGE_CAPS.tavern.pearCider, 60);
assert.equal(buildingSharedStorageCapacity('granary'), 2500);
assert.equal(buildingSharedStorageCapacity('village_storehouse'), 2500);
assert.equal(buildingSharedStorageCapacity('marketplace'), 400);
assert.equal(buildingSharedStorageCapacity('lumber_mill'), 50);

const centralDepots = new Set(['granary', 'village_storehouse']);
for (const kind of BUILDING_KINDS) {
  const caps = BUILDING_STORAGE_CAPS[kind];
  const hasLocalGoods = Object.entries(caps).some(
    ([commodity, capacity]) => commodity !== 'total' && capacity > 0,
  );
  if (!hasLocalGoods) {
    assert.equal(caps.total ?? 0, 0, `${kind} has no local goods and needs no capacity`);
    continue;
  }
  assert.ok((caps.total ?? 0) > 0, `${kind} must define one combined local capacity`);
  if (centralDepots.has(kind)) {
    assert.equal(caps.total, 2500, `${kind} is a full-sized central depot`);
  } else {
    assert.ok((caps.total ?? 0) < 2500, `${kind} must never compete with a central depot`);
  }
}

const productionCapacity = {
  lumber_mill: 50,
  woodcutters_lodge: 50,
  stone_quarry: 120,
  large_quarry: 100,
  mine: 150,
  charcoal_burner: 50,
  smithy: 75,
  potter_kiln: 100,
  hunters_hall: 75,
  foragers_shed: 60,
  fishing_camp: 60,
  threshing_barn: 200,
  pastoral_farmstead: 250,
  swineherd: 180,
  brewery: 150,
  smokehouse: 100,
  bakery: 80,
  apiary: 60,
  watermill: 100,
  windmill: 90,
  carpenter: 80,
  spinning_retting_house: 120,
  weaver: 80,
  tannery: 80,
  cobbler: 60,
  chandlery: 60,
} as const;
for (const [kind, capacity] of Object.entries(productionCapacity)) {
  assert.equal(
    BUILDING_STORAGE_CAPS[kind as keyof typeof BUILDING_STORAGE_CAPS].total,
    capacity,
    `${kind} must keep its authored working buffer`,
  );
  assert.ok(capacity >= 50 && capacity <= 250);
}
assert.equal(BUILDING_STORAGE_CAPS.founders_camp.total, 1600);
const normalStartingGoods = {
  timber: STARTING_TIMBER,
  stone: STARTING_STONE,
  firewood: STARTING_FIREWOOD,
  ryeBread: STARTING_BREAD,
  ironwork: STARTING_IRONWORK,
};
const normalStartingGoodsTotal = Object.values(normalStartingGoods)
  .reduce((total, amount) => total + amount, 0);
for (const multiplier of [1, 2] as const) {
  const startingCamp = {
    kind: 'founders_camp',
    timber: normalStartingGoods.timber * multiplier,
    stone: normalStartingGoods.stone * multiplier,
    firewood: normalStartingGoods.firewood * multiplier,
    ryeBread: normalStartingGoods.ryeBread * multiplier,
    ironwork: normalStartingGoods.ironwork * multiplier,
    gold: STARTING_GOLD * multiplier,
  } as BuildingState;
  const storedTotal = buildingStoredResourceTotal(startingCamp);
  assert.equal(
    storedTotal,
    normalStartingGoodsTotal * multiplier,
    'dedicated treasury gold must not inflate the local working-goods total',
  );
  assert.ok(
    storedTotal <= BUILDING_STORAGE_CAPS.founders_camp.total,
    `Founders Camp shared storage must hold the ${multiplier === 1 ? 'normal' : 'doubled'} starting-goods option`,
  );
  for (const [resource, storageKey] of [
    ['timber', 'timber'],
    ['stone', 'stone'],
    ['firewood', 'firewood'],
    ['ryeBread', 'food'],
    ['ironwork', 'ironwork'],
  ] as const) {
    assert.ok(
      BUILDING_STORAGE_CAPS.founders_camp[storageKey] >= startingCamp[resource],
      `Founders Camp ${resource} storage must hold its ${multiplier === 1 ? 'normal' : 'doubled'} starting allocation`,
    );
  }
}
const doubledCampStorageView = withBuildingLocalStorage({
  eyebrow: '',
  title: '',
  statusText: '',
  statusState: '',
  detailsHtml: '',
  demolish: { visible: false, hint: '' },
  labor: {
    visible: false,
    count: 0,
    hint: '',
    decreaseDisabled: true,
    increaseDisabled: true,
  },
} satisfies InspectorView, {
  kind: 'founders_camp',
  timber: STARTING_TIMBER * 2,
  stone: STARTING_STONE * 2,
  firewood: STARTING_FIREWOOD * 2,
  ryeBread: STARTING_BREAD * 2,
  ironwork: STARTING_IRONWORK * 2,
  gold: STARTING_GOLD * 2,
} as BuildingState);
assert.match(doubledCampStorageView.detailsHtml, /Founding supplies/);
assert.match(doubledCampStorageView.detailsHtml, /outbound only/);
assert.match(doubledCampStorageView.detailsHtml, /does not accept deliveries/);
assert.doesNotMatch(doubledCampStorageView.detailsHtml, /1600|capacity|Local storage/);
assert.equal(BUILDING_STORAGE_CAPS.salvage_pile.total, 500);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.total, 400);
assert.equal(BUILDING_STORAGE_CAPS.trading_post.total, 760);
const nearlyFullStorehouse = {
  ...storehouse,
  timber: 1400,
  stone: 1090,
  gold: 999,
} as BuildingState;
assert.equal(buildingStoredResourceTotal(nearlyFullStorehouse), 2490);
assert.equal(buildingSharedStorageRoom(nearlyFullStorehouse), 10);
assert.equal(buildingSharedStorageRoom({
  ...nearlyFullStorehouse,
  stone: 1100,
}), 0);
assert.equal(buildingSharedStorageRoom({
  kind: 'lumber_mill',
  timber: 35,
  water: 12,
  ironwork: 3,
} as BuildingState), 0, 'all Lumber Mill goods share its 50-unit working yard');
assert.equal(
  buildingSharedStorageRoom({ ...storehouse, timber: 0, stone: 0 } as BuildingState),
  2500,
  'every Storehouse must own its own 2,500-unit capacity',
);
assert.equal(
  buildingSharedStorageRoom({ kind: 'granary' } as BuildingState),
  2500,
  'every Granary must own its own 2,500-unit capacity',
);
assert.equal(storageAcceptsCommodity(storehouse, 'charcoal'), true);
assert.equal(storageAcceptsCommodity(storehouse, 'remedies'), true);
assert.equal(storageAcceptsCommodity(storehouse, 'wax'), true);
assert.equal(storageAcceptsCommodity(storehouse, 'candles'), true);
assert.equal(storageAcceptsCommodity(storehouse, 'pelts'), true);
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
  'the coarse per-material switch remains effective when granular acceptance is enabled',
);
assert.equal(
  storageAcceptsCommodity({
    ...storehouse,
    storageAcceptanceMaskHigh: (all & ~(1n << BigInt(STORAGE_COMMODITY_CODES.wax - 64))).toString(),
  }, 'wax'),
  false,
  'commodity ids above 63 use the companion high mask without shifting saved low bits',
);
assert.equal(storageAcceptsCommodity({ ...storehouse, storageAcceptanceMask: undefined }, 'cloth'), true);

const meatOnlyGranary = {
  kind: 'granary',
  storageAcceptanceMask: (1n << BigInt(STORAGE_COMMODITY_CODES.meat)).toString(),
  granaryAcceptsFreshFood: true,
} as BuildingState;
assert.equal(storageAcceptsCommodity(meatOnlyGranary, 'meat'), true);
assert.equal(storageAcceptsCommodity(meatOnlyGranary, 'fish'), false);
assert.equal(storageAcceptsCommodity(meatOnlyGranary, 'wine'), false);

const storehouseControls = renderStorageAcceptanceControls(
  storehouse,
  STOREHOUSE_STORAGE_GROUPS,
);
assert.equal(
  (storehouseControls.match(/data-storage-commodity=/g) ?? []).length,
  STOREHOUSE_STORAGE_COMMODITIES.length,
);
assert.match(storehouseControls, /data-storage-commodity="cloth"/);
assert.match(storehouseControls, /Clothing: accepting new deliveries\./);
assert.match(storehouseControls, /data-storage-commodity="hides"/);
assert.match(storehouseControls, /data-storage-commodity="leather"/);
assert.match(storehouseControls, /data-storage-commodity="shoes"/);
assert.match(storehouseControls, /data-storage-commodity="pottery"/);
assert.match(storehouseControls, /data-storage-commodity="remedies"/);
assert.match(storehouseControls, /data-storage-commodity="wax"/);
assert.match(storehouseControls, /data-storage-commodity="candles"/);
assert.match(storehouseControls, /data-storage-commodity="pelts"/);
assert.match(storehouseControls, /data-storage-accept-all="true"/);
assert.match(storehouseControls, /data-storage-accept-all="false"/);
assert.match(storehouseControls, />Accept all<\/button>/);
assert.match(storehouseControls, />Accept none<\/button>/);
assert.match(storehouseControls, /Timber: accepting new deliveries\./);

const granaryControls = renderStorageAcceptanceControls(
  meatOnlyGranary,
  GRANARY_STORAGE_GROUPS,
);
assert.match(granaryControls, /Fresh provisions/);
assert.match(granaryControls, /Harvest and grain/);
assert.match(granaryControls, /data-storage-commodity="meat"[^>]*aria-pressed="true"/);
assert.match(granaryControls, /data-storage-commodity="fish"[^>]*is-blocked|class="[^"]*is-blocked[^"]*"[^>]*data-resource-cost="fish"/);
assert.match(granaryControls, /data-storage-commodity="wine"/);
assert.match(granaryControls, /data-storage-commodity="mead"/);
assert.match(granaryControls, /Raspberries: new deliveries blocked\./);
assert.doesNotMatch(granaryControls, /Mixed provisions|data-storage-commodity="food"/);
assert.doesNotMatch(granaryControls, /data-storage-commodity="vegetables"/);

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
const commodities = readFileSync('server/src/economy/commodities.rs', 'utf8');
const legacyStorage = readFileSync('server/src/economy/storage.rs', 'utf8');
const lumberMill = readFileSync('server/src/simulation/lumber_mill.rs', 'utf8');
const woodcuttersLodge = readFileSync('server/src/simulation/woodcutters_lodge.rs', 'utf8');
assert.match(
  commodities,
  /building_commodity_room[\s\S]*\.min\(building_shared_storage_room\(building\)\)/,
  'every authoritative deposit must honor the shared building capacity',
);
assert.match(
  legacyStorage,
  /whole_room\(caps\.timber,[\s\S]*\.min\(building_shared_storage_room\(&next\)\)/,
  'legacy timber, firewood, and stone deposits must also honor combined capacity',
);
assert.match(lumberMill, /building_commodity_room\(&building, CommodityKind::Timber\)/);
assert.match(
  woodcuttersLodge,
  /building_commodity_room\(&building, CommodityKind::Firewood\)[\s\S]*deposit_building\(&building, caps, 0\.0, firewood_yield, 0\.0\)/,
  'Woodcutters must check shared room before depositing directly harvested firewood',
);
assert.match(tradingPostTrade, /stage_one_export[\s\S]*try_start_building_supply_trip/);
assert.match(tradingPostTrade, /settle_export[\s\S]*building_commodity_stock\(&post, commodity\)/);
assert.match(tradingPostTrade, /settle_import[\s\S]*building_commodity_room\(&post, commodity\)/);
assert.match(tradingPostTrade, /settle_import[\s\S]*deposit_building_commodity\(&mut post, commodity, units\)/);
assert.match(
  expandedEconomy,
  /has_linked_export_post[\s\S]*CommodityKind::Charcoal[\s\S]*storehouse_stock_target/,
  'a filtered Storehouse can deliberately buffer charcoal for a linked export post',
);
assert.match(
  expandedEconomy,
  /step_brewery[\s\S]*CommodityKind::Mead,[\s\S]*&\["granary"\]/,
  'mead and the other typed Brewery beverages must be able to overflow into an accepting Granary',
);
assert.match(
  expandedEconomy,
  /GranaryDispatchDuty::Households[\s\S]*CommodityKind::PearCider,[\s\S]*CommodityKind::Mead,[\s\S]*&\["tavern"\]/,
  'Granaries must route every accepted typed beverage onward to staffed Taverns',
);
assert.match(
  expandedEconomy,
  /fn dispatch_monastery_vineyard_wine[\s\S]*storage_accepts_commodity\(granary, CommodityKind::Wine\)/,
  'wine must leave its producer for a Granary only when that Granary accepts wine',
);
assert.match(
  expandedEconomy,
  /GranaryDispatchDuty::Households[\s\S]*CommodityKind::Wine,[\s\S]*&\["marketplace"\]/,
  'accepted Granary wine must remain eligible for ordinary market supply',
);

console.log('granular storage acceptance and physical Trading Post staging checks passed');
