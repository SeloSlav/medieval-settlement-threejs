import {
  CHARCOAL_HOUSEHOLD_FUEL_VALUE,
  MARKETPLACE_FUEL_RESERVE_DAYS,
  SMITHY_CHARCOAL_PER_CYCLE,
  SMITHY_CHARCOAL_REORDER_CYCLES,
  SMITHY_CHARCOAL_TARGET_CYCLES,
} from '../generated/gameBalance.ts';
import { householdFirewoodUnitsPerDay } from './householdBillDemand.ts';

export function combinedFuelEquivalent(firewood: number, charcoal: number): number {
  return Math.max(0, firewood) + Math.max(0, charcoal) * CHARCOAL_HOUSEHOLD_FUEL_VALUE;
}

export function householdFuelDemandPerDay(
  householdCount: number,
  seasonalMultiplier: number,
): number {
  const households = Number.isFinite(householdCount)
    ? Math.max(0, Math.floor(householdCount))
    : 0;
  return households * householdFirewoodUnitsPerDay(seasonalMultiplier);
}

export function marketplaceFuelReserveTarget(
  coveredHouseholds: number,
  seasonalMultiplier: number,
  firewoodCapacity: number,
  charcoalCapacity: number,
): number {
  const fractionalTarget = householdFuelDemandPerDay(coveredHouseholds, seasonalMultiplier)
    * MARKETPLACE_FUEL_RESERVE_DAYS;
  const target = fractionalTarget <= 0 || !Number.isFinite(fractionalTarget)
    ? 0
    : Math.ceil(fractionalTarget - 1e-6);
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
