import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  applySeasonalLaborCallup,
  applySeasonalLaborRecall,
  computeSettlementSeasonalCallupPlan,
  computeSettlementSeasonalLaborPlan,
  seasonalLaborTarget,
  seasonalProductionActive,
} from '../src/economy/seasonalLabor.ts';
import {
  DEFAULT_SEASONAL_LABOR_STEWARD_ENABLED,
  seasonalLaborStewardReviewDue,
  seasonalLaborStewardStatus,
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
  type FarmFieldState,
  type GameState,
} from '../src/resources/types.ts';
import type { WorldQueries } from '../src/resources/WorldQueries.ts';

assert.equal(seasonalProductionActive('apiary', 3), false);
assert.equal(seasonalProductionActive('apiary', 4), true);
assert.equal(seasonalProductionActive('vineyard', 9), true);
assert.equal(seasonalProductionActive('vineyard', 11), false);
assert.equal(seasonalProductionActive('fishing_camp', 1), false);
assert.equal(seasonalProductionActive('fishing_camp', 3), true);
assert.equal(seasonalProductionActive('watermill', 1), false);
assert.equal(seasonalProductionActive('watermill', 12), false);
assert.equal(seasonalProductionActive('watermill', 3), true);
assert.equal(seasonalProductionActive('granary', 1), null);
assert.equal(seasonalLaborTarget('apiary', 1, 3, true), 0);
assert.equal(seasonalLaborTarget('apiary', 1, 3, false), 0);
assert.equal(seasonalLaborTarget('apiary', 4, 3, false), 3);
assert.equal(DEFAULT_SEASONAL_LABOR_STEWARD_ENABLED, false);
assert.equal(
  seasonalLaborStewardStatus(false, true),
  'Manual · issue recall and call-up orders when needed',
);
assert.match(seasonalLaborStewardStatus(true, true), /Daily/);
assert.match(seasonalLaborStewardStatus(true, false), /paused/);

const firstStewardReviewTick = Array.from(
  { length: 10_000 },
  (_, tick) => tick,
).find(seasonalLaborStewardReviewDue);
assert.notEqual(firstStewardReviewTick, undefined);
assert.equal(seasonalLaborStewardReviewDue(0), false);
assert.equal(seasonalLaborStewardReviewDue((firstStewardReviewTick ?? 1) - 1), false);
assert.equal(seasonalLaborStewardReviewDue(firstStewardReviewTick ?? 0), true);

const winterState = emptyGameState();
const forager = building('1', 'foragers_shed', 2);
const fishing = building('2', 'fishing_camp', 2);
fishing.food = 10;
const apiary = building('3', 'apiary', 2);
const vineyard = building('4', 'vineyard', 2);
vineyard.wine = 5;
const farmstead = building('5', 'threshing_barn', 4);
const cartApiary = building('6', 'apiary', 1);
const granary = building('7', 'granary', 3);
const watermill = building('8', 'watermill', 2);
for (const site of [forager, fishing, apiary, vineyard, farmstead, cartApiary, granary, watermill]) {
  winterState.buildings.set(site.id, site);
}
winterState.farmFields.set('field', field('field', farmstead.id, 'growing', 'rye'));
winterState.deliveryTrips.set('cart', trip('cart', cartApiary.id));

const winterPlan = computeSettlementSeasonalLaborPlan(winterState, 1);
assert.equal(winterPlan.dormantSites, 7);
assert.equal(winterPlan.reclaimableSites, 7);
assert.equal(winterPlan.reclaimableWorkers, 15);
assert.equal(winterPlan.retainedHaulers, 0);
assert.equal(winterPlan.firstReclaimableBuildingId, forager.id);
assert.deepEqual(
  winterPlan.sites.map((site) => [site.buildingId, site.targetLabor]),
  [
    [forager.id, 0],
    [fishing.id, 0],
    [apiary.id, 0],
    [vineyard.id, 0],
    [farmstead.id, 0],
    [cartApiary.id, 0],
    [watermill.id, 0],
  ],
);

