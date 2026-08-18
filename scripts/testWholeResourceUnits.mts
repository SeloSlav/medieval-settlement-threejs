import assert from 'node:assert/strict';

import { syncBuildings } from '../src/data/spacetimeTableSync/syncBuildings.ts';
import { syncDeliveryTrips } from '../src/data/spacetimeTableSync/syncDeliveryTrips.ts';
import { syncForagingNodes } from '../src/data/spacetimeTableSync/syncForagingNodes.ts';
import { syncPlayerResources } from '../src/data/spacetimeTableSync/syncPlayerResources.ts';
import { syncResidences } from '../src/data/spacetimeTableSync/syncResidences.ts';
import {
  formatResourceUnits,
  isWholeResourceUnits,
  wholeResourceUnits,
} from '../src/resources/resourceUnits.ts';

const identityHex = 'whole-unit-test-owner';
const owner = { toHexString: () => identityHex };

assert.equal(wholeResourceUnits(-4.2), 0);
assert.equal(wholeResourceUnits(Number.NaN), 0);
assert.equal(wholeResourceUnits(0.99), 0);
assert.equal(wholeResourceUnits(7.75), 7);
assert.equal(wholeResourceUnits(8.0000001), 8);
assert.equal(formatResourceUnits(12.9), '12');
assert.equal(isWholeResourceUnits(12), true);
assert.equal(isWholeResourceUnits(12.5), false);

function rowWithDefaults<T extends object>(values: T): T {
  return new Proxy(values, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
      return 0;
    },
  });
}

const buildingRow = rowWithDefaults({
  id: 1n,
  owner,
  kind: 'granary',
  guardhouseMusterWatchtowerId: 0n,
  linkedWorksiteId: 0n,
  timber: 9.9,
  water: 18.4,
  gold: 6.75,
  ryeGrain: 11.5,
  oatFlour: 4.99,
  food: 3.25,
  constructionReservedTimber: 2.8,
  civicReceiptsGold: 1.9,
});
const building = syncBuildings([buildingRow as never], identityHex).get('building-1');
assert.ok(building);
for (const amount of [
  building.timber,
  building.water,
  building.gold,
  building.ryeGrain,
  building.oatFlour,
  building.food,
  building.constructionReservedTimber,
  building.civicReceiptsGold,
]) {
  assert.equal(isWholeResourceUnits(amount), true);
}
assert.equal(building.timber, 9);
assert.equal(building.ryeGrain, 11);
assert.equal(building.oatFlour, 4);

const tripRow = rowWithDefaults({
  id: 2n,
  owner,
  buildingId: 1n,
  laborBuildingId: 0n,
  residenceId: 0n,
  destinationKind: 0,
  targetBuildingId: 1n,
  cargoKind: 3,
  amount: 6.8,
  phase: 0,
});
const trip = syncDeliveryTrips([tripRow as never], identityHex).get('trip-2');
assert.ok(trip);
assert.equal(trip.amount, 6);
assert.equal(isWholeResourceUnits(trip.amount), true);

const forage = syncForagingNodes([rowWithDefaults({
  nodeId: 'berries-1',
  nodeKind: 'berries',
  remaining: 27.95,
  maxYield: 64.8,
}) as never]).get('berries-1');
assert.ok(forage);
assert.equal(forage.remaining, 27);
assert.equal(forage.maxYield, 64);

const playerState = { identityHex } as never;
syncPlayerResources([rowWithDefaults({
  owner,
  timber: 40.9,
  water: 17.25,
  gold: 19.99,
  ryeSheaves: 8.75,
  preservedFood: 5.5,
  landLevyCollectedTotal: 31.8,
  parishCharityPaidTotal: 4.9,
  monasteryFoodCharityTotal: 12.1,
  lastTheftGold: 2.75,
}) as never], playerState);
for (const amount of Object.values((playerState as { stockpile: Record<string, number> }).stockpile)) {
  assert.equal(isWholeResourceUnits(amount), true);
}
assert.equal((playerState as { stockpile: { timber: number } }).stockpile.timber, 40);
assert.equal((playerState as { stockpile: { gold: number } }).stockpile.gold, 19);
assert.equal((playerState as { fiscalPolicy: { landLevyCollectedTotal: number } })
  .fiscalPolicy.landLevyCollectedTotal, 31);
assert.equal((playerState as { parishPolicy: { charityPaidTotal: number } })
  .parishPolicy.charityPaidTotal, 4);

const residence = syncResidences(
  [rowWithDefaults({
    id: 3n,
    owner,
    zoneId: 4n,
    food: 6.9,
    preservedFood: 3.8,
    householdWealth: 14.5,
    remedyStock: 2.2,
    upgradeDeliveredTimber: 11.75,
  }) as never],
  [rowWithDefaults({
    residenceId: 3n,
    needKind: 2,
    stock: 9.6,
  }) as never],
  identityHex,
).get('residence-3');
assert.ok(residence);
assert.equal(residence.food, 6);
assert.equal(residence.preservedFood, 3);
assert.equal(residence.householdWealth, 14);
assert.equal(residence.remedyStock, 2);
assert.equal(residence.upgradeDeliveredTimber, 11);
assert.equal(residence.needs.food.stock, 9);

console.log('Whole resource unit tests passed.');
