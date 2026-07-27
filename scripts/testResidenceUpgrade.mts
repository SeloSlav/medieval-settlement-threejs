import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RESIDENCE_STONE_COST,
  RESIDENCE_TIMBER_COST,
  RESIDENCE_TIER2_GOLD_COST,
  RESIDENCE_TIER2_STONE_COST,
  RESIDENCE_TIER2_TIMBER_COST,
  RESIDENCE_TIER3_GOLD_COST,
  RESIDENCE_TIER3_STONE_COST,
  RESIDENCE_TIER3_TIMBER_COST,
} from '../src/generated/gameBalance.ts';
import { residenceSettlementReadiness } from '../src/economy/residenceSettlement.ts';
import {
  evaluateResidenceUpgrade,
  residenceUpgradeProject,
  type ResidenceUpgradeServices,
} from '../src/economy/residenceUpgrade.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import {
  findRoadLinkedSupplierForResidence,
  findRoadLinkedUpgradeSupplierForResidence,
} from '../src/logistics/specialtyLogistics.ts';
import { isResidenceInWellRange } from '../src/logistics/waterLogistics.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import {
  computePopulationStats,
  computeResourceTotals,
} from '../src/resources/resourceTotals.ts';
import {
  createInitialResidenceConstructionMesh,
  syncInitialResidenceConstruction,
} from '../src/residences/ResidenceMarkers.ts';
import { activeResidenceNeedKinds } from '../src/residences/residenceNeedState.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type GameState,
  type ResidenceState,
} from '../src/resources/types.ts';
import {
  residenceUpgradeWorkplaces,
} from '../src/settlement/residenceUpgradeWorkplaces.ts';

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

const householdFundedResidence = residence('household-funded', 1, 3);
householdFundedResidence.householdWealth = Math.max(1, RESIDENCE_TIER2_GOLD_COST - 2);
const physicalPlan = evaluateResidenceUpgrade(
  householdFundedResidence,
  richTotals,
  allServices,
  { physicalEconomy: true },
);
assert.ok(physicalPlan);
assert.equal(
  physicalPlan.householdContribution,
  Math.min(householdFundedResidence.householdWealth, RESIDENCE_TIER2_GOLD_COST),
);
assert.equal(
  physicalPlan.civicGoldRequired,
  RESIDENCE_TIER2_GOLD_COST - physicalPlan.householdContribution,
);
assert.equal(
  physicalPlan.resources.find((resource) => resource.kind === 'gold')?.required,
  physicalPlan.civicGoldRequired,
  'only the civic remainder should be tested against the physical treasury',
);

