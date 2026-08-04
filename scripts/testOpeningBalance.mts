import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BUILDING_COSTS,
  FIRE_ACCIDENT_IGNITION_CHANCE_PER_STRUCTURE_DAY,
  FIRE_LIGHTNING_IGNITION_CHANCE_PER_RAIN_DAY,
  FIRE_SPREAD_CHANCE_PER_SECOND,
  RESIDENCE_STONE_COST,
  RESIDENCE_TIER1_CAPACITY,
  RESIDENCE_TIMBER_COST,
  STARTING_POPULATION,
  STARTING_STONE,
  STARTING_TIMBER,
} from '../src/generated/gameBalance.ts';
import { FOOD_SUPPLIER_KINDS } from '../src/logistics/roadLogistics.ts';

const starterProducers = [
  'lumber_mill',
  'woodcutters_lodge',
  'stone_quarry',
  'foragers_shed',
] as const;
const starterHomes = Math.ceil(STARTING_POPULATION / RESIDENCE_TIER1_CAPACITY);
const starterCost = starterProducers.reduce(
  (total, kind) => ({
    timber: total.timber + BUILDING_COSTS[kind].timber,
    stone: total.stone + BUILDING_COSTS[kind].stone,
  }),
  {
    timber: starterHomes * RESIDENCE_TIMBER_COST,
    stone: starterHomes * RESIDENCE_STONE_COST,
  },
);

assert.ok(
  STARTING_POPULATION >= starterProducers.length * 2 + 2,
  'the opening needs two workers per basic producer plus two free builders/haulers',
);
assert.ok(
  STARTING_TIMBER - starterCost.timber >= 40,
  'starter timber must fund all four basic producers, housing every founder, and a recovery cushion',
);
assert.ok(
  STARTING_STONE - starterCost.stone >= 40,
  'starter stone must fund all four basic producers, housing every founder, and a recovery cushion',
);

assert.deepEqual(
  FOOD_SUPPLIER_KINDS,
  ['marketplace'],
  'routine household food must come from granary-run Marketplace stalls, never directly from producers',
);

assert.ok(
  FIRE_LIGHTNING_IGNITION_CHANCE_PER_RAIN_DAY <= 0.025,
  'lightning should be an occasional event rather than routine opening pressure',
);
assert.ok(
  FIRE_ACCIDENT_IGNITION_CHANCE_PER_STRUCTURE_DAY <= 0.0005,
  'ordinary building accidents should remain rare',
);
assert.ok(
  FIRE_SPREAD_CHANCE_PER_SECOND <= 0.008,
  'one unlucky ignition should be less likely to cascade through an early hamlet',
);

const tutorial = readFileSync(
  new URL('../src/ui/TutorialOverlay.ts', import.meta.url),
  'utf8',
);
assert.match(tutorial, /Timber, Firewood, Stone, and Food/);
assert.match(tutorial, /Staff a [\s\S]*Granary[\s\S]*connect a Marketplace/);
assert.match(tutorial, /two people unassigned for building and carts/);

console.log(
  `opening balance tests passed (${STARTING_POPULATION} founders, ${STARTING_TIMBER - starterCost.timber} timber and ${STARTING_STONE - starterCost.stone} stone spare)`,
);
