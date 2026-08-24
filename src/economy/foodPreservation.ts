import {
  BUILDING_STORAGE_CAPS,
  FRESH_FOOD_STORAGE_CART_FACTOR,
  FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
  FRESH_FOOD_STORAGE_GRANARY_FACTOR,
  FRESH_FOOD_STORAGE_MARKETPLACE_FACTOR,
  FRESH_FOOD_STORAGE_MONASTERY_FACTOR,
  FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
  FRESH_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
  FRESH_FOOD_STORAGE_TREASURY_FACTOR,
  PRESERVED_FOOD_SPOILAGE_PER_DAY,
  PRESERVED_FOOD_STORAGE_CART_FACTOR,
  PRESERVED_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR,
  PRESERVED_FOOD_STORAGE_GRANARY_FACTOR,
  PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR,
  PRESERVED_FOOD_STORAGE_MONASTERY_FACTOR,
  PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
  PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR,
  PRESERVED_FOOD_STORAGE_TREASURY_FACTOR,
} from '../generated/gameBalance.ts';
import type { BuildingKind, GameState } from '../resources/types.ts';
import {
  foodMealValue,
  foodSpoilageMultiplier,
  freshFoodMealEquivalents,
  freshFoodSpoilageExposure,
  isFreshFoodCargo,
  isPreservedFoodCargo,
  preservedFoodMealEquivalents,
  preservedFoodSpoilageExposure,
  type FoodInventoryKind,
} from './foodInventory.ts';
import { granaryFreshFoodTarget } from './granaryPolicy.ts';

export type FreshFoodLossSite = {
  source: 'treasury' | 'building' | 'residence' | 'trip';
  id: string | null;
  buildingKind: BuildingKind | null;
  stock: number;
  storageFactor: number;
  spoilagePerDay: number;
};

export type GranaryFreshFoodNetwork = {
  completedGranaries: number;
  fireDisabledGranaries: number;
  collectingGranaries: number;
  staffedCollectingGranaries: number;
  targetStock: number;
  stockTowardTarget: number;
  targetShortfall: number;
  stockAboveTarget: number;
};

export type FreshFoodPreservation = {
  totalStock: number;
  usableStock: number;
  quarantinedStock: number;
  transitStock: number;
  protectedStock: number;
  exposedStock: number;
  protectedShare: number;
  usableProtectedStock: number;
  usableProtectedShare: number;
  effectiveStorageFactor: number;
  usableEffectiveStorageFactor: number;
  spoilageFractionPerDay: number;
  usableSpoilageFractionPerDay: number;
  spoilagePerDay: number;
  quarantinedSpoilagePerDay: number;
  transitSpoilagePerDay: number;
  largestLossSite: FreshFoodLossSite | null;
  granaryNetwork: GranaryFreshFoodNetwork;
  preservedFood: PreservedFoodPreservation;
};

export type PreservedFoodPreservation = {
  totalStock: number;
  usableStock: number;
  quarantinedStock: number;
  transitStock: number;
  protectedStock: number;
  protectedShare: number;
  effectiveStorageFactor: number;
  usableEffectiveStorageFactor: number;
  spoilageFractionPerDay: number;
  usableSpoilageFractionPerDay: number;
  spoilagePerDay: number;
  quarantinedSpoilagePerDay: number;
  transitSpoilagePerDay: number;
  largestLossSite: FreshFoodLossSite | null;
};

export type FreshFoodPreservationOptions = {
  fireDisabledBuildingIds?: ReadonlySet<string>;
  fireDisabledResidenceIds?: ReadonlySet<string>;
  preservedFoodSpoilageFractionPerDay?: number;
};

