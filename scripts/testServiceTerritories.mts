import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  claimResidencesForFirewoodSuppliers,
  claimResidencesForFoodSuppliers,
  claimResidencesForWells,
} from '../src/logistics/roadLogistics.ts';
import {
  findRoadLinkedSupplierForResidence,
} from '../src/logistics/specialtyLogistics.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type { BuildingState, ResidenceState } from '../src/resources/types.ts';
import { STOREHOUSE_FIREWOOD_PER_DELIVERY } from '../src/generated/gameBalance.ts';

function building(
  id: string,
  kind: BuildingState['kind'],
  x: number,
  assignedLabor: number,
  overrides: Partial<BuildingState> = {},
): BuildingState {
  return {
    id,
    kind,
    x,
    z: 0,
    workRadius: 120,
    actionCooldown: 0,
    timber: 0,
    firewood: 80,
    stone: 0,
    water: 80,
    food: 80,
    grain: 0,
    flour: 0,
    ale: 80,
    preservedFood: 80,
    honey: 0,
    wine: 0,
    polearms: 0,
    ironwork: 0,
    gold: 0,
    waterCapacity: 100,
    assignedLabor,
    constructionComplete: true,
    constructionProgress: 1,
    constructionRequiredTimber: 0,
    constructionRequiredStone: 0,
    constructionReservedTimber: 0,
    constructionReservedStone: 0,
    constructionTreasuryTimber: 0,
    constructionTreasuryStone: 0,
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
    ...overrides,
  };
}

function residence(id: string, x: number): ResidenceState {
  return {
    id,
    zoneId: 'zone',
    parcelIndex: 0,
    x,
    z: 0,
    yaw: 0,
    population: 4,
    populationCapacity: 6,
    tier: 3,
    settlementTicks: 0,
    needs: [],
    abandoned: false,
    householdWealth: 0,
  };
}

const network = {
  getPathfinder: () => ({
    roadPathDistance: (ax: number, az: number, bx: number, bz: number) =>
      Math.hypot(bx - ax, bz - az),
  }),
} as unknown as RoadNetwork;

const home = residence('home', 0);
const idleLodge = building('idle-lodge', 'woodcutters_lodge', 2, 0);
const staffedLodge = building('staffed-lodge', 'woodcutters_lodge', 20, 1);
assert.equal(
  claimResidencesForFirewoodSuppliers(network, [idleLodge, staffedLodge], [home]).get(home.id),
  staffedLodge.id,
  'an idle nearer lodge must not steal a staffed lodge territory',
);

const depot = building('depot', 'village_storehouse', 5, 2);
assert.equal(
  claimResidencesForFirewoodSuppliers(network, [staffedLodge, depot], [home]).get(home.id),
  depot.id,
  'an accepting staffed storehouse should form a household fuel territory',
);
assert.equal(
  claimResidencesForFirewoodSuppliers(
    network,
    [staffedLodge, { ...depot, storehouseAcceptsFirewood: false }],
    [home],
  ).get(home.id),
  staffedLodge.id,
  'turning off firewood acceptance should immediately relinquish the territory',
);
assert.equal(
  claimResidencesForFirewoodSuppliers(
    network,
    [
      building('10', 'woodcutters_lodge', 10, 1),
      building('2', 'woodcutters_lodge', -10, 1),
    ],
    [home],
  ).get(home.id),
  '2',
  'firewood ties must use server-compatible numeric entity ordering',
);

const idleWell = building('idle-well', 'well', 3, 0);
const staffedWell = building('staffed-well', 'well', 25, 1);
assert.equal(
  claimResidencesForWells(network, [idleWell, staffedWell], [home]).get(home.id),
  staffedWell.id,
  'well coverage must reflect its actual staffed bucket crew',
);
assert.equal(
  claimResidencesForWells(
    network,
    [
      building('10', 'well', 10, 1),
      building('2', 'well', -10, 1),
    ],
    [home],
  ).get(home.id),
  '2',
  'well ties must use server-compatible numeric entity ordering',
);

const idleCamp = building('idle-camp', 'fishing_camp', 4, 0);
const staffedCamp = building('staffed-camp', 'fishing_camp', 30, 1);
assert.equal(
  claimResidencesForFoodSuppliers(network, [idleCamp, staffedCamp], [home]).get(home.id),
  staffedCamp.id,
  'fresh-food branch claims must ignore idle producers',
);

const idleSmokehouse = building('idle-smokehouse', 'smokehouse', 3, 0);
const staffedFarmstead = building('staffed-farmstead', 'pastoral_farmstead', 18, 1);
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [idleSmokehouse, staffedFarmstead],
    network,
    'preservedFood',
  )?.id,
  staffedFarmstead.id,
);
const autonomousMonastery = building('monastery', 'monastery', 7, 0);
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [building('idle-brewery', 'brewery', 2, 0), autonomousMonastery],
    network,
    'ale',
  )?.id,
  autonomousMonastery.id,
  'the resident monastic community remains the intentional autonomous exception',
);

