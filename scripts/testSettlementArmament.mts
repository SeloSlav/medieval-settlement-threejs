import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  computeSettlementArmamentPlan,
} from '../src/economy/settlementArmament.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import {
  renderSettlementArmamentRows,
} from '../src/resources/inspector/townHallRenderer.ts';
import {
  createEmptyStockpile,
  type BuildingKind,
  type BuildingState,
} from '../src/resources/types.ts';

function building(
  id: string,
  kind: BuildingKind,
  x: number,
  partial: Partial<BuildingState> = {},
): BuildingState {
  return {
    id,
    kind,
    x,
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
    assignedLabor: 0,
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
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
    ...partial,
  };
}

function trip(
  id: string,
  cargoKind: DeliveryTripState['cargoKind'],
  amount: number,
  targetBuildingId: string,
  phase: DeliveryTripState['phase'] = 'outbound',
): DeliveryTripState {
  return {
    id,
    buildingId: 'source',
    residenceId: null,
    destinationKind: 'building',
    targetBuildingId,
    cargoKind,
    amount,
    phase,
    x: 0,
    z: 0,
    progress: 0.5,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 1,
    deliveryWorkers: 1,
    pathDistance: 100,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[]',
  };
}

const state = {
  stockpile: createEmptyStockpile(),
  buildings: new Map<string, BuildingState>(),
  deliveryTrips: new Map<string, DeliveryTripState>(),
};
state.stockpile.polearms = 2;
state.stockpile.ironwork = 4;

const westGuard = building('west-guard', 'guardhouse', 0, {
  assignedLabor: 4,
  polearms: 2,
});
const eastGuard = building('east-guard', 'guardhouse', 100, {
  assignedLabor: 4,
  polearms: 1,
});
const westCarpenter = building('west-carpenter', 'carpenter', 0, {
  assignedLabor: 1,
  polearms: 1,
  timber: 6,
  ironwork: 1,
  carpenterPolearmReserve: 6,
});
const idleEastCarpenter = building('idle-east-carpenter', 'carpenter', 100, {
  assignedLabor: 0,
  polearms: 3,
  carpenterPolearmReserve: 6,
});
const remoteCarpenter = building('remote-carpenter', 'carpenter', 200, {
  assignedLabor: 1,
  polearms: 4,
  timber: 4,
  ironwork: 2,
  carpenterPolearmReserve: 6,
});
const westMarket = building('west-market', 'marketplace', 0, {
  assignedLabor: 1,
  ironwork: 3,
});
const eastMarket = building('east-market', 'marketplace', 100, {
  assignedLabor: 1,
  ironwork: 5,
});
const westLumber = building('west-lumber', 'lumber_mill', 0, {
  timber: 8,
});
for (const site of [
  westGuard,
  eastGuard,
  westCarpenter,
  idleEastCarpenter,
  remoteCarpenter,
  westMarket,
  eastMarket,
  westLumber,
]) {
  state.buildings.set(site.id, site);
}

state.deliveryTrips.set(
  'west-polearm-cart',
  trip('west-polearm-cart', 'polearms', 1, westGuard.id),
);
state.deliveryTrips.set(
  'east-polearm-cart',
  trip('east-polearm-cart', 'polearms', 2, eastGuard.id),
);
state.deliveryTrips.set(
  'returning-polearm-cart',
  trip('returning-polearm-cart', 'polearms', 99, eastGuard.id, 'inbound'),
);
state.deliveryTrips.set(
  'west-ironwork-cart',
  trip('west-ironwork-cart', 'ironwork', 2, westCarpenter.id),
);
state.deliveryTrips.set(
  'west-timber-cart',
  trip('west-timber-cart', 'timber', 2, westCarpenter.id, 'unloading'),
);

