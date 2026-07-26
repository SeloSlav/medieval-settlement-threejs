import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RESIDENCE_TIER2_GOLD_COST,
  RESIDENCE_TIER2_STONE_COST,
  RESIDENCE_TIER2_TIMBER_COST,
  RESIDENCE_TIER3_GOLD_COST,
  RESIDENCE_TIER3_STONE_COST,
  RESIDENCE_TIER3_TIMBER_COST,
} from '../src/generated/gameBalance.ts';
import {
  evaluateResidenceUpgrade,
  type ResidenceUpgradeServices,
} from '../src/economy/residenceUpgrade.ts';
import {
  findRoadLinkedSupplierForResidence,
  findRoadLinkedUpgradeSupplierForResidence,
} from '../src/logistics/specialtyLogistics.ts';
import { isResidenceInWellRange } from '../src/logistics/waterLogistics.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type ResidenceState,
} from '../src/resources/types.ts';

const lodge = building('lodge', 'woodcutters_lodge', 2);
const well = building('well', 'well', 3);
well.workRadius = 80;
const smokehouse = building('smokehouse', 'smokehouse', 4);
const brewery = building('brewery', 'brewery', 5);
const weaver = building('weaver', 'weaver', 6);
const allServices: ResidenceUpgradeServices = {
  firewood: { supplier: lodge, stocked: false },
  water: { supplier: well, stocked: false },
  preservedFood: { supplier: smokehouse, stocked: false },
  ale: { supplier: brewery, stocked: false },
  cloth: { supplier: weaver, stocked: false },
};
const richTotals = {
  ...createEmptyStockpile(),
  timber: 1_000,
  stone: 1_000,
  gold: 1_000,
};

const tierOne = residence('tier-one', 1, 3);
const tierTwoPlan = evaluateResidenceUpgrade(tierOne, richTotals, allServices);
assert.ok(tierTwoPlan);
assert.equal(tierTwoPlan.nextTier, 2);
assert.equal(tierTwoPlan.addedCapacity, 3);
assert.equal(tierTwoPlan.ready, true);
assert.deepEqual(
  tierTwoPlan.services.map((service) => service.kind),
  ['firewood', 'water'],
);
assert.deepEqual(
  tierTwoPlan.resources.map((resource) => resource.required),
  [
    RESIDENCE_TIER2_TIMBER_COST,
    RESIDENCE_TIER2_STONE_COST,
    RESIDENCE_TIER2_GOLD_COST,
  ],
);
assert.equal(
  tierTwoPlan.services.every((service) => !service.stocked && service.ready),
  true,
  'an operational but temporarily empty route should remain upgrade-eligible',
);

const noWaterPlan = evaluateResidenceUpgrade(tierOne, richTotals, {
  ...allServices,
  water: { supplier: null, stocked: false },
});
assert.ok(noWaterPlan);
assert.equal(noWaterPlan.ready, false);
assert.match(noWaterPlan.blockers.join(' '), /water route missing/);

const poorPlan = evaluateResidenceUpgrade(
  tierOne,
  {
    timber: RESIDENCE_TIER2_TIMBER_COST - 3,
    stone: RESIDENCE_TIER2_STONE_COST,
    gold: RESIDENCE_TIER2_GOLD_COST - 2,
  },
  allServices,
);
assert.ok(poorPlan);
assert.equal(poorPlan.ready, false);
assert.match(poorPlan.blockers.join(' '), /3 timber short/);
assert.match(poorPlan.blockers.join(' '), /2 gold short/);

const abandoned = residence('abandoned', 1, 0);
abandoned.abandoned = true;
const abandonedPlan = evaluateResidenceUpgrade(abandoned, richTotals, allServices);
assert.ok(abandonedPlan);
assert.equal(abandonedPlan.ready, false);
assert.match(abandonedPlan.blockers.join(' '), /occupied household required/);