const fireDisabledUpgrade = evaluateResidenceUpgrade(
  tierOne,
  richTotals,
  allServices,
  { fireDisabled: true },
);
assert.ok(fireDisabledUpgrade);
assert.equal(fireDisabledUpgrade.ready, false);
assert.match(
  fireDisabledUpgrade.blockers.join(' '),
  /repair fire damage before upgrading/,
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
assert.equal(
  evaluateResidenceUpgrade(residence('tier-three', 3, 10), richTotals, allServices),
  null,
);

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

const activeUpgrade = residence('active-upgrade', 1, 3);
Object.assign(activeUpgrade, {
  upgradeTargetTier: 2,
  upgradeProgress: 0.25,
  upgradeRequiredTimber: 18,
  upgradeRequiredStone: 14,
  upgradeRequiredGold: 8,
  upgradeDeliveredTimber: 9,
  upgradeDeliveredStone: 7,
  upgradeDeliveredGold: 3,
  upgradeReservedTimber: 5,
  upgradeReservedStone: 4,
  upgradeReservedGold: 3,
  upgradeAssignedLabor: 1,
  upgradePriority: 3,
});
const timberCart = deliveryTrip({
  id: 'trip-upgrade-timber',
  residenceId: activeUpgrade.id,
  cargoKind: 'timber',
  amount: 4,
});
const project = residenceUpgradeProject(activeUpgrade, [timberCart]);
assert.ok(project);
assert.equal(project.targetTier, 2);
assert.equal(project.priorityLabel, 'Urgent');
assert.equal(project.incoming.timber, 4);
assert.equal(project.materialReadiness, 0.5);
assert.match(project.blockers.join(' '), /civic lockbox payment still at source/);
const workplaces = residenceUpgradeWorkplaces([activeUpgrade]);
assert.equal(workplaces.length, 1);
assert.equal(
  workplaces[0]?.constructionComplete,
  false,
  'the authoritative builder should reuse the visible construction-worker routine',
);

const initialCottage = residence('initial-cottage', 0, 0);
Object.assign(initialCottage, {
  populationCapacity: 3,
  upgradeTargetTier: 1,
  upgradeProgress: 0.45,
  upgradeRequiredTimber: RESIDENCE_TIMBER_COST,
  upgradeRequiredStone: RESIDENCE_STONE_COST,
  upgradeRequiredGold: 0,
  upgradeDeliveredTimber: 4,
  upgradeDeliveredStone: 5,
  upgradeDeliveredGold: 0,
  upgradeReservedTimber: 4,
  upgradeReservedStone: 7,
  upgradeReservedGold: 0,
  upgradeAssignedLabor: 1,
  upgradePriority: 2,
});
const initialProject = residenceUpgradeProject(initialCottage);
assert.ok(initialProject);
assert.equal(initialProject.targetTier, 1);
assert.deepEqual(initialProject.required, {
  timber: RESIDENCE_TIMBER_COST,
  stone: RESIDENCE_STONE_COST,
  gold: 0,
});
assert.doesNotMatch(
  initialProject.blockers.join(' '),
  /coin|gold|lockbox/i,
  'founding cottages should grow from the material economy without a civic coin charge',
);
assert.equal(residenceUpgradeWorkplaces([initialCottage]).length, 1);
assert.deepEqual(activeResidenceNeedKinds(initialCottage.tier), []);
assert.equal(residenceSettlementReadiness(initialCottage).ready, false);
const initialCottageState = emptyGameState([], [initialCottage], []);
assert.equal(
  computePopulationStats(initialCottageState).housingCapacity,
  0,
  'an unfinished frame must not provide housing capacity',
);

const initialMarker = createInitialResidenceConstructionMesh(7);
const initialFrame = initialMarker.getObjectByName('InitialCottageConstructionFrame');
const completedCottage = initialMarker.getObjectByName('InitialCottageCompletedStructure');
assert.ok(initialFrame);
assert.ok(completedCottage);
assert.equal(completedCottage.visible, false);
initialCottage.upgradeProgress = 0;
syncInitialResidenceConstruction(initialMarker, initialCottage);
const visibleAtStart = initialFrame.children.filter((child) => child.visible).length;
initialCottage.upgradeProgress = 0.85;
syncInitialResidenceConstruction(initialMarker, initialCottage);
const visibleNearCompletion = initialFrame.children.filter((child) => child.visible).length;
assert.ok(visibleAtStart > 0, 'setting-out boards should make an empty worksite readable');
assert.ok(
  visibleNearCompletion > visibleAtStart,
  'the timber frame should visibly grow as authoritative progress advances',
);

const physicalState = emptyGameState(
  [Object.assign(building('camp', 'founders_camp', 0), {
    timber: 100,
    stone: 80,
    gold: 20,
    assignedLabor: 0,
  })],
  [activeUpgrade],
  [timberCart],
);
const committedTotals = computeResourceTotals(physicalState);
assert.equal(committedTotals.timber, 95);
assert.equal(committedTotals.stone, 76);
assert.equal(committedTotals.gold, 17);
assert.equal(computePopulationStats(physicalState).assigned, 2);

const performanceStarted = performance.now();
for (let index = 0; index < 100_000; index += 1) {
  residenceUpgradeProject(activeUpgrade);
}
const performanceElapsed = performance.now() - performanceStarted;
assert.ok(
  performanceElapsed < 1_500,
  `100k household project summaries should stay cheap (${performanceElapsed.toFixed(1)}ms)`,
);

const residenceReducer = source('../server/src/reducers/residences.rs');
assert.match(
  residenceReducer,
  /ResidenceUpgradeService::Water[\s\S]*?position_within_well_service_radius/,
);
assert.match(residenceReducer, /residence_upgrade_household_contribution/);
assert.match(residenceReducer, /physical_founding_site_enabled/);
assert.match(
  residenceReducer,
  /tier: if physical_economy \{ 0 \} else \{ 1 \}/,
  'physical worlds should place unfinished cottage worksites',
);
assert.match(
  residenceReducer,
  /upgrade_target_tier: if physical_economy \{ 1 \} else \{ 0 \}/,
);
assert.match(
  residenceReducer,
  /RESIDENCE_TIMBER_COST[\s\S]*RESIDENCE_STONE_COST[\s\S]*ensure_upgrade_source_route/,
  'founding cottage material must remain reserved at reachable physical sources',
);
assert.match(residenceReducer, /upgrade_reserved_timber = timber/);
assert.match(residenceReducer, /upgrade_delivered_gold = household_contribution/);
assert.match(residenceReducer, /spend_aggregate_timber\(ctx, owner, timber\)/);
assert.match(residenceReducer, /set_residence_upgrade_priority/);
assert.match(
  residenceReducer,
  /residence_fire_state\(ctx, residence\.id\)\.is_some\(\)[\s\S]*Repair the fire-damaged residence before upgrading it/,
);
assert.match(
  residenceReducer,
  /filter\(\|building\| building_fire_state\(ctx, building\.id\)\.is_none\(\)\)/,
  'fire-disabled suppliers must not satisfy authoritative upgrade services',
);

const residenceInspector = source('../src/resources/inspector/residenceRenderer.ts');
assert.match(residenceInspector, /Tier \$\{plan\.nextTier\} services/);
assert.match(residenceInspector, /Upgrade resources/);
assert.match(residenceInspector, /plan\.ready \? '' : 'disabled'/);
assert.match(residenceInspector, /Begin tier \$\{plan\.nextTier\} works/);
assert.match(residenceInspector, /data-residence-upgrade-priority/);
assert.match(residenceInspector, /Inspect incoming \$\{trip\.cargoKind\} cart/);
assert.match(residenceInspector, /structural recovery required before settlement resumes/);
assert.match(residenceInspector, /TIMBER_SALVAGE_FRACTION \* 100\)}% timber/);
assert.match(residenceInspector, /Cottage construction is physical/);
assert.match(residenceInspector, /founders remain at camp/);
assert.match(residenceInspector, /Cancel cottage works/);

