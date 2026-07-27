import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  apiaryIsActive,
  marketplaceSpecialtyQueue,
  specialtySeasonStatus,
  vineyardIsHarvesting,
} from '../src/economy/specialtyTrade.ts';
import { getBuildingDefinition } from '../src/resources/buildings.ts';
import { BUILDING_STORAGE_CAPS } from '../src/generated/gameBalance.ts';
import type { BuildingState } from '../src/resources/types.ts';

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
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    polearms: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 0,
    ...partial,
  };
}

assert.equal(apiaryIsActive(3), false);
assert.equal(apiaryIsActive(4), true);
assert.equal(apiaryIsActive(9), true);
assert.equal(apiaryIsActive(10), false);
assert.equal(vineyardIsHarvesting(8), false);
assert.equal(vineyardIsHarvesting(9), true);
assert.equal(vineyardIsHarvesting(10), true);
assert.equal(vineyardIsHarvesting(11), false);
assert.match(specialtySeasonStatus('apiary', 1)?.label ?? '', /resumes in April/);
assert.match(specialtySeasonStatus('vineyard', 9)?.label ?? '', /Grape harvest/);

const busyMarket = makeMarket({
  assignedLabor: 2,
  actionCooldown: 5,
  ale: 10,
  honey: 5,
  wine: 2,
  cloth: 4,
});
const busyQueue = marketplaceSpecialtyQueue(busyMarket);
assert.equal(busyQueue.units, 21);
assert.equal(busyQueue.goldValue, 24.7);
assert.equal(busyQueue.exportWorkers, 1);
assert.equal(busyQueue.unitsPerSecond, 0.45);
assert.ok(Math.abs((busyQueue.clearSeconds ?? 0) - 21 / 0.45) < 1e-9);

const readyQueue = marketplaceSpecialtyQueue({
  ...busyMarket,
  actionCooldown: 0,
});
assert.equal(readyQueue.exportWorkers, 2);
assert.equal(readyQueue.unitsPerSecond, 0.9);
assert.equal(
  marketplaceSpecialtyQueue(makeMarket({ assignedLabor: 1, actionCooldown: 2, wine: 1 }))
    .clearSeconds,
  null,
);

const apiary = getBuildingDefinition('apiary');
const vineyard = getBuildingDefinition('vineyard');
assert.equal(apiary.requiresMatureTrees, true);
assert.equal(apiary.workRadius, 48);
assert.equal(vineyard.requiresHillside, true);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.ale, 140);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.honey, 100);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.wine, 120);
assert.equal(BUILDING_STORAGE_CAPS.marketplace.cloth, 120);

const expandedEconomy = readFileSync(
  new URL('../server/src/simulation/expanded_economy.rs', import.meta.url),
  'utf8',
);
const marketplaceCaravan = readFileSync(
  new URL('../server/src/simulation/marketplace_caravan.rs', import.meta.url),
  'utf8',
);
assert.doesNotMatch(expandedEconomy, /fn export_specialty/);
assert.match(expandedEconomy, /apiary_is_active/);
assert.match(expandedEconomy, /vineyard_is_harvesting/);
assert.match(expandedEconomy, /CommodityKind::Ale,\s*&\["marketplace"\]/s);
assert.match(expandedEconomy, /CommodityKind::Honey,\s*&\["marketplace"\]/s);
assert.match(expandedEconomy, /CommodityKind::Wine,\s*&\["marketplace"\]/s);
assert.match(expandedEconomy, /CommodityKind::Cloth,\s*&\["marketplace"\]/s);
assert.match(marketplaceCaravan, /CommodityKind::Cloth/);
assert.match(marketplaceCaravan, /withdraw_building_commodity/);
assert.match(marketplaceCaravan, /specialty_export_capacity/);
assert.match(marketplaceCaravan, /credit_marketplace_receipt_gold/);
assert.doesNotMatch(marketplaceCaravan, /credit_treasury_gold/);

const start = performance.now();
let checksum = 0;
for (let index = 0; index < 100_000; index += 1) {
  checksum += marketplaceSpecialtyQueue(busyMarket).goldValue;
}
const elapsed = performance.now() - start;
assert.ok(checksum > 0);
assert.ok(elapsed < 250, `100k specialty queue projections took ${elapsed.toFixed(1)}ms`);

console.log(`specialty trade tests passed (${elapsed.toFixed(1)}ms for 100k queue projections)`);
