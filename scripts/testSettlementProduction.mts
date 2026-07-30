import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  computeSettlementProductionCapacity,
  grainChainBalanceLabel,
  processorBottleneckBuildingId,
} from '../src/economy/settlementProduction.ts';
import { clayBankYieldAt } from '../src/economy/clayBankPolicy.ts';
import { computeSettlementGrainPlan } from '../src/economy/settlementGrainPlan.ts';
import { computeSettlementSeedProcurementPlan } from '../src/economy/settlementSeedProcurement.ts';
import { buildSettlementFarmPlan } from '../src/farming/farmWorkPlanning.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_SECONDS_PER_DAY,
  RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
  SMITHY_IRONWORK_PER_CYCLE,
  SMITHY_WATER_PER_CYCLE,
} from '../src/generated/gameBalance.ts';
import {
  createEmptyStockpile,
  type BuildingKind,
  type BuildingState,
  type FarmFieldState,
  type GameState,
  type ResourceNodeState,
  type ResidenceState,
} from '../src/resources/types.ts';
import { gameClockAtElapsedSeconds } from '../src/world/gameCalendar.ts';

const state = emptyGameState();
const mill = building('mill', 'watermill', 1);
mill.grain = 60;
mill.flour = 180;
state.buildings.set(mill.id, mill);
const bakery = building('bakery', 'granary', 1);
bakery.flour = 84;
bakery.water = 56;
bakery.firewood = 42;
bakery.food = 228;
state.buildings.set(bakery.id, bakery);
const brewery = building('brewery', 'brewery', 1);
brewery.barley = 45;
brewery.water = 40;
brewery.firewood = 15;
brewery.ale = 140;
state.buildings.set(brewery.id, brewery);
const smokehouse = building('smokehouse', 'smokehouse', 1);
smokehouse.food = 70;
smokehouse.firewood = 17.5;
smokehouse.salt = 8.75;
smokehouse.pottery = 4.375;
smokehouse.preservedFood = 127.5;
state.buildings.set(smokehouse.id, smokehouse);
const weaver = building('weaver', 'weaver', 1);
weaver.wool = 39.375;
weaver.cloth = 63.75;
state.buildings.set(weaver.id, weaver);
state.residences.set('tier-three-home', residence('tier-three-home', 10));

const fullWeek = computeSettlementProductionCapacity(state, false);
assert.equal(fullWeek.capacityDaysPerWeek, 7);
assert.deepEqual(
  [
    fullWeek.millWorkers,
    fullWeek.bakeryWorkers,
    fullWeek.breweryWorkers,
    fullWeek.smokehouseWorkers,
    fullWeek.weaverWorkers,
  ],
  [1, 1, 1, 1, 1],
);
approx(fullWeek.flourOutputPerDay, 40);
approx(fullWeek.bakeryFlourCapacityPerDay, 42);
approx(fullWeek.breadFoodCapacityPerDay, 160 / 3);
approx(fullWeek.breadGrainPerDay, 30);
approx(fullWeek.breadWaterPerDay, 80 / 3);
approx(fullWeek.breadFirewoodPerDay, 40 / 3);
approx(fullWeek.aleOutputPerDay, 20);
approx(fullWeek.aleBarleyPerDay, 15);
approx(fullWeek.aleWaterPerDay, 15);
approx(fullWeek.aleFirewoodPerDay, 5);
approx(fullWeek.preservedFoodOutputPerDay, 140 / 3);
approx(fullWeek.preservationFreshFoodPerDay, 35);
approx(fullWeek.preservationFirewoodPerDay, 35 / 3);
approx(fullWeek.preservationSaltPerDay, 35 / 6);
approx(fullWeek.preservationPotteryPerDay, 35 / 12);
approx(fullWeek.clothOutputPerDay, 17.5);
approx(fullWeek.clothWoolPerDay, 26.25);
approx(fullWeek.clothFlaxPerDay, 26.25);
approx(fullWeek.clothFlaxWaterPerDay, 8.75);
assert.equal(fullWeek.watermillThroughputMultiplier, 1);
assert.ok(fullWeek.millInputBuffer);
approx(fullWeek.millInputBuffer.days, 2);
assert.equal(fullWeek.millInputBuffer.limitingInput, 'grain');
assert.ok(fullWeek.bakeryInputBuffer);
approx(fullWeek.bakeryInputBuffer.days, 2);
assert.equal(fullWeek.bakeryInputBuffer.limitingInput, 'flour');
assert.ok(fullWeek.breweryInputBuffer);
approx(fullWeek.breweryInputBuffer.days, 8 / 3);
assert.equal(fullWeek.breweryInputBuffer.limitingInput, 'water');
assert.ok(fullWeek.smokehouseInputBuffer);
approx(fullWeek.smokehouseInputBuffer.days, 1.5);
assert.equal(fullWeek.smokehouseInputBuffer.limitingInput, 'firewood');
assert.ok(fullWeek.weaverInputBuffer);
approx(fullWeek.weaverInputBuffer.days, 1.5);
assert.equal(fullWeek.weaverInputBuffer.limitingInput, 'wool');
approx(fullWeek.millOutputRoom?.days ?? -1, 2);
approx(fullWeek.bakeryOutputRoom?.days ?? -1, 2);
approx(fullWeek.breweryOutputRoom?.days ?? -1, 3);
approx(fullWeek.smokehouseOutputRoom?.days ?? -1, 9 / 8);
approx(fullWeek.weaverOutputRoom?.days ?? -1, 1.5);

const maintainedMillState = emptyGameState();
const maintainedMill = building('maintained-mill', 'watermill', 1);
maintainedMill.grain = 180;
maintainedMill.ironwork = 0.75;
maintainedMillState.buildings.set(maintainedMill.id, maintainedMill);
const maintainedMillCapacity = computeSettlementProductionCapacity(
  maintainedMillState,
  false,
);
approx(
  maintainedMillCapacity.flourOutputPerDay,
  48,
  'smith-dressed stones and maintained iron fittings must raise installed milling output by 20%',
);
approx(
  maintainedMillCapacity.millInputBuffer?.days ?? -1,
  5,
  'faster maintained milling must consume the onsite grain buffer at the same increased rate',
);
assert.equal(maintainedMillCapacity.industrialMaterials.toolEligibleSites, 1);
assert.equal(maintainedMillCapacity.industrialMaterials.toolMaintainedSites, 1);
assert.ok(
  maintainedMillCapacity.industrialMaterials.maintainedToolIronworkPerDay > 0,
);
const strongFlowMaintainedMill = computeSettlementProductionCapacity(
  maintainedMillState,
  false,
  undefined,
  1.25,
);
approx(
  strongFlowMaintainedMill.flourOutputPerDay,
  60,
  'river power and millstone condition must multiply rather than overwrite one another',
);
approx(
  strongFlowMaintainedMill.industrialMaterials.maintainedToolIronworkPerDay,
  maintainedMillCapacity.industrialMaterials.maintainedToolIronworkPerDay * 1.25,
  'stronger flow must increase real completed batches and therefore dressing wear',
);

const materialState = emptyGameState();
const materialBuildings = [
  building('material-clay', 'clay_pit', 1),
  building('material-potter', 'potter_kiln', 1),
  building('material-smokehouse', 'smokehouse', 1),
  building('material-charcoal', 'charcoal_burner', 1),
  building('material-smithy', 'smithy', 1),
  building('material-well', 'well', 1),
  building('material-market', 'marketplace', 1),
  building('material-lumber', 'lumber_mill', 1),
  building('material-woodcutter', 'woodcutters_lodge', 1),
  building('material-farm', 'threshing_barn', 2),
];
materialBuildings[0].ironwork = 1;
for (const candidate of materialBuildings) {
  materialState.buildings.set(candidate.id, candidate);
}
materialState.farmFields.set(
  'material-field',
  farmField('material-field', 'material-farm', 'fallow'),
);
materialState.residences.set('material-home', residence('material-home', 10));
materialBuildings[3].firewood = 36;
materialBuildings[4].water = 9;

const leanClayState = emptyGameState();
const leanClayPit = building('lean-clay-bank', 'clay_pit', 1);
leanClayPit.x = 0;
leanClayPit.z = 0;
leanClayState.buildings.set(leanClayPit.id, leanClayPit);
const richClayState = emptyGameState();
const richClayPit = building('rich-clay-bank', 'clay_pit', 1);
richClayPit.x = 4.252;
richClayPit.z = -131.811;
richClayState.buildings.set(richClayPit.id, richClayPit);
const leanClayProduction = computeSettlementProductionCapacity(
  leanClayState,
  false,
  undefined,
  1,
  1,
  1,
  undefined,
  50,
);
const richClayProduction = computeSettlementProductionCapacity(
  richClayState,
  false,
  undefined,
  1,
  1,
  1,
  undefined,
  50,
);
assert.ok(
  richClayProduction.industrialMaterials.clayOutputPerDay
    > leanClayProduction.industrialMaterials.clayOutputPerDay,
  'a richer alluvial bank must sustain more clay from the same crew',
);
approx(
  leanClayProduction.industrialMaterials.clayBankYieldMultiplier,
  clayBankYieldAt(leanClayPit.x, leanClayPit.z, 50),
);
approx(
  richClayProduction.industrialMaterials.clayBankYieldMultiplier,
  clayBankYieldAt(richClayPit.x, richClayPit.z, 50),
);
assert.equal(
  leanClayProduction.industrialMaterials.firstLeanClayPitId,
  leanClayPit.id,
);
assert.equal(richClayProduction.industrialMaterials.firstLeanClayPitId, null);
const abundantRichClayProduction = computeSettlementProductionCapacity(
  richClayState,
  false,
  undefined,
  1,
  1,
  1,
  undefined,
  100,
);
const scarceRichClayProduction = computeSettlementProductionCapacity(
  richClayState,
  false,
  undefined,
  1,
  1,
  1,
  undefined,
  0,
);
assert.ok(
  abundantRichClayProduction.industrialMaterials.clayOutputPerDay
    > scarceRichClayProduction.industrialMaterials.clayOutputPerDay,
  'regional abundance must compose with, not replace, local bank quality',
);

const joinedProduction = computeSettlementProductionCapacity(
  materialState,
  false,
  () => 'joined',
);
const joinedMaterials = joinedProduction.industrialMaterials;
assert.equal(joinedMaterials.activeRoadBranches, 1);
assert.equal(joinedMaterials.potteryMatchedBranches, 1);
assert.equal(joinedMaterials.potteryBlockedBranches, 0);
assert.equal(joinedMaterials.smithyMatchedBranches, 1);
assert.equal(joinedMaterials.smithyBlockedBranches, 0);
assert.equal(joinedMaterials.potteryShortfallPerDay, 0);
assert.ok(
  joinedMaterials.potteryDemandPerDay > 0,
  'prosperous household breakage must contribute to the road-local pottery demand ledger',
);
approx(
  joinedProduction.potteryOutputPerDay,
  joinedMaterials.potteryOutputPerDay,
  'settlement prosperity must use sustainable pottery output, not installed kiln capacity',
);
assert.ok(joinedMaterials.potteryExportSurplusPerDay > 0);
assert.equal(joinedMaterials.potteryStrandedPerDay, 0);
assert.equal(joinedMaterials.toolEligibleSites, 4);
assert.equal(joinedMaterials.toolMaintainedSites, 1);
assert.ok(
  joinedMaterials.fullToolIronworkPerDay
    > joinedMaterials.maintainedToolIronworkPerDay,
);
assert.ok(joinedMaterials.ironworkOutputPerDay > 0);
approx(
  joinedMaterials.smithyWaterPerDay,
  joinedMaterials.ironworkOutputPerDay
    * SMITHY_WATER_PER_CYCLE
    / SMITHY_IRONWORK_PER_CYCLE,
  'sustainable ironwork output must expose its physical quench-water draw',
);
assert.equal(joinedMaterials.localIronOutputPerDay, 0);
approx(
  joinedMaterials.ironImportDemandPerDay,
  joinedMaterials.smithyIronPerDay,
  'a market-backed forge without a local mine must expose its full raw-iron import need',
);
approx(
  joinedMaterials.roadCoveredToolIronworkPerDay,
  joinedMaterials.maintainedToolIronworkPerDay,
  'same-branch smithing should cover the currently maintained tool racks',
);
assert.ok(joinedMaterials.ironworkSurplusAfterToolUpkeep > 0);

