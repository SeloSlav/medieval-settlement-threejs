import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  applyWorksiteStallRecall,
  computeSettlementWorksiteStallPlan,
} from '../src/economy/settlementWorksiteStalls.ts';
import {
  BUILDING_DEFINITIONS,
  type BuildingKind,
} from '../src/generated/gameBalance.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import {
  computePopulationStats,
  computeResourceTotals,
} from '../src/resources/resourceTotals.ts';
import { renderTownHallInspector } from '../src/resources/inspector/townHallRenderer.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type ForagingNodeState,
  type GameState,
  type ResourceNodeState,
} from '../src/resources/types.ts';
import type { WorldQueries } from '../src/resources/WorldQueries.ts';

const state = emptyGameState();

const cappedBrewery = building('10', 'brewery', 3, 0, 0);
cappedBrewery.processorOutputTargetPercent = 25;
cappedBrewery.ale = 50;
const starvedWeaver = building('20', 'weaver', 2, 20, 0);
starvedWeaver.constructionPriority = 3;
const partialMill = building('30', 'watermill', 1, 40, 0);
partialMill.grain = 0.1;
const suppliedMill = building('40', 'watermill', 2, 60, 0);
const fullQuarry = building('50', 'stone_quarry', 4, 100, 0);
fullQuarry.stone = 180;
fullQuarry.workRadius = 80;
const exhaustedQuarry = building('60', 'stone_quarry', 3, 0, 0);
exhaustedQuarry.workRadius = 20;
const workingQuarry = building('70', 'stone_quarry', 2, 200, 0);
workingQuarry.workRadius = 20;
const misplacedLargeQuarry = building('80', 'large_quarry', 6, 1_000, 0);
const reserveHunter = building('90', 'hunters_hall', 3, 300, 0);
reserveHunter.workRadius = 68;
reserveHunter.harvestReservePercent = 50;
reserveHunter.food = 1;
const workingHunter = building('100', 'hunters_hall', 2, 500, 0);
workingHunter.workRadius = 68;
workingHunter.harvestReservePercent = 50;
const winterFishingCamp = building('110', 'fishing_camp', 3, 700, 0);
winterFishingCamp.workRadius = 64;

for (const site of [
  cappedBrewery,
  starvedWeaver,
  partialMill,
  suppliedMill,
  fullQuarry,
  exhaustedQuarry,
  workingQuarry,
  misplacedLargeQuarry,
  reserveHunter,
  workingHunter,
  winterFishingCamp,
]) {
  state.buildings.set(site.id, site);
}

state.deliveryTrips.set(
  'grain-inbound',
  trip('grain-inbound', 'granary-source', suppliedMill.id, 'grain'),
);
state.deliveryTrips.set(
  'stone-outbound',
  trip('stone-outbound', fullQuarry.id, 'construction-site', 'stone'),
);
state.quarries.set(
  'exhausted-stone',
  quarry('exhausted-stone', 0, 0, 0),
);
state.quarries.set(
  'working-stone',
  quarry('working-stone', 200, 0, 50),
);
state.foragingNodes.set(
  'protected-game',
  wildStock('protected-game', 'game', 300, 0, 50, 100),
);
state.foragingNodes.set(
  'healthy-game',
  wildStock('healthy-game', 'game', 500, 0, 80, 100),
);

