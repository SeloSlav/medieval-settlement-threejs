import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  industrialWaterInputPreferenceRank,
  industrialWaterRequirement,
  industrialWaterTarget,
  residenceHasWaterRoom,
  selectIndustrialWaterCandidate,
  wellRefillPerSecond,
  wellSustainableHomeCapacity,
} from '../src/logistics/waterLogistics.ts';
import {
  CALENDAR_SECONDS_PER_DAY,
  DROUGHT_WELL_REFILL_MULTIPLIER,
  RESIDENCE_WATER_CAPACITY,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
  RESIDENCE_WATER_REORDER_FRACTION,
  RESIDENCE_POPULATION_WIDE,
  WELL_BASE_REFILL_PER_SEC,
  WELL_MINIMUM_REFILL_HYDROLOGY,
  WELL_WATER_PER_DELIVERY,
} from '../src/generated/gameBalance.ts';
import {
  WEAVER_INPUT_POLICY_FLAX_FIRST,
  WEAVER_INPUT_POLICY_WOOL_FIRST,
} from '../src/economy/weaverInputPolicy.ts';
import type { BuildingState } from '../src/resources/types.ts';

function makeBuilding(
  id: string,
  kind: BuildingState['kind'],
  water: number,
  constructionPriority = 2,
  processorOutputTargetPercent = 100,
): BuildingState {
  return {
    id,
    kind,
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: 1,
    constructionPriority,
    processorOutputTargetPercent,
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

const householdWaterReorder = RESIDENCE_WATER_CAPACITY * RESIDENCE_WATER_REORDER_FRACTION;
assert.equal(residenceHasWaterRoom(householdWaterReorder), false);
assert.equal(residenceHasWaterRoom(householdWaterReorder - 0.01), true);
assert.equal(RESIDENCE_WATER_CAPACITY - householdWaterReorder, WELL_WATER_PER_DELIVERY);
const normalHouseholdDaysPerWaterRun = WELL_WATER_PER_DELIVERY
  / (3 * RESIDENCE_WATER_PER_PERSON_PER_SEC * CALENDAR_SECONDS_PER_DAY);
assert.ok(normalHouseholdDaysPerWaterRun > 3.7 && normalHouseholdDaysPerWaterRun < 3.8);

assert.equal(WELL_BASE_REFILL_PER_SEC, 2.4);
assert.equal(WELL_MINIMUM_REFILL_HYDROLOGY, 0.15);
assert.equal(
  wellSustainableHomeCapacity(
    1,
    1,
    RESIDENCE_POPULATION_WIDE,
  ),
  50,
  'an excellent well in fair weather should top out at 50 fully occupied homes',
);
assert.ok(wellSustainableHomeCapacity(0, 1) < 50);
assert.ok(wellSustainableHomeCapacity(1, DROUGHT_WELL_REFILL_MULTIPLIER) < 50);
assert.ok(wellSustainableHomeCapacity(0.8, 1) > wellSustainableHomeCapacity(0, 1));

assert.ok(industrialWaterRequirement('bakery') > 0);
assert.ok(industrialWaterRequirement('brewery') > 0);
assert.equal(industrialWaterRequirement('spinning_retting_house'), 1);
assert.equal(
  industrialWaterRequirement('weaver'),
  0,
  'the Weaver must stay dry because Yarn and Linen are already prepared fibre',
);
assert.equal(industrialWaterRequirement('smithy'), 1);
assert.equal(industrialWaterRequirement('potter_kiln'), 1);
assert.equal(industrialWaterRequirement('lumber_mill'), 0);
assert.equal(industrialWaterRequirement('watermill'), 0);
assert.equal(industrialWaterTarget('bakery', 25), 6);
assert.equal(industrialWaterTarget('bakery', 50), 6);
assert.equal(industrialWaterTarget('bakery', 75), 6);
assert.equal(industrialWaterTarget('bakery', 100), 6);
assert.equal(industrialWaterTarget('brewery', 50), 6);
assert.equal(industrialWaterTarget('spinning_retting_house', 25), 3);
assert.equal(industrialWaterTarget('spinning_retting_house', 50), 3);
assert.equal(industrialWaterTarget('spinning_retting_house', 100), 3);
assert.equal(industrialWaterTarget('weaver', 100), 0);
assert.equal(industrialWaterTarget('smithy', 25), 3);
assert.equal(industrialWaterTarget('smithy', 50), 3);
assert.equal(industrialWaterTarget('smithy', 100), 3);
assert.equal(industrialWaterTarget('potter_kiln', 25), 3);
assert.equal(industrialWaterTarget('potter_kiln', 50), 3);
assert.equal(industrialWaterTarget('potter_kiln', 100), 3);
assert.equal(
  industrialWaterInputPreferenceRank(
    'spinning_retting_house',
    WEAVER_INPUT_POLICY_FLAX_FIRST,
  ),
  0,
);
assert.equal(industrialWaterInputPreferenceRank('bakery', 2), 1);
assert.equal(
  industrialWaterInputPreferenceRank(
    'spinning_retting_house',
    WEAVER_INPUT_POLICY_WOOL_FIRST,
  ),
  2,
);
assert.equal(
  industrialWaterInputPreferenceRank('weaver', WEAVER_INPUT_POLICY_FLAX_FIRST),
  1,
  'the Weaver route preference must not affect industrial water arbitration',
);

const candidates = [
  {
    building: makeBuilding('8', 'bakery', 1),
    requiredPerCycle: 2,
    stockRatio: 0.5,
    distance: 10,
  },
  {
    building: makeBuilding('7', 'brewery', 0),
    requiredPerCycle: 2,
    stockRatio: 0,
    distance: 30,
  },
  {
    building: makeBuilding('6', 'bakery', 0),
    requiredPerCycle: 2,
    stockRatio: 0,
    distance: 30,
  },
];
assert.equal(
  selectIndustrialWaterCandidate(candidates)?.building.id,
  '6',
  'the emptiest workshop should win before route distance, with stable id as the final tie-break',
);

const highPriorityCandidate = {
  building: makeBuilding('8', 'bakery', 1, 3),
  requiredPerCycle: 2,
  stockRatio: 0.5,
  distance: 100,
};
const lowPriorityCandidate = {
  building: makeBuilding('7', 'brewery', 0, 1),
  requiredPerCycle: 2,
  stockRatio: 0,
  distance: 10,
};
assert.equal(
  selectIndustrialWaterCandidate([
    highPriorityCandidate,
    lowPriorityCandidate,
  ])?.building.id,
  '7',
  'legacy completed-building priority must not override the emptier workshop',
);

const flaxFirstSpinner = {
  building: {
    ...makeBuilding('spinner-flax', 'spinning_retting_house', 2),
    flax: 3,
    weaverInputPolicy: WEAVER_INPUT_POLICY_FLAX_FIRST,
  },
  requiredPerCycle: 1,
  stockRatio: 2 / 3,
  distance: 100,
};
const neutralEmptyBakery = {
  building: makeBuilding('bakery-neutral', 'bakery', 0),
  requiredPerCycle: 2,
  stockRatio: 0,
  distance: 10,
};
const woolFirstSpinner = {
  building: {
    ...makeBuilding('spinner-wool', 'spinning_retting_house', 0),
    flax: 3,
    weaverInputPolicy: WEAVER_INPUT_POLICY_WOOL_FIRST,
  },
  requiredPerCycle: 1,
  stockRatio: 0,
  distance: 5,
};
assert.equal(
  selectIndustrialWaterCandidate([
    neutralEmptyBakery,
    woolFirstSpinner,
    flaxFirstSpinner,
  ])?.building.id,
  flaxFirstSpinner.building.id,
  'a flax-first Spinning & Retting House should win contested water inside one work-priority tier',
);
assert.equal(
  selectIndustrialWaterCandidate([
    woolFirstSpinner,
    neutralEmptyBakery,
  ])?.building.id,
  neutralEmptyBakery.building.id,
  'a wool-first Spinning & Retting House should yield contested water to a neutral wet workshop',
);
assert.equal(
  selectIndustrialWaterCandidate([
    {
      ...woolFirstSpinner,
      building: {
        ...woolFirstSpinner.building,
        constructionPriority: 3,
      },
    },
    {
      ...flaxFirstSpinner,
      building: {
        ...flaxFirstSpinner.building,
        constructionPriority: 1,
      },
    },
  ])?.building.id,
  flaxFirstSpinner.building.id,
  'legacy completed-building priority must not override fibre-house input preference',
);

const selectionStarted = performance.now();
const largeSelection = selectIndustrialWaterCandidate(
  Array.from({ length: 100_000 }, (_, index) => ({
    building: makeBuilding(String(index), 'bakery', index === 99_999 ? 0 : 1),
    requiredPerCycle: 2,
    stockRatio: index === 99_999 ? 0 : 0.5,
    distance: 100_000 - index,
  })),
);
assert.equal(largeSelection?.building.id, '99999');
assert.ok(
  performance.now() - selectionStarted < 500,
  '100k workshop selection should stay linear and comfortably interactive',
);

const wellSimulation = fs.readFileSync('server/src/simulation/well.rs', 'utf8');
const wellPolicy = fs.readFileSync('server/src/well_policy.rs', 'utf8');
const expandedEconomy = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const simulationModules = fs.readFileSync('server/src/simulation/mod.rs', 'utf8');
const wellInspector = fs.readFileSync('src/resources/inspector/wellRenderer.ts', 'utf8');
const worldQueries = fs.readFileSync('src/resources/WorldQueries.ts', 'utf8');
const processorWaterStatus = fs.readFileSync(
  'src/resources/inspector/buildingWaterStatus.ts',
  'utf8',
);

assert.doesNotMatch(
  wellSimulation,
  /try_start_building_supply_trip/,
  'routine well service is a conserved direct transfer and must not reserve a cart crew',
);
assert.match(wellSimulation, /CommodityKind::Water/);
assert.match(wellSimulation, /building_has_inbound_supply_trip/);
assert.match(wellSimulation, /tick\.building_disabled_by_fire\(ctx, candidate\.id\)/);
assert.match(wellSimulation, /work_priority: CONSTRUCTION_PRIORITY_NORMAL/);
assert.match(wellSimulation, /input_preference_rank: industrial_water_input_preference_rank/);
assert.match(wellSimulation, /industrial_water_target/);
assert.match(wellSimulation, /candidate\.water\.max\(0\.0\) \/ desired_stock/);
assert.match(wellSimulation, /target\.processor_output_target_percent/);
assert.match(
  wellSimulation,
  /candidate\.kind == "spinning_retting_house" && candidate\.flax <= 1e-6/,
  'automatic well service should skip a fibre house that has no flax to ret',
);
assert.doesNotMatch(
  wellSimulation,
  /candidate\.kind == "weaver"/,
  'the dry Weaver must not be special-cased by well-side arbitration',
);
assert.match(
  wellSimulation,
  /tick\.building_ids_for_kinds\(ctx,\s*well\.owner,\s*INDUSTRIAL_WATER_BUILDING_KINDS\)/,
  'each well should inspect only indexed water-using workshop kinds',
);
assert.doesNotMatch(
  wellSimulation,
  /\.building\(\)\s*\.\s*owner\(\)\s*\.\s*filter\(&well\.owner\)/,
  'industrial water selection must not rescan every owner building per well',
);
assert.match(
  wellSimulation,
  /distribute_well_water\(ctx, tick, &mut well\)[\s\S]*distribute_industrial_water\(ctx, tick, network, &mut well\)/,
  'household allocation must remain ahead of automatic workshop service',
);
assert.match(
  wellSimulation,
  /deposit_building_commodity\(&mut target, CommodityKind::Water, needed\.min\(well\.water\)\)[\s\S]*well\.water = \(well\.water - supplied\)\.max\(0\.0\)/,
  'automatic workshop service must conserve water between the well and the target buffer',
);
assert.doesNotMatch(expandedEconomy, /ensure_(?:building_)?water/);
assert.doesNotMatch(simulationModules, /mod water_logistics/);
assert.match(
  wellPolicy,
  /INDUSTRIAL_WATER_BUILDING_KINDS:[\s\S]*"spinning_retting_house"/,
  'the authoritative indexed wet-workshop roster must contain the fibre house',
);
const industrialWaterKindList = wellPolicy.slice(
  wellPolicy.indexOf('pub const INDUSTRIAL_WATER_BUILDING_KINDS'),
  wellPolicy.indexOf('pub fn industrial_water_requirement'),
);
assert.doesNotMatch(
  industrialWaterKindList,
  /"weaver"/,
  'the dry Weaver must not be scanned as an industrial-water consumer',
);
assert.match(
  wellPolicy,
  /"spinning_retting_house" => SPINNING_RETTING_FLAX_WATER_PER_CYCLE/,
);
assert.doesNotMatch(
  wellPolicy,
  /"weaver"\s*=>[\s\S]*WATER_PER_CYCLE/,
  'the authoritative water requirement must not regress to the Weaver',
);
assert.equal(
  fs.existsSync('server/src/simulation/water_logistics.rs'),
  false,
  'duplicate target-side water logistics must stay removed; the well owns the direct transfer',
);
assert.match(
  wellInspector,
  /No cart — homes and workshops draw automatically within this well's radius and road branch/,
);
assert.doesNotMatch(wellInspector, /staffingPriorityLabel|staffing priority/i);
assert.match(wellInspector, /weaverFibreDeliveryPreferenceLabel/);
assert.match(wellInspector, /industrialWaterTarget/);
assert.match(wellInspector, /staged water/);
assert.doesNotMatch(wellInspector, /Workshops receive physical cart deliveries/);
assert.match(wellInspector, /Sustainable capacity/);
assert.match(wellInspector, /Homes connected now/);
assert.match(
  wellInspector,
  /nextIndustrialTarget\?\.kind === 'spinning_retting_house'/,
  'well target labels should attach the flax-route policy to the fibre house',
);
assert.doesNotMatch(
  wellInspector,
  /nextIndustrialTarget\?\.kind === 'weaver'/,
  'well target labels must not describe the dry Weaver as a wet workshop',
);
assert.match(
  wellInspector,
  /\['fibre house',[\s\S]*item\.kind === 'spinning_retting_house'/,
);
assert.doesNotMatch(wellInspector, /item\.kind === 'weaver'/);
assert.match(wellInspector, /\['smithy',[\s\S]*item\.kind === 'smithy'/);
assert.match(
  worldQueries,
  /candidate\.kind === 'spinning_retting_house'[\s\S]*\(candidate\.flax \?\? 0\) <= 1e-6/,
);
const spinningRettingStep = expandedEconomy.slice(
  expandedEconomy.indexOf('pub fn step_spinning_retting_house'),
  expandedEconomy.indexOf('pub fn step_weaver'),
);
assert.match(
  spinningRettingStep,
  /CommodityKind::Water,\s*SPINNING_RETTING_FLAX_WATER_PER_CYCLE/,
  'the authoritative flax-retting recipe must consume its physically staged well water',
);
assert.match(
  spinningRettingStep,
  /CommodityKind::Water,\s*0\.0/,
  'the authoritative wool-spinning route must remain dry',
);
assert.doesNotMatch(
  spinningRettingStep,
  /request_connected_commodity/,
  'the fibre house must wait for conserved well-side service rather than pulling water by building order',
);
const weaverStep = expandedEconomy.slice(
  expandedEconomy.indexOf('pub fn step_weaver'),
  expandedEconomy.indexOf('pub fn step_tannery'),
);
assert.doesNotMatch(
  weaverStep,
  /CommodityKind::Water|SPINNING_RETTING_FLAX_WATER_PER_CYCLE|request_connected_commodity/,
  'the Weaver should consume only prepared Yarn or Linen and must remain outside water logistics',
);
const smithyStep = expandedEconomy.slice(
  expandedEconomy.indexOf('pub fn step_smithy'),
  expandedEconomy.indexOf('pub fn step_potter_kiln'),
);
assert.match(
  smithyStep,
  /CommodityKind::Water,\s*SMITHY_WATER_PER_CYCLE/,
  'the authoritative forge recipe must consume its physically delivered quench water',
);
assert.doesNotMatch(
  smithyStep,
  /request_connected_commodity/,
  'smithies must wait for conserved well-side service arbitration rather than pulling water independently',
);
const potterStep = expandedEconomy.slice(
  expandedEconomy.indexOf('pub fn step_potter_kiln'),
  expandedEconomy.indexOf('pub fn step_apiary'),
);
assert.match(
  potterStep,
  /CommodityKind::Water,\s*POTTER_WATER_PER_CYCLE/,
  'the authoritative pottery recipe must consume physically delivered clay-puddling water',
);
assert.doesNotMatch(
  potterStep,
  /request_connected_commodity/,
  'potters must wait for conserved well-side service arbitration rather than pulling water independently',
);
assert.match(processorWaterStatus, /Water cart inbound/);
assert.match(processorWaterStatus, /Awaiting automatic well service/);
assert.doesNotMatch(processorWaterStatus, /Waiting for well cart/);

console.log('industrial water logistics tests passed');
