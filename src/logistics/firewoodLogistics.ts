import {
  CALENDAR_SECONDS_PER_DAY,
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FIREWOOD_PRIORITY_WINTER_DAYS,
  WINTER_FIREWOOD_DEMAND_MULTIPLIER,
} from '../generated/gameBalance.ts';
import { householdFirewoodUnitsPerDay } from '../economy/householdBillDemand.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import type { ResidenceState } from '../resources/types.ts';

export { GAME_DAY_SECONDS } from '../world/gameCalendar.ts';
import { GAME_DAY_SECONDS } from '../world/gameCalendar.ts';

export function residenceFirewoodDemandPerSecond(residence: ResidenceState): number {
  if (residence.abandoned || residence.population <= 0) return 0;
  return householdFirewoodUnitsPerDay() / CALENDAR_SECONDS_PER_DAY;
}

export function residenceFirewoodRunwaySeconds(residence: ResidenceState): number | null {
  const demand = residenceFirewoodDemandPerSecond(residence);
  if (demand <= 0) return null;
  return getNeedStock(residence.needs, 'firewood') / demand;
}

export function residenceFirewoodRunwayDays(residence: ResidenceState): number | null {
  const runwaySeconds = residenceFirewoodRunwaySeconds(residence);
  if (runwaySeconds == null) return null;
  return runwaySeconds / GAME_DAY_SECONDS;
}

export function residenceHasFirewoodRoom(firewoodStock: number): boolean {
  return firewoodStock + 1e-6 < RESIDENCE_FIREWOOD_CAPACITY;
}

/**
 * Population remains the public occupancy gate for existing callers, but an
 * occupied residence owes one household bill regardless of resident count.
 * Round the forecast floor up because pantry fuel is stored in whole units.
 */
export function residenceFirewoodPriorityTarget(population: number): number {
  if (population <= 0) return 0;
  const winterFloor = householdFirewoodUnitsPerDay(
    WINTER_FIREWOOD_DEMAND_MULTIPLIER,
  ) * RESIDENCE_FIREWOOD_PRIORITY_WINTER_DAYS;
  return Math.min(
    RESIDENCE_FIREWOOD_CAPACITY,
    winterFloor > 0 ? Math.ceil(winterFloor - 1e-6) : 0,
  );
}

export function residenceNeedsPriorityFirewood(residence: ResidenceState): boolean {
  if (residence.abandoned || residence.population <= 0) return false;
  return getNeedStock(residence.needs, 'firewood') + 1e-6
    < residenceFirewoodPriorityTarget(residence.population);
}

export function formatFirewoodRunwayDays(days: number): string {
  if (days >= 10) return `${Math.round(days)} days`;
  if (days >= 1) return `${days.toFixed(1)} days`;
  const runwaySeconds = days * GAME_DAY_SECONDS;
  if (runwaySeconds >= 3600) return `~${(runwaySeconds / 3600).toFixed(1)} h`;
  const minutes = runwaySeconds / 60;
  return `~${Math.max(1, Math.round(minutes))} min`;
}
