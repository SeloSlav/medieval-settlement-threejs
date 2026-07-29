import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ALE_SUPPLIER_KINDS,
  CLOTH_SUPPLIER_KINDS,
  POTTERY_SUPPLIER_KINDS,
  compareResidencesForSpecialtyDelivery,
  findRoadLinkedSupplierForResidence,
  peekNextSpecialtyDeliveryTarget,
  PRESERVED_FOOD_SUPPLIER_KINDS,
  residenceAleRunwayDays,
  residenceClothRunwayDays,
  residencePreservedFoodRunwayDays,
  residencePotteryRunwayDays,
  SPECIALTY_CONSUMPTION_SECONDS_PER_DAY,
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
    ale: 80,
    preservedFood: 80,
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
  needKind: 'ale' | 'preservedFood' | 'cloth' | 'pottery',
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
assert.deepEqual(CLOTH_SUPPLIER_KINDS, ['weaver']);
assert.deepEqual(POTTERY_SUPPLIER_KINDS, ['potter_kiln']);
assert.equal(PRESERVED_FOOD_SUPPLIER_KINDS.includes('granary'), false);
assert.equal(SPECIALTY_CONSUMPTION_SECONDS_PER_DAY, 70);
assert.equal(
  residencePreservedFoodRunwayDays(
    residence('preserved-runway', 0, 4, 'preservedFood', 7),
  ),
  6.25,
);
assert.ok(
  Math.abs(
    (
      residencePreservedFoodRunwayDays(
        residence('winter-preserved-runway', 0, 4, 'preservedFood', 7),
        1.75,
      ) ?? 0
    ) - 6.25 / 1.75,
  ) < 1e-9,
  'current winter rotation must shorten the displayed household runway',
);
assert.equal(
  residenceAleRunwayDays(residence('ale-runway', 0, 4, 'ale', 7)),
  10,
);
assert.ok(
  Math.abs(
    (residenceClothRunwayDays(
      residence('cloth-runway', 0, 10, 'cloth', 1),
    ) ?? 0) - 7.936507936507937,
  ) < 1e-9,
  'household cloth runway must use the same 14-hour consumption window as the server',
);
assert.ok(
  Math.abs(
    (residencePotteryRunwayDays(
      residence('pottery-runway', 0, 4, 'pottery', 2),
    ) ?? 0) - (500 / 70),
  ) < 1e-9,
  'household pottery runway must model slow vessel breakage on the workday cadence',
);

const home = residence('home', 0, 4, 'preservedFood', 0);
const granary = building('granary', 'granary', 1);
const farmstead = building('farmstead', 'pastoral_farmstead', 8);
const smokehouse = building('smokehouse', 'smokehouse', 20);
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [granary, smokehouse, farmstead],
    network,
    'preservedFood',
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
    'ale',
    (candidate) => candidate.kind !== 'monastery',
  )?.id,
  brewery.id,
  'an unlinked or out-of-coverage monastery must not claim ale service',
);
const weaver = { ...building('weaver', 'weaver', 6), cloth: 12 };
assert.equal(
  findRoadLinkedSupplierForResidence(home, [brewery, weaver], network, 'cloth')?.id,
  weaver.id,
  'only a staffed road-linked weaver should claim household textile service',
);
const emptySmokehouse = { ...building('empty-smokehouse', 'smokehouse', 2), preservedFood: 0 };
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [emptySmokehouse, farmstead],
    network,
    'preservedFood',
  )?.id,
  farmstead.id,
  'an empty smokehouse must yield preserved-food service to stocked holdings',
);
const emptyBrewery = { ...building('empty-brewery', 'brewery', 2), ale: 0 };
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [emptyBrewery, monastery],
    network,
    'ale',
  )?.id,
  monastery.id,
  'an empty brewhouse must not block stocked monastic ale',
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
assert.match(
  tickContext,
  /ResidenceNeedKind::Ale => \{[\s\S]*?building\.kind == "monastery"[\s\S]*?monastery_feast_surplus\([\s\S]*?MONASTERY_FEAST_ALE[\s\S]*?building\.ale[\s\S]*?available > 1e-6/,
  'ale claims must release empty workshops while excluding protected monastery feast stock',
);
const potter = { ...building('potter', 'potter_kiln', 4), pottery: 12 };
assert.equal(
  findRoadLinkedSupplierForResidence(home, [weaver, potter], network, 'pottery')?.id,
  potter.id,
  'only a stocked road-linked potter should claim household-ware service',
);
assert.match(
  tickContext,
  /ResidenceNeedKind::PreservedFood => building\.preserved_food > 1e-6/,
);
assert.match(tickContext, /ResidenceNeedKind::Cloth => building\.cloth > 1e-6/);
assert.match(tickContext, /ResidenceNeedKind::Pottery => building\.pottery > 1e-6/);
const expanded = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const needDispatch = expanded.slice(
  expanded.indexOf('fn collect_need_delivery_targets'),
  expanded.indexOf('fn need_to_commodity'),
);
assert.match(needDispatch, /select_residence_for_need_delivery/);
assert.match(needDispatch, /has_delivery_stock_room/);
assert.doesNotMatch(needDispatch, /targets\.sort_by/);
assert.match(expanded, /specialty_supplier_for/);
assert.match(
  expanded,
  /step_potter_kiln[\s\S]*?invalidate_specialty_claims\([\s\S]*?ResidenceNeedKind::Pottery[\s\S]*?dispatch_need\([\s\S]*?ResidenceNeedKind::Pottery/,
  'new kiln output must invalidate claims and dispatch household pottery before downstream overflow',
);
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
