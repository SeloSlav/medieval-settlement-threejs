import type { BuildingKind } from '../resources/types.ts';

/**
 * Oats remain ordinary edible grain in general storage and at Marketplaces.
 * Once staged at a livestock holding, they have crossed the settlement's
 * food-versus-fodder boundary and belong to the herd's local feed reserve.
 */
export function livestockHoldingProtectsFeedOats(sourceKind: BuildingKind): boolean {
  return sourceKind === 'pastoral_farmstead' || sourceKind === 'swineherd';
}

export function institutionalDispatchableFoodStock(
  sourceKind: BuildingKind,
  edibleStock: number,
  oatGrain: number,
): number {
  const availableStock = Math.max(0, edibleStock);
  if (!livestockHoldingProtectsFeedOats(sourceKind)) return availableStock;
  return Math.max(0, availableStock - Math.max(0, oatGrain));
}