const localForgeState = emptyGameState();
const localIronMine = building('local-iron-mine', 'mine', 1);
const localCharcoal = building('local-charcoal', 'charcoal_burner', 1);
const localSmithy = building('local-smithy', 'smithy', 1);
const localWell = building('local-well', 'well', 1);
localCharcoal.firewood = 36;
localSmithy.water = 9;
for (const candidate of [localIronMine, localCharcoal, localSmithy, localWell]) {
  localForgeState.buildings.set(candidate.id, candidate);
}
localForgeState.quarries.set(
  'deposit-iron-ordinary-local',
  mineralDeposit(
    'deposit-iron-ordinary-local',
    'iron',
    0,
    300,
    300,
  ),
);
const localForge = computeSettlementProductionCapacity(
  localForgeState,
  false,
  () => 'local-forge',
).industrialMaterials;
assert.ok(
  localForge.localIronOutputPerDay > 0,
  'a staffed mine on a physical iron deposit must enter the material forecast',
);
assert.ok(
  localForge.ironworkOutputPerDay > 0,
  'same-branch ore, charcoal, and smithing must sustain ironwork without an import market',
);
assert.equal(localForge.smithyMatchedBranches, 1);
assert.equal(localForge.ironImportDemandPerDay, 0);
assert.ok(localForge.localIronConsumedPerDay > 0);

localForgeState.buildings.delete(localWell.id);
const waterlessLocalForge = computeSettlementProductionCapacity(
  localForgeState,
  false,
  () => 'local-forge',
).industrialMaterials;
assert.equal(
  waterlessLocalForge.ironworkOutputPerDay,
  0,
  'ore and charcoal must not create sustained forge output without a staffed same-branch well',
);
assert.ok(waterlessLocalForge.smithyBlockedBranches >= 1);
localForgeState.buildings.set(localWell.id, localWell);

const disconnectedLocalForge = computeSettlementProductionCapacity(
  localForgeState,
  false,
  (candidate) => candidate.id === localIronMine.id ? 'mine-road' : 'forge-road',
).industrialMaterials;
assert.equal(
  disconnectedLocalForge.ironworkOutputPerDay,
  0,
  'a mine on another road branch must not supply the forge in the forecast',
);
assert.ok(disconnectedLocalForge.localIronStrandedPerDay > 0);
assert.ok(disconnectedLocalForge.smithyBlockedBranches >= 1);

const materialField = materialState.farmFields.get('material-field');
assert.ok(materialField);
materialField.stage = 'growing';
const dormantFarmMaterials = computeSettlementProductionCapacity(
  materialState,
  false,
  () => 'joined',
  1,
  1,
  1,
  9,
).industrialMaterials;
assert.equal(
  dormantFarmMaterials.toolEligibleSites,
  3,
  'a growing field must not claim daily farm-tool wear outside active field work',
);
assert.ok(
  dormantFarmMaterials.fullToolIronworkPerDay
    < joinedMaterials.fullToolIronworkPerDay,
);
materialField.stage = 'harvesting';

const frostLimitedMaterials = computeSettlementProductionCapacity(
  materialState,
  false,
  () => 'joined',
  1,
  0.35,
);
assert.equal(frostLimitedMaterials.clayPitThroughputMultiplier, 0.35);
approx(
  frostLimitedMaterials.industrialMaterials.clayOutputPerDay,
  joinedMaterials.clayOutputPerDay * 0.35,
  'frost-limited clay digging must constrain the connected pottery chain forecast',
);
assert.ok(
  frostLimitedMaterials.industrialMaterials.potteryOutputPerDay
    < joinedMaterials.potteryOutputPerDay,
);
approx(
  frostLimitedMaterials.potteryOutputPerDay,
  frostLimitedMaterials.industrialMaterials.potteryOutputPerDay,
  'frost-limited clay supply must constrain the prosperity forecast too',
);
assert.ok(
  frostLimitedMaterials.industrialMaterials.maintainedToolIronworkPerDay
    < joinedMaterials.maintainedToolIronworkPerDay,
  'weather-limited clay extraction must also reduce forecast tool wear',
);

const wetClampProduction = computeSettlementProductionCapacity(
  materialState,
  false,
  () => 'joined',
  1,
  1,
  1,
  undefined,
  50,
  0.8,
);
assert.equal(wetClampProduction.charcoalBurnerThroughputMultiplier, 0.8);
approx(
  wetClampProduction.industrialMaterials.charcoalOutputPerDay,
  joinedMaterials.charcoalOutputPerDay * 0.8,
  'damp charcoal charges must reduce the connected forge-fuel forecast',
);
approx(
  wetClampProduction.industrialMaterials.charcoalFirewoodPerDay,
  joinedMaterials.charcoalFirewoodPerDay * 0.8,
  'slower clamps must consume firewood at the same authoritative cycle rate',
);
assert.ok(
  (wetClampProduction.charcoalInputBuffer?.days ?? 0)
    > (joinedProduction.charcoalInputBuffer?.days ?? 0),
  'the same staged billets must last longer when wet weather slows the clamp',
);

const droughtClampProduction = computeSettlementProductionCapacity(
  materialState,
  false,
  () => 'joined',
  1,
  1,
  1,
  undefined,
  50,
  1.1,
);
assert.equal(droughtClampProduction.charcoalBurnerThroughputMultiplier, 1.1);
approx(
  droughtClampProduction.industrialMaterials.charcoalOutputPerDay,
  joinedMaterials.charcoalOutputPerDay * 1.1,
  'dry billets must raise charcoal output while drought fire danger remains a separate cost',
);

const splitProduction = computeSettlementProductionCapacity(
  materialState,
  false,
  (candidate) => (
    candidate.id === 'material-potter'
    || candidate.id === 'material-smithy'
      ? 'remote'
      : 'core'
  ),
);
const splitMaterials = splitProduction.industrialMaterials;
assert.equal(splitMaterials.activeRoadBranches, 2);
assert.equal(splitMaterials.potteryMatchedBranches, 0);
assert.ok(splitMaterials.potteryBlockedBranches >= 1);
assert.equal(
  splitProduction.potteryOutputPerDay,
  0,
  'a remote kiln without road-local clay must not count toward settlement prosperity',
);
assert.equal(
  splitProduction.prosperityRoadBranches?.get('component:string:remote')
    ?.potteryOutputPerDay,
  0,
  'road-local prosperity must not count clay-starved installed kiln output',
);
assert.equal(
  splitMaterials.potteryCoveredDemandPerDay,
  0,
  'remote pottery capacity must not hide a preservation-branch shortage',
);
assert.ok(splitMaterials.potteryShortfallPerDay > 0);
assert.equal(
  splitMaterials.ironworkOutputPerDay,
  0,
  'a smithy without its charcoal yard and import market must report no sustainable output',
);
assert.ok(splitMaterials.smithyBlockedBranches >= 1);
assert.equal(
  splitMaterials.roadCoveredToolIronworkPerDay,
  0,
  'remote forge output must not cover tool wear on another road branch',
);
assert.ok(splitMaterials.firstPotteryBottleneckId);
assert.ok(splitMaterials.firstSmithyBottleneckId);

const industrialBuffers = computeSettlementProductionCapacity(
  materialState,
  false,
);
assert.equal(industrialBuffers.charcoalInputBuffer?.limitingInput, 'firewood');
assert.equal(industrialBuffers.smithyInputBuffer?.limitingInput, 'iron');
assert.equal(industrialBuffers.potterInputBuffer?.limitingInput, 'clay');
assert.ok((industrialBuffers.charcoalOutputRoom?.days ?? 0) > 0);
assert.ok((industrialBuffers.smithyOutputRoom?.days ?? 0) > 0);
assert.ok((industrialBuffers.potterOutputRoom?.days ?? 0) > 0);
materialBuildings[4].iron = 40;
materialBuildings[4].charcoal = 20;
materialBuildings[4].water = 1;
const waterLimitedForgeBuffer = computeSettlementProductionCapacity(
  materialState,
  false,
);
assert.equal(
  waterLimitedForgeBuffer.smithyInputBuffer?.limitingInput,
  'water',
  'the Town Hall input buffer must identify a nearly empty quench tub',
);
materialBuildings[4].iron = 0;
materialBuildings[4].charcoal = 0;
materialBuildings[4].water = 9;
materialState.fireIncidents.set('material-smithy-fire', {
  id: 'material-smithy-fire',
  targetKind: 'building',
  targetId: 'material-smithy',
} as FireIncidentState);
const fireDisabledMaterials = computeSettlementProductionCapacity(
  materialState,
  false,
  () => 'joined',
);
assert.equal(fireDisabledMaterials.fireDisabledProcessorSites, 1);
assert.equal(fireDisabledMaterials.industrialMaterials.smithyWorkers, 0);
assert.equal(fireDisabledMaterials.industrialMaterials.ironworkOutputPerDay, 0);
assert.ok(fireDisabledMaterials.industrialMaterials.smithyBlockedBranches >= 1);
materialState.fireIncidents.clear();

weaver.wool = 0;
weaver.flax = 39.375;
weaver.water = 13.125;
const flaxWeek = computeSettlementProductionCapacity(state, false);
assert.equal(flaxWeek.weaverInputBuffer?.limitingInput, 'flax');
approx(flaxWeek.weaverInputBuffer?.days ?? -1, 1.5);
weaver.water = 4;
const waterLimitedFlaxWeek = computeSettlementProductionCapacity(state, false);
assert.equal(waterLimitedFlaxWeek.weaverInputBuffer?.limitingInput, 'water');
weaver.wool = 39.375;
weaver.flax = 0;
weaver.water = 0;

