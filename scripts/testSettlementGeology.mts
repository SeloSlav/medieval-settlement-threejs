import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computeSettlementGeologyPlan,
  geologicalFiniteRunwayDays,
  miningPitOutputPerDay,
  mineralMineOutputPerDay,
} from '../src/economy/settlementGeology.ts';
import {
  BUILDING_DEFINITIONS,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
  RICH_MINE_THROUGHPUT_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type GameState,
  type ResourceNodeState,
} from '../src/resources/types.ts';
import { averageProductiveCalendarDayShare } from '../src/world/holidayCalendar.ts';

function makeBuilding(
  partial: Partial<BuildingState> & Pick<BuildingState, 'id' | 'kind' | 'x' | 'z'>,
): BuildingState {
  return {
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
    storehouseAcceptsTimber: false,
    storehouseAcceptsStone: false,
    storehouseAcceptsFirewood: false,
    ...partial,
  };
}

function deposit(
  nodeId: string,
  resource: 'stone' | 'clay' | 'iron' | 'salt',
  x: number,
  remaining: number,
  maxYield: number,
  isRich = false,
): ResourceNodeState {
  return {
    nodeId,
    kind: 'quarry',
    resource,
    remaining,
    maxYield,
    x,
    z: 0,
    isRich,
  };
}

const deposits = [
  deposit('quarry-stone-ordinary', 'stone', 0, 120, 200),
  deposit('quarry-stone-rich', 'stone', 100, 60, 100, true),
  deposit('clay-ordinary-0', 'clay', 600, 240, 480),
  deposit('clay-rich-0', 'clay', 700, 1_440, 1_440, true),
  deposit('deposit-iron-ordinary', 'iron', 200, 90, 120),
  deposit('deposit-iron-rich', 'iron', 300, 160, 160, true),
  deposit('deposit-salt-ordinary', 'salt', 400, 50, 80),
  deposit('deposit-salt-rich', 'salt', 500, 180, 180, true),
];
const buildings = [
  makeBuilding({
    id: 'stone-camp',
    kind: 'stone_quarry',
    x: 5,
    z: 0,
    workRadius: 80,
    assignedLabor: 2,
    ironwork: 1,
  }),
  makeBuilding({
    id: 'deep-quarry',
    kind: 'large_quarry',
    x: 100,
    z: 0,
    assignedLabor: 1,
    ironwork: 1,
    timber: 1.5,
  }),
  makeBuilding({
    id: 'clay-surface-pit',
    kind: 'stone_quarry',
    x: 600,
    z: 0,
    workRadius: 30,
    assignedLabor: 2,
    ironwork: 1,
  }),
  makeBuilding({
    id: 'clay-mineworks',
    kind: 'mine',
    x: 700,
    z: 0,
    assignedLabor: 1,
    timber: 1.5,
  }),
  makeBuilding({
    id: 'iron-surface-pit',
    kind: 'stone_quarry',
    x: 200,
    z: 0,
    workRadius: 30,
    assignedLabor: 2,
  }),
  makeBuilding({
    id: 'iron-mineworks',
    kind: 'mine',
    x: 300,
    z: 0,
    assignedLabor: 1,
    timber: 1.5,
  }),
  makeBuilding({
    id: 'salt-rich-surface-pit',
    kind: 'stone_quarry',
    x: 500,
    z: 0,
    workRadius: 30,
    assignedLabor: 1,
  }),
  makeBuilding({
    id: 'salt-mineworks-unbuilt',
    kind: 'mine',
    x: 500,
    z: 0,
    assignedLabor: 3,
    constructionComplete: false,
  }),
];

const state: GameState = {
  seed: 1,
  tick: 0,
  stockpile: createEmptyStockpile(),
  quarries: new Map(deposits.map((candidate) => [candidate.nodeId, candidate])),
  foragingNodes: new Map(),
  trees: new Map(),
  buildings: new Map(buildings.map((building) => [building.id, building])),
  farmFields: new Map(),
  pastures: new Map(),
  livestockHerds: new Map(),
  stableOxen: new Map(),
  burgageZones: new Map(),
  residences: new Map(),
  backyardGardens: new Map(),
  deliveryTrips: new Map(),
  fireIncidents: new Map(),
  nextBuildingId: 1,
};

