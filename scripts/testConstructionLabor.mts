import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  applyConstructionLaborRotation,
  computeSettlementConstructionLaborPlan,
  constructionLaborReady,
} from '../src/economy/constructionLabor.ts';
import {
  constructionLaborStewardStatus,
  DEFAULT_CONSTRUCTION_LABOR_STEWARD_ENABLED,
} from '../src/economy/laborSteward.ts';
import { BUILDING_DEFINITIONS, type BuildingKind } from '../src/generated/gameBalance.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import {
  computePopulationStats,
  computeResourceTotals,
} from '../src/resources/resourceTotals.ts';
import { renderTownHallInspector } from '../src/resources/inspector/townHallRenderer.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type GameState,
} from '../src/resources/types.ts';
import type { WorldQueries } from '../src/resources/WorldQueries.ts';

const readinessSite = building('ready', 'chapel', 0, false);
readinessSite.constructionRequiredTimber = 20;
readinessSite.constructionRequiredStone = 10;
readinessSite.constructionDeliveredTimber = 15;
readinessSite.constructionProgress = 0.25;
assert.equal(constructionLaborReady(readinessSite), true);
readinessSite.constructionProgress = 0.5;
assert.equal(constructionLaborReady(readinessSite), false);
readinessSite.constructionTreasuryStone = 5;
assert.equal(constructionLaborReady(readinessSite), true);
readinessSite.constructionTreasuryStone = Number.NaN;
readinessSite.constructionRequiredStone = Number.NaN;
readinessSite.constructionDeliveredTimber = Number.NaN;
assert.equal(constructionLaborReady(readinessSite), false);

const state = emptyGameState();
const urgentReadyA = readySite('10', 3, 0);
const urgentReadyB = readySite('20', 3, 0);
const inboundWaiting = blockedSite('30', 2, 2);
const blocked = blockedSite('40', 1, 2);
const foundersReserve = blockedSite('50', 2, 0);
foundersReserve.constructionTreasuryTimber = 10;
const held = blockedSite('60', 0, 3);
const complete = building('70', 'chapel', 3, true);
for (const site of [
  urgentReadyA,
  urgentReadyB,
  inboundWaiting,
  blocked,
  foundersReserve,
  held,
  complete,
]) {
  state.buildings.set(site.id, site);
}
state.deliveryTrips.set('cart', trip('cart', 'source', inboundWaiting.id));

const plan = computeSettlementConstructionLaborPlan(state, 1);
assert.equal(plan.activeSites, 5);
assert.equal(plan.workReadySites, 3);
assert.equal(plan.inboundWaitingSites, 1);
assert.equal(plan.blockedSites, 1);
assert.equal(plan.blockedStaffedSites, 1);
assert.equal(plan.readyOpenPosts, 12);
assert.equal(plan.recalledWorkers, 2);
assert.equal(plan.calledWorkers, 3);
assert.equal(plan.remainingReadyPosts, 9);
assert.equal(plan.freeLaborBefore, 1);
assert.equal(plan.freeLaborAfter, 0);
assert.equal(plan.firstBlockedBuildingId, blocked.id);
assert.equal(plan.firstReadyUnderstaffedBuildingId, urgentReadyA.id);
assert.deepEqual(
  plan.assignments.map((assignment) => [
    assignment.buildingId,
    assignment.targetLabor,
  ]),
  [
    [blocked.id, 0],
    [urgentReadyA.id, 2],
    [urgentReadyB.id, 1],
  ],
  'recalled labor and the existing free worker should round-robin across urgent ready sites',
);

const rotated = applyConstructionLaborRotation(state.buildings, plan);
assert.equal(rotated.get(blocked.id)?.assignedLabor, 0);
assert.equal(rotated.get(urgentReadyA.id)?.assignedLabor, 2);
assert.equal(rotated.get(urgentReadyB.id)?.assignedLabor, 1);
assert.equal(rotated.get(inboundWaiting.id)?.assignedLabor, 2);
assert.equal(rotated.get(foundersReserve.id)?.assignedLabor, 0);
assert.equal(rotated.get(held.id)?.assignedLabor, 3);
assert.equal(state.buildings.get(blocked.id)?.assignedLabor, 2);
assert.equal(DEFAULT_CONSTRUCTION_LABOR_STEWARD_ENABLED, false);
assert.match(constructionLaborStewardStatus(false, true), /Manual/);
assert.match(constructionLaborStewardStatus(true, true), /Daily/);
assert.match(constructionLaborStewardStatus(true, false), /paused/);