const frostWeek = computeSettlementProductionCapacity(
  state,
  false,
  undefined,
  0.45,
);
assert.equal(frostWeek.watermillThroughputMultiplier, 0.45);
approx(frostWeek.flourOutputPerDay, fullWeek.flourOutputPerDay * 0.45);
approx(
  frostWeek.bakeryFlourCapacityPerDay,
  fullWeek.bakeryFlourCapacityPerDay,
  'river power must not change installed bakery capacity',
);
approx(
  frostWeek.breadFoodCapacityPerDay,
  fullWeek.breadFoodCapacityPerDay * 0.45,
);
approx(
  frostWeek.millInputBuffer?.days ?? -1,
  (fullWeek.millInputBuffer?.days ?? -1) / 0.45,
);
approx(
  frostWeek.millOutputRoom?.days ?? -1,
  (fullWeek.millOutputRoom?.days ?? -1) / 0.45,
);
assert.equal(fullWeek.millInputBuffer.buildingId, mill.id);
assert.equal(fullWeek.millOutputRoom?.buildingId, mill.id);
assert.equal(fullWeek.tierThreeResidents, 10);
assert.equal(fullWeek.fireDisabledTierThreeHomes, 0);
approx(fullWeek.aleDemandPerDay, 1.75);
approx(
  fullWeek.preservedFoodDemandPerDay,
  2.8 * RESIDENCE_PRESERVED_FOOD_WINTER_MULTIPLIER,
);
approx(fullWeek.currentPreservedFoodDemandPerDay, 2.8);
assert.equal(fullWeek.currentPreservedFoodDemandMultiplier, 1);
approx(fullWeek.clothDemandPerDay, 0.126);
assert.equal(
  fullWeek.prosperityRoadBranches,
  null,
  'legacy callers without a component resolver keep settlement-wide capacity',
);
assert.equal(fullWeek.grainRoadBranches, null);
const localProsperityCapacity = computeSettlementProductionCapacity(
  state,
  false,
  () => 'village',
);
assert.equal(localProsperityCapacity.prosperityRoadBranches?.size, 1);
assert.equal(localProsperityCapacity.grainRoadBranches?.size, 1);
const localProsperityBranch = localProsperityCapacity.prosperityRoadBranches
  ?.values().next().value;
assert.equal(localProsperityBranch?.currentResidents, 10);
assert.equal(localProsperityBranch?.fullResidents, 10);
approx(localProsperityBranch?.aleOutputPerDay ?? -1, fullWeek.aleOutputPerDay);
approx(
  localProsperityBranch?.preservedFoodOutputPerDay ?? -1,
  fullWeek.preservedFoodOutputPerDay,
);
approx(localProsperityBranch?.clothOutputPerDay ?? -1, fullWeek.clothOutputPerDay);
const summerRationCapacity = computeSettlementProductionCapacity(
  state,
  false,
  () => 'village',
  1,
  1,
  0.5,
);
approx(summerRationCapacity.currentPreservedFoodDemandPerDay, 1.4);
approx(
  summerRationCapacity.preservedFoodDemandPerDay,
  fullWeek.preservedFoodDemandPerDay,
  'long-term prosperity remains sized for winter even during light summer rotation',
);
state.fireIncidents.set('tier-three-home-fire', {
  id: 'tier-three-home-fire',
  targetKind: 'residence',
  targetId: 'tier-three-home',
} as FireIncidentState);
const fireSuspendedProsperity = computeSettlementProductionCapacity(
  state,
  false,
  () => 'village',
);
assert.equal(fireSuspendedProsperity.tierThreeResidents, 0);
assert.equal(fireSuspendedProsperity.fireDisabledTierThreeHomes, 1);
assert.equal(fireSuspendedProsperity.fireDisabledTierThreeResidents, 10);
assert.equal(fireSuspendedProsperity.fireDisabledTierThreeHousingCapacity, 10);
assert.equal(fireSuspendedProsperity.aleDemandPerDay, 0);
assert.equal(fireSuspendedProsperity.preservedFoodDemandPerDay, 0);
assert.equal(fireSuspendedProsperity.clothDemandPerDay, 0);
const fireSuspendedProsperityBranch = fireSuspendedProsperity
  .prosperityRoadBranches?.values().next().value;
assert.equal(fireSuspendedProsperityBranch?.currentResidents, 0);
assert.equal(fireSuspendedProsperityBranch?.fullResidents, 0);
state.fireIncidents.clear();
const localGrainBranch = localProsperityCapacity.grainRoadBranches
  ?.values().next().value;
approx(localGrainBranch?.breadGrainPerDay ?? -1, fullWeek.breadGrainPerDay);
assert.equal(
  grainChainBalanceLabel(fullWeek),
  'Balanced milling and baking capacity',
);
assert.match(
  grainChainBalanceLabel({
    millWorkers: 1,
    bakeryWorkers: 2,
    flourOutputPerDay: 40,
    bakeryFlourCapacityPerDay: 84,
  }),
  /Mill-limited/,
);

const sabbathWeek = computeSettlementProductionCapacity(state, true);
assert.equal(sabbathWeek.capacityDaysPerWeek, 6);
for (const key of [
  'flourOutputPerDay',
  'bakeryFlourCapacityPerDay',
  'breadFoodCapacityPerDay',
  'breadGrainPerDay',
  'breadWaterPerDay',
  'breadFirewoodPerDay',
  'aleOutputPerDay',
  'aleBarleyPerDay',
  'aleWaterPerDay',
  'aleFirewoodPerDay',
  'preservedFoodOutputPerDay',
  'preservationFreshFoodPerDay',
  'preservationFirewoodPerDay',
  'preservationSaltPerDay',
  'preservationPotteryPerDay',
  'clothOutputPerDay',
  'clothWoolPerDay',
] as const) {
  approx(sabbathWeek[key], fullWeek[key] * 6 / 7);
}
approx(
  sabbathWeek.aleDemandPerDay,
  fullWeek.aleDemandPerDay,
  'household demand continues on Sunday',
);
approx(
  sabbathWeek.preservedFoodDemandPerDay,
  fullWeek.preservedFoodDemandPerDay,
  'household demand continues on Sunday',
);
approx(
  sabbathWeek.clothDemandPerDay,
  fullWeek.clothDemandPerDay,
  'household textile demand continues on Sunday',
);
assert.ok(sabbathWeek.millInputBuffer);
assert.ok(sabbathWeek.bakeryInputBuffer);
assert.ok(sabbathWeek.breweryInputBuffer);
assert.ok(sabbathWeek.smokehouseInputBuffer);
assert.ok(sabbathWeek.weaverInputBuffer);
approx(sabbathWeek.millInputBuffer.days, 2 * 7 / 6);
approx(sabbathWeek.bakeryInputBuffer.days, 2 * 7 / 6);
approx(sabbathWeek.breweryInputBuffer.days, 8 / 3 * 7 / 6);
approx(sabbathWeek.smokehouseInputBuffer.days, 1.5 * 7 / 6);
approx(sabbathWeek.weaverInputBuffer.days, 1.5 * 7 / 6);
approx(sabbathWeek.millOutputRoom?.days ?? -1, 2 * 7 / 6);
approx(sabbathWeek.bakeryOutputRoom?.days ?? -1, 2 * 7 / 6);
approx(sabbathWeek.breweryOutputRoom?.days ?? -1, 3 * 7 / 6);
approx(sabbathWeek.smokehouseOutputRoom?.days ?? -1, 9 / 8 * 7 / 6);
approx(sabbathWeek.weaverOutputRoom?.days ?? -1, 1.5 * 7 / 6);

const inactiveState = emptyGameState();
const unfinishedMill = building('unfinished-mill', 'watermill', 3);
unfinishedMill.constructionComplete = false;
inactiveState.buildings.set(unfinishedMill.id, unfinishedMill);
inactiveState.buildings.set('unstaffed-bakery', building('unstaffed-bakery', 'granary', 0));
const abandonedHome = residence('abandoned-home', 7);
abandonedHome.abandoned = true;
inactiveState.residences.set(abandonedHome.id, abandonedHome);
const inactive = computeSettlementProductionCapacity(inactiveState, false);
assert.equal(inactive.millWorkers, 0);
assert.equal(inactive.bakeryWorkers, 0);
assert.equal(inactive.flourOutputPerDay, 0);
assert.equal(inactive.breadFoodCapacityPerDay, 0);
assert.equal(inactive.tierThreeResidents, 0);
assert.equal(inactive.millInputBuffer, null);
assert.equal(inactive.bakeryInputBuffer, null);
assert.equal(inactive.breweryInputBuffer, null);
assert.equal(inactive.smokehouseInputBuffer, null);
assert.equal(inactive.weaverInputBuffer, null);
assert.equal(inactive.millOutputRoom, null);
assert.equal(inactive.bakeryOutputRoom, null);
assert.equal(inactive.breweryOutputRoom, null);
assert.equal(inactive.smokehouseOutputRoom, null);
assert.equal(inactive.weaverOutputRoom, null);
assert.equal(grainChainBalanceLabel(inactive), 'No staffed mill or granary');

const distributedState = emptyGameState();
const stockedMill = building('stocked-mill', 'watermill', 1);
stockedMill.grain = 300;
distributedState.buildings.set(stockedMill.id, stockedMill);
const starvedMill = building('starved-mill', 'watermill', 1);
starvedMill.grain = 3;
starvedMill.flour = 256;
distributedState.buildings.set(starvedMill.id, starvedMill);
const distributed = computeSettlementProductionCapacity(distributedState, false);
assert.ok(distributed.millInputBuffer);
approx(
  distributed.millInputBuffer.days,
  0.1,
  'stock at one mill must not conceal another mill about to stop',
);
approx(
  distributed.millOutputRoom?.days ?? -1,
  0.1,
  'free output room at one mill must not conceal another mill about to fill',
);
assert.equal(distributed.millInputBuffer.buildingId, starvedMill.id);
assert.equal(distributed.millOutputRoom?.buildingId, starvedMill.id);
assert.equal(
  processorBottleneckBuildingId(
    distributed.millInputBuffer,
    distributed.millOutputRoom,
  ),
  starvedMill.id,
);
assert.equal(
  processorBottleneckBuildingId(
    {
      days: 2,
      onsiteDays: 2,
      limitingInput: 'grain',
      buildingId: 'input-site',
      inTransitAmount: 0,
      inTransitTrips: 0,
      nextDeliverySeconds: null,
      deliveryGap: false,
    },
    { days: 0.5, buildingId: 'output-site', targetPercent: 50 },
  ),
  'output-site',
  'the Inspect action should choose the constraint that arrives first',
);
assert.equal(processorBottleneckBuildingId(null, null), null);

const suppliedState = emptyGameState();
const suppliedMill = building('supplied-mill', 'watermill', 1);
suppliedMill.grain = 3;
suppliedState.buildings.set(suppliedMill.id, suppliedMill);
const timelyGrain = deliveryTrip('timely-grain', suppliedMill.id, 30, 'outbound');
timelyGrain.pathDistance = 5;
timelyGrain.speedMps = 1;
timelyGrain.unloadSeconds = 1;
suppliedState.deliveryTrips.set(timelyGrain.id, timelyGrain);
const suppliedProduction = computeSettlementProductionCapacity(suppliedState, false);
assert.ok(suppliedProduction.millInputBuffer);
approx(
  suppliedProduction.millInputBuffer.days,
  1.1,
  'a cart that unloads before onsite grain is exhausted should extend continuous runway',
);
approx(suppliedProduction.millInputBuffer.onsiteDays, 0.1);
assert.equal(suppliedProduction.millInputBuffer.inTransitAmount, 30);
assert.equal(suppliedProduction.millInputBuffer.inTransitTrips, 1);
assert.equal(suppliedProduction.millInputBuffer.nextDeliverySeconds, 6);
assert.equal(suppliedProduction.millInputBuffer.deliveryGap, false);

const lateState = emptyGameState();
const lateMill = building('late-mill', 'watermill', 1);
lateMill.grain = 3;
lateState.buildings.set(lateMill.id, lateMill);
const lateGrain = deliveryTrip('late-grain', lateMill.id, 30, 'outbound');
lateGrain.pathDistance = 100;
lateGrain.speedMps = 1;
lateGrain.unloadSeconds = 1;
lateState.deliveryTrips.set(lateGrain.id, lateGrain);
const lateProduction = computeSettlementProductionCapacity(lateState, false);
assert.ok(lateProduction.millInputBuffer);
approx(
  lateProduction.millInputBuffer.days,
  0.1,
  'a cart that arrives after depletion must not conceal the production stop',
);
assert.equal(lateProduction.millInputBuffer.deliveryGap, true);
assert.equal(lateProduction.millInputBuffer.nextDeliverySeconds, 101);