const split = computeSettlementArmamentPlan({
  state,
  roadComponentFor: (candidate) =>
    candidate.x < 50 ? 1 : candidate.x < 150 ? 2 : 3,
});
assert.equal(split.guardhouses, 2);
assert.equal(split.assignedGuards, 8);
assert.equal(split.armedGuards, 3);
assert.equal(split.unarmedGuards, 5);
assert.equal(split.highPriorityCompanies, 0);
assert.equal(split.normalPriorityCompanies, 2);
assert.equal(split.lowPriorityCompanies, 0);
assert.equal(split.staffedCarpenters, 2);
assert.equal(split.polearmStock, 16);
assert.equal(split.polearmsInTransit, 3);
assert.equal(split.serviceableFinishedPolearms, 7);
assert.equal(split.unavailableFinishedPolearms, 9);
assert.equal(split.armableFromFinishedStock, 7);
assert.equal(split.armableAfterReadyCrafts, 7);
assert.equal(split.unarmedAfterFinishedStock, 1);
assert.equal(split.unarmedAfterReadyCrafts, 1);
assert.equal(split.selectedArmoryOutput, 7);
assert.equal(split.readyArmoryOutput, 5);
assert.equal(split.timberNeededForTargets, 2);
assert.equal(split.ironworkNeededForTargets, 2);
assert.equal(split.roadSourceTimber, 8);
assert.equal(split.roadSourceIronwork, 3);
assert.equal(split.ironworkStock, 17);
assert.equal(split.ironworkInTransit, 2);
assert.equal(split.serviceableIronwork, 8);
assert.equal(split.unavailableIronwork, 9);
assert.equal(split.firstExposedGuardhouseId, eastGuard.id);
assert.equal(split.roadPlan?.activeBranches, 3);
assert.equal(split.roadPlan?.guardBranches, 2);
assert.equal(split.roadPlan?.staffedArmoryGuardBranches, 1);
assert.equal(split.roadPlan?.finishedStockCoveredBranches, 1);
assert.equal(split.roadPlan?.readyCraftCoveredBranches, 1);
assert.equal(split.roadPlan?.exposedGuardBranches, 1);
assert.equal(split.roadPlan?.unservedGuardBranches, 1);
assert.equal(split.roadPlan?.fragmentationGuards, 1);
assert.equal(split.roadPlan?.firstExposedGuardhouseId, eastGuard.id);

const splitRows = renderSettlementArmamentRows(split);
assert.match(splitRows, /3 \/ 8 guards armed onsite/);
assert.match(splitRows, /0 high &middot; 2 normal &middot; 0 low/);
assert.match(splitRows, /7 \/ 8 armable after approaching carts/);
assert.match(splitRows, /1 still exposed/);
assert.match(splitRows, /1 \/ 2 guard branches have a staffed carpenter route/);
assert.match(splitRows, /1\.0 guards blocked by branch fragmentation/);
assert.match(splitRows, /5\.0 \/ 7\.0 selected polearms have timber and ironwork/);
assert.match(splitRows, /9\.0 in treasury, excess company stock, idle shops, or disconnected stores/);
assert.match(splitRows, /data-inspect-building="east-guard"/);

const joined = computeSettlementArmamentPlan({
  state,
  roadComponentFor: () => 1,
});
assert.equal(joined.serviceableFinishedPolearms, 11);
assert.equal(joined.unavailableFinishedPolearms, 5);
assert.equal(joined.armableFromFinishedStock, 8);
assert.equal(joined.armableAfterReadyCrafts, 8);
assert.equal(joined.unarmedAfterReadyCrafts, 0);
assert.equal(joined.serviceableIronwork, 13);
assert.equal(joined.unavailableIronwork, 4);
assert.equal(joined.firstExposedGuardhouseId, null);
assert.equal(joined.roadPlan?.activeBranches, 1);
assert.equal(joined.roadPlan?.guardBranches, 1);
assert.equal(joined.roadPlan?.staffedArmoryGuardBranches, 1);
assert.equal(joined.roadPlan?.finishedStockCoveredBranches, 1);
assert.equal(joined.roadPlan?.readyCraftCoveredBranches, 1);
assert.equal(joined.roadPlan?.exposedGuardBranches, 0);
assert.equal(joined.roadPlan?.unservedGuardBranches, 0);
assert.equal(joined.roadPlan?.fragmentationGuards, 0);
assert.match(
  renderSettlementArmamentRows(joined),
  /no ready arms stranded by topology/,
);

