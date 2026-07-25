import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
  GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../generated/gameBalance.ts';
import type { ResourceTotals } from '../resources/resourceTotals.ts';
import type { GameState } from '../resources/types.ts';
import {
  analyzeFreshFoodPreservation,
  spoilageAdjustedRunwayDays,
} from './foodPreservation.ts';

export const WINTER_RESERVE_DAYS = CALENDAR_DAYS_PER_MONTH * 3;
export const PROVISION_WARNING_DAYS = 5;
export const PROVISION_CRITICAL_DAYS = 2;

export type SettlementProvisioning = {
  foodConsumers: number;
  heatedResidents: number;
  armedGuards: number;
  foodStock: number;
  firewoodStock: number;
  householdFoodPerDay: number;
  guardFoodPerDay: number;
  totalFoodPerDay: number;
  foodSpoilagePerDay: number;
  foodSpoilageFractionPerDay: number;
  protectedFoodShare: number;
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
};

export type ProvisionLevel = 'none' | 'ready' | 'watch' | 'critical';

export function computeSettlementProvisioning(input: {
  state: GameState;
  totals: ResourceTotals;
  currentFirewoodDemandMultiplier: number;
  freshFoodSpoilageFractionPerDay: number;
  sabbathConsumptionPaused: boolean;
}): SettlementProvisioning {
  const {
    state,
    totals,
    currentFirewoodDemandMultiplier,
    freshFoodSpoilageFractionPerDay,
    sabbathConsumptionPaused,
  } = input;

  let foodConsumers = 0;
  let heatedResidents = 0;
  for (const residence of state.residences.values()) {
    if (residence.abandoned || residence.population <= 0) continue;
    foodConsumers += residence.population;
    if (residence.tier >= 2) {
      heatedResidents += residence.population;
    }
  }

  let armedGuards = 0;
  for (const building of state.buildings.values()) {
    if (
      building.kind !== 'guardhouse'
      || building.constructionComplete === false
      || building.assignedLabor <= 0
    ) {
      continue;
    }
    armedGuards += Math.min(
      building.assignedLabor,
      Math.floor(Math.max(0, building.polearms ?? 0)),
    );
  }

  const workdayFraction = Math.max(
    0,
    (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR) / CALENDAR_HOURS_PER_DAY,
  );
  const sabbathFraction = sabbathConsumptionPaused ? 6 / 7 : 1;
  const householdFoodPerDay = foodConsumers
    * RESIDENCE_FOOD_PER_PERSON_PER_SEC
    * CALENDAR_SECONDS_PER_DAY
    * workdayFraction
    * sabbathFraction;
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
    armedGuards,
    foodStock: totals.food,
    firewoodStock: totals.firewood,
    householdFoodPerDay,
    guardFoodPerDay,
    totalFoodPerDay,
    foodSpoilagePerDay: foodPreservation.spoilagePerDay,
    foodSpoilageFractionPerDay: foodPreservation.spoilageFractionPerDay,
    protectedFoodShare: foodPreservation.protectedShare,
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
  };
}

export function settlementProvisionLevel(
  provisioning: SettlementProvisioning,
  month: number,
): ProvisionLevel {
  const hasDemand = provisioning.foodConsumers > 0
    || provisioning.heatedResidents > 0
    || provisioning.armedGuards > 0;
  if (!hasDemand) return 'none';

  const winterRelevant = month >= 9 || month <= 2;
  if (
    provisioning.foodRunwayDays < PROVISION_CRITICAL_DAYS
    || provisioning.guardWageRunwayDays < PROVISION_CRITICAL_DAYS
    || (winterRelevant && provisioning.winterFirewoodRunwayDays < PROVISION_CRITICAL_DAYS)
  ) {
    return 'critical';
  }
  if (
    provisioning.foodRunwayDays < PROVISION_WARNING_DAYS
    || provisioning.guardWageRunwayDays < PROVISION_WARNING_DAYS
    || (winterRelevant && provisioning.winterFirewoodRunwayDays < WINTER_RESERVE_DAYS)
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

function runwayDays(stock: number, demandPerDay: number): number {
  if (demandPerDay <= 1e-9) return Number.POSITIVE_INFINITY;
  return Math.max(0, stock) / demandPerDay;
}
