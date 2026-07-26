import {
  BUILDING_STORAGE_CAPS,
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
import { granaryFreshFoodTarget } from './granaryPolicy.ts';

export type FreshFoodLossSite = {
  source: 'treasury' | 'building' | 'residence';
  id: string | null;
  buildingKind: BuildingKind | null;
  stock: number;
  storageFactor: number;
  spoilagePerDay: number;
};

export type GranaryFreshFoodNetwork = {
  completedGranaries: number;
  collectingGranaries: number;
  staffedCollectingGranaries: number;
  targetStock: number;
  stockTowardTarget: number;
  targetShortfall: number;
  stockAboveTarget: number;
};

export type FreshFoodPreservation = {
  totalStock: number;
  protectedStock: number;
  exposedStock: number;
  protectedShare: number;
  effectiveStorageFactor: number;
  spoilageFractionPerDay: number;
  spoilagePerDay: number;
  largestLossSite: FreshFoodLossSite | null;
  granaryNetwork: GranaryFreshFoodNetwork;
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
  const ambientRate = Number.isFinite(ambientSpoilageFractionPerDay)
    ? Math.max(0, ambientSpoilageFractionPerDay)
    : 0;
  const treasuryStock = finiteStock(state.stockpile.food);
  let totalStock = treasuryStock;
  let weightedStock = totalStock * FRESH_FOOD_STORAGE_TREASURY_FACTOR;
  let protectedStock = 0;
  let largestLossSite: FreshFoodLossSite | null = null;
  const granaryNetwork: GranaryFreshFoodNetwork = {
    completedGranaries: 0,
    collectingGranaries: 0,
    staffedCollectingGranaries: 0,
    targetStock: 0,
    stockTowardTarget: 0,
    targetShortfall: 0,
    stockAboveTarget: 0,
  };

  largestLossSite = largerLossSite(largestLossSite, {
    source: 'treasury',
    id: null,
    buildingKind: null,
    stock: treasuryStock,
    storageFactor: FRESH_FOOD_STORAGE_TREASURY_FACTOR,
    spoilagePerDay: treasuryStock * FRESH_FOOD_STORAGE_TREASURY_FACTOR * ambientRate,
  });

  for (const building of state.buildings.values()) {
    const stock = finiteStock(building.food);
    if (building.kind === 'granary' && building.constructionComplete !== false) {
      granaryNetwork.completedGranaries += 1;
      if (building.granaryAcceptsFreshFood !== false) {
        granaryNetwork.collectingGranaries += 1;
        if (building.assignedLabor > 0) {
          granaryNetwork.staffedCollectingGranaries += 1;
        }
        const target = granaryFreshFoodTarget(
          BUILDING_STORAGE_CAPS.granary.food ?? 0,
          building.granaryFreshFoodTargetPercent,
        );
        granaryNetwork.targetStock += target;
        granaryNetwork.stockTowardTarget += Math.min(stock, target);
        granaryNetwork.targetShortfall += Math.max(0, target - stock);
        granaryNetwork.stockAboveTarget += Math.max(0, stock - target);
      }
    }
    if (stock <= 0) continue;
    const factor = buildingFreshFoodStorageFactor(building.kind);
    totalStock += stock;
    weightedStock += stock * factor;
    largestLossSite = largerLossSite(largestLossSite, {
      source: 'building',
      id: building.id,
      buildingKind: building.kind,
      stock,
      storageFactor: factor,
      spoilagePerDay: stock * factor * ambientRate,
    });
    if (factor < FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR) {
      protectedStock += stock;
    }
  }

  for (const residence of state.residences.values()) {
    const stock = finiteStock(getNeedStock(residence.needs, 'food'));
    totalStock += stock;
    weightedStock += stock * FRESH_FOOD_STORAGE_RESIDENCE_FACTOR;
    largestLossSite = largerLossSite(largestLossSite, {
      source: 'residence',
      id: residence.id,
      buildingKind: null,
      stock,
      storageFactor: FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
      spoilagePerDay: stock * FRESH_FOOD_STORAGE_RESIDENCE_FACTOR * ambientRate,
    });
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
    largestLossSite,
    granaryNetwork,
  };
}

function finiteStock(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function largerLossSite(
  current: FreshFoodLossSite | null,
  candidate: FreshFoodLossSite,
): FreshFoodLossSite | null {
  if (candidate.spoilagePerDay <= 1e-9) return current;
  if (current === null || candidate.spoilagePerDay > current.spoilagePerDay + 1e-9) {
    return candidate;
  }
  return current;
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
