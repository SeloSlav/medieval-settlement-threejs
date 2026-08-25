import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  applyProcessorLaborCallup,
  applyProcessorLaborRecall,
  computeSettlementOperationalProcessorLaborCallupPlan,
  computeSettlementProcessorLaborCallupPlan,
  computeSettlementProcessorLaborRecallPlan,
  computeSettlementProductionStewardPlan,
} from '../src/economy/processorLabor.ts';
import {
  DEFAULT_PRODUCTION_LABOR_STEWARD_ENABLED,
  productionLaborStewardStatus,
} from '../src/economy/laborSteward.ts';
import { BUILDING_DEFINITIONS, type BuildingKind } from '../src/generated/gameBalance.ts';
import type { DeliveryCargoKind, DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
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

assert.equal(DEFAULT_PRODUCTION_LABOR_STEWARD_ENABLED, false);
assert.equal(
  productionLaborStewardStatus(false, true),
  'Manual · rotate stalled and ready production crews when needed',
);
assert.match(productionLaborStewardStatus(true, true), /Daily/);
assert.match(productionLaborStewardStatus(true, false), /paused/);

const recallState = emptyGameState();
const brewery = building('10', 'brewery', 3);
brewery.processorOutputTargetPercent = 50;
brewery.ale = 100;
const weaver = building('20', 'weaver', 1);
weaver.processorOutputTargetPercent = 25;
weaver.cloth = 30;
const smokehouse = building('30', 'smokehouse', 2);
smokehouse.processorOutputTargetPercent = 50;
smokehouse.preservedFood = 20;
const bakery = building('40', 'bakery', 3);
bakery.processorOutputTargetPercent = 25;
bakery.ryeBread = 25;
const carpenter = building('50', 'carpenter', 4);
for (const site of [brewery, weaver, smokehouse, bakery, carpenter]) {
  recallState.buildings.set(site.id, site);
}

const recallPlan = computeSettlementProcessorLaborRecallPlan(recallState);
assert.equal(recallPlan.targetPausedSites, 3);
assert.equal(recallPlan.reclaimableSites, 3);
assert.equal(recallPlan.reclaimableWorkers, 7);
assert.equal(recallPlan.retainedDispatchers, 0);
assert.equal(recallPlan.firstReclaimableBuildingId, brewery.id);
assert.deepEqual(
  recallPlan.sites.map((site) => [site.buildingId, site.targetLabor]),
  [
    [brewery.id, 0],
    [weaver.id, 0],
    [bakery.id, 0],
  ],
);

const recalled = applyProcessorLaborRecall(recallState.buildings, recallPlan);
assert.equal(recalled.get(brewery.id)?.assignedLabor, 0);
assert.equal(recalled.get(bakery.id)?.assignedLabor, 0);
assert.equal(recalled.get(weaver.id)?.assignedLabor, 0);
assert.equal(recalled.get(smokehouse.id)?.assignedLabor, 2);
assert.equal(recalled.get(carpenter.id)?.assignedLabor, 4);
assert.equal(recallState.buildings.get(brewery.id)?.assignedLabor, 3);

const callupState = emptyGameState();
const highMill = building('10', 'watermill', 0);
highMill.constructionPriority = 3;
const highBrewery = building('20', 'brewery', 0);
highBrewery.constructionPriority = 3;
const normalSmokehouse = building('30', 'smokehouse', 0);
normalSmokehouse.constructionPriority = 2;
const cappedWeaver = building('40', 'weaver', 0);
cappedWeaver.constructionPriority = 3;
cappedWeaver.processorOutputTargetPercent = 25;
cappedWeaver.cloth = 30;
const unrelatedCarpenter = building('50', 'carpenter', 0);
for (const site of [
  highMill,
  highBrewery,
  normalSmokehouse,
  cappedWeaver,
  unrelatedCarpenter,
]) {
  callupState.buildings.set(site.id, site);
}

const callupPlan = computeSettlementProcessorLaborCallupPlan(callupState, 3);
assert.equal(callupPlan.auditedSites, 4);
assert.equal(callupPlan.readySites, 3);
assert.equal(callupPlan.blockedSites, 1);
assert.equal(callupPlan.understaffedSites, 3);
assert.equal(callupPlan.openPosts, 8);
assert.equal(callupPlan.callupWorkers, 3);
assert.equal(callupPlan.remainingOpenPosts, 5);
assert.equal(callupPlan.firstUnderstaffedBuildingId, highMill.id);
assert.deepEqual(
  callupPlan.assignments.map((assignment) => [
    assignment.buildingId,
    assignment.targetLabor,
  ]),
  [
    [highMill.id, 1],
    [highBrewery.id, 1],
    [normalSmokehouse.id, 1],
  ],
  'scarce workers should round-robin in stable worksite order regardless of legacy priority',
);
const calledUp = applyProcessorLaborCallup(callupState.buildings, callupPlan);
assert.equal(calledUp.get(highMill.id)?.assignedLabor, 1);
assert.equal(calledUp.get(highBrewery.id)?.assignedLabor, 1);
assert.equal(calledUp.get(normalSmokehouse.id)?.assignedLabor, 1);
assert.equal(calledUp.get(cappedWeaver.id)?.assignedLabor, 0);
assert.equal(calledUp.get(unrelatedCarpenter.id)?.assignedLabor, 0);

const sourceBoundState = emptyGameState();
const readyQuarry = building('10', 'stone_quarry', 0);
readyQuarry.workRadius = 30;
const exhaustedQuarry = building('20', 'stone_quarry', 0);
exhaustedQuarry.x = 100;
exhaustedQuarry.workRadius = 30;
const readyLargeQuarry = building('30', 'large_quarry', 0);
readyLargeQuarry.x = 200;
readyLargeQuarry.timber = 1;
const readyHunter = building('40', 'hunters_hall', 0);
readyHunter.x = 300;
readyHunter.workRadius = 68;
readyHunter.harvestReservePercent = 50;
const reserveHunter = building('50', 'hunters_hall', 0);
reserveHunter.x = 400;
reserveHunter.workRadius = 68;
reserveHunter.harvestReservePercent = 50;
for (const site of [
  readyQuarry,
  exhaustedQuarry,
  readyLargeQuarry,
  readyHunter,
  reserveHunter,
]) {
  sourceBoundState.buildings.set(site.id, site);
}
sourceBoundState.quarries.set('ready-stone', quarry('ready-stone', 0, 0, 50));
sourceBoundState.quarries.set('spent-stone', quarry('spent-stone', 100, 0, 0));
sourceBoundState.quarries.set('rich-stone', {
  ...quarry('rich-stone', 200, 0, 0),
  isRich: true,
});
sourceBoundState.foragingNodes.set(
  'healthy-game',
  wildStock('healthy-game', 300, 0, 80, 100),
);
sourceBoundState.foragingNodes.set(
  'protected-game',
  wildStock('protected-game', 400, 0, 50, 100),
);

const sourceBoundPlan = computeSettlementProcessorLaborCallupPlan(sourceBoundState, 3);
assert.equal(sourceBoundPlan.auditedSites, 5);
assert.equal(sourceBoundPlan.readySites, 3);
assert.equal(sourceBoundPlan.blockedSites, 2);
assert.equal(sourceBoundPlan.callupWorkers, 3);
assert.deepEqual(
  sourceBoundPlan.assignments.map((assignment) => [
    assignment.buildingId,
    assignment.targetLabor,
  ]),
  [
    [readyQuarry.id, 1],
    [readyLargeQuarry.id, 1],
    [readyHunter.id, 1],
  ],
  'source-ready extraction sites should share scarce labor while depleted and reserve-held sites stay empty',
);

const mineralCallupState = emptyGameState();
const readyFiniteMine = building('mineral-10-ready', 'stone_quarry', 0);
readyFiniteMine.workRadius = 30;
const exhaustedMine = building('mineral-20-exhausted', 'stone_quarry', 0);
exhaustedMine.x = 100;
exhaustedMine.workRadius = 30;
const readyRichMine = building('mineral-30-rich', 'mine', 0);
readyRichMine.x = 200;
readyRichMine.timber = 1;
for (const site of [readyFiniteMine, exhaustedMine, readyRichMine]) {
  mineralCallupState.buildings.set(site.id, site);
}
mineralCallupState.quarries.set(
  'deposit-iron-ready',
  mineralDeposit('deposit-iron-ready', 'iron', 0, 40, false),
);
mineralCallupState.quarries.set(
  'deposit-salt-exhausted',
  mineralDeposit('deposit-salt-exhausted', 'salt', 100, 0, false),
);
mineralCallupState.quarries.set(
  'deposit-salt-rich',
  mineralDeposit('deposit-salt-rich', 'salt', 200, 0, true),
);
const mineralCallup = computeSettlementProcessorLaborCallupPlan(
  mineralCallupState,
  2,
);
assert.equal(mineralCallup.auditedSites, 3);
assert.equal(mineralCallup.readySites, 2);
assert.equal(mineralCallup.blockedSites, 1);
assert.deepEqual(
  mineralCallup.assignments.map((assignment) => assignment.buildingId),
  [readyFiniteMine.id, readyRichMine.id],
  'a surface-ready Mining Pit and timber-supported Mineworks should share labor while an exhausted surface seam stays empty',
);

const materialCallupState = emptyGameState();
const readyClayPit = building('material-10-clay', 'stone_quarry', 0);
const fullClayPit = building('material-20-full-clay', 'stone_quarry', 0);
fullClayPit.x = 100;
fullClayPit.clay = 999;
const incompleteSmokehouse = building(
  'material-30-smokehouse',
  'smokehouse',
  0,
);
incompleteSmokehouse.food = 12;
incompleteSmokehouse.firewood = 6;
const incompleteSmithy = building('material-40-smithy', 'smithy', 0);
incompleteSmithy.iron = 8;
const suppliedPotter = building('material-50-potter', 'potter_kiln', 0);
suppliedPotter.clay = 12;
suppliedPotter.firewood = 6;
suppliedPotter.water = 3;
const suppliedCharcoalYard = building(
  'material-60-charcoal',
  'charcoal_burner',
  0,
);
suppliedCharcoalYard.firewood = 12;
const suppliedWell = building('material-70-well', 'well', 1);
suppliedWell.water = 12;
for (const site of [
  readyClayPit,
  fullClayPit,
  incompleteSmokehouse,
  incompleteSmithy,
  suppliedPotter,
  suppliedCharcoalYard,
  suppliedWell,
]) {
  materialCallupState.buildings.set(site.id, site);
}
materialCallupState.quarries.set(
  'clay-surface-ready',
  mineralDeposit('clay-surface-ready', 'clay', 0, 100, false),
);
materialCallupState.quarries.set(
  'clay-surface-full',
  mineralDeposit('clay-surface-full', 'clay', 100, 100, false),
);
const materialManualCallup = computeSettlementProcessorLaborCallupPlan(
  materialCallupState,
  10,
);
assert.equal(materialManualCallup.auditedSites, 6);
assert.equal(materialManualCallup.readySites, 5);
assert.equal(materialManualCallup.blockedSites, 1);
assert.ok(
  materialManualCallup.assignments.some(
    (assignment) => assignment.buildingId === readyClayPit.id,
  ),
  'the explicit Town Hall order must be able to staff a Mining Pit with open clay storage',
);
assert.equal(
  materialManualCallup.assignments.some(
    (assignment) => assignment.buildingId === fullClayPit.id,
  ),
  false,
);

const materialStrictCallup = computeSettlementOperationalProcessorLaborCallupPlan(
  materialCallupState,
  10,
);
assert.equal(materialStrictCallup.readySites, 3);
assert.equal(materialStrictCallup.blockedSites, 3);
assert.equal(
  materialStrictCallup.assignments.some(
    (assignment) => assignment.buildingId === incompleteSmokehouse.id,
  ),
  false,
  'the daily steward must require salt and pottery as well as food and fuel',
);
assert.equal(
  materialStrictCallup.assignments.some(
    (assignment) => assignment.buildingId === incompleteSmithy.id,
  ),
  false,
  'the daily steward must require forge charcoal as well as imported iron',
);
materialCallupState.deliveryTrips.set(
  'material-salt-cart',
  deliveryTrip(
    'material-salt-cart',
    'market',
    incompleteSmokehouse.id,
    'salt',
  ),
);
materialCallupState.deliveryTrips.set(
  'material-pottery-cart',
  deliveryTrip(
    'material-pottery-cart',
    suppliedPotter.id,
    incompleteSmokehouse.id,
    'pottery',
  ),
);
materialCallupState.deliveryTrips.set(
  'material-charcoal-cart',
  deliveryTrip(
    'material-charcoal-cart',
    suppliedCharcoalYard.id,
    incompleteSmithy.id,
    'charcoal',
  ),
);
materialCallupState.deliveryTrips.set(
  'material-forge-water-cart',
  deliveryTrip(
    'material-forge-water-cart',
    suppliedWell.id,
    incompleteSmithy.id,
    'water',
  ),
);
const recoveringMaterialCallup =
  computeSettlementOperationalProcessorLaborCallupPlan(
    materialCallupState,
    20,
  );
assert.equal(recoveringMaterialCallup.readySites, 5);
assert.equal(recoveringMaterialCallup.blockedSites, 1);
assert.ok(
  recoveringMaterialCallup.assignments.some(
    (assignment) => assignment.buildingId === incompleteSmokehouse.id,
  ),
  'all missing preservation inputs approaching by cart should make the workshop operationally ready',
);
assert.ok(
  recoveringMaterialCallup.assignments.some(
    (assignment) => assignment.buildingId === incompleteSmithy.id,
  ),
);

highMill.assignedLabor = BUILDING_DEFINITIONS.watermill.maxLabor;
highBrewery.assignedLabor = BUILDING_DEFINITIONS.brewery.maxLabor;
normalSmokehouse.constructionPriority = 0;
const legacyPriorityPlan = computeSettlementProcessorLaborCallupPlan(callupState, 1);
assert.equal(legacyPriorityPlan.assignments[0]?.buildingId, normalSmokehouse.id);
assert.equal(legacyPriorityPlan.assignments[0]?.priority, 2);

const stewardState = emptyGameState();
const cappedStewardBrewery = building('brewery', 'brewery', 3);
cappedStewardBrewery.processorOutputTargetPercent = 50;
cappedStewardBrewery.ale = 100;
const suppliedStewardMill = building('mill', 'watermill', 0);
suppliedStewardMill.ryeGrain = 20;
for (const site of [cappedStewardBrewery, suppliedStewardMill]) {
  stewardState.buildings.set(site.id, site);
}
const stewardPlan = computeSettlementProductionStewardPlan(stewardState, 6, 0);
assert.equal(stewardPlan.recalledWorkers, 3);
assert.equal(stewardPlan.calledWorkers, 3);
assert.equal(stewardPlan.availableLaborAfter, 0);
assert.equal(stewardPlan.firstChangedBuildingId, cappedStewardBrewery.id);
assert.equal(
  stewardPlan.callup.assignments[0]?.buildingId,
  suppliedStewardMill.id,
  'the steward should redeploy released labor to supplied capacity-open production',
);
assert.equal(
  stewardPlan.callup.assignments[0]?.targetLabor,
  3,
  'the output-capped brewery crew must not be immediately rehired',
);

const winterStewardPlan = computeSettlementProductionStewardPlan(stewardState, 1, 3);
assert.equal(
  winterStewardPlan.callup.assignments.some(
    (assignment) => assignment.buildingId === suppliedStewardMill.id,
  ),
  false,
  'the production steward must not call workers back to a winter-frozen watermill',
);

const reservedStewardPlan = computeSettlementProductionStewardPlan(
  stewardState,
  6,
  0,
  2,
);
assert.equal(reservedStewardPlan.laborReserve, 2);
assert.equal(reservedStewardPlan.recalledWorkers, 3);
assert.equal(reservedStewardPlan.calledWorkers, 1);
assert.equal(reservedStewardPlan.availableLaborAfter, 2);

const recoveringState = emptyGameState();
const recoveringMill = building('recovering-mill', 'watermill', 2);
recoveringState.buildings.set(recoveringMill.id, recoveringMill);
recoveringState.deliveryTrips.set(
  'rye-grain-cart',
  deliveryTrip('rye-grain-cart', 'supplier', recoveringMill.id, 'ryeGrain'),
);
const recoveringPlan = computeSettlementProductionStewardPlan(
  recoveringState,
  6,
  1,
);
assert.equal(recoveringPlan.recalledWorkers, 0);
assert.equal(recoveringPlan.calledWorkers, 1);
assert.equal(recoveringPlan.availableLaborAfter, 0);
assert.equal(recoveringPlan.callup.assignments[0]?.buildingId, recoveringMill.id);

const mismatchedSupplyState = emptyGameState();
const starvedMill = building('starved-mill', 'watermill', 2);
mismatchedSupplyState.buildings.set(starvedMill.id, starvedMill);
mismatchedSupplyState.deliveryTrips.set(
  'water-cart',
  deliveryTrip('water-cart', 'supplier', starvedMill.id, 'water'),
);
const mismatchedSupplyPlan = computeSettlementProductionStewardPlan(
  mismatchedSupplyState,
  6,
  0,
);
assert.equal(mismatchedSupplyPlan.recalledWorkers, 2);
assert.equal(mismatchedSupplyPlan.calledWorkers, 0);
assert.equal(mismatchedSupplyPlan.availableLaborAfter, 2);
const strictCallup = computeSettlementOperationalProcessorLaborCallupPlan(
  mismatchedSupplyState,
  2,
);
assert.equal(strictCallup.readySites, 0);
assert.equal(strictCallup.callupWorkers, 0);

const renderedState = emptyGameState();
const townHall = building('hall', 'town_hall', 1);
const pausedBrewery = building('brewery', 'brewery', 3);
pausedBrewery.processorOutputTargetPercent = 50;
pausedBrewery.ale = 100;
const readyMill = building('mill', 'watermill', 0);
readyMill.constructionPriority = 3;
readyMill.ryeGrain = 20;
for (const site of [townHall, pausedBrewery, readyMill]) {
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
    getProductionLaborStewardEnabled: () => true,
  },
);
assert.match(inspector.detailsHtml, /Production steward/);
assert.match(inspector.detailsHtml, /supplied sites fill fairly/);
assert.match(inspector.detailsHtml, /Dawn labor review/);
assert.match(
  inspector.detailsHtml,
  /Next dawn: production release 3\/deploy 3.*6 free after review/,
);
assert.match(
  inspector.detailsHtml,
  /aria-label="Inspect first dawn labor steward crew change"/,
);
assert.match(inspector.detailsHtml, /Target-paused workshops/);
assert.match(inspector.detailsHtml, /3 reclaimable workers across 1 target-paused workshop/);
assert.match(inspector.detailsHtml, /data-inspect-building="brewery"/);
assert.match(inspector.detailsHtml, /Production call-up/);
assert.match(inspector.detailsHtml, /ready production posts/);
assert.match(inspector.detailsHtml, /1 blocked/);
assert.match(inspector.detailsHtml, /data-inspect-building="mill"/);
assert.match(inspector.supplementalPanelHtml ?? '', /data-recall-target-idle-processor-labor/);
assert.match(inspector.supplementalPanelHtml ?? '', /Recall 3 stalled production workers/);
assert.match(inspector.supplementalPanelHtml ?? '', /no producer is retained as a dispatcher/);
assert.match(inspector.supplementalPanelHtml ?? '', /Matching inbound supplies protect recovering workshops/);
assert.match(inspector.supplementalPanelHtml ?? '', /data-call-up-target-ready-processor-labor/);
assert.match(inspector.supplementalPanelHtml ?? '', /Deploy 3 production workers/);
assert.match(inspector.supplementalPanelHtml ?? '', /Sites share workers round-robin in stable worksite order/);
assert.match(
  inspector.supplementalPanelHtml ?? '',
  /extraction works on usable deposits with room below their chosen yard target/,
);
assert.match(inspector.supplementalPanelHtml ?? '', /every recipe input is present or already inbound/);
assert.match(inspector.supplementalPanelHtml ?? '', /data-policy-production-labor-steward/);
assert.match(inspector.supplementalPanelHtml ?? '', /Daily production labor steward/);
assert.match(inspector.supplementalPanelHtml ?? '', /production second, and construction last/);
assert.match(inspector.supplementalPanelHtml ?? '', /steward will redeploy released labor/);
assert.match(
  inspector.supplementalPanelHtml ?? '',
  /previews the full seasonal.*production.*construction sequence against one shared labor pool without issuing orders/,
);

