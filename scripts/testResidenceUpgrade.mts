import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACKYARD_GARDEN_KINDS,
  CALENDAR_SECONDS_PER_DAY,
  HOUSEHOLD_PROJECT_WEALTH_RESERVE,
  RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
  RESIDENCE_STONE_COST,
  RESIDENCE_TIMBER_COST,
  RESIDENCE_TIER2_GOLD_COST,
  RESIDENCE_TIER2_STONE_COST,
  RESIDENCE_TIER2_TIMBER_COST,
  RESIDENCE_TIER3_GOLD_COST,
  RESIDENCE_TIER3_STONE_COST,
  RESIDENCE_TIER3_TIMBER_COST,
  RESIDENCE_TIER4_CAPACITY,
  RESIDENCE_TIER4_GOLD_COST,
  RESIDENCE_TIER4_STONE_COST,
  RESIDENCE_TIER4_TIMBER_COST,
  RESIDENCE_TILE_ROOF_TILE_COST,
  RESIDENCE_TILE_ROOF_TIMBER_COST,
  SIM_TICK_SECONDS,
} from '../src/generated/gameBalance.ts';
import { residenceSettlementReadiness } from '../src/economy/residenceSettlement.ts';
import {
  evaluateResidenceUpgrade,
  residenceBackyardProject,
  residenceFireRepairProject,
  residenceHasHouseholdLuxuryOption,
  residenceRoofTileProject,
  residenceUpgradeProject,
  type ResidenceUpgradeServices,
} from '../src/economy/residenceUpgrade.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import {
  findRoadLinkedSupplierForResidence,
} from '../src/logistics/specialtyLogistics.ts';
import { isResidenceInWellRange } from '../src/logistics/waterLogistics.ts';
import type { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import {
  computePopulationStats,
  computeResourceTotals,
  computeStoredResourceTotals,
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

const householdMarket = building('household-market', 'marketplace', 2);
Object.assign(householdMarket, {
  firewood: 12,
  ryeBread: 100,
  berries: 100,
  foodInventoryMigrated: true,
  cloth: 12,
  shoes: 12,
});
const well = building('well', 'well', 3);
well.workRadius = 80;
const smokehouse = building('smokehouse', 'smokehouse', 4);
const tavern = building('tavern', 'tavern', 5);
tavern.ale = 12;
const weaver = building('weaver', 'weaver', 6);
const potter = building('potter', 'potter_kiln', 7);
const cobbler = building('cobbler', 'cobbler', 8);
const chapel = building('chapel', 'chapel', 9);
chapel.chapelTier = 1;
const allServices: ResidenceUpgradeServices = {
  food: { supplier: householdMarket, stocked: true },
  firewood: { supplier: householdMarket, stocked: true },
  water: { supplier: well, stocked: false },
  savoryPreserves: { supplier: smokehouse, stocked: false },
  ale: { supplier: tavern, stocked: true },
  cloth: { supplier: householdMarket, stocked: true },
  shoes: { supplier: householdMarket, stocked: true },
  pottery: { supplier: potter, stocked: false },
  luxury: { supplier: null, stocked: false },
  church: { supplier: chapel, stocked: false },
  foodVariety: { supplier: null, stocked: false },
};
const richTotals = {
  ...createEmptyStockpile(),
  timber: 1_000,
  stone: 1_000,
  gold: 1_000,
  roofTiles: 1_000,
};

assert.deepEqual(
  [
    RESIDENCE_STONE_COST,
    RESIDENCE_TIER2_STONE_COST,
    RESIDENCE_TIER3_STONE_COST,
    RESIDENCE_TIER4_STONE_COST,
  ],
  [0, 0, 0, 0],
  'residence construction and promotion must use timber without a stone gate',
);

const tierOne = residence('tier-one', 1, 3);
const tierTwoPlan = evaluateResidenceUpgrade(tierOne, richTotals, allServices);
assert.ok(tierTwoPlan);
assert.equal(tierTwoPlan.nextTier, 2);
assert.equal(tierTwoPlan.addedCapacity, 3);
assert.equal(tierTwoPlan.ready, true);
assert.equal(
  tierTwoPlan.services.find((service) => service.kind === 'church')?.label,
  'Level 1 church',
  'Tier 2 promotion must retain the basic-church standard',
);
assert.deepEqual(
  tierTwoPlan.services.map((service) => service.kind),
  ['food', 'firewood', 'water', 'church'],
  'Tier 1→2 must use only needs active for the current Tier-1 household',
);
assert.deepEqual(
  tierTwoPlan.resources.map((resource) => resource.required),
  [
    RESIDENCE_TIER2_TIMBER_COST,
    RESIDENCE_TIER2_GOLD_COST,
  ],
);
assert.equal(
  tierTwoPlan.services.every((service) => service.ready),
  true,
  'all current Tier-1 needs should be ready',
);
assert.equal(tierTwoPlan.services.some((service) => service.kind === 'ale'), false);
assert.equal(tierTwoPlan.services.some((service) => service.kind === 'cloth'), false);

const householdFundedResidence = residence('household-funded', 1, 3);
householdFundedResidence.householdWealth = HOUSEHOLD_PROJECT_WEALTH_RESERVE
  + Math.max(1, RESIDENCE_TIER2_GOLD_COST - 2);
const physicalPlan = evaluateResidenceUpgrade(
  householdFundedResidence,
  richTotals,
  allServices,
  { physicalEconomy: true },
);
assert.ok(physicalPlan);
assert.equal(
  physicalPlan.householdContribution,
  Math.min(
    Math.max(0, householdFundedResidence.householdWealth - HOUSEHOLD_PROJECT_WEALTH_RESERVE),
    RESIDENCE_TIER2_GOLD_COST,
  ),
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

const reserveProtectedResidence = residence('reserve-protected', 1, 3);
reserveProtectedResidence.householdWealth = HOUSEHOLD_PROJECT_WEALTH_RESERVE - 1;
const treasuryFundedPlan = evaluateResidenceUpgrade(
  reserveProtectedResidence,
  richTotals,
  allServices,
  { physicalEconomy: true },
);
assert.ok(treasuryFundedPlan);
assert.equal(treasuryFundedPlan.householdContribution, 0);
assert.equal(treasuryFundedPlan.civicGoldRequired, RESIDENCE_TIER2_GOLD_COST);
assert.equal(treasuryFundedPlan.ready, true, 'a private wallet below reserve must not block a treasury-funded upgrade');

const treasuryShortPlan = evaluateResidenceUpgrade(
  reserveProtectedResidence,
  { ...richTotals, gold: RESIDENCE_TIER2_GOLD_COST - 1 },
  allServices,
  { physicalEconomy: true },
);
assert.ok(treasuryShortPlan);
assert.equal(treasuryShortPlan.ready, false);
assert.match(treasuryShortPlan.blockers.join(' '), /treasury gold short/);

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

const storedWaterWithoutWell = residence('stored-water-without-well', 1, 3);
storedWaterWithoutWell.needs.water.stock = 12;
const storedWaterWithoutWellPlan = evaluateResidenceUpgrade(storedWaterWithoutWell, richTotals, {
  ...allServices,
  water: { supplier: null, stocked: false },
});
assert.ok(storedWaterWithoutWellPlan);
assert.equal(
  storedWaterWithoutWellPlan.ready,
  false,
  'stored buckets must not replace an ongoing well service route',
);

const storedFaithWithoutChapel = residence('stored-faith-without-chapel', 1, 3);
storedFaithWithoutChapel.needs.church.stock = 1;
const storedFaithWithoutChapelPlan = evaluateResidenceUpgrade(storedFaithWithoutChapel, richTotals, {
  ...allServices,
  church: { supplier: null, stocked: false },
});
assert.ok(storedFaithWithoutChapelPlan);
assert.equal(
  storedFaithWithoutChapelPlan.ready,
  false,
  'a replicated chapel-level row must not replace an ongoing church route',
);

const householdStockedTierOne = residence('household-stocked-tier-one', 1, 3);
householdStockedTierOne.needs.food.stock = 4;
householdStockedTierOne.needs.firewood.stock = 4;
const householdStockedTierOnePlan = evaluateResidenceUpgrade(
  householdStockedTierOne,
  richTotals,
  {
    ...allServices,
    food: { supplier: null, stocked: false },
    firewood: { supplier: null, stocked: false },
  },
);
assert.ok(householdStockedTierOnePlan);
assert.equal(
  householdStockedTierOnePlan.ready,
  true,
  'actual household food and firewood stock must qualify without a currently stocked Marketplace',
);
assert.equal(
  householdStockedTierOnePlan.services.find((service) => service.kind === 'firewood')?.householdReady,
  true,
);

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

const vacant = residence('vacant', 1, 0);
vacant.abandoned = true;
const vacantPlan = evaluateResidenceUpgrade(vacant, richTotals, allServices);
assert.ok(vacantPlan);
assert.equal(vacantPlan.ready, false);
assert.match(vacantPlan.blockers.join(' '), /occupied household required/);

const projectBusy = residence('project-busy', 1, 3);
projectBusy.backyardProjectKind = 1;
const projectBusyPlan = evaluateResidenceUpgrade(projectBusy, richTotals, allServices);
assert.ok(projectBusyPlan);
assert.equal(projectBusyPlan.ready, false);
assert.match(projectBusyPlan.blockers.join(' '), /active household project/);

const serviceStrained = residence('service-strained', 1, 3);
serviceStrained.needs.food.deficitTicks = Math.ceil(
  RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS
    * CALENDAR_SECONDS_PER_DAY
    / SIM_TICK_SECONDS,
);
const serviceStrainedPlan = evaluateResidenceUpgrade(
  serviceStrained,
  richTotals,
  allServices,
);
assert.ok(serviceStrainedPlan);
assert.equal(serviceStrainedPlan.ready, false);
assert.match(serviceStrainedPlan.blockers.join(' '), /sustained household needs/);

const tierTwo = residence('tier-two', 2, 6);
tierTwo.ryeBread = 100;
tierTwo.berries = 100;
tierTwo.foodInventoryMigrated = true;
const basicChurchTierThreePlan = evaluateResidenceUpgrade(tierTwo, richTotals, allServices);
assert.ok(basicChurchTierThreePlan);
assert.equal(
  basicChurchTierThreePlan.ready,
  true,
  'Tier 2→3 must retain the current level-1 church standard and must not pre-require shoes',
);
const marketplaceFedTierTwo = residence('marketplace-fed-tier-two', 2, 6);
const marketplaceFedTierTwoPlan = evaluateResidenceUpgrade(
  marketplaceFedTierTwo,
  richTotals,
  {
    ...allServices,
    foodVariety: { supplier: householdMarket, stocked: true },
  },
);
assert.ok(marketplaceFedTierTwoPlan);
assert.equal(
  marketplaceFedTierTwoPlan.ready,
  true,
  'grain and a second food group staged at one Marketplace must count regardless of local or imported origin',
);
const levelTwoChapel = { ...chapel, chapelTier: 2 };
const tierThreePlan = evaluateResidenceUpgrade(tierTwo, richTotals, {
  ...allServices,
  church: { supplier: levelTwoChapel, stocked: false },
});
assert.ok(tierThreePlan);
assert.equal(tierThreePlan.nextTier, 3);
assert.equal(tierThreePlan.addedCapacity, 4);
assert.deepEqual(
  tierThreePlan.services.map((service) => service.kind),
  ['food', 'firewood', 'water', 'church', 'foodVariety', 'cloth', 'ale'],
  'Tier 2→3 must check only Tier-2 active needs',
);
assert.deepEqual(
  tierThreePlan.resources.map((resource) => resource.required),
  [
    RESIDENCE_TIER3_TIMBER_COST,
    RESIDENCE_TIER3_GOLD_COST,
  ],
);
assert.equal(tierThreePlan.ready, true);
assert.equal(tierThreePlan.services.some((service) => service.kind === 'shoes'), false);
assert.match(tierThreePlan.addedNeeds, /shoes/i);

const localWeaverOnlyPlan = evaluateResidenceUpgrade(tierTwo, richTotals, {
  ...allServices,
  cloth: { supplier: weaver, stocked: true },
});
assert.ok(localWeaverOnlyPlan);
assert.equal(localWeaverOnlyPlan.ready, false);
assert.match(localWeaverOnlyPlan.blockers.join(' '), /clothing unmet/);
const importedClothAtMarketPlan = evaluateResidenceUpgrade(tierTwo, richTotals, {
  ...allServices,
  cloth: { supplier: householdMarket, stocked: true },
});
assert.ok(importedClothAtMarketPlan);
assert.equal(
  importedClothAtMarketPlan.ready,
  true,
  'cloth staged at the proper Marketplace must qualify without a local Weaver',
);
const householdClothPlan = evaluateResidenceUpgrade(tierTwo, richTotals, {
  ...allServices,
  cloth: { supplier: null, stocked: false },
});
assert.ok(householdClothPlan);
assert.equal(householdClothPlan.ready, false);
tierTwo.needs.cloth.stock = 2;
const stockedHouseholdClothPlan = evaluateResidenceUpgrade(tierTwo, richTotals, {
  ...allServices,
  cloth: { supplier: null, stocked: false },
});
assert.ok(stockedHouseholdClothPlan);
assert.equal(
  stockedHouseholdClothPlan.ready,
  true,
  'cloth already delivered to the household must qualify without requiring remaining outlet stock',
);

const tierThree = residence('tier-three', 3, 10);
tierThree.ryeBread = 100;
tierThree.berries = 100;
tierThree.meat = 100;
tierThree.fish = 100;
tierThree.foodInventoryMigrated = true;
const householdStockedTierThree = residence('household-stocked-tier-three', 3, 10);
Object.assign(householdStockedTierThree, {
  ryeBread: 100,
  berries: 100,
  meat: 100,
  fish: 100,
  foodInventoryMigrated: true,
});
householdStockedTierThree.needs.firewood.stock = 3;
householdStockedTierThree.needs.ale.stock = 3;
householdStockedTierThree.needs.cloth.stock = 3;
householdStockedTierThree.needs.shoes.stock = 3;
const householdStockedTierThreePlan = evaluateResidenceUpgrade(
  householdStockedTierThree,
  richTotals,
  {
    ...allServices,
    firewood: { supplier: null, stocked: false },
    ale: { supplier: null, stocked: false },
    cloth: { supplier: null, stocked: false },
    shoes: { supplier: null, stocked: false },
    church: { supplier: levelTwoChapel, stocked: false },
  },
);
assert.ok(householdStockedTierThreePlan);
assert.equal(
  householdStockedTierThreePlan.ready,
  true,
  'delivered Tier-3 fuel, beverages, cloth, and shoes must remain valid after their outlets empty',
);
const basicChurchTierFourPlan = evaluateResidenceUpgrade(tierThree, richTotals, allServices);
assert.ok(basicChurchTierFourPlan);
assert.equal(basicChurchTierFourPlan.ready, false);
assert.match(basicChurchTierFourPlan.blockers.join(' '), /level 2 church route missing/);
const tierFourWithoutLuxury = evaluateResidenceUpgrade(tierThree, richTotals, {
  ...allServices,
  church: { supplier: levelTwoChapel, stocked: false },
});
assert.ok(tierFourWithoutLuxury);
assert.equal(
  tierFourWithoutLuxury.ready,
  true,
  'Tier 3→4 must not pre-require cured food, pottery, luxury, or a level-3 church',
);
const luxuryMarketplace = building('luxury-market', 'marketplace', 10);
luxuryMarketplace.honey = 4;
const tierFourPlan = evaluateResidenceUpgrade(tierThree, richTotals, {
  ...allServices,
  luxury: { supplier: luxuryMarketplace, stocked: true },
  church: { supplier: levelTwoChapel, stocked: false },
});
assert.ok(tierFourPlan);
assert.equal(tierFourPlan.nextTier, 4);
assert.equal(tierFourPlan.populationCapacity, RESIDENCE_TIER4_CAPACITY);
assert.deepEqual(
  tierFourPlan.services.map((service) => service.kind),
  ['food', 'firewood', 'water', 'church', 'foodVariety', 'cloth', 'shoes', 'ale'],
  'Tier 3→4 must check only Tier-3 active needs',
);
assert.deepEqual(
  tierFourPlan.resources.map((resource) => resource.required),
  [
    RESIDENCE_TIER4_TIMBER_COST,
    RESIDENCE_TIER4_GOLD_COST,
    RESIDENCE_TILE_ROOF_TILE_COST,
  ],
);
assert.equal(tierFourPlan.ready, true);
for (const futureNeed of ['savoryPreserves', 'pottery', 'luxury'] as const) {
  assert.equal(tierFourPlan.services.some((service) => service.kind === futureNeed), false);
}
assert.match(tierFourPlan.addedNeeds, /savory preserves/i);
assert.match(tierFourPlan.addedNeeds, /pottery/i);
assert.match(tierFourPlan.addedNeeds, /luxury/i);
assert.equal(
  residenceHasHouseholdLuxuryOption(
    { aroniaJam: 0, rosehipJam: 0 },
    { kind: 'flower_garden', flowerLuxuryUpgraded: true },
  ),
  true,
  'prepared cut flowers must provide a household Tier-4 promotion path',
);
assert.equal(
  residenceHasHouseholdLuxuryOption(
    { aroniaJam: 0, rosehipJam: 0 },
    { kind: 'aronia_orchard', flowerLuxuryUpgraded: false },
  ),
  true,
  'a preserves orchard must count as a viable household luxury source before its next harvest',
);
assert.equal(
  residenceHasHouseholdLuxuryOption(
    { aroniaJam: 1, rosehipJam: 0 },
    null,
  ),
  true,
  'existing household preserves must satisfy the Tier-4 promotion gate',
);
const tierFourHouseholdLuxuryPlan = evaluateResidenceUpgrade(tierThree, richTotals, {
  ...allServices,
  luxury: { supplier: null, stocked: false },
  church: { supplier: levelTwoChapel, stocked: false },
});
assert.ok(tierFourHouseholdLuxuryPlan);
assert.equal(
  tierFourHouseholdLuxuryPlan.ready,
  true,
  'future Tier-4 luxury must remain a preview instead of a Tier-3 promotion blocker',
);
assert.equal(
  evaluateResidenceUpgrade(residence('tier-four', 4, 15), richTotals, allServices),
  null,
);

const network = {
  getPathfinder: () => ({
    roadPathDistance: (ax: number, az: number, bx: number, bz: number) =>
      Math.hypot(bx - ax, bz - az),
  }),
} as unknown as RoadNetwork;
const emptyNearbySmokehouse = building('empty-nearby', 'smokehouse', 2);
emptyNearbySmokehouse.curedMeat = 0;
const stockedDistantSmokehouse = building('stocked-distant', 'smokehouse', 8);
stockedDistantSmokehouse.smokedFish = 40;
const stockedMarketplace = building('stocked-market', 'marketplace', 6);
stockedMarketplace.cheese = 40;
assert.equal(
  findRoadLinkedSupplierForResidence(
    tierTwo,
    [emptyNearbySmokehouse, stockedDistantSmokehouse, stockedMarketplace],
    network,
    'savoryPreserves',
  )?.id,
  stockedMarketplace.id,
  'live deliveries must use stocked Marketplace inventory',
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

const activeRoofRetrofit = residence('active-roof-retrofit', 4, 15);
Object.assign(activeRoofRetrofit, {
  roofTileRetrofitActive: true,
  upgradeProgress: 0.4,
  upgradeRequiredTimber: RESIDENCE_TILE_ROOF_TIMBER_COST,
  upgradeRequiredRoofTiles: RESIDENCE_TILE_ROOF_TILE_COST,
  upgradeDeliveredTimber: RESIDENCE_TILE_ROOF_TIMBER_COST,
  upgradeDeliveredRoofTiles: RESIDENCE_TILE_ROOF_TILE_COST / 2,
  upgradeReservedRoofTiles: RESIDENCE_TILE_ROOF_TILE_COST / 2,
  upgradeAssignedLabor: 1,
});
const roofTileCart = deliveryTrip({
  id: 'trip-roof-tiles',
  residenceId: activeRoofRetrofit.id,
  cargoKind: 'roofTiles',
  amount: RESIDENCE_TILE_ROOF_TILE_COST / 4,
});
const roofProject = residenceRoofTileProject(activeRoofRetrofit, [roofTileCart]);
assert.ok(roofProject);
assert.equal(roofProject.required.roofTiles, RESIDENCE_TILE_ROOF_TILE_COST);
assert.equal(
  roofProject.delivered.roofTiles,
  RESIDENCE_TILE_ROOF_TILE_COST / 2,
);
assert.equal(
  roofProject.incoming.roofTiles,
  RESIDENCE_TILE_ROOF_TILE_COST / 4,
);
assert.equal(
  residenceUpgradeWorkplaces([activeRoofRetrofit]).length,
  1,
  'roof retrofits should use the same visible one-builder household worksite',
);

const activeBackyard = residence('active-backyard', 1, 3);
Object.assign(activeBackyard, {
  backyardProjectKind: BACKYARD_GARDEN_KINDS.indexOf('vegetable_garden') + 1,
  upgradeProgress: 0.2,
  upgradeRequiredTimber: 6,
  upgradeRequiredStone: 2,
  upgradeDeliveredTimber: 2,
  upgradeDeliveredStone: 0,
  upgradeRequiredGold: 3,
  upgradeDeliveredGold: 1,
  upgradeReservedTimber: 4,
  upgradeReservedStone: 2,
  upgradeReservedGold: 2,
  upgradeAssignedLabor: 1,
  upgradePriority: 1,
});
const backyardProject = residenceBackyardProject(activeBackyard);
assert.ok(backyardProject);
assert.equal(backyardProject.kind, 'vegetable_garden');
assert.equal(backyardProject.priorityLabel, 'Low');
assert.equal(backyardProject.materialReadiness, 0.25);
assert.equal(residenceUpgradeProject(activeBackyard), null);
assert.equal(
  residenceUpgradeWorkplaces([activeBackyard]).length,
  1,
  'backyard works should use the same visible household builder path',
);
const backyardState = emptyGameState(
  [Object.assign(building('backyard-camp', 'founders_camp', 0), {
    timber: 100,
    stone: 80,
    assignedLabor: 0,
  })],
  [activeBackyard],
  [],
);
assert.equal(computeResourceTotals(backyardState).timber, 96);
assert.equal(computeResourceTotals(backyardState).stone, 78);
assert.equal(computeStoredResourceTotals(backyardState).timber, 100);
assert.equal(computeStoredResourceTotals(backyardState).stone, 80);
assert.equal(computePopulationStats(backyardState).assigned, 0);
assert.equal(computePopulationStats(backyardState).flexibleAssigned, 1);

const activeFireRepair = residence('active-fire-repair', 2, 0);
Object.assign(activeFireRepair, {
  abandoned: false,
  fireRepairActive: true,
  upgradeProgress: 0.35,
  upgradeRequiredTimber: 20,
  upgradeRequiredStone: 12,
  upgradeRequiredGold: 0,
  upgradeDeliveredTimber: 8,
  upgradeDeliveredStone: 3,
  upgradeReservedTimber: 7,
  upgradeReservedStone: 5,
  upgradeReservedGold: 0,
  upgradeAssignedLabor: 1,
  upgradePriority: 3,
});
const fireRepairProject = residenceFireRepairProject(activeFireRepair);
assert.ok(fireRepairProject);
assert.equal(fireRepairProject.priorityLabel, 'Urgent');
assert.deepEqual(fireRepairProject.required, {
  timber: 20,
  stone: 12,
  gold: 0,
  roofTiles: 0,
});
assert.equal(residenceUpgradeProject(activeFireRepair), null);
assert.equal(residenceBackyardProject(activeFireRepair), null);
assert.equal(
  residenceUpgradeWorkplaces([activeFireRepair]).length,
  1,
  'fire recovery should share the visible household builder path',
);
const fireRepairState = emptyGameState(
  [Object.assign(building('repair-camp', 'founders_camp', 0), {
    timber: 100,
    stone: 80,
    assignedLabor: 0,
  })],
  [activeFireRepair],
  [],
);
assert.equal(computeResourceTotals(fireRepairState).timber, 93);
assert.equal(computeResourceTotals(fireRepairState).stone, 75);
assert.equal(computePopulationStats(fireRepairState).assigned, 0);
assert.equal(computePopulationStats(fireRepairState).flexibleAssigned, 1);

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
  roofTiles: 0,
});
assert.doesNotMatch(
  initialProject.blockers.join(' '),
  /coin|gold|lockbox/i,
  'founding cottages should grow from the material economy without a civic coin charge',
);

const legacyFractionalStall = residence('legacy-fractional-stall', 0, 0);
Object.assign(legacyFractionalStall, {
  upgradeTargetTier: 1,
  upgradeProgress: 0.97,
  upgradeRequiredTimber: 9.4,
  upgradeRequiredStone: 11,
  upgradeDeliveredTimber: 9,
  upgradeDeliveredStone: 11,
  upgradeReservedTimber: 0.4,
  upgradeReservedStone: 0,
  upgradeAssignedLabor: 0,
  upgradePriority: 2,
});
const legacyFractionalProject = residenceUpgradeProject(legacyFractionalStall);
assert.ok(legacyFractionalProject);
assert.equal(
  legacyFractionalProject.blockers[0],
  '0.4 timber still reserved at source',
  'the inspector should name the unhaulable residue before the derived builder wait',
);
assert.equal(legacyFractionalProject.blockers[1], 'waiting for a free builder');

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
assert.deepEqual(
  {
    timber: computeStoredResourceTotals(physicalState).timber,
    stone: computeStoredResourceTotals(physicalState).stone,
    gold: computeStoredResourceTotals(physicalState).gold,
  },
  { timber: 100, stone: 80, gold: 20 },
  'total presentation should retain stock already committed to the active project',
);
assert.equal(computePopulationStats(physicalState).assigned, 0);
assert.equal(computePopulationStats(physicalState).flexibleAssigned, 2);

const stockedHousehold = residence('hud-stocked-household', 4, 3);
stockedHousehold.needs.firewood.stock = 2;
stockedHousehold.needs.water.stock = 3;
stockedHousehold.needs.ale.stock = 4;
stockedHousehold.needs.cloth.stock = 1;
stockedHousehold.needs.shoes.stock = 2;
stockedHousehold.needs.pottery.stock = 2;
stockedHousehold.remedyStock = 1;
const publicStore = Object.assign(building('hud-public-store', 'village_storehouse', 0), {
  firewood: 9,
  water: 7,
  ale: 6,
  cloth: 5,
  shoes: 4,
  pottery: 3,
  remedies: 2,
});
const hudAccountingState = emptyGameState([publicStore], [stockedHousehold], []);
const availableHudStock = computeResourceTotals(hudAccountingState);
const totalHudStock = computeStoredResourceTotals(hudAccountingState);
assert.deepEqual(
  {
    firewood: availableHudStock.firewood,
    water: availableHudStock.water,
    ale: availableHudStock.ale,
    cloth: availableHudStock.cloth,
    shoes: availableHudStock.shoes,
    pottery: availableHudStock.pottery,
    remedies: availableHudStock.remedies,
  },
  { firewood: 9, water: 7, ale: 6, cloth: 5, shoes: 4, pottery: 3, remedies: 2 },
  'the default Surplus HUD must not promise private household reserves as spendable town stock',
);
assert.deepEqual(
  {
    firewood: totalHudStock.firewood,
    water: totalHudStock.water,
    ale: totalHudStock.ale,
    cloth: totalHudStock.cloth,
    shoes: totalHudStock.shoes,
    pottery: totalHudStock.pottery,
    remedies: totalHudStock.remedies,
  },
  { firewood: 11, water: 10, ale: 10, cloth: 6, shoes: 6, pottery: 5, remedies: 3 },
  'the opt-in Total HUD must retain the same physically owned household reserves',
);

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
  /ResidenceNeedKind::Water[\s\S]*?position_within_well_service_radius/,
);
assert.match(residenceReducer, /residence_promotion_needs\(residence\.tier\)/);
assert.match(residenceReducer, /required_chapel_tier\(residence\.tier\)/);
assert.doesNotMatch(residenceReducer, /CLOTH_PRODUCER_KINDS|SHOES_PRODUCER_KINDS|SAVORY_PRESERVE_PRODUCER_KINDS|POTTERY_PRODUCER_KINDS/);
assert.match(
  residenceReducer,
  /ResidenceNeedKind::Cloth[\s\S]*building\.kind == "marketplace"[\s\S]*CommodityKind::Cloth/,
  'authoritative promotion must accept staged Marketplace cloth instead of demanding a Weaver',
);
assert.match(
  residenceReducer,
  /ResidenceNeedKind::FoodVariety[\s\S]*building\.kind == "marketplace"[\s\S]*building_food_progression_met/,
  'authoritative promotion must accept a complete current-tier diet staged at one Marketplace',
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
  /upgrade_required_timber: required_timber[\s\S]*upgrade_reserved_timber: required_timber[\s\S]*ensure_upgrade_source_route\([\s\S]*CommodityKind::Timber,[\s\S]*required_timber[\s\S]*CommodityKind::Stone,[\s\S]*required_stone/,
  'each depth-scaled founding cottage cost must remain reserved at reachable physical sources',
);
assert.match(residenceReducer, /upgrade_reserved_timber = timber/);
assert.match(residenceReducer, /upgrade_delivered_gold = household_contribution/);
assert.match(residenceReducer, /spend_aggregate_timber\(ctx, owner, timber\)/);
assert.match(residenceReducer, /set_residence_upgrade_priority/);
assert.match(residenceReducer, /pub fn retrofit_residence_tile_roof/);
assert.match(
  residenceReducer,
  /residence\.tier < 4[\s\S]*available_tiles[\s\S]*RESIDENCE_TILE_ROOF_TILE_COST/,
  'legacy retrofits must remain a costly tier-four-only project',
);

const backyardReducer = source('../server/src/reducers/backyards.rs');
assert.match(backyardReducer, /residence_upgrade_household_contribution/);
assert.match(backyardReducer, /upgrade_delivered_gold = household_contribution/);
assert.match(backyardReducer, /upgrade_reserved_gold = civic_gold_due/);

const generatedRustBalance = source('../server/src/balance_generated.rs');
assert.doesNotMatch(generatedRustBalance, /\bundefined\b/);
assert.match(
  generatedRustBalance,
  /pub struct BackyardGardenDef \{[\s\S]*?pub cost_gold: f64/,
  'generated backyard definitions must carry their authoritative gold cost',
);
assert.match(
  residenceReducer,
  /ensure_upgrade_source_route\([\s\S]*CommodityKind::RoofTiles[\s\S]*RESIDENCE_TILE_ROOF_TILE_COST/,
  'tier-four tile roofs must reserve a real routed tile stock before work begins',
);
assert.match(
  residenceReducer,
  /roof_tiles: salvaged_roof_tiles/,
  'demolished tile roofs should leave physical reclaimable material',
);
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
assert.match(residenceInspector, /Current Tier \$\{plan\.currentTier\} readiness/);
assert.match(residenceInspector, /Tier \$\{plan\.nextTier\} adds after completion/);
assert.match(residenceInspector, /Upgrade resources/);
assert.match(residenceInspector, /Project funding/);
assert.match(residenceInspector, /household contribution/);
assert.match(residenceInspector, /treasury grant/);
assert.match(residenceInspector, /Household prosperity/);
assert.doesNotMatch(residenceInspector, /Household wealth/);
assert.match(
  residenceInspector,
  /data-action="upgrade-residence" data-upgrade-tier="\$\{plan\.nextTier\}" data-tooltip-title="Tier \$\{plan\.nextTier\}" data-tooltip="\$\{detail\}" \$\{plan\.ready \? '' : 'aria-disabled="true"'\}/,
  'the compact upgrade control must preserve keyboard-reachable tooltip context and authoritative gating',
);
assert.match(residenceInspector, /<span>Upgrade · Tier \$\{plan\.nextTier\}<\/span>/);
assert.doesNotMatch(residenceInspector, /Begin tier \$\{plan\.nextTier\} works/);
assert.match(residenceInspector, /data-residence-upgrade-priority/);
assert.match(
  residenceInspector,
  /function residenceUpgradeProjectPanel\([\s\S]{0,180}return residenceProjectPriorityPanel\(project\.priority\);\s*\}/,
  'an active residence upgrade should expose controls without explanatory prose',
);
assert.match(
  residenceInspector,
  /function residenceFireRepairProjectPanel\([\s\S]{0,180}return residenceProjectPriorityPanel\(project\.priority\);\s*\}/,
  'an active fire repair should expose controls without explanatory prose',
);
assert.match(
  residenceInspector,
  /function residenceRoofTileProjectPanel\([\s\S]{0,180}return residenceProjectPriorityPanel\(project\.priority\);\s*\}/,
  'an active roof retrofit should expose controls without explanatory prose',
);
assert.match(
  residenceInspector,
  /inspector-action-panel inspector-action-panel--compact"[^>]*aria-label="Priority"/,
);
assert.match(residenceInspector, /project\.blockers\[0\]/);
assert.match(residenceInspector, /Inspect incoming \$\{trip\.cargoKind\} cart/);
assert.match(residenceInspector, /structural recovery required before settlement resumes/);
assert.match(residenceInspector, /TIMBER_SALVAGE_FRACTION \* 100\)}% timber/);
assert.doesNotMatch(residenceInspector, /Cottage construction is physical/);
assert.match(residenceInspector, /Cancel cottage works/);
assert.match(residenceInspector, /Fire recovery worksite/);
assert.match(residenceInspector, /Fired-tile roof retrofit/);
assert.doesNotMatch(residenceInspector, /Roof fire exposure/);
assert.match(
  residenceInspector,
  /Bundled thatch · cottage roof[\s\S]*Split wooden shingle · tier-2\/3 roof/,
  'the inspector must expose the authored roof progression',
);

const backyardInspector = source('../src/resources/inspector/backyardRenderer.ts');
assert.match(backyardInspector, /householdProjectFunding/);
assert.match(backyardInspector, /Household \$\{formatProjectAmount\(funding\.householdContribution\)\}/);
assert.match(backyardInspector, /Treasury \$\{formatProjectAmount\(funding\.civicGoldRequired\)\}/);
assert.match(backyardInspector, /project\.delivered\.gold/);
assert.match(backyardInspector, /project\.reserved\.gold/);

const residenceMarkers = source('../src/residences/ResidenceMarkers.ts');
assert.match(residenceMarkers, /ResidenceUpgradeWorks/);
assert.match(residenceMarkers, /UpgradeTimberSegment:/);
assert.match(residenceMarkers, /UpgradeStoneSegment:/);
assert.match(residenceMarkers, /upgradeProgress/);
assert.match(residenceMarkers, /upgradeDeliveredTimber/);
assert.match(residenceMarkers, /InitialCottageConstructionFrame/);
assert.match(residenceMarkers, /InitialCottageFrameSegment/);
assert.match(residenceMarkers, /fired-clay tile.*split-wood shingle/);
assert.match(residenceMarkers, /Delivered fired roof tile/);

const upgradeSimulation = source('../server/src/simulation/residence_upgrades.rs');
assert.match(upgradeSimulation, /HashMap<[\s\S]*CONSTRUCTION_PRIORITY_LEVELS/);
assert.match(upgradeSimulation, /try_start_residence_upgrade_supply_trip/);
assert.match(upgradeSimulation, /ensure_residence_needs\(ctx, residence_id\)/);
assert.match(upgradeSimulation, /initial_cottage_works/);
assert.match(upgradeSimulation, /residence_upgrade_work_ready\(upgrade_work\(&residence\)\)/);
assert.match(upgradeSimulation, /residence_project_labor_targets/);
assert.match(upgradeSimulation, /has_approaching_upgrade_supply/);
const upgradeDispatchStart = upgradeSimulation.indexOf('fn dispatch_upgrade_material(');
const upgradeRouteStart = upgradeSimulation.indexOf('fn upgrade_route_distance(', upgradeDispatchStart);
assert.ok(upgradeDispatchStart >= 0 && upgradeRouteStart > upgradeDispatchStart);
const upgradeDispatch = upgradeSimulation.slice(upgradeDispatchStart, upgradeRouteStart);
assert.doesNotMatch(
  upgradeDispatch,
  /upgrade_assigned_labor\s*==\s*0/,
  'an unstaffed cottage must be able to release its lone worker for material hauling',
);
assert.match(
  upgradeDispatch,
  /construction_source_cart_busy\(ctx, &source\)/,
  'the open founders stockyard must not serialize every cottage behind a returning cart',
);
assert.match(
  upgradeSimulation,
  /if residence\.roof_tile_retrofit_active[\s\S]*residence\.tiled_roof = true/,
);
assert.match(
  upgradeSimulation,
  /backyard_project_kind[\s\S]*BackyardGardenKind::from_id[\s\S]*backyard_garden\(\)\.insert/,
  'a productive garden row should only appear after its physical household project completes',
);
assert.match(
  upgradeSimulation,
  /if residence\.fire_repair_active[\s\S]*clear_fire_for_target[\s\S]*clear_residence_project/,
  'fire recovery should clear the outage only after physical work completes',
);

const deliveryTrips = source('../server/src/simulation/delivery_trips.rs');
assert.match(deliveryTrips, /try_start_residence_upgrade_supply_trip/);
assert.match(deliveryTrips, /unload_residence_upgrade_material/);
assert.match(deliveryTrips, /upgrade_reserved_gold/);
assert.match(deliveryTrips, /residence_project_active/);
assert.match(deliveryTrips, /CommodityKind::RoofTiles/);
assert.match(
  deliveryTrips,
  /tick\.residence_disabled_by_fire\(ctx, residence\.id\) && !residence\.fire_repair_active/,
  'only recovery carts may enter a fire-disabled household destination',
);
const upgradeTripStart = deliveryTrips.indexOf('pub fn try_start_residence_upgrade_supply_trip(');
const fireTripStart = deliveryTrips.indexOf('pub fn try_start_fire_response_trip(', upgradeTripStart);
assert.ok(upgradeTripStart >= 0 && fireTripStart > upgradeTripStart);
const upgradeTrip = deliveryTrips.slice(upgradeTripStart, fireTripStart);
assert.match(upgradeTrip, /construction_source_cart_busy\(ctx, origin\)/);
assert.doesNotMatch(
  upgradeTrip,
  /building_has_active_trip\(ctx, origin\.id\)/,
  'a founders-camp return leg must not block another independently staffed cottage cart',
);

const upgradePolicy = source('../server/src/residence_upgrade_policy.rs');
assert.match(
  upgradePolicy,
  /pub fn residence_upgrade_work_ready[\s\S]*residence_upgrade_is_paid[\s\S]*residence_upgrade_material_readiness/,
  'residence builders should hold labor only while paid onsite material is buildable',
);
assert.match(
  upgradePolicy,
  /pub fn residence_project_labor_targets[\s\S]*site\.work_ready \|\| site\.inbound_supply[\s\S]*site\.work_ready && selected\.insert/,
  'the native-tested residence labor policy must recall blocked builders while preserving approaching carts',
);

const residenceBinding = source('../src/generated/residence_table.ts');
assert.match(residenceBinding, /backyardProjectKind: __t\.u8\(\)/);
assert.match(residenceBinding, /fireRepairActive: __t\.bool\(\)/);
assert.match(residenceBinding, /tiledRoof: __t\.bool\(\)/);
assert.match(residenceBinding, /upgradeRequiredRoofTiles: __t\.f64\(\)/);

const recoveryReducer = source('../server/src/reducers/fire_recovery.rs');
assert.match(recoveryReducer, /Homestead recovery is already underway/);
assert.match(
  recoveryReducer,
  /if physical_economy[\s\S]*cancel_trips_for_residence[\s\S]*ensure_upgrade_source_route[\s\S]*fire_repair_active = true[\s\S]*upgrade_priority = CONSTRUCTION_PRIORITY_URGENT[\s\S]*return Ok\(\(\)\)[\s\S]*spend_aggregate_timber/,
  'physical saves must reserve routed materials and return before the legacy aggregate fallback',
);

const fireSimulation = source('../server/src/simulation/fires.rs');
assert.match(
  fireSimulation,
  /residence_project_active[\s\S]*cancel_trips_for_residence[\s\S]*clear_residence_project/,
  'ignition should cancel any unfinished household works before fire loss is recorded',
);
const firePolicy = source('../server/src/fire_policy.rs');
assert.match(
  firePolicy,
  /base \* RESIDENCE_TILE_ROOF_FLAMMABILITY_MULTIPLIER/,
  'a tile roof must reduce physical fire weighting without becoming fireproof',
);

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
      firewood: { stock: 0, deficitTicks: 0 },
      water: { stock: 0, deficitTicks: 0 },
      food: { stock: 0, deficitTicks: 0 },
      savoryPreserves: { stock: 0, deficitTicks: 0 },
      ale: { stock: 0, deficitTicks: 0 },
      cloth: { stock: 0, deficitTicks: 0 },
      shoes: { stock: 0, deficitTicks: 0 },
      pottery: { stock: 0, deficitTicks: 0 },
      church: { stock: 0, deficitTicks: 0 },
      foodVariety: { stock: 0, deficitTicks: 0 },
      luxury: { stock: 0, deficitTicks: 0 },
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
    curedMeat: 0,
    smokedFish: 0,
    cheese: 0,
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
