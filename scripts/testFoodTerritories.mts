import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  claimResidencesForFoodSuppliers,
  FOOD_SUPPLIER_KINDS,
  isOperationalFoodSupplier,
  localDeliveryRoute,
} from '../src/logistics/roadLogistics.ts';
import { OFFROAD_DELIVERY_SPEED_MULTIPLIER } from '../src/generated/gameBalance.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import type { BuildingState, ResidenceState } from '../src/resources/types.ts';

function building(
  id: string,
  kind: BuildingState['kind'],
  x: number,
  assignedLabor: number,
): BuildingState {
  return {
    id,
    kind,
    x,
    z: 0,
    workRadius: 100,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 80,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    polearms: 0,
    ironwork: 0,
    gold: 0,
    waterCapacity: 0,
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
    granaryAcceptsFreshFood: true,
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
    tier: 2,
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

const disconnectedNetwork = {
  getPathfinder: () => ({
    roadPathDistance: () => null,
    roadPathRoute: () => null,
  }),
} as unknown as RoadNetwork;

const offroadHome = residence('offroad-home', 0);
const offroadMarket = building('offroad-market', 'marketplace', 18, 0);
assert.equal(
  claimResidencesForFoodSuppliers(
    disconnectedNetwork,
    [offroadMarket],
    [offroadHome],
  ).get(offroadHome.id),
  offroadMarket.id,
  'a stocked Marketplace food stall must still claim an off-road household',
);
const offroadRoute = localDeliveryRoute(disconnectedNetwork, 18, 0, 0, 0);
assert.equal(offroadRoute?.offroad, true);
assert.equal(offroadRoute?.distance, 18);
assert.equal(offroadRoute?.speedMultiplier, OFFROAD_DELIVERY_SPEED_MULTIPLIER);
assert.ok(
  OFFROAD_DELIVERY_SPEED_MULTIPLIER > 0 && OFFROAD_DELIVERY_SPEED_MULTIPLIER < 1,
  'off-road delivery must remain possible but slower than a road cart',
);

assert.deepEqual(FOOD_SUPPLIER_KINDS, ['marketplace']);
for (const kind of FOOD_SUPPLIER_KINDS) {
  const deliveryLabor = kind === 'granary' ? 1 : 0;
  assert.equal(
    isOperationalFoodSupplier(building(`supplier-${kind}`, kind, 10, deliveryLabor)),
    true,
    `${kind} must participate when its delivery labor contract can move stored food`,
  );
}
assert.equal(
  isOperationalFoodSupplier(building('market', 'marketplace', 1, 0)),
  true,
  'the Marketplace itself is the stock origin while granary workers own its stalls',
);

const home = residence('home', 0);
const idleGranary = building('idle-granary', 'granary', 2, 0);
const staffedFarmstead = building('farmstead', 'pastoral_farmstead', 18, 2);
assert.equal(
  claimResidencesForFoodSuppliers(network, [idleGranary, staffedFarmstead], [home]).get(home.id),
  undefined,
  'producers and granaries must stock the Marketplace instead of delivering to homes',
);

const granary = building('granary', 'granary', 5, 2);
const market = building('market', 'marketplace', 7, 0);
const huntingCamp = building('hunter', 'hunters_hall', 25, 2);
assert.equal(
  claimResidencesForFoodSuppliers(network, [huntingCamp, granary, market], [home]).get(home.id),
  market.id,
  'centralized Marketplace stock should claim homes while granary workers own the stall',
);
const emptyWinterApiary = {
  ...building('empty-apiary', 'apiary', 2, 1),
  food: 0,
};
assert.equal(
  claimResidencesForFoodSuppliers(
    network,
    [emptyWinterApiary, huntingCamp, market],
    [home],
  ).get(home.id),
  market.id,
  'seasonal producers never bypass the food stall route',
);
assert.equal(
  claimResidencesForFoodSuppliers(network, [emptyWinterApiary], [home]).has(home.id),
  false,
  'an empty supplier is not a currently usable household route',
);
assert.equal(
  claimResidencesForFoodSuppliers(
    network,
    [building('10', 'marketplace', -5, 0), building('2', 'marketplace', 5, 0)],
    [home],
  ).get(home.id),
  '2',
  'equal routes must use numeric server-id ordering rather than lexicographic ordering',
);

const monastery = building('monastery', 'monastery', 3, 0);
assert.equal(
  claimResidencesForFoodSuppliers(
    network,
    [granary, monastery, market],
    [home],
    (supplier) => supplier.kind !== 'monastery',
  ).get(home.id),
  market.id,
  'an unlinked monastery must not bypass the Marketplace',
);
assert.equal(
  claimResidencesForFoodSuppliers(
    network,
    [granary, monastery, market],
    [home],
    () => true,
  ).get(home.id),
  market.id,
  'even linked monastery output must reach homes through a granary food stall',
);

const west = residence('west', 0);
const east = residence('east', 100);
const westGranary = building('west-market', 'marketplace', 10, 0);
const eastSwineherd = building('east-market', 'marketplace', 90, 0);
const splitClaims = claimResidencesForFoodSuppliers(
  network,
  [westGranary, eastSwineherd],
  [west, east],
);
assert.equal(splitClaims.get(west.id), westGranary.id);
assert.equal(splitClaims.get(east.id), eastSwineherd.id);

const tickContext = fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8');
assert.match(tickContext, /food_claims:\s*RefCell/);
assert.match(tickContext, /pub fn food_supplier_for/);
assert.match(tickContext, /fn build_food_claims/);
assert.match(tickContext, /MONASTERY_COVERAGE_RADIUS/);
const foodClaimsSource = tickContext.slice(
  tickContext.indexOf('fn build_food_claims'),
);
assert.match(
  foodClaimsSource,
  /is_food_supplier_operational\([\s\S]*?marketplace_has_stall_workers\([\s\S]*?ResidenceNeedKind::Food[\s\S]*?fn marketplace_has_stall_workers[\s\S]*?marketplace\.kind != "marketplace"[\s\S]*?ResidenceNeedKind::Food[\s\S]*?=> "granary"/,
  'authoritative food claims must require a Marketplace backed by granary stall workers',
);
assert.match(
  foodClaimsSource,
  /!self\.building_disabled_by_fire\(ctx, building\.id\)[\s\S]*!self\.residence_disabled_by_fire\(ctx, residence\.id\)/,
  'healthy suppliers must take over territory while damaged suppliers and homes are offline',
);
const expanded = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const harvesters = fs.readFileSync('server/src/simulation/food_supplier.rs', 'utf8');
assert.doesNotMatch(harvesters, /food_supplier_for/);
assert.doesNotMatch(harvesters, /owner_food_suppliers|claim_residences_for_food_suppliers/);
const deliveryTrips = fs.readFileSync('server/src/simulation/delivery_trips.rs', 'utf8');
assert.match(deliveryTrips, /local_delivery_route/);
assert.match(deliveryTrips, /route_speed_multiplier/);
const roadLogistics = fs.readFileSync('server/src/simulation/road_logistics.rs', 'utf8');
assert.match(roadLogistics, /OFFROAD_DELIVERY_SPEED_MULTIPLIER/);
assert.match(roadLogistics, /local_delivery_distances_from/);
const supply = fs.readFileSync('server/src/simulation/residence_needs/supply.rs', 'utf8');
assert.match(supply, /has_food_route[\s\S]{0,120}food_supplier_for/);
const marketplace = fs.readFileSync('server/src/simulation/marketplace_caravan.rs', 'utf8');
assert.doesNotMatch(
  marketplace,
  /food_supplier_for/,
  'paid emergency orders must keep their explicit household priority override',
);
const expandedInspector = fs.readFileSync('src/resources/inspector/expandedBuildingRenderer.ts', 'utf8');
assert.match(expandedInspector, /Food territory/);
assert.match(expandedInspector, /getNextFoodDeliveryTargetForSupplier/);
const livestockInspector = fs.readFileSync('src/resources/inspector/livestockBuildingRenderer.ts', 'utf8');
assert.match(livestockInspector, /Food territory/);
assert.match(livestockInspector, /Next preserved cart/);

const manyHomes = Array.from({ length: 10_000 }, (_, index) =>
  residence(`perf-home-${index}`, index * 0.5));
const suppliers = FOOD_SUPPLIER_KINDS
  .filter((kind) => kind !== 'monastery')
  .map((kind, index) => building(`perf-${kind}`, kind, index * 650, 2));
const start = performance.now();
const claims = claimResidencesForFoodSuppliers(network, suppliers, manyHomes);
const elapsedMs = performance.now() - start;
assert.equal(claims.size, manyHomes.length);
assert.ok(elapsedMs < 250, `10k unified food claims took ${elapsedMs.toFixed(1)}ms`);

console.log(`unified food territory tests passed (${elapsedMs.toFixed(1)}ms for 10k homes)`);