const aggregate = computeSettlementArmamentPlan({ state });
assert.equal(aggregate.roadPlan, null);
assert.equal(aggregate.armableFromFinishedStock, 8);
assert.equal(aggregate.serviceableFinishedPolearms, 11);
assert.equal(aggregate.unavailableFinishedPolearms, 5);

const excessCompanyState = {
  stockpile: createEmptyStockpile(),
  buildings: new Map<string, BuildingState>([
    ['excess-company', building('excess-company', 'guardhouse', 0, {
      assignedLabor: 2,
      polearms: 5,
    })],
  ]),
  deliveryTrips: new Map<string, DeliveryTripState>(),
};
const excessCompany = computeSettlementArmamentPlan({
  state: excessCompanyState,
});
assert.equal(excessCompany.armedGuards, 2);
assert.equal(excessCompany.serviceableFinishedPolearms, 2);
assert.equal(
  excessCompany.unavailableFinishedPolearms,
  3,
  'a guardhouse must not redistribute weapons left above its own assignment',
);

const rankedCompanyState = {
  stockpile: createEmptyStockpile(),
  buildings: new Map<string, BuildingState>([
    ['low-empty', building('low-empty', 'guardhouse', 0, {
      assignedLabor: 4,
      polearms: 0,
      guardhousePayPriority: 0,
    })],
    ['high-partial', building('high-partial', 'guardhouse', 0, {
      assignedLabor: 4,
      polearms: 2,
      guardhousePayPriority: 2,
    })],
  ]),
  deliveryTrips: new Map<string, DeliveryTripState>(),
};
const rankedCompanies = computeSettlementArmamentPlan({
  state: rankedCompanyState,
  roadComponentFor: () => 1,
});
assert.equal(rankedCompanies.highPriorityCompanies, 1);
assert.equal(rankedCompanies.normalPriorityCompanies, 0);
assert.equal(rankedCompanies.lowPriorityCompanies, 1);
assert.equal(
  rankedCompanies.firstExposedGuardhouseId,
  'high-partial',
  'direct inspection should follow company priority before raw armed coverage',
);

const townHallSource = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(
  townHallSource,
  /const armamentPlan = context\.conflictEnabled[\s\S]*?computeSettlementArmamentPlan/,
  'peaceful-world ledgers should not run or render frontier armament planning',
);

const performanceState = {
  stockpile: createEmptyStockpile(),
  buildings: new Map<string, BuildingState>(),
  deliveryTrips: new Map<string, DeliveryTripState>(),
};
for (let index = 0; index < 100_000; index += 1) {
  const isGuardhouse = index % 2 === 0;
  const site = building(
    `armament-${index}`,
    isGuardhouse ? 'guardhouse' : 'carpenter',
    index % 200,
    isGuardhouse
      ? { assignedLabor: 1, polearms: 0 }
      : {
          assignedLabor: 1,
          polearms: 1,
          timber: 2,
          ironwork: 1,
          carpenterPolearmReserve: 2,
        },
  );
  performanceState.buildings.set(site.id, site);
}
const performanceStarted = performance.now();
const largePlan = computeSettlementArmamentPlan({
  state: performanceState,
  roadComponentFor: (candidate) => candidate.x,
});
const performanceElapsed = performance.now() - performanceStarted;
assert.equal(largePlan.guardhouses, 50_000);
assert.equal(largePlan.staffedCarpenters, 50_000);
assert.equal(largePlan.roadPlan?.activeBranches, 200);
assert.equal(largePlan.roadPlan?.guardBranches, 100);
assert.equal(largePlan.roadPlan?.unservedGuardBranches, 100);
assert.ok(
  performanceElapsed < 600,
  `100,000-building / 200-branch armament plan took ${performanceElapsed.toFixed(1)} ms`,
);

console.log(
  `settlement armament tests passed (${performanceElapsed.toFixed(1)} ms for 100,000 buildings / 200 branches)`,
);