assert.equal(STOREHOUSE_FIREWOOD_PER_DELIVERY, 8);
const storehouseServer = fs.readFileSync('server/src/simulation/village_storehouse.rs', 'utf8');
assert.match(storehouseServer, /firewood_supplier_for/);
assert.match(storehouseServer, /STOREHOUSE_FIREWOOD_PER_DELIVERY/);
assert.match(storehouseServer, /ResidenceNeedKind::Firewood/);
assert.ok(
  storehouseServer.indexOf('dispatch_delivery_if_ready')
    < storehouseServer.indexOf('dispatch_overflow_collection_for_owner'),
  'household fuel must be considered before overflow collection',
);
const constructionTrips = fs.readFileSync('server/src/simulation/delivery_trips.rs', 'utf8');
assert.match(
  constructionTrips,
  /origin\.kind == "village_storehouse"[\s\S]{0,120}building_has_inbound_supply_trip/,
  'one storehouse crew must not run an inbound collection and construction cart simultaneously',
);
const upgrades = fs.readFileSync('server/src/reducers/residences.rs', 'utf8');
assert.match(upgrades, /is_firewood_supplier_operational/);
assert.match(upgrades, /PRESERVED_FOOD_SUPPLIER_KINDS/);
assert.doesNotMatch(upgrades, /"smokehouse",\s*"granary",\s*"monastery"/);
const storehouseInspector = fs.readFileSync('src/resources/inspector/storehouseRenderer.ts', 'utf8');
assert.match(storehouseInspector, /Duty priority/);
assert.match(storehouseInspector, /Fuel territory/);
assert.match(storehouseInspector, /claimed homes/);
const residenceInspector = fs.readFileSync('src/resources/inspector/residenceRenderer.ts', 'utf8');
assert.match(residenceInspector, /Firewood supplier/);
assert.match(residenceInspector, /accepting storehouse/);
const tickContext = fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8');
assert.match(tickContext, /firewood_claims: RefCell/);
assert.match(tickContext, /water_claims: RefCell/);
assert.match(tickContext, /pub fn firewood_supplier_for/);
assert.match(tickContext, /pub fn well_supplier_for/);
assert.match(tickContext, /fn build_firewood_claims/);
assert.match(tickContext, /fn build_water_claims/);
const lodgeServer = fs.readFileSync('server/src/simulation/woodcutters_lodge.rs', 'utf8');
const wellServer = fs.readFileSync('server/src/simulation/well.rs', 'utf8');
const recoverySupplyServer = fs.readFileSync(
  'server/src/simulation/residence_needs/supply.rs',
  'utf8',
);
for (const [label, source] of [
  ['woodcutter lodge', lodgeServer],
  ['village storehouse', storehouseServer],
] as const) {
  assert.match(source, /tick\.firewood_supplier_for/);
  assert.doesNotMatch(
    source,
    /claim_residences_for_firewood_suppliers/,
    `${label} should consume the shared per-tick territory instead of rebuilding it`,
  );
}
assert.match(wellServer, /tick\.well_supplier_for/);
assert.match(
  lodgeServer,
  /tick\.building_ids_for_kinds\(ctx,\s*lodge\.owner,\s*&\["lumber_mill"\]\)/,
  'each lodge should inspect only indexed sawmill candidates',
);
assert.doesNotMatch(
  wellServer,
  /claim_residences_for_wells/,
  'each well should consume the shared per-tick territory instead of rebuilding it',
);
assert.match(recoverySupplyServer, /firewood_supplier_for/);
assert.match(recoverySupplyServer, /well_supplier_for/);
assert.doesNotMatch(
  recoverySupplyServer,
  /claim_residences_for_(?:firewood_suppliers|wells)/,
  'abandoned-home recovery should reuse the same territory maps as deliveries',
);

const manyHomes = Array.from({ length: 10_000 }, (_, index) =>
  residence(`perf-${index}`, 30 + index * 0.25));
let roadPathCalls = 0;
const countedNetwork = {
  getPathfinder: () => ({
    roadPathDistance: (ax: number, az: number, bx: number, bz: number) => {
      roadPathCalls += 1;
      return Math.hypot(bx - ax, bz - az);
    },
  }),
} as unknown as RoadNetwork;
const firewoodSuppliers = Array.from({ length: 8 }, (_, index) =>
  building(`perf-firewood-${index}`, index % 2 === 0 ? 'woodcutters_lodge' : 'village_storehouse', index * 400, 2));
const wells = Array.from({ length: 8 }, (_, index) =>
  building(`perf-well-${index}`, 'well', index * 400, 2, { workRadius: 5_000 }));
const territoryStart = performance.now();
const firewoodClaims = claimResidencesForFirewoodSuppliers(
  countedNetwork,
  firewoodSuppliers,
  manyHomes,
);
const waterClaims = claimResidencesForWells(countedNetwork, wells, manyHomes);
const territoryElapsedMs = performance.now() - territoryStart;
assert.equal(firewoodClaims.size, manyHomes.length);
assert.equal(waterClaims.size, manyHomes.length);
assert.equal(
  roadPathCalls,
  manyHomes.length * (firewoodSuppliers.length + wells.length),
  'one cached build should perform exactly one supplier route comparison per household',
);
assert.ok(
  territoryElapsedMs < 500,
  `10k-home firewood and water territory builds took ${territoryElapsedMs.toFixed(1)}ms`,
);

