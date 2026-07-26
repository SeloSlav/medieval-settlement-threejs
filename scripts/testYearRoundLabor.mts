import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  applyYearRoundLaborRotation,
  computeSettlementYearRoundLaborRotation,
  isYearRoundLaborKind,
} from '../src/economy/yearRoundLabor.ts';
import { BUILDING_DEFINITIONS, type BuildingKind } from '../src/generated/gameBalance.ts';
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

for (const kind of [
  'town_hall',
  'foragers_shed',
  'fishing_camp',
  'threshing_barn',
  'apiary',
  'vineyard',
  'watermill',
  'granary',
  'brewery',
  'smokehouse',
  'weaver',
  'stone_quarry',
  'large_quarry',
  'hunters_hall',
] as const) {
  assert.equal(isYearRoundLaborKind(kind), false, `${kind} keeps its own staffing control`);
}
for (const kind of ['lumber_mill', 'well', 'chapel', 'guardhouse', 'carpenter'] as const) {
  assert.equal(isYearRoundLaborKind(kind), true, `${kind} is an ordinary year-round worksite`);
}

const freeLaborState = emptyGameState();
const townHall = building('1', 'town_hall', 1, true, 2);
const urgentMill = building('10', 'lumber_mill', 0, true, 3);
const urgentWell = building('20', 'well', 0, true, 3);
const normalChapel = building('30', 'chapel', 0, true, 2);
const lowGuardhouse = building('40', 'guardhouse', 0, true, 1);
const seasonalApiary = building('50', 'apiary', 0, true, 3);
const targetBrewery = building('60', 'brewery', 0, true, 3);
const incompleteHunter = building('70', 'hunters_hall', 0, false, 3);
const sourceBoundHunter = building('71', 'hunters_hall', 0, true, 3);
const sourceBoundQuarry = building('72', 'stone_quarry', 0, true, 3);
for (const site of [
  townHall,
  urgentMill,
  urgentWell,
  normalChapel,
  lowGuardhouse,
  seasonalApiary,
  targetBrewery,
  incompleteHunter,
  sourceBoundHunter,
  sourceBoundQuarry,
]) {
  freeLaborState.buildings.set(site.id, site);
}

const freeLaborPlan = computeSettlementYearRoundLaborRotation(freeLaborState, 3);
assert.equal(freeLaborPlan.worksites, 4);
assert.equal(freeLaborPlan.understaffedSites, 4);
assert.equal(
  freeLaborPlan.openPosts,
  BUILDING_DEFINITIONS.lumber_mill.maxLabor
    + BUILDING_DEFINITIONS.well.maxLabor
    + BUILDING_DEFINITIONS.chapel.maxLabor
    + BUILDING_DEFINITIONS.guardhouse.maxLabor,
);
assert.equal(freeLaborPlan.recalledWorkers, 0);
assert.equal(freeLaborPlan.calledWorkers, 3);
assert.equal(freeLaborPlan.remainingOpenPosts, freeLaborPlan.openPosts - 3);
assert.equal(freeLaborPlan.freeLaborAfter, 0);
assert.equal(freeLaborPlan.firstRecalledBuildingId, null);
assert.equal(freeLaborPlan.firstUnderstaffedBuildingId, urgentMill.id);
assert.deepEqual(
  freeLaborPlan.assignments.map((assignment) => [
    assignment.buildingId,
    assignment.targetLabor,
  ]),
  [
    [urgentMill.id, 2],
    [urgentWell.id, 1],
  ],
  'urgent worksites should share free labor before lower priorities',
);

const freeLaborApplied = applyYearRoundLaborRotation(
  freeLaborState.buildings,
  freeLaborPlan,
);
assert.equal(freeLaborApplied.get(urgentMill.id)?.assignedLabor, 2);
assert.equal(freeLaborApplied.get(urgentWell.id)?.assignedLabor, 1);
assert.equal(freeLaborApplied.get(seasonalApiary.id)?.assignedLabor, 0);
assert.equal(freeLaborApplied.get(targetBrewery.id)?.assignedLabor, 0);
assert.equal(freeLaborApplied.get(sourceBoundHunter.id)?.assignedLabor, 0);
assert.equal(freeLaborApplied.get(sourceBoundQuarry.id)?.assignedLabor, 0);
assert.equal(freeLaborApplied.get(townHall.id)?.assignedLabor, 1);
assert.equal(freeLaborState.buildings.get(urgentMill.id)?.assignedLabor, 0);

const fullEmploymentState = emptyGameState();
const fullHall = building('1', 'town_hall', 1, true, 2);
const essentialMill = building('10', 'lumber_mill', 1, true, 3);
const normalPriest = building('30', 'chapel', 1, true, 2);
const lowGuards = building('40', 'guardhouse', 2, true, 1);
for (const site of [fullHall, essentialMill, normalPriest, lowGuards]) {
  fullEmploymentState.buildings.set(site.id, site);
}
const rebalancePlan = computeSettlementYearRoundLaborRotation(fullEmploymentState, 0);
assert.equal(rebalancePlan.recalledWorkers, 2);
assert.equal(rebalancePlan.calledWorkers, 2);
assert.equal(rebalancePlan.freeLaborBefore, 0);
assert.equal(rebalancePlan.freeLaborAfter, 0);
assert.equal(rebalancePlan.firstRecalledBuildingId, lowGuards.id);
assert.equal(rebalancePlan.firstUnderstaffedBuildingId, essentialMill.id);
assert.equal(
  rebalancePlan.remainingOpenPosts,
  BUILDING_DEFINITIONS.guardhouse.maxLabor,
);
assert.deepEqual(
  rebalancePlan.assignments.map((assignment) => [
    assignment.buildingId,
    assignment.targetLabor,
  ]),
  [
    [essentialMill.id, 3],
    [lowGuards.id, 0],
  ],
  'full employment should move only the two workers needed from low to high priority',
);
const rebalanced = applyYearRoundLaborRotation(
  fullEmploymentState.buildings,
  rebalancePlan,
);
assert.equal(rebalanced.get(essentialMill.id)?.assignedLabor, 3);
assert.equal(rebalanced.get(normalPriest.id)?.assignedLabor, 1);
assert.equal(rebalanced.get(lowGuards.id)?.assignedLabor, 0);
assert.equal(rebalanced.get(fullHall.id)?.assignedLabor, 1);

