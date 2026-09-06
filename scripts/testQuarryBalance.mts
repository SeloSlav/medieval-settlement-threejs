import assert from 'node:assert/strict';
import {
  BACKYARD_GARDEN_COSTS,
  BUILDING_COSTS,
  BUILDING_DEFINITIONS,
  CHAPEL_TIER2_UPGRADE_STONE,
  CHAPEL_TIER3_UPGRADE_STONE,
  CHAPEL_TIER4_UPGRADE_STONE,
  LARGE_QUARRY_MAX_YIELD,
  RESIDENCE_STONE_COST,
  RESIDENCE_TIER2_STONE_COST,
  RESIDENCE_TIER3_STONE_COST,
  SMALL_QUARRY_MAX_YIELD,
  STONE_PER_HARVEST,
} from '../src/generated/gameBalance.ts';

const QUARRY_SITE_COUNTS = { large: 1, small: 2 } as const;
const QUARRY_SITE_COUNT = QUARRY_SITE_COUNTS.large + QUARRY_SITE_COUNTS.small;
const MATURE_RESIDENCE_COUNT = 64;
const INFRASTRUCTURE_SETS = 2;
const LONG_TERM_BUDGET_MULTIPLIER = 3;
const LARGE_QUARRY_MIN_ACTIVE_MINUTES = 150;
const SMALL_QUARRY_MIN_ACTIVE_MINUTES = 60;

const stoneForEveryBuilding = Object.values(BUILDING_COSTS)
  .reduce((total, cost) => total + cost.stone, 0);
const stoneForFullyUpgradedChurch = CHAPEL_TIER2_UPGRADE_STONE
  + CHAPEL_TIER3_UPGRADE_STONE + CHAPEL_TIER4_UPGRADE_STONE;
const stoneForTierThreeResidence = RESIDENCE_STONE_COST
  + RESIDENCE_TIER2_STONE_COST
  + RESIDENCE_TIER3_STONE_COST;
const mostExpensiveBackyardStoneCost = Math.max(
  ...Object.values(BACKYARD_GARDEN_COSTS)
    .map((cost) => cost.stone),
);

// A mature build-out includes duplicates of every industry/service and fully
// upgraded church, one camp per deposit, 64 fully upgraded homes, and the most
// stone-intensive backyard on every plot. Deposits retain three such build-outs
// so demolition, redesign, trade, and continued expansion do not turn stone into
// an early-game countdown.
const matureSettlementStoneBudget = (stoneForEveryBuilding + stoneForFullyUpgradedChurch)
  * INFRASTRUCTURE_SETS
  + stoneForTierThreeResidence * MATURE_RESIDENCE_COUNT
  + mostExpensiveBackyardStoneCost * MATURE_RESIDENCE_COUNT
  + BUILDING_COSTS.stone_quarry.stone
    * Math.max(0, QUARRY_SITE_COUNT - INFRASTRUCTURE_SETS);
const worldStoneReserve = LARGE_QUARRY_MAX_YIELD * QUARRY_SITE_COUNTS.large
  + SMALL_QUARRY_MAX_YIELD * QUARRY_SITE_COUNTS.small;

assert.ok(
  worldStoneReserve >= matureSettlementStoneBudget * LONG_TERM_BUDGET_MULTIPLIER,
  `World quarries provide ${worldStoneReserve} stone, below the long-term target of `
    + `${matureSettlementStoneBudget * LONG_TERM_BUDGET_MULTIPLIER}.`,
);

const stonecutter = BUILDING_DEFINITIONS.stone_quarry;
const fullCrewStonePerSecond = STONE_PER_HARVEST
  * stonecutter.maxLabor
  / stonecutter.harvestInterval;
const activeMinutes = (yieldAmount: number) => yieldAmount / fullCrewStonePerSecond / 60;

assert.ok(
  activeMinutes(LARGE_QUARRY_MAX_YIELD) >= LARGE_QUARRY_MIN_ACTIVE_MINUTES,
  'A large quarry should last at least 150 active minutes with a full crew.',
);
assert.ok(
  activeMinutes(SMALL_QUARRY_MAX_YIELD) >= SMALL_QUARRY_MIN_ACTIVE_MINUTES,
  'A small quarry should last at least 60 active minutes with a full crew.',
);

console.log(
  `quarry balance tests passed: ${worldStoneReserve} world stone, `
    + `${matureSettlementStoneBudget} per mature build-out, `
    + `${activeMinutes(LARGE_QUARRY_MAX_YIELD).toFixed(1)} / `
    + `${activeMinutes(SMALL_QUARRY_MAX_YIELD).toFixed(1)} active minutes`,
);
