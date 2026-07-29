import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
  FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
  GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
  GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_POTTERY_PER_PERSON_PER_SEC,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../generated/gameBalance.ts';
import {
  compareStableEntityIds,
  isOperationalFirewoodSupplier,
  isOperationalFoodSupplier,
} from '../logistics/roadLogistics.ts';
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
  type FreshFoodPreservation,
  spoilageAdjustedRunwayDays,
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
  usableFirewoodStock: number;
  fireQuarantinedFirewoodStock: number;
  householdFoodPerDay: number;
  guardFoodPerDay: number;
  totalFoodPerDay: number;
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
  sabbathHouseholds: number;
  sabbathReadyHouseholds: number;
  sabbathFoodShortHomes: number;
  sabbathFirewoodShortHomes: number;
  sabbathWaterShortHomes: number;
  sabbathPreservedFoodShortHomes: number;
  sabbathAleShortHomes: number;
  sabbathClothShortHomes: number;
  sabbathPotteryShortHomes: number;
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
  winterFirewoodDemandPerDay: number;
  foodStock: number;
  weightedFoodStock: number;
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
    winterFirewoodDemandPerDay: 0,
    foodStock: 0,
    weightedFoodStock: 0,
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

function addBranchFoodStock(
  branch: RoadProvisionBranch,
  stock: number,
  storageFactor: number,
): void {
  const amount = finiteStock(stock);
  branch.foodStock += amount;
  branch.weightedFoodStock += amount * Math.max(0, storageFactor);
}

