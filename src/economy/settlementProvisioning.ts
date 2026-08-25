import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_SECONDS_PER_DAY,
  CHARCOAL_HOUSEHOLD_FUEL_VALUE,
  FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
  FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
  GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
  GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
  PRESERVED_FOOD_SPOILAGE_PER_DAY,
  PRESERVED_FOOD_STORAGE_CART_FACTOR,
  PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
  PRESERVED_FOOD_STORAGE_TREASURY_FACTOR,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_POTTERY_PER_PERSON_PER_SEC,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../generated/gameBalance.ts';
import {
  compareStableEntityIds,
  isOperationalFirewoodSupplier,
  isOperationalFoodSupplier,
} from '../logistics/roadLogistics.ts';
import {
  isOperationalSpecialtySupplier,
  PRESERVED_FOOD_SUPPLIER_KINDS,
} from '../logistics/specialtyLogistics.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import type { ResourceTotals } from '../resources/resourceTotals.ts';
import type {
  BuildingState,
  GameState,
  ResidenceState,
} from '../resources/types.ts';
import {
  analyzeFreshFoodPreservation,
  buildingFreshFoodStorageFactor,
  buildingPreservedFoodStorageFactor,
  type FreshFoodPreservation,
} from './foodPreservation.ts';
import {
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
} from '../fires/fireIncident.ts';
import {
  accumulateResidenceWelfare,
  createSettlementWelfareAccumulator,
  finalizeSettlementWelfare,
  type SettlementWelfare,
} from './settlementWelfare.ts';
import {
  freshFoodRunwayWithPreservedRotation,
} from './preservedFoodPolicy.ts';
import {
  assignMarketplaceStallRoster,
  type MarketStallNeed,
  type MarketStallRoadDistance,
} from './marketStallAssignments.ts';
import {
  edibleFoodMealEquivalents,
  foodMealValue,
  foodSpoilageMultiplier,
  freshFoodMealEquivalents,
  freshFoodSpoilageExposure,
  isFreshFoodCargo,
  isPreservedFoodCargo,
  preservedFoodMealEquivalents,
  preservedFoodSpoilageExposure,
} from './foodInventory.ts';
import {
  householdFirewoodUnitsPerDay,
  householdFirewoodUnitsPerMonth,
  householdFoodUnitsPerDay,
  householdFoodUnitsPerDayForTier,
  householdFoodUnitsPerMonth,
  householdFoodUnitsPerMonthForTier,
} from './householdBillDemand.ts';
import { averageNonHolidayCalendarDayShare } from '../world/holidayCalendar.ts';

export const WINTER_RESERVE_DAYS = CALENDAR_DAYS_PER_MONTH * 3;
export const PROVISION_WARNING_DAYS = 5;
export const PROVISION_CRITICAL_DAYS = 2;
export const HOUSEHOLD_BUFFER_WARNING_COVERAGE = 0.8;
export const HOUSEHOLD_BUFFER_CRITICAL_COVERAGE = 0.5;

export type SettlementProvisioning = {
  foodConsumers: number;
  heatedResidents: number;
  displacedHouseholds: number;
  displacedResidents: number;
  assignedGuards: number;
  armedGuards: number;
  unarmedGuards: number;
  guardFoodStock: number;
  guardProvisionRunwayDays: number;
  guardPayChestGold: number;
  guardPayrollInTransitGold: number;
  householdBufferHouseholds: number;
  householdBufferReadyHouseholds: number;
  householdBufferCoverage: number;
  householdBufferFoodShortHomes: number;
  householdBufferFirewoodShortHomes: number;
  householdBufferWaterShortHomes: number;
  householdBufferPreservedFoodShortHomes: number;
  householdBufferAleShortHomes: number;
  householdBufferClothShortHomes: number;
  householdBufferPotteryShortHomes: number;
  foodStock: number;
  usableFoodStock: number;
  fireQuarantinedFoodStock: number;
  firewoodStock: number;
  householdFirewoodStock: number;
  householdCharcoalStock: number;
  usableFirewoodStock: number;
  fireQuarantinedFirewoodStock: number;
  grossHouseholdFoodPerDay: number;
  householdPreservedFoodRotationTargetPerDay: number;
  householdPreservedFoodRotationPerDay: number;
  householdFoodPerDay: number;
  guardFoodPerDay: number;
  grossFoodDemandPerDay: number;
  totalFoodPerDay: number;
  /**
   * Long-run fresh-food demand on an average calendar day. Household monthly
   * bills move off named holidays, while guard daily upkeep is waived.
   */
  averageFreshFoodDemandPerCalendarDay: number;
  usablePreservedFoodStock: number;
  fireQuarantinedPreservedFoodStock: number;
  preservedFoodSpoilagePerDay: number;
  preservedFoodSpoilageFractionPerDay: number;
  foodSpoilagePerDay: number;
  foodSpoilageFractionPerDay: number;
  protectedFoodShare: number;
  foodPreservation: FreshFoodPreservation;
  foodRunwayWithoutSpoilageDays: number;
  foodRunwayDays: number;
  currentFirewoodPerDay: number;
  currentFirewoodRunwayDays: number;
  winterFirewoodPerDay: number;
  winterFirewoodNeed: number;
  winterFirewoodRunwayDays: number;
  winterFirewoodCoverage: number;
  guardWagePerDay: number;
  guardWageRunwayDays: number;
  sabbathObserved: boolean;
  roadBranches: SettlementRoadProvisioning | null;
  welfare: SettlementWelfare;
};

export type ProvisionLevel = 'none' | 'ready' | 'watch' | 'critical';

type ProvisionRoadEntity = Pick<BuildingState | ResidenceState, 'id' | 'x' | 'z'>;