const winterPlan = computeSettlementWorksiteStallPlan(state, 1);
assert.equal(winterPlan.auditedSites, 10);
assert.equal(winterPlan.stalledSites, 6);
assert.equal(winterPlan.stalledWorkers, 20);
assert.equal(winterPlan.inputStalledSites, 1);
assert.equal(winterPlan.outputStalledSites, 2);
assert.equal(winterPlan.sourceStalledSites, 2);
assert.equal(winterPlan.reserveStalledSites, 1);
assert.equal(winterPlan.dispatchDutySites, 3);
assert.equal(winterPlan.reclaimableSites, 6);
assert.equal(winterPlan.reclaimableWorkers, 18);
assert.equal(winterPlan.retainedDispatchers, 3);
assert.equal(winterPlan.supplyEnRouteSites, 1);
assert.equal(winterPlan.supplyEnRouteWorkers, 2);
assert.equal(winterPlan.firstReclaimableBuildingId, starvedWeaver.id);
assert.equal(winterPlan.firstAttention?.buildingId, starvedWeaver.id);
assert.equal(winterPlan.firstAttention?.detail, 'no wool on site');
assert.equal(
  winterPlan.sites.find((site) => site.buildingId === reserveHunter.id)?.assignedWorkers,
  2,
  'the hunting tally should count the processing crew rather than double-counting its dispatcher',
);
assert.equal(
  winterPlan.sites.some((site) => site.buildingId === partialMill.id),
  false,
  'a fractional input can still produce the authoritative partial batch',
);
assert.equal(
  winterPlan.sites.some((site) => site.buildingId === winterFishingCamp.id),
  false,
  'the seasonal labor ledger, not the production-stall ledger, owns frozen fishing camps',
);
assert.equal(
  winterPlan.sites.find((site) => site.buildingId === fullQuarry.id)?.targetLabor,
  1,
  'a quarry cart already on the road should retain one dispatcher',
);
const recalled = applyWorksiteStallRecall(state.buildings, winterPlan);
assert.equal(recalled.get(cappedBrewery.id)?.assignedLabor, 1);
assert.equal(recalled.get(starvedWeaver.id)?.assignedLabor, 0);
assert.equal(recalled.get(fullQuarry.id)?.assignedLabor, 1);
assert.equal(recalled.get(exhaustedQuarry.id)?.assignedLabor, 0);
assert.equal(recalled.get(misplacedLargeQuarry.id)?.assignedLabor, 0);
assert.equal(recalled.get(reserveHunter.id)?.assignedLabor, 1);
assert.equal(recalled.get(suppliedMill.id)?.assignedLabor, 2);
assert.equal(state.buildings.get(fullQuarry.id)?.assignedLabor, 4);

const summerPlan = computeSettlementWorksiteStallPlan(state, 7);
assert.equal(summerPlan.auditedSites, 11);
assert.equal(summerPlan.stalledSites, 7);
assert.equal(summerPlan.sourceStalledSites, 3);
assert.equal(
  summerPlan.sites.find((site) => site.buildingId === winterFishingCamp.id)?.detail,
  'no fish population lies within the work area',
);

const townHallState = emptyGameState();
const townHall = building('hall', 'town_hall', 1, 0, 0);
const townHallWeaver = building('20', 'weaver', 2, 20, 0);
townHallWeaver.constructionPriority = 3;
townHallState.buildings.set(townHall.id, townHall);
townHallState.buildings.set(townHallWeaver.id, townHallWeaver);
const inspector = renderTownHallInspector(
  {
    kind: 'building',
    building: townHall,
    matureTrees: 0,
    stumpTrees: 0,
    growingTrees: 0,
  },
  {
    gameState: townHallState,
    worldQueries: worldQueries(),
    populationStats: computePopulationStats(townHallState),
    resourceTotals: computeResourceTotals(townHallState),
    worldHydrology: 0.5,
  },
);
assert.match(inspector.detailsHtml, /Production stalls/);
assert.match(inspector.detailsHtml, /2 production workers are stalled across 1 site/);
assert.match(inspector.detailsHtml, /2 safely recallable/);
assert.match(inspector.detailsHtml, /first Weaver's workshop: no wool on site/);
assert.match(inspector.detailsHtml, /data-inspect-building="20"/);
assert.match(
  inspector.supplementalPanelHtml ?? '',
  /Recall 2 stalled production workers/,
);
assert.match(
  inspector.supplementalPanelHtml ?? '',
  /Matching inbound supplies protect recovering workshops/,
);

const perfState = emptyGameState();
for (let index = 0; index < 100_000; index += 1) {
  const mill = building(String(index), 'watermill', 2, index * 2, 0);
  perfState.buildings.set(mill.id, mill);
}
const started = performance.now();
const perfPlan = computeSettlementWorksiteStallPlan(perfState, 1);
const elapsedMs = performance.now() - started;
assert.equal(perfPlan.stalledSites, 100_000);
assert.equal(perfPlan.stalledWorkers, 200_000);
assert.equal(perfPlan.reclaimableWorkers, 200_000);
assert.ok(
  elapsedMs < 750,
  `100,000-site worksite stall audit took ${elapsedMs.toFixed(1)} ms`,
);

const spatialPerfState = emptyGameState();
for (let index = 0; index < 20_000; index += 1) {
  const x = index * 200;
  const hunter = building(`hunter-${index}`, 'hunters_hall', 2, x, 0);
  hunter.workRadius = 68;
  hunter.harvestReservePercent = 50;
  spatialPerfState.buildings.set(hunter.id, hunter);
  const node = wildStock(`game-${index}`, 'game', x, 0, 80, 100);
  spatialPerfState.foragingNodes.set(node.nodeId, node);
}
const spatialStarted = performance.now();
const spatialPerfPlan = computeSettlementWorksiteStallPlan(spatialPerfState, 1);
const spatialElapsedMs = performance.now() - spatialStarted;
assert.equal(spatialPerfPlan.stalledSites, 0);
assert.ok(
  spatialElapsedMs < 750,
  `20,000 spatial source checks took ${spatialElapsedMs.toFixed(1)} ms`,
);

const expandedEconomy = readFileSync(
  new URL('../server/src/simulation/expanded_economy.rs', import.meta.url),
  'utf8',
);
const stoneQuarrySimulation = readFileSync(
  new URL('../server/src/simulation/stone_quarry.rs', import.meta.url),
  'utf8',
);
const largeQuarrySimulation = readFileSync(
  new URL('../server/src/simulation/large_quarry.rs', import.meta.url),
  'utf8',
);
const foodSupplierSimulation = readFileSync(
  new URL('../server/src/simulation/food_supplier.rs', import.meta.url),
  'utf8',
);
const serverReducer = readFileSync(
  new URL('../server/src/reducers/buildings.rs', import.meta.url),
  'utf8',
);
const deliveryTrips = readFileSync(
  new URL('../server/src/simulation/delivery_trips.rs', import.meta.url),
  'utf8',
);
const serverPolicy = readFileSync(
  new URL('../server/src/worksite_stall_policy.rs', import.meta.url),
  'utf8',
);
assert.match(expandedEconomy, /building_commodity_stock\(building, \*kind\) \/ amount/);
assert.match(expandedEconomy, /processor_output_headroom/);
assert.match(stoneQuarrySimulation, /building\.stone >= caps\.stone - 1e-6/);
assert.match(stoneQuarrySimulation, /find_nearest_quarry/);
assert.match(largeQuarrySimulation, /RICH_DEPOSIT_CENTER_TOLERANCE: f64 = 2\.5/);
assert.match(foodSupplierSimulation, /building\.food >= food_cap - 1e-6/);
assert.match(foodSupplierSimulation, /find_nearest_harvestable_foraging_node/);
assert.match(serverReducer, /stalled_labor_target/);
assert.match(serverReducer, /SpatialBuckets::<Quarry>::new/);
assert.match(serverReducer, /harvestable_wild_stock/);
assert.match(deliveryTrips, /building_has_inbound_commodity_trip/);
assert.match(serverPolicy, /supply_en_route/);

console.log(
  `worksite stall ledger tests passed (100,000 staffed sites: ${elapsedMs.toFixed(1)} ms; 20,000 spatial sources: ${spatialElapsedMs.toFixed(1)} ms)`,
);

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: createEmptyStockpile(),
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}

