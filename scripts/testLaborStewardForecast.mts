import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { computeSettlementLaborStewardForecast } from '../src/economy/laborStewardForecast.ts';
import {
  DEFAULT_LABOR_STEWARD_RESERVE,
  laborStewardReserveLabel,
  LABOR_STEWARD_RESERVE_OPTIONS,
  normalizeLaborStewardReserve,
} from '../src/economy/laborSteward.ts';
import {
  BUILDING_DEFINITIONS,
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_SECONDS_PER_DAY,
  SIM_TICK_SECONDS,
  type BuildingKind,
} from '../src/generated/gameBalance.ts';
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

const allPolicies = {
  seasonalEnabled: true,
  productionEnabled: true,
  constructionEnabled: true,
};

assert.equal(DEFAULT_LABOR_STEWARD_RESERVE, 0);
assert.deepEqual(LABOR_STEWARD_RESERVE_OPTIONS, [0, 1, 2, 4, 6]);
assert.equal(normalizeLaborStewardReserve(4), 4);
assert.equal(normalizeLaborStewardReserve(3), 0);
assert.equal(normalizeLaborStewardReserve(Number.NaN), 0);
assert.match(laborStewardReserveLabel(2), /2 villagers held/);

const chainState = emptyGameState();
const winterForager = building('forager', 'foragers_shed', 2);
const suppliedMill = building('mill', 'windmill', 0);
suppliedMill.ryeGrain = 20;
const readyConstruction = constructionSite('construction');
for (const site of [winterForager, suppliedMill, readyConstruction]) {
  chainState.buildings.set(site.id, site);
}

const chainForecast = computeSettlementLaborStewardForecast(
  chainState,
  1,
  0,
  allPolicies,
);
assert.equal(chainForecast.enabledStages, 3);
assert.equal(chainForecast.seasonal?.recalledWorkers, 2);
assert.equal(chainForecast.seasonal?.calledWorkers, 0);
assert.equal(chainForecast.production?.availableLaborBefore, 2);
assert.equal(chainForecast.production?.calledWorkers, 2);
assert.equal(chainForecast.construction?.availableLaborBefore, 0);
assert.equal(chainForecast.construction?.calledWorkers, 0);
assert.equal(chainForecast.availableLaborAfter, 0);
assert.equal(chainForecast.firstChangedBuildingId, winterForager.id);
assert.equal(
  chainForecast.production?.callup.assignments[0]?.buildingId,
  suppliedMill.id,
);
assert.equal(
  chainState.buildings.get(winterForager.id)?.assignedLabor,
  2,
  'the forecast must not mutate synchronized buildings',
);

const constructionClaimsReleasedLabor = computeSettlementLaborStewardForecast(
  chainState,
  1,
  0,
  {
    seasonalEnabled: true,
    productionEnabled: false,
    constructionEnabled: true,
  },
);
assert.equal(constructionClaimsReleasedLabor.seasonal?.recalledWorkers, 2);
assert.equal(constructionClaimsReleasedLabor.production, null);
assert.equal(constructionClaimsReleasedLabor.construction?.calledWorkers, 2);
assert.equal(
  constructionClaimsReleasedLabor.construction?.plan.assignments.find(
    (assignment) => assignment.buildingId === readyConstruction.id,
  )?.targetLabor,
  2,
);
assert.equal(constructionClaimsReleasedLabor.availableLaborAfter, 0);

const reservedChainForecast = computeSettlementLaborStewardForecast(
  chainState,
  1,
  0,
  allPolicies,
  1,
);
assert.equal(reservedChainForecast.laborReserve, 1);
assert.equal(reservedChainForecast.seasonal?.recalledWorkers, 2);
assert.equal(reservedChainForecast.production?.calledWorkers, 1);
assert.equal(reservedChainForecast.construction?.calledWorkers, 0);
assert.equal(reservedChainForecast.availableLaborAfter, 1);

