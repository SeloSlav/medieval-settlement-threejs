import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ALE_SUPPLIER_KINDS,
  CLOTH_SUPPLIER_KINDS,
  POTTERY_SUPPLIER_KINDS,
  compareResidencesForSpecialtyDelivery,
  findRoadLinkedSupplierForResidence,
  findRoadLinkedUpgradeSupplierForResidence,
  peekNextSpecialtyDeliveryTarget,
  PRESERVED_FOOD_PRODUCER_KINDS,
  PRESERVED_FOOD_SUPPLIER_KINDS,
  residenceAleRunwayDays,
  residenceClothRunwayDays,
  residencePreservedFoodRunwayDays,
  residencePotteryRunwayDays,
  SPECIALTY_CONSUMPTION_SECONDS_PER_DAY,
} from '../src/logistics/specialtyLogistics.ts';
import { selectDirectProcessorInputTarget } from '../src/logistics/processorInputLogistics.ts';
import { createDefaultNeeds, mergeNeedRow } from '../src/residences/residenceNeedState.ts';
import type { BuildingState, ResidenceState } from '../src/resources/types.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import { PRESERVED_FOOD_SPOILAGE_PER_DAY } from '../src/generated/gameBalance.ts';

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

assert.deepEqual(ALE_SUPPLIER_KINDS, ['marketplace']);
assert.deepEqual(PRESERVED_FOOD_PRODUCER_KINDS, ['smokehouse', 'pastoral_farmstead']);
assert.deepEqual(
  PRESERVED_FOOD_SUPPLIER_KINDS,
  ['marketplace'],
);
assert.deepEqual(CLOTH_SUPPLIER_KINDS, ['marketplace']);
assert.deepEqual(POTTERY_SUPPLIER_KINDS, ['marketplace']);
assert.equal(PRESERVED_FOOD_SUPPLIER_KINDS.includes('granary'), false);
assert.equal(SPECIALTY_CONSUMPTION_SECONDS_PER_DAY, 70);
const preservedRunway = residencePreservedFoodRunwayDays(
  residence('preserved-runway', 0, 4, 'preservedFood', 7),
);
assert.ok((preservedRunway ?? 0) < 6.25);
assert.ok((preservedRunway ?? 0) > 6.2);
assert.ok(
  (
    residencePreservedFoodRunwayDays(
      residence('winter-preserved-runway', 0, 4, 'preservedFood', 7),
      1.75,
    ) ?? 0
  ) < 6.25 / 1.75,
  'winter rotation and continuous cupboard aging must both shorten household runway',
);
const seasonalRunwayHome = residence(
  'seasonal-preserved-runway',
  0,
  4,
  'preservedFood',
  7,
);
assert.ok(
  (
    residencePreservedFoodRunwayDays(
      seasonalRunwayHome,
      1,
      PRESERVED_FOOD_SPOILAGE_PER_DAY * 0.5,
    ) ?? 0
  ) > (
    residencePreservedFoodRunwayDays(
      seasonalRunwayHome,
      1,
      PRESERVED_FOOD_SPOILAGE_PER_DAY * 1.25,
    ) ?? 0
  ),
  'the same cupboard stock must last longer in cold-season storage',
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
const foodMarket = building('food-market', 'marketplace', 3);
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [granary, smokehouse, farmstead, foodMarket],
    network,
    'preservedFood',
  )?.id,
  foodMarket.id,
  'a stocked Marketplace must redistribute preserved food from granary stalls',
);
assert.equal(
  findRoadLinkedUpgradeSupplierForResidence(
    home,
    [granary, smokehouse, farmstead, foodMarket],
    network,
    'preservedFood',
  )?.id,
  farmstead.id,
  'a depot must not unlock prosperous housing without an actual producer',
);

