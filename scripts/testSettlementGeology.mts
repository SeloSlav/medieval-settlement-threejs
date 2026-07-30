import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computeSettlementGeologyPlan,
  GEOLOGY_RUNWAY_CRITICAL_DAYS,
  GEOLOGY_RUNWAY_WATCH_DAYS,
  geologicalFiniteRunwayDays,
  mineralMineOutputPerDay,
  selectSettlementGeologyAlert,
} from '../src/economy/settlementGeology.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type GameState,
  type ResourceNodeState,
} from '../src/resources/types.ts';

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
    id: 'clay-pit-finite',
    kind: 'clay_pit',
    x: 600,
    z: 0,
    assignedLabor: 2,
    ironwork: 1,
  }),
  makeBuilding({
    id: 'clay-pit-deep',
    kind: 'clay_pit',
    x: 700,
    z: 0,
    assignedLabor: 1,
  }),
  makeBuilding({
    id: 'iron-mine-finite',
    kind: 'mine',
    x: 200,
    z: 0,
    assignedLabor: 2,
  }),
  makeBuilding({
    id: 'iron-mine-deep',
    kind: 'mine',
    x: 300,
    z: 0,
    assignedLabor: 1,
    timber: 1.5,
  }),
  makeBuilding({
    id: 'salt-mine-finite',
    kind: 'mine',
    x: 400,
    z: 0,
    assignedLabor: 1,
  }),
  makeBuilding({
    id: 'salt-mine-unbuilt',
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
  burgageZones: new Map(),
  residences: new Map(),
  backyardGardens: new Map(),
  deliveryTrips: new Map(),
  fireIncidents: new Map(),
  nextBuildingId: 1,
};

const plan = computeSettlementGeologyPlan(state, false);
const baselineMineOutput = mineralMineOutputPerDay(
  { assignedLabor: 1, ironwork: 0, timber: 0 },
  deposits[4],
  false,
);
const maintainedMineOutput = mineralMineOutputPerDay(
  { assignedLabor: 1, ironwork: 0.25, timber: 0 },
  deposits[4],
  false,
);
assert.ok(
  Math.abs(maintainedMineOutput / baselineMineOutput - 1.2) < 1e-9,
  'maintained mine tools must multiply ordinary extraction without becoming a hard requirement',
);
const maintainedRichMineOutput = mineralMineOutputPerDay(
  { assignedLabor: 1, ironwork: 0.25, timber: 0.5 },
  deposits[5],
  false,
);
assert.ok(
  Math.abs(maintainedRichMineOutput / baselineMineOutput - 1.8) < 1e-9,
  'rich geology and maintained tool bonuses must multiply instead of replacing one another',
);
assert.equal(
  mineralMineOutputPerDay(
    { assignedLabor: 1, ironwork: 0.25, timber: 0 },
    deposits[5],
    false,
  ),
  0,
  'a rich deep working must stop without one complete timber-support batch',
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
assert.equal(plan.iron.finiteReserve, 90, 'rich mineral seams must not masquerade as finite stock');
assert.equal(plan.clay.finiteReserve, 240, 'rich alluvium must not masquerade as finite stock');
assert.equal(plan.salt.finiteReserve, 50);
assert.equal(plan.stone.activeDeepSources, 1);
assert.equal(plan.stone.deepSourcesAwaitingSupports, 0);
assert.equal(plan.stone.deepSupportRunwayCycles, 6);
assert.ok(plan.stone.deepSupportTimberPerDay > 0);
assert.equal(plan.clay.activeDeepSources, 1);
assert.equal(plan.iron.activeDeepSources, 1);
assert.equal(plan.iron.deepSourcesAwaitingSupports, 0);
assert.equal(plan.iron.deepSupportRunwayCycles, 3);
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
  [540, 360, 480, 240],
  'legacy 100% policy must expose the full combined physical yard capacities',
);
assert.equal(
  geologicalFiniteRunwayDays(plan.iron),
  plan.iron.finiteReserve / plan.iron.finiteExtractionPerDay,
);
assert.equal(
  plan.salt.shortestFiniteRunwayDays,
  plan.salt.finiteReserve / plan.salt.finiteExtractionPerDay,
  'a single worked finite seam must expose its own actionable depletion runway',
);
assert.ok(GEOLOGY_RUNWAY_CRITICAL_DAYS < GEOLOGY_RUNWAY_WATCH_DAYS);
const baselineAlert = selectSettlementGeologyAlert(plan);
assert.equal(baselineAlert?.resource, 'salt');
assert.equal(baselineAlert?.level, 'critical');
assert.equal(baselineAlert?.firstAttentionBuildingId, 'salt-mine-finite');

const onlySaltWarning = {
  ...plan,
  stone: {
    ...plan.stone,
    shortestFiniteRunwayDays: null,
    firstAttentionBuildingId: null,
  },
  clay: {
    ...plan.clay,
    shortestFiniteRunwayDays: null,
    firstAttentionBuildingId: null,
  },
  iron: {
    ...plan.iron,
    shortestFiniteRunwayDays: null,
    firstAttentionBuildingId: null,
  },
};
assert.equal(
  selectSettlementGeologyAlert({
    ...onlySaltWarning,
    salt: {
      ...onlySaltWarning.salt,
      activeDeepSources: 1,
      deepExtractionPerDay: onlySaltWarning.salt.finiteExtractionPerDay,
    },
  })?.level,
  'watch',
  'a supported producing deep source must downgrade imminent surface exhaustion from crisis to labor watch',
);
assert.equal(
  selectSettlementGeologyAlert({
    ...onlySaltWarning,
    salt: {
      ...onlySaltWarning.salt,
      shortestFiniteRunwayDays: GEOLOGY_RUNWAY_WATCH_DAYS + 0.01,
    },
  }),
  null,
  'comfortable finite runways must not add HUD noise',
);

const stoneCamp = state.buildings.get('stone-camp');
const deepStoneQuarry = state.buildings.get('deep-quarry');
const finiteClayPit = state.buildings.get('clay-pit-finite');
const deepClayPit = state.buildings.get('clay-pit-deep');
const finiteIronMine = state.buildings.get('iron-mine-finite');
const deepIronMine = state.buildings.get('iron-mine-deep');
const finiteSaltMine = state.buildings.get('salt-mine-finite');
assert.ok(stoneCamp);
assert.ok(deepStoneQuarry);
assert.ok(finiteClayPit);
assert.ok(deepClayPit);
assert.ok(finiteIronMine);
assert.ok(deepIronMine);
assert.ok(finiteSaltMine);
Object.assign(stoneCamp, { processorOutputTargetPercent: 25, stone: 45 });
Object.assign(deepStoneQuarry, { processorOutputTargetPercent: 25, stone: 110 });
Object.assign(finiteClayPit, { processorOutputTargetPercent: 25, clay: 45 });
Object.assign(deepClayPit, { processorOutputTargetPercent: 25, clay: 45 });
Object.assign(finiteIronMine, { processorOutputTargetPercent: 25, iron: 60 });
Object.assign(deepIronMine, { processorOutputTargetPercent: 25, iron: 60 });
Object.assign(finiteSaltMine, { processorOutputTargetPercent: 25, salt: 60 });
const targetHeldPlan = computeSettlementGeologyPlan(state, false);
assert.deepEqual(
  [
    targetHeldPlan.stone.operatingExtractionSites,
    targetHeldPlan.clay.operatingExtractionSites,
    targetHeldPlan.iron.operatingExtractionSites,
    targetHeldPlan.salt.operatingExtractionSites,
  ],
  [0, 0, 0, 0],
  'yard ceilings must remove deliberately held works from current extraction forecasts',
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
assert.equal(targetHeldPlan.stone.yardTarget, 135);
assert.equal(targetHeldPlan.stone.yardStock, 155);
assert.equal(targetHeldPlan.stone.yardHeadroom, 0);
assert.equal(
  targetHeldPlan.stone.yardSurplusAboveTarget,
  20,
  'lowering a target must report, not erase, output already held above it',
);
assert.equal(targetHeldPlan.stone.finiteExtractionPerDay, 0);
assert.equal(targetHeldPlan.stone.deepExtractionPerDay, 0);
assert.equal(targetHeldPlan.stone.deepSupportTimberPerDay, 0);
assert.equal(targetHeldPlan.iron.deepSupportTimberPerDay, 0);
assert.equal(targetHeldPlan.stone.firstTargetPausedBuildingId, 'stone-camp');
stoneCamp.stone = 44;
const reopenedYardPlan = computeSettlementGeologyPlan(state, false);
assert.equal(reopenedYardPlan.stone.yardHeadroom, 1);
assert.equal(reopenedYardPlan.stone.staffedTargetPausedSites, 1);
assert.equal(reopenedYardPlan.stone.operatingExtractionSites, 1);
assert.ok(reopenedYardPlan.stone.finiteExtractionPerDay > 0);

for (const [building, commodity] of [
  [stoneCamp, 'stone'],
  [deepStoneQuarry, 'stone'],
  [finiteClayPit, 'clay'],
  [deepClayPit, 'clay'],
  [finiteIronMine, 'iron'],
  [deepIronMine, 'iron'],
  [finiteSaltMine, 'salt'],
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
  amount: 0.5,
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
assert.equal(inboundStoneSupportPlan.stone.deepSupportRunwayCycles, 2);

deepIronMine.timber = 0;
const supportStarvedPlan = computeSettlementGeologyPlan(state, false);
assert.equal(supportStarvedPlan.iron.activeDeepSources, 0);
assert.equal(supportStarvedPlan.iron.deepExtractionPerDay, 0);
assert.equal(supportStarvedPlan.iron.deepSourcesAwaitingSupports, 1);
assert.equal(
  supportStarvedPlan.iron.firstSupportBuildingId,
  'iron-mine-deep',
);
state.deliveryTrips.set('mine-support-cart', {
  id: 'mine-support-cart',
  buildingId: 'lumber-mill-source',
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: 'iron-mine-deep',
  cargoKind: 'timber',
  amount: 0.5,
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
assert.ok(
  Math.abs(
    sabbathPlan.iron.finiteExtractionPerDay
      / plan.iron.finiteExtractionPerDay
      - 6 / 7,
  ) < 1e-9,
  'the forecast must honor the same six-day work week as production',
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
  'iron-mine-finite',
  'a staffed mine on an exhausted seam must be the first geological warning',
);
assert.equal(exhaustedPlan.clay.exhaustedFiniteDeposits, 1);
assert.equal(exhaustedPlan.clay.finiteExtractionPerDay, 0);
assert.equal(
  exhaustedPlan.clay.firstAttentionBuildingId,
  'clay-pit-finite',
  'a staffed pit on an exhausted bank must be the first clay warning',
);

state.fireIncidents.set('fire-1', {
  incidentId: 'fire-1',
  targetKind: 'building',
  targetId: 'iron-mine-deep',
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
const townHallSource = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(settlementHudSource, /data-geology-alert/);
assert.match(
  settlementHudSource,
  /selectSettlementGeologyAlert[\s\S]*setGeologyState[\s\S]*firstAttentionBuildingId/,
  'the compact HUD must derive one deterministic warning and retain its direct-inspection target',
);
assert.match(
  appSource,
  /setGeologyState\([\s\S]*computeSettlementGeologyPlan[\s\S]*clayPitThroughputMultiplier/,
  'the live HUD must use the same weather-aware geological plan as settlement administration',
);
assert.match(
  bootstrapSource,
  /setGeologyAttentionHandler[\s\S]*selectBuilding\(buildingId\)[\s\S]*focusWorldPosition/,
  'activating the warning must select and focus the actual shortest-runway extraction site',
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