export type ProvisionRoadComponentResolver = (
  entity: ProvisionRoadEntity,
) => string | number | null;

export type SettlementRoadProvisioning = {
  activeBranches: number;
  heatedBranches: number;
  foodSuppliedBranches: number;
  firewoodSuppliedBranches: number;
  foodUnservedBranches: number;
  firewoodUnservedBranches: number;
  foodUnservedHouseholds: number;
  firewoodUnservedHouseholds: number;
  foodWarningBranches: number;
  winterFirewoodWarningBranches: number;
  physicalFoodStock: number;
  physicalPreservedFoodStock: number;
  physicalFirewoodStock: number;
  worstFoodRunwayDays: number;
  worstWinterFirewoodRunwayDays: number;
  firstExposedResidenceId: string | null;
};

type RoadProvisionBranch = {
  households: number;
  heatedHouseholds: number;
  firstResidenceId: string | null;
  foodDemandPerDay: number;
  preservedFoodRotationPerDay: number;
  winterFirewoodDemandPerDay: number;
  foodStock: number;
  weightedFoodStock: number;
  preservedFoodStock: number;
  weightedPreservedFoodStock: number;
  firewoodStock: number;
  hasFoodSupplyRoute: boolean;
  hasFirewoodSupplyRoute: boolean;
};

function roadProvisionBranchKey(
  entity: ProvisionRoadEntity,
  entityKind: 'building' | 'residence',
  componentFor: ProvisionRoadComponentResolver,
): string {
  const component = componentFor(entity);
  return component === null
    ? `unroaded:${entityKind}:${entity.id}`
    : `component:${typeof component}:${String(component)}`;
}

function roadProvisionBranch(
  branches: Map<string, RoadProvisionBranch>,
  entity: ProvisionRoadEntity,
  entityKind: 'building' | 'residence',
  componentFor: ProvisionRoadComponentResolver,
): RoadProvisionBranch {
  const key = roadProvisionBranchKey(entity, entityKind, componentFor);
  let branch = branches.get(key);
  if (branch) return branch;
  branch = {
    households: 0,
    heatedHouseholds: 0,
    firstResidenceId: null,
    foodDemandPerDay: 0,
    preservedFoodRotationPerDay: 0,
    winterFirewoodDemandPerDay: 0,
    foodStock: 0,
    weightedFoodStock: 0,
    preservedFoodStock: 0,
    weightedPreservedFoodStock: 0,
    firewoodStock: 0,
    hasFoodSupplyRoute: false,
    hasFirewoodSupplyRoute: false,
  };
  branches.set(key, branch);
  return branch;
}