const renderedState = emptyGameState();
const townHall = building('hall', 'town_hall', 1, true);
const renderedBlocked = blockedSite('blocked-site', 1, 2);
const renderedUrgentA = readySite('urgent-a', 3, 0);
const renderedUrgentB = readySite('urgent-b', 3, 0);
for (const site of [townHall, renderedBlocked, renderedUrgentA, renderedUrgentB]) {
  renderedState.buildings.set(site.id, site);
}
const inspector = renderTownHallInspector(
  {
    kind: 'building',
    building: townHall,
    matureTrees: 0,
    stumpTrees: 0,
    growingTrees: 0,
  },
  {
    gameState: renderedState,
    worldQueries: worldQueries(),
    populationStats: computePopulationStats(renderedState),
    resourceTotals: computeResourceTotals(renderedState),
    worldHydrology: 0.5,
  },
);
assert.match(inspector.detailsHtml, /Construction crews/);
assert.match(inspector.detailsHtml, /Construction steward<\/span><span>Manual/);
assert.match(inspector.detailsHtml, /2 blocked builders can be released/);
assert.match(inspector.detailsHtml, /4 workers can move to ready sites/);
assert.match(inspector.detailsHtml, /data-inspect-building="blocked-site"/);
assert.match(inspector.supplementalPanelHtml ?? '', /data-rotate-construction-labor/);
assert.match(inspector.supplementalPanelHtml ?? '', /Rotate 2 blocked → 4 ready/);
assert.match(inspector.supplementalPanelHtml ?? '', /crews awaiting inbound material stay in place/);
assert.match(inspector.supplementalPanelHtml ?? '', /sharing workers round-robin within each tier/);
assert.match(
  inspector.supplementalPanelHtml ?? '',
  /data-policy-construction-labor-steward/,
);
assert.doesNotMatch(
  inspector.supplementalPanelHtml ?? '',
  /data-policy-construction-labor-steward[^>]*checked/,
);

const stewardInspector = renderTownHallInspector(
  {
    kind: 'building',
    building: townHall,
    matureTrees: 0,
    stumpTrees: 0,
    growingTrees: 0,
  },
  {
    gameState: renderedState,
    worldQueries: worldQueries(),
    populationStats: computePopulationStats(renderedState),
    resourceTotals: computeResourceTotals(renderedState),
    worldHydrology: 0.5,
    getConstructionLaborStewardEnabled: () => true,
  },
);
assert.match(stewardInspector.detailsHtml, /Construction steward<\/span><span>Daily/);
assert.match(
  stewardInspector.supplementalPanelHtml ?? '',
  /data-policy-construction-labor-steward[^>]*checked/,
);
assert.match(
  stewardInspector.supplementalPanelHtml ?? '',
  /active seasonal work is reviewed first/,
);
assert.match(
  stewardInspector.supplementalPanelHtml ?? '',
  /daily steward repeats this safe rotation automatically/,
);

const perfState = emptyGameState();
for (let index = 0; index < 100_000; index += 1) {
  const site = index % 2 === 0
    ? blockedSite(String(index), index % 3 + 1, 4)
    : readySite(String(index), index % 3 + 1, 0);
  perfState.buildings.set(site.id, site);
}
const started = performance.now();
const perfPlan = computeSettlementConstructionLaborPlan(perfState, 0);
const elapsedMs = performance.now() - started;
assert.equal(perfPlan.recalledWorkers, 200_000);
assert.equal(perfPlan.calledWorkers, 200_000);
assert.equal(perfPlan.assignments.length, 100_000);
assert.ok(
  elapsedMs < 400,
  `100,000-site construction rotation took ${elapsedMs.toFixed(1)} ms`,
);

