import type { BuildingKind } from '../resources/types.ts';

/**
 * Oats remain ordinary edible grain in general storage and at Marketplaces.
 * Once staged at a livestock holding with live animals, they have crossed the
 * settlement's food-versus-fodder boundary and belong to the herd's local feed
 * reserve. Empty holdings release their oats back to ordinary food logistics.
 */
export function livestockHoldingProtectsFeedOats(
  sourceKind: BuildingKind,
  hasFeedCommitment: boolean,
): boolean {
  return hasFeedCommitment
    && (sourceKind === 'pastoral_farmstead' || sourceKind === 'swineherd');
}

export function institutionalDispatchableFoodStock(
  sourceKind: BuildingKind,
  edibleStock: number,
  oatGrain: number,
  hasFeedCommitment: boolean,
): number {
  const availableStock = Math.max(0, edibleStock);
  if (!livestockHoldingProtectsFeedOats(sourceKind, hasFeedCommitment)) return availableStock;
  return Math.max(0, availableStock - Math.max(0, oatGrain));
}
