import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BUILDING_COSTS,
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  FIRE_ACCIDENT_IGNITION_CHANCE_PER_STRUCTURE_DAY,
  FIRE_LIGHTNING_IGNITION_CHANCE_PER_RAIN_DAY,
  FIRE_SPREAD_CHANCE_PER_SECOND,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_STONE_COST,
  RESIDENCE_TIER1_CAPACITY,
  RESIDENCE_TIMBER_COST,
  SIM_REALTIME_RATE,
  SPRING_FIREWOOD_DEMAND_MULTIPLIER,
  STARTING_POPULATION,
  STARTING_BREAD,
  STARTING_FIREWOOD,
  STARTING_IRONWORK,
  STARTING_STONE,
  STARTING_TIMBER,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import { householdFoodPerDay } from '../src/economy/foodInventory.ts';
import { FOOD_SUPPLIER_KINDS } from '../src/logistics/roadLogistics.ts';

const basicProducerStaffingSites = [
  'lumber_mill',
  'woodcutters_lodge',
  'stone_quarry',
  'foragers_shed',
] as const;
const recoverySafeOpeningSites = [
  'lumber_mill',
  'village_storehouse',
  'granary',
  'woodcutters_lodge',
  'marketplace',
  'well',
  'stone_quarry',
  'hunters_hall',
  'fishing_camp',
  'chapel',
] as const;
const starterHomes = Math.ceil(STARTING_POPULATION / RESIDENCE_TIER1_CAPACITY);
const starterCost = recoverySafeOpeningSites.reduce(
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
  STARTING_POPULATION >= basicProducerStaffingSites.length * 2 + 2,
  'the opening needs two workers per basic producer plus two free builders/haulers',
);
assert.ok(
  STARTING_TIMBER - starterCost.timber >= 40,
  'starter timber must fund logistics, utilities, church access, housing, quarrying, two food camps, and a recovery cushion',
);
assert.ok(
  STARTING_STONE - starterCost.stone >= 40,
  'starter stone must fund logistics, utilities, church access, housing, quarrying, two food camps, and a recovery cushion',
);

const earlyToolSites = ['lumber_mill', 'woodcutters_lodge', 'stone_quarry'] as const;
const workSecondsPerDay = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;
const fiveYearEarlyToolWear = earlyToolSites.reduce(
  (total, kind) => total
    + workSecondsPerDay / BUILDING_DEFINITIONS[kind].harvestInterval
      * CIVILIAN_TOOL_IRONWORK_PER_CYCLE * 360 * 5,
  0,
);
assert.ok(
  STARTING_IRONWORK >= fiveYearEarlyToolWear,
  'starter ironwork must cover roughly five years of the three opening heavy-tool sites',
);
const twoRealTimeHoursInGameDays = 2 * 60 * 60
  * SIM_REALTIME_RATE
  / CALENDAR_SECONDS_PER_DAY;
assert.ok(
  STARTING_BREAD / householdFoodPerDay(STARTING_POPULATION) >= twoRealTimeHoursInGameDays,
  'starter bread must cover at least two real-time hours while food production and market hauling come online',
);
const worstSeasonStarterFirewoodPerDay = STARTING_POPULATION
  * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
  * CALENDAR_SECONDS_PER_DAY
  * WINTER_FIREWOOD_DEMAND_MULTIPLIER;
assert.ok(
  STARTING_FIREWOOD / worstSeasonStarterFirewoodPerDay >= 30,
  'starter firewood must cover at least 30 winter household-days while fuel production and market hauling come online',
);
const openingSeasonStarterFirewoodPerDay = STARTING_POPULATION
  * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
  * CALENDAR_SECONDS_PER_DAY
  * SPRING_FIREWOOD_DEMAND_MULTIPLIER;
assert.ok(
  STARTING_FIREWOOD / openingSeasonStarterFirewoodPerDay >= twoRealTimeHoursInGameDays,
  'starter firewood must cover at least two real-time hours in the opening season while fuel production and market hauling come online',
);
assert.ok(BUILDING_STORAGE_CAPS.founders_camp.ironwork >= STARTING_IRONWORK);
assert.ok(BUILDING_STORAGE_CAPS.founders_camp.timber >= STARTING_TIMBER);
assert.ok(BUILDING_STORAGE_CAPS.founders_camp.stone >= STARTING_STONE);
assert.ok(BUILDING_STORAGE_CAPS.founders_camp.food >= STARTING_BREAD);
assert.ok(BUILDING_STORAGE_CAPS.founders_camp.firewood >= STARTING_FIREWOOD);

const lifecycle = readFileSync(
  new URL('../server/src/lifecycle.rs', import.meta.url),
  'utf8',
);
assert.match(lifecycle, /firewood: STARTING_FIREWOOD/);
assert.match(lifecycle, /ironwork: STARTING_IRONWORK/);
assert.match(lifecycle, /bread: STARTING_BREAD/);

const foundingSite = readFileSync(
  new URL('../server/src/simulation/founding_site.rs', import.meta.url),
  'utf8',
);
assert.match(
  foundingSite,
  /starter_supplies_only[\s\S]*CommodityKind::Firewood[\s\S]*CommodityKind::RyeBread[\s\S]*CommodityKind::MaslinBread[\s\S]*CommodityKind::Ironwork/,
  'starter bread, firewood, and tool ironwork must be physically movable before every founder is housed',
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