const serverReducer = readFileSync(
  new URL('../server/src/reducers/buildings.rs', import.meta.url),
  'utf8',
);
const resourceInspector = readFileSync(
  new URL('../src/resources/ResourceInspector.ts', import.meta.url),
  'utf8',
);
const serverSteward = readFileSync(
  new URL('../server/src/simulation/construction_labor_steward.rs', import.meta.url),
  'utf8',
);
const serverSimulation = readFileSync(
  new URL('../server/src/reducers/simulation.rs', import.meta.url),
  'utf8',
);
const serverVillageAdmin = readFileSync(
  new URL('../server/src/reducers/village_admin.rs', import.meta.url),
  'utf8',
);
const serverTables = readFileSync(
  new URL('../server/src/tables.rs', import.meta.url),
  'utf8',
);
const spacetimeReducers = readFileSync(
  new URL('../src/data/spacetimeReducers.ts', import.meta.url),
  'utf8',
);
const generatedReducers = readFileSync(
  new URL('../src/generated/index.ts', import.meta.url),
  'utf8',
);
const generatedPlayerResources = readFileSync(
  new URL('../src/generated/player_resources_table.ts', import.meta.url),
  'utf8',
);
const generatedConstructionSteward = readFileSync(
  new URL('../src/generated/set_construction_labor_steward_reducer.ts', import.meta.url),
  'utf8',
);
assert.match(serverReducer, /pub fn rotate_construction_labor/);
assert.match(serverReducer, /pub\(crate\) fn rotate_construction_labor_for_owner/);
assert.match(serverReducer, /A staffed Town Hall is required/);
assert.match(serverReducer, /building_has_inbound_supply_trip/);
assert.match(serverSteward, /if !seasonal_labor_steward_review_due\(sim_tick\)[\s\S]*return/);
assert.match(serverSteward, /resources\.construction_labor_steward_enabled/);
assert.match(serverSteward, /rotate_construction_labor_for_owner/);
assert.match(
  serverSimulation,
  /step_seasonal_labor_stewards\(ctx, sim_tick, clock\.month\);[\s\S]*step_construction_labor_stewards\(ctx, sim_tick\)/,
);
assert.match(serverVillageAdmin, /pub fn set_construction_labor_steward/);
assert.match(
  serverVillageAdmin,
  /if enabled \{[\s\S]*rotate_construction_labor_for_owner\(ctx, owner\)/,
);
assert.match(
  serverTables,
  /pub seasonal_labor_steward_enabled: bool,[\s\S]*#\[default\(false\)\][\s\S]*pub construction_labor_steward_enabled: bool/,
);
assert.match(resourceInspector, /data-rotate-construction-labor/);
assert.match(resourceInspector, /data-policy-construction-labor-steward/);
assert.match(spacetimeReducers, /rotateConstructionLabor/);
assert.match(spacetimeReducers, /setConstructionLaborSteward/);
assert.match(generatedReducers, /rotate_construction_labor/);
assert.match(generatedReducers, /set_construction_labor_steward/);
assert.match(generatedPlayerResources, /constructionLaborStewardEnabled: __t\.bool/);
assert.match(generatedConstructionSteward, /enabled: __t\.bool/);

console.log(
  `construction labor rotation tests passed (100,000 sites: ${elapsedMs.toFixed(1)} ms)`,
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

function readySite(id: string, priority: number, assignedLabor: number): BuildingState {
  const site = blockedSite(id, priority, assignedLabor);
  site.constructionDeliveredTimber = 20;
  return site;
}

function blockedSite(id: string, priority: number, assignedLabor: number): BuildingState {
  const site = building(id, 'chapel', assignedLabor, false);
  site.constructionRequiredTimber = 40;
  site.constructionProgress = 0;
  site.constructionPriority = priority;
  return site;
}

function building(
  id: string,
  kind: BuildingKind,
  assignedLabor: number,
  constructionComplete: boolean,
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
    constructionComplete,
    constructionProgress: constructionComplete ? 1 : 0,
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
    constructionPriority: 2,
  };
}

function trip(
  id: string,
  buildingId: string,
  targetBuildingId: string,
): DeliveryTripState {
  return {
    id,
    buildingId,
    residenceId: null,
    destinationKind: 'building',
    targetBuildingId,
    cargoKind: 'timber',
    amount: 1,
    phase: 'outbound',
    x: 0,
    z: 0,
    progress: 0,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 1,
    deliveryWorkers: 1,
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
