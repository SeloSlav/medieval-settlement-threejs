import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  BREWERY_BREWING_FIREWOOD_PER_CYCLE,
  BREWERY_MALTING_FIREWOOD_PER_CYCLE,
  CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
  CHANDLERY_FIREWOOD_PER_CYCLE,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
  BAKERY_FIREWOOD_PER_CYCLE,
  POTTER_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import {
  computeSettlementFirewoodPlan,
  industrialFirewoodCapacityPerDay,
} from '../src/economy/settlementFirewood.ts';
import {
  directlyDispatchedProcessorInputPerCycle,
  processorInputTarget,
  selectDirectProcessorInputTarget,
} from '../src/logistics/processorInputLogistics.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import type {
  BuildingKind,
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';

const expectedFirewoodPerCycle = new Map<BuildingKind, number>([
  ['bakery', BAKERY_FIREWOOD_PER_CYCLE],
  [
    'brewery',
    BREWERY_MALTING_FIREWOOD_PER_CYCLE
      + BREWERY_BREWING_FIREWOOD_PER_CYCLE,
  ],
  ['smokehouse', SMOKEHOUSE_FIREWOOD_PER_CYCLE],
  ['charcoal_burner', CHARCOAL_BURNER_FIREWOOD_PER_CYCLE],
  ['potter_kiln', POTTER_FIREWOOD_PER_CYCLE],
  ['chandlery', CHANDLERY_FIREWOOD_PER_CYCLE],
]);
for (const [kind, expected] of expectedFirewoodPerCycle) {
  assert.equal(
    directlyDispatchedProcessorInputPerCycle(kind, 'firewood'),
    expected,
    `${kind} firewood dispatch must match its authoritative recipe`,
  );
}
assert.deepEqual(
  [25, 50, 75, 100].map((target) => processorInputTarget(1, target)),
  [3, 3, 3, 3],
  'legacy output percentages must not alter the automatic firewood working buffer',
);

const lowPriorityNear = building('10', 'bakery', {
  x: 4,
  assignedLabor: 1,
  constructionPriority: 1,
});
const highPriorityFar = building('20', 'potter_kiln', {
  x: 80,
  assignedLabor: 1,
  constructionPriority: 3,
});
assert.equal(
  selectDirectProcessorInputTarget(
    [lowPriorityNear, highPriorityFar],
    'lodge',
    'firewood',
    (target) => target.x,
  )?.target.id,
  lowPriorityNear.id,
  'completed workshops share neutral priority, so equal-runway fuel follows the shorter route',
);

const stockedNear = building('30', 'smokehouse', {
  x: 3,
  assignedLabor: 1,
  constructionPriority: 2,
  firewood: 0.8,
});
const emptyFar = building('40', 'charcoal_burner', {
  x: 60,
  assignedLabor: 1,
  constructionPriority: 2,
  firewood: 0,
});
assert.equal(
  selectDirectProcessorInputTarget(
    [stockedNear, emptyFar],
    'storehouse',
    'firewood',
    (target) => target.x,
  )?.target.id,
  emptyFar.id,
  'equal-priority fuel must go to the workshop with the lowest cycle runway',
);

const unstaffedUrgent = building('50', 'brewery', {
  x: 1,
  assignedLabor: 0,
  constructionPriority: 3,
});
assert.equal(
  selectDirectProcessorInputTarget(
    [unstaffedUrgent, lowPriorityNear],
    'lodge',
    'firewood',
    (target) => target.x,
  )?.target.id,
  lowPriorityNear.id,
  'an idle workshop must not sequester household-cleared fuel',
);

const state = emptyGameState();
const lodge = building('10', 'woodcutters_lodge', {
  assignedLabor: 2,
  firewood: 18,
});
const storehouse = building('11', 'village_storehouse', {
  assignedLabor: 1,
  firewood: 10,
  charcoal: 6,
  storehouseAcceptsFirewood: true,
});
const inactiveLodge = building('12', 'woodcutters_lodge', {
  assignedLabor: 0,
  firewood: 5,
});
const burningStorehouse = building('13', 'village_storehouse', {
  assignedLabor: 1,
  firewood: 7,
});
const bakery = building('30', 'bakery', {
  assignedLabor: 2,
  firewood: 2,
});
const brewery = building('31', 'brewery', {
  assignedLabor: 2,
  firewood: 1,
});
for (const site of [
  lodge,
  storehouse,
  inactiveLodge,
  burningStorehouse,
  bakery,
  brewery,
]) {
  state.buildings.set(site.id, site);
}
state.residences.set('20', residence('20', 0, 4, 8));
state.residences.set('40', residence('40', 200, 2, 2));
state.fireIncidents.set('fire-13', fireIncident('fire-13', '13'));
state.deliveryTrips.set(
  'fuel-cart',
  {
    id: 'fuel-cart',
    buildingId: lodge.id,
    residenceId: null,
    destinationKind: 'building',
    targetBuildingId: bakery.id,
    cargoKind: 'firewood',
    amount: 2,
    phase: 'outbound',
  } as DeliveryTripState,
);