const residenceMarkers = source('../src/residences/ResidenceMarkers.ts');
assert.match(residenceMarkers, /ResidenceUpgradeWorks/);
assert.match(residenceMarkers, /UpgradeTimberSegment:/);
assert.match(residenceMarkers, /UpgradeStoneSegment:/);
assert.match(residenceMarkers, /upgradeProgress/);
assert.match(residenceMarkers, /upgradeDeliveredTimber/);
assert.match(residenceMarkers, /InitialCottageConstructionFrame/);
assert.match(residenceMarkers, /InitialCottageFrameSegment/);

const upgradeSimulation = source('../server/src/simulation/residence_upgrades.rs');
assert.match(upgradeSimulation, /HashMap<[\s\S]*CONSTRUCTION_PRIORITY_LEVELS/);
assert.match(upgradeSimulation, /upgrade_assigned_labor == 0[\s\S]*return/);
assert.match(upgradeSimulation, /try_start_residence_upgrade_supply_trip/);
assert.match(upgradeSimulation, /ensure_residence_needs\(ctx, residence_id\)/);
assert.match(upgradeSimulation, /initial_cottage_works/);

const deliveryTrips = source('../server/src/simulation/delivery_trips.rs');
assert.match(deliveryTrips, /try_start_residence_upgrade_supply_trip/);
assert.match(deliveryTrips, /unload_residence_upgrade_material/);
assert.match(deliveryTrips, /upgrade_reserved_gold/);

console.log(
  `residence upgrade physical-work tests passed (${performanceElapsed.toFixed(1)}ms / 100k summaries)`,
);

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

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

function deliveryTrip(
  partial: Pick<
    DeliveryTripState,
    'id' | 'residenceId' | 'cargoKind' | 'amount'
  > & Partial<DeliveryTripState>,
): DeliveryTripState {
  return {
    buildingId: 'camp',
    destinationKind: 'residence',
    targetBuildingId: null,
    phase: 'outbound',
    x: 0,
    z: 0,
    progress: 0.2,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 1,
    deliveryWorkers: 1,
    freeHaulerWorkers: 1,
    pathDistance: 10,
    travelSpeedMultiplier: 1,
    routePolylineJson: '',
    ...partial,
  };
}

function emptyGameState(
  buildings: BuildingState[],
  residences: ResidenceState[],
  trips: DeliveryTripState[],
): GameState {
  return {
    seed: 1,
    tick: 0,
    physicalFoundingSiteEnabled: true,
    stockpile: createEmptyStockpile(),
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(buildings.map((entry) => [entry.id, entry])),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(residences.map((entry) => [entry.id, entry])),
    backyardGardens: new Map(),
    deliveryTrips: new Map(trips.map((entry) => [entry.id, entry])),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}