const perfState = emptyGameState();
for (let index = 0; index < 100_000; index += 1) {
  const site = building(String(index), 'brewery', 3);
  site.processorOutputTargetPercent = 25;
  site.ale = 50;
  perfState.buildings.set(site.id, site);
}
const recallStarted = performance.now();
const perfRecallPlan = computeSettlementProcessorLaborRecallPlan(perfState);
const recallElapsedMs = performance.now() - recallStarted;
assert.equal(perfRecallPlan.reclaimableWorkers, 300_000);
assert.ok(
  recallElapsedMs < 250,
  `100,000-site workshop recall plan took ${recallElapsedMs.toFixed(1)} ms`,
);

for (const site of perfState.buildings.values()) {
  site.assignedLabor = 0;
  site.ale = 0;
}
const callupStarted = performance.now();
const perfCallupPlan = computeSettlementProcessorLaborCallupPlan(perfState, 100_000);
const callupElapsedMs = performance.now() - callupStarted;
assert.equal(perfCallupPlan.callupWorkers, 100_000);
assert.equal(perfCallupPlan.readySites, 100_000);
assert.equal(perfCallupPlan.blockedSites, 0);
assert.ok(
  callupElapsedMs < 500,
  `100,000-site workshop call-up plan took ${callupElapsedMs.toFixed(1)} ms`,
);

