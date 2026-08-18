import {
  CALENDAR_SECONDS_PER_DAY,
  CHARCOAL_HOUSEHOLD_FUEL_VALUE,
  MARKETPLACE_FUEL_RESERVE_DAYS,
  RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC,
  SMITHY_CHARCOAL_PER_CYCLE,
  SMITHY_CHARCOAL_REORDER_CYCLES,
  SMITHY_CHARCOAL_TARGET_CYCLES,
} from '../generated/gameBalance.ts';

export function combinedFuelEquivalent(firewood: number, charcoal: number): number {
  return Math.max(0, firewood) + Math.max(0, charcoal) * CHARCOAL_HOUSEHOLD_FUEL_VALUE;
}

export function householdFuelDemandPerDay(
  population: number,
  seasonalMultiplier: number,
): number {
  return Math.max(0, population)
    * RESIDENCE_FIREWOOD_PER_PERSON_PER_SEC
    * CALENDAR_SECONDS_PER_DAY
    * Math.max(0, seasonalMultiplier);
}

export function marketplaceFuelReserveTarget(
  coveredPopulation: number,
  seasonalMultiplier: number,
  firewoodCapacity: number,
  charcoalCapacity: number,
): number {
  const target = householdFuelDemandPerDay(coveredPopulation, seasonalMultiplier)
    * MARKETPLACE_FUEL_RESERVE_DAYS;
  return Math.max(
    0,
    Math.min(target, combinedFuelEquivalent(firewoodCapacity, charcoalCapacity)),
  );
}

export function fuelRunwayDays(fuelEquivalent: number, dailyDemand: number): number {
  return dailyDemand <= 1e-9 ? Infinity : Math.max(0, fuelEquivalent) / dailyDemand;
}

export function smithyCharcoalRefillTarget(stock: number): number | null {
  const reorder = SMITHY_CHARCOAL_PER_CYCLE * SMITHY_CHARCOAL_REORDER_CYCLES;
  return Math.max(0, stock) + 1e-9 < reorder
    ? SMITHY_CHARCOAL_PER_CYCLE * SMITHY_CHARCOAL_TARGET_CYCLES
    : null;
}
