import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BUILDING_COSTS,
  BUILDING_STORAGE_CAPS,
  COBBLER_LEATHER_PER_CYCLE,
  COBBLER_SHOES_PER_CYCLE,
  GAME_HIDES_PER_ANIMAL,
  LEATHER_TRANSFER_PER_TRIP,
  RESIDENCE_SHOES_CAPACITY,
  RESIDENCE_SHOES_PER_PERSON_PER_SEC,
  TANNERY_FIREWOOD_PER_CYCLE,
  TANNERY_HIDES_PER_CYCLE,
  TANNERY_LEATHER_PER_CYCLE,
  TANNERY_WATER_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import {
  PROCESSOR_OUTPUT_TARGET_KINDS,
  processorInputCommodities,
  processorOutputCommodity,
} from '../src/economy/processorOutputPolicy.ts';
import { activeResidenceNeedKinds } from '../src/residences/residenceNeedState.ts';
import { DELIVERY_CARGO_KINDS, cargoKindFromId } from '../src/logistics/deliveryTrips.ts';
import { TRADE_RESOURCE_COMMODITY_CODES } from '../src/economy/tradingPostTrade.ts';
import { INDUSTRY_BUILD_MENU_ENTRIES, renderBuildMenuCards } from '../src/ui/buildMenuCards.ts';
import { createCobblerMesh, createTanneryMesh } from '../src/buildings/meshes/leatherChainBuildingMeshes.ts';

assert.equal(GAME_HIDES_PER_ANIMAL, 1);
assert.deepEqual(
  [TANNERY_HIDES_PER_CYCLE, TANNERY_WATER_PER_CYCLE, TANNERY_FIREWOOD_PER_CYCLE, TANNERY_LEATHER_PER_CYCLE],
  [3, 2, 1, 2],
);
assert.deepEqual([COBBLER_LEATHER_PER_CYCLE, COBBLER_SHOES_PER_CYCLE], [2, 2]);
assert.equal(LEATHER_TRANSFER_PER_TRIP, 12);
assert.equal(RESIDENCE_SHOES_CAPACITY, 6);
assert.ok(RESIDENCE_SHOES_PER_PERSON_PER_SEC > 0);

assert.deepEqual(BUILDING_COSTS.tannery, { timber: 40, stone: 18, ironwork: 2 });
assert.deepEqual(BUILDING_COSTS.cobbler, { timber: 34, stone: 16, ironwork: 1 });
assert.deepEqual(BUILDING_STORAGE_CAPS.tannery, {
  timber: 0, firewood: 24, stone: 0, water: 36, hides: 90, leather: 90,
});
assert.deepEqual(BUILDING_STORAGE_CAPS.cobbler, {
  timber: 0, firewood: 0, stone: 0, leather: 72, shoes: 96,
});

assert.ok(PROCESSOR_OUTPUT_TARGET_KINDS.includes('tannery'));
assert.ok(PROCESSOR_OUTPUT_TARGET_KINDS.includes('cobbler'));
assert.equal(processorOutputCommodity('tannery'), 'leather');
assert.equal(processorOutputCommodity('cobbler'), 'shoes');
assert.deepEqual(processorInputCommodities('tannery'), ['hides', 'water', 'firewood']);
assert.deepEqual(processorInputCommodities('cobbler'), ['leather']);

assert.equal(activeResidenceNeedKinds(2).includes('shoes'), false);
assert.equal(activeResidenceNeedKinds(3).includes('shoes'), true);
assert.equal(activeResidenceNeedKinds(4).includes('shoes'), true);
assert.deepEqual(
  [TRADE_RESOURCE_COMMODITY_CODES.hides, TRADE_RESOURCE_COMMODITY_CODES.leather, TRADE_RESOURCE_COMMODITY_CODES.shoes],
  [58, 59, 60],
);
assert.ok(DELIVERY_CARGO_KINDS.includes('hides'));
assert.equal(cargoKindFromId(58), 'hides');
assert.equal(cargoKindFromId(59), 'leather');
assert.equal(cargoKindFromId(60), 'shoes');

const industry = INDUSTRY_BUILD_MENU_ENTRIES.map((entry) => entry.artKey);
assert.ok(industry.includes('tannery'));
assert.ok(industry.includes('cobbler'));
const cards = renderBuildMenuCards();
assert.match(cards, /data-action="tannery"[\s\S]*?tannery\.webp/);
assert.match(cards, /data-action="cobbler"[\s\S]*?cobbler\.webp/);
assert.ok(cards.includes('%22hides%22') && cards.includes('%22leather%22'));
assert.ok(cards.includes('%22shoes%22'));
for (const file of ['tannery.webp', 'cobbler.webp']) {
  const path = `public/assets/ui/build-menu/cards/${file}`;
  assert.ok(fs.statSync(path).size > 20_000, `${file} must be a generated, production-sized card`);
}

for (const [mesh, signature, requiredNames] of [
  [createTanneryMesh(), 'gorski-tannery-v1', ['Bark-liquor tanning vat', 'HidesStock', 'LeatherStock']],
  [createCobblerMesh(), 'gorski-cobbler-v1', ['Boot-shaped cobbler sign', 'LeatherStock', 'ShoesStock']],
] as const) {
  assert.equal(mesh.userData.architecturePlan.signature, signature);
  assert.equal(mesh.userData.architecturePlan.deterministic, true);
  assert.ok(mesh.userData.architectureDiagnostics.triangleCount > 300);
  for (const name of requiredNames) assert.ok(mesh.getObjectByName(name), `${signature} missing ${name}`);
}

const foodSupplier = fs.readFileSync('server/src/simulation/food_supplier.rs', 'utf8');
assert.match(foodSupplier, /CommodityKind::Hides/);
assert.match(foodSupplier, /GAME_HIDES_PER_ANIMAL/);
const backyard = fs.readFileSync('server/src/simulation/backyard_garden.rs', 'utf8');
assert.match(backyard, /CommodityKind::Hides/);
assert.match(backyard, /hide_stock/);
const commodities = fs.readFileSync('server/src/economy/commodities.rs', 'utf8');
assert.match(commodities, /Self::Hides => 58/);
assert.match(commodities, /Self::Leather => 59/);
assert.match(commodities, /Self::Shoes => 60/);

console.log('Leather economy tests passed.');
