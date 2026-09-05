import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CALENDAR_SECONDS_PER_DAY,
  PRESERVED_FOOD_SPOILAGE_PER_DAY,
  PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_POTTERY_PER_PERSON_PER_SEC,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  computeSettlementProvisioning,
  formatHouseholdBufferReadiness,
  formatProvisionDays,
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
import {
  foodSpoilageMultiplier,
} from '../src/economy/foodInventory.ts';
import {
  householdFirewoodUnitsPerDay,
  householdFirewoodUnitsPerMonth,
  householdFoodUnitsPerDay,
  householdFoodUnitsPerDayForTier,
  householdFoodUnitsPerMonth,
  householdFoodUnitsPerMonthForTier,
} from '../src/economy/householdBillDemand.ts';
import { computeResourceTotals } from '../src/resources/resourceTotals.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../src/resources/types.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';

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
const clientPreservedFoodPolicy = readFileSync(
  new URL('../src/economy/preservedFoodPolicy.ts', import.meta.url),
  'utf8',
);
const authoritativeSimulation = readFileSync(
  new URL('../server/src/reducers/simulation.rs', import.meta.url),
  'utf8',
);
const householdDistribution = readFileSync(
  new URL('../server/src/simulation/household_distribution.rs', import.meta.url),
  'utf8',
);
const supplyPolicy = readFileSync(
  new URL('../server/src/supply_policy.rs', import.meta.url),
  'utf8',
);
const expandedEconomy = readFileSync(
  new URL('../server/src/simulation/expanded_economy.rs', import.meta.url),
  'utf8',
);
const marketplaceStallPolicy = readFileSync(
  new URL('../server/src/marketplace_stall_policy.rs', import.meta.url),
  'utf8',
);
const pantrySafeguardPolicy = readFileSync(
  new URL('../server/src/pantry_safeguard_policy.rs', import.meta.url),
  'utf8',
);
const deliveryCargo = readFileSync(
  new URL('../server/src/simulation/delivery_cargo.rs', import.meta.url),
  'utf8',
);
const settlementHud = readFileSync(
  new URL('../src/ui/SettlementHud.ts', import.meta.url),
  'utf8',
);
const polishedGameUi = readFileSync(
  new URL('../src/ui/polishedGameUi.css', import.meta.url),
  'utf8',
);
const resourceInspector = readFileSync(
  new URL('../src/resources/ResourceInspector.ts', import.meta.url),
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
  /pub fn household_consumption_paused[\s\S]{0,180}holiday_observance\(clock\)\.is_some\(\)/,
  'the calendar helper should pause household consumption only on named holy days',
);
assert.doesNotMatch(
  serverCalendar,
  /pub fn household_consumption_paused[\s\S]{0,180}!clock\.is_work_hours/,
  'cosmetic night must not pause household consumption',
);
assert.doesNotMatch(
  laborSchedule,
  /pub fn protected_household_rest_day/,
  'observed Sunday must not freeze household consumption or shortage clocks',
);
assert.match(
  residenceNeeds,
  /general_consumption_paused\s*=\s*[\s\S]{0,120}household_consumption_paused\(clock\)[\s\S]*?service_need_clock_active\(kind,\s*general_consumption_paused\)/,
  'residence bills and shortage clocks must use the holiday-only consumption pause',
);
assert.doesNotMatch(
  residenceNeeds,
  /owner_observes_sabbath|protected_household_rest_day|protected_rest_day/,
  'observed Sunday must continue ordinary household bills, needs, and welfare progression',
);
assert.match(clientPreservedFoodPolicy, /preserved.*rotation/i);
assert.match(clientPreservedFoodPolicy, /preserved.*fallback/i);
assert.match(clientPreservedFoodPolicy, /fresh/i);
assert.match(
  clientPreservedFoodPolicy,
  /freshFoodRunwayWithPreservedRotation/,
);
assert.match(
  residenceNeeds,
  /Tier-four savory preserves replace one matching monthly category[\s\S]{0,120}never adds a sixth calorie charge/,
  'authoritative tier-four consumption must replace a food slot with savory preserves instead of adding another meal charge',
);
assert.match(
  residenceNeeds,
  /if tier >= 4[\s\S]{0,500}first_food_for_slot\(residence, \*slot, true\)[\s\S]{0,500}preserved_slot_met = true/,
  'authoritative tier-four consumption must satisfy one matching monthly slot from preserved stock',
);
assert.match(
  residenceNeeds,
  /all_slots_met:\s*slots_consumed as usize == slots\.len\(\) && preserved_slot_met/,
  'tier-four food needs must require both the normal category slots and the preserved replacement slot',
);
assert.match(
  authoritativeSimulation,
  /residence_disabled_by_fire\(ctx, residence\.id\)[\s\S]*continue;/,
  'fire-disabled residences must be excluded from authoritative household consumption',
);
assert.doesNotMatch(
  settlementHud,
  /data-provision-alert|provisionAlert|provisionLabel|provisionDetail/,
  'the provisioning banner must not be mounted in the settlement HUD',
);
assert.match(settlementHud, /data-food-runway/);
assert.match(settlementHud, /data-fuel-stores/);
assert.match(settlementHud, /data-fuel-runway/);
assert.match(
  settlementHud,
  /return `\$\{Math\.round\(months\)\} mo`;/,
  'the compact food and fuel runway buttons must show nearest whole months',
);
assert.doesNotMatch(
  polishedGameUi,
  />\s*\.settlement-hud__supply-value\s*\{\s*display:\s*none/,
  'the parent food and fuel buttons must display their compact month readouts',
);
assert.match(
  polishedGameUi,
  /\.settlement-hud__body--resources[\s\S]{0,180}> \.settlement-hud__food-stores[\s\S]{0,120}grid-template-columns:\s*20px max-content/,
  'the parent food and fuel buttons must place the month readout beside the icon',
);
const fuelBreakdownMarkup = settlementHud.slice(
  settlementHud.indexOf('data-fuel-breakdown'),
  settlementHud.indexOf('</details>', settlementHud.indexOf('data-fuel-breakdown')),
);
assert.match(fuelBreakdownMarkup, /settlement-hud__supply-resource-name">Firewood</);
assert.match(fuelBreakdownMarkup, /settlement-hud__supply-resource-name">Charcoal</);
assert.doesNotMatch(
  fuelBreakdownMarkup,
  /data-tooltip(?:-title)?=/,
  'the labeled firewood and charcoal rows must not mount redundant tooltips',
);
assert.match(
  resourceInspector,
  /\.settlement-hud__stat--fuel, \[data-fuel-resource\]/,
  'resource total updates must keep fuel-row tooltips disabled',
);
assert.match(
  settlementHud,
  /data-tooltip="\$\{hudFoodResourceLabel\(kind\)\}"/,
  'food and produce rows must mount name-only tooltips',
);
assert.match(
  settlementHud,
  /data-tooltip="\$\{hudProvisionResourceLabel\(kind\)\}"/,
  'goods and provisions rows must mount name-only tooltips',
);
assert.match(
  settlementHud,
  /data-resource="polearms" data-tooltip="Polearms"[\s\S]{0,600}data-resource="sidearms" data-tooltip="Sidearms"/,
  'military-store rows must mount name-only tooltips',
);
assert.doesNotMatch(
  settlementHud,
  /meals \/ day|fuel \/ day|Less than 0\.1 month|amount\.toFixed\(1\)/,
  'food and fuel hover cards must not expose redundant fractional rates or amounts',
);
assert.match(
  settlementHud,
  /foodSupplyUse\.textContent = foodHasDemand[\s\S]{0,120}\? formatFoodDemandSource\(provisioning\)/,
);
assert.match(
  settlementHud,
  /fuelSupplyUse\.textContent = fuelHasDemand[\s\S]{0,120}\? formatResidenceResidents\(provisioning\.heatedResidents\)/,
);
assert.match(
  settlementHud,
  /settlement-wide usable meals after storage and spoilage/,
);
assert.match(settlementHud, /firewood \+.*charcoal\. Charcoal counts double/);
assert.match(settlementHud, /occupied residences/);
assert.match(settlementHud, /Workplaces can also draw from shared fuel stores/);
assert.doesNotMatch(settlementHud, /burgage/i);
assert.match(
  householdDistribution,
  /fn market_issue_cycle[\s\S]*tavern_issue_interval_ticks\([\s\S]*MARKETPLACE_HOUSEHOLD_ISSUE_CHECKS_PER_DAY[\s\S]*sim_tick % ticks_per_check[\s\S]*Some\(MarketIssueCycle::Daily\)/,
  'markets must check household needs several times per day while allowing the Tavern affinity to shorten only its service cadence',
);
assert.match(
  householdDistribution,
  /MarketIssueCycle::Daily[\s\S]*daily_market_issue_target_days\([\s\S]*ResidenceNeedKind::Firewood[\s\S]*ResidenceNeedKind::Food[\s\S]*ResidenceNeedKind::SavoryPreserves/,
  'daily checks must preserve daily lot targets and the Town Hall critical-food and heat safeguard',
);
assert.match(
  supplyPolicy,
  /pub fn marketplace_refill_request\([\s\S]*cart_capacity[\s\S]*available_stock/,
  'market food refills must be governed by the useful-cart request policy',
);
assert.match(
  expandedEconomy,
  /target\.kind == "marketplace" && commodity\.is_edible\(\)[\s\S]*marketplace_refill_request\(\s*target_stock,\s*routed_target\.desired_stock,\s*commodity_transfer_per_trip\(commodity\),\s*transferable/,
  'edible marketplace deliveries must use the useful-cart refill policy',
);
const stallCandidateSection = marketplaceStallPolicy.indexOf(
  'pub fn assign_marketplace_stall_candidates',
);
const stallSortStart = marketplaceStallPolicy.indexOf(
  'candidates.sort_by(|left, right| {',
  stallCandidateSection,
);
const stallSortEnd = marketplaceStallPolicy.indexOf('    });', stallSortStart);
assert.ok(stallCandidateSection >= 0 && stallSortStart >= 0 && stallSortEnd >= 0);
const stallSort = marketplaceStallPolicy.slice(stallSortStart, stallSortEnd);
const needRankSortIndex = stallSort.indexOf('stall_need_rank');
const sourceStockSortIndex = stallSort.indexOf('source_has_stock');
assert.ok(
  needRankSortIndex >= 0
    && sourceStockSortIndex >= 0
    && sourceStockSortIndex < needRankSortIndex,
  'stall allocation must prefer stocked sources before breaking ties by household-need priority',
);
assert.match(
  pantrySafeguardPolicy,
  /pub fn daily_market_issue_target_days[\s\S]*emergency_pantry_rule\(pantry_policy\)[\s\S]*rule\.trigger_days[\s\S]*rule\.target_days/,
  'emergency distribution must be automatic and governed by the Town Hall pantry policy',
);
assert.match(
  householdDistribution,
  /Allocate one household bill per pass/,
  'scarce market stock must be rationed fairly across connected homes',
);
assert.match(
  deliveryCargo,
  /CHARCOAL_HOUSEHOLD_FUEL_VALUE[\s\S]*NeedKind::Firewood[\s\S]*building\.charcoal/,
  'charcoal must be converted to household heat-equivalents by the authoritative server',
);
assert.match(
  chapelInspector,
  /Households keep consuming provisions and service shortage clocks continue/,
  'the Chapel inspector must explain that household needs continue through an observed Sabbath',
);
assert.doesNotMatch(guardhouseInspector, /Food endurance|PROVISION_WARNING_DAYS|payroll/i);
assert.match(guardhouseInspector, /Forms, equips, provisions, and drills resident military companies/);
assert.match(townHallInspector, /Household delivery buffer/);
assert.match(townHallInspector, /Road-branch provisions/);
assert.match(townHallInspector, /first road-branch provision exposure/);
assert.match(townHallInspector, /Cured ration displacement/);
assert.match(townHallInspector, /average calendar-day fresh demand after/);
assert.match(townHallInspector, /fresh\/ordinary day/);
assert.doesNotMatch(
  townHallInspector,
  /gold \/ ordinary day/,
  'the settlement ledger must not resurrect the retired abstract guard payroll',
);
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
state.stockpile.ryeBread = 72;
const expectedWinterFirewoodPerDay = 2
  * householdFirewoodUnitsPerDay(WINTER_FIREWOOD_DEMAND_MULTIPLIER);
state.stockpile.firewood = expectedWinterFirewoodPerDay * (60 / 7);
state.stockpile.gold = 7;
state.residences.set('tier-1', residence('tier-1', 1, 3));
state.residences.set('tier-2', residence('tier-2', 2, 4));
const guards = building('guards', 'guardhouse', 3, 2.9);
guards.ryeBread = 9;
state.buildings.set('guards', guards);

const provisioning = computeSettlementProvisioning({
  state,
  totals: computeResourceTotals(state),
  currentFirewoodDemandMultiplier: 1.15,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: true,
});

assert.equal(provisioning.foodConsumers, 7);
assert.equal(provisioning.heatedResidents, 7);
assert.equal(provisioning.assignedGuards, 0);
assert.equal(provisioning.armedGuards, 0);
assert.equal(provisioning.unarmedGuards, 0);
assert.equal(provisioning.guardFoodStock, 0);
assert.equal(provisioning.guardProvisionRunwayDays, Infinity);
assert.equal(provisioning.householdBufferHouseholds, 2);
assert.equal(provisioning.householdBufferReadyHouseholds, 0);
assert.equal(provisioning.householdBufferCoverage, 0);
assert.equal(provisioning.householdBufferFoodShortHomes, 2);
assert.equal(provisioning.householdBufferFirewoodShortHomes, 2);
assert.equal(provisioning.householdBufferWaterShortHomes, 2);
assert.equal(provisioning.householdBufferPreservedFoodShortHomes, 0);
assert.equal(provisioning.householdBufferAleShortHomes, 1);
assert.equal(provisioning.householdBufferClothShortHomes, 1);
assert.equal(provisioning.householdBufferPotteryShortHomes, 0);
assert.match(formatHouseholdBufferReadiness(provisioning), /0 \/ 2 homes buffered/);
const expectedHouseholdFoodPerDay = householdFoodUnitsPerDayForTier(1)
  + householdFoodUnitsPerDayForTier(2);
assert.ok(Math.abs(
  provisioning.householdFoodPerDay
  - expectedHouseholdFoodPerDay,
) < 1e-9);
assert.equal(
  provisioning.grossHouseholdFoodPerDay,
  provisioning.householdFoodPerDay,
);
assert.equal(provisioning.householdPreservedFoodRotationTargetPerDay, 0);
assert.equal(provisioning.householdPreservedFoodRotationPerDay, 0);
assert.equal(provisioning.guardFoodPerDay, 0);
assert.equal(provisioning.grossFoodDemandPerDay, provisioning.totalFoodPerDay);
assert.ok(Math.abs(
  provisioning.averageFreshFoodDemandPerCalendarDay
    - provisioning.householdFoodPerDay
) < 1e-9);
assert.equal(provisioning.averageFreshFoodDemandPerCalendarDay, provisioning.totalFoodPerDay);
assert.ok(Math.abs(
  provisioning.foodRunwayDays
  - provisioning.foodStock
    / (expectedHouseholdFoodPerDay + provisioning.guardFoodPerDay),
) < 1e-9);
assert.ok(Math.abs(
  provisioning.winterFirewoodPerDay
  - expectedWinterFirewoodPerDay,
) < 1e-9);
assert.ok(
  Math.abs(provisioning.winterFirewoodRunwayDays - 60 / 7) < 1e-9,
  `expected 8.6 winter firewood days, received ${provisioning.winterFirewoodRunwayDays}`,
);
assert.ok(Math.abs(provisioning.winterFirewoodCoverage - 2 / 21) < 1e-9);
assert.equal(provisioning.guardWagePerDay, 0);
assert.equal(provisioning.guardWageRunwayDays, Infinity);
assert.equal(provisioning.roadBranches, null, 'legacy callers may omit road topology');
assert.equal(settlementProvisionLevel(provisioning, 10), 'critical');
assert.equal(shouldShowProvisioning(provisioning, 10), true);
assert.equal(formatProvisionDays(provisioning.winterFirewoodRunwayDays), '8.6d');
assert.equal(WINTER_RESERVE_DAYS, 90);
assert.equal(HOUSEHOLD_BUFFER_WARNING_COVERAGE, 0.8);
assert.equal(HOUSEHOLD_BUFFER_CRITICAL_COVERAGE, 0.5);

const charcoalHeatState = emptyGameState();
const charcoalHeatHome = residence('charcoal-heat-home', 1, 1);
charcoalHeatState.residences.set(charcoalHeatHome.id, charcoalHeatHome);
const charcoalForge = building('charcoal-forge', 'smithy', 1, 0);
charcoalForge.charcoal = 500;
charcoalHeatState.buildings.set(charcoalForge.id, charcoalForge);
const charcoalStorehouse = building('charcoal-storehouse', 'village_storehouse', 1, 0);
charcoalStorehouse.charcoal = 20;
charcoalHeatState.buildings.set(charcoalStorehouse.id, charcoalStorehouse);
const charcoalMarket = building('charcoal-market', 'marketplace', 0, 0);
charcoalMarket.charcoal = 40;
charcoalHeatState.buildings.set(charcoalMarket.id, charcoalMarket);
charcoalHeatState.deliveryTrips.set('charcoal-market-cart', {
  id: 'charcoal-market-cart',
  buildingId: charcoalStorehouse.id,
  residenceId: null,
  destinationKind: 'building',
  targetBuildingId: charcoalMarket.id,
  cargoKind: 'charcoal',
  amount: 5,
  phase: 'outbound',
} as DeliveryTripState);
const charcoalHeat = computeSettlementProvisioning({
  state: charcoalHeatState,
  totals: computeResourceTotals(charcoalHeatState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
  roadComponentFor: () => 'charcoal-heated',
});
assert.equal(
  charcoalHeat.firewoodStock,
  120,
  'staged charcoal should count at twice its raw quantity as aggregate household heat',
);
assert.equal(charcoalHeat.usableFirewoodStock, 120);
assert.equal(
  charcoalHeat.roadBranches?.physicalFirewoodStock,
  90,
  'market charcoal and an inbound charcoal cart must count at twice their raw quantity',
);

const monthlySupplyState = emptyGameState();
monthlySupplyState.stockpile.ryeBread = 100;
monthlySupplyState.stockpile.firewood = 100;
monthlySupplyState.residences.set(
  'monthly-supply-home',
  residence('monthly-supply-home', 1, 10),
);
const monthlySupply = computeSettlementProvisioning({
  state: monthlySupplyState,
  totals: computeResourceTotals(monthlySupplyState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
});
assert.ok(
  Math.abs(monthlySupply.foodRunwayWithoutSpoilageDays - 3_000) < 1e-6,
  `100 meal-equivalents should cover 100 monthly Tier-1 household bills (${monthlySupply.foodRunwayWithoutSpoilageDays})`,
);
assert.ok(
  Math.abs(monthlySupply.currentFirewoodRunwayDays - 3_000) < 1e-6,
  `100 firewood-equivalents should cover 100 monthly household bills (${monthlySupply.currentFirewoodRunwayDays})`,
);

const monthlyCharcoalState = emptyGameState();
monthlyCharcoalState.stockpile.charcoal = 50;
monthlyCharcoalState.residences.set(
  'monthly-charcoal-home',
  residence('monthly-charcoal-home', 1, 10),
);
const monthlyCharcoal = computeSettlementProvisioning({
  state: monthlyCharcoalState,
  totals: computeResourceTotals(monthlyCharcoalState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
});
assert.ok(
  Math.abs(monthlyCharcoal.currentFirewoodRunwayDays - 3_000) < 1e-6,
  `50 charcoal should cover 100 monthly household bills (${monthlyCharcoal.currentFirewoodRunwayDays})`,
);

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
assert.equal(physicalPayroll.guardPayChestGold, 0);
assert.equal(physicalPayroll.guardPayrollInTransitGold, 0);
assert.equal(physicalPayroll.guardWageRunwayDays, Infinity);

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
displacedState.stockpile.ryeBread = 50;
const healthyHome = residence('healthy-home', 1, 4);
healthyHome.needs.food.stock = 4;
healthyHome.ryeBread = healthyHome.needs.food.stock;
displacedState.residences.set(healthyHome.id, healthyHome);
const fireDisabledHome = residence('fire-disabled-home', 2, 4);
fireDisabledHome.needs.food.stock = 20;
fireDisabledHome.ryeBread = fireDisabledHome.needs.food.stock;
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
  cargoKind: 'ryeBread',
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
assert.equal(displaced.heatedResidents, 4);
assert.equal(displaced.displacedHouseholds, 1);
assert.equal(displaced.displacedResidents, 4);
assert.equal(displaced.householdBufferHouseholds, 1);
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
locallyStarvedState.stockpile.ryeBread = 500;
locallyStarvedState.stockpile.gold = 500;
const locallyStarvedGuards = building('starved-guards', 'guardhouse', 3, 3);
locallyStarvedGuards.ryeBread = 0;
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
  Infinity,
  'guardhouse support labor must not create an abstract company food demand',
);
assert.equal(
  settlementProvisionLevel(locallyStarved, 7),
  'none',
  'an empty guardhouse must not create a hidden provisioning emergency',
);

const splitBranchState = emptyGameState();
const splitHome = residence('split-home', 1, 4);
splitHome.x = 0;
splitHome.needs.food.stock = householdFoodUnitsPerMonthForTier(splitHome.tier);
splitHome.ryeBread = splitHome.needs.food.stock;
splitHome.needs.firewood.stock = householdFirewoodUnitsPerMonth();
splitHome.needs.water.stock = 4 * RESIDENCE_WATER_PER_PERSON_PER_SEC * CALENDAR_SECONDS_PER_DAY;
splitBranchState.residences.set(splitHome.id, splitHome);
const remoteGranary = building('remote-granary', 'granary', 2, 0);
remoteGranary.x = 100;
splitBranchState.buildings.set(remoteGranary.id, remoteGranary);
const remoteGoodsStorehouse = building('remote-goods-storehouse', 'village_storehouse', 1, 0);
remoteGoodsStorehouse.x = 100;
splitBranchState.buildings.set(remoteGoodsStorehouse.id, remoteGoodsStorehouse);
const remoteFoodMarket = building('remote-food-market', 'marketplace', 1, 0);
remoteFoodMarket.x = 100;
remoteFoodMarket.ryeBread = 300;
remoteFoodMarket.firewood = 2_000;
splitBranchState.buildings.set(remoteFoodMarket.id, remoteFoodMarket);
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
  'aggregate stores should demonstrate the false comfort of a remote staffed market',
);
assert.equal(splitBranches.householdBufferReadyHouseholds, 1);
assert.equal(splitBranches.roadBranches?.activeBranches, 1);
assert.equal(splitBranches.roadBranches?.foodSuppliedBranches, 0);
assert.equal(splitBranches.roadBranches?.foodUnservedBranches, 1);
assert.equal(splitBranches.roadBranches?.foodUnservedHouseholds, 1);
assert.ok((splitBranches.roadBranches?.worstFoodRunwayDays ?? 99) <= 30.01);
assert.equal(splitBranches.roadBranches?.firstExposedResidenceId, splitHome.id);
assert.equal(
  settlementProvisionLevel(splitBranches, 7),
  'ready',
  'an isolated plot must not trigger the provisioning alert',
);

splitBranchState.deliveryTrips.set('split-food-cart', {
  id: 'split-food-cart',
  buildingId: remoteFoodMarket.id,
  residenceId: splitHome.id,
  destinationKind: 'residence',
  targetBuildingId: null,
  cargoKind: 'ryeBread',
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
assert.equal(settlementProvisionLevel(splitWithArrival, 7), 'ready');

const curedBranchState = emptyGameState();
const curedBranchHome = residence('cured-branch-home', 4, 5);
curedBranchHome.x = 7;
curedBranchHome.needs.food.stock = householdFoodUnitsPerMonthForTier(
  curedBranchHome.tier,
);
curedBranchHome.ryeBread = curedBranchHome.needs.food.stock;
curedBranchState.residences.set(curedBranchHome.id, curedBranchHome);
const curedBranchSmokehouse = building(
  'cured-branch-market',
  'marketplace',
  0,
  0,
);
curedBranchSmokehouse.x = 7;
curedBranchSmokehouse.curedMeat = 14;
curedBranchState.buildings.set(
  curedBranchSmokehouse.id,
  curedBranchSmokehouse,
);
const curedBranchGranary = building('cured-branch-granary', 'granary', 1, 0);
curedBranchGranary.x = 7;
curedBranchState.buildings.set(curedBranchGranary.id, curedBranchGranary);
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
    * foodSpoilageMultiplier('curedMeat')
    * PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR,
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
const originalCuredBranchTreasuryFood = curedBranchState.stockpile.ryeBread;
curedBranchState.stockpile.ryeBread = 10_000;
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
curedBranchState.stockpile.ryeBread = originalCuredBranchTreasuryFood;
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
  (quarantinedCuredBranch.roadBranches?.worstFoodRunwayDays ?? 0) - 30,
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
  'reconnecting the same staffed food stall should restore the branch forecast',
);

splitBranchState.deliveryTrips.clear();
splitBranchState.fireIncidents.set('remote-market-fire', {
  id: 'remote-granary-fire',
  targetKind: 'building',
  targetId: remoteFoodMarket.id,
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
assert.ok(
  Math.abs(fireDisabledSupplier.usableFoodStock - splitHome.needs.food.stock) < 1e-9,
);

const splitFuelState = emptyGameState();
const splitFuelHome = residence('split-fuel-home', 2, 4);
splitFuelHome.x = 0;
splitFuelHome.needs.food.stock = householdFoodUnitsPerMonthForTier(
  splitFuelHome.tier,
);
splitFuelHome.ryeBread = splitFuelHome.needs.food.stock;
splitFuelHome.needs.firewood.stock = householdFirewoodUnitsPerMonth();
splitFuelHome.needs.water.stock = 4 * RESIDENCE_WATER_PER_PERSON_PER_SEC * CALENDAR_SECONDS_PER_DAY;
splitFuelHome.needs.cloth.stock = 4 * RESIDENCE_CLOTH_PER_PERSON_PER_SEC * CALENDAR_SECONDS_PER_DAY;
splitFuelHome.needs.ale.stock = 4 * RESIDENCE_ALE_PER_PERSON_PER_SEC * CALENDAR_SECONDS_PER_DAY;
splitFuelState.residences.set(splitFuelHome.id, splitFuelHome);
const localGranary = building('local-granary', 'granary', 2, 0);
localGranary.x = 0;
localGranary.ryeBread = 300;
splitFuelState.buildings.set(localGranary.id, localGranary);
const localFoodMarket = building('local-food-market', 'marketplace', 0, 0);
localFoodMarket.x = 0;
localFoodMarket.ryeBread = 300;
splitFuelState.buildings.set(localFoodMarket.id, localFoodMarket);
const remoteStorehouse = building('remote-storehouse', 'village_storehouse', 2, 0);
remoteStorehouse.x = 100;
splitFuelState.buildings.set(remoteStorehouse.id, remoteStorehouse);
const remoteGoodsMarket = building('remote-goods-market', 'marketplace', 0, 0);
remoteGoodsMarket.x = 100;
remoteGoodsMarket.firewood = 5_000;
splitFuelState.buildings.set(remoteGoodsMarket.id, remoteGoodsMarket);
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
assert.ok(Math.abs(
  (splitFuel.roadBranches?.worstWinterFirewoodRunwayDays ?? 0) - 15,
) < 1e-9);
assert.equal(
  settlementProvisionLevel(splitFuel, 10),
  'ready',
  'an isolated heated plot must not trigger the provisioning alert',
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

const tierFourShortState = emptyGameState();
tierFourShortState.stockpile.ryeBread = 500;
tierFourShortState.residences.set('tier-4-short', residence('tier-4-short', 4, 5));
const tierFourShort = computeSettlementProvisioning({
  state: tierFourShortState,
  totals: computeResourceTotals(tierFourShortState),
  currentFirewoodDemandMultiplier: 1,
  freshFoodSpoilageFractionPerDay: 0,
  sabbathObserved: false,
});
assert.equal(tierFourShort.householdBufferFoodShortHomes, 1);
assert.equal(tierFourShort.householdBufferFirewoodShortHomes, 1);
assert.equal(tierFourShort.householdBufferWaterShortHomes, 1);
assert.equal(tierFourShort.householdBufferPreservedFoodShortHomes, 1);
assert.equal(tierFourShort.householdBufferAleShortHomes, 1);
assert.equal(tierFourShort.householdBufferClothShortHomes, 1);
assert.equal(tierFourShort.householdBufferPotteryShortHomes, 1);

const seasonalRationState = emptyGameState();
const seasonalRationHome = residence('seasonal-ration-home', 4, 5);
seasonalRationHome.needs.savoryPreserves.stock = householdFoodUnitsPerMonth(1);
seasonalRationHome.curedMeat = seasonalRationHome.needs.savoryPreserves.stock;
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
assert.equal(winterRationBuffer.householdBufferPreservedFoodShortHomes, 0);
const seasonalGrossFoodPerDay = householdFoodUnitsPerDayForTier(4);
const ordinaryPreservedRotationPerDay = householdFoodUnitsPerDay(1);
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
    - ordinaryPreservedRotationPerDay * 1.75,
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
assert.ok(elapsedMs < 250, `10,000-home provisioning forecast took ${elapsedMs.toFixed(1)} ms`);

const roadPerfState = emptyGameState();
for (let branch = 0; branch < 100; branch += 1) {
  const granary = building(`perf-granary-${branch}`, 'granary', 2, 0);
  granary.x = branch;
  roadPerfState.buildings.set(granary.id, granary);
  const market = building(`perf-market-${branch}`, 'marketplace', 0, 0);
  market.x = branch;
  market.ryeBread = 100_000;
  roadPerfState.buildings.set(market.id, market);
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
  roadElapsedMs < 750,
  `100,000-home road provisioning forecast took ${roadElapsedMs.toFixed(1)} ms`,
);

const preparedState = emptyGameState();
for (const [id, tier, population] of [
  ['prepared-1', 1, 3],
  ['prepared-2', 2, 4],
  ['prepared-4', 4, 5],
] as const) {
  const home = residence(id, tier, population);
  home.needs.food.stock = householdFoodUnitsPerMonthForTier(tier);
  home.ryeBread = home.needs.food.stock;
  if (tier >= 1) {
    home.needs.firewood.stock = householdFirewoodUnitsPerMonth();
  }
  if (tier >= 1) {
    home.needs.water.stock = population
      * RESIDENCE_WATER_PER_PERSON_PER_SEC
      * CALENDAR_SECONDS_PER_DAY;
  }
  if (tier >= 2) {
    home.needs.cloth.stock = population
      * RESIDENCE_CLOTH_PER_PERSON_PER_SEC
      * CALENDAR_SECONDS_PER_DAY;
    home.needs.ale.stock = population
      * RESIDENCE_ALE_PER_PERSON_PER_SEC
      * CALENDAR_SECONDS_PER_DAY;
  }
  if (tier >= 4) {
    home.needs.savoryPreserves.stock = householdFoodUnitsPerMonth(1);
    home.curedMeat = home.needs.savoryPreserves.stock;
    home.needs.pottery.stock = population
      * RESIDENCE_POTTERY_PER_PERSON_PER_SEC
      * CALENDAR_SECONDS_PER_DAY;
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
assert.equal(prepared.householdBufferReadyHouseholds, 3);
assert.equal(prepared.householdBufferHouseholds, 3);
assert.equal(prepared.householdBufferPotteryShortHomes, 0);
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
    curedMeat: 0,
    smokedFish: 0,
    cheese: 0,
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
      savoryPreserves: { stock: 0, deficitSeconds: 0 },
      ale: { stock: 0, deficitSeconds: 0 },
      cloth: { stock: 0, deficitSeconds: 0 },
      pottery: { stock: 0, deficitSeconds: 0 },
    },
    food: 0,
    curedMeat: 0,
    smokedFish: 0,
    cheese: 0,
    abandoned: false,
    householdWealth: 0,
  };
}

function householdBufferState(readyHomes: number) {
  const state = emptyGameState();
  state.stockpile.ryeBread = 500;
  state.stockpile.firewood = 5_000;
  for (let index = 0; index < 5; index += 1) {
    const home = residence(`buffer-home-${index}`, 1, 3);
    if (index < readyHomes) {
      home.needs.food.stock = householdFoodUnitsPerMonthForTier(home.tier);
      home.ryeBread = home.needs.food.stock;
      home.needs.firewood.stock = householdFirewoodUnitsPerMonth();
      home.needs.water.stock = 3
        * RESIDENCE_WATER_PER_PERSON_PER_SEC
        * CALENDAR_SECONDS_PER_DAY;
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
      curedMeat: 0,
      smokedFish: 0,
      cheese: 0,
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