const seasonalFirstState = emptyGameState();
const activeForager = building('active-forager', 'foragers_shed', 0);
const waitingMill = building('waiting-mill', 'windmill', 0);
waitingMill.ryeGrain = 20;
seasonalFirstState.buildings.set(activeForager.id, activeForager);
seasonalFirstState.buildings.set(waitingMill.id, waitingMill);
const seasonalFirst = computeSettlementLaborStewardForecast(
  seasonalFirstState,
  4,
  3,
  {
    seasonalEnabled: true,
    productionEnabled: true,
    constructionEnabled: false,
  },
);
assert.equal(seasonalFirst.seasonal?.calledWorkers, 2);
assert.equal(seasonalFirst.production?.availableLaborBefore, 1);
assert.equal(seasonalFirst.production?.calledWorkers, 1);
assert.equal(seasonalFirst.availableLaborAfter, 0);

const seasonalFirstWithReserve = computeSettlementLaborStewardForecast(
  seasonalFirstState,
  4,
  3,
  {
    seasonalEnabled: true,
    productionEnabled: true,
    constructionEnabled: false,
  },
  1,
);
assert.equal(seasonalFirstWithReserve.seasonal?.calledWorkers, 2);
assert.equal(seasonalFirstWithReserve.production?.calledWorkers, 0);
assert.equal(seasonalFirstWithReserve.availableLaborAfter, 1);

const monthBoundaryState = emptyGameState();
const emptyApiary = building('apiary', 'apiary', 0);
const dormantFarm = building('dormant-farm', 'threshing_barn', 2);
monthBoundaryState.buildings.set(emptyApiary.id, emptyApiary);
monthBoundaryState.buildings.set(dormantFarm.id, dormantFarm);
const marchSnapshot = computeSettlementLaborStewardForecast(
  monthBoundaryState,
  3,
  2,
  {
    seasonalEnabled: true,
    productionEnabled: false,
    constructionEnabled: false,
  },
);
const aprilReview = computeSettlementLaborStewardForecast(
  monthBoundaryState,
  4,
  2,
  {
    seasonalEnabled: true,
    productionEnabled: false,
    constructionEnabled: false,
  },
);
assert.equal(marchSnapshot.seasonal?.calledWorkers, 0);
assert.equal(aprilReview.seasonal?.recalledWorkers, 2);
assert.equal(aprilReview.seasonal?.calledWorkers, 1);
assert.equal(aprilReview.seasonal?.callup.assignments[0]?.buildingId, emptyApiary.id);
assert.equal(aprilReview.availableLaborAfter, 3);

const disabledForecast = computeSettlementLaborStewardForecast(
  chainState,
  1,
  4,
  {
    seasonalEnabled: false,
    productionEnabled: false,
    constructionEnabled: false,
  },
);
assert.equal(disabledForecast.enabledStages, 0);
assert.equal(disabledForecast.availableLaborBefore, 4);
assert.equal(disabledForecast.availableLaborAfter, 4);
assert.equal(disabledForecast.firstChangedBuildingId, null);

const renderedState = emptyGameState();
renderedState.tick = Math.round(
  (CALENDAR_DAYS_PER_MONTH - 1) * CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS,
);
const townHall = building('hall', 'town_hall', 1);
const aprilApiary = building('apiary', 'apiary', 0);
const aprilDormantFarm = building('dormant-farm', 'threshing_barn', 2);
const aprilMill = building('mill', 'windmill', 0);
aprilMill.ryeGrain = 20;
const aprilConstruction = constructionSite('construction');
for (const site of [
  townHall,
  aprilApiary,
  aprilDormantFarm,
  aprilMill,
  aprilConstruction,
]) {
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
    getSeasonalLaborStewardEnabled: () => true,
    getProductionLaborStewardEnabled: () => true,
    getConstructionLaborStewardEnabled: () => true,
    getLaborStewardReserve: () => 1,
  },
);
assert.match(inspector.detailsHtml, /Dawn labor review/);
assert.match(
  inspector.detailsHtml,
  /Next dawn: seasonal release 2\/deploy 1.*production deploy 3.*construction deploy 4.*1 idle after review.*5 workplace-ready.*1 held in reserve/,
);
assert.match(
  inspector.detailsHtml,
  /data-inspect-building="dormant-farm" aria-label="Inspect first dawn labor steward crew change"/,
);
assert.match(inspector.detailsHtml, /Steward reserve.*1 villager held for explicit orders/);
assert.match(
  inspector.supplementalPanelHtml ?? '',
  /data-policy-labor-steward-reserve[^>]*>[\s\S]*value="1" selected/,
);
assert.match(
  inspector.supplementalPanelHtml ?? '',
  /Manual call-ups can still use the reserve/,
);