const tierTwo = residence('tier-two', 2, 6);
const tierThreePlan = evaluateResidenceUpgrade(tierTwo, richTotals, allServices);
assert.ok(tierThreePlan);
assert.equal(tierThreePlan.nextTier, 3);
assert.equal(tierThreePlan.addedCapacity, 4);
assert.deepEqual(
  tierThreePlan.services.map((service) => service.kind),
  ['preservedFood', 'ale', 'cloth'],
);
assert.deepEqual(
  tierThreePlan.resources.map((resource) => resource.required),
  [
    RESIDENCE_TIER3_TIMBER_COST,
    RESIDENCE_TIER3_STONE_COST,
    RESIDENCE_TIER3_GOLD_COST,
  ],
);
assert.equal(tierThreePlan.ready, true);
assert.equal(evaluateResidenceUpgrade(residence('tier-three', 3, 10), richTotals, allServices), null);

const network = {
  getPathfinder: () => ({
    roadPathDistance: (ax: number, az: number, bx: number, bz: number) =>
      Math.hypot(bx - ax, bz - az),
  }),
} as unknown as RoadNetwork;
const emptyNearbySmokehouse = building('empty-nearby', 'smokehouse', 2);
emptyNearbySmokehouse.preservedFood = 0;
const stockedDistantSmokehouse = building('stocked-distant', 'smokehouse', 8);
stockedDistantSmokehouse.preservedFood = 40;
assert.equal(
  findRoadLinkedSupplierForResidence(
    tierTwo,
    [emptyNearbySmokehouse, stockedDistantSmokehouse],
    network,
    'preservedFood',
  )?.id,
  stockedDistantSmokehouse.id,
  'live deliveries must still prefer a stocked supplier',
);
assert.equal(
  findRoadLinkedUpgradeSupplierForResidence(
    tierTwo,
    [emptyNearbySmokehouse, stockedDistantSmokehouse],
    network,
    'preservedFood',
  )?.id,
  emptyNearbySmokehouse.id,
  'upgrade eligibility should recognize an empty but operational route',
);

const nearHome = residence('near-home', 1, 3);
nearHome.x = well.x + well.workRadius;
assert.equal(isResidenceInWellRange(well, nearHome), true);
nearHome.x = well.x + well.workRadius + 0.1;
assert.equal(
  isResidenceInWellRange(well, nearHome),
  false,
  'road connectivity alone must not bypass the physical well radius',
);

const residenceReducer = readFileSync(
  new URL('../server/src/reducers/residences.rs', import.meta.url),
  'utf8',
);
assert.match(
  residenceReducer,
  /ResidenceUpgradeService::Water[\s\S]*?position_within_well_service_radius/,
);
assert.match(residenceReducer, /treasury_gold \+ 1e-6 < gold/);
assert.match(residenceReducer, /Upgrade requires \{\} timber, \{\} stone, and \{\} gold/);

const residenceInspector = readFileSync(
  new URL('../src/resources/inspector/residenceRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(residenceInspector, /Tier \$\{plan\.nextTier\} services/);
assert.match(residenceInspector, /Upgrade resources/);
assert.match(residenceInspector, /plan\.ready \? '' : 'disabled'/);
assert.match(residenceInspector, /TIMBER_SALVAGE_FRACTION \* 100\)}% timber/);

console.log('residence upgrade readiness tests passed');

function residence(
  id: string,
  tier: ResidenceState['tier'],
  population: number,
): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: population,
    tier,
    settlementTicks: 0,
    needs: {
      firewood: { stock: 0, deficitSeconds: 0 },
      water: { stock: 0, deficitSeconds: 0 },
      food: { stock: 0, deficitSeconds: 0 },
      preservedFood: { stock: 0, deficitSeconds: 0 },
      ale: { stock: 0, deficitSeconds: 0 },
    },
    abandoned: false,
    householdWealth: 0,
  };
}

function building(
  id: string,
  kind: BuildingState['kind'],
  x: number,
): BuildingState {
  return {
    id,
    kind,
    x,
    z: 0,
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
    polearms: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor: kind === 'monastery' ? 0 : 1,
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
    storehouseAcceptsTimber: true,
    storehouseAcceptsStone: true,
    storehouseAcceptsFirewood: true,
  };
}