const spatialCallupState = emptyGameState();
for (let index = 0; index < 20_000; index += 1) {
  const x = index * 200;
  if (index % 2 === 0) {
    const hunter = building(`hunter-${index}`, 'hunters_hall', 0);
    hunter.x = x;
    hunter.workRadius = 68;
    hunter.harvestReservePercent = 50;
    spatialCallupState.buildings.set(hunter.id, hunter);
    const node = wildStock(`game-${index}`, x, 0, 80, 100);
    spatialCallupState.foragingNodes.set(node.nodeId, node);
  } else {
    const mine = building(`pit-${index}`, 'stone_quarry', 0);
    mine.x = x;
    mine.workRadius = 30;
    spatialCallupState.buildings.set(mine.id, mine);
    const node = mineralDeposit(
      `deposit-iron-${index}`,
      'iron',
      x,
      80,
      false,
    );
    spatialCallupState.quarries.set(node.nodeId, node);
  }
}
const spatialCallupStarted = performance.now();
const spatialCallupPlan = computeSettlementProcessorLaborCallupPlan(
  spatialCallupState,
  20_000,
);
const spatialCallupElapsedMs = performance.now() - spatialCallupStarted;
assert.equal(spatialCallupPlan.readySites, 20_000);
assert.equal(spatialCallupPlan.callupWorkers, 20_000);
assert.ok(
  spatialCallupElapsedMs < 750,
  `20,000 source-aware Mining Pit/hunter call-ups took ${spatialCallupElapsedMs.toFixed(1)} ms`,
);