const perfState = emptyGameState();
for (let index = 0; index < 50_000; index += 1) {
  const forager = building(`forager-${index}`, 'foragers_shed', 2);
  perfState.buildings.set(forager.id, forager);
}
for (let index = 0; index < 20_000; index += 1) {
  const mill = building(`mill-${index}`, 'windmill', 0);
  mill.ryeGrain = 20;
  perfState.buildings.set(mill.id, mill);
}
for (let index = 0; index < 30_000; index += 1) {
  const site = constructionSite(`construction-${index}`);
  perfState.buildings.set(site.id, site);
}
const started = performance.now();
const perfForecast = computeSettlementLaborStewardForecast(
  perfState,
  1,
  0,
  allPolicies,
);
const elapsedMs = performance.now() - started;
assert.equal(perfForecast.totalRecalledWorkers, 100_000);
assert.equal(perfForecast.production?.calledWorkers, 60_000);
assert.equal(perfForecast.construction?.calledWorkers, 40_000);
assert.equal(perfForecast.totalCalledWorkers, 100_000);
assert.equal(perfForecast.availableLaborAfter, 0);
assert.ok(
  elapsedMs < 2_000,
  `100,000-site sequential dawn steward forecast took ${elapsedMs.toFixed(1)} ms`,
);

const townHallSource = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
const simulationSource = readFileSync(
  new URL('../server/src/reducers/simulation.rs', import.meta.url),
  'utf8',
);
const playerResourcesSource = readFileSync(
  new URL('../server/src/tables.rs', import.meta.url),
  'utf8',
);
const villageAdminSource = readFileSync(
  new URL('../server/src/reducers/village_admin.rs', import.meta.url),
  'utf8',
);
const clientReducersSource = readFileSync(
  new URL('../src/data/spacetimeReducers.ts', import.meta.url),
  'utf8',
);
const generatedPlayerResourcesSource = readFileSync(
  new URL('../src/generated/player_resources_table.ts', import.meta.url),
  'utf8',
);
const generatedReserveReducerSource = readFileSync(
  new URL('../src/generated/set_labor_steward_reserve_reducer.ts', import.meta.url),
  'utf8',
);
assert.match(townHallSource, /computeSettlementLaborStewardForecast/);
assert.match(townHallSource, /environmentOutlook\.clock\.month/);
assert.match(townHallSource, /Dawn labor review/);
assert.match(townHallSource, /data-policy-labor-steward-reserve/);
assert.match(playerResourcesSource, /pub labor_steward_reserve: u32/);
assert.match(villageAdminSource, /pub fn set_labor_steward_reserve/);
assert.match(clientReducersSource, /setLaborStewardReserve/);
assert.match(generatedPlayerResourcesSource, /laborStewardReserve: __t\.u32/);
assert.match(generatedReserveReducerSource, /laborReserve: __t\.u32/);
assert.match(
  simulationSource,
  /step_seasonal_labor_stewards[\s\S]*step_production_labor_stewards[\s\S]*step_construction_labor_stewards/,
);

console.log(
  `sequential labor steward forecast tests passed (100,000 sites: ${elapsedMs.toFixed(1)} ms)`,
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
    stableOxen: new Map(),
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
    workRadius: 48,
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

function constructionSite(id: string): BuildingState {
  const site = building(id, 'carpenter', 0);
  site.constructionComplete = false;
  site.constructionProgress = 0;
  site.constructionRequiredTimber = 10;
  site.constructionDeliveredTimber = 10;
  site.constructionPriority = 3;
  return site;
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