const targetedState = emptyGameState();
const targetedMill = building('targeted-mill', 'watermill', 1);
targetedMill.grain = 30;
targetedMill.flour = 45;
targetedMill.processorOutputTargetPercent = 25;
targetedState.buildings.set(targetedMill.id, targetedMill);
const targetedProduction = computeSettlementProductionCapacity(targetedState, false);
assert.ok(targetedProduction.millOutputRoom);
approx(
  targetedProduction.millOutputRoom.days,
  0.5,
  'Town Hall output runway should end at the selected 25% ceiling, not physical capacity',
);
assert.equal(targetedProduction.millOutputRoom.targetPercent, 25);

const splitChainState = emptyGameState();
const splitMill = building('split-mill', 'watermill', 1);
splitMill.x = 0;
splitChainState.buildings.set(splitMill.id, splitMill);
const splitBakery = building('split-bakery', 'granary', 1);
splitBakery.x = 100;
splitChainState.buildings.set(splitBakery.id, splitBakery);
const assumedConnectedChain = computeSettlementProductionCapacity(
  splitChainState,
  false,
);
const splitChain = computeSettlementProductionCapacity(
  splitChainState,
  false,
  (candidate) => candidate.x < 50 ? 'west' : 'east',
);
assert.ok(
  assumedConnectedChain.breadFoodCapacityPerDay > 0,
  'the legacy aggregate demonstrates why disconnected capacity was overstated',
);
assert.equal(
  splitChain.breadFoodCapacityPerDay,
  0,
  'mills and bakeries on disconnected branches cannot form a bread chain',
);
assert.equal(splitChain.grainChainRoads.activeBranches, 2);
assert.equal(splitChain.grainChainRoads.matchedBranches, 0);
assert.equal(splitChain.grainChainRoads.millOnlyBranches, 1);
assert.equal(splitChain.grainChainRoads.bakeryOnlyBranches, 1);
approx(
  splitChain.grainChainRoads.hypotheticalFoodPerDay,
  assumedConnectedChain.breadFoodCapacityPerDay,
);
approx(
  splitChain.grainChainRoads.fragmentationFoodPerDay,
  assumedConnectedChain.breadFoodCapacityPerDay,
);
assert.equal(
  splitChain.grainChainRoads.firstImbalancedBuildingId,
  splitBakery.id,
  'the larger stranded side should be directly inspectable',
);
assert.match(grainChainBalanceLabel(splitChain), /Road-limited/);

splitBakery.x = 10;
const joinedChain = computeSettlementProductionCapacity(
  splitChainState,
  false,
  () => 'joined',
);
approx(
  joinedChain.breadFoodCapacityPerDay,
  assumedConnectedChain.breadFoodCapacityPerDay,
);
assert.equal(joinedChain.grainChainRoads.activeBranches, 1);
assert.equal(joinedChain.grainChainRoads.matchedBranches, 1);
assert.equal(joinedChain.grainChainRoads.fragmentationFoodPerDay, 0);
assert.equal(joinedChain.grainChainRoads.firstImbalancedBuildingId, null);

const unroadedChain = computeSettlementProductionCapacity(
  splitChainState,
  false,
  () => null,
);
assert.equal(
  unroadedChain.breadFoodCapacityPerDay,
  0,
  'separate roadless workshops must not be treated as one shared branch',
);

const september = gameClockAtElapsedSeconds(
  6 * CALENDAR_DAYS_PER_MONTH * CALENDAR_SECONDS_PER_DAY,
);
const farmState = emptyGameState();
const shortFarm = building('short-farm', 'threshing_barn', 1);
const stockedFarm = building('stocked-farm', 'threshing_barn', 6);
stockedFarm.grain = 100;
stockedFarm.ironwork = 0.5;
farmState.buildings.set(shortFarm.id, shortFarm);
farmState.buildings.set(stockedFarm.id, stockedFarm);
farmState.farmFields.set(
  'short-field',
  farmField('short-field', shortFarm.id, 'oats'),
);
farmState.farmFields.set(
  'stocked-field',
  farmField('stocked-field', stockedFarm.id, 'fallow'),
);
const farmPlan = buildSettlementFarmPlan(farmState, september, false);
assert.equal(farmPlan.holdingCount, 2);
assert.equal(farmPlan.staffedHoldings, 2);
assert.equal(farmPlan.activeFields, 2);
assert.equal(farmPlan.pausedFields, 0);
assert.equal(farmPlan.orphanedFields, 0);
assert.ok(farmPlan.expectedHarvest > 0);
approx(farmPlan.laborCoveredHarvest, farmPlan.expectedHarvest);
approx(farmPlan.seedGrainRequired, 5.6);
assert.equal(
  farmPlan.seedGrainCovered,
  0,
  'grain at a different holding must not conceal local seed risk',
);
approx(farmPlan.seedGrainShortfall, 5.6);
assert.equal(farmPlan.seedShortHoldings, 1);
assert.equal(farmPlan.firstSeedShortBuildingId, shortFarm.id);
assert.equal(farmPlan.toolEligibleHoldings, 2);
assert.equal(farmPlan.toolMaintainedHoldings, 1);
assert.ok(farmPlan.toolIronworkRequired > 0);
assert.ok(farmPlan.toolIronworkReserveTarget >= 0.5);
assert.ok(farmPlan.toolIronworkCovered >= 0.25);
assert.ok(farmPlan.toolIronworkShortfall >= 0.25);
assert.equal(farmPlan.toolShortHoldings, 1);
assert.equal(farmPlan.firstToolShortBuildingId, shortFarm.id);
approx(farmPlan.seedGrainByHolding.get(shortFarm.id) ?? -1, 5.6);
assert.equal(farmPlan.seedGrainByHolding.get(stockedFarm.id), 0);
assert.equal(farmPlan.harvest.shortfallWorkerDays, 0);
assert.ok(farmPlan.spring.requiredWorkerDays > 0);
assert.ok(
  farmPlan.autumn.requiredWorkerDays > 0,
  'worked fallow should retain its autumn ploughing cost',
);
assert.equal(farmPlan.rotation.activeArea, 800);
assert.equal(farmPlan.rotation.nextRyeArea, 0);
assert.equal(farmPlan.rotation.nextOatsArea, 400);
assert.equal(farmPlan.rotation.nextFallowArea, 400);
approx(farmPlan.rotation.currentAverageFertility, 0.9);
assert.ok(
  farmPlan.rotation.afterCurrentAverageFertility
    < farmPlan.rotation.currentAverageFertility,
);
assert.equal(farmPlan.rotation.restoringFields, 1);
assert.equal(farmPlan.rotation.decliningFields, 1);
approx(farmPlan.rotation.plannedSeedGrainRequired, 5.6);
assert.ok(farmPlan.rotation.plannedHarvest > 0);
assert.equal(farmPlan.rotation.weakestFieldId, 'short-field');

const grainState = emptyGameState();
grainState.stockpile.grain = 10;
const seedFarm = building('seed-farm', 'threshing_barn', 1);
seedFarm.grain = 4;
grainState.buildings.set(seedFarm.id, seedFarm);
const fodderHolding = building('fodder-holding', 'pastoral_farmstead', 1);
fodderHolding.grain = 3;
grainState.buildings.set(fodderHolding.id, fodderHolding);
const reserveGranary = building('reserve-granary', 'granary', 1);
reserveGranary.grain = 10;
grainState.buildings.set(reserveGranary.id, reserveGranary);
const grainMill = building('grain-mill', 'watermill', 1);
grainMill.grain = 5;
grainMill.constructionPriority = 3;
grainState.buildings.set(grainMill.id, grainMill);
const linkedMonastery = building('linked-monastery', 'monastery', 0);
linkedMonastery.grain = 2;
grainState.buildings.set(linkedMonastery.id, linkedMonastery);
const unlinkedMonastery = building('unlinked-monastery', 'monastery', 0);
unlinkedMonastery.grain = 1;
grainState.buildings.set(unlinkedMonastery.id, unlinkedMonastery);
const lowPriorityMill = building('low-priority-mill', 'watermill', 1);
lowPriorityMill.constructionPriority = 1;
grainState.buildings.set(lowPriorityMill.id, lowPriorityMill);
grainState.deliveryTrips.set(
  'seed-trip',
  deliveryTrip('seed-trip', seedFarm.id, 2, 'outbound'),
);
grainState.deliveryTrips.set(
  'fodder-trip',
  deliveryTrip('fodder-trip', fodderHolding.id, 4, 'unloading'),
);
grainState.deliveryTrips.set(
  'reserve-trip',
  deliveryTrip('reserve-trip', reserveGranary.id, 6, 'outbound'),
);
grainState.deliveryTrips.set(
  'processor-trip',
  deliveryTrip('processor-trip', lowPriorityMill.id, 3, 'outbound'),
);
grainState.deliveryTrips.set(
  'return-trip',
  deliveryTrip('return-trip', seedFarm.id, 1, 'inbound'),
);

const grainPlanInput = {
  state: grainState,
  farmPlan: {
    seedGrainRequired: 10,
    seedGrainCovered: 4,
    firstSeedShortBuildingId: seedFarm.id,
    laborCoveredHarvest: 100,
    expectedHarvest: 120,
  },
  livestockFodder: {
    winterGrainNeed: 20,
    winterReserveTarget: 12,
    winterReserveStock: 3,
    firstShortBuildingId: fodderHolding.id,
  },
  granaryReserve: {
    reserveTarget: 20,
    protectedStock: 10,
    firstShortGranaryId: reserveGranary.id,
  },
  production: {
    breadGrainPerDay: 2,
  },
  sabbathObserved: false,
  monasteryProductivity: (candidate: BuildingState) =>
    candidate.id === linkedMonastery.id ? 1 : 0.45,
};
const grainPlan = computeSettlementGrainPlan(grainPlanInput);
assert.equal(grainPlan.roadPlan, null);
approx(grainPlan.totalStock, 51);
const physicalGrainPlan = computeSettlementGrainPlan({
  ...grainPlanInput,
  state: {
    ...grainState,
    physicalFoundingSiteEnabled: true,
  },
});
approx(
  physicalGrainPlan.totalStock,
  41,
  'physical crop planning must ignore the compatibility ledger',
);
approx(grainPlan.inTransit, 16);
assert.deepEqual(grainPlan.seed, { target: 10, protected: 6, shortfall: 4 });
assert.deepEqual(grainPlan.winterFodder, { target: 12, protected: 7, shortfall: 5 });
assert.deepEqual(grainPlan.granaryReserve, { target: 20, protected: 16, shortfall: 4 });
approx(grainPlan.totalProtected, 29);
approx(grainPlan.discretionaryStock, 22);
approx(grainPlan.monasteryGrainPerDay, 203 / 12);
approx(grainPlan.processorGrainPerDay, 227 / 12);
approx(grainPlan.processorRunwayDays, 264 / 227);
approx(grainPlan.annualProcessorDemand, 6_810);
approx(grainPlan.annualCommitments, 6_840);
approx(grainPlan.annualBalance, -6_740);
assert.deepEqual(grainPlan.processorPriorityCounts, { 1: 1, 2: 2, 3: 1 });
assert.equal(grainPlan.firstAttentionKind, 'seed');
assert.equal(grainPlan.firstAttentionBuildingId, seedFarm.id);

