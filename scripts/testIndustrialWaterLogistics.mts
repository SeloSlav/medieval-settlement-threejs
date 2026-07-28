import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  industrialWaterRequirement,
  industrialWaterTarget,
  selectIndustrialWaterCandidate,
} from '../src/logistics/waterLogistics.ts';
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

assert.ok(industrialWaterRequirement('granary') > 0);
assert.ok(industrialWaterRequirement('brewery') > 0);
assert.equal(industrialWaterRequirement('lumber_mill'), 0);
assert.equal(industrialWaterRequirement('watermill'), 0);
assert.equal(industrialWaterTarget('granary', 25), 2);
assert.equal(industrialWaterTarget('granary', 50), 4);
assert.equal(industrialWaterTarget('granary', 75), 6);
assert.equal(industrialWaterTarget('granary', 100), 6);
assert.equal(industrialWaterTarget('brewery', 50), 6);

const candidates = [
  {
    building: makeBuilding('8', 'granary', 1),
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
    building: makeBuilding('6', 'granary', 0),
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
  building: makeBuilding('8', 'granary', 1, 3),
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
  '8',
  'a higher work-priority workshop should receive scarce well water before a lower tier',
);

const selectionStarted = performance.now();
const largeSelection = selectIndustrialWaterCandidate(
  Array.from({ length: 100_000 }, (_, index) => ({
    building: makeBuilding(String(index), 'granary', index === 99_999 ? 0 : 1),
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
const expandedEconomy = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const simulationModules = fs.readFileSync('server/src/simulation/mod.rs', 'utf8');
const wellInspector = fs.readFileSync('src/resources/inspector/wellRenderer.ts', 'utf8');
const processorWaterStatus = fs.readFileSync(
  'src/resources/inspector/buildingWaterStatus.ts',
  'utf8',
);

assert.match(wellSimulation, /try_start_building_supply_trip/);
assert.match(wellSimulation, /CommodityKind::Water/);
assert.match(wellSimulation, /building_has_inbound_supply_trip/);
assert.match(wellSimulation, /tick\.building_disabled_by_fire\(ctx, candidate\.id\)/);
assert.match(wellSimulation, /work_priority: candidate\.construction_priority/);
assert.match(wellSimulation, /industrial_water_target/);
assert.match(wellSimulation, /candidate\.water\.max\(0\.0\) \/ desired_stock/);
assert.match(wellSimulation, /target\.processor_output_target_percent/);
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
  /if !household_targets\.is_empty\(\)[\s\S]*else if let Some\(target\) = industrial_target/,
  'household deliveries must remain ahead of routine workshop supply',
);
assert.doesNotMatch(expandedEconomy, /ensure_(?:building_)?water/);
assert.doesNotMatch(simulationModules, /mod water_logistics/);
assert.equal(
  fs.existsSync('server/src/simulation/water_logistics.rs'),
  false,
  'instant target-side water transfer must stay removed',
);
assert.match(
  wellInspector,
  /Fires first · households second · highest-priority emptiest workshop third/,
);
assert.match(wellInspector, /staffingPriorityLabel/);
assert.match(wellInspector, /industrialWaterTarget/);
assert.match(wellInspector, /staged water/);
assert.match(wellInspector, /by visible cart/);
assert.match(processorWaterStatus, /Water cart inbound/);
assert.match(processorWaterStatus, /Waiting for well cart/);

console.log('industrial water logistics tests passed');
