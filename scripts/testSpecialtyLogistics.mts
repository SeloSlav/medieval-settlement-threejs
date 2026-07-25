import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ALE_SUPPLIER_KINDS,
  compareResidencesForSpecialtyDelivery,
  findRoadLinkedSupplierForResidence,
  peekNextSpecialtyDeliveryTarget,
  PRESERVED_FOOD_SUPPLIER_KINDS,
} from '../src/logistics/specialtyLogistics.ts';
import { createDefaultNeeds, mergeNeedRow } from '../src/residences/residenceNeedState.ts';
import type { BuildingState, ResidenceState } from '../src/resources/types.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';

function building(
  id: string,
  kind: BuildingState['kind'],
  x: number,
  z = 0,
): BuildingState {
  return {
    id,
    kind,
    x,
    z,
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
    assignedLabor: 1,
    constructionComplete: true,
  };
}

function residence(
  id: string,
  x: number,
  population: number,
  needKind: 'ale' | 'preservedFood',
  stock: number,
): ResidenceState {
  return {
    id,
    zoneId: 'zone',
    parcelIndex: 0,
    x,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: Math.max(10, population),
    tier: 3,
    settlementTicks: 0,
    needs: mergeNeedRow(createDefaultNeeds(), needKind, {
      stock,
      deficitTicks: 0,
    }),
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

assert.deepEqual(ALE_SUPPLIER_KINDS, ['brewery', 'monastery']);
assert.deepEqual(PRESERVED_FOOD_SUPPLIER_KINDS, ['smokehouse', 'pastoral_farmstead']);
assert.equal(PRESERVED_FOOD_SUPPLIER_KINDS.includes('granary'), false);

const home = residence('home', 0, 4, 'preservedFood', 0);
const granary = building('granary', 'granary', 1);
const farmstead = building('farmstead', 'pastoral_farmstead', 8);
const smokehouse = building('smokehouse', 'smokehouse', 20);
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [granary, smokehouse, farmstead],
    network,
    PRESERVED_FOOD_SUPPLIER_KINDS,
  )?.id,
  farmstead.id,
  'the nearest actual producer should claim preserved-food service',
);

const monastery = building('monastery', 'monastery', 5);
const brewery = building('brewery', 'brewery', 18);
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [monastery, brewery],
    network,
    ALE_SUPPLIER_KINDS,
    (candidate) => candidate.kind !== 'monastery',
  )?.id,
  brewery.id,
  'an unlinked or out-of-coverage monastery must not claim ale service',
);

const largeUrgent = residence('large-urgent', 25, 6, 'ale', 6);
const smallComfortable = residence('small-comfortable', 5, 2, 'ale', 4);
assert.ok(
  compareResidencesForSpecialtyDelivery(
    network,
    brewery,
    largeUrgent,
    smallComfortable,
    'ale',
  ) < 0,
  'delivery priority should compare runway per resident rather than raw stock',
);
assert.equal(
  peekNextSpecialtyDeliveryTarget(
    network,
    brewery,
    [smallComfortable, largeUrgent],
    'ale',
  )?.id,
  largeUrgent.id,
);

const tickContext = fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8');
assert.match(tickContext, /specialty_claims:\s*RefCell/);
assert.match(tickContext, /PRESERVED_FOOD_SUPPLIER_KINDS/);
assert.match(tickContext, /MONASTERY_COVERAGE_RADIUS/);
const expanded = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(expanded, /compare_need_delivery_candidates/);
assert.match(expanded, /specialty_supplier_for/);
const supply = fs.readFileSync('server/src/simulation/residence_needs/supply.rs', 'utf8');
assert.match(supply, /ResidenceNeedKind::PreservedFood[\s\S]*specialty_supplier_for|specialty_supplier_for[\s\S]*ResidenceNeedKind::PreservedFood/);
assert.doesNotMatch(supply, /"smokehouse",\s*"granary",\s*"monastery"/);
const residenceInspector = fs.readFileSync('src/resources/inspector/residenceRenderer.ts', 'utf8');
assert.match(
  residenceInspector,
  /formatDeliveryRoadDistance\(distance\)/,
  'household supplier rows should expose road distance for spatial optimization',
);

console.log('specialty logistics tests passed');