const sabbathGrainPlan = computeSettlementGrainPlan({
  ...grainPlanInput,
  sabbathObserved: true,
});
approx(sabbathGrainPlan.monasteryGrainPerDay, 14.5);
approx(sabbathGrainPlan.processorGrainPerDay, 16.5);

grainState.deliveryTrips.set(
  'seed-trip',
  deliveryTrip('seed-trip', seedFarm.id, 6, 'outbound'),
);
const fodderAttention = computeSettlementGrainPlan(grainPlanInput);
assert.equal(fodderAttention.firstAttentionKind, 'winter-fodder');
assert.equal(fodderAttention.firstAttentionBuildingId, fodderHolding.id);

grainState.deliveryTrips.set(
  'fodder-trip',
  deliveryTrip('fodder-trip', fodderHolding.id, 9, 'unloading'),
);
const reserveAttention = computeSettlementGrainPlan(grainPlanInput);
assert.equal(reserveAttention.firstAttentionKind, 'granary-reserve');
assert.equal(reserveAttention.firstAttentionBuildingId, reserveGranary.id);

const roadGrainState = emptyGameState();
const roadMill = building('road-grain-mill', 'watermill', 1);
roadMill.x = 0;
roadGrainState.buildings.set(roadMill.id, roadMill);
const roadBakery = building('road-grain-bakery', 'granary', 1);
roadBakery.x = 0;
roadBakery.grain = 30;
roadBakery.granaryGrainReserve = 20;
roadGrainState.buildings.set(roadBakery.id, roadBakery);
const roadMonastery = building('road-grain-monastery', 'monastery', 0);
roadMonastery.x = 100;
roadGrainState.buildings.set(roadMonastery.id, roadMonastery);
const remoteFarm = building('road-grain-farm', 'threshing_barn', 1);
remoteFarm.x = 200;
remoteFarm.grain = 100;
roadGrainState.buildings.set(remoteFarm.id, remoteFarm);
const roadGrainComponent = (candidate: Pick<BuildingState, 'x'>) =>
  candidate.x < 50 ? 'bread' : candidate.x < 150 ? 'monastery' : 'remote';
const splitRoadProduction = computeSettlementProductionCapacity(
  roadGrainState,
  false,
  roadGrainComponent,
);
assert.equal(splitRoadProduction.grainChainRoads.activeBranches, 1);
assert.equal(splitRoadProduction.grainRoadBranches?.size, 1);
const roadGrainInput = {
  state: roadGrainState,
  farmPlan: {
    seedGrainRequired: 20,
    seedGrainCovered: 20,
    firstSeedShortBuildingId: null,
    laborCoveredHarvest: 0,
    expectedHarvest: 0,
    seedGrainByHolding: new Map([[remoteFarm.id, 20]]),
  },
  livestockFodder: {
    winterGrainNeed: 0,
    winterReserveTarget: 0,
    winterReserveStock: 0,
    firstShortBuildingId: null,
  },
  granaryReserve: {
    reserveTarget: 20,
    protectedStock: 20,
    firstShortGranaryId: null,
  },
  production: splitRoadProduction,
  sabbathObserved: false,
  monasteryProductivity: () => 1,
  roadComponentFor: roadGrainComponent,
};
const splitRoadGrainPlan = computeSettlementGrainPlan(roadGrainInput);
approx(splitRoadGrainPlan.processorRunwayDays, 2.16);
assert.equal(splitRoadGrainPlan.roadPlan?.activeBranches, 3);
assert.equal(splitRoadGrainPlan.roadPlan?.drawingBranches, 2);
assert.equal(splitRoadGrainPlan.roadPlan?.stockedDrawingBranches, 1);
assert.equal(splitRoadGrainPlan.roadPlan?.unstockedDrawingBranches, 1);
approx(
  splitRoadGrainPlan.roadPlan?.processorGrainPerDay ?? -1,
  splitRoadGrainPlan.processorGrainPerDay,
);
approx(splitRoadGrainPlan.roadPlan?.dispatchableSourceStock ?? -1, 90);
approx(splitRoadGrainPlan.roadPlan?.matchedSourceStock ?? -1, 10);
approx(splitRoadGrainPlan.roadPlan?.outsideProcessorBranchStock ?? -1, 80);
assert.equal(splitRoadGrainPlan.roadPlan?.weakestSourceRunwayDays, 0);
assert.equal(
  splitRoadGrainPlan.roadPlan?.firstExposedBuildingId,
  roadMonastery.id,
  'remote grain must not hide the unstocked monastery branch',
);

const joinedRoadProduction = computeSettlementProductionCapacity(
  roadGrainState,
  false,
  () => 'joined',
);
const joinedRoadGrainPlan = computeSettlementGrainPlan({
  ...roadGrainInput,
  production: joinedRoadProduction,
  roadComponentFor: () => 'joined',
});
assert.equal(joinedRoadGrainPlan.roadPlan?.activeBranches, 1);
assert.equal(joinedRoadGrainPlan.roadPlan?.drawingBranches, 1);
assert.equal(joinedRoadGrainPlan.roadPlan?.stockedDrawingBranches, 1);
assert.equal(joinedRoadGrainPlan.roadPlan?.unstockedDrawingBranches, 0);
approx(joinedRoadGrainPlan.roadPlan?.matchedSourceStock ?? -1, 90);
assert.equal(joinedRoadGrainPlan.roadPlan?.outsideProcessorBranchStock, 0);
approx(joinedRoadGrainPlan.roadPlan?.weakestSourceRunwayDays ?? -1, 2.16);

const abbeyRoadState = emptyGameState();
const isolatedAbbey = building('isolated-abbey', 'monastery', 0);
isolatedAbbey.x = 0;
abbeyRoadState.buildings.set(isolatedAbbey.id, isolatedAbbey);
const abbeyRemoteFarm = building('abbey-remote-farm', 'threshing_barn', 1);
abbeyRemoteFarm.x = 100;
abbeyRemoteFarm.grain = 40;
abbeyRoadState.buildings.set(abbeyRemoteFarm.id, abbeyRemoteFarm);
const abbeyComponent = (candidate: Pick<BuildingState, 'x'>) =>
  candidate.x < 50 ? 'abbey' : 'remote';
const abbeyProduction = computeSettlementProductionCapacity(
  abbeyRoadState,
  false,
  abbeyComponent,
);
const abbeyGrainPlan = computeSettlementGrainPlan({
  state: abbeyRoadState,
  farmPlan: {
    seedGrainRequired: 0,
    seedGrainCovered: 0,
    firstSeedShortBuildingId: null,
    laborCoveredHarvest: 0,
    expectedHarvest: 0,
    seedGrainByHolding: new Map(),
  },
  livestockFodder: {
    winterGrainNeed: 0,
    winterReserveTarget: 0,
    winterReserveStock: 0,
    firstShortBuildingId: null,
  },
  granaryReserve: {
    reserveTarget: 0,
    protectedStock: 0,
    firstShortGranaryId: null,
  },
  production: abbeyProduction,
  sabbathObserved: false,
  monasteryProductivity: () => 1,
  roadComponentFor: abbeyComponent,
});
assert.equal(abbeyGrainPlan.roadPlan?.activeBranches, 2);
assert.equal(abbeyGrainPlan.roadPlan?.drawingBranches, 1);
assert.equal(abbeyGrainPlan.roadPlan?.unstockedDrawingBranches, 1);
approx(
  abbeyGrainPlan.roadPlan?.processorGrainPerDay ?? -1,
  abbeyGrainPlan.monasteryGrainPerDay,
);
assert.equal(abbeyGrainPlan.roadPlan?.outsideProcessorBranchStock, 40);
assert.equal(
  abbeyGrainPlan.roadPlan?.firstExposedBuildingId,
  isolatedAbbey.id,
);

const seedProcurementState = emptyGameState();
const readySeedMarket = building('seed-market-2', 'marketplace', 1);
readySeedMarket.marketplaceSeedGrainTarget = 48;
seedProcurementState.buildings.set(readySeedMarket.id, readySeedMarket);
const filledSeedMarket = building('seed-market-10', 'marketplace', 1);
filledSeedMarket.marketplaceSeedGrainTarget = 48;
filledSeedMarket.grain = 25;
seedProcurementState.buildings.set(filledSeedMarket.id, filledSeedMarket);
const unstaffedSeedMarket = building('seed-market-1', 'marketplace', 0);
unstaffedSeedMarket.marketplaceSeedGrainTarget = 24;
seedProcurementState.buildings.set(unstaffedSeedMarket.id, unstaffedSeedMarket);
const seedProcurement = computeSettlementSeedProcurementPlan({
  state: seedProcurementState,
  seedShortfall: 60,
  availableGold: 18,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
});
assert.equal(seedProcurement.marketplaces, 3);
assert.equal(seedProcurement.targetMarkets, 3);
assert.equal(seedProcurement.dueMarkets, 2);
assert.equal(seedProcurement.readyMarkets, 1);
assert.equal(seedProcurement.currentMarketStock, 25);
assert.equal(seedProcurement.currentGranaryStock, 0);
assert.equal(seedProcurement.targetStock, 120);
assert.equal(seedProcurement.plannedImportLots, 3);
assert.equal(seedProcurement.plannedImportGrain, 72);
assert.equal(seedProcurement.inboundSeedGrain, 0);
assert.equal(seedProcurement.affordableLotsAtCurrentRate, 1);
assert.equal(seedProcurement.potentialCoverage, 60);
assert.equal(seedProcurement.uncoveredShortfall, 0);
assert.equal(seedProcurement.laborBlockedMarkets, 1);
assert.equal(seedProcurement.firstAttentionMarketId, unstaffedSeedMarket.id);
assert.equal(seedProcurement.firstAttentionKind, 'labor');
assert.equal(seedProcurement.roadPlan, null);
assert.equal(seedProcurement.physicalCashEconomy, false);
assert.equal(seedProcurement.treasuryRefillLotsAtCurrentRate, 1);