function finiteStock(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function preservedFoodStockForResidence(residence: ResidenceState): number {
  return preservedFoodMealEquivalents(residence);
}

function addBranchFoodStock(
  branch: RoadProvisionBranch,
  stock: number,
  storageFactor: number,
  spoilageExposure = stock,
): void {
  const amount = finiteStock(stock);
  branch.foodStock += amount;
  branch.weightedFoodStock += Math.max(0, spoilageExposure)
    * Math.max(0, storageFactor);
}

function addBranchPreservedFoodStock(
  branch: RoadProvisionBranch,
  stock: number,
  storageFactor: number,
  spoilageExposure = stock,
): void {
  const amount = finiteStock(stock);
  branch.preservedFoodStock += amount;
  branch.weightedPreservedFoodStock += Math.max(0, spoilageExposure)
    * Math.max(0, storageFactor);
}

function finalizeRoadProvisioning(
  branches: ReadonlyMap<string, RoadProvisionBranch>,
  ambientSpoilageFractionPerDay: number,
  preservedFoodSpoilageFractionPerDay: number,
): SettlementRoadProvisioning {
  let activeBranches = 0;
  let heatedBranches = 0;
  let foodSuppliedBranches = 0;
  let firewoodSuppliedBranches = 0;
  let foodUnservedBranches = 0;
  let firewoodUnservedBranches = 0;
  let foodUnservedHouseholds = 0;
  let firewoodUnservedHouseholds = 0;
  let foodWarningBranches = 0;
  let winterFirewoodWarningBranches = 0;
  let physicalFoodStock = 0;
  let physicalPreservedFoodStock = 0;
  let physicalFirewoodStock = 0;
  let worstFoodRunwayDays = Number.POSITIVE_INFINITY;
  let worstWinterFirewoodRunwayDays = Number.POSITIVE_INFINITY;
  let firstExposedResidenceId: string | null = null;
  let firstExposureScore = Number.POSITIVE_INFINITY;
  const ambientSpoilage = Math.max(0, ambientSpoilageFractionPerDay);
  const preservedSpoilage = Math.max(
    0,
    preservedFoodSpoilageFractionPerDay,
  );

  for (const branch of branches.values()) {
    if (branch.households <= 0) continue;
    activeBranches += 1;
    physicalFoodStock += branch.foodStock;
    physicalPreservedFoodStock += branch.preservedFoodStock;
    physicalFirewoodStock += branch.firewoodStock;
    if (branch.hasFoodSupplyRoute) {
      foodSuppliedBranches += 1;
    } else {
      foodUnservedBranches += 1;
      foodUnservedHouseholds += branch.households;
    }

    const storageFactor = branch.foodStock > 1e-9
      ? branch.weightedFoodStock / branch.foodStock
      : 0;
    const preservedStorageFactor = branch.preservedFoodStock > 1e-9
      ? branch.weightedPreservedFoodStock / branch.preservedFoodStock
      : 0;
    const foodRunway = freshFoodRunwayWithPreservedRotation({
      freshStock: branch.foodStock,
      grossFoodDemandPerDay: branch.foodDemandPerDay,
      preservedStock: branch.preservedFoodStock,
      preservedRotationPerDay: branch.preservedFoodRotationPerDay,
      freshFoodSpoilageFractionPerDay: ambientSpoilage * storageFactor,
      preservedFoodSpoilageFractionPerDay:
        preservedSpoilage * preservedStorageFactor,
    });
    worstFoodRunwayDays = Math.min(worstFoodRunwayDays, foodRunway);
    const foodWarning = !branch.hasFoodSupplyRoute
      || foodRunway < PROVISION_WARNING_DAYS;
    if (foodWarning) foodWarningBranches += 1;

    let winterFirewoodRunway = Number.POSITIVE_INFINITY;
    let firewoodWarning = false;
    if (branch.heatedHouseholds > 0) {
      heatedBranches += 1;
      if (branch.hasFirewoodSupplyRoute) {
        firewoodSuppliedBranches += 1;
      } else {
        firewoodUnservedBranches += 1;
        firewoodUnservedHouseholds += branch.heatedHouseholds;
      }
      winterFirewoodRunway = runwayDays(
        branch.firewoodStock,
        branch.winterFirewoodDemandPerDay,
      );
      worstWinterFirewoodRunwayDays = Math.min(
        worstWinterFirewoodRunwayDays,
        winterFirewoodRunway,
      );
      firewoodWarning = !branch.hasFirewoodSupplyRoute
        || winterFirewoodRunway < WINTER_RESERVE_DAYS;
      if (firewoodWarning) winterFirewoodWarningBranches += 1;
    }

    if (!foodWarning && !firewoodWarning) continue;
    const foodExposure = foodWarning
      ? Math.min(
          foodRunway / PROVISION_WARNING_DAYS,
          branch.hasFoodSupplyRoute ? Number.POSITIVE_INFINITY : 1,
        )
      : Number.POSITIVE_INFINITY;
    const firewoodExposure = firewoodWarning
      ? Math.min(
          winterFirewoodRunway / WINTER_RESERVE_DAYS,
          branch.hasFirewoodSupplyRoute ? Number.POSITIVE_INFINITY : 1,
        )
      : Number.POSITIVE_INFINITY;
    const exposureScore = Math.min(foodExposure, firewoodExposure);
    const candidateId = branch.firstResidenceId;
    if (
      candidateId !== null
      && (
        exposureScore < firstExposureScore - 1e-9
        || (
          Math.abs(exposureScore - firstExposureScore) <= 1e-9
          && (
            firstExposedResidenceId === null
            || compareStableEntityIds(candidateId, firstExposedResidenceId) < 0
          )
        )
      )
    ) {
      firstExposureScore = exposureScore;
      firstExposedResidenceId = candidateId;
    }
  }

  return {
    activeBranches,
    heatedBranches,
    foodSuppliedBranches,
    firewoodSuppliedBranches,
    foodUnservedBranches,
    firewoodUnservedBranches,
    foodUnservedHouseholds,
    firewoodUnservedHouseholds,
    foodWarningBranches,
    winterFirewoodWarningBranches,
    physicalFoodStock,
    physicalPreservedFoodStock,
    physicalFirewoodStock,
    worstFoodRunwayDays,
    worstWinterFirewoodRunwayDays,
    firstExposedResidenceId,
  };
}

export function computeSettlementProvisioning(input: {
  state: GameState;
  totals: ResourceTotals;
  currentFirewoodDemandMultiplier: number;
  freshFoodSpoilageFractionPerDay: number;
  preservedFoodSpoilageFractionPerDay?: number;
  currentPreservedFoodDemandMultiplier?: number;
  sabbathObserved: boolean;
  roadComponentFor?: ProvisionRoadComponentResolver;
  roadDistance?: MarketStallRoadDistance;
}): SettlementProvisioning {
  const {
    state,
    totals,
    currentFirewoodDemandMultiplier,
    freshFoodSpoilageFractionPerDay,
    preservedFoodSpoilageFractionPerDay:
      requestedPreservedFoodSpoilageFractionPerDay,
    currentPreservedFoodDemandMultiplier = 1,
    sabbathObserved,
    roadComponentFor,
    roadDistance,
  } = input;
  const roadProvisionBranches = roadComponentFor
    ? new Map<string, RoadProvisionBranch>()
    : null;
  const fireDisabledBuildings = fireDisabledBuildingIds(state.fireIncidents.values());
  const fireDisabledResidences = fireDisabledResidenceIds(state.fireIncidents.values());
  const welfareAccumulator = createSettlementWelfareAccumulator();
  const componentsByPosition = new Map<string, string>();
  if (roadComponentFor) {
    for (const building of state.buildings.values()) {
      const component = roadComponentFor(building);
      componentsByPosition.set(
        `${building.x}:${building.z}`,
        component === null
          ? `unroaded:${building.id}`
          : `${typeof component}:${String(component)}`,
      );
    }
  }
  const rosterDistance: MarketStallRoadDistance = roadDistance
    ?? ((ax, az, bx, bz) => {
      if (
        roadComponentFor
        && componentsByPosition.get(`${ax}:${az}`)
          !== componentsByPosition.get(`${bx}:${bz}`)
      ) {
        return null;
      }
      return Math.hypot(bx - ax, bz - az);
    });
  const stallRoster = assignMarketplaceStallRoster(
    state.buildings.values(),
    rosterDistance,
    fireDisabledBuildings,
  );
  const activeStalls = new Set(
    stallRoster.stalls.map((stall) => `${stall.marketplaceId}:${stall.needKind}`),
  );
  const marketHasActiveStall = (
    market: BuildingState,
    needKind: MarketStallNeed,
  ): boolean => activeStalls.has(`${market.id}:${needKind}`);
  const marketHasBaseFoodStall = (market: BuildingState): boolean => {
    const freshStock = freshFoodMealEquivalents(market)
      + finiteStock(market.honey) * foodMealValue('honey');
    return freshStock > 1e-6
      ? marketHasActiveStall(market, 'food')
      : marketHasActiveStall(market, 'preservedFood');
  };

  const calendarDaySeconds = CALENDAR_SECONDS_PER_DAY;
  const preservedFoodDemandMultiplier = Number.isFinite(
    currentPreservedFoodDemandMultiplier,
  )
    ? Math.max(0, currentPreservedFoodDemandMultiplier)
    : 1;
  const preservedFoodSpoilageFractionPerDay = Number.isFinite(
    requestedPreservedFoodSpoilageFractionPerDay,
  )
    ? Math.max(0, requestedPreservedFoodSpoilageFractionPerDay ?? 0)
    : PRESERVED_FOOD_SPOILAGE_PER_DAY;
  let foodConsumers = 0;
  let grossHouseholdFoodPerDay = 0;
  let householdPreservedFoodRotationTargetPerDay = 0;
  let householdPreservedFoodRotationPerDay = 0;
  let heatedResidents = 0;
  let heatedHouseholds = 0;
  let displacedHouseholds = 0;
  let displacedResidents = 0;
  let fireQuarantinedFoodStock = 0;
  let fireQuarantinedFirewoodStock = 0;
  let fireQuarantinedPreservedFoodStock = 0;
  let householdFirewoodStock = 0;
  let householdCharcoalStock = state.physicalFoundingSiteEnabled === true
    ? 0
    : finiteStock(state.stockpile.charcoal);
  // ResourceTotals exposes unreserved food, while residence pantries are
  // deliberately protected household stock. Provisioning still needs the
  // gross physical amount before subtracting any fire quarantine.
  let householdPantryFoodStock = 0;
  let usablePreservedFoodStock = state.physicalFoundingSiteEnabled === true
    ? 0
    : preservedFoodMealEquivalents(state.stockpile);
  let usablePreservedFoodWeightedStock = state.physicalFoundingSiteEnabled === true
    ? 0
    : preservedFoodSpoilageExposure(state.stockpile)
      * PRESERVED_FOOD_STORAGE_TREASURY_FACTOR;
  let householdBufferHouseholds = 0;
  let householdBufferReadyHouseholds = 0;
  let householdBufferFoodShortHomes = 0;
  let householdBufferFirewoodShortHomes = 0;
  let householdBufferWaterShortHomes = 0;
  let householdBufferPreservedFoodShortHomes = 0;
  let householdBufferAleShortHomes = 0;
  let householdBufferClothShortHomes = 0;
  let householdBufferPotteryShortHomes = 0;
  for (const residence of state.residences.values()) {
    const householdFreshStock = freshFoodMealEquivalents(residence);
    const householdPreservedStock = preservedFoodStockForResidence(residence);
    const householdHoneyStock = finiteStock(residence.honey) * foodMealValue('honey');
    const householdEdibleStock = householdFreshStock
      + householdPreservedStock
      + householdHoneyStock;
    const residenceFirewoodStock = finiteStock(
      getNeedStock(residence.needs, 'firewood'),
    );
    const fireDisabled = fireDisabledResidences.has(residence.id);
    householdPantryFoodStock += householdEdibleStock;
    householdFirewoodStock += residenceFirewoodStock;
    accumulateResidenceWelfare(
      welfareAccumulator,
      residence,
      fireDisabled,
    );
    if (fireDisabled) {
      fireQuarantinedFirewoodStock += residenceFirewoodStock;
      fireQuarantinedFoodStock += householdEdibleStock;
      fireQuarantinedPreservedFoodStock += householdPreservedStock;
      if (!residence.abandoned && residence.population > 0) {
        displacedHouseholds += 1;
        displacedResidents += residence.population;
      }
      continue;
    }
    if (residence.abandoned || residence.population <= 0) continue;
    foodConsumers += residence.population;
    if (residence.tier >= 1) {
      heatedResidents += residence.population;
      heatedHouseholds += 1;
    }
    householdBufferHouseholds += 1;
    let householdBufferReady = true;
    const grossFoodNeeded = householdFoodUnitsPerDayForTier(residence.tier);
    const monthlyFoodBill = householdFoodUnitsPerMonthForTier(residence.tier);
    let preservedFoodNeeded = 0;
    let monthlyPreservedFoodBill = 0;
    let preservedFoodRotationUsed = 0;
    if (residence.tier >= 4) {
      preservedFoodNeeded = householdFoodUnitsPerDay(1)
        * preservedFoodDemandMultiplier;
      monthlyPreservedFoodBill = householdFoodUnitsPerMonth(1);
      // Keep the settlement-wide scan allocation-free. This is the rotation
      // portion of allocatePreservedMeal with a full fresh-food plan, so no
      // emergency fallback is projected into ordinary daily demand.
      preservedFoodRotationUsed = Math.min(
        householdPreservedStock,
        preservedFoodNeeded,
        grossFoodNeeded,
      );
      usablePreservedFoodStock += householdPreservedStock;
      usablePreservedFoodWeightedStock += preservedFoodSpoilageExposure(residence)
        * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR;
      householdPreservedFoodRotationTargetPerDay += preservedFoodNeeded;
      householdPreservedFoodRotationPerDay += preservedFoodRotationUsed;
    }
    grossHouseholdFoodPerDay += grossFoodNeeded;
    const roadBranch = roadProvisionBranches && roadComponentFor
      ? roadProvisionBranch(
          roadProvisionBranches,
          residence,
          'residence',
          roadComponentFor,
        )
      : null;
    if (roadBranch) {
      roadBranch.households += 1;
      roadBranch.foodDemandPerDay += grossFoodNeeded;
      roadBranch.preservedFoodRotationPerDay += preservedFoodNeeded;
      addBranchPreservedFoodStock(
        roadBranch,
        householdPreservedStock,
        PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
        preservedFoodSpoilageExposure(residence),
      );
      roadBranch.firstResidenceId = roadBranch.firstResidenceId === null
        || compareStableEntityIds(residence.id, roadBranch.firstResidenceId) < 0
        ? residence.id
        : roadBranch.firstResidenceId;
      addBranchFoodStock(
        roadBranch,
        householdFreshStock + householdHoneyStock,
        FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
        freshFoodSpoilageExposure(residence),
      );
    }
    if (householdEdibleStock + 1e-6 < monthlyFoodBill) {
      householdBufferFoodShortHomes += 1;
      householdBufferReady = false;
    }
    if (residence.tier >= 1) {
      const firewoodNeeded = householdFirewoodUnitsPerMonth();
      if (roadBranch) {
        roadBranch.heatedHouseholds += 1;
        roadBranch.winterFirewoodDemandPerDay += householdFirewoodUnitsPerDay(
          WINTER_FIREWOOD_DEMAND_MULTIPLIER,
        );
        roadBranch.firewoodStock += residenceFirewoodStock;
      }
      if (residenceFirewoodStock + 1e-6 < firewoodNeeded) {
        householdBufferFirewoodShortHomes += 1;
        householdBufferReady = false;
      }
    }
    if (residence.tier >= 1) {
      const waterNeeded = residence.population
        * RESIDENCE_WATER_PER_PERSON_PER_SEC
        * calendarDaySeconds;
      if (getNeedStock(residence.needs, 'water') + 1e-6 < waterNeeded) {
        householdBufferWaterShortHomes += 1;
        householdBufferReady = false;
      }
    }
    if (residence.tier >= 2) {
      const clothNeeded = residence.population
        * RESIDENCE_CLOTH_PER_PERSON_PER_SEC
        * calendarDaySeconds;
      const aleNeeded = residence.population
        * RESIDENCE_ALE_PER_PERSON_PER_SEC
        * calendarDaySeconds;
      if (getNeedStock(residence.needs, 'cloth') + 1e-6 < clothNeeded) {
        householdBufferClothShortHomes += 1;
        householdBufferReady = false;
      }
      if (getNeedStock(residence.needs, 'ale') + 1e-6 < aleNeeded) {
        householdBufferAleShortHomes += 1;
        householdBufferReady = false;
      }
    }
    if (residence.tier >= 4) {
      const potteryNeeded = residence.population
        * RESIDENCE_POTTERY_PER_PERSON_PER_SEC
        * calendarDaySeconds;
      if (householdPreservedStock + 1e-6 < monthlyPreservedFoodBill) {
        householdBufferPreservedFoodShortHomes += 1;
        householdBufferReady = false;
      }
      if (getNeedStock(residence.needs, 'pottery') + 1e-6 < potteryNeeded) {
        householdBufferPotteryShortHomes += 1;
        householdBufferReady = false;
      }
    }
    if (householdBufferReady) householdBufferReadyHouseholds += 1;

  }

  let assignedGuards = 0;
  let armedGuards = 0;
  let guardFoodStock = 0;
  let guardPayChestGold = 0;
  let guardProvisionRunwayDays = Number.POSITIVE_INFINITY;
  for (const building of state.buildings.values()) {
    const fireDisabled = fireDisabledBuildings.has(building.id);
    const householdCharcoal = building.kind === 'marketplace'
      || building.kind === 'village_storehouse'
      ? finiteStock(building.charcoal)
      : 0;
    householdCharcoalStock += householdCharcoal;
    const operationalPreservedFoodSupplier =
      !fireDisabled
      && PRESERVED_FOOD_SUPPLIER_KINDS.includes(building.kind)
      && isOperationalSpecialtySupplier(building)
      && marketHasActiveStall(building, 'preservedFood');
    if (fireDisabled) {
      fireQuarantinedFirewoodStock += finiteStock(building.firewood)
        + householdCharcoal * CHARCOAL_HOUSEHOLD_FUEL_VALUE;
      fireQuarantinedFoodStock += edibleFoodMealEquivalents(building);
      fireQuarantinedPreservedFoodStock += preservedFoodMealEquivalents(building);
    }
    if (roadProvisionBranches && roadComponentFor) {
      // Monastery charity has parish and route-length restrictions inside a
      // connected component. Count it only once a cart is actually bound for a
      // household; treating its whole store as branch-wide would promise food
      // to homes outside the 520 m service route.
      if (
        building.kind !== 'monastery'
        && !fireDisabled
        && isOperationalFoodSupplier(building)
        && marketHasBaseFoodStall(building)
        && edibleFoodMealEquivalents(building) > 1e-6
      ) {
        const branch = roadProvisionBranch(
          roadProvisionBranches,
          building,
          'building',
          roadComponentFor,
        );
        branch.hasFoodSupplyRoute = true;
        addBranchFoodStock(
          branch,
          freshFoodMealEquivalents(building)
            + finiteStock(building.honey) * foodMealValue('honey'),
          buildingFreshFoodStorageFactor(building.kind),
          freshFoodSpoilageExposure(building),
        );
      }
      if (
        !fireDisabled
        && isOperationalFirewoodSupplier(building)
        && marketHasActiveStall(building, 'firewood')
      ) {
        const branch = roadProvisionBranch(
          roadProvisionBranches,
          building,
          'building',
          roadComponentFor,
        );
        branch.hasFirewoodSupplyRoute = true;
        branch.firewoodStock += finiteStock(building.firewood)
          + finiteStock(building.charcoal) * CHARCOAL_HOUSEHOLD_FUEL_VALUE;
      }
      if (
        operationalPreservedFoodSupplier
        && preservedFoodMealEquivalents(building) > 1e-6
      ) {
        const branch = roadProvisionBranch(
          roadProvisionBranches,
          building,
          'building',
          roadComponentFor,
        );
        addBranchPreservedFoodStock(
          branch,
          preservedFoodMealEquivalents(building),
          buildingPreservedFoodStorageFactor(building.kind),
          preservedFoodSpoilageExposure(building),
        );
      }
    }
    if (operationalPreservedFoodSupplier) {
      const stock = preservedFoodMealEquivalents(building);
      usablePreservedFoodStock += stock;
      usablePreservedFoodWeightedStock += preservedFoodSpoilageExposure(building)
        * buildingPreservedFoodStorageFactor(building.kind);
    }
    if (
      building.kind !== 'guardhouse'
      || building.constructionComplete === false
      || building.assignedLabor <= 0
      || fireDisabled
    ) {
      continue;
    }
    assignedGuards += building.assignedLabor;
    const armedHere = Math.min(
      building.assignedLabor,
      Math.floor(Math.max(0, building.polearms ?? 0)),
    );
    armedGuards += armedHere;
    const guardFood = edibleFoodMealEquivalents(building);
    guardFoodStock += guardFood;
    guardPayChestGold += finiteStock(building.gold);
    if (armedHere > 0) {
      guardProvisionRunwayDays = Math.min(
        guardProvisionRunwayDays,
        runwayDays(
          guardFood,
          armedHere * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
        ),
      );
    }
  }

  let guardPayrollInTransitGold = 0;
  for (const trip of state.deliveryTrips.values()) {
    if (
      isPreservedFoodCargo(trip.cargoKind)
      && trip.phase !== 'inbound'
      && trip.amount > 1e-9
    ) {
      const residence = trip.destinationKind === 'residence' && trip.residenceId !== null
        ? state.residences.get(trip.residenceId)
        : undefined;
      const targetBuilding = trip.destinationKind === 'building'
        && trip.targetBuildingId !== null
        ? state.buildings.get(trip.targetBuildingId)
        : undefined;
      const residenceCanReceive = residence !== undefined
        && !residence.abandoned
        && residence.population > 0
        && !fireDisabledResidences.has(residence.id);
      const buildingCanReceive = targetBuilding !== undefined
        && !fireDisabledBuildings.has(targetBuilding.id);
      if (residenceCanReceive || buildingCanReceive) {
        const foodKind = trip.cargoKind as Parameters<typeof foodMealValue>[0];
        const stock = finiteStock(trip.amount) * foodMealValue(foodKind);
        usablePreservedFoodStock += stock;
        usablePreservedFoodWeightedStock +=
          stock
            * foodSpoilageMultiplier(foodKind)
            * PRESERVED_FOOD_STORAGE_CART_FACTOR;
      }
    }
    if (
      trip.destinationKind !== 'building'
      || trip.targetBuildingId === null
      || trip.cargoKind !== 'gold'
      || trip.phase === 'inbound'
      || fireDisabledBuildings.has(trip.targetBuildingId)
      || state.buildings.get(trip.targetBuildingId)?.kind !== 'guardhouse'
    ) {
      continue;
    }
    guardPayrollInTransitGold += finiteStock(trip.amount);
  }

  if (roadProvisionBranches && roadComponentFor) {
    for (const trip of state.deliveryTrips.values()) {
      if (
        trip.phase === 'inbound'
        || trip.amount <= 1e-9
        || (
          !isFreshFoodCargo(trip.cargoKind)
          && trip.cargoKind !== 'honey'
          && trip.cargoKind !== 'firewood'
          && trip.cargoKind !== 'charcoal'
          && !isPreservedFoodCargo(trip.cargoKind)
        )
      ) {
        continue;
      }
      const residence = trip.destinationKind === 'residence' && trip.residenceId !== null
        ? state.residences.get(trip.residenceId)
        : undefined;
      const targetBuilding = trip.destinationKind === 'building'
        && trip.targetBuildingId !== null
        ? state.buildings.get(trip.targetBuildingId)
        : undefined;
      if (
        residence
        && (
          residence.abandoned
          || residence.population <= 0
          || fireDisabledResidences.has(residence.id)
        )
      ) {
        continue;
      }
      if (
        targetBuilding
        && (
          fireDisabledBuildings.has(targetBuilding.id)
          ||
          (
            (isFreshFoodCargo(trip.cargoKind) || trip.cargoKind === 'honey')
            && (
              targetBuilding.kind === 'monastery'
              || !isOperationalFoodSupplier(targetBuilding)
            )
          )
          || (
            (trip.cargoKind === 'firewood' || trip.cargoKind === 'charcoal')
            && !isOperationalFirewoodSupplier(targetBuilding)
          )
          || (
            isPreservedFoodCargo(trip.cargoKind)
            && (
              !isOperationalSpecialtySupplier(targetBuilding)
              || !PRESERVED_FOOD_SUPPLIER_KINDS.includes(targetBuilding.kind)
            )
          )
        )
      ) {
        continue;
      }
      const destination = residence ?? targetBuilding;
      const destinationKind = residence ? 'residence' : 'building';
      if (!destination) continue;
      const branch = roadProvisionBranch(
        roadProvisionBranches,
        destination,
        destinationKind,
        roadComponentFor,
      );
      if (isFreshFoodCargo(trip.cargoKind) || trip.cargoKind === 'honey') {
        const foodKind = trip.cargoKind as Parameters<typeof foodMealValue>[0];
        const stock = trip.amount * foodMealValue(foodKind);
        addBranchFoodStock(
          branch,
          stock,
          FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
          stock * foodSpoilageMultiplier(foodKind),
        );
      } else if (trip.cargoKind === 'firewood' || trip.cargoKind === 'charcoal') {
        branch.firewoodStock += finiteStock(trip.amount)
          * (trip.cargoKind === 'charcoal' ? CHARCOAL_HOUSEHOLD_FUEL_VALUE : 1);
      } else {
        const foodKind = trip.cargoKind as Parameters<typeof foodMealValue>[0];
        const stock = trip.amount * foodMealValue(foodKind);
        addBranchPreservedFoodStock(
          branch,
          stock,
          PRESERVED_FOOD_STORAGE_CART_FACTOR,
          stock * foodSpoilageMultiplier(foodKind),
        );
      }
    }
  }

  const householdFoodPerDay = Math.max(
    0,
    grossHouseholdFoodPerDay - householdPreservedFoodRotationPerDay,
  );
  const guardFoodPerDay = armedGuards * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY;
  const grossFoodDemandPerDay = grossHouseholdFoodPerDay + guardFoodPerDay;
  const totalFoodPerDay = householdFoodPerDay + guardFoodPerDay;
  const averageFreshFoodDemandPerCalendarDay = householdFoodPerDay
    + guardFoodPerDay * averageNonHolidayCalendarDayShare();
  const foodPreservation = analyzeFreshFoodPreservation(
    state,
    freshFoodSpoilageFractionPerDay,
    {
      fireDisabledBuildingIds: fireDisabledBuildings,
      fireDisabledResidenceIds: fireDisabledResidences,
      preservedFoodSpoilageFractionPerDay,
    },
  );
  const usablePreservedFoodSpoilageFractionPerDay =
    usablePreservedFoodStock > 1e-9
      ? preservedFoodSpoilageFractionPerDay
        * usablePreservedFoodWeightedStock
        / usablePreservedFoodStock
      : 0;
  const usablePreservedFoodSpoilagePerDay =
    preservedFoodSpoilageFractionPerDay * usablePreservedFoodWeightedStock;
  const foodStock = totals.food + householdPantryFoodStock;
  const usableFoodStock = Math.max(0, foodStock - fireQuarantinedFoodStock);
  const usableFreshFoodStock = Math.max(
    0,
    usableFoodStock - usablePreservedFoodStock,
  );
  const usableFreshFoodSpoilageFractionPerDay =
    foodPreservation.usableSpoilageFractionPerDay;
  const usableFreshFoodSpoilagePerDay =
    usableFreshFoodStock * usableFreshFoodSpoilageFractionPerDay;
  const householdHeatingFirewoodStock = totals.firewood + householdFirewoodStock;
  const householdHeatingStock = householdHeatingFirewoodStock
    + householdCharcoalStock * CHARCOAL_HOUSEHOLD_FUEL_VALUE;
  const usableFirewoodStock = Math.max(
    0,
    householdHeatingStock - fireQuarantinedFirewoodStock,
  );
  const currentFirewoodPerDay = heatedHouseholds
    * householdFirewoodUnitsPerDay(currentFirewoodDemandMultiplier);
  const winterFirewoodPerDay = heatedHouseholds
    * householdFirewoodUnitsPerDay(WINTER_FIREWOOD_DEMAND_MULTIPLIER);
  const winterFirewoodNeed = winterFirewoodPerDay * WINTER_RESERVE_DAYS;
  const guardWagePerDay = armedGuards * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY;
  const roadBranches = roadProvisionBranches === null
    ? null
    : finalizeRoadProvisioning(
        roadProvisionBranches,
        freshFoodSpoilageFractionPerDay,
        preservedFoodSpoilageFractionPerDay,
      );
  const welfare = finalizeSettlementWelfare(
    welfareAccumulator,
    state,
    fireDisabledBuildings,
  );

  return {
    foodConsumers,
    heatedResidents,
    displacedHouseholds,
    displacedResidents,
    assignedGuards,
    armedGuards,
    unarmedGuards: Math.max(0, assignedGuards - armedGuards),
    guardFoodStock,
    guardProvisionRunwayDays,
    guardPayChestGold,
    guardPayrollInTransitGold,
    householdBufferHouseholds,
    householdBufferReadyHouseholds,
    householdBufferCoverage: householdBufferHouseholds > 0
      ? householdBufferReadyHouseholds / householdBufferHouseholds
      : 1,
    householdBufferFoodShortHomes,
    householdBufferFirewoodShortHomes,
    householdBufferWaterShortHomes,
    householdBufferPreservedFoodShortHomes,
    householdBufferAleShortHomes,
    householdBufferClothShortHomes,
    householdBufferPotteryShortHomes,
    foodStock,
    usableFoodStock,
    fireQuarantinedFoodStock,
    firewoodStock: householdHeatingStock,
    householdFirewoodStock: householdHeatingFirewoodStock,
    householdCharcoalStock,
    usableFirewoodStock,
    fireQuarantinedFirewoodStock,
    grossHouseholdFoodPerDay,
    householdPreservedFoodRotationTargetPerDay,
    householdPreservedFoodRotationPerDay,
    householdFoodPerDay,
    guardFoodPerDay,
    grossFoodDemandPerDay,
    totalFoodPerDay,
    averageFreshFoodDemandPerCalendarDay,
    usablePreservedFoodStock,
    fireQuarantinedPreservedFoodStock,
    preservedFoodSpoilagePerDay: usablePreservedFoodSpoilagePerDay,
    preservedFoodSpoilageFractionPerDay:
      usablePreservedFoodSpoilageFractionPerDay,
    foodSpoilagePerDay: usableFreshFoodSpoilagePerDay,
    foodSpoilageFractionPerDay: usableFreshFoodSpoilageFractionPerDay,
    protectedFoodShare: foodPreservation.usableProtectedShare,
    foodPreservation,
    foodRunwayWithoutSpoilageDays: freshFoodRunwayWithPreservedRotation({
      freshStock: usableFreshFoodStock,
      grossFoodDemandPerDay,
      preservedStock: usablePreservedFoodStock,
      preservedRotationPerDay: householdPreservedFoodRotationTargetPerDay,
    }),
    foodRunwayDays: freshFoodRunwayWithPreservedRotation({
      freshStock: usableFreshFoodStock,
      grossFoodDemandPerDay,
      preservedStock: usablePreservedFoodStock,
      preservedRotationPerDay: householdPreservedFoodRotationTargetPerDay,
      freshFoodSpoilageFractionPerDay:
        usableFreshFoodSpoilageFractionPerDay,
      preservedFoodSpoilageFractionPerDay:
        usablePreservedFoodSpoilageFractionPerDay,
    }),
    currentFirewoodPerDay,
    currentFirewoodRunwayDays: runwayDays(usableFirewoodStock, currentFirewoodPerDay),
    winterFirewoodPerDay,
    winterFirewoodNeed,
    winterFirewoodRunwayDays: runwayDays(usableFirewoodStock, winterFirewoodPerDay),
    winterFirewoodCoverage: winterFirewoodNeed > 1e-9
      ? usableFirewoodStock / winterFirewoodNeed
      : Number.POSITIVE_INFINITY,
    guardWagePerDay,
    guardWageRunwayDays: runwayDays(
      totals.gold + guardPayChestGold + guardPayrollInTransitGold,
      guardWagePerDay,
    ),
    sabbathObserved,
    roadBranches,
    welfare,
  };
}

export function settlementProvisionLevel(
  provisioning: SettlementProvisioning,
  month: number,
): ProvisionLevel {
  const hasDemand = provisioning.foodConsumers > 0
    || provisioning.heatedResidents > 0
    || provisioning.assignedGuards > 0;
  if (!hasDemand) return 'none';

  const winterRelevant = month >= 9 || month <= 2;
  if (
    provisioning.foodRunwayDays < PROVISION_CRITICAL_DAYS
    || provisioning.guardProvisionRunwayDays < PROVISION_CRITICAL_DAYS
    || provisioning.guardWageRunwayDays < PROVISION_CRITICAL_DAYS
    || (
      provisioning.householdBufferHouseholds > 0
      && provisioning.householdBufferCoverage < HOUSEHOLD_BUFFER_CRITICAL_COVERAGE
    )
    || (
      winterRelevant
      && provisioning.winterFirewoodRunwayDays < PROVISION_CRITICAL_DAYS
    )
  ) {
    return 'critical';
  }
  if (
    provisioning.foodRunwayDays < PROVISION_WARNING_DAYS
    || provisioning.guardProvisionRunwayDays < PROVISION_WARNING_DAYS
    || provisioning.guardWageRunwayDays < PROVISION_WARNING_DAYS
    || provisioning.unarmedGuards > 0
    || (
      provisioning.householdBufferHouseholds > 0
      && provisioning.householdBufferCoverage < HOUSEHOLD_BUFFER_WARNING_COVERAGE
    )
    || (
      winterRelevant
      && provisioning.winterFirewoodRunwayDays < WINTER_RESERVE_DAYS
    )
  ) {
    return 'watch';
  }
  return 'ready';
}

export function shouldShowProvisioning(
  provisioning: SettlementProvisioning,
  month: number,
): boolean {
  const level = settlementProvisionLevel(provisioning, month);
  return level === 'critical'
    || level === 'watch'
    || ((month >= 9 || month <= 2) && level !== 'none');
}

export function formatProvisionDays(days: number): string {
  if (!Number.isFinite(days)) return 'no demand';
  if (days < 1) return '<1d';
  if (days < 10) return `${days.toFixed(1)}d`;
  if (days >= 100) return '100d+';
  return `${Math.floor(days + 1e-9)}d`;
}

export function formatProvisionRunway(days: number): string {
  if (!Number.isFinite(days)) return 'No current demand';
  if (days < 1) return 'Less than one day';
  if (days < 10) return `${days.toFixed(1)} days`;
  if (days >= 100) return 'At least 100 days';
  return `${Math.floor(days + 1e-9)} days`;
}

export function formatHouseholdBufferReadiness(
  provisioning: SettlementProvisioning,
): string {
  if (provisioning.householdBufferHouseholds === 0) {
    return 'No occupied homes';
  }
  const shortages = [
    ['food', provisioning.householdBufferFoodShortHomes],
    ['fuel', provisioning.householdBufferFirewoodShortHomes],
    ['water', provisioning.householdBufferWaterShortHomes],
    ['preserved food', provisioning.householdBufferPreservedFoodShortHomes],
    ['ale', provisioning.householdBufferAleShortHomes],
    ['clothing', provisioning.householdBufferClothShortHomes],
    ['pottery', provisioning.householdBufferPotteryShortHomes],
  ] as const;
  const shortageLabel = shortages
    .filter(([, homes]) => homes > 0)
    .map(([label, homes]) => `${homes} ${label}`)
    .join(', ');
  const base = `${provisioning.householdBufferReadyHouseholds} / ${provisioning.householdBufferHouseholds} homes buffered`;
  return shortageLabel ? `${base} · short: ${shortageLabel}` : base;
}

function runwayDays(stock: number, demandPerDay: number): number {
  if (demandPerDay <= 1e-9) return Number.POSITIVE_INFINITY;
  return Math.max(0, stock) / demandPerDay;
}
