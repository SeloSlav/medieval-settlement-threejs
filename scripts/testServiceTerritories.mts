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
const marketplace = building('market', 'marketplace', 6, 0);
assert.equal(
  claimResidencesForFirewoodSuppliers(network, [idleLodge, staffedLodge, marketplace], [home]).get(home.id),
  marketplace.id,
  'only staged Marketplace fuel should participate in household delivery claims',
);
const charcoalMarketplace = building('charcoal-market', 'marketplace', 4, 0, {
  firewood: 0,
  charcoal: 8,
});
assert.equal(
  claimResidencesForFirewoodSuppliers(network, [charcoalMarketplace], [home]).get(home.id),
  charcoalMarketplace.id,
  'Marketplace charcoal must provide the same household-fuel route accepted by authority',
);

const depot = building('depot', 'village_storehouse', 5, 2);
assert.equal(
  claimResidencesForFirewoodSuppliers(network, [staffedLodge, depot], [home]).get(home.id),
  undefined,
  'storehouse workers must stock Marketplace stalls instead of serving homes directly',
);
assert.equal(
  claimResidencesForFirewoodSuppliers(
    network,
    [{ ...marketplace, constructionComplete: false }, staffedLodge, depot],
    [home],
  ).get(home.id),
  undefined,
  'an incomplete Marketplace cannot provide household fuel service',
);
assert.equal(
  claimResidencesForFirewoodSuppliers(
    network,
    [
      building('10', 'marketplace', 10, 0),
      building('2', 'marketplace', -10, 0),
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
  idleWell.id,
  'autonomous wells should claim the nearest household regardless of legacy assigned labor',
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
  claimResidencesForFoodSuppliers(network, [idleCamp, staffedCamp, marketplace], [home]).get(home.id),
  marketplace.id,
  'fresh food must be staged at the Marketplace before a granary stall can serve it',
);

const idleSmokehouse = building('idle-smokehouse', 'smokehouse', 3, 0);
const staffedFarmstead = building('staffed-farmstead', 'pastoral_farmstead', 18, 1);
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [idleSmokehouse, staffedFarmstead, marketplace],
    network,
    'preservedFood',
  )?.id,
  marketplace.id,
  'stored cured food must be delivered from a Marketplace food stall',
);
const autonomousMonastery = building('monastery', 'monastery', 7, 0);
const staffedTavern = building('tavern', 'tavern', 12, 1);
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [building('idle-brewery', 'brewery', 2, 0), autonomousMonastery, marketplace, staffedTavern],
    network,
    'ale',
  )?.id,
  staffedTavern.id,
  'finished beverages must be served from a staffed Tavern, not a Marketplace stall',
);