const physicalCashSeedState = emptyGameState();
physicalCashSeedState.physicalFoundingSiteEnabled = true;
const cashReadyMarket = building('cash-ready-market', 'marketplace', 1);
cashReadyMarket.marketplaceSeedGrainTarget = 24;
cashReadyMarket.marketplaceGoldReserveTarget = 32;
cashReadyMarket.gold = 18;
physicalCashSeedState.buildings.set(cashReadyMarket.id, cashReadyMarket);
const cashInboundMarket = building('cash-inbound-market', 'marketplace', 1);
cashInboundMarket.marketplaceSeedGrainTarget = 24;
cashInboundMarket.marketplaceGoldReserveTarget = 32;
cashInboundMarket.gold = 4;
physicalCashSeedState.buildings.set(cashInboundMarket.id, cashInboundMarket);
const inboundMarketCash = deliveryTrip(
  'cash-to-market',
  cashInboundMarket.id,
  14,
  'outbound',
);
inboundMarketCash.cargoKind = 'gold';
physicalCashSeedState.deliveryTrips.set(inboundMarketCash.id, inboundMarketCash);
const returningMarketCash = deliveryTrip(
  'cash-returning',
  cashInboundMarket.id,
  99,
  'inbound',
);
returningMarketCash.cargoKind = 'gold';
physicalCashSeedState.deliveryTrips.set(returningMarketCash.id, returningMarketCash);
const cashPolicyMarket = building('cash-policy-market', 'marketplace', 1);
cashPolicyMarket.marketplaceSeedGrainTarget = 24;
cashPolicyMarket.marketplaceGoldReserveTarget = 16;
physicalCashSeedState.buildings.set(cashPolicyMarket.id, cashPolicyMarket);
const cashCartMarket = building('cash-cart-market', 'marketplace', 1);
cashCartMarket.marketplaceSeedGrainTarget = 24;
cashCartMarket.marketplaceGoldReserveTarget = 32;
physicalCashSeedState.buildings.set(cashCartMarket.id, cashCartMarket);
const physicalCashSeedProcurement = computeSettlementSeedProcurementPlan({
  state: physicalCashSeedState,
  seedShortfall: 96,
  availableGold: 18,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
});
assert.equal(physicalCashSeedProcurement.physicalCashEconomy, true);
assert.equal(physicalCashSeedProcurement.plannedImportLots, 4);
assert.equal(physicalCashSeedProcurement.dueMarkets, 4);
assert.equal(physicalCashSeedProcurement.readyMarkets, 1);
assert.equal(physicalCashSeedProcurement.cashInboundMarkets, 1);
assert.equal(physicalCashSeedProcurement.cashPolicyBlockedMarkets, 1);
assert.equal(physicalCashSeedProcurement.cashCartMarkets, 1);
assert.equal(physicalCashSeedProcurement.treasuryBlockedMarkets, 0);
assert.equal(physicalCashSeedProcurement.firstAttentionMarketId, cashPolicyMarket.id);
assert.equal(physicalCashSeedProcurement.firstAttentionKind, 'cash-policy');
assert.equal(physicalCashSeedProcurement.marketCofferGold, 22);
assert.equal(physicalCashSeedProcurement.inboundMarketGold, 14);
assert.equal(physicalCashSeedProcurement.selectedMarketReserveGold, 112);
assert.equal(physicalCashSeedProcurement.onsiteFundedLotsAtCurrentRate, 1);
assert.equal(physicalCashSeedProcurement.committedFundedLotsAtCurrentRate, 2);
assert.equal(physicalCashSeedProcurement.treasuryRefillLotsAtCurrentRate, 1);
assert.equal(physicalCashSeedProcurement.affordableLotsAtCurrentRate, 3);

const treasuryShortSeedState = emptyGameState();
treasuryShortSeedState.physicalFoundingSiteEnabled = true;
const treasuryShortSeedMarket = building(
  'treasury-short-seed-market',
  'marketplace',
  1,
);
treasuryShortSeedMarket.marketplaceSeedGrainTarget = 48;
treasuryShortSeedMarket.marketplaceGoldReserveTarget = 32;
treasuryShortSeedState.buildings.set(
  treasuryShortSeedMarket.id,
  treasuryShortSeedMarket,
);
const treasuryShortSeedProcurement = computeSettlementSeedProcurementPlan({
  state: treasuryShortSeedState,
  seedShortfall: 24,
  availableGold: 17,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
});
assert.equal(treasuryShortSeedProcurement.readyMarkets, 0);
assert.equal(treasuryShortSeedProcurement.cashCartMarkets, 0);
assert.equal(treasuryShortSeedProcurement.treasuryBlockedMarkets, 1);
assert.equal(treasuryShortSeedProcurement.firstAttentionKind, 'treasury');

const reserveCompetitionState = emptyGameState();
reserveCompetitionState.physicalFoundingSiteEnabled = true;
for (const id of ['reserve-market-1', 'reserve-market-2']) {
  const market = building(id, 'marketplace', 1);
  market.marketplaceSeedGrainTarget = 24;
  market.marketplaceGoldReserveTarget = 32;
  reserveCompetitionState.buildings.set(market.id, market);
}
const reserveCompetitionPlan = computeSettlementSeedProcurementPlan({
  state: reserveCompetitionState,
  seedShortfall: 48,
  availableGold: 36,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
});
assert.equal(reserveCompetitionPlan.cashCartMarkets, 2);
assert.equal(reserveCompetitionPlan.treasuryRefillLotsAtCurrentRate, 1);
assert.equal(reserveCompetitionPlan.affordableLotsAtCurrentRate, 1);

const frontierQueueMarket = building('frontier-seed-market', 'marketplace', 1);
frontierQueueMarket.marketplaceSeedGrainTarget = 96;
frontierQueueMarket.marketplaceIronworkTarget = 12;
frontierQueueMarket.grain = 48;
frontierQueueMarket.ironwork = 0;
const frontierQueueState = emptyGameState();
frontierQueueState.buildings.set(frontierQueueMarket.id, frontierQueueMarket);
const frontierSeedProcurement = computeSettlementSeedProcurementPlan({
  state: frontierQueueState,
  seedShortfall: 80,
  availableGold: 100,
  nextLotGoldCost: 18,
  conflictEnabled: true,
  hasRoadAccess: () => true,
});
assert.equal(frontierSeedProcurement.plannedImportLots, 2);
assert.equal(frontierSeedProcurement.ironworkQueuedMarkets, 1);
assert.equal(frontierSeedProcurement.readyMarkets, 0);
assert.equal(frontierSeedProcurement.firstAttentionKind, 'ironwork');

const fireSeedState = emptyGameState();
const fireSeedMarket = building('fire-seed-market', 'marketplace', 1);
fireSeedMarket.marketplaceSeedGrainTarget = 48;
fireSeedState.buildings.set(fireSeedMarket.id, fireSeedMarket);
fireSeedState.fireIncidents.set('seed-market-fire', {
  id: 'seed-market-fire',
  targetKind: 'building',
  targetId: fireSeedMarket.id,
} as GameState['fireIncidents'] extends Map<string, infer Incident> ? Incident : never);
const fireSeedProcurement = computeSettlementSeedProcurementPlan({
  state: fireSeedState,
  seedShortfall: 24,
  availableGold: 100,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
});
assert.equal(fireSeedProcurement.dueMarkets, 1);
assert.equal(fireSeedProcurement.readyMarkets, 0);
assert.equal(fireSeedProcurement.fireBlockedMarkets, 1);
assert.equal(fireSeedProcurement.firstAttentionMarketId, fireSeedMarket.id);
assert.equal(fireSeedProcurement.firstAttentionKind, 'fire');

const physicalSeedState = emptyGameState();
const stockedManualMarket = building('stocked-market', 'marketplace', 1);
stockedManualMarket.grain = 24;
physicalSeedState.buildings.set(stockedManualMarket.id, stockedManualMarket);
const physicalSeedProcurement = computeSettlementSeedProcurementPlan({
  state: physicalSeedState,
  seedShortfall: 40,
  availableGold: 0,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
});
assert.equal(physicalSeedProcurement.plannedImportGrain, 0);
assert.equal(physicalSeedProcurement.currentMarketStock, 24);
assert.equal(physicalSeedProcurement.currentGranaryStock, 0);
assert.equal(physicalSeedProcurement.potentialCoverage, 24);
assert.equal(physicalSeedProcurement.uncoveredShortfall, 16);
assert.equal(physicalSeedProcurement.roadPlan, null);

const seedRoadState = emptyGameState();
const eastSeedFarm = building('east-seed-farm', 'threshing_barn', 1);
eastSeedFarm.x = 0;
seedRoadState.buildings.set(eastSeedFarm.id, eastSeedFarm);
const westSeedFarm = building('west-seed-farm', 'threshing_barn', 1);
westSeedFarm.x = 100;
seedRoadState.buildings.set(westSeedFarm.id, westSeedFarm);
const eastSeedMarket = building('east-seed-market', 'marketplace', 1);
eastSeedMarket.x = 0;
eastSeedMarket.grain = 10;
eastSeedMarket.marketplaceSeedGrainTarget = 48;
seedRoadState.buildings.set(eastSeedMarket.id, eastSeedMarket);
const remoteSeedMarket = building('remote-seed-market', 'marketplace', 1);
remoteSeedMarket.x = 200;
remoteSeedMarket.grain = 100;
seedRoadState.buildings.set(remoteSeedMarket.id, remoteSeedMarket);
const eastSeedGranary = building('east-seed-granary', 'granary', 0);
eastSeedGranary.x = 0;
eastSeedGranary.grain = 10;
seedRoadState.buildings.set(eastSeedGranary.id, eastSeedGranary);
seedRoadState.deliveryTrips.set(
  'west-seed-cart',
  deliveryTrip('west-seed-cart', westSeedFarm.id, 5, 'outbound'),
);
const seedRoadRequirements = new Map([
  [eastSeedFarm.id, 20],
  [westSeedFarm.id, 20],
]);
const seedRoadComponent = (candidate: BuildingState): number =>
  candidate.x < 50 ? 1 : candidate.x < 150 ? 2 : 3;
const roadMatchedSeedProcurement = computeSettlementSeedProcurementPlan({
  state: seedRoadState,
  seedShortfall: 40,
  seedGrainByHolding: seedRoadRequirements,
  availableGold: 100,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
  roadComponentFor: seedRoadComponent,
});
assert.equal(roadMatchedSeedProcurement.seedShortfall, 35);
assert.equal(roadMatchedSeedProcurement.currentMarketStock, 110);
assert.equal(roadMatchedSeedProcurement.currentGranaryStock, 10);
assert.equal(roadMatchedSeedProcurement.plannedImportGrain, 24);
assert.equal(roadMatchedSeedProcurement.inboundSeedGrain, 5);
assert.equal(roadMatchedSeedProcurement.potentialCoverage, 20);
assert.equal(roadMatchedSeedProcurement.uncoveredShortfall, 15);
assert.equal(roadMatchedSeedProcurement.roadPlan?.activeBranches, 3);
assert.equal(roadMatchedSeedProcurement.roadPlan?.shortBranches, 2);
assert.equal(roadMatchedSeedProcurement.roadPlan?.recoverableBranches, 1);
assert.equal(roadMatchedSeedProcurement.roadPlan?.exposedBranches, 1);
assert.equal(roadMatchedSeedProcurement.roadPlan?.fragmentationCoverage, 15);
assert.equal(roadMatchedSeedProcurement.roadPlan?.unmatchedRecoveryGrain, 124);
assert.equal(roadMatchedSeedProcurement.roadPlan?.unroutableShortfall, 0);
assert.equal(
  roadMatchedSeedProcurement.roadPlan?.firstExposedBuildingId,
  westSeedFarm.id,
);

const joinedSeedProcurement = computeSettlementSeedProcurementPlan({
  state: seedRoadState,
  seedShortfall: 40,
  seedGrainByHolding: seedRoadRequirements,
  availableGold: 100,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
  roadComponentFor: () => 1,
});
assert.equal(joinedSeedProcurement.potentialCoverage, 35);
assert.equal(joinedSeedProcurement.inboundSeedGrain, 5);
assert.equal(joinedSeedProcurement.uncoveredShortfall, 0);
assert.equal(joinedSeedProcurement.roadPlan?.activeBranches, 1);
assert.equal(joinedSeedProcurement.roadPlan?.fragmentationCoverage, 0);
assert.equal(joinedSeedProcurement.roadPlan?.exposedBranches, 0);

const orphanedSeedProcurement = computeSettlementSeedProcurementPlan({
  state: seedRoadState,
  seedShortfall: 47,
  seedGrainByHolding: new Map([
    ...seedRoadRequirements,
    ['missing-seed-farm', 7],
  ]),
  availableGold: 100,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
  roadComponentFor: seedRoadComponent,
});
assert.equal(orphanedSeedProcurement.seedShortfall, 42);
assert.equal(orphanedSeedProcurement.potentialCoverage, 20);
assert.equal(orphanedSeedProcurement.uncoveredShortfall, 22);
assert.equal(orphanedSeedProcurement.roadPlan?.unroutableShortfall, 7);

