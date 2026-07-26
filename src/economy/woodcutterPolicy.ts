export const WOODCUTTER_TIMBER_RESERVE_MIN = 0;
export const WOODCUTTER_TIMBER_RESERVE_MAX = 240;

export const WOODCUTTER_TIMBER_RESERVE_PRESETS = [
  { reserve: 0, label: 'Burn freely' },
  { reserve: 40, label: 'Cottage plan' },
  { reserve: 100, label: 'Workshop plan' },
  { reserve: 200, label: 'Civic plan' },
] as const;

const STOCK_EPSILON = 1e-6;

export function normalizeWoodcutterTimberReserve(reserve: number): number {
  if (!Number.isFinite(reserve)) return WOODCUTTER_TIMBER_RESERVE_MIN;
  return Math.max(
    WOODCUTTER_TIMBER_RESERVE_MIN,
    Math.min(WOODCUTTER_TIMBER_RESERVE_MAX, Math.round(reserve)),
  );
}

export function woodcutterCanProcess(
  availableUnreservedTimber: number,
  timberReserve: number,
  timberNeeded: number,
): boolean {
  if (!Number.isFinite(availableUnreservedTimber) || !Number.isFinite(timberNeeded)) {
    return false;
  }
  return availableUnreservedTimber + STOCK_EPSILON
    >= normalizeWoodcutterTimberReserve(timberReserve) + Math.max(0, timberNeeded);
}

export function timberAboveWoodcutterReserve(
  availableUnreservedTimber: number,
  timberReserve: number,
): number {
  return Math.max(
    0,
    availableUnreservedTimber - normalizeWoodcutterTimberReserve(timberReserve),
  );
}
