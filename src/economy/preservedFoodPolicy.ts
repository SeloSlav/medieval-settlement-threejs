import { spoilageAdjustedRunwayDays } from './foodPreservation.ts';

export type PreservedMealAllocation = {
  freshUsed: number;
  preservedRotationUsed: number;
  preservedFallbackUsed: number;
  unmet: number;
};

/**
 * Client mirror of the authoritative household meal allocator.
 * Preserved provisions replace part of one meal, then cover any remaining
 * fresh-food gap; they never create a second calorie demand.
 */
export function allocatePreservedMeal(
  freshStock: number,
  preservedStock: number,
  mealDemand: number,
  rotationDemand: number,
  rotationEnabled: boolean,
): PreservedMealAllocation {
  const fresh = finiteNonnegative(freshStock);
  const preserved = finiteNonnegative(preservedStock);
  const demand = finiteNonnegative(mealDemand);
  const rotation = finiteNonnegative(rotationDemand);
  const preservedRotationUsed = rotationEnabled
    ? Math.min(preserved, rotation, demand)
    : 0;
  const afterRotation = Math.max(0, demand - preservedRotationUsed);
  const freshUsed = Math.min(fresh, afterRotation);
  const afterFresh = Math.max(0, afterRotation - freshUsed);
  const preservedFallbackUsed = Math.min(
    Math.max(0, preserved - preservedRotationUsed),
    afterFresh,
  );

  return {
    freshUsed,
    preservedRotationUsed,
    preservedFallbackUsed,
    unmet: Math.max(0, afterFresh - preservedFallbackUsed),
  };
}

/**
 * Time until the fresh store is exhausted while a finite preserved stock
 * displaces a bounded daily share. This keeps no-production runway forecasts
 * honest when the cured reserve runs out before the fresh store.
 */
export function freshFoodRunwayWithPreservedRotation(input: {
  freshStock: number;
  grossFoodDemandPerDay: number;
  preservedStock: number;
  preservedRotationPerDay: number;
  freshFoodSpoilageFractionPerDay?: number;
  preservedFoodSpoilageFractionPerDay?: number;
}): number {
  const freshStock = finiteNonnegative(input.freshStock);
  const grossDemand = finiteNonnegative(input.grossFoodDemandPerDay);
  const preservedStock = finiteNonnegative(input.preservedStock);
  const rotationPerDay = Math.min(
    finiteNonnegative(input.preservedRotationPerDay),
    grossDemand,
  );
  const spoilage = finiteNonnegative(
    input.freshFoodSpoilageFractionPerDay ?? 0,
  );
  const preservedSpoilage = finiteNonnegative(
    input.preservedFoodSpoilageFractionPerDay ?? 0,
  );
  if (grossDemand <= 1e-9) return Number.POSITIVE_INFINITY;
  if (freshStock <= 1e-9) return 0;
  if (rotationPerDay <= 1e-9 || preservedStock <= 1e-9) {
    return spoilageAdjustedRunwayDays(freshStock, grossDemand, spoilage);
  }

  const rotationDays = spoilageAdjustedRunwayDays(
    preservedStock,
    rotationPerDay,
    preservedSpoilage,
  );
  const freshDemandDuringRotation = Math.max(0, grossDemand - rotationPerDay);
  const firstPhaseRunway = freshDemandDuringRotation <= 1e-9
    ? Number.POSITIVE_INFINITY
    : spoilageAdjustedRunwayDays(
        freshStock,
        freshDemandDuringRotation,
        spoilage,
      );
  if (firstPhaseRunway <= rotationDays) return firstPhaseRunway;

  const remainingFresh = remainingStockAfterDays(
    freshStock,
    freshDemandDuringRotation,
    spoilage,
    rotationDays,
  );
  return rotationDays + spoilageAdjustedRunwayDays(
    remainingFresh,
    grossDemand,
    spoilage,
  );
}

function remainingStockAfterDays(
  stock: number,
  demandPerDay: number,
  spoilageFractionPerDay: number,
  days: number,
): number {
  const duration = finiteNonnegative(days);
  if (duration <= 1e-9) return finiteNonnegative(stock);
  const spoilage = finiteNonnegative(spoilageFractionPerDay);
  const demand = finiteNonnegative(demandPerDay);
  if (spoilage <= 1e-9) {
    return Math.max(0, finiteNonnegative(stock) - demand * duration);
  }
  const equilibriumOffset = demand / spoilage;
  return Math.max(
    0,
    (finiteNonnegative(stock) + equilibriumOffset)
      * Math.exp(-spoilage * duration)
      - equilibriumOffset,
  );
}

function finiteNonnegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