const plan = computeSettlementGeologyPlan(state, false);
const baselineSurfaceOutput = miningPitOutputPerDay(
  { assignedLabor: 1, ironwork: 0 },
  deposits[4],
  false,
);
const baselineMineOutput = mineralMineOutputPerDay(
  { assignedLabor: 1, ironwork: 0, timber: 1 },
  deposits[5],
  false,
);
const maintainedMineOutput = mineralMineOutputPerDay(
  { assignedLabor: 1, ironwork: 1, timber: 1 },
  deposits[5],
  false,
);
assert.ok(
  Math.abs(maintainedMineOutput / baselineMineOutput - 1.2) < 1e-9,
  'maintained Mineworks tools must multiply rich extraction without becoming a hard requirement',
);
assert.ok(
  Math.abs(
    maintainedMineOutput / baselineSurfaceOutput
      - RICH_MINE_THROUGHPUT_MULTIPLIER
        * CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
        * BUILDING_DEFINITIONS.stone_quarry.harvestInterval
        / BUILDING_DEFINITIONS.mine.harvestInterval,
  ) < 1e-9,
  'Mineworks richness and maintained tools must multiply before its deeper-work interval is applied',
);
assert.equal(
  mineralMineOutputPerDay(
    { assignedLabor: 1, ironwork: 1, timber: 1 },
    deposits[4],
    false,
  ),
  0,
  'ordinary iron belongs to the Mining Camp and must not produce through Mineworks',
);
assert.equal(
  mineralMineOutputPerDay(
    { assignedLabor: 1, ironwork: 1, timber: 0 },
    deposits[5],
    false,
  ),
  0,
  'Mineworks must stop without one complete timber-support batch',
);
assert.deepEqual(
  [plan.stone.deposits, plan.clay.deposits, plan.iron.deposits, plan.salt.deposits],
  [2, 2, 2, 2],
  'the ledger must count every physical deposit',
);
assert.deepEqual(
  [plan.stone.richDeposits, plan.clay.richDeposits, plan.iron.richDeposits, plan.salt.richDeposits],
  [1, 1, 1, 1],
);
assert.equal(
  plan.stone.finiteReserve,
  180,
  'rich stone still has a finite surface outcrop beside its deep source',
);
assert.equal(
  plan.iron.finiteReserve,
  250,
  'rich iron nodes must expose their finite surface seam beside the deep source',
);
assert.equal(
  plan.clay.finiteReserve,
  1_680,
  'rich clay nodes must expose their finite surface deposit beside the deep source',
);
assert.equal(
  plan.salt.finiteReserve,
  230,
  'rich salt nodes must expose their finite surface seam beside the deep source',
);
assert.equal(plan.stone.activeDeepSources, 1);
assert.equal(plan.stone.deepSourcesAwaitingSupports, 0);
assert.equal(plan.stone.deepSupportRunwayCycles, 1.5);
assert.ok(plan.stone.deepSupportTimberPerDay > 0);
assert.equal(plan.clay.activeDeepSources, 1);
assert.equal(plan.iron.activeDeepSources, 1);
assert.equal(plan.iron.deepSourcesAwaitingSupports, 0);
assert.equal(plan.iron.deepSupportRunwayCycles, 1.5);
assert.ok(plan.iron.deepSupportTimberPerDay > 0);
assert.equal(
  plan.salt.activeDeepSources,
  0,
  'an unbuilt mine must not activate a rich salt source',
);
assert.ok(plan.stone.finiteExtractionPerDay > 0);
assert.ok(plan.stone.deepExtractionPerDay > 0);
assert.ok(plan.clay.finiteExtractionPerDay > 0);
assert.ok(plan.clay.deepExtractionPerDay > 0);
assert.ok(plan.iron.finiteExtractionPerDay > 0);
assert.ok(plan.iron.deepExtractionPerDay > 0);
assert.ok(plan.salt.finiteExtractionPerDay > 0);
assert.equal(plan.salt.deepExtractionPerDay, 0);
assert.ok(
  plan.salt.shortestFiniteRunwayDays !== null,
  'a Mining Camp must consume the finite surface cap even when it belongs to a rich marker',
);
assert.deepEqual(
  [
    plan.stone.operatingExtractionSites,
    plan.clay.operatingExtractionSites,
    plan.iron.operatingExtractionSites,
    plan.salt.operatingExtractionSites,
  ],
  [2, 2, 2, 1],
  'the ledger must distinguish genuinely operating works from merely built or staffed sites',
);
assert.deepEqual(
  [plan.stone.yardStock, plan.clay.yardStock, plan.iron.yardStock, plan.salt.yardStock],
  [0, 0, 0, 0],
);
assert.deepEqual(
  [plan.stone.yardTarget, plan.clay.yardTarget, plan.iron.yardTarget, plan.salt.yardTarget],
  [540, 420, 420, 180],
  'legacy 100% policy must expose the full combined physical yard capacities',
);
assert.equal(
  geologicalFiniteRunwayDays(plan.iron),
  plan.iron.finiteReserve / plan.iron.finiteExtractionPerDay,
);
assert.equal(
  plan.salt.shortestFiniteRunwayDays,
  deposits[7].remaining / plan.salt.finiteExtractionPerDay,
  'a worked rich marker surface layer must expose its own actionable depletion runway',
);

