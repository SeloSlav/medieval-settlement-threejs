const RESOURCE_UNIT_EPSILON = 1e-6;

/**
 * Resource inventories are presented and reasoned about as indivisible units.
 *
 * The simulation server still uses floating-point work rates internally so a
 * well, crop, or household can make gradual progress toward its next unit.
 * This boundary turns that hidden progress into the whole-unit inventory the
 * rest of the client is allowed to observe.
 */
export function wholeResourceUnits(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value + RESOURCE_UNIT_EPSILON));
}

export function formatResourceUnits(value: number | null | undefined): string {
  return wholeResourceUnits(value).toLocaleString();
}

export function isWholeResourceUnits(value: number): boolean {
  return Number.isFinite(value)
    && value >= 0
    && Math.abs(value - Math.round(value)) <= RESOURCE_UNIT_EPSILON;
}