const stewardPerfState = emptyGameState();
for (let index = 0; index < 50_000; index += 1) {
  const capped = building(`capped-${index}`, 'brewery', 3);
  capped.processorOutputTargetPercent = 25;
  capped.ale = 50;
  stewardPerfState.buildings.set(capped.id, capped);
  const supplied = building(`supplied-${index}`, 'watermill', 0);
  supplied.ryeGrain = 20;
  stewardPerfState.buildings.set(supplied.id, supplied);
}
const stewardStarted = performance.now();
const perfStewardPlan = computeSettlementProductionStewardPlan(
  stewardPerfState,
  6,
  0,
);
const stewardElapsedMs = performance.now() - stewardStarted;
assert.equal(perfStewardPlan.recalledWorkers, 150_000);
assert.equal(perfStewardPlan.calledWorkers, 150_000);
assert.equal(perfStewardPlan.availableLaborAfter, 0);
assert.ok(
  stewardElapsedMs < 1_500,
  `100,000-site sequential production steward forecast took ${stewardElapsedMs.toFixed(1)} ms`,
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
const generatedPlayerResources = readFileSync(
  new URL('../src/generated/player_resources_table.ts', import.meta.url),
  'utf8',
);
const productionSteward = readFileSync(
  new URL('../server/src/simulation/production_labor_steward.rs', import.meta.url),
  'utf8',
);
const simulationReducer = readFileSync(
  new URL('../server/src/reducers/simulation.rs', import.meta.url),
  'utf8',
);
const villageAdminReducer = readFileSync(
  new URL('../server/src/reducers/village_admin.rs', import.meta.url),
  'utf8',
);
const serverTables = readFileSync(
  new URL('../server/src/tables.rs', import.meta.url),
  'utf8',
);
const worksiteStallForecast = readFileSync(
  new URL('../src/economy/settlementWorksiteStalls.ts', import.meta.url),
  'utf8',
);
assert.match(serverReducer, /pub fn recall_target_idle_processor_labor/);
assert.match(serverReducer, /pub fn call_up_target_ready_processor_labor/);
assert.match(serverReducer, /recall_target_idle_processor_labor_for_owner/);
assert.match(serverReducer, /call_up_target_ready_processor_labor_for_owner/);
assert.match(serverReducer, /call_up_operational_production_labor_for_owner/);
assert.match(serverReducer, /require_operational_inputs/);
assert.match(serverReducer, /production_steward_callup_allowed/);
assert.match(serverReducer, /A staffed Town Hall is required/);
assert.match(serverReducer, /building_has_active_trip/);
assert.match(serverReducer, /stalled_labor_target/);
assert.match(serverReducer, /production_site_ready/);
assert.match(serverReducer, /is_production_labor_kind/);
assert.match(resourceInspector, /data-recall-target-idle-processor-labor/);
assert.match(resourceInspector, /data-call-up-target-ready-processor-labor/);
assert.match(spacetimeReducers, /recallTargetIdleProcessorLabor/);
assert.match(spacetimeReducers, /callUpTargetReadyProcessorLabor/);
assert.match(spacetimeReducers, /setProductionLaborSteward/);
assert.match(generatedReducers, /recall_target_idle_processor_labor/);
assert.match(generatedReducers, /call_up_target_ready_processor_labor/);
assert.match(generatedReducers, /set_production_labor_steward/);
assert.match(generatedPlayerResources, /productionLaborStewardEnabled: __t\.bool/);
assert.match(generatedPlayerResources, /laborStewardReserve: __t\.u32/);
assert.match(serverTables, /production_labor_steward_enabled/);
assert.match(serverTables, /labor_steward_reserve/);
assert.match(villageAdminReducer, /pub fn set_production_labor_steward/);
assert.match(villageAdminReducer, /pub fn set_labor_steward_reserve/);
assert.match(villageAdminReducer, /reconcile_target_production_labor_for_owner/);
assert.match(productionSteward, /seasonal_labor_steward_review_due/);
assert.match(productionSteward, /resources\.production_labor_steward_enabled/);
assert.match(productionSteward, /recall_target_idle_processor_labor_for_owner/);
assert.match(productionSteward, /call_up_operational_production_labor_for_owner/);
assert.match(worksiteStallForecast, /computeSettlementOperationalProductionReadiness/);
assert.match(worksiteStallForecast, /buildInboundCargoByBuilding/);
assert.match(
  simulationReducer,
  /step_seasonal_labor_stewards[\s\S]*step_production_labor_stewards[\s\S]*step_construction_labor_stewards/,
);

console.log(
  `processor labor rotation tests passed (100,000 sites: recall ${recallElapsedMs.toFixed(1)} ms, call-up ${callupElapsedMs.toFixed(1)} ms, steward ${stewardElapsedMs.toFixed(1)} ms; 20,000 spatial call-ups: ${spatialCallupElapsedMs.toFixed(1)} ms)`,
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
    processorOutputTargetPercent: 100,
    constructionPriority: 2,
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

function deliveryTrip(
  id: string,
  buildingId: string,
  targetBuildingId: string,
  cargoKind: DeliveryCargoKind,
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
    progress: 0.5,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 1,
    deliveryWorkers: 1,
    freeHaulerWorkers: 0,
    pathDistance: 10,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[]',
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

function mineralDeposit(
  nodeId: string,
  resource: 'iron' | 'salt' | 'clay',
  x: number,
  remaining: number,
  isRich: boolean,
): ResourceNodeState {
  return {
    nodeId,
    kind: 'quarry',
    resource,
    x,
    z: 0,
    remaining,
    maxYield: 100,
    isRich,
  };
}

function wildStock(
  nodeId: string,
  x: number,
  z: number,
  remaining: number,
  maxYield: number,
): ForagingNodeState {
  return {
    nodeId,
    kind: 'game',
    resource: 'game',
    x,
    z,
    remaining,
    maxYield,
  };
}
