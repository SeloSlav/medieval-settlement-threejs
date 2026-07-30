import assert from 'node:assert/strict';
import {
  computeSettlementGeologyPlan,
  geologicalFiniteRunwayDays,
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
assert.equal(plan.clay.activeDeepSources, 1);
assert.equal(plan.iron.activeDeepSources, 1);
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
assert.equal(
  geologicalFiniteRunwayDays(plan.iron),
  plan.iron.finiteReserve / plan.iron.finiteExtractionPerDay,
);

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