const lineNodeCount = 180;
const lineNetwork = new RoadNetwork();
lineNetwork.restore({
  nextNodeId: lineNodeCount + 1,
  nextEdgeId: lineNodeCount,
  nodes: Array.from({ length: lineNodeCount }, (_, index) => ({
    id: `n${index}`,
    position: [index * 8, 0, 0] as [number, number, number],
  })),
  edges: Array.from({ length: lineNodeCount - 1 }, (_, index) => ({
    id: `e${index}`,
    startNodeId: `n${index}`,
    endNodeId: `n${index + 1}`,
    width: 4.2,
    controlPoints: [
      [index * 8, 0, 0],
      [(index + 1) * 8, 0, 0],
    ] as Array<[number, number, number]>,
    sampledPath: [
      [index * 8, 0, 0],
      [(index + 1) * 8, 0, 0],
    ] as Array<[number, number, number]>,
    length: 8,
    revision: 1,
  })),
});
const lineTargets = Array.from({ length: lineNodeCount - 1 }, (_, index) => ({
  x: (index + 1) * 8 + 1,
  z: 2,
}));
const linePathfinder = lineNetwork.getPathfinder();
const pairwiseStarted = performance.now();
const pairwiseDistances = lineTargets.map((target) =>
  linePathfinder.roadPathDistance(0, 0, target.x, target.z));
const pairwiseElapsedMs = performance.now() - pairwiseStarted;
const batchedStarted = performance.now();
const batchedDistances = linePathfinder.roadPathDistancesFrom(0, 0, lineTargets);
const batchedElapsedMs = performance.now() - batchedStarted;
assert.deepEqual(
  batchedDistances,
  pairwiseDistances,
  'client one-to-many routes must exactly preserve pairwise distance decisions',
);
assert.ok(
  batchedElapsedMs * 8 < pairwiseElapsedMs,
  `batched client routing should avoid repeated Dijkstra solves `
    + `(batch ${batchedElapsedMs.toFixed(1)}ms, pairwise ${pairwiseElapsedMs.toFixed(1)}ms)`,
);
const realRoadHomes = [
  residence('real-road-west', 40),
  residence('real-road-east', (lineNodeCount - 6) * 8),
];
const realRoadClaims = claimResidencesForFirewoodSuppliers(
  lineNetwork,
  [
    building('real-road-west-lodge', 'woodcutters_lodge', 8, 1),
    building('real-road-east-lodge', 'woodcutters_lodge', (lineNodeCount - 2) * 8, 1),
  ],
  realRoadHomes,
);
assert.equal(realRoadClaims.get('real-road-west'), 'real-road-west-lodge');
assert.equal(realRoadClaims.get('real-road-east'), 'real-road-east-lodge');

const branchNetwork = new RoadNetwork();
branchNetwork.restore({
  nextNodeId: 5,
  nextEdgeId: 3,
  nodes: [
    { id: 'west-a', position: [0, 0, 0] },
    { id: 'west-b', position: [40, 0, 0] },
    { id: 'east-a', position: [100, 0, 0] },
    { id: 'east-b', position: [140, 0, 0] },
  ],
  edges: [
    {
      id: 'west',
      startNodeId: 'west-a',
      endNodeId: 'west-b',
      width: 4,
      controlPoints: [[0, 0, 0], [40, 0, 0]],
      sampledPath: [[0, 0, 0], [40, 0, 0]],
      length: 40,
      revision: 1,
    },
    {
      id: 'east',
      startNodeId: 'east-a',
      endNodeId: 'east-b',
      width: 4,
      controlPoints: [[100, 0, 0], [140, 0, 0]],
      sampledPath: [[100, 0, 0], [140, 0, 0]],
      length: 40,
      revision: 1,
    },
  ],
});
const branchPathfinder = branchNetwork.getPathfinder();
const westComponent = branchPathfinder.roadComponentAt(5, 2);
const eastComponent = branchPathfinder.roadComponentAt(105, 2);
assert.notEqual(westComponent, null);
assert.notEqual(eastComponent, null);
assert.notEqual(westComponent, eastComponent);
assert.equal(branchPathfinder.roadComponentAt(35, 2), westComponent);
assert.equal(branchPathfinder.roadComponentAt(200, 200), null);
assert.equal(branchPathfinder.roadConnected(5, 2, 35, 2), true);
assert.equal(branchPathfinder.roadConnected(5, 2, 105, 2), false);

console.log(
  `operational service territory tests passed (${territoryElapsedMs.toFixed(1)}ms for two `
    + `10k-home, eight-supplier maps; real-road batch ${batchedElapsedMs.toFixed(1)}ms vs `
    + `${pairwiseElapsedMs.toFixed(1)}ms pairwise)`,
);