const stoneCamp = state.buildings.get('stone-camp');
const deepStoneQuarry = state.buildings.get('deep-quarry');
const claySurfacePit = state.buildings.get('clay-surface-pit');
const clayMineworks = state.buildings.get('clay-mineworks');
const ironSurfacePit = state.buildings.get('iron-surface-pit');
const deepIronMine = state.buildings.get('iron-mineworks');
const richSaltSurfacePit = state.buildings.get('salt-rich-surface-pit');
assert.ok(stoneCamp);
assert.ok(deepStoneQuarry);
assert.ok(claySurfacePit);
assert.ok(clayMineworks);
assert.ok(ironSurfacePit);
assert.ok(deepIronMine);
assert.ok(richSaltSurfacePit);
Object.assign(stoneCamp, { processorOutputTargetPercent: 25, stone: 180 });
Object.assign(deepStoneQuarry, { processorOutputTargetPercent: 25, stone: 360 });
Object.assign(claySurfacePit, { processorOutputTargetPercent: 25, clay: 180 });
Object.assign(clayMineworks, { processorOutputTargetPercent: 25, clay: 240 });
Object.assign(ironSurfacePit, { processorOutputTargetPercent: 25, iron: 180 });
Object.assign(deepIronMine, { processorOutputTargetPercent: 25, iron: 240 });
Object.assign(richSaltSurfacePit, { processorOutputTargetPercent: 25, salt: 180 });
const targetHeldPlan = computeSettlementGeologyPlan(state, false);
assert.deepEqual(
  [
    targetHeldPlan.stone.operatingExtractionSites,
    targetHeldPlan.clay.operatingExtractionSites,
    targetHeldPlan.iron.operatingExtractionSites,
    targetHeldPlan.salt.operatingExtractionSites,
  ],
  [0, 0, 0, 0],
  'physically full yards must remove works from current extraction forecasts',
);
assert.deepEqual(
  [
    targetHeldPlan.stone.staffedTargetPausedSites,
    targetHeldPlan.clay.staffedTargetPausedSites,
    targetHeldPlan.iron.staffedTargetPausedSites,
    targetHeldPlan.salt.staffedTargetPausedSites,
  ],
  [2, 2, 2, 1],
);
assert.equal(targetHeldPlan.stone.yardTarget, 540);
assert.equal(targetHeldPlan.stone.yardStock, 540);
assert.equal(targetHeldPlan.stone.yardHeadroom, 0);
assert.equal(
  targetHeldPlan.stone.yardSurplusAboveTarget,
  0,
  'legacy extraction target values must not lower physical yard capacity',
);
assert.equal(targetHeldPlan.stone.finiteExtractionPerDay, 0);
assert.equal(targetHeldPlan.stone.deepExtractionPerDay, 0);
assert.equal(targetHeldPlan.stone.deepSupportTimberPerDay, 0);
assert.equal(targetHeldPlan.iron.deepSupportTimberPerDay, 0);
assert.equal(targetHeldPlan.stone.firstTargetPausedBuildingId, 'stone-camp');
stoneCamp.stone = 179;
const reopenedYardPlan = computeSettlementGeologyPlan(state, false);
assert.equal(reopenedYardPlan.stone.yardHeadroom, 1);
assert.equal(reopenedYardPlan.stone.staffedTargetPausedSites, 1);
assert.equal(reopenedYardPlan.stone.operatingExtractionSites, 1);
assert.ok(reopenedYardPlan.stone.finiteExtractionPerDay > 0);

