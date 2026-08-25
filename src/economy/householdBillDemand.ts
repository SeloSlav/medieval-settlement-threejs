import {
  CALENDAR_DAYS_PER_MONTH,
  RESIDENCE_FIREWOOD_UNITS_PER_MONTH,
  RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH,
} from '../generated/gameBalance.ts';
import { wholeResourceUnits } from '../resources/resourceUnits.ts';
import type { ResidenceState } from '../resources/types.ts';

export type ResidenceTier = ResidenceState['tier'];

/** Client mirror of server/src/food_demand_policy.rs. */
export function residenceFoodRequirementSlots(tier: ResidenceTier): number {
  switch (tier) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
      return 4;
    case 4:
      return 5;
  }
}

/** Whole food units charged to one household at the monthly bill. */
export function householdFoodUnitsPerMonth(foodRequirementSlots: number): number {
  return wholeResourceUnits(foodRequirementSlots)
    * wholeResourceUnits(RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH);
}

/** Whole food units charged to one household at the monthly bill. */
export function householdFoodUnitsPerMonthForTier(tier: ResidenceTier): number {
  return householdFoodUnitsPerMonth(residenceFoodRequirementSlots(tier));
}

/** Average daily runway demand derived from the discrete monthly food bill. */
export function householdFoodUnitsPerDay(foodRequirementSlots: number): number {
  return householdFoodUnitsPerMonth(foodRequirementSlots) / calendarDaysPerMonth();
}

/** Average daily runway demand derived from the residence tier's food bill. */
export function householdFoodUnitsPerDayForTier(tier: ResidenceTier): number {
  return householdFoodUnitsPerDay(residenceFoodRequirementSlots(tier));
}

/**
 * Monthly household-fuel demand used for forecasts. The persisted bill is one
 * whole unit; seasonality scales reserve planning, matching the server policy.
 */
export function householdFirewoodUnitsPerMonth(
  seasonalMultiplier = 1,
): number {
  return wholeResourceUnits(RESIDENCE_FIREWOOD_UNITS_PER_MONTH)
    * finiteNonnegative(seasonalMultiplier);
}

/** Average daily runway demand derived from the monthly household-fuel bill. */
export function householdFirewoodUnitsPerDay(
  seasonalMultiplier = 1,
): number {
  return householdFirewoodUnitsPerMonth(seasonalMultiplier)
    / calendarDaysPerMonth();
}

function calendarDaysPerMonth(): number {
  return Math.max(1, wholeResourceUnits(CALENDAR_DAYS_PER_MONTH));
}

function finiteNonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