const donorOrderState = emptyGameState();
donorOrderState.buildings.set('10', building('10', 'chapel', 0, true, 3));
donorOrderState.buildings.set('30', building('30', 'well', 1, true, 1));
donorOrderState.buildings.set('40', building('40', 'well', 1, true, 1));
const donorOrder = computeSettlementYearRoundLaborRotation(donorOrderState, 0);
assert.deepEqual(
  donorOrder.assignments.map((assignment) => [
    assignment.buildingId,
    assignment.targetLabor,
  ]),
  [
    ['10', 1],
    ['40', 0],
  ],
  'the newest stable ID in the lowest tier should release first',
);

const equalTierState = emptyGameState();
equalTierState.buildings.set('10', building('10', 'lumber_mill', 0, true, 2));
equalTierState.buildings.set(
  '20',
  building('20', 'lumber_mill', BUILDING_DEFINITIONS.lumber_mill.maxLabor, true, 2),
);
const equalTierPlan = computeSettlementYearRoundLaborRotation(equalTierState, 0);
assert.equal(equalTierPlan.assignments.length, 0, 'equal-tier crews should not be churned');

const legacyState = emptyGameState();
legacyState.buildings.set('10', building('10', 'chapel', 0, true, 0));
legacyState.buildings.set('20', building('20', 'well', 0, true, 1));
const legacyPlan = computeSettlementYearRoundLaborRotation(legacyState, 1);
assert.deepEqual(
  legacyPlan.assignments.map((assignment) => assignment.buildingId),
  ['10'],
  'legacy priority zero should normalize to normal and fill before low',
);

const inspector = renderTownHallInspector(
  {
    kind: 'building',
    building: fullHall,
    matureTrees: 0,
    stumpTrees: 0,
    growingTrees: 0,
  },
  {
    gameState: fullEmploymentState,
    worldQueries: worldQueries(),
    populationStats: computePopulationStats(fullEmploymentState),
    resourceTotals: computeResourceTotals(fullEmploymentState),
    worldHydrology: 0.5,
  },
);
assert.match(inspector.detailsHtml, /Year-round balance/);
assert.match(inspector.detailsHtml, /2 lower-priority workers move/);
assert.match(inspector.detailsHtml, /data-inspect-building="40"/);
assert.match(inspector.supplementalPanelHtml ?? '', /data-balance-year-round-labor/);
assert.match(inspector.supplementalPanelHtml ?? '', /minimum necessary workers move from strictly lower tiers/);
assert.match(inspector.supplementalPanelHtml ?? '', /Town Hall clerks are never displaced/);
assert.match(inspector.supplementalPanelHtml ?? '', /source-bound production/);
assert.match(inspector.supplementalPanelHtml ?? '', /Reassign 2 lower-priority workers/);
assert.match(inspector.supplementalPanelHtml ?? '', /Future hiring remains explicit/);

const perfState = emptyGameState();
for (let index = 0; index < 100_000; index += 1) {
  const site = index % 2 === 0
    ? building(String(index), 'lumber_mill', 0, true, 3)
    : building(String(index), 'lumber_mill', 1, true, 1);
  perfState.buildings.set(site.id, site);
}
const started = performance.now();
const perfPlan = computeSettlementYearRoundLaborRotation(perfState, 0);
const elapsedMs = performance.now() - started;
assert.equal(perfPlan.recalledWorkers, 50_000);
assert.equal(perfPlan.calledWorkers, 50_000);
assert.equal(perfPlan.assignments.length, 100_000);
assert.ok(
  elapsedMs < 400,
  `100,000-site full-employment balance took ${elapsedMs.toFixed(1)} ms`,
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
const gameStore = readFileSync(
  new URL('../src/data/spacetimeGameStore.ts', import.meta.url),
  'utf8',
);
const inspectorActions = readFileSync(
  new URL('../src/app/inspectorSpacetimeActions.ts', import.meta.url),
  'utf8',
);
const generatedReducers = readFileSync(
  new URL('../src/generated/index.ts', import.meta.url),
  'utf8',
);
assert.match(serverReducer, /pub fn call_up_year_round_labor/);
assert.match(serverReducer, /year_round_labor_rotation/);
assert.match(serverReducer, /A staffed Town Hall is required/);
assert.match(resourceInspector, /data-balance-year-round-labor/);
assert.match(spacetimeReducers, /callUpYearRoundLabor/);
assert.match(gameStore, /async balanceYearRoundLabor/);
assert.match(gameStore, /applyYearRoundLaborRotation/);
assert.match(inspectorActions, /onBalanceYearRoundLabor/);
assert.match(generatedReducers, /call_up_year_round_labor/);

console.log(
  `year-round labor balancing tests passed (100,000 sites: ${elapsedMs.toFixed(1)} ms)`,
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
  constructionComplete: boolean,
  constructionPriority: number,
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
    constructionPriority,
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