function finalizeRoadProvisioning(
  branches: ReadonlyMap<string, RoadProvisionBranch>,
  ambientSpoilageFractionPerDay: number,
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
  let physicalFirewoodStock = 0;
  let worstFoodRunwayDays = Number.POSITIVE_INFINITY;
  let worstWinterFirewoodRunwayDays = Number.POSITIVE_INFINITY;
  let firstExposedResidenceId: string | null = null;
  let firstExposureScore = Number.POSITIVE_INFINITY;
  const ambientSpoilage = Math.max(0, ambientSpoilageFractionPerDay);

  for (const branch of branches.values()) {
    if (branch.households <= 0) continue;
    activeBranches += 1;
    physicalFoodStock += branch.foodStock;
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
    const foodRunway = spoilageAdjustedRunwayDays(
      branch.foodStock,
      branch.foodDemandPerDay,
      ambientSpoilage * storageFactor,
    );
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
  currentPreservedFoodDemandMultiplier?: number;
  sabbathObserved: boolean;
  roadComponentFor?: ProvisionRoadComponentResolver;
}): SettlementProvisioning {
  const {
    state,
    totals,
    currentFirewoodDemandMultiplier,
    freshFoodSpoilageFractionPerDay,
    currentPreservedFoodDemandMultiplier = 1,
    sabbathObserved,
    roadComponentFor,
  } = input;
  const roadProvisionBranches = roadComponentFor
    ? new Map<string, RoadProvisionBranch>()
    : null;
  const fireDisabledBuildings = fireDisabledBuildingIds(state.fireIncidents.values());
  const fireDisabledResidences = fireDisabledResidenceIds(state.fireIncidents.values());
  const welfareAccumulator = createSettlementWelfareAccumulator();

  const workdayFraction = Math.max(
    0,
    (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR) / CALENDAR_HOURS_PER_DAY,
  );
  const workdaySeconds = CALENDAR_SECONDS_PER_DAY * workdayFraction;
  const preservedFoodDemandMultiplier = Number.isFinite(
    currentPreservedFoodDemandMultiplier,
  )
    ? Math.max(0, currentPreservedFoodDemandMultiplier)
    : 1;
  const nightlyNoDeliverySeconds = CALENDAR_SECONDS_PER_DAY - workdaySeconds;
  const sabbathFirewoodBufferSeconds = CALENDAR_SECONDS_PER_DAY + nightlyNoDeliverySeconds;
  let foodConsumers = 0;
  let heatedResidents = 0;
  let displacedHouseholds = 0;
  let displacedResidents = 0;
  let fireQuarantinedFirewoodStock = 0;
  let householdBufferHouseholds = 0;
  let householdBufferReadyHouseholds = 0;
  let householdBufferFoodShortHomes = 0;
  let householdBufferFirewoodShortHomes = 0;
  let householdBufferWaterShortHomes = 0;
  let householdBufferPreservedFoodShortHomes = 0;
  let householdBufferAleShortHomes = 0;
  let householdBufferClothShortHomes = 0;
  let householdBufferPotteryShortHomes = 0;
  let sabbathHouseholds = 0;
  let sabbathReadyHouseholds = 0;
  let sabbathFoodShortHomes = 0;
  let sabbathFirewoodShortHomes = 0;
  let sabbathWaterShortHomes = 0;
  let sabbathPreservedFoodShortHomes = 0;
  let sabbathAleShortHomes = 0;
  let sabbathClothShortHomes = 0;
  let sabbathPotteryShortHomes = 0;
  for (const residence of state.residences.values()) {
    accumulateResidenceWelfare(
      welfareAccumulator,
      residence,
      fireDisabledResidences.has(residence.id),
    );
    if (fireDisabledResidences.has(residence.id)) {
      fireQuarantinedFirewoodStock += finiteStock(
        getNeedStock(residence.needs, 'firewood'),
      );
      if (!residence.abandoned && residence.population > 0) {
        displacedHouseholds += 1;
        displacedResidents += residence.population;
      }
      continue;
    }
    if (residence.abandoned || residence.population <= 0) continue;
    foodConsumers += residence.population;
    if (residence.tier >= 2) {
      heatedResidents += residence.population;
    }
    householdBufferHouseholds += 1;
    let householdBufferReady = true;
    const foodNeeded = residence.population
      * RESIDENCE_FOOD_PER_PERSON_PER_SEC
      * workdaySeconds;
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
      roadBranch.foodDemandPerDay += foodNeeded;
      roadBranch.firstResidenceId = roadBranch.firstResidenceId === null
        || compareStableEntityIds(residence.id, roadBranch.firstResidenceId) < 0
        ? residence.id
        : roadBranch.firstResidenceId;
      addBranchFoodStock(
        roadBranch,
        getNeedStock(residence.needs, 'food'),
        FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
      );
    }
    if (getNeedStock(residence.needs, 'food') + 1e-6 < foodNeeded) {
      householdBufferFoodShortHomes += 1;
      householdBufferReady = false;
    }
    if (residence.tier >= 2) {
      const firewoodNeeded = residence.population
        * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
        * nightlyNoDeliverySeconds
        * Math.max(0, currentFirewoodDemandMultiplier);
      if (roadBranch) {
        roadBranch.heatedHouseholds += 1;
        roadBranch.winterFirewoodDemandPerDay += residence.population
          * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
          * CALENDAR_SECONDS_PER_DAY
          * WINTER_FIREWOOD_DEMAND_MULTIPLIER;
        roadBranch.firewoodStock += finiteStock(
          getNeedStock(residence.needs, 'firewood'),
        );
      }
      const waterNeeded = residence.population
        * RESIDENCE_WATER_PER_PERSON_PER_SEC
        * workdaySeconds;
      if (getNeedStock(residence.needs, 'firewood') + 1e-6 < firewoodNeeded) {
        householdBufferFirewoodShortHomes += 1;
        householdBufferReady = false;
      }
      if (getNeedStock(residence.needs, 'water') + 1e-6 < waterNeeded) {
        householdBufferWaterShortHomes += 1;
        householdBufferReady = false;
      }
    }
    if (residence.tier >= 3) {
      const preservedFoodNeeded = residence.population
        * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
        * workdaySeconds
        * preservedFoodDemandMultiplier;
      const aleNeeded = residence.population
        * RESIDENCE_ALE_PER_PERSON_PER_SEC
        * workdaySeconds;
      const clothNeeded = residence.population
        * RESIDENCE_CLOTH_PER_PERSON_PER_SEC
        * workdaySeconds;
      const potteryNeeded = residence.population
        * RESIDENCE_POTTERY_PER_PERSON_PER_SEC
        * workdaySeconds;
      if (getNeedStock(residence.needs, 'preservedFood') + 1e-6 < preservedFoodNeeded) {
        householdBufferPreservedFoodShortHomes += 1;
        householdBufferReady = false;
      }
      if (getNeedStock(residence.needs, 'ale') + 1e-6 < aleNeeded) {
        householdBufferAleShortHomes += 1;
        householdBufferReady = false;
      }
      if (getNeedStock(residence.needs, 'cloth') + 1e-6 < clothNeeded) {
        householdBufferClothShortHomes += 1;
        householdBufferReady = false;
      }
      if (getNeedStock(residence.needs, 'pottery') + 1e-6 < potteryNeeded) {
        householdBufferPotteryShortHomes += 1;
        householdBufferReady = false;
      }
    }
    if (householdBufferReady) householdBufferReadyHouseholds += 1;

    if (!sabbathObserved) continue;
    sabbathHouseholds += 1;
    let sabbathReady = householdBufferReady;
    if (getNeedStock(residence.needs, 'food') + 1e-6 < foodNeeded) {
      sabbathFoodShortHomes += 1;
    }
    if (residence.tier >= 2) {
      const sabbathFirewoodNeeded = residence.population
        * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
        * sabbathFirewoodBufferSeconds
        * Math.max(0, currentFirewoodDemandMultiplier);
      const waterNeeded = residence.population
        * RESIDENCE_WATER_PER_PERSON_PER_SEC
        * workdaySeconds;
      if (getNeedStock(residence.needs, 'firewood') + 1e-6 < sabbathFirewoodNeeded) {
        sabbathFirewoodShortHomes += 1;
        sabbathReady = false;
      }
      if (getNeedStock(residence.needs, 'water') + 1e-6 < waterNeeded) {
        sabbathWaterShortHomes += 1;
      }
    }
    if (residence.tier >= 3) {
      const preservedFoodNeeded = residence.population
        * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
        * workdaySeconds
        * preservedFoodDemandMultiplier;
      const aleNeeded = residence.population
        * RESIDENCE_ALE_PER_PERSON_PER_SEC
        * workdaySeconds;
      const clothNeeded = residence.population
        * RESIDENCE_CLOTH_PER_PERSON_PER_SEC
        * workdaySeconds;
      const potteryNeeded = residence.population
        * RESIDENCE_POTTERY_PER_PERSON_PER_SEC
        * workdaySeconds;
      if (getNeedStock(residence.needs, 'preservedFood') + 1e-6 < preservedFoodNeeded) {
        sabbathPreservedFoodShortHomes += 1;
      }
      if (getNeedStock(residence.needs, 'ale') + 1e-6 < aleNeeded) {
        sabbathAleShortHomes += 1;
      }
      if (getNeedStock(residence.needs, 'cloth') + 1e-6 < clothNeeded) {
        sabbathClothShortHomes += 1;
      }
      if (getNeedStock(residence.needs, 'pottery') + 1e-6 < potteryNeeded) {
        sabbathPotteryShortHomes += 1;
      }
    }
    if (sabbathReady) sabbathReadyHouseholds += 1;
  }

  let assignedGuards = 0;
  let armedGuards = 0;
  let guardFoodStock = 0;
  let guardPayChestGold = 0;
  let guardProvisionRunwayDays = Number.POSITIVE_INFINITY;
  for (const building of state.buildings.values()) {
    const fireDisabled = fireDisabledBuildings.has(building.id);
    if (fireDisabled) {
      fireQuarantinedFirewoodStock += finiteStock(building.firewood);
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
        && building.food > 1e-6
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
          building.food,
          buildingFreshFoodStorageFactor(building.kind),
        );
      }
      if (!fireDisabled && isOperationalFirewoodSupplier(building)) {
        const branch = roadProvisionBranch(
          roadProvisionBranches,
          building,
          'building',
          roadComponentFor,
        );
        branch.hasFirewoodSupplyRoute = true;
        branch.firewoodStock += finiteStock(building.firewood);
      }
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
    guardFoodStock += Math.max(0, building.food);
    guardPayChestGold += finiteStock(building.gold);
    if (armedHere > 0) {
      guardProvisionRunwayDays = Math.min(
        guardProvisionRunwayDays,
        runwayDays(
          building.food,
          armedHere * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
        ),
      );
    }
  }

  let guardPayrollInTransitGold = 0;
  for (const trip of state.deliveryTrips.values()) {
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
        || (trip.cargoKind !== 'food' && trip.cargoKind !== 'firewood')
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
            trip.cargoKind === 'food'
            && (
              targetBuilding.kind === 'monastery'
              || !isOperationalFoodSupplier(targetBuilding)
            )
          )
          || (
            trip.cargoKind === 'firewood'
            && !isOperationalFirewoodSupplier(targetBuilding)
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
      if (trip.cargoKind === 'food') {
        addBranchFoodStock(
          branch,
          trip.amount,
          FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
        );
      } else {
        branch.firewoodStock += finiteStock(trip.amount);
      }
    }
  }

  const householdFoodPerDay = foodConsumers
    * RESIDENCE_FOOD_PER_PERSON_PER_SEC
    * CALENDAR_SECONDS_PER_DAY
    * workdayFraction;
  const guardFoodPerDay = armedGuards * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY;
  const totalFoodPerDay = householdFoodPerDay + guardFoodPerDay;
  const foodPreservation = analyzeFreshFoodPreservation(
    state,
    freshFoodSpoilageFractionPerDay,
    {
      fireDisabledBuildingIds: fireDisabledBuildings,
      fireDisabledResidenceIds: fireDisabledResidences,
    },
  );
  const usableFoodStock = Math.max(
    0,
    Math.min(totals.food, foodPreservation.usableStock),
  );
  const usableFirewoodStock = Math.max(
    0,
    totals.firewood - fireQuarantinedFirewoodStock,
  );
  const currentFirewoodPerDay = heatedResidents
    * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
    * CALENDAR_SECONDS_PER_DAY
    * Math.max(0, currentFirewoodDemandMultiplier);
  const winterFirewoodPerDay = heatedResidents
    * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
    * CALENDAR_SECONDS_PER_DAY
    * WINTER_FIREWOOD_DEMAND_MULTIPLIER;
  const winterFirewoodNeed = winterFirewoodPerDay * WINTER_RESERVE_DAYS;
  const guardWagePerDay = armedGuards * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY;
  const roadBranches = roadProvisionBranches === null
    ? null
    : finalizeRoadProvisioning(
        roadProvisionBranches,
        freshFoodSpoilageFractionPerDay,
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
    foodStock: totals.food,
    usableFoodStock,
    fireQuarantinedFoodStock: foodPreservation.quarantinedStock,
    firewoodStock: totals.firewood,
    usableFirewoodStock,
    fireQuarantinedFirewoodStock,
    householdFoodPerDay,
    guardFoodPerDay,
    totalFoodPerDay,
    foodSpoilagePerDay: foodPreservation.spoilagePerDay,
    foodSpoilageFractionPerDay: foodPreservation.usableSpoilageFractionPerDay,
    protectedFoodShare: foodPreservation.usableProtectedShare,
    foodPreservation,
    foodRunwayWithoutSpoilageDays: runwayDays(usableFoodStock, totalFoodPerDay),
    foodRunwayDays: spoilageAdjustedRunwayDays(
      usableFoodStock,
      totalFoodPerDay,
      foodPreservation.usableSpoilageFractionPerDay,
    ),
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
    sabbathHouseholds,
    sabbathReadyHouseholds,
    sabbathFoodShortHomes,
    sabbathFirewoodShortHomes,
    sabbathWaterShortHomes,
    sabbathPreservedFoodShortHomes,
    sabbathAleShortHomes,
    sabbathClothShortHomes,
    sabbathPotteryShortHomes,
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
    || (
      provisioning.roadBranches !== null
      && provisioning.roadBranches.worstFoodRunwayDays < PROVISION_CRITICAL_DAYS
    )
    || provisioning.guardProvisionRunwayDays < PROVISION_CRITICAL_DAYS
    || provisioning.guardWageRunwayDays < PROVISION_CRITICAL_DAYS
    || (
      provisioning.householdBufferHouseholds > 0
      && provisioning.householdBufferCoverage < HOUSEHOLD_BUFFER_CRITICAL_COVERAGE
    )
    || (
      winterRelevant
      && (
        provisioning.winterFirewoodRunwayDays < PROVISION_CRITICAL_DAYS
        || (
          provisioning.roadBranches !== null
          && provisioning.roadBranches.worstWinterFirewoodRunwayDays
            < PROVISION_CRITICAL_DAYS
        )
      )
    )
  ) {
    return 'critical';
  }
  if (
    provisioning.foodRunwayDays < PROVISION_WARNING_DAYS
    || (
      provisioning.roadBranches !== null
      && (
        provisioning.roadBranches.worstFoodRunwayDays < PROVISION_WARNING_DAYS
        || provisioning.roadBranches.foodUnservedBranches > 0
      )
    )
    || provisioning.guardProvisionRunwayDays < PROVISION_WARNING_DAYS
    || provisioning.guardWageRunwayDays < PROVISION_WARNING_DAYS
    || provisioning.unarmedGuards > 0
    || (
      provisioning.householdBufferHouseholds > 0
      && provisioning.householdBufferCoverage < HOUSEHOLD_BUFFER_WARNING_COVERAGE
    )
    || (
      winterRelevant
      && (
        provisioning.winterFirewoodRunwayDays < WINTER_RESERVE_DAYS
        || (
          provisioning.roadBranches !== null
          && (
            provisioning.roadBranches.worstWinterFirewoodRunwayDays
              < WINTER_RESERVE_DAYS
            || provisioning.roadBranches.firewoodUnservedBranches > 0
          )
        )
      )
    )
    || (
      provisioning.sabbathObserved
      && provisioning.sabbathReadyHouseholds < provisioning.sabbathHouseholds
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

export function formatSabbathReadiness(provisioning: SettlementProvisioning): string {
  if (!provisioning.sabbathObserved || provisioning.sabbathHouseholds === 0) {
    return 'Not observed';
  }
  const shortages = [
    ['food', provisioning.sabbathFoodShortHomes],
    ['fuel', provisioning.sabbathFirewoodShortHomes],
    ['water', provisioning.sabbathWaterShortHomes],
    ['preserved food', provisioning.sabbathPreservedFoodShortHomes],
    ['ale', provisioning.sabbathAleShortHomes],
    ['textiles', provisioning.sabbathClothShortHomes],
    ['pottery', provisioning.sabbathPotteryShortHomes],
  ] as const;
  const shortageLabel = shortages
    .filter(([, homes]) => homes > 0)
    .map(([label, homes]) => `${homes} ${label}`)
    .join(', ');
  const base = `${provisioning.sabbathReadyHouseholds} / ${provisioning.sabbathHouseholds} homes stocked`;
  return shortageLabel ? `${base} · short: ${shortageLabel}` : base;
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
    ['textiles', provisioning.householdBufferClothShortHomes],
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