const recalled = applySeasonalLaborRecall(winterState.buildings, winterPlan);
assert.equal(recalled.get(forager.id)?.assignedLabor, 0);
assert.equal(recalled.get(fishing.id)?.assignedLabor, 0);
assert.equal(recalled.get(vineyard.id)?.assignedLabor, 0);
assert.equal(recalled.get(cartApiary.id)?.assignedLabor, 0);
assert.equal(recalled.get(watermill.id)?.assignedLabor, 0);
assert.equal(recalled.get(granary.id)?.assignedLabor, 3);
assert.equal(winterState.buildings.get(forager.id)?.assignedLabor, 2);

const springFarmState = emptyGameState();
const oatFarm = building('farm', 'threshing_barn', 3);
springFarmState.buildings.set(oatFarm.id, oatFarm);
springFarmState.farmFields.set('oats', field('oats', oatFarm.id, 'ploughing', 'oats'));
assert.equal(
  computeSettlementSeasonalLaborPlan(springFarmState, 3).reclaimableWorkers,
  0,
  'spring oats should keep their active field crew',
);

const winterThreshingState = emptyGameState();
const winterThreshingFarm = building('winter-threshing', 'threshing_barn', 4);
winterThreshingFarm.ryeSheaves = 12;
winterThreshingState.buildings.set(winterThreshingFarm.id, winterThreshingFarm);
assert.equal(
  computeSettlementSeasonalLaborPlan(winterThreshingState, 1).reclaimableWorkers,
  0,
  'stored sheaves should keep the winter threshing crew active',
);
winterThreshingFarm.assignedLabor = 0;
const winterThreshingCallup = computeSettlementSeasonalCallupPlan(
  winterThreshingState,
  1,
  2,
);
assert.equal(winterThreshingCallup.callupWorkers, 2);
assert.equal(winterThreshingCallup.assignments[0]?.buildingId, winterThreshingFarm.id);

const callupState = emptyGameState();
const highForager = building('10', 'foragers_shed', 0);
highForager.constructionPriority = 3;
const highFishing = building('20', 'fishing_camp', 0);
highFishing.constructionPriority = 3;
const normalFarm = building('30', 'threshing_barn', 0);
normalFarm.constructionPriority = 2;
const inactiveApiary = building('40', 'apiary', 0);
inactiveApiary.constructionPriority = 3;
for (const site of [highForager, highFishing, normalFarm, inactiveApiary]) {
  callupState.buildings.set(site.id, site);
}
callupState.farmFields.set('spring-oats', field('spring-oats', normalFarm.id, 'ploughing', 'oats'));

const callupPlan = computeSettlementSeasonalCallupPlan(callupState, 3, 3);
assert.equal(callupPlan.activeSites, 3);
assert.equal(callupPlan.understaffedSites, 3);
assert.equal(callupPlan.openPosts, 13);
assert.equal(callupPlan.callupWorkers, 3);
assert.equal(callupPlan.remainingOpenPosts, 10);
assert.equal(callupPlan.firstUnderstaffedBuildingId, highForager.id);
assert.deepEqual(
  callupPlan.assignments.map((assignment) => [
    assignment.buildingId,
    assignment.targetLabor,
  ]),
  [
    [highForager.id, 1],
    [highFishing.id, 1],
    [normalFarm.id, 1],
  ],
  'scarce labor should round-robin in stable worksite order regardless of legacy priority',
);
const calledUp = applySeasonalLaborCallup(callupState.buildings, callupPlan);
assert.equal(calledUp.get(highForager.id)?.assignedLabor, 1);
assert.equal(calledUp.get(highFishing.id)?.assignedLabor, 1);
assert.equal(calledUp.get(normalFarm.id)?.assignedLabor, 1);
assert.equal(calledUp.get(inactiveApiary.id)?.assignedLabor, 0);
assert.equal(callupState.buildings.get(highForager.id)?.assignedLabor, 0);

highForager.assignedLabor = 2;
highFishing.assignedLabor = 3;
normalFarm.constructionPriority = 0;
const legacyPriorityPlan = computeSettlementSeasonalCallupPlan(callupState, 3, 1);
assert.equal(legacyPriorityPlan.assignments[0]?.buildingId, normalFarm.id);
assert.equal(legacyPriorityPlan.assignments[0]?.priority, 2);