const plan = computeSettlementFirewoodPlan(
  state,
  false,
  (entity) => entity.x < 100 ? 'west' : 'east',
);
assert.equal(plan.activeBranches, 2);
assert.equal(plan.distributors, 2);
assert.equal(plan.heatedHouseholds, 2);
assert.equal(plan.industrialSites, 2);
assert.equal(plan.householdStock, 10);
assert.equal(plan.protectedHouseholdStock, 2);
assert.ok(Math.abs(plan.protectedHouseholdTarget - 2) < 1e-9);
assert.equal(plan.householdsBelowProtectedStock, 0);
assert.equal(plan.distributorStock, 40);
assert.equal(plan.industrialStock, 3);
assert.equal(plan.firewoodInTransit, 2);
assert.equal(plan.inactiveStock, 5);
assert.equal(plan.quarantinedStock, 7);
assert.equal(plan.unservedBranches, 1);
assert.ok(plan.flowDeficitBranches >= 1);
assert.equal(
  plan.firstDeficitTargetId,
  '40',
  'the staffed western lodge should cover its branch before the unserved eastern household',
);
assert.equal(
  plan.industrialDemandPerDay,
  industrialFirewoodCapacityPerDay(bakery, false)
    + industrialFirewoodCapacityPerDay(brewery, false),
);
assert.ok(plan.lodgeOutputCapacityPerDay > 0);
assert.ok(plan.lodgeTimberDrawPerDay > 0);
assert.ok(Number.isFinite(plan.combinedRunwayDays));
state.stockpile.firewood = 99;
assert.equal(
  computeSettlementFirewoodPlan(state, false).inactiveStock,
  104,
  'legacy saves may still report compatibility-ledger fuel as inactive stock',
);
state.physicalFoundingSiteEnabled = true;
assert.equal(
  computeSettlementFirewoodPlan(state, false).inactiveStock,
  5,
  'physical settlements must never count a stale compatibility row as fuel',
);
state.physicalFoundingSiteEnabled = false;
state.stockpile.firewood = 0;
const baselineLodgeOutput = plan.lodgeOutputCapacityPerDay;
const baselineLodgeTimber = plan.lodgeTimberDrawPerDay;
lodge.ironwork = 0.75;
const maintainedPlan = computeSettlementFirewoodPlan(
  state,
  false,
  (entity) => entity.x < 100 ? 'west' : 'east',
);
assert.ok(Math.abs(
  maintainedPlan.lodgeOutputCapacityPerDay
    - baselineLodgeOutput * CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
) < 1e-9);
assert.ok(Math.abs(
  maintainedPlan.lodgeTimberDrawPerDay
    - baselineLodgeTimber * CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
) < 1e-9);
lodge.ironwork = 0;

const perfTargets = Array.from({ length: 100_000 }, (_, index) =>
  building(String(index), 'potter_kiln', {
    x: 100_000 - index,
    assignedLabor: 1,
    constructionPriority: 2,
    firewood: 0,
  }));
const perfStart = performance.now();
const perfTarget = selectDirectProcessorInputTarget(
  perfTargets,
  'lodge',
  'firewood',
  (target) => target.x,
);
const perfElapsed = performance.now() - perfStart;
assert.equal(perfTarget?.target.id, '99999');
assert.ok(
  perfElapsed < 200,
  `100k industrial firewood candidates took ${perfElapsed.toFixed(1)}ms`,
);