for (const [building, commodity] of [
  [stoneCamp, 'stone'],
  [deepStoneQuarry, 'stone'],
  [claySurfacePit, 'clay'],
  [clayMineworks, 'clay'],
  [ironSurfacePit, 'iron'],
  [deepIronMine, 'iron'],
  [richSaltSurfacePit, 'salt'],
] as const) {
  building.processorOutputTargetPercent = 100;
  building[commodity] = 0;
}

deepStoneQuarry.timber = 0;
const stoneSupportStarvedPlan = computeSettlementGeologyPlan(state, false);
assert.equal(stoneSupportStarvedPlan.stone.activeDeepSources, 0);
assert.equal(stoneSupportStarvedPlan.stone.deepExtractionPerDay, 0);
assert.equal(stoneSupportStarvedPlan.stone.deepSourcesAwaitingSupports, 1);
assert.equal(
  stoneSupportStarvedPlan.stone.firstSupportBuildingId,
  'deep-quarry',
);
state.deliveryTrips.set('quarry-support-cart', {
  id: 'quarry-support-cart',
  buildingId: 'lumber-mill-source',
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: 'deep-quarry',
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
  freeHaulerWorkers: 0,
  pathDistance: 1,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
});
const inboundStoneSupportPlan = computeSettlementGeologyPlan(state, false);
assert.equal(inboundStoneSupportPlan.stone.activeDeepSources, 1);
assert.equal(inboundStoneSupportPlan.stone.deepSourcesAwaitingSupports, 0);
assert.equal(inboundStoneSupportPlan.stone.deepSupportRunwayCycles, 1);

deepIronMine.timber = 0;
const supportStarvedPlan = computeSettlementGeologyPlan(state, false);
assert.equal(supportStarvedPlan.iron.activeDeepSources, 0);
assert.equal(supportStarvedPlan.iron.deepExtractionPerDay, 0);
assert.equal(supportStarvedPlan.iron.deepSourcesAwaitingSupports, 1);
assert.equal(
  supportStarvedPlan.iron.firstSupportBuildingId,
  'iron-mineworks',
);
state.deliveryTrips.set('mine-support-cart', {
  id: 'mine-support-cart',
  buildingId: 'lumber-mill-source',
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: 'iron-mineworks',
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
  freeHaulerWorkers: 0,
  pathDistance: 1,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
});
const inboundSupportedPlan = computeSettlementGeologyPlan(state, false);
assert.equal(inboundSupportedPlan.iron.activeDeepSources, 1);
assert.equal(inboundSupportedPlan.iron.deepSourcesAwaitingSupports, 0);
assert.equal(inboundSupportedPlan.iron.deepSupportRunwayCycles, 1);

const sabbathPlan = computeSettlementGeologyPlan(state, true);
const ordinaryProductiveShare = averageProductiveCalendarDayShare(false);
const sabbathProductiveShare = averageProductiveCalendarDayShare(true);
assert.ok(
  Math.abs(
    sabbathPlan.iron.finiteExtractionPerDay
      / plan.iron.finiteExtractionPerDay
      - sabbathProductiveShare / ordinaryProductiveShare,
  ) < 1e-9,
  'the forecast must honor both named holy days and the observed Sabbath',
);

