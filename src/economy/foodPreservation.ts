import {
  FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
  FRESH_FOOD_STORAGE_GRANARY_FACTOR,
  FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR,
  FRESH_FOOD_STORAGE_MONASTERY_FACTOR,
  FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
  FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
  FRESH_FOOD_STORAGE_TREASURY_FACTOR,
} from '../generated/gameBalance.ts';
import { getNeedStock } from '../residences/residenceNeedState.ts';
import type { BuildingKind, GameState } from '../resources/types.ts';

export type FreshFoodPreservation = {
  totalStock: number;
  protectedStock: number;
  exposedStock: number;
  protectedShare: number;
  effectiveStorageFactor: number;
  spoilageFractionPerDay: number;
  spoilagePerDay: number;
};

export function buildingFreshFoodStorageFactor(kind: BuildingKind): number {
  switch (kind) {
    case 'granary':
      return FRESH_FOOD_STORAGE_GRANARY_FACTOR;
    case 'smokehouse':
      return FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR;
    case 'monastery':
      return FRESH_FOOD_STORAGE_MONASTERY_FACTOR;
    case 'marketplace':
      return FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR;
    default:
      return FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR;
  }
}

export function analyzeFreshFoodPreservation(
  state: GameState,
  ambientSpoilageFractionPerDay: number,
): FreshFoodPreservation {
  const ambientRate = Math.max(0, ambientSpoilageFractionPerDay);
  let totalStock = Math.max(0, state.stockpile.food);
  let weightedStock = totalStock * FRESH_FOOD_STORAGE_TREASURY_FACTOR;
  let protectedStock = 0;

  for (const building of state.buildings.values()) {
    const stock = Math.max(0, building.food);
    if (stock <= 0) continue;
    const factor = buildingFreshFoodStorageFactor(building.kind);
    totalStock += stock;
    weightedStock += stock * factor;
    if (factor < FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR) {
      protectedStock += stock;
    }
  }

  for (const residence of state.residences.values()) {
    const stock = Math.max(0, getNeedStock(residence.needs, 'food'));
    totalStock += stock;
    weightedStock += stock * FRESH_FOOD_STORAGE_RESIDENCE_FACTOR;
  }

  const effectiveStorageFactor = totalStock > 1e-9 ? weightedStock / totalStock : 0;
  return {
    totalStock,
    protectedStock,
    exposedStock: Math.max(0, totalStock - protectedStock),
    protectedShare: totalStock > 1e-9 ? protectedStock / totalStock : 0,
    effectiveStorageFactor,
    spoilageFractionPerDay: ambientRate * effectiveStorageFactor,
    spoilagePerDay: ambientRate * weightedStock,
  };
}

/**
 * Runway for a stock exposed to proportional spoilage and constant demand.
 * The approximation assumes today's storage mix remains stable and intentionally
 * ignores production, trade, and future transfers.
 */
export function spoilageAdjustedRunwayDays(
  stock: number,
  demandPerDay: number,
  spoilageFractionPerDay: number,
): number {
  const available = Math.max(0, stock);
  const demand = Math.max(0, demandPerDay);
  const spoilage = Math.max(0, spoilageFractionPerDay);
  if (available <= 1e-9) return demand > 1e-9 ? 0 : Number.POSITIVE_INFINITY;
  if (demand <= 1e-9) return Number.POSITIVE_INFINITY;
  if (spoilage <= 1e-9) return available / demand;
  return Math.log1p(spoilage * available / demand) / spoilage;
}

export function formatFreshFoodLoss(amountPerDay: number): string {
  if (amountPerDay <= 1e-9) return 'none';
  if (amountPerDay < 0.05) return '<0.1 food / day';
  if (amountPerDay < 10) return `${amountPerDay.toFixed(1)} food / day`;
  return `${Math.round(amountPerDay)} food / day`;
}