const renderedState = emptyGameState();
const townHall = building('hall', 'town_hall', 1);
const dormantApiary = building('apiary', 'apiary', 2);
const activeForager = building('forager', 'foragers_shed', 0);
renderedState.buildings.set(townHall.id, townHall);
renderedState.buildings.set(dormantApiary.id, dormantApiary);
renderedState.buildings.set(activeForager.id, activeForager);
const population = computePopulationStats(renderedState);
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
    populationStats: population,
    resourceTotals: computeResourceTotals(renderedState),
    worldHydrology: 0.5,
  },
);
assert.match(inspector.detailsHtml, /Seasonal labor/);
assert.match(inspector.detailsHtml, /2 idle workers across 1 site/);
assert.match(inspector.detailsHtml, /data-inspect-building="apiary"/);
assert.match(inspector.supplementalPanelHtml ?? '', /data-recall-idle-seasonal-labor/);
assert.match(inspector.supplementalPanelHtml ?? '', /Recall 2 idle workers/);
assert.match(inspector.supplementalPanelHtml ?? '', /must restaff before the next work window/);
assert.match(inspector.detailsHtml, /Seasonal call-up/);
assert.match(inspector.detailsHtml, /2 free workers can fill 2 of 2 active seasonal vacancies/);
assert.match(inspector.detailsHtml, /data-inspect-building="forager"/);
assert.match(inspector.supplementalPanelHtml ?? '', /data-call-up-active-seasonal-labor/);
assert.match(inspector.supplementalPanelHtml ?? '', /Call up 2 seasonal workers/);
assert.match(inspector.supplementalPanelHtml ?? '', /Each site receives one worker in stable worksite order/);
assert.match(inspector.detailsHtml, /Seasonal steward/);
assert.match(inspector.detailsHtml, /Manual/);
assert.match(inspector.supplementalPanelHtml ?? '', /data-policy-seasonal-labor-steward/);
assert.match(inspector.supplementalPanelHtml ?? '', /Manual is the save-compatible default/);

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
    populationStats: population,
    resourceTotals: computeResourceTotals(renderedState),
    worldHydrology: 0.5,
    getSeasonalLaborStewardEnabled: () => true,
  },
);
assert.match(stewardInspector.detailsHtml, /Seasonal steward/);
assert.match(stewardInspector.detailsHtml, /Daily/);
assert.match(
  stewardInspector.supplementalPanelHtml ?? '',
  /data-policy-seasonal-labor-steward\s+checked/,
);
assert.match(
  stewardInspector.supplementalPanelHtml ?? '',
  /The steward will call labor back when work becomes active/,
);

const perfState = emptyGameState();
for (let index = 0; index < 100_000; index += 1) {
  perfState.buildings.set(String(index), building(String(index), 'apiary', 2));
}
const started = performance.now();
const perfPlan = computeSettlementSeasonalLaborPlan(perfState, 1);
const recallElapsedMs = performance.now() - started;
assert.equal(perfPlan.reclaimableWorkers, 200_000);
assert.ok(
  recallElapsedMs < 250,
  `100,000-site seasonal labor recall plan took ${recallElapsedMs.toFixed(1)} ms`,
);
for (const site of perfState.buildings.values()) site.assignedLabor = 0;
const callupStarted = performance.now();
const perfCallupPlan = computeSettlementSeasonalCallupPlan(perfState, 4, 100_000);
const callupElapsedMs = performance.now() - callupStarted;
assert.equal(perfCallupPlan.callupWorkers, 100_000);
assert.ok(
  callupElapsedMs < 250,
  `100,000-site seasonal labor call-up plan took ${callupElapsedMs.toFixed(1)} ms`,
);
const cadenceStarted = performance.now();
let cadenceReviews = 0;
for (let tick = 0; tick < 100_000; tick += 1) {
  if (seasonalLaborStewardReviewDue(tick)) cadenceReviews += 1;
}
const cadenceElapsedMs = performance.now() - cadenceStarted;
assert.ok(cadenceReviews > 0);
assert.ok(
  cadenceElapsedMs < 250,
  `100,000 steward cadence checks took ${cadenceElapsedMs.toFixed(1)} ms`,
);