const exhaustedIron = state.quarries.get('deposit-iron-ordinary');
assert.ok(exhaustedIron);
exhaustedIron.remaining = 0;
const exhaustedClay = state.quarries.get('clay-ordinary-0');
assert.ok(exhaustedClay);
exhaustedClay.remaining = 0;
const exhaustedPlan = computeSettlementGeologyPlan(state, false);
assert.equal(exhaustedPlan.iron.exhaustedFiniteDeposits, 1);
assert.equal(exhaustedPlan.iron.finiteExtractionPerDay, 0);
assert.equal(
  exhaustedPlan.iron.firstAttentionBuildingId,
  'iron-surface-pit',
  'a staffed Mining Camp on an exhausted seam must be the first geological warning',
);
assert.equal(exhaustedPlan.clay.exhaustedFiniteDeposits, 1);
assert.equal(exhaustedPlan.clay.finiteExtractionPerDay, 0);
assert.equal(
  exhaustedPlan.clay.firstAttentionBuildingId,
  'clay-surface-pit',
  'a staffed Mining Camp on an exhausted clay bank must be the first clay warning',
);

state.fireIncidents.set('fire-1', {
  incidentId: 'fire-1',
  targetKind: 'building',
  targetId: 'iron-mineworks',
  source: 'workshop',
  status: 'burning',
  severity: 0.5,
  progress: 0,
  responseProgress: 0,
  startedTick: 0,
} as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
const firePlan = computeSettlementGeologyPlan(state, false);
assert.equal(
  firePlan.iron.deepExtractionPerDay,
  0,
  'fire-disabled mines must not contribute installed extraction output',
);

const settlementHudSource = readFileSync(
  new URL('../src/ui/SettlementHud.ts', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../src/app/App.ts', import.meta.url),
  'utf8',
);
const bootstrapSource = readFileSync(
  new URL('../src/app/appBootstrap.ts', import.meta.url),
  'utf8',
);
const settlementGeologySource = readFileSync(
  new URL('../src/economy/settlementGeology.ts', import.meta.url),
  'utf8',
);
const settlementHudCssSource = readFileSync(
  new URL('../src/ui/settlementHud.css', import.meta.url),
  'utf8',
);
const polishedGameUiSource = readFileSync(
  new URL('../src/ui/polishedGameUi.css', import.meta.url),
  'utf8',
);
const townHallSource = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(
  settlementHudSource,
  /data-geology-alert|geologyAlert|setGeologyState|geologyAttention/,
  'the compact HUD must not render or manage geological warnings',
);
assert.doesNotMatch(
  settlementGeologySource,
  /selectSettlementGeologyAlert|SettlementGeologyAlert|GEOLOGY_RUNWAY_(?:WATCH|CRITICAL)_DAYS/,
  'the removed warning must not leave a dead alert-selection API behind',
);
assert.doesNotMatch(
  appSource,
  /setGeologyState|clearGeologyState/,
  'live state updates must not feed a removed HUD warning',
);
assert.doesNotMatch(
  bootstrapSource,
  /setGeologyAttentionHandler/,
  'bootstrap must not wire interaction for a removed warning',
);
assert.doesNotMatch(
  `${settlementHudCssSource}\n${polishedGameUiSource}`,
  /geology-alert/,
  'the removed warning must not retain layout or emphasis styles',
);
assert.match(
  townHallSource,
  /shortest staffed seam[\s\S]*formatGeologyRunway/,
  'the detailed ledger must expose the same shortest worked-seam runway',
);

const performanceBuildings = new Map<string, BuildingState>();
for (let index = 0; index < 100_000; index++) {
  const building = makeBuilding({
    id: `house-${index}`,
    kind: 'well',
    x: index,
    z: index,
  });
  performanceBuildings.set(building.id, building);
}
const performanceState = {
  ...state,
  buildings: performanceBuildings,
  fireIncidents: new Map(),
};
const startedAt = performance.now();
computeSettlementGeologyPlan(performanceState, false);
const elapsedMs = performance.now() - startedAt;
assert.ok(
  elapsedMs < 200,
  `100,000-building geology scan took ${elapsedMs.toFixed(1)} ms`,
);

console.log(
  `settlement geology tests passed (${elapsedMs.toFixed(1)} ms / 100k buildings)`,
);