function building(
  id: string,
  kind: BuildingKind,
  assignedLabor: number,
  x: number,
  z: number,
): BuildingState {
  return {
    id,
    kind,
    x,
    z,
    workRadius: BUILDING_DEFINITIONS[kind].workRadius,
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
    wool: 0,
    cloth: 0,
    ironwork: 0,
    polearms: 0,
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
    processorOutputTargetPercent: 100,
    constructionPriority: 2,
  };
}

function quarry(
  nodeId: string,
  x: number,
  z: number,
  remaining: number,
): ResourceNodeState {
  return {
    nodeId,
    kind: 'quarry',
    resource: 'stone',
    x,
    z,
    remaining,
    maxYield: 50,
  };
}

function wildStock(
  nodeId: string,
  kind: 'game' | 'fish',
  x: number,
  z: number,
  remaining: number,
  maxYield: number,
): ForagingNodeState {
  return {
    nodeId,
    kind,
    resource: kind,
    x,
    z,
    remaining,
    maxYield,
  };
}

function trip(
  id: string,
  buildingId: string,
  targetBuildingId: string,
  cargoKind: DeliveryTripState['cargoKind'],
): DeliveryTripState {
  return {
    id,
    buildingId,
    residenceId: null,
    destinationKind: 'building',
    targetBuildingId,
    cargoKind,
    amount: 10,
    phase: 'outbound',
    x: 0,
    z: 0,
    progress: 0,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 1,
    deliveryWorkers: 1,
    freeHaulerWorkers: 0,
    pathDistance: 1,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[]',
  };
}

function worldQueries(): WorldQueries {
  return {
    getBuildingLabel: (kind: BuildingKind) => BUILDING_DEFINITIONS[kind].label,
    getRoadAccessLabel: () => 'Connected',
    hasRoadAccess: () => true,
    getRoadPathDistance: () => null,
    isResidenceConnectedToMarketplace: () => false,
    getServingChapelForResidence: () => null,
    isMonasteryLinkedToChapel: () => false,
    findNearestRoadLinkedBuilding: () => null,
  } as unknown as WorldQueries;
}
