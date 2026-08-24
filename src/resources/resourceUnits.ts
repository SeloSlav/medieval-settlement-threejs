const RESOURCE_UNIT_EPSILON = 1e-6;

/**
 * Resource inventories are presented and reasoned about as indivisible units.
 *
 * Continuous production or consumption progress belongs in dedicated progress
 * fields. This boundary prevents legacy or malformed replicated inventory
 * values from leaking fractional or negative units into client state.
 */
export function wholeResourceUnits(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value + RESOURCE_UNIT_EPSILON));
}

/**
 * Historical deltas may be signed, but each side of the ledger still consists
 * of indivisible resource units.
 */
export function wholeSignedResourceUnits(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  const magnitude = wholeResourceUnits(Math.abs(value));
  return magnitude === 0 ? 0 : Math.sign(value) * magnitude;
}

export function formatResourceUnits(value: number | null | undefined): string {
  return wholeResourceUnits(value).toLocaleString();
}

export function isWholeResourceUnits(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
