import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
  GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
  RESIDENCE_ALE_PER_PERSON_PER_SEC,
  RESIDENCE_CLOTH_PER_PERSON_PER_SEC,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_WATER_PER_PERSON_PER_SEC,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../generated/gameBalance.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import type { ResourceTotals } from '../resources/resourceTotals.ts';
import type { GameState } from '../resources/types.ts';
import {
  analyzeFreshFoodPreservation,
  type FreshFoodPreservation,
  spoilageAdjustedRunwayDays,
} from './foodPreservation.ts';

export const WINTER_RESERVE_DAYS = CALENDAR_DAYS_PER_MONTH * 3;
export const PROVISION_WARNING_DAYS = 5;
export const PROVISION_CRITICAL_DAYS = 2;
export const HOUSEHOLD_BUFFER_WARNING_COVERAGE = 0.8;
export const HOUSEHOLD_BUFFER_CRITICAL_COVERAGE = 0.5;

export type SettlementProvisioning = {
  foodConsumers: number;
  heatedResidents: number;
  assignedGuards: number;
  armedGuards: number;
  unarmedGuards: number;
  guardFoodStock: number;
  guardProvisionRunwayDays: number;
  householdBufferHouseholds: number;
  householdBufferReadyHouseholds: number;
  householdBufferCoverage: number;
  householdBufferFoodShortHomes: number;
  householdBufferFirewoodShortHomes: number;
  householdBufferWaterShortHomes: number;
  householdBufferPreservedFoodShortHomes: number;
  householdBufferAleShortHomes: number;
  householdBufferClothShortHomes: number;
  foodStock: number;
  firewoodStock: number;
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
};

export type ProvisionLevel = 'none' | 'ready' | 'watch' | 'critical';

export function computeSettlementProvisioning(input: {
  state: GameState;
  totals: ResourceTotals;
  currentFirewoodDemandMultiplier: number;
  freshFoodSpoilageFractionPerDay: number;
  sabbathObserved: boolean;
}): SettlementProvisioning {
  const {
    state,
    totals,
    currentFirewoodDemandMultiplier,
    freshFoodSpoilageFractionPerDay,
    sabbathObserved,
  } = input;

  const workdayFraction = Math.max(
    0,
    (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR) / CALENDAR_HOURS_PER_DAY,
  );
  const workdaySeconds = CALENDAR_SECONDS_PER_DAY * workdayFraction;
  const nightlyNoDeliverySeconds = CALENDAR_SECONDS_PER_DAY - workdaySeconds;
  const sabbathFirewoodBufferSeconds = CALENDAR_SECONDS_PER_DAY + nightlyNoDeliverySeconds;
  let foodConsumers = 0;
  let heatedResidents = 0;
  let householdBufferHouseholds = 0;
  let householdBufferReadyHouseholds = 0;
  let householdBufferFoodShortHomes = 0;
  let householdBufferFirewoodShortHomes = 0;
  let householdBufferWaterShortHomes = 0;
  let householdBufferPreservedFoodShortHomes = 0;
  let householdBufferAleShortHomes = 0;
  let householdBufferClothShortHomes = 0;
  let sabbathHouseholds = 0;
  let sabbathReadyHouseholds = 0;
  let sabbathFoodShortHomes = 0;
  let sabbathFirewoodShortHomes = 0;
  let sabbathWaterShortHomes = 0;
  let sabbathPreservedFoodShortHomes = 0;
  let sabbathAleShortHomes = 0;
  let sabbathClothShortHomes = 0;
  for (const residence of state.residences.values()) {
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
    if (getNeedStock(residence.needs, 'food') + 1e-6 < foodNeeded) {
      householdBufferFoodShortHomes += 1;
      householdBufferReady = false;
    }
    if (residence.tier >= 2) {
      const firewoodNeeded = residence.population
        * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
        * nightlyNoDeliverySeconds
        * Math.max(0, currentFirewoodDemandMultiplier);
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
        * workdaySeconds;
      const aleNeeded = residence.population
        * RESIDENCE_ALE_PER_PERSON_PER_SEC
        * workdaySeconds;
      const clothNeeded = residence.population
        * RESIDENCE_CLOTH_PER_PERSON_PER_SEC
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
        * workdaySeconds;
      const aleNeeded = residence.population
        * RESIDENCE_ALE_PER_PERSON_PER_SEC
        * workdaySeconds;
      const clothNeeded = residence.population
        * RESIDENCE_CLOTH_PER_PERSON_PER_SEC
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
    }
    if (sabbathReady) sabbathReadyHouseholds += 1;
  }

  let assignedGuards = 0;
  let armedGuards = 0;
  let guardFoodStock = 0;
  let guardProvisionRunwayDays = Number.POSITIVE_INFINITY;
  for (const building of state.buildings.values()) {
    if (
      building.kind !== 'guardhouse'
      || building.constructionComplete === false
      || building.assignedLabor <= 0
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

  const householdFoodPerDay = foodConsumers
    * RESIDENCE_FOOD_PER_PERSON_PER_SEC
    * CALENDAR_SECONDS_PER_DAY
    * workdayFraction;
  const guardFoodPerDay = armedGuards * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY;
  const totalFoodPerDay = householdFoodPerDay + guardFoodPerDay;
  const foodPreservation = analyzeFreshFoodPreservation(
    state,
    freshFoodSpoilageFractionPerDay,
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

  return {
    foodConsumers,
    heatedResidents,
    assignedGuards,
    armedGuards,
    unarmedGuards: Math.max(0, assignedGuards - armedGuards),
    guardFoodStock,
    guardProvisionRunwayDays,
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
    foodStock: totals.food,
    firewoodStock: totals.firewood,
    householdFoodPerDay,
    guardFoodPerDay,
    totalFoodPerDay,
    foodSpoilagePerDay: foodPreservation.spoilagePerDay,
    foodSpoilageFractionPerDay: foodPreservation.spoilageFractionPerDay,
    protectedFoodShare: foodPreservation.protectedShare,
    foodPreservation,
    foodRunwayWithoutSpoilageDays: runwayDays(totals.food, totalFoodPerDay),
    foodRunwayDays: spoilageAdjustedRunwayDays(
      totals.food,
      totalFoodPerDay,
      foodPreservation.spoilageFractionPerDay,
    ),
    currentFirewoodPerDay,
    currentFirewoodRunwayDays: runwayDays(totals.firewood, currentFirewoodPerDay),
    winterFirewoodPerDay,
    winterFirewoodNeed,
    winterFirewoodRunwayDays: runwayDays(totals.firewood, winterFirewoodPerDay),
    winterFirewoodCoverage: winterFirewoodNeed > 1e-9
      ? totals.firewood / winterFirewoodNeed
      : Number.POSITIVE_INFINITY,
    guardWagePerDay,
    guardWageRunwayDays: runwayDays(totals.gold, guardWagePerDay),
    sabbathObserved,
    sabbathHouseholds,
    sabbathReadyHouseholds,
    sabbathFoodShortHomes,
    sabbathFirewoodShortHomes,
    sabbathWaterShortHomes,
    sabbathPreservedFoodShortHomes,
    sabbathAleShortHomes,
    sabbathClothShortHomes,
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
    || (winterRelevant && provisioning.winterFirewoodRunwayDays < PROVISION_CRITICAL_DAYS)
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
    || (winterRelevant && provisioning.winterFirewoodRunwayDays < WINTER_RESERVE_DAYS)
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
