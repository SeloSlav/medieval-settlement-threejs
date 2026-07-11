import type { QuarryKind } from '../quarries/QuarryLayout.ts';
import type { ResourceKind } from './types.ts';

/** World stone budget — finite until late-game markets. Tuned with harvest rate in server constants. */
const LARGE_QUARRY_YIELD = 1500;
const SMALL_QUARRY_YIELD = 650;

export function quarryMaxYield(kind: QuarryKind): number {
  switch (kind) {
    case 'large':
      return LARGE_QUARRY_YIELD;
    case 'small':
      return SMALL_QUARRY_YIELD;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export function quarryPickRadius(radiusX: number, radiusZ: number): number {
  return Math.max(radiusX, radiusZ) * 0.88;
}

export function formatResourceAmount(kind: ResourceKind, amount: number): string {
  switch (kind) {
    case 'stone':
      return `${Math.round(amount)} stone`;
    case 'timber':
      return `${Math.round(amount)} timber`;
    case 'firewood':
      return `${Math.round(amount)} firewood`;
    case 'water':
      return amount > 0 ? 'Fresh water access' : 'No water stored';
    case 'game':
      return `${Math.round(amount)} game`;
    case 'berries':
      return `${Math.round(amount)} berries`;
    case 'food':
      return `${Math.round(amount)} food`;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