const serverReducer = readFileSync(
  new URL('../server/src/reducers/buildings.rs', import.meta.url),
  'utf8',
);
const resourceInspector = readFileSync(
  new URL('../src/resources/ResourceInspector.ts', import.meta.url),
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
const serverSteward = readFileSync(
  new URL('../server/src/simulation/seasonal_labor_steward.rs', import.meta.url),
  'utf8',
);
const serverStewardPolicy = readFileSync(
  new URL('../server/src/labor_steward_policy.rs', import.meta.url),
  'utf8',
);
const serverVillageAdmin = readFileSync(
  new URL('../server/src/reducers/village_admin.rs', import.meta.url),
  'utf8',
);
const serverSimulation = readFileSync(
  new URL('../server/src/reducers/simulation.rs', import.meta.url),
  'utf8',
);
const serverTables = readFileSync(
  new URL('../server/src/tables.rs', import.meta.url),
  'utf8',
);
const generatedPlayerResources = readFileSync(
  new URL('../src/generated/player_resources_table.ts', import.meta.url),
  'utf8',
);
const generatedStewardReducer = readFileSync(
  new URL('../src/generated/set_seasonal_labor_steward_reducer.ts', import.meta.url),
  'utf8',
);
assert.match(serverReducer, /pub fn recall_idle_seasonal_labor/);
assert.match(serverReducer, /pub fn call_up_active_seasonal_labor/);
assert.match(serverReducer, /A staffed Town Hall is required/);
assert.match(serverReducer, /building_has_active_trip/);
assert.match(resourceInspector, /data-recall-idle-seasonal-labor/);
assert.match(resourceInspector, /data-call-up-active-seasonal-labor/);
assert.match(spacetimeReducers, /recallIdleSeasonalLabor/);
assert.match(spacetimeReducers, /callUpActiveSeasonalLabor/);
assert.match(generatedReducers, /recall_idle_seasonal_labor/);
assert.match(generatedReducers, /call_up_active_seasonal_labor/);
assert.match(serverSteward, /recall_idle_seasonal_labor_for_owner[\s\S]*call_up_active_seasonal_labor_for_owner/);
assert.match(serverSteward, /if !seasonal_labor_steward_review_due\(sim_tick\)[\s\S]*return/);
assert.match(serverSteward, /resources\.seasonal_labor_steward_enabled/);
assert.match(serverStewardPolicy, /sim_tick == 0[\s\S]*calendar_day\(sim_tick\) > calendar_day\(sim_tick - 1\)/);
assert.match(serverVillageAdmin, /pub fn set_seasonal_labor_steward/);
assert.match(serverVillageAdmin, /if enabled[\s\S]*reconcile_seasonal_labor_for_owner/);
assert.match(serverSimulation, /step_seasonal_labor_stewards\(ctx, sim_tick, clock\.month\)/);
assert.match(
  serverTables,
  /pub cloth: f64,[\s\S]*#\[default\(false\)\][\s\S]*pub seasonal_labor_steward_enabled: bool/,
);
assert.match(generatedPlayerResources, /seasonalLaborStewardEnabled: __t\.bool/);
assert.match(generatedStewardReducer, /enabled: __t\.bool/);
assert.match(resourceInspector, /data-policy-seasonal-labor-steward/);
assert.match(spacetimeReducers, /setSeasonalLaborSteward/);
assert.match(generatedReducers, /set_seasonal_labor_steward/);

console.log(
  `seasonal labor rotation tests passed (100,000 sites: recall ${recallElapsedMs.toFixed(1)} ms, call-up ${callupElapsedMs.toFixed(1)} ms; 100,000 cadence checks ${cadenceElapsedMs.toFixed(1)} ms)`,
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
    constructionPriority: 2,
  };
}

function field(
  id: string,
  farmsteadId: string,
  stage: FarmFieldState['stage'],
  crop: FarmFieldState['crop'],
): FarmFieldState {
  return {
    id,
    farmsteadId,
    corners: [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ],
    area: 100,
    averageSlopeDegrees: 0,
    moisture: 1,
    fertility: 1,
    crop,
    nextCrop: crop,
    stage,
    stageProgress: 0,
    priority: 2,
    harvestCount: 0,
    lastYield: 0,
    currentYield: 0,
  };
}

function trip(id: string, buildingId: string): DeliveryTripState {
  return {
    id,
    buildingId,
    residenceId: null,
    destinationKind: 'building',
    targetBuildingId: 'target',
    cargoKind: 'food',
    amount: 1,
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
    getRoadPathDistance: () => null,
    isResidenceConnectedToMarketplace: () => false,
    getServingChapelForResidence: () => null,
    isMonasteryLinkedToChapel: () => false,
    findNearestRoadLinkedBuilding: () => null,
  } as unknown as WorldQueries;
}
