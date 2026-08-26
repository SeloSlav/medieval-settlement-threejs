export const DEVOTIONAL_CANDLE_CONTRACT_UNITS = 4;
export const DEVOTIONAL_CANDLE_CONTRACT_GOLD = 5;

export const CHAPEL_CANDLE_CAPACITY = 8;
export const CHAPEL_CANDLE_REORDER_POINT = 4;
export const CHAPEL_CANDLE_TARGET = 8;
export const CHAPEL_CANDLE_COFFER_RESERVE_GOLD = 120;
export const CHAPEL_LITURGY_ATTENDANCE_BONUS = 0.05;

export const MONASTERY_CANDLE_CAPACITY = 16;
export const MONASTERY_CANDLE_REORDER_POINT = 8;
export const MONASTERY_CANDLE_TARGET = 12;
export const MONASTERY_CANDLE_PURSE_RESERVE_GOLD = 40;
export const MONASTERY_CANDLE_USE_INTERVAL_DAYS = 3;
export const MONASTERY_LITURGY_PRESTIGE_MULTIPLIER = 1.1;

export type DevotionalInstitutionKind = 'chapel' | 'monastery';

export function devotionalCandleCapacity(kind: DevotionalInstitutionKind): number {
  return kind === 'chapel' ? CHAPEL_CANDLE_CAPACITY : MONASTERY_CANDLE_CAPACITY;
}

export function devotionalCandleTarget(kind: DevotionalInstitutionKind): {
  reorderPoint: number;
  target: number;
} {
  return kind === 'chapel'
    ? { reorderPoint: CHAPEL_CANDLE_REORDER_POINT, target: CHAPEL_CANDLE_TARGET }
    : { reorderPoint: MONASTERY_CANDLE_REORDER_POINT, target: MONASTERY_CANDLE_TARGET };
}

export function devotionalCandlesSupplied(candleStock: number | null | undefined): boolean {
  return typeof candleStock === 'number' && Number.isFinite(candleStock) && candleStock >= 1;
}

export function monasteryLiturgyPrestigeMultiplier(
  candleStock: number | null | undefined,
): number {
  return devotionalCandlesSupplied(candleStock)
    ? MONASTERY_LITURGY_PRESTIGE_MULTIPLIER
    : 1;
}

export function devotionalCandleContractLabel(kind: DevotionalInstitutionKind): string {
  const reserve = kind === 'chapel'
    ? CHAPEL_CANDLE_COFFER_RESERVE_GOLD
    : MONASTERY_CANDLE_PURSE_RESERVE_GOLD;
  return `${DEVOTIONAL_CANDLE_CONTRACT_UNITS} candles for ${DEVOTIONAL_CANDLE_CONTRACT_GOLD} gold · preserves ${reserve} gold reserve`;
}
