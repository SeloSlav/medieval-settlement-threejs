import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { GAME_TABLE_SUBSCRIPTIONS } from '../src/data/gameTableSubscriptions.ts';
import {
  effectiveLivestockBreedingReserve,
  effectiveLivestockHaymakingPercent,
  isLivestockCullMonth,
  isLivestockHaymakingMonth,
  isSheepShearingMonth,
  livestockHaymakingPresets,
  livestockDairyPreservedOutputPerCycle,
  livestockDairySaltPerCycle,
  livestockPreservationSaltRequired,
  livestockPolicyDefinition,
  livestockReservePresets,
  livestockSaltedOutputCapacity,
  pendingLivestockCullHeads,
  projectedLivestockCullYield,
} from '../src/economy/livestockPolicy.ts';
import {
  computeSettlementLivestockFodderPlan,
  livestockCyclesPerCalendarDay,
  projectLivestockFodderHolding,
} from '../src/economy/livestockFodder.ts';
import {
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  CATTLE_DEFAULT_BREEDING_RESERVE,
  CATTLE_HAY_PER_UNSUPPORTED_HEAD,
  CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
  CATTLE_MAX_HERD,
  CATTLE_MINIMUM_BREEDING_RESERVE,
  LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE,
  LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
  SHEEP_DEFAULT_BREEDING_RESERVE,
  SWINE_FOOD_PER_CYCLE_PER_HEAD,
} from '../src/generated/gameBalance.ts';
import type { BuildingState, LivestockHerdState } from '../src/resources/types.ts';

function buildingFixture(
  id: string,
  grain: number,
  assignedLabor = 1,
): BuildingState {
  return {
    id,
    kind: 'pastoral_farmstead',
    x: 0,
    z: 0,
    workRadius: 110,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    salt: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionDeliveredTimber: 0,
    constructionDeliveredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: false,
    storehouseAcceptsStone: false,
    storehouseAcceptsFirewood: false,
  };
}

function herdFixture(buildingId: string): LivestockHerdState {
  return {
    buildingId,
    species: 'cattle',
    headCount: 8,
    health: 0.9,
    breedingProgress: 0,
    pastureCapacity: 10 * AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
    suppliedCapacity: 8,
    lastFoodOutput: 0,
    lastPreservedOutput: 0,
    lastWoolGold: 0,
    breedingReserve: 6,
    lastCulled: 0,
    hayStock: 0,
    lastHayOutput: 0,
    haymakingPercent: 35,
  };
}

assert.equal(SWINE_FOOD_PER_CYCLE_PER_HEAD, 0, 'pigs must not create passive meat without culling');
assert.ok(CATTLE_MINIMUM_BREEDING_RESERVE < CATTLE_DEFAULT_BREEDING_RESERVE);
assert.ok(CATTLE_DEFAULT_BREEDING_RESERVE < CATTLE_MAX_HERD);
assert.ok(SHEEP_DEFAULT_BREEDING_RESERVE > CATTLE_DEFAULT_BREEDING_RESERVE);

assert.equal(isLivestockCullMonth(9), false);
assert.equal(isLivestockCullMonth(10), true);
assert.equal(isLivestockCullMonth(11), true);
assert.equal(isLivestockCullMonth(12), false);
assert.equal(isLivestockHaymakingMonth(5), false);
assert.equal(isLivestockHaymakingMonth(6), true);
assert.equal(isLivestockHaymakingMonth(8), true);
assert.equal(isLivestockHaymakingMonth(9), false);
assert.equal(isSheepShearingMonth(5), false);
assert.equal(isSheepShearingMonth(6), true);
assert.equal(isSheepShearingMonth(7), true);
assert.equal(isSheepShearingMonth(8), false);
assert.equal(effectiveLivestockHaymakingPercent(-1), 0);
assert.equal(effectiveLivestockHaymakingPercent(35.9), 35);
assert.equal(effectiveLivestockHaymakingPercent(100), 60);
assert.deepEqual(
  livestockHaymakingPresets().map((preset) => preset.percent),
  [0, 35, 60],
);

