import assert from 'node:assert/strict';
import { BACKYARD_GARDEN_KINDS } from '../src/generated/gameBalance.ts';
import {
  canAffordBackyardGarden,
  describeBackyardGardenShortfall,
  getBackyardGardenCost,
} from '../src/resources/buildingEconomy.ts';

const totals = { timber: 9, stone: 3 };

assert.equal(canAffordBackyardGarden(totals, 'cherry_orchard'), true);
assert.equal(canAffordBackyardGarden(totals, 'apple_orchard'), false);
assert.equal(canAffordBackyardGarden(totals, 'vegetable_garden'), true);

const appleShortfall = describeBackyardGardenShortfall(totals, 'apple_orchard');
assert.ok(appleShortfall?.includes('Apple orchard'));
assert.ok(appleShortfall?.includes('10 timber'));

for (const kind of BACKYARD_GARDEN_KINDS) {
  const cost = getBackyardGardenCost(kind);
  assert.ok(cost.timber > 0 || cost.stone > 0, `${kind} should have a non-zero cost`);
}

console.log('Backyard garden placement checks passed.');