const granarySeedState = emptyGameState();
const granarySeedFarm = building('granary-seed-farm', 'threshing_barn', 1);
granarySeedState.buildings.set(granarySeedFarm.id, granarySeedFarm);
const seedOnlyGranary = building('seed-only-granary', 'granary', 0);
seedOnlyGranary.grain = 12;
granarySeedState.buildings.set(seedOnlyGranary.id, seedOnlyGranary);
const granarySeedProcurement = computeSettlementSeedProcurementPlan({
  state: granarySeedState,
  seedShortfall: 20,
  seedGrainByHolding: new Map([[granarySeedFarm.id, 20]]),
  availableGold: 0,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
  roadComponentFor: () => 1,
});
assert.equal(granarySeedProcurement.marketplaces, 0);
assert.equal(granarySeedProcurement.currentGranaryStock, 12);
assert.equal(granarySeedProcurement.inboundSeedGrain, 0);
assert.equal(granarySeedProcurement.potentialCoverage, 12);
assert.equal(granarySeedProcurement.uncoveredShortfall, 8);

const cattleHolding = building('cattle-holding', 'pastoral_farmstead', 1);
cattleHolding.x = 10;
cattleHolding.z = 10;
cattleHolding.workRadius = 100;
farmState.buildings.set(cattleHolding.id, cattleHolding);
farmState.livestockHerds.set(cattleHolding.id, {
  buildingId: cattleHolding.id,
  species: 'cattle',
  headCount: 4,
  health: 0.9,
  breedingProgress: 0,
  pastureCapacity: 4,
  suppliedCapacity: 4,
  lastFoodOutput: 0,
  lastPreservedOutput: 0,
  lastWoolGold: 0,
  breedingReserve: 4,
  lastCulled: 0,
  hayStock: 0,
  lastHayOutput: 0,
  haymakingPercent: 35,
});
const cattleFarmPlan = buildSettlementFarmPlan(farmState, september, false);
assert.equal(cattleFarmPlan.cattleSupportedFields, 2);
assert.equal(
  cattleFarmPlan.rotation.afterCurrentAverageFertility,
  farmPlan.rotation.afterCurrentAverageFertility,
  'an ox team must not grant a free proximity fertility bonus',
);
assert.equal(
  cattleFarmPlan.rotation.plannedHarvest,
  farmPlan.rotation.plannedHarvest,
  'future harvest should improve only after physical manure reaches and is spread on a field',
);
assert.ok(
  cattleFarmPlan.spring.requiredWorkerDays < farmPlan.spring.requiredWorkerDays,
  'settlement spring forecasts should include ox ploughing support',
);
assert.ok(
  cattleFarmPlan.autumn.requiredWorkerDays < farmPlan.autumn.requiredWorkerDays,
  'settlement autumn forecasts should include ox ploughing support',
);

farmState.farmFields.set(
  'orphan-field',
  farmField('orphan-field', 'missing-farm', 'rye'),
);
const orphanPlan = buildSettlementFarmPlan(farmState, september, false);
assert.equal(orphanPlan.orphanedFields, 1);
assert.ok(orphanPlan.harvest.shortfallWorkerDays > 0);
assert.ok(orphanPlan.laborCoveredHarvest < orphanPlan.expectedHarvest);

const perfState = emptyGameState();
for (let index = 0; index < 100_000; index += 1) {
  const kinds = ['watermill', 'granary', 'brewery', 'smokehouse', 'weaver'] as const;
  const kind = kinds[index % kinds.length];
  perfState.buildings.set(`processor-${index}`, building(`processor-${index}`, kind, 1));
}
const started = performance.now();
const perfCapacity = computeSettlementProductionCapacity(perfState, false);
const elapsedMs = performance.now() - started;
assert.equal(perfCapacity.millWorkers, 20_000);
assert.equal(perfCapacity.bakeryWorkers, 20_000);
assert.equal(perfCapacity.breweryWorkers, 20_000);
assert.equal(perfCapacity.smokehouseWorkers, 20_000);
assert.equal(perfCapacity.weaverWorkers, 20_000);
assert.equal(perfCapacity.millInputBuffer?.days, 0);
assert.equal(perfCapacity.bakeryInputBuffer?.days, 0);
assert.equal(perfCapacity.breweryInputBuffer?.days, 0);
assert.equal(perfCapacity.smokehouseInputBuffer?.days, 0);
assert.equal(perfCapacity.weaverInputBuffer?.days, 0);
assert.ok((perfCapacity.millOutputRoom?.days ?? 0) > 0);
assert.ok((perfCapacity.bakeryOutputRoom?.days ?? 0) > 0);
assert.ok((perfCapacity.breweryOutputRoom?.days ?? 0) > 0);
assert.ok((perfCapacity.smokehouseOutputRoom?.days ?? 0) > 0);
assert.ok((perfCapacity.weaverOutputRoom?.days ?? 0) > 0);
assert.equal(perfCapacity.industrialMaterials.activeRoadBranches, 1);
assert.equal(perfCapacity.industrialMaterials.potteryBlockedBranches, 1);
assert.ok(
  elapsedMs < 200,
  `100,000-building production ledger took ${elapsedMs.toFixed(1)} ms`,
);
const branchedStarted = performance.now();
const branchedPerfCapacity = computeSettlementProductionCapacity(
  perfState,
  false,
  (candidate) => Math.floor(
    Number(candidate.id.slice('processor-'.length)) / 500,
  ),
);
const branchedElapsedMs = performance.now() - branchedStarted;
assert.equal(branchedPerfCapacity.grainChainRoads.activeBranches, 200);
assert.equal(branchedPerfCapacity.grainChainRoads.fragmentationFoodPerDay, 0);
assert.equal(branchedPerfCapacity.prosperityRoadBranches?.size, 200);
assert.equal(branchedPerfCapacity.grainRoadBranches?.size, 200);
assert.equal(branchedPerfCapacity.industrialMaterials.activeRoadBranches, 200);
assert.equal(branchedPerfCapacity.industrialMaterials.potteryBlockedBranches, 200);
assert.ok(
  Math.abs(
    branchedPerfCapacity.breadFoodCapacityPerDay
      - perfCapacity.breadFoodCapacityPerDay,
  ) < 1e-6,
  'locally balanced branches should retain the same real throughput',
);
assert.ok(
  branchedElapsedMs < 250,
  `100,000-building road-branch ledger took ${branchedElapsedMs.toFixed(1)} ms`,
);

const minePerfState = emptyGameState();
minePerfState.quarries.set(
  'deposit-iron-rich-performance',
  mineralDeposit(
    'deposit-iron-rich-performance',
    'iron',
    0,
    0,
    900,
    true,
  ),
);
for (let index = 0; index < 100_000; index += 1) {
  const mine = building(`mine-${index}`, 'mine', 1);
  minePerfState.buildings.set(mine.id, mine);
}
const mineLedgerStarted = performance.now();
const mineLedger = computeSettlementProductionCapacity(
  minePerfState,
  false,
).industrialMaterials;
const mineLedgerElapsedMs = performance.now() - mineLedgerStarted;
assert.ok(mineLedger.localIronOutputPerDay > 0);
assert.ok(
  mineLedgerElapsedMs < 200,
  `100,000-mine material ledger took ${mineLedgerElapsedMs.toFixed(1)} ms`,
);

for (let index = 0; index < 100_000; index += 1) {
  perfState.deliveryTrips.set(
    `grain-trip-${index}`,
    deliveryTrip(
      `grain-trip-${index}`,
      `processor-${index}`,
      1,
      index % 7 === 0 ? 'inbound' : 'outbound',
    ),
  );
}
const timedProductionStarted = performance.now();
const timedProduction = computeSettlementProductionCapacity(perfState, false);
const timedProductionElapsedMs = performance.now() - timedProductionStarted;
assert.equal(timedProduction.millInputBuffer?.days, 0);
assert.equal(timedProduction.millInputBuffer?.inTransitTrips, 0);
assert.ok(
  timedProductionElapsedMs < 350,
  `100,000-building + 100,000-cart timed production ledger took ${timedProductionElapsedMs.toFixed(1)} ms`,
);
const grainPerfStarted = performance.now();
const perfGrainPlan = computeSettlementGrainPlan({
  state: perfState,
  farmPlan: {
    seedGrainRequired: 0,
    seedGrainCovered: 0,
    firstSeedShortBuildingId: null,
    laborCoveredHarvest: 0,
    expectedHarvest: 0,
  },
  livestockFodder: {
    winterGrainNeed: 0,
    winterReserveTarget: 0,
    winterReserveStock: 0,
    firstShortBuildingId: null,
  },
  granaryReserve: {
    reserveTarget: 0,
    protectedStock: 0,
    firstShortGranaryId: null,
  },
  production: branchedPerfCapacity,
  sabbathObserved: false,
  monasteryProductivity: () => 1,
  roadComponentFor: (candidate) => Math.floor(
    Number(candidate.id.slice('processor-'.length)) / 500,
  ),
});
const grainPerfElapsedMs = performance.now() - grainPerfStarted;
assert.equal(perfGrainPlan.inTransit, 100_000);
assert.equal(perfGrainPlan.roadPlan?.drawingBranches, 200);
assert.equal(perfGrainPlan.roadPlan?.unstockedDrawingBranches, 200);
assert.deepEqual(perfGrainPlan.processorPriorityCounts, {
  1: 0,
  2: 40_000,
  3: 0,
});
assert.ok(
  grainPerfElapsedMs < 300,
  `100,000-building + 100,000-cart grain ledger took ${grainPerfElapsedMs.toFixed(1)} ms`,
);

const perfFarmState = emptyGameState();
const perfFarm = building('perf-farm', 'threshing_barn', 6);
perfFarmState.buildings.set(perfFarm.id, perfFarm);
for (let index = 0; index < 100_000; index += 1) {
  const field = farmField(`perf-field-${index}`, perfFarm.id, 'fallow');
  perfFarmState.farmFields.set(field.id, field);
}
const aggregationStarted = performance.now();
const perfFarmPlan = buildSettlementFarmPlan(perfFarmState, september, false);
const aggregationElapsedMs = performance.now() - aggregationStarted;
assert.equal(perfFarmPlan.activeFields, 100_000);
assert.equal(perfFarmPlan.rotation.activeArea, 40_000_000);
assert.equal(perfFarmPlan.rotation.nextFallowArea, 40_000_000);
assert.equal(perfFarmPlan.rotation.plannedHarvest, 0);
assert.equal(perfFarmPlan.rotation.plannedSeedGrainRequired, 0);
assert.equal(perfFarmPlan.rotation.restoringFields, 100_000);
assert.equal(perfFarmPlan.rotation.decliningFields, 0);
assert.equal(perfFarmPlan.rotation.weakestFieldId, 'perf-field-0');
assert.ok(
  aggregationElapsedMs < 250,
  `100,000-field settlement farm plan took ${aggregationElapsedMs.toFixed(1)} ms`,
);
const farmToolLedgerStarted = performance.now();
const farmToolLedger = computeSettlementProductionCapacity(
  perfFarmState,
  false,
  undefined,
  1,
  1,
  1,
  9,
).industrialMaterials;
const farmToolLedgerElapsedMs = performance.now() - farmToolLedgerStarted;
assert.equal(farmToolLedger.toolEligibleSites, 1);
assert.ok(farmToolLedger.fullToolIronworkPerDay > 0);
assert.ok(
  farmToolLedgerElapsedMs < 250,
  `100,000-field farm-tool activity scan took ${farmToolLedgerElapsedMs.toFixed(1)} ms`,
);