assert.equal(
  effectiveLivestockBreedingReserve('swine', 0),
  livestockPolicyDefinition('swine').maximumHerd,
  'zero remains a defensive no-cull fallback',
);
assert.deepEqual(
  livestockReservePresets('cattle').map((preset) => preset.reserve),
  [3, 6, 10],
);
assert.equal(pendingLivestockCullHeads('swine', 10, 7), 3);
assert.deepEqual(projectedLivestockCullYield('swine', 10, 7), {
  heads: 3,
  food: 27,
  preservedFood: 0,
});
assert.deepEqual(projectedLivestockCullYield('cattle', 9, 6), {
  heads: 3,
  food: 30,
  preservedFood: 9,
});
assert.equal(livestockPreservationSaltRequired(8), 1);
assert.equal(livestockSaltedOutputCapacity(1), 8);
assert.equal(
  livestockDairyPreservedOutputPerCycle('cattle', 10),
  1.2,
);
assert.equal(
  livestockDairySaltPerCycle('cattle', 10),
  1.2 * LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT,
);
assert.equal(livestockDairySaltPerCycle('swine', 10), 0);

const fodderBuilding = buildingFixture('building-1', 60);
const fodderHerd = herdFixture(fodderBuilding.id);
assert.equal(livestockCyclesPerCalendarDay(fodderBuilding, false), 7);
assert.equal(livestockCyclesPerCalendarDay(fodderBuilding, true), 6);
const fodderPlan = projectLivestockFodderHolding(
  fodderBuilding,
  fodderHerd,
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(fodderPlan.projectedHeadCount, 6, 'autumn forecast must include configured culls');
assert.equal(fodderPlan.winterPastureCapacity, 3.5);
assert.equal(fodderPlan.winterUnsupportedHeads, 2.5);
assert.ok(Math.abs(fodderPlan.winterGrainPerDay - 5.95) < 1e-9);
assert.ok(
  Math.abs(
    fodderPlan.winterGrainNeed
      - fodderPlan.winterGrainPerDay * LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
  ) < 1e-9,
);
assert.equal(fodderPlan.winterReserveTarget, 90, 'holding target must respect grain capacity');
assert.equal(fodderPlan.winterReserveStock, 60);
assert.equal(fodderPlan.winterReserveShortfall, 30);
assert.ok(Math.abs(fodderPlan.productiveHeads - 7.2) < 1e-9);
assert.ok(Math.abs(fodderPlan.dairyPreservedFoodPerDay - 6.048) < 1e-9);
assert.ok(Math.abs(fodderPlan.dairySaltPerDay - 0.756) < 1e-9);
assert.equal(
  fodderPlan.dairySaltTarget,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE * 3,
);
assert.equal(fodderPlan.dairySaltShortfall, fodderPlan.dairySaltTarget);
assert.equal(fodderPlan.dairySaltRunwayDays, 0);
assert.ok(
  fodderPlan.winterGrainNeed > fodderPlan.winterReserveTarget,
  'full holding storage must expose a mid-winter resupply requirement',
);

const summerHerd = {
  ...fodderHerd,
  pastureCapacity: 10 * (1 - fodderHerd.haymakingPercent / 100),
};
const summerPlan = projectLivestockFodderHolding(
  fodderBuilding,
  summerHerd,
  1,
  false,
  6,
  1,
);
assert.equal(summerPlan.basePastureCapacity, 10);
assert.equal(summerPlan.summerReservedCapacity, 3.5);
assert.ok(
  Math.abs(
    summerPlan.hayOutputPerDay
      - 3.5 * CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE * 7,
  ) < 1e-9,
);
assert.equal(summerPlan.haymakingDaysRemaining, 90);
assert.ok(Math.abs(summerPlan.projectedHayStock - 240) < 1e-9);
assert.equal(summerPlan.winterHayNeed, 178.5);
assert.equal(
  summerPlan.winterGrainNeed,
  0,
  'a full three-month haymaking season should cover the minimum winter reserve',
);
assert.equal(summerPlan.currentUnsupportedHeads, 1.5);

const hayFedAutumnPlan = projectLivestockFodderHolding(
  fodderBuilding,
  { ...fodderHerd, hayStock: 178.5 },
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(
  hayFedAutumnPlan.winterHayNeed,
  hayFedAutumnPlan.hayStock,
  'a complete local hay reserve should cover the 30-day unsupported-head forecast',
);
assert.equal(hayFedAutumnPlan.winterGrainNeed, 0);
assert.equal(hayFedAutumnPlan.winterReserveTarget, 0);
assert.ok(CATTLE_HAY_PER_UNSUPPORTED_HEAD > 0);

const firstShortState = {
  buildings: new Map([
    ['building-10', buildingFixture('building-10', 0)],
    ['building-2', buildingFixture('building-2', 0)],
    ['building-1', buildingFixture('building-1', 90)],
  ]),
  livestockHerds: new Map([
    ['building-10', herdFixture('building-10')],
    ['building-2', herdFixture('building-2')],
    ['building-1', herdFixture('building-1')],
  ]),
};
const settlementFodder = computeSettlementLivestockFodderPlan(
  firstShortState,
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
assert.equal(settlementFodder.holdingCount, 3);
assert.equal(settlementFodder.shortHoldings, 2);
assert.equal(
  settlementFodder.firstShortBuildingId,
  'building-2',
  'server numeric ids must break equal-runway ties',
);
assert.equal(
  settlementFodder.winterReserveShortfall,
  180,
  'one full holding must not hide local shortfalls at two others',
);
assert.equal(settlementFodder.dairySaltShortHoldings, 3);
assert.equal(
  settlementFodder.firstDairySaltShortBuildingId,
  'building-1',
  'equal empty salt runways must use stable server-id order',
);
assert.equal(
  settlementFodder.dairySaltTarget,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE * 3 * 3,
);

const serverPolicy = fs.readFileSync('server/src/livestock_policy.rs', 'utf8');
const serverSimulation = fs.readFileSync('server/src/simulation/livestock.rs', 'utf8');
const serverReducer = fs.readFileSync('server/src/reducers/livestock.rs', 'utf8');
const serverTables = fs.readFileSync('server/src/tables.rs', 'utf8');
const generatedHerd = fs.readFileSync('src/generated/livestock_herd_table.ts', 'utf8');
const generatedReducer = fs.readFileSync(
  'src/generated/set_livestock_breeding_reserve_reducer.ts',
  'utf8',
);
const generatedHaymakingReducer = fs.readFileSync(
  'src/generated/set_livestock_haymaking_percent_reducer.ts',
  'utf8',
);
const clientReducers = fs.readFileSync('src/data/spacetimeReducers.ts', 'utf8');
const livestockInspector = fs.readFileSync(
  'src/resources/inspector/livestockBuildingRenderer.ts',
  'utf8',
);
const townHallInspector = fs.readFileSync(
  'src/resources/inspector/townHallRenderer.ts',
  'utf8',
);

assert.match(serverPolicy, /pub fn can_cull_one/);
assert.match(serverPolicy, /pub fn projected_winter_fodder_grain/);
assert.match(serverPolicy, /pub fn is_haymaking_month/);
assert.match(serverPolicy, /pub fn is_shearing_month/);
assert.match(serverPolicy, /pub fn haymaking_share/);
assert.match(serverPolicy, /food_room[\s\S]*slaughter_food_per_head/);
assert.match(serverSimulation, /herd\.head_count -= 1/);
assert.match(serverSimulation, /herd\.last_culled = 1/);
assert.match(serverSimulation, /species_slaughter_yields/);
assert.match(
  serverSimulation,
  /immediate_grain_buffer\.max\(winter_grain_target\)/,
  'winter reserves must extend, not replace, the immediate fallback buffer',
);
assert.match(serverSimulation, /herd\.hay_stock/);
assert.match(serverSimulation, /is_haymaking_month/);
assert.match(
  serverSimulation,
  /let hay_supplement[\s\S]*herd\.hay_stock = [\s\S]*let grain_unsupported/,
  'winter feeding must consume local hay before emergency grain',
);
assert.match(
  serverSimulation,
  /CommodityKind::Grain,[\s\S]{0,120}&\["threshing_barn", "granary"\]/,
  'winter reserve must use the existing seed- and reserve-protected grain logistics',
);
assert.match(
  serverSimulation,
  /head_count < max_herd[\s\S]*breeding_progress \+= [\s\S]*else[\s\S]*breeding_progress = herd\.breeding_progress\.min\(0\.999\)/,
  'full herds must not bank an unlimited queue of replacement births',
);
assert.match(
  serverSimulation,
  /store_salted_farmstead_output[\s\S]*CommodityKind::Salt[\s\S]*LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT/,
  'farmhouse preserved output must withdraw physical salt',
);
assert.match(
  serverSimulation,
  /unsalted_slaughter[\s\S]*CommodityKind::Meat/,
  'unsalted autumn meat must enter vulnerable fresh-food storage',
);
assert.doesNotMatch(
  serverSimulation,
  /season_multiplier[\s\S]{0,300}species_food_per_cycle/,
  'pork must not remain a disguised passive seasonal multiplier',
);
assert.match(serverReducer, /pub fn set_livestock_breeding_reserve/);
assert.match(serverReducer, /pub fn set_livestock_haymaking_percent/);
assert.match(serverReducer, /breeding_reserve < minimum \|\| breeding_reserve > maximum/);
assert.match(
  serverTables,
  /last_wool_gold:[\s\S]*#\[default\(7u32\)\][\s\S]*breeding_reserve:[\s\S]*last_culled:[\s\S]*#\[default\(0\.0\)\][\s\S]*hay_stock:[\s\S]*last_hay_output:[\s\S]*#\[default\(0u8\)\][\s\S]*haymaking_percent:[\s\S]*#\[default\(0\.0\)\][\s\S]*last_wool_output:[\s\S]*#\[default\(0u32\)\][\s\S]*last_shearing_year:/,
  'migration-safe fields must remain appended to the herd table',
);
assert.match(generatedHerd, /breedingReserve/);
assert.match(generatedHerd, /lastCulled/);
assert.match(generatedHerd, /hayStock/);
assert.match(generatedHerd, /lastHayOutput/);
assert.match(generatedHerd, /haymakingPercent/);
assert.match(generatedHerd, /lastWoolOutput/);
assert.match(generatedHerd, /lastShearingYear/);
assert.match(serverSimulation, /herd\.last_shearing_year != clock\.year/);
assert.match(serverSimulation, /CommodityKind::Wool/);
assert.doesNotMatch(
  serverSimulation,
  /credit_treasury_gold/,
  'sheep fleece must enter physical storage rather than minting treasury gold',
);
assert.match(generatedReducer, /breedingReserve/);
assert.match(generatedHaymakingReducer, /haymakingPercent/);
assert.match(clientReducers, /setLivestockBreedingReserve/);
assert.match(clientReducers, /setLivestockHaymakingPercent/);
assert.ok(GAME_TABLE_SUBSCRIPTIONS.includes('pasture'));
assert.ok(GAME_TABLE_SUBSCRIPTIONS.includes('livestock_herd'));
assert.match(livestockInspector, /data-livestock-breeding-reserve/);
assert.match(livestockInspector, /October and November/);
assert.match(livestockInspector, /whole animal/);
assert.match(livestockInspector, /Winter grain reserve/);
assert.match(livestockInspector, /Winter resupply/);
assert.match(livestockInspector, /data-livestock-haymaking-percent/);
assert.match(livestockInspector, /Summer hay meadow/);
assert.match(livestockInspector, /Hayloft/);
assert.match(livestockInspector, /Cheese salt/);
assert.match(livestockInspector, /fresh dairy continues/);
assert.match(townHallInspector, /computeSettlementLivestockFodderPlan/);
assert.match(townHallInspector, /first winter fodder shortfall/);
assert.match(townHallInspector, /Summer hay plan/);
assert.match(townHallInspector, /Winter hay reserve/);
assert.match(townHallInspector, /Dairy salt buffers/);
assert.match(townHallInspector, /first dairy salt shortfall/);
assert.match(townHallInspector, /data-inspect-building/);

let checksum = 0;
const started = performance.now();
for (let index = 0; index < 100_000; index += 1) {
  checksum += projectedLivestockCullYield(
    index % 3 === 0 ? 'cattle' : index % 3 === 1 ? 'sheep' : 'swine',
    3 + index % 16,
    3 + index % 8,
  ).food;
}
const elapsed = performance.now() - started;
assert.ok(checksum > 0);
assert.ok(elapsed < 200, `100,000 herd policy projections took ${elapsed.toFixed(1)} ms`);

const stressBuildings = new Map<string, BuildingState>();
const stressHerds = new Map<string, LivestockHerdState>();
for (let index = 1; index <= 100_000; index += 1) {
  const id = `building-${index}`;
  stressBuildings.set(id, buildingFixture(id, 90));
  stressHerds.set(id, herdFixture(id));
}
const fodderStarted = performance.now();
const stressFodder = computeSettlementLivestockFodderPlan(
  { buildings: stressBuildings, livestockHerds: stressHerds },
  AUTUMN_PASTURE_CAPACITY_MULTIPLIER,
  false,
  9,
);
const fodderElapsed = performance.now() - fodderStarted;
assert.equal(stressFodder.holdingCount, 100_000);
assert.equal(stressFodder.capacityLimitedHoldings, 100_000);
assert.ok(
  fodderElapsed < 1_000,
  `100,000-holding fodder aggregation took ${fodderElapsed.toFixed(1)} ms`,
);

console.log(
  `livestock reserve policy tests passed (${elapsed.toFixed(1)} ms policy; ${fodderElapsed.toFixed(1)} ms fodder for 100,000 herds)`,
);
