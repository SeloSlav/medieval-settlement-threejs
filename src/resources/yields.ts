import type { QuarryKind } from '../quarries/QuarryLayout.ts';
import {
  LARGE_QUARRY_MAX_YIELD,
  SMALL_QUARRY_MAX_YIELD,
} from '../generated/gameBalance.ts';
import { displayedGameAnimalCount } from '../foraging/foragingYields.ts';
import type { ResourceKind } from './types.ts';

/** World stone budget — finite until late-game markets. Tuned with harvest rate in server constants. */
export function quarryMaxYield(kind: QuarryKind): number {
  switch (kind) {
    case 'large':
      return LARGE_QUARRY_MAX_YIELD;
    case 'small':
      return SMALL_QUARRY_MAX_YIELD;
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
      return `${displayedGameAnimalCount(amount)} game`;
    case 'berries':
      return `${Math.round(amount)} berries`;
    case 'mushrooms':
      return `${Math.round(amount)} mushrooms`;
    case 'fish':
      return `${Math.round(amount)} fish`;
    case 'food':
      return `${Math.round(amount)} food`;
    case 'grain':
      return `${Math.round(amount)} grain`;
    case 'barley':
      return `${Math.round(amount)} barley`;
    case 'malt':
      return `${Math.round(amount)} malt`;
    case 'flour':
      return `${Math.round(amount)} flour`;
    case 'ale':
      return `${Math.round(amount)} ale`;
    case 'preservedFood':
      return `${Math.round(amount)} preserved food`;
    case 'honey':
      return `${Math.round(amount)} honey`;
    case 'wine':
      return `${Math.round(amount)} wine`;
    case 'wool':
      return `${Math.round(amount)} wool`;
    case 'cloth':
      return `${Math.round(amount)} cloth`;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
