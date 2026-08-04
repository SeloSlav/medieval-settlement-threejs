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
const offroadForager = building('offroad-forager', 'foragers_shed', 18, 1);
assert.equal(
  claimResidencesForFoodSuppliers(
    disconnectedNetwork,
    [offroadForager],
    [offroadHome],
  ).get(offroadHome.id),
  offroadForager.id,
  'a staffed stocked food producer must still claim an off-road household',
);
const offroadRoute = localDeliveryRoute(disconnectedNetwork, 18, 0, 0, 0);
assert.equal(offroadRoute?.offroad, true);
assert.equal(offroadRoute?.distance, 18);
assert.equal(offroadRoute?.speedMultiplier, OFFROAD_DELIVERY_SPEED_MULTIPLIER);
assert.ok(
  OFFROAD_DELIVERY_SPEED_MULTIPLIER > 0 && OFFROAD_DELIVERY_SPEED_MULTIPLIER < 1,
  'off-road delivery must remain possible but slower than a road cart',
);

assert.deepEqual(FOOD_SUPPLIER_KINDS, [
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'bakery',
  'granary',
  'apiary',
  'vineyard',
  'pastoral_farmstead',
  'swineherd',
  'monastery',
]);
for (const kind of FOOD_SUPPLIER_KINDS) {
  const deliveryLabor = kind === 'granary' ? 1 : 0;
  assert.equal(
    isOperationalFoodSupplier(building(`supplier-${kind}`, kind, 10, deliveryLabor)),
    true,
    `${kind} must participate when its delivery labor contract can move stored food`,
  );
}
assert.equal(
  isOperationalFoodSupplier(building('market', 'marketplace', 1, 3)),
  false,
  'paid marketplace emergency carts must remain outside routine territories',
);

const home = residence('home', 0);
const idleGranary = building('idle-granary', 'granary', 2, 0);
const staffedFarmstead = building('farmstead', 'pastoral_farmstead', 18, 2);
assert.equal(
  claimResidencesForFoodSuppliers(network, [idleGranary, staffedFarmstead], [home]).get(home.id),
  staffedFarmstead.id,
  'an idle granary must not hide a functioning pastoral food route',
);

const granary = building('granary', 'granary', 5, 2);
const huntingCamp = building('hunter', 'hunters_hall', 25, 2);
assert.equal(
  claimResidencesForFoodSuppliers(network, [huntingCamp, granary], [home]).get(home.id),
  granary.id,
  'centralized food storage should claim nearby homes when a granary hauler is staffed',
);
const emptyWinterApiary = {
  ...building('empty-apiary', 'apiary', 2, 1),
  food: 0,
};
assert.equal(
  claimResidencesForFoodSuppliers(
    network,
    [emptyWinterApiary, huntingCamp],
    [home],
  ).get(home.id),
  huntingCamp.id,
  'an empty seasonal producer must yield its branch to a stocked supplier',
);
assert.equal(
  claimResidencesForFoodSuppliers(network, [emptyWinterApiary], [home]).has(home.id),
  false,
  'an empty supplier is not a currently usable household route',
);
assert.equal(
  claimResidencesForFoodSuppliers(
    network,
    [building('10', 'granary', -5, 2), building('2', 'granary', 5, 2)],
    [home],
  ).get(home.id),
  '2',
  'equal routes must use numeric server-id ordering rather than lexicographic ordering',
);

const monastery = building('monastery', 'monastery', 3, 0);
assert.equal(
  claimResidencesForFoodSuppliers(
    network,
    [granary, monastery],
    [home],
    (supplier) => supplier.kind !== 'monastery',
  ).get(home.id),
  granary.id,
  'an unlinked monastery must not claim charity territory',
);
assert.equal(
  claimResidencesForFoodSuppliers(
    network,
    [granary, monastery],
    [home],
    () => true,
  ).get(home.id),
  monastery.id,
  'a parish-linked monastery may become the nearest routine food supplier',
);

const west = residence('west', 0);
const east = residence('east', 100);
const westGranary = building('west-granary', 'granary', 10, 2);
const eastSwineherd = building('east-swineherd', 'swineherd', 90, 2);
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
  /is_food_supplier_operational[\s\S]*?building\.kind == "monastery"[\s\S]*?monastery_feast_surplus\([\s\S]*?MONASTERY_FEAST_FOOD[\s\S]*?building\.food[\s\S]*?> 1e-6/,
  'authoritative food claims must relinquish empty suppliers and protected monastery feast stock',
);
assert.match(
  foodClaimsSource,
  /!self\.building_disabled_by_fire\(ctx, building\.id\)[\s\S]*!self\.residence_disabled_by_fire\(ctx, residence\.id\)/,
  'healthy suppliers must take over territory while damaged suppliers and homes are offline',
);
const expanded = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(
  expanded,
  /ResidenceNeedKind::Food\s*=>[\s\S]{0,120}food_supplier_for/,
  'granaries, seasonal producers, and livestock must honor the shared food claim',
);
const harvesters = fs.readFileSync('server/src/simulation/food_supplier.rs', 'utf8');
assert.match(harvesters, /food_supplier_for/);
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
