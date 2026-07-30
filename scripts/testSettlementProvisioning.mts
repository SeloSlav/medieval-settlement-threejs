import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
  GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
  PRESERVED_FOOD_SPOILAGE_PER_DAY,
  PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_POTTERY_PER_PERSON_PER_SEC,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  computeSettlementProvisioning,
  formatHouseholdBufferReadiness,
  formatProvisionDays,
  formatSabbathReadiness,
  HOUSEHOLD_BUFFER_CRITICAL_COVERAGE,
  HOUSEHOLD_BUFFER_WARNING_COVERAGE,
  settlementProvisionLevel,
  shouldShowProvisioning,
  WINTER_RESERVE_DAYS,
} from '../src/economy/settlementProvisioning.ts';
import {
  allocatePreservedMeal,
  freshFoodRunwayWithPreservedRotation,
} from '../src/economy/preservedFoodPolicy.ts';
import { computeResourceTotals } from '../src/resources/resourceTotals.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';

const serverCalendar = readFileSync(
  new URL('../server/src/simulation/game_calendar.rs', import.meta.url),
  'utf8',
);
const laborSchedule = readFileSync(
  new URL('../server/src/simulation/labor_schedule.rs', import.meta.url),
  'utf8',
);
const residenceNeeds = readFileSync(
  new URL('../server/src/simulation/residence_needs/mod.rs', import.meta.url),
  'utf8',
);
const serverPreservedFoodPolicy = readFileSync(
  new URL('../server/src/preserved_food_policy.rs', import.meta.url),
  'utf8',
);
const clientPreservedFoodPolicy = readFileSync(
  new URL('../src/economy/preservedFoodPolicy.ts', import.meta.url),
  'utf8',
);
const authoritativeSimulation = readFileSync(
  new URL('../server/src/reducers/simulation.rs', import.meta.url),
  'utf8',
);
const settlementHud = readFileSync(
  new URL('../src/ui/SettlementHud.ts', import.meta.url),
  'utf8',
);
const chapelInspector = readFileSync(
  new URL('../src/resources/inspector/chapelRenderer.ts', import.meta.url),
  'utf8',
);
const guardhouseInspector = readFileSync(
  new URL('../src/resources/inspector/guardhouseRenderer.ts', import.meta.url),
  'utf8',
);
const townHallInspector = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../src/app/App.ts', import.meta.url),
  'utf8',
);