const procurementPerfState = emptyGameState();
for (let index = 0; index < 100_000; index += 1) {
  const market = building(`seed-market-${index}`, 'marketplace', index % 5 === 0 ? 0 : 1);
  market.marketplaceSeedGrainTarget = index % 2 === 0 ? 48 : 0;
  market.grain = index % 3 === 0 ? 24 : 0;
  procurementPerfState.buildings.set(market.id, market);
}
const procurementPerfStarted = performance.now();
const procurementPerfPlan = computeSettlementSeedProcurementPlan({
  state: procurementPerfState,
  seedShortfall: 1_000_000,
  availableGold: 10_000,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
});
const procurementPerfElapsedMs = performance.now() - procurementPerfStarted;
assert.equal(procurementPerfPlan.marketplaces, 100_000);
assert.equal(procurementPerfPlan.targetMarkets, 50_000);
assert.ok(procurementPerfPlan.plannedImportLots > 0);
assert.ok(
  procurementPerfElapsedMs < 250,
  `100,000-market standing seed ledger took ${procurementPerfElapsedMs.toFixed(1)} ms`,
);

const seedTopologyRequirements = new Map<string, number>();
for (let index = 0; index < 100_000; index += 1) {
  const candidate = procurementPerfState.buildings.get(`seed-market-${index}`);
  assert.ok(candidate);
  candidate.x = Math.floor(index / 500);
  candidate.assignedLabor = 1;
  if (index % 2 === 0) {
    candidate.grain = 24;
    candidate.marketplaceSeedGrainTarget = 48;
  } else {
    candidate.kind = 'threshing_barn';
    candidate.grain = 0;
    seedTopologyRequirements.set(candidate.id, 24);
  }
}
const seedTopologyStarted = performance.now();
const seedTopologyPlan = computeSettlementSeedProcurementPlan({
  state: procurementPerfState,
  seedShortfall: 1_200_000,
  seedGrainByHolding: seedTopologyRequirements,
  availableGold: 1_000_000,
  nextLotGoldCost: 18,
  conflictEnabled: false,
  hasRoadAccess: () => true,
  roadComponentFor: (candidate) => candidate.x,
});
const seedTopologyElapsedMs = performance.now() - seedTopologyStarted;
assert.equal(seedTopologyPlan.marketplaces, 50_000);
assert.equal(seedTopologyPlan.seedShortfall, 1_200_000);
assert.equal(seedTopologyPlan.potentialCoverage, 1_200_000);
assert.equal(seedTopologyPlan.roadPlan?.activeBranches, 200);
assert.equal(seedTopologyPlan.roadPlan?.shortBranches, 200);
assert.equal(seedTopologyPlan.roadPlan?.recoverableBranches, 200);
assert.equal(seedTopologyPlan.roadPlan?.exposedBranches, 0);
assert.ok(
  seedTopologyElapsedMs < 300,
  `100,000-building road-matched seed forecast took ${seedTopologyElapsedMs.toFixed(1)} ms`,
);

const townHallInspector = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(townHallInspector, /operational staffed capacity if supplied/);
assert.match(townHallInspector, /Processing labor/);
assert.match(townHallInspector, /First staffed site to stop/);
assert.match(townHallInspector, /carts that unload before depletion/);
assert.match(townHallInspector, /too late to prevent a stop/);
assert.match(townHallInspector, /Mill buffers/);
assert.match(townHallInspector, /Granary bakery buffers/);
assert.match(townHallInspector, /flour room/);
assert.match(townHallInspector, /preserved-food room/);
assert.match(townHallInspector, /Cloth capacity/);
assert.match(townHallInspector, /data-inspect-building=/);
assert.match(townHallInspector, /processorBottleneckBuildingId/);
assert.match(townHallInspector, /Mill \/ bakery balance/);
assert.match(townHallInspector, /Grain-chain roads/);
assert.match(townHallInspector, /unavailable until branches connect/);
assert.match(townHallInspector, /Inspect most imbalanced grain-chain branch/);
assert.match(townHallInspector, /Bread capacity/);
assert.match(townHallInspector, /bakery intake/);
assert.match(townHallInspector, /September grain/);
assert.match(townHallInspector, /September barley/);
assert.match(townHallInspector, /Seed on holdings/);
assert.match(townHallInspector, /Spring crop labor/);
assert.match(townHallInspector, /Ox-supported fields/);
assert.match(townHallInspector, /Farm-tool reserve/);
assert.match(townHallInspector, /planned wear/);
assert.match(townHallInspector, /Grain allocation/);
assert.match(townHallInspector, /Protected grain/);
assert.match(townHallInspector, /Installed grain draw/);
assert.match(townHallInspector, /two workshop cycles per batch/);
assert.match(townHallInspector, /Processor grain roads/);
assert.match(townHallInspector, /weakest source reserve/);
assert.match(townHallInspector, /workshop stocks and carts excluded/);
assert.match(townHallInspector, /Inspect weakest processor grain road branch/);
assert.match(townHallInspector, /Grain cart priorities/);
assert.match(townHallInspector, /carts serve higher tiers first/);
assert.match(townHallInspector, /Crop-year balance/);
assert.match(townHallInspector, /imports excluded/);
assert.match(townHallInspector, /Standing seed orders/);
assert.match(townHallInspector, /Seed recovery ceiling/);
assert.match(townHallInspector, /granary grain/);
assert.match(townHallInspector, /on matching road branches/);
assert.match(townHallInspector, /grain already approaching by cart/);
assert.match(townHallInspector, /apparent coverage stranded by road layout/);
assert.match(townHallInspector, /recovery grain outside current branch gaps/);
assert.match(townHallInspector, /gap at incomplete or orphaned holdings/);
assert.match(townHallInspector, /future purchases remain excluded from crop-year balance until bought/);
assert.match(townHallInspector, /later lots reprice/);
assert.match(townHallInspector, /market cash reserve below the current lot price/);
assert.match(townHallInspector, /market cash handcart inbound/);
assert.match(townHallInspector, /cash route/);
assert.match(townHallInspector, /selected market cash reserves total/);
assert.match(townHallInspector, /computeSettlementSeedProcurementPlan/);
assert.match(townHallInspector, /firstSeedShortBuildingId/);
assert.match(townHallInspector, /firstShortGranaryId/);
assert.match(townHallInspector, /Year 2 rotation/);
assert.match(townHallInspector, /Year 3 rotation/);
assert.match(townHallInspector, /Cyclic coverage/);
assert.match(townHallInspector, /Soil trajectory/);
assert.match(townHallInspector, /Year 2 potential/);
assert.match(townHallInspector, /Year 3 potential/);
assert.match(townHallInspector, /data-inspect-field=/);

const resourceInspector = readFileSync(
  new URL('../src/resources/ResourceInspector.ts', import.meta.url),
  'utf8',
);
assert.match(resourceInspector, /closest<HTMLElement>\('\[data-inspect-building\]'\)/);
assert.match(resourceInspector, /findBuildingTarget\(inspectBuildingId\)/);
assert.match(resourceInspector, /closest<HTMLElement>\('\[data-inspect-field\]'\)/);
assert.match(resourceInspector, /findFarmFieldTarget\(inspectFieldId\)/);
assert.match(resourceInspector, /onFocusWorldPosition\?\./);
assert.match(resourceInspector, /getRoadComponentId/);

const worldQueries = readFileSync(
  new URL('../src/resources/WorldQueries.ts', import.meta.url),
  'utf8',
);
assert.match(worldQueries, /findFarmFieldTarget\(fieldId: string\)/);
assert.match(worldQueries, /getRoadComponentId\(x: number, z: number\)/);
const townHallRenderer = readFileSync(
  new URL('../src/resources/inspector/townHallRenderer.ts', import.meta.url),
  'utf8',
);
assert.match(townHallRenderer, /Material-chain roads/);
assert.match(townHallRenderer, /Pottery chain/);
assert.match(townHallRenderer, /Ironwork chain/);
assert.match(townHallRenderer, /same-branch mines sustain/);
assert.match(townHallRenderer, /road-local clay-backed kiln output/);
assert.match(townHallRenderer, /Civilian tool upkeep/);

console.log(
  `settlement production tests passed (${elapsedMs.toFixed(1)} ms for 100,000 buildings; ${branchedElapsedMs.toFixed(1)} ms with 200 road branches; ${mineLedgerElapsedMs.toFixed(1)} ms for 100,000 physical mines; ${timedProductionElapsedMs.toFixed(1)} ms for 100,000 buildings + timed carts; ${grainPerfElapsedMs.toFixed(1)} ms for 100,000 buildings + grain carts; ${aggregationElapsedMs.toFixed(1)} ms for 100,000 fields; ${farmToolLedgerElapsedMs.toFixed(1)} ms farm-tool scan; ${procurementPerfElapsedMs.toFixed(1)} ms for 100,000 markets; ${seedTopologyElapsedMs.toFixed(1)} ms for road-matched seed recovery)`,
);

function approx(actual: number, expected: number, message?: string): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    message ?? `expected ${actual} to equal ${expected}`,
  );
}

function building(
  id: string,
  kind: BuildingKind,
  assignedLabor: number,
): BuildingState {
  return {
    id,
    kind,
    x: 0,
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

function residence(id: string, population: number): ResidenceState {
  return {
    id,
    zoneId: `zone-${id}`,
    parcelIndex: 0,
    x: 0,
    z: 0,
    yaw: 0,
    population,
    populationCapacity: population,
    tier: 3,
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

function mineralDeposit(
  nodeId: string,
  resource: 'iron' | 'salt',
  x: number,
  remaining: number,
  maxYield: number,
  isRich = false,
): ResourceNodeState {
  return {
    nodeId,
    kind: 'quarry',
    resource,
    remaining,
    maxYield,
    x,
    z: 0,
    isRich,
  };
}

function deliveryTrip(
  id: string,
  targetBuildingId: string,
  amount: number,
  phase: DeliveryTripState['phase'],
): DeliveryTripState {
  return {
    id,
    buildingId: 'grain-origin',
    residenceId: null,
    destinationKind: 'building',
    targetBuildingId,
    cargoKind: 'grain',
    amount,
    phase,
    x: 0,
    z: 0,
    progress: 0,
    speedMps: 1,
    unloadSeconds: 1,
    unloadRemaining: 1,
    deliveryWorkers: 1,
    freeHaulerWorkers: 0,
    pathDistance: 1,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[]',
  };
}

function farmField(
  id: string,
  farmsteadId: string,
  nextCrop: FarmFieldState['nextCrop'],
): FarmFieldState {
  return {
    id,
    farmsteadId,
    corners: [
      { x: 0, z: 0 },
      { x: 20, z: 0 },
      { x: 20, z: 20 },
      { x: 0, z: 20 },
    ],
    area: 400,
    averageSlopeDegrees: 2,
    moisture: 0.38,
    fertility: 0.9,
    crop: 'rye',
    nextCrop,
    stage: 'harvesting',
    stageProgress: 0,
    priority: 1,
    harvestCount: 0,
    lastYield: 0,
    currentYield: 0,
  };
}

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: createEmptyStockpile(),
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