const monastery = building('monastery', 'monastery', 5);
const brewery = building('brewery', 'brewery', 18);
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [monastery, brewery, foodMarket],
    network,
    'ale',
    (candidate) => candidate.kind !== 'monastery',
  )?.id,
  foodMarket.id,
  'breweries and monasteries must stage household ale at the Marketplace',
);
const weaver = { ...building('weaver', 'weaver', 6), cloth: 12 };
const goodsMarket = { ...building('goods-market', 'marketplace', 4), cloth: 12, pottery: 12 };
assert.equal(
  findRoadLinkedSupplierForResidence(home, [brewery, weaver, goodsMarket], network, 'cloth')?.id,
  goodsMarket.id,
  'only a stocked Marketplace goods stall should claim household textile service',
);
const emptySmokehouse = { ...building('empty-smokehouse', 'smokehouse', 2), preservedFood: 0 };
const emptyGranary = { ...granary, preservedFood: 0 };
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [emptyGranary, emptySmokehouse, farmstead],
    network,
    'preservedFood',
  )?.id,
  undefined,
  'producers never provide direct household service without Marketplace stock',
);
const curedOverflow = selectDirectProcessorInputTarget(
  [granary, farmstead],
  smokehouse.id,
  'preservedFood',
  (target) => Math.abs(target.x - smokehouse.x),
);
assert.equal(curedOverflow?.target.id, granary.id);
assert.equal(curedOverflow?.duty, 'workshop-overflow');
assert.equal(curedOverflow?.desiredStock, 180);
const localOnlyGranary = {
  ...granary,
  id: 'local-only-granary',
  granaryAcceptsFreshFood: false,
};
assert.equal(
  selectDirectProcessorInputTarget(
    [localOnlyGranary],
    smokehouse.id,
    'preservedFood',
    (target) => Math.abs(target.x - smokehouse.x),
  ),
  null,
  'a granary with perishable collection disabled must leave cured surplus in its producer loft',
);
const emptyBrewery = { ...building('empty-brewery', 'brewery', 2), ale: 0 };
assert.equal(
  findRoadLinkedSupplierForResidence(
    home,
    [emptyBrewery, monastery],
    network,
    'ale',
  )?.id,
  undefined,
  'monastic ale also requires Marketplace staging before household delivery',
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
  /marketplace_has_stall_workers\([\s\S]*?ResidenceNeedKind::Ale/,
  'ale claims must require a staffed granary stall at the Marketplace',
);
const potter = { ...building('potter', 'potter_kiln', 4), pottery: 12 };
assert.equal(
  findRoadLinkedSupplierForResidence(home, [weaver, potter, goodsMarket], network, 'pottery')?.id,
  goodsMarket.id,
  'only a stocked Marketplace goods stall should claim household-ware service',
);
assert.match(
  tickContext,
  /ResidenceNeedKind::PreservedFood => building\.preserved_food > 1e-6/,
);
assert.match(tickContext, /ResidenceNeedKind::Cloth => building\.cloth > 1e-6/);
assert.match(tickContext, /ResidenceNeedKind::Pottery => building\.pottery > 1e-6/);
const expanded = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(
  expanded,
  /step_granary[\s\S]*?GranaryDispatchDuty::Households[\s\S]*?CommodityKind::Food[\s\S]*?CommodityKind::PreservedFood[\s\S]*?CommodityKind::Ale[\s\S]*?&\["marketplace"\]/,
  'a granary must stock Marketplace food stalls with staple, cured, and ale goods',
);
assert.match(
  expanded,
  /step_smokehouse[\s\S]*?dispatch_to_building_where\([\s\S]*?CommodityKind::PreservedFood[\s\S]*?&\["granary"\][\s\S]*?granary_accepts_fresh_food/,
  'a smokehouse must centralize cured output at the granary before market delivery',
);
assert.match(
  expanded,
  /processor_accepts_input[\s\S]*?building\.kind == "granary"[\s\S]*?CommodityKind::PreservedFood[\s\S]*?granary_accepts_fresh_food/,
  'every authoritative cured-food producer must honor the shared granary intake switch',
);
assert.match(
  expanded,
  /local_material_target_kinds[\s\S]*?\("potter_kiln", CommodityKind::Pottery\)[\s\S]*?"village_storehouse"/,
  'new kiln output must move to the storehouse before a goods stall serves it',
);
const supply = fs.readFileSync('server/src/simulation/residence_needs/supply.rs', 'utf8');
assert.match(supply, /ResidenceNeedKind::PreservedFood[\s\S]*specialty_supplier_for|specialty_supplier_for[\s\S]*ResidenceNeedKind::PreservedFood/);
assert.doesNotMatch(supply, /"smokehouse",\s*"granary",\s*"monastery"/);
const residenceUpgrades = fs.readFileSync('server/src/reducers/residences.rs', 'utf8');
assert.match(residenceUpgrades, /PRESERVED_FOOD_PRODUCER_KINDS/);
assert.doesNotMatch(
  residenceUpgrades,
  /ResidenceUpgradeService::PreservedFood[\s\S]{0,180}PRESERVED_FOOD_SUPPLIER_KINDS/,
);
const livestock = fs.readFileSync('server/src/simulation/livestock.rs', 'utf8');
assert.match(
  livestock,
  /dispatch_manure_to_crop_farmstead[\s\S]*?CommodityKind::PreservedFood[\s\S]*?&\["granary"\]/,
  'pastoral cured output must move through the granary rather than directly to homes',
);
const expandedInspector = fs.readFileSync(
  'src/resources/inspector/expandedBuildingRenderer.ts',
  'utf8',
);
assert.match(expandedInspector, /Cured-food territory/);
assert.match(expandedInspector, /Cured overflow/);
assert.match(expandedInspector, /Collect fresh and cured surplus/);
const residenceInspector = fs.readFileSync('src/resources/inspector/residenceRenderer.ts', 'utf8');
assert.match(
  residenceInspector,
  /formatDeliveryRoadDistance\(distance\)/,
  'household supplier rows should expose road distance for spatial optimization',
);

console.log('specialty logistics tests passed');