assert.equal(STOREHOUSE_FIREWOOD_PER_DELIVERY, 8);
const storehouseServer = fs.readFileSync('server/src/simulation/village_storehouse.rs', 'utf8');
assert.match(storehouseServer, /step_storehouse_market_stalls/);
assert.match(storehouseServer, /STOREHOUSE_FIREWOOD_PER_DELIVERY/);
assert.match(storehouseServer, /CommodityKind::Firewood/);
assert.ok(
  storehouseServer.indexOf('step_storehouse_market_stalls')
    < storehouseServer.indexOf('dispatch_overflow_collection_for_owner'),
  'stall stocking must be considered before overflow collection',
);
const constructionTrips = fs.readFileSync('server/src/simulation/delivery_trips.rs', 'utf8');
assert.match(
  constructionTrips,
  /origin\.kind == "village_storehouse"[\s\S]{0,120}building_has_inbound_supply_trip/,
  'one storehouse crew must not run an inbound collection and construction cart simultaneously',
);
const upgrades = fs.readFileSync('server/src/reducers/residences.rs', 'utf8');
assert.match(upgrades, /residence_promotion_needs\(residence\.tier\)/);
assert.match(
  upgrades,
  /ResidenceNeedKind::Firewood[\s\S]*building\.kind == "marketplace"/,
  'promotion should use the same stocked Marketplace firewood outlet as live household service',
);
assert.doesNotMatch(upgrades, /PRESERVED_FOOD_PRODUCER_KINDS/);
assert.doesNotMatch(upgrades, /"smokehouse",\s*"granary",\s*"monastery"/);
const storehouseInspector = fs.readFileSync('src/resources/inspector/storehouseRenderer.ts', 'utf8');
assert.match(storehouseInspector, /Duty priority/);
assert.match(storehouseInspector, /Fuel territory/);
assert.match(storehouseInspector, /winter-night fuel floor/);
const residenceInspector = fs.readFileSync('src/resources/inspector/residenceRenderer.ts', 'utf8');
assert.match(residenceInspector, /Heating supplier/);
assert.match(residenceInspector, /Connected Marketplace checks/);
assert.match(residenceInspector, /Beverage service/);
const tickContext = fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8');
assert.match(tickContext, /water_claims: RefCell/);
assert.match(tickContext, /pub fn well_supplier_for/);
assert.match(tickContext, /fn build_water_claims/);
assert.doesNotMatch(
  tickContext,
  /firewood_claims: RefCell|pub fn firewood_supplier_for|fn build_firewood_claims/,
  'routine firewood territory now belongs to staffed Marketplace goods stalls',
);
const lodgeServer = fs.readFileSync('server/src/simulation/woodcutters_lodge.rs', 'utf8');
const wellServer = fs.readFileSync('server/src/simulation/well.rs', 'utf8');
assert.doesNotMatch(lodgeServer, /tick\.firewood_supplier_for/);
assert.doesNotMatch(storehouseServer, /tick\.firewood_supplier_for/);
const householdDistribution = fs.readFileSync(
  'server/src/simulation/household_distribution.rs',
  'utf8',
);
assert.match(householdDistribution, /tick\.well_supplier_for/);
const marketplaceCaravan = fs.readFileSync(
  'server/src/simulation/marketplace_caravan.rs',
  'utf8',
);
assert.match(
  tickContext,
  /MARKET_GOODS_STALL_NEEDS[\s\S]*ResidenceNeedKind::Firewood[\s\S]*MARKET_STALL_GROUP_GOODS[\s\S]*"village_storehouse"/,
  'storehouse workers must own Marketplace firewood stalls',
);
assert.match(marketplaceCaravan, /marketplace_stall_workplace_id/);
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
  building(`perf-firewood-${index}`, 'marketplace', index * 400, 0));
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
const longEdgeNetwork = new RoadNetwork();
longEdgeNetwork.restore({
  nextNodeId: 3,
  nextEdgeId: 2,
  nodes: [
    { id: 'west', position: [8_600, 0, 0] },
    { id: 'east', position: [9_000, 0, 0] },
  ],
  edges: [{
    id: 'long-edge',
    startNodeId: 'west',
    endNodeId: 'east',
    width: 4.2,
    controlPoints: [[8_600, 0, 0], [9_000, 0, 0]],
    sampledPath: [[8_600, 0, 0], [9_000, 0, 0]],
    length: 400,
    revision: 1,
  }],
});
const interiorRoute = longEdgeNetwork.getPathfinder().roadPathRoute(
  8_650,
  14,
  8_785,
  14,
);
assert.equal(interiorRoute?.distance, 163);
assert.deepEqual(interiorRoute?.polyline, [
  { x: 8_650, z: 14 },
  { x: 8_650, z: 0 },
  { x: 8_785, z: 0 },
  { x: 8_785, z: 14 },
]);
assert.deepEqual(
  longEdgeNetwork.getPathfinder().roadPathDistancesFrom(
    8_650,
    14,
    [{ x: 8_785, z: 14 }],
  ),
  [163],
  'batched client forecasts must use the same interior-edge route as authoritative carts',
);

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
    building('real-road-west-market', 'marketplace', 8, 0),
    building('real-road-east-market', 'marketplace', (lineNodeCount - 2) * 8, 0),
  ],
  realRoadHomes,
);
assert.equal(realRoadClaims.get('real-road-west'), 'real-road-west-market');
assert.equal(realRoadClaims.get('real-road-east'), 'real-road-east-market');

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