export function buildingFreshFoodStorageFactor(kind: BuildingKind): number {
  switch (kind) {
    case 'founders_camp':
      return 0;
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

export function buildingPreservedFoodStorageFactor(kind: BuildingKind): number {
  switch (kind) {
    case 'founders_camp':
      return 0;
    case 'granary':
      return PRESERVED_FOOD_STORAGE_GRANARY_FACTOR;
    case 'smokehouse':
      return PRESERVED_FOOD_STORAGE_SMOKEHOUSE_FACTOR;
    case 'monastery':
      return PRESERVED_FOOD_STORAGE_MONASTERY_FACTOR;
    case 'marketplace':
      return PRESERVED_FOOD_STORAGE_MARKETPLACE_FACTOR;
    default:
      return PRESERVED_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR;
  }
}

export function analyzeFreshFoodPreservation(
  state: GameState,
  ambientSpoilageFractionPerDay: number,
  options: FreshFoodPreservationOptions = {},
): FreshFoodPreservation {
  const ambientRate = Number.isFinite(ambientSpoilageFractionPerDay)
    ? Math.max(0, ambientSpoilageFractionPerDay)
    : 0;
  const preservedRate = Number.isFinite(
    options.preservedFoodSpoilageFractionPerDay,
  )
    ? Math.max(0, options.preservedFoodSpoilageFractionPerDay ?? 0)
    : PRESERVED_FOOD_SPOILAGE_PER_DAY;
  const treasuryStock = state.physicalFoundingSiteEnabled === true
    ? 0
    : freshFoodMealEquivalents(state.stockpile);
  const treasuryExposure = state.physicalFoundingSiteEnabled === true
    ? 0
    : freshFoodSpoilageExposure(state.stockpile);
  let totalStock = treasuryStock;
  let weightedStock = treasuryExposure * FRESH_FOOD_STORAGE_TREASURY_FACTOR;
  let usableStock = treasuryStock;
  let usableWeightedStock = treasuryExposure * FRESH_FOOD_STORAGE_TREASURY_FACTOR;
  let quarantinedStock = 0;
  let quarantinedWeightedStock = 0;
  let transitStock = 0;
  let transitWeightedStock = 0;
  let protectedStock = 0;
  let usableProtectedStock = 0;
  let largestLossSite: FreshFoodLossSite | null = null;
  const treasuryPreservedStock = state.physicalFoundingSiteEnabled === true
    ? 0
    : preservedFoodMealEquivalents(state.stockpile);
  const treasuryPreservedExposure = state.physicalFoundingSiteEnabled === true
    ? 0
    : preservedFoodSpoilageExposure(state.stockpile);
  let preservedTotalStock = treasuryPreservedStock;
  let preservedWeightedStock =
    treasuryPreservedExposure * PRESERVED_FOOD_STORAGE_TREASURY_FACTOR;
  let preservedUsableStock = treasuryPreservedStock;
  let preservedUsableWeightedStock = preservedWeightedStock;
  let preservedQuarantinedStock = 0;
  let preservedQuarantinedWeightedStock = 0;
  let preservedTransitStock = 0;
  let preservedTransitWeightedStock = 0;
  let preservedProtectedStock = 0;
  let preservedLargestLossSite: FreshFoodLossSite | null = null;
  const granaryNetwork: GranaryFreshFoodNetwork = {
    completedGranaries: 0,
    fireDisabledGranaries: 0,
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
    spoilagePerDay: treasuryExposure * FRESH_FOOD_STORAGE_TREASURY_FACTOR * ambientRate,
  });
  preservedLargestLossSite = largerLossSite(preservedLargestLossSite, {
    source: 'treasury',
    id: null,
    buildingKind: null,
    stock: treasuryPreservedStock,
    storageFactor: PRESERVED_FOOD_STORAGE_TREASURY_FACTOR,
    spoilagePerDay:
      treasuryPreservedExposure
      * PRESERVED_FOOD_STORAGE_TREASURY_FACTOR
      * preservedRate,
  });

  for (const building of state.buildings.values()) {
    const stock = freshFoodMealEquivalents(building);
    const exposure = freshFoodSpoilageExposure(building);
    const preservedStock = preservedFoodMealEquivalents(building);
    const preservedExposure = preservedFoodSpoilageExposure(building);
    const fireDisabled = options.fireDisabledBuildingIds?.has(building.id) ?? false;
    if (building.kind === 'granary' && building.constructionComplete !== false) {
      granaryNetwork.completedGranaries += 1;
      if (fireDisabled) {
        granaryNetwork.fireDisabledGranaries += 1;
      } else if (building.granaryAcceptsFreshFood !== false) {
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
    if (preservedStock > 0) {
      const factor = buildingPreservedFoodStorageFactor(building.kind);
      preservedTotalStock += preservedStock;
      preservedWeightedStock += preservedExposure * factor;
      if (fireDisabled) {
        preservedQuarantinedStock += preservedStock;
        preservedQuarantinedWeightedStock += preservedExposure * factor;
      } else {
        preservedUsableStock += preservedStock;
        preservedUsableWeightedStock += preservedExposure * factor;
      }
      preservedLargestLossSite = largerLossSite(preservedLargestLossSite, {
        source: 'building',
        id: building.id,
        buildingKind: building.kind,
        stock: preservedStock,
        storageFactor: factor,
        spoilagePerDay:
          preservedExposure * factor * preservedRate,
      });
      if (factor < PRESERVED_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR) {
        preservedProtectedStock += preservedStock;
      }
    }
    if (stock <= 0) continue;
    const factor = buildingFreshFoodStorageFactor(building.kind);
    totalStock += stock;
    weightedStock += exposure * factor;
    if (fireDisabled) {
      quarantinedStock += stock;
      quarantinedWeightedStock += exposure * factor;
    } else {
      usableStock += stock;
      usableWeightedStock += exposure * factor;
    }
    largestLossSite = largerLossSite(largestLossSite, {
      source: 'building',
      id: building.id,
      buildingKind: building.kind,
      stock,
      storageFactor: factor,
      spoilagePerDay: exposure * factor * ambientRate,
    });
    if (factor < FRESH_FOOD_STORAGE_DEFAULT_BUILDING_FACTOR) {
      protectedStock += stock;
      if (!fireDisabled) usableProtectedStock += stock;
    }
  }

  for (const trip of state.deliveryTrips.values()) {
    const foundingTrip = state.buildings.get(trip.buildingId)?.kind === 'founders_camp';
    if (isPreservedFoodCargo(trip.cargoKind)) {
      const kind = trip.cargoKind as FoodInventoryKind;
      const stock = finiteStock(trip.amount) * foodMealValue(kind);
      const exposure = stock * foodSpoilageMultiplier(kind);
      if (stock <= 0) continue;
      const storageFactor = foundingTrip ? 0 : PRESERVED_FOOD_STORAGE_CART_FACTOR;
      preservedTotalStock += stock;
      preservedWeightedStock += exposure * storageFactor;
      preservedTransitStock += stock;
      preservedTransitWeightedStock += exposure * storageFactor;
      preservedLargestLossSite = largerLossSite(preservedLargestLossSite, {
        source: 'trip',
        id: trip.id,
        buildingKind: null,
        stock,
        storageFactor,
        spoilagePerDay:
          exposure * storageFactor * preservedRate,
      });
      if (foundingTrip) preservedProtectedStock += stock;
      continue;
    }
    if (!isFreshFoodCargo(trip.cargoKind)) continue;
    const kind = trip.cargoKind as FoodInventoryKind;
    const stock = finiteStock(trip.amount) * foodMealValue(kind);
    const exposure = stock * foodSpoilageMultiplier(kind);
    if (stock <= 0) continue;
    const storageFactor = foundingTrip ? 0 : FRESH_FOOD_STORAGE_CART_FACTOR;
    totalStock += stock;
    weightedStock += exposure * storageFactor;
    transitStock += stock;
    transitWeightedStock += exposure * storageFactor;
    largestLossSite = largerLossSite(largestLossSite, {
      source: 'trip',
      id: trip.id,
      buildingKind: null,
      stock,
      storageFactor,
      spoilagePerDay: exposure * storageFactor * ambientRate,
    });
    if (foundingTrip) {
      protectedStock += stock;
    }
  }

  for (const residence of state.residences.values()) {
    const stock = freshFoodMealEquivalents(residence);
    const exposure = freshFoodSpoilageExposure(residence);
    const preservedStock = preservedFoodMealEquivalents(residence);
    const preservedExposure = preservedFoodSpoilageExposure(residence);
    const fireDisabled = options.fireDisabledResidenceIds?.has(residence.id) ?? false;
    if (preservedStock > 0) {
      preservedTotalStock += preservedStock;
      preservedWeightedStock += preservedExposure * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR;
      if (fireDisabled) {
        preservedQuarantinedStock += preservedStock;
        preservedQuarantinedWeightedStock +=
          preservedExposure * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR;
      } else {
        preservedUsableStock += preservedStock;
        preservedUsableWeightedStock +=
          preservedExposure * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR;
        preservedLargestLossSite = largerLossSite(preservedLargestLossSite, {
          source: 'residence',
          id: residence.id,
          buildingKind: null,
          stock: preservedStock,
          storageFactor: PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
          spoilagePerDay:
            preservedExposure
            * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR
            * preservedRate,
        });
      }
    }
    totalStock += stock;
    if (fireDisabled) {
      quarantinedStock += stock;
    } else {
      weightedStock += exposure * FRESH_FOOD_STORAGE_RESIDENCE_FACTOR;
      usableStock += stock;
      usableWeightedStock += exposure * FRESH_FOOD_STORAGE_RESIDENCE_FACTOR;
      largestLossSite = largerLossSite(largestLossSite, {
        source: 'residence',
        id: residence.id,
        buildingKind: null,
        stock,
        storageFactor: FRESH_FOOD_STORAGE_RESIDENCE_FACTOR,
        spoilagePerDay: exposure * FRESH_FOOD_STORAGE_RESIDENCE_FACTOR * ambientRate,
      });
    }
  }

  const effectiveStorageFactor = totalStock > 1e-9 ? weightedStock / totalStock : 0;
  const usableEffectiveStorageFactor = usableStock > 1e-9
    ? usableWeightedStock / usableStock
    : 0;
  const preservedEffectiveStorageFactor = preservedTotalStock > 1e-9
    ? preservedWeightedStock / preservedTotalStock
    : 0;
  const preservedUsableEffectiveStorageFactor = preservedUsableStock > 1e-9
    ? preservedUsableWeightedStock / preservedUsableStock
    : 0;
  return {
    totalStock,
    usableStock,
    quarantinedStock,
    transitStock,
    protectedStock,
    exposedStock: Math.max(0, totalStock - protectedStock),
    protectedShare: totalStock > 1e-9 ? protectedStock / totalStock : 0,
    usableProtectedStock,
    usableProtectedShare: usableStock > 1e-9
      ? usableProtectedStock / usableStock
      : 0,
    effectiveStorageFactor,
    usableEffectiveStorageFactor,
    spoilageFractionPerDay: ambientRate * effectiveStorageFactor,
    usableSpoilageFractionPerDay: ambientRate * usableEffectiveStorageFactor,
    spoilagePerDay: ambientRate * weightedStock,
    quarantinedSpoilagePerDay: ambientRate * quarantinedWeightedStock,
    transitSpoilagePerDay: ambientRate * transitWeightedStock,
    largestLossSite,
    granaryNetwork,
    preservedFood: {
      totalStock: preservedTotalStock,
      usableStock: preservedUsableStock,
      quarantinedStock: preservedQuarantinedStock,
      transitStock: preservedTransitStock,
      protectedStock: preservedProtectedStock,
      protectedShare: preservedTotalStock > 1e-9
        ? preservedProtectedStock / preservedTotalStock
        : 0,
      effectiveStorageFactor: preservedEffectiveStorageFactor,
      usableEffectiveStorageFactor: preservedUsableEffectiveStorageFactor,
      spoilageFractionPerDay:
        preservedRate * preservedEffectiveStorageFactor,
      usableSpoilageFractionPerDay:
        preservedRate * preservedUsableEffectiveStorageFactor,
      spoilagePerDay:
        preservedRate * preservedWeightedStock,
      quarantinedSpoilagePerDay:
        preservedRate * preservedQuarantinedWeightedStock,
      transitSpoilagePerDay:
        preservedRate * preservedTransitWeightedStock,
      largestLossSite: preservedLargestLossSite,
    },
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

export function formatPreservedFoodLoss(amountPerDay: number): string {
  if (amountPerDay <= 1e-9) return 'none';
  if (amountPerDay < 0.05) return '<0.1 provisions / day';
  if (amountPerDay < 10) return `${amountPerDay.toFixed(1)} provisions / day`;
  return `${Math.round(amountPerDay)} provisions / day`;
}