assert.match(
  serverCalendar,
  /pub fn household_consumption_paused[\s\S]*?!clock\.is_work_hours/,
  'household consumption should pause at night, not because the day is Sunday',
);
assert.match(laborSchedule, /is_consumption_paused[\s\S]*?household_consumption_paused\(clock\)/);
assert.match(residenceNeeds, /Sunday observance does not make provisions free/);
for (const policySource of [
  serverPreservedFoodPolicy,
  clientPreservedFoodPolicy,
]) {
  assert.match(policySource, /preserved.*rotation/i);
  assert.match(policySource, /preserved.*fallback/i);
  assert.match(policySource, /fresh/i);
}
assert.match(
  clientPreservedFoodPolicy,
  /freshFoodRunwayWithPreservedRotation/,
);
assert.match(
  authoritativeSimulation,
  /residence_disabled_by_fire\(ctx, residence\.id\)[\s\S]*continue;/,
  'fire-disabled residences must be excluded from authoritative household consumption',
);
assert.match(settlementHud, /Sunday stores/);
assert.match(settlementHud, /Household buffers/);
assert.match(settlementHud, /Local delivery buffer/);
assert.match(settlementHud, /Road-branch audit/);
assert.match(settlementHud, /Weakest occupied road branch/);
assert.match(settlementHud, /gross meal demand/);
assert.match(settlementHud, /finite cured stock/);
assert.match(settlementHud, /guard food/);
assert.match(settlementHud, /first local company/);
assert.match(chapelInspector, /stock them before Saturday night/);
assert.match(guardhouseInspector, /Food endurance/);
assert.match(guardhouseInspector, /PROVISION_WARNING_DAYS/);
assert.match(townHallInspector, /first shortfall/);
assert.match(townHallInspector, /Household delivery buffer/);
assert.match(townHallInspector, /Road-branch provisions/);
assert.match(townHallInspector, /first road-branch provision exposure/);
assert.match(townHallInspector, /Cured ration displacement/);
assert.match(townHallInspector, /current fresh demand after/);
assert.doesNotMatch(
  townHallInspector,
  /Â/,
  'the settlement ledger must not expose double-decoded separators',
);
assert.match(
  appSource,
  /computeSettlementProvisioning\([\s\S]*?roadComponentFor:[\s\S]*?roadComponentAt/,
);

const state = emptyGameState();
state.stockpile.food = 72;
state.stockpile.firewood = 4
  * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
  * 120
  * WINTER_FIREWOOD_DEMAND_MULTIPLIER
  * 15;
state.stockpile.gold = 7;
state.residences.set('tier-1', residence('tier-1', 1, 3));
state.residences.set('tier-2', residence('tier-2', 2, 4));
const guards = building('guards', 'guardhouse', 3, 2.9);
guards.food = 9;
state.buildings.set('guards', guards);

const provisioning = computeSettlementProvisioning({
  state,
  totals: computeResourceTotals(state),
  currentFirewoodDemandMultiplier: 1.15,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: true,
});

assert.equal(provisioning.foodConsumers, 7);
assert.equal(provisioning.heatedResidents, 4);
assert.equal(provisioning.assignedGuards, 3);
assert.equal(provisioning.armedGuards, 2, 'each ready guard must have one whole polearm');
assert.equal(provisioning.unarmedGuards, 1);
assert.equal(provisioning.guardFoodStock, 9);
assert.ok(Math.abs(provisioning.guardProvisionRunwayDays - 10) < 1e-9);
assert.equal(provisioning.householdBufferHouseholds, 2);
assert.equal(provisioning.householdBufferReadyHouseholds, 0);
assert.equal(provisioning.householdBufferCoverage, 0);
assert.equal(provisioning.householdBufferFoodShortHomes, 2);
assert.equal(provisioning.householdBufferFirewoodShortHomes, 1);
assert.equal(provisioning.householdBufferWaterShortHomes, 1);
assert.equal(provisioning.householdBufferPreservedFoodShortHomes, 0);
assert.equal(provisioning.householdBufferAleShortHomes, 0);
assert.equal(provisioning.householdBufferClothShortHomes, 0);
assert.equal(provisioning.householdBufferPotteryShortHomes, 0);
assert.match(formatHouseholdBufferReadiness(provisioning), /0 \/ 2 homes buffered/);
assert.ok(Math.abs(
  provisioning.householdFoodPerDay
  - 7 * RESIDENCE_FOOD_PER_PERSON_PER_SEC * 70,
) < 1e-9);
assert.equal(
  provisioning.grossHouseholdFoodPerDay,
  provisioning.householdFoodPerDay,
);
assert.equal(provisioning.householdPreservedFoodRotationTargetPerDay, 0);
assert.equal(provisioning.householdPreservedFoodRotationPerDay, 0);
assert.equal(provisioning.guardFoodPerDay, 2 * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY);
assert.equal(provisioning.grossFoodDemandPerDay, provisioning.totalFoodPerDay);
assert.ok(Math.abs(
  provisioning.foodRunwayDays
  - provisioning.foodStock
    / (7 * RESIDENCE_FOOD_PER_PERSON_PER_SEC * 70 + provisioning.guardFoodPerDay),
) < 1e-9);
assert.ok(Math.abs(
  provisioning.winterFirewoodPerDay
  - 4 * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC * 120 * WINTER_FIREWOOD_DEMAND_MULTIPLIER,
) < 1e-9);
assert.ok(
  Math.abs(provisioning.winterFirewoodRunwayDays - 15) < 1e-9,
  `expected 15 winter firewood days, received ${provisioning.winterFirewoodRunwayDays}`,
);
assert.ok(Math.abs(provisioning.winterFirewoodCoverage - 1 / 6) < 1e-9);
assert.equal(provisioning.guardWagePerDay, 2 * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY);
assert.ok(Math.abs(provisioning.guardWageRunwayDays - 10) < 1e-9);
assert.equal(provisioning.sabbathHouseholds, 2);
assert.equal(provisioning.sabbathReadyHouseholds, 0);
assert.equal(provisioning.sabbathFoodShortHomes, 2);
assert.equal(provisioning.sabbathFirewoodShortHomes, 1);
assert.equal(provisioning.sabbathWaterShortHomes, 1);
assert.equal(provisioning.roadBranches, null, 'legacy callers may omit road topology');
assert.match(formatSabbathReadiness(provisioning), /0 \/ 2 homes stocked/);
assert.equal(settlementProvisionLevel(provisioning, 10), 'critical');
assert.equal(shouldShowProvisioning(provisioning, 10), true);
assert.equal(formatProvisionDays(provisioning.winterFirewoodRunwayDays), '15d');
assert.equal(WINTER_RESERVE_DAYS, 90);
assert.equal(HOUSEHOLD_BUFFER_WARNING_COVERAGE, 0.8);
assert.equal(HOUSEHOLD_BUFFER_CRITICAL_COVERAGE, 0.5);

const physicalPayrollState = emptyGameState();
physicalPayrollState.stockpile.gold = 7;
const payrollGuards = building('payroll-guards', 'guardhouse', 3, 2.9);
payrollGuards.gold = 4;
physicalPayrollState.buildings.set(payrollGuards.id, payrollGuards);
const payrollTownHall = building('payroll-town-hall', 'townHall', 1, 0);
physicalPayrollState.buildings.set(payrollTownHall.id, payrollTownHall);
physicalPayrollState.deliveryTrips.set('guard-payroll-cart', {
  id: 'guard-payroll-cart',
  buildingId: payrollTownHall.id,
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: payrollGuards.id,
  cargoKind: 'gold',
  amount: 3,
  phase: 'outbound',
  x: 0,
  z: 0,
  progress: 0,
  speedMps: 2,
  unloadSeconds: 3,
  unloadRemaining: 3,
  deliveryWorkers: 1,
  freeHaulerWorkers: 1,
  pathDistance: 20,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
});
const physicalPayroll = computeSettlementProvisioning({
  state: physicalPayrollState,
  totals: computeResourceTotals(physicalPayrollState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: true,
});
assert.equal(physicalPayroll.guardPayChestGold, 4);
assert.equal(physicalPayroll.guardPayrollInTransitGold, 3);
assert.ok(
  Math.abs(physicalPayroll.guardWageRunwayDays - 20) < 1e-9,
  'guard wage runway must include treasury gold, local pay chests, and outbound payroll carts',
);

state.fireIncidents.set('guardhouse-fire', {
  id: 'guardhouse-fire',
  targetKind: 'building',
  targetId: guards.id,
} as FireIncidentState);
const fireSuspendedGuards = computeSettlementProvisioning({
  state,
  totals: computeResourceTotals(state),
  currentFirewoodDemandMultiplier: 1.15,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: true,
});
assert.equal(fireSuspendedGuards.assignedGuards, 0);
assert.equal(fireSuspendedGuards.armedGuards, 0);
assert.equal(fireSuspendedGuards.guardFoodPerDay, 0);
assert.equal(fireSuspendedGuards.guardWagePerDay, 0);
assert.equal(fireSuspendedGuards.fireQuarantinedFoodStock, 9);
assert.equal(
  fireSuspendedGuards.usableFoodStock,
  fireSuspendedGuards.foodStock - 9,
);
state.fireIncidents.clear();

const displacedState = emptyGameState();
displacedState.stockpile.food = 50;
const healthyHome = residence('healthy-home', 1, 4);
healthyHome.needs.food.stock = 4;
displacedState.residences.set(healthyHome.id, healthyHome);
const fireDisabledHome = residence('fire-disabled-home', 2, 4);
fireDisabledHome.needs.food.stock = 20;
fireDisabledHome.needs.firewood.stock = 30;
displacedState.residences.set(fireDisabledHome.id, fireDisabledHome);
const emptySource = building('empty-source', 'granary', 1, 0);
displacedState.buildings.set(emptySource.id, emptySource);
displacedState.deliveryTrips.set('cart-to-fire-disabled-home', {
  id: 'cart-to-fire-disabled-home',
  buildingId: emptySource.id,
  residenceId: fireDisabledHome.id,
  destinationKind: 'residence',
  targetBuildingId: null,
  cargoKind: 'food',
  amount: 40,
  phase: 'outbound',
  x: 0,
  z: 0,
  progress: 0,
  speedMps: 2,
  unloadSeconds: 3,
  unloadRemaining: 3,
  deliveryWorkers: 1,
  freeHaulerWorkers: 0,
  pathDistance: 20,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
});
displacedState.fireIncidents.set('home-fire', {
  id: 'home-fire',
  targetKind: 'residence',
  targetId: fireDisabledHome.id,
} as FireIncidentState);
const displaced = computeSettlementProvisioning({
  state: displacedState,
  totals: computeResourceTotals(displacedState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0.01,
  sabbathObserved: true,
  roadComponentFor: () => 'village',
});
assert.equal(displaced.foodConsumers, 4);
assert.equal(displaced.heatedResidents, 0);
assert.equal(displaced.displacedHouseholds, 1);
assert.equal(displaced.displacedResidents, 4);
assert.equal(displaced.householdBufferHouseholds, 1);
assert.equal(displaced.sabbathHouseholds, 1);
assert.equal(displaced.fireQuarantinedFoodStock, 20);
assert.equal(displaced.fireQuarantinedFirewoodStock, 30);
assert.equal(displaced.foodStock, 74);
assert.equal(displaced.usableFoodStock, 54);
assert.equal(displaced.firewoodStock, 30);
assert.equal(displaced.usableFirewoodStock, 0);
assert.equal(
  displaced.roadBranches?.physicalFoodStock,
  4,
  'cargo bound for a fire-disabled home must not promise usable branch stock',
);
assert.equal(
  displaced.foodPreservation.quarantinedSpoilagePerDay,
  0,
  'a suspended household does not run the residence spoilage step until recovery',
);

const critical = computeSettlementProvisioning({
  state,
  totals: { ...computeResourceTotals(state), food: 7 },
  currentFirewoodDemandMultiplier: 1.15,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: true,
});
assert.equal(settlementProvisionLevel(critical, 7), 'critical');
assert.equal(shouldShowProvisioning(critical, 7), true);

const locallyStarvedState = emptyGameState();
locallyStarvedState.stockpile.food = 500;
locallyStarvedState.stockpile.gold = 500;
const locallyStarvedGuards = building('starved-guards', 'guardhouse', 3, 3);
locallyStarvedGuards.food = 0;
locallyStarvedState.buildings.set(locallyStarvedGuards.id, locallyStarvedGuards);
const locallyStarved = computeSettlementProvisioning({
  state: locallyStarvedState,
  totals: computeResourceTotals(locallyStarvedState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
});
assert.ok(locallyStarved.foodRunwayDays > 100, 'aggregate village food can look abundant');
assert.equal(
  locallyStarved.guardProvisionRunwayDays,
  0,
  'guard readiness must use food physically stored at the guardhouse',
);
assert.equal(
  settlementProvisionLevel(locallyStarved, 7),
  'critical',
  'an empty guardhouse must not be hidden by remote aggregate food',
);

const splitBranchState = emptyGameState();
const splitHome = residence('split-home', 1, 4);
splitHome.x = 0;
splitHome.needs.food.stock = 4 * RESIDENCE_FOOD_PER_PERSON_PER_SEC * 70;
splitBranchState.residences.set(splitHome.id, splitHome);
const remoteGranary = building('remote-granary', 'granary', 2, 0);
remoteGranary.x = 100;
remoteGranary.food = 300;
splitBranchState.buildings.set(remoteGranary.id, remoteGranary);
const splitBranches = computeSettlementProvisioning({
  state: splitBranchState,
  totals: computeResourceTotals(splitBranchState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: (entity) => entity.x < 50 ? 'west' : 'east',
});
assert.ok(
  splitBranches.foodRunwayDays > 50,
  'aggregate stores should demonstrate the false comfort of a remote granary',
);
assert.equal(splitBranches.householdBufferReadyHouseholds, 1);
assert.equal(splitBranches.roadBranches?.activeBranches, 1);
assert.equal(splitBranches.roadBranches?.foodSuppliedBranches, 0);
assert.equal(splitBranches.roadBranches?.foodUnservedBranches, 1);
assert.equal(splitBranches.roadBranches?.foodUnservedHouseholds, 1);
assert.ok((splitBranches.roadBranches?.worstFoodRunwayDays ?? 99) <= 1.01);
assert.equal(splitBranches.roadBranches?.firstExposedResidenceId, splitHome.id);
assert.equal(
  settlementProvisionLevel(splitBranches, 7),
  'critical',
  'one day of local food must not be hidden by stock on another road component',
);

splitBranchState.deliveryTrips.set('split-food-cart', {
  id: 'split-food-cart',
  buildingId: remoteGranary.id,
  residenceId: splitHome.id,
  destinationKind: 'residence',
  targetBuildingId: null,
  cargoKind: 'food',
  amount: 30,
  phase: 'outbound',
  x: 100,
  z: 0,
  progress: 0,
  speedMps: 2,
  unloadSeconds: 3,
  unloadRemaining: 3,
  deliveryWorkers: 1,
  freeHaulerWorkers: 0,
  pathDistance: 100,
  travelSpeedMultiplier: 1,
  routePolylineJson: '[]',
});
const splitWithArrival = computeSettlementProvisioning({
  state: splitBranchState,
  totals: computeResourceTotals(splitBranchState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: (entity) => entity.x < 50 ? 'west' : 'east',
});
assert.ok(
  (splitWithArrival.roadBranches?.worstFoodRunwayDays ?? 0)
    > (splitBranches.roadBranches?.worstFoodRunwayDays ?? 0),
  'cargo already bound for the branch should extend its physical runway',
);
assert.equal(
  splitWithArrival.roadBranches?.foodUnservedBranches,
  1,
  'one approaching load must count as stock without promising a repeatable route',
);
assert.equal(settlementProvisionLevel(splitWithArrival, 7), 'watch');

const curedBranchState = emptyGameState();
const curedBranchHome = residence('cured-branch-home', 3, 5);
curedBranchHome.x = 7;
curedBranchHome.needs.food.stock =
  5 * RESIDENCE_FOOD_PER_PERSON_PER_SEC * 70;
curedBranchState.residences.set(curedBranchHome.id, curedBranchHome);
const curedBranchSmokehouse = building(
  'cured-branch-smokehouse',
  'smokehouse',
  2,
  0,
);
curedBranchSmokehouse.x = 7;
curedBranchSmokehouse.preservedFood = 14;
curedBranchState.buildings.set(
  curedBranchSmokehouse.id,
  curedBranchSmokehouse,
);
const curedBranch = computeSettlementProvisioning({
  state: curedBranchState,
  totals: computeResourceTotals(curedBranchState),
  currentFirewoodDemandMultiplier: 1,
  currentPreservedFoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: () => 'cured',
});
assert.equal(curedBranch.roadBranches?.physicalPreservedFoodStock, 14);
assert.equal(curedBranch.usablePreservedFoodStock, 14);
assert.ok(Math.abs(
  curedBranch.preservedFoodSpoilagePerDay
  - 14
    * PRESERVED_FOOD_SPOILAGE_PER_DAY
    * PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
) < 1e-9);
assert.ok(
  curedBranch.foodRunwayDays <= curedBranch.foodRunwayWithoutSpoilageDays,
  'cured-food aging must not make the no-production settlement runway more optimistic',
);
assert.ok(
  (curedBranch.roadBranches?.worstFoodRunwayDays ?? 0) > 1,
  'same-branch cured stores should extend fresh-food runway only at the bounded rotation rate',
);
const winterCuredBranch = computeSettlementProvisioning({
  state: curedBranchState,
  totals: computeResourceTotals(curedBranchState),
  currentFirewoodDemandMultiplier: 1,
  currentPreservedFoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  preservedFoodSpoilageFractionPerDay:
    PRESERVED_FOOD_SPOILAGE_PER_DAY * 0.5,
  sabbathObserved: false,
  roadComponentFor: () => 'cured',
});
assert.ok(
  Math.abs(
    winterCuredBranch.preservedFoodSpoilagePerDay
    - curedBranch.preservedFoodSpoilagePerDay * 0.5,
  ) < 1e-9,
);
assert.ok(
  winterCuredBranch.preservedFoodSpoilageFractionPerDay
  < curedBranch.preservedFoodSpoilageFractionPerDay,
);
const originalCuredBranchTreasuryFood = curedBranchState.stockpile.food;
curedBranchState.stockpile.food = 10_000;
const longReserveTotals = {
  ...computeResourceTotals(curedBranchState),
  food: 10_000 + curedBranchHome.needs.food.stock,
};
const warmLongReserve = computeSettlementProvisioning({
  state: curedBranchState,
  totals: longReserveTotals,
  currentFirewoodDemandMultiplier: 1,
  currentPreservedFoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  preservedFoodSpoilageFractionPerDay: PRESERVED_FOOD_SPOILAGE_PER_DAY,
  sabbathObserved: false,
  roadComponentFor: () => 'cured',
});
const winterLongReserve = computeSettlementProvisioning({
  state: curedBranchState,
  totals: longReserveTotals,
  currentFirewoodDemandMultiplier: 1,
  currentPreservedFoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  preservedFoodSpoilageFractionPerDay:
    PRESERVED_FOOD_SPOILAGE_PER_DAY * 0.5,
  sabbathObserved: false,
  roadComponentFor: () => 'cured',
});
assert.ok(
  winterLongReserve.foodRunwayDays > warmLongReserve.foodRunwayDays,
  `cold storage must extend the cured-food rotation phase before fresh demand rises (${winterLongReserve.foodRunwayDays} vs ${warmLongReserve.foodRunwayDays})`,
);
curedBranchState.stockpile.food = originalCuredBranchTreasuryFood;
curedBranchState.fireIncidents.set('cured-store-fire', {
  id: 'cured-store-fire',
  targetKind: 'building',
  targetId: curedBranchSmokehouse.id,
} as FireIncidentState);
const quarantinedCuredBranch = computeSettlementProvisioning({
  state: curedBranchState,
  totals: computeResourceTotals(curedBranchState),
  currentFirewoodDemandMultiplier: 1,
  currentPreservedFoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: () => 'cured',
});
assert.equal(
  quarantinedCuredBranch.roadBranches?.physicalPreservedFoodStock,
  0,
);
assert.equal(quarantinedCuredBranch.usablePreservedFoodStock, 0);
assert.equal(quarantinedCuredBranch.fireQuarantinedPreservedFoodStock, 14);
assert.ok(Math.abs(
  (quarantinedCuredBranch.roadBranches?.worstFoodRunwayDays ?? 0) - 1,
) < 1e-9);

const reconnectedBranches = computeSettlementProvisioning({
  state: splitBranchState,
  totals: computeResourceTotals(splitBranchState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: () => 'reconnected',
});
assert.equal(reconnectedBranches.roadBranches?.activeBranches, 1);
assert.equal(reconnectedBranches.roadBranches?.foodSuppliedBranches, 1);
assert.equal(reconnectedBranches.roadBranches?.foodUnservedBranches, 0);
assert.ok((reconnectedBranches.roadBranches?.worstFoodRunwayDays ?? 0) > 50);
assert.equal(reconnectedBranches.roadBranches?.firstExposedResidenceId, null);
assert.equal(
  settlementProvisionLevel(reconnectedBranches, 7),
  'ready',
  'reconnecting the same physical granary should restore the branch forecast',
);

splitBranchState.deliveryTrips.clear();
splitBranchState.fireIncidents.set('remote-granary-fire', {
  id: 'remote-granary-fire',
  targetKind: 'building',
  targetId: remoteGranary.id,
} as FireIncidentState);
const fireDisabledSupplier = computeSettlementProvisioning({
  state: splitBranchState,
  totals: computeResourceTotals(splitBranchState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: () => 'reconnected',
});
assert.equal(fireDisabledSupplier.roadBranches?.foodSuppliedBranches, 0);
assert.equal(fireDisabledSupplier.roadBranches?.foodUnservedBranches, 1);
assert.equal(fireDisabledSupplier.fireQuarantinedFoodStock, 300);
assert.equal(
  fireDisabledSupplier.usableFoodStock,
  splitHome.needs.food.stock,
);

const splitFuelState = emptyGameState();
const splitFuelHome = residence('split-fuel-home', 2, 4);
splitFuelHome.x = 0;
splitFuelHome.needs.food.stock = 4 * RESIDENCE_FOOD_PER_PERSON_PER_SEC * 70;
splitFuelHome.needs.firewood.stock = 4 * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC * 50;
splitFuelHome.needs.water.stock = 4 * RESIDENCE_WATER_PER_PERSON_PER_SEC * 70;
splitFuelState.residences.set(splitFuelHome.id, splitFuelHome);
const localGranary = building('local-granary', 'granary', 2, 0);
localGranary.x = 0;
localGranary.food = 300;
splitFuelState.buildings.set(localGranary.id, localGranary);
const remoteLodge = building('remote-lodge', 'woodcutters_lodge', 2, 0);
remoteLodge.x = 100;
remoteLodge.firewood = 5_000;
splitFuelState.buildings.set(remoteLodge.id, remoteLodge);
const splitFuel = computeSettlementProvisioning({
  state: splitFuelState,
  totals: computeResourceTotals(splitFuelState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: (entity) => entity.x < 50 ? 'west' : 'east',
});
assert.equal(splitFuel.householdBufferReadyHouseholds, 1);
assert.equal(splitFuel.roadBranches?.foodSuppliedBranches, 1);
assert.equal(splitFuel.roadBranches?.firewoodSuppliedBranches, 0);
assert.equal(splitFuel.roadBranches?.firewoodUnservedBranches, 1);
assert.equal(splitFuel.roadBranches?.firewoodUnservedHouseholds, 1);
assert.ok((splitFuel.roadBranches?.worstWinterFirewoodRunwayDays ?? 99) < 1);
assert.equal(
  settlementProvisionLevel(splitFuel, 10),
  'critical',
  'a remote fuel depot must not satisfy an isolated heated neighborhood',
);

const reconnectedFuel = computeSettlementProvisioning({
  state: splitFuelState,
  totals: computeResourceTotals(splitFuelState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: () => 1,
});
assert.equal(reconnectedFuel.roadBranches?.firewoodSuppliedBranches, 1);
assert.equal(reconnectedFuel.roadBranches?.firewoodUnservedBranches, 0);
assert.ok((reconnectedFuel.roadBranches?.worstWinterFirewoodRunwayDays ?? 0) > 30);

const empty = computeSettlementProvisioning({
  state: emptyGameState(),
  totals: computeResourceTotals(emptyGameState()),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
});
assert.equal(settlementProvisionLevel(empty, 10), 'none');
assert.equal(shouldShowProvisioning(empty, 10), false);
assert.equal(empty.householdBufferCoverage, 1);

const readyThreshold = householdBufferState(4);
assert.equal(readyThreshold.householdBufferCoverage, 0.8);
assert.equal(
  settlementProvisionLevel(readyThreshold, 7),
  'ready',
  'one short home in five should remain ledger detail rather than create HUD noise',
);
assert.equal(shouldShowProvisioning(readyThreshold, 7), false);

const warningThreshold = householdBufferState(3);
assert.equal(warningThreshold.householdBufferCoverage, 0.6);
assert.equal(settlementProvisionLevel(warningThreshold, 7), 'watch');
assert.equal(shouldShowProvisioning(warningThreshold, 7), true);

const criticalThreshold = householdBufferState(2);
assert.equal(criticalThreshold.householdBufferCoverage, 0.4);
assert.equal(settlementProvisionLevel(criticalThreshold, 7), 'critical');
assert.equal(shouldShowProvisioning(criticalThreshold, 7), true);

const tierThreeShortState = emptyGameState();
tierThreeShortState.stockpile.food = 500;
tierThreeShortState.residences.set('tier-3-short', residence('tier-3-short', 3, 5));
const tierThreeShort = computeSettlementProvisioning({
  state: tierThreeShortState,
  totals: computeResourceTotals(tierThreeShortState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
});
assert.equal(tierThreeShort.householdBufferFoodShortHomes, 1);
assert.equal(tierThreeShort.householdBufferFirewoodShortHomes, 1);
assert.equal(tierThreeShort.householdBufferWaterShortHomes, 1);
assert.equal(tierThreeShort.householdBufferPreservedFoodShortHomes, 1);
assert.equal(tierThreeShort.householdBufferAleShortHomes, 1);
assert.equal(tierThreeShort.householdBufferClothShortHomes, 1);
assert.equal(tierThreeShort.householdBufferPotteryShortHomes, 1);

const seasonalRationState = emptyGameState();
const seasonalRationHome = residence('seasonal-ration-home', 3, 5);
seasonalRationHome.needs.preservedFood.stock = 5
  * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
  * 70;
seasonalRationState.residences.set(
  seasonalRationHome.id,
  seasonalRationHome,
);
const ordinaryRationBuffer = computeSettlementProvisioning({
  state: seasonalRationState,
  totals: computeResourceTotals(seasonalRationState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  currentPreservedFoodDemandMultiplier: 1,
  sabbathObserved: false,
});
const winterRationBuffer = computeSettlementProvisioning({
  state: seasonalRationState,
  totals: computeResourceTotals(seasonalRationState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  currentPreservedFoodDemandMultiplier: 1.75,
  sabbathObserved: false,
});
assert.equal(ordinaryRationBuffer.householdBufferPreservedFoodShortHomes, 0);
assert.equal(winterRationBuffer.householdBufferPreservedFoodShortHomes, 1);
const seasonalGrossFoodPerDay = 5 * RESIDENCE_FOOD_PER_PERSON_PER_SEC * 70;
const ordinaryPreservedRotationPerDay =
  5 * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC * 70;
assert.ok(Math.abs(
  ordinaryRationBuffer.grossHouseholdFoodPerDay - seasonalGrossFoodPerDay,
) < 1e-9);
assert.ok(Math.abs(
  ordinaryRationBuffer.householdPreservedFoodRotationPerDay
    - ordinaryPreservedRotationPerDay,
) < 1e-9);
assert.ok(Math.abs(
  ordinaryRationBuffer.householdFoodPerDay
    - (seasonalGrossFoodPerDay - ordinaryPreservedRotationPerDay),
) < 1e-9);
assert.ok(Math.abs(
  winterRationBuffer.householdPreservedFoodRotationTargetPerDay
    - ordinaryPreservedRotationPerDay * 1.75,
) < 1e-9);
assert.ok(Math.abs(
  winterRationBuffer.householdPreservedFoodRotationPerDay
    - ordinaryPreservedRotationPerDay,
) < 1e-9);

const meal = allocatePreservedMeal(10, 10, 3, 0.8, true);
assert.deepEqual(meal, {
  freshUsed: 2.2,
  preservedRotationUsed: 0.8,
  preservedFallbackUsed: 0,
  unmet: 0,
});
assert.deepEqual(
  allocatePreservedMeal(0, 5, 3, 0.8, true),
  {
    freshUsed: 0,
    preservedRotationUsed: 0.8,
    preservedFallbackUsed: 2.2,
    unmet: 0,
  },
);
assert.deepEqual(
  allocatePreservedMeal(Number.NaN, Number.POSITIVE_INFINITY, -4, 1, true),
  {
    freshUsed: 0,
    preservedRotationUsed: 0,
    preservedFallbackUsed: 0,
    unmet: 0,
  },
);
assert.ok(Math.abs(
  freshFoodRunwayWithPreservedRotation({
    freshStock: 10,
    grossFoodDemandPerDay: 3,
    preservedStock: 2,
    preservedRotationPerDay: 1,
  }) - 4,
) < 1e-9);
assert.ok(
  freshFoodRunwayWithPreservedRotation({
    freshStock: 10,
    grossFoodDemandPerDay: 3,
    preservedStock: 10,
    preservedRotationPerDay: 1,
    freshFoodSpoilageFractionPerDay: 0.05,
  })
  < 5,
  'spoilage must shorten the finite cured-rotation fresh-food runway',
);

const perfState = emptyGameState();
for (let index = 0; index < 10_000; index += 1) {
  perfState.residences.set(
    `home-${index}`,
    residence(`home-${index}`, index % 3 === 0 ? 2 : 1, 4),
  );
}
const started = performance.now();
const perfProvisioning = computeSettlementProvisioning({
  state: perfState,
  totals: computeResourceTotals(perfState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: true,
});
const elapsedMs = performance.now() - started;
assert.equal(perfProvisioning.foodConsumers, 40_000);
assert.equal(perfProvisioning.householdBufferHouseholds, 10_000);
assert.equal(perfProvisioning.householdBufferReadyHouseholds, 0);
assert.equal(perfProvisioning.sabbathHouseholds, 10_000);
assert.equal(perfProvisioning.sabbathReadyHouseholds, 0);
assert.ok(elapsedMs < 250, `10,000-home provisioning forecast took ${elapsedMs.toFixed(1)} ms`);

const roadPerfState = emptyGameState();
for (let branch = 0; branch < 100; branch += 1) {
  const granary = building(`perf-granary-${branch}`, 'granary', 2, 0);
  granary.x = branch;
  granary.food = 100_000;
  roadPerfState.buildings.set(granary.id, granary);
  for (let index = 0; index < 1_000; index += 1) {
    const home = residence(`road-home-${branch}-${index}`, 1, 4);
    home.x = branch;
    roadPerfState.residences.set(home.id, home);
    if (index % 4 === 0) {
      roadPerfState.fireIncidents.set(`road-home-fire-${branch}-${index}`, {
        id: `road-home-fire-${branch}-${index}`,
        targetKind: 'residence',
        targetId: home.id,
      } as FireIncidentState);
    }
  }
}
const roadPerfTotals = computeResourceTotals(roadPerfState);
const roadStarted = performance.now();
const roadPerfProvisioning = computeSettlementProvisioning({
  state: roadPerfState,
  totals: roadPerfTotals,
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: (entity) => entity.x,
});
const roadElapsedMs = performance.now() - roadStarted;
assert.equal(roadPerfProvisioning.foodConsumers, 300_000);
assert.equal(roadPerfProvisioning.displacedHouseholds, 25_000);
assert.equal(roadPerfProvisioning.displacedResidents, 100_000);
assert.equal(roadPerfProvisioning.roadBranches?.activeBranches, 100);
assert.equal(roadPerfProvisioning.roadBranches?.foodSuppliedBranches, 100);
assert.equal(roadPerfProvisioning.roadBranches?.foodUnservedBranches, 0);
assert.ok(
  roadElapsedMs < 250,
  `100,000-home road provisioning forecast took ${roadElapsedMs.toFixed(1)} ms`,
);

const preparedState = emptyGameState();
for (const [id, tier, population] of [
  ['prepared-1', 1, 3],
  ['prepared-2', 2, 4],
  ['prepared-3', 3, 5],
] as const) {
  const home = residence(id, tier, population);
  home.needs.food.stock = population * RESIDENCE_FOOD_PER_PERSON_PER_SEC * 70;
  if (tier >= 2) {
    home.needs.firewood.stock = population * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC * 170 * 1.15;
    home.needs.water.stock = population * RESIDENCE_WATER_PER_PERSON_PER_SEC * 70;
  }
  if (tier >= 3) {
    home.needs.preservedFood.stock = population
      * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
      * 70;
    home.needs.ale.stock = population * RESIDENCE_ALE_PER_PERSON_PER_SEC * 70;
    home.needs.cloth.stock = population * RESIDENCE_CLOTH_PER_PERSON_PER_SEC * 70;
    home.needs.pottery.stock = population
      * RESIDENCE_POTTERY_PER_PERSON_PER_SEC
      * 70;
  }
  preparedState.residences.set(id, home);
}
const prepared = computeSettlementProvisioning({
  state: preparedState,
  totals: computeResourceTotals(preparedState),
  currentFirewoodDemandMultiplier: 1.15,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: true,
});
assert.equal(prepared.sabbathReadyHouseholds, 3);
assert.equal(prepared.sabbathHouseholds, 3);
assert.equal(formatSabbathReadiness(prepared), '3 / 3 homes stocked');
assert.equal(prepared.householdBufferReadyHouseholds, 3);
assert.equal(prepared.householdBufferHouseholds, 3);
assert.equal(prepared.householdBufferPotteryShortHomes, 0);
assert.equal(prepared.sabbathPotteryShortHomes, 0);
assert.equal(formatHouseholdBufferReadiness(prepared), '3 / 3 homes buffered');

console.log(
  `settlement provisioning tests passed (${elapsedMs.toFixed(1)} ms for 10,000 homes; ${roadElapsedMs.toFixed(1)} ms for 100,000 homes across 100 road branches)`,
);

function building(
  id: string,
  kind: BuildingState['kind'],
  assignedLabor: number,
  polearms: number,
): BuildingState {
  return {
    id,
    kind,
    x: 0,
    z: 0,
    workRadius: 0,
    actionCooldown: 1,
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
    polearms,
    gold: 0,
    waterCapacity: 0,
    assignedLabor,
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

function residence(id: string, tier: number, population: number): ResidenceState {
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
      cloth: { stock: 0, deficitSeconds: 0 },
      pottery: { stock: 0, deficitSeconds: 0 },
    },
    abandoned: false,
    householdWealth: 0,
  };
}

function householdBufferState(readyHomes: number) {
  const state = emptyGameState();
  state.stockpile.food = 500;
  for (let index = 0; index < 5; index += 1) {
    const home = residence(`buffer-home-${index}`, 1, 3);
    if (index < readyHomes) {
      home.needs.food.stock = 3 * RESIDENCE_FOOD_PER_PERSON_PER_SEC * 70;
    }
    state.residences.set(home.id, home);
  }
  return computeSettlementProvisioning({
    state,
    totals: computeResourceTotals(state),
    currentFirewoodDemandMultiplier: 1,
    freshFoodSpoilageFractionPerDay: 0,
    sabbathObserved: false,
  });
}

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: {
      timber: 0,
      stone: 0,
      firewood: 0,
      water: 0,
      game: 0,
      berries: 0,
      mushrooms: 0,
      fish: 0,
      food: 0,
      grain: 0,
      flour: 0,
      ale: 0,
      preservedFood: 0,
      honey: 0,
      wine: 0,
      polearms: 0,
      gold: 0,
    },
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}