const expandedSimulation = readFileSync(
  new URL('../server/src/simulation/expanded_economy.rs', import.meta.url),
  'utf8',
);
const authoritativeLoop = readFileSync(
  new URL('../server/src/reducers/simulation.rs', import.meta.url),
  'utf8',
);
const lodgeSimulation = readFileSync(
  new URL('../server/src/simulation/woodcutters_lodge.rs', import.meta.url),
  'utf8',
);
const storehouseSimulation = readFileSync(
  new URL('../server/src/simulation/village_storehouse.rs', import.meta.url),
  'utf8',
);
const deliveryCargoSimulation = readFileSync(
  new URL('../server/src/simulation/delivery_cargo.rs', import.meta.url),
  'utf8',
);
assert.match(
  expandedSimulation,
  /pub fn step_industrial_firewood_dispatch[\s\S]*dispatch_to_building_where[\s\S]*INDUSTRIAL_FIREWOOD_TARGET_KINDS/,
);
assert.match(
  lodgeSimulation,
  /civilian_tool_throughput_multiplier\(lodge\.ironwork\)[\s\S]*action_cooldown[\s\S]*TICK_DT \* throughput_multiplier/,
  'maintained axes must accelerate the authoritative processing timer',
);
assert.match(
  lodgeSimulation,
  /if tools_maintained[\s\S]*withdraw_building_commodity\([\s\S]*CommodityKind::Ironwork[\s\S]*CIVILIAN_TOOL_IRONWORK_PER_CYCLE/,
  'a successful maintained firewood cycle must wear physical ironwork',
);
assert.doesNotMatch(
  expandedSimulation,
  /request_connected_commodity\([\s\S]{0,180}?CommodityKind::Firewood/,
  'hot workshops must no longer pull fuel in database update order',
);
assert.doesNotMatch(
  lodgeSimulation,
  /ResidenceNeedKind|household_firewood_needs_priority|try_start_delivery_trip/,
  'woodcutters must produce fuel without directly claiming household routes',
);
assert.match(
  storehouseSimulation,
  /pub fn step_storehouse_market_stalls[\s\S]*marketplace_fuel_reserve_target[\s\S]*combined_fuel_equivalent/,
  'staffed storehouse workers must stock a demand-based combined Marketplace fuel reserve',
);
assert.match(
  storehouseSimulation,
  /pub fn step_storehouse_market_stalls[\s\S]*CommodityKind::Charcoal[\s\S]*&\["marketplace"\]/,
  'staffed storehouse workers must also stock Marketplace stalls with household charcoal',
);
assert.match(
  deliveryCargoSimulation,
  /ResidenceNeedKind::Firewood => \{[\s\S]*building\.firewood \+ building\.charcoal \* CHARCOAL_HOUSEHOLD_FUEL_VALUE[\s\S]*CommodityKind::Charcoal/,
  'household heat deliveries must count physical firewood and charcoal fuel-equivalents',
);
assert.match(
  deliveryCargoSimulation,
  /ResidenceNeedKind::Firewood => \{[\s\S]*withdraw_building_commodity\([\s\S]*CommodityKind::Charcoal[\s\S]*withdraw_building\(/,
  'household heat deliveries must draw charcoal first so processed fuel cannot stagnate',
);
assert.match(
  expandedSimulation,
  /\("charcoal_burner", CommodityKind::Charcoal\)[\s\S]*Some\(&\["smithy", "village_storehouse"\]\)/,
  'charcoal yards must refill smithies first while exposing surplus fuel to household distribution',
);
const householdDispatchIndex = authoritativeLoop.indexOf(
  'step_storehouse_market_stalls(',
);
const industrialDispatchIndex = authoritativeLoop.indexOf('step_industrial_firewood_dispatch(');
const overflowDispatchIndex = authoritativeLoop.indexOf(
  'step_village_storehouse_overflow_collection(',
);
const processorLoopIndex = authoritativeLoop.indexOf('for (sim_kind, building_id) in expanded_ids');
const localMaterialDispatchIndex = authoritativeLoop.indexOf('step_local_material_dispatch(');
assert.ok(
  industrialDispatchIndex >= 0
    && industrialDispatchIndex < processorLoopIndex
    && processorLoopIndex < localMaterialDispatchIndex
    && localMaterialDispatchIndex < householdDispatchIndex
    && householdDispatchIndex < overflowDispatchIndex,
  'fresh lodge fuel may stage before production; smithy charcoal buffers then lead combined household reserves and final overflow collection',
);

console.log(
  `industrial firewood logistics tests passed (${perfElapsed.toFixed(1)} ms / 100k destinations)`,
);

function building(
  id: string,
  kind: BuildingKind,
  patch: Partial<BuildingState> = {},
): BuildingState {
  return {
    id,
    kind,
    x: 0,
    z: 0,
    constructionComplete: true,
    timber: 0,
    stone: 0,
    firewood: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    ironwork: 0,
    polearms: 0,
    wool: 0,
    flax: 0,
    cloth: 0,
    iron: 0,
    clay: 0,
    salt: 0,
    charcoal: 0,
    pottery: 0,
    assignedLabor: 0,
    constructionPriority: 2,
    processorOutputTargetPercent: 100,
    storehouseAcceptsFirewood: true,
    ...patch,
  } as BuildingState;
}

function residence(
  id: string,
  x: number,
  population: number,
  firewood: number,
): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: population,
    tier: 2,
    settlementTicks: 0,
    needs: {
      firewood: { stock: firewood, deficitSeconds: 0 },
      water: { stock: 0, deficitSeconds: 0 },
      food: { stock: 0, deficitSeconds: 0 },
      preservedFood: { stock: 0, deficitSeconds: 0 },
      ale: { stock: 0, deficitSeconds: 0 },
      cloth: { stock: 0, deficitSeconds: 0 },
    },
    abandoned: false,
    householdWealth: 0,
  };
}

function fireIncident(id: string, targetId: string): FireIncidentState {
  return {
    id,
    targetKind: 'building',
    targetId,
    x: 0,
    z: 0,
    ignitionSource: 'accident',
    status: 'burning',
    intensity: 1,
    damage: 0,
    waterDelivered: 0,
    requiredWater: 10,
    extinguishChance: 0,
    startedTick: 0,
    discoveredTick: 0,
    lastWaterTick: 0,
    resolvedTick: 0,
    responseWellId: null,
  };
}

function emptyGameState(): GameState {
  return {
    stockpile: { firewood: 0 },
    buildings: new Map(),
    residences: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
  } as GameState;
}
