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
      return `${Math.round(amount)} raspberries`;
    case 'mushrooms':
      return `${Math.round(amount)} mushrooms`;
    case 'fish':
      return `${Math.round(amount)} fish`;
    case 'food':
      return `${Math.round(amount)} food`;
    case 'ryeBread':
      return `${Math.round(amount)} rye bread`;
    case 'maslinBread':
      return `${Math.round(amount)} maslin bread`;
    case 'meat':
      return `${Math.round(amount)} meat`;
    case 'milk':
      return `${Math.round(amount)} milk`;
    case 'apples':
      return `${Math.round(amount)} apples`;
    case 'pears':
      return `${Math.round(amount)} pears`;
    case 'cherries':
      return `${Math.round(amount)} cherries`;
    case 'aronia':
      return `${Math.round(amount)} aronia berries`;
    case 'rosehips':
      return `${Math.round(amount)} rosehips`;
    case 'vegetables':
      return `${Math.round(amount)} legacy mixed vegetables`;
    case 'cabbage':
      return `${Math.round(amount)} cabbage`;
    case 'carrots':
      return `${Math.round(amount)} carrots`;
    case 'beetroot':
      return `${Math.round(amount)} beetroot`;
    case 'eggs':
      return `${Math.round(amount)} eggs`;
    case 'grapes':
      return `${Math.round(amount)} grapes`;
    case 'ryeSheaves':
      return `${Math.round(amount)} rye sheaves`;
    case 'oatSheaves':
      return `${Math.round(amount)} oat sheaves`;
    case 'barleySheaves':
      return `${Math.round(amount)} barley sheaves`;
    case 'maslinSheaves':
      return `${Math.round(amount)} maslin sheaves`;
    case 'ryeGrain':
      return `${Math.round(amount)} rye grain`;
    case 'oatGrain':
      return `${Math.round(amount)} oats`;
    case 'animalFeed':
      return `${Math.round(amount)} animal feed`;
    case 'maslinGrain':
      return `${Math.round(amount)} maslin grain`;
    case 'barley':
      return `${Math.round(amount)} barley`;
    case 'malt':
      return `${Math.round(amount)} malt`;
    case 'ryeFlour':
      return `${Math.round(amount)} rye flour`;
    case 'maslinFlour':
      return `${Math.round(amount)} maslin flour`;
    case 'ale':
      return `${Math.round(amount)} ale`;
    case 'cider':
      return `${Math.round(amount)} apple cider`;
    case 'pearCider':
      return `${Math.round(amount)} pear cider`;
    case 'mead':
      return `${Math.round(amount)} mead`;
    case 'preservedFood':
      return `${Math.round(amount)} preserved staples`;
    case 'curedMeat':
      return `${Math.round(amount)} cured meat`;
    case 'smokedFish':
      return `${Math.round(amount)} smoked fish`;
    case 'cheese':
      return `${Math.round(amount)} cheese`;
    case 'aroniaJam':
      return `${Math.round(amount)} aronia jam`;
    case 'rosehipJam':
      return `${Math.round(amount)} rosehip jam`;
    case 'honey':
      return `${Math.round(amount)} honey`;
    case 'wax':
      return `${Math.round(amount)} beeswax`;
    case 'candles':
      return `${Math.round(amount)} candles`;
    case 'wine':
      return `${Math.round(amount)} wine`;
    case 'wool':
      return `${Math.round(amount)} wool`;
    case 'flax':
      return `${Math.round(amount)} flax fibre`;
    case 'yarn':
      return `${Math.round(amount)} yarn`;
    case 'linen':
      return `${Math.round(amount)} linen`;
    case 'cloth':
      return `${Math.round(amount)} clothing`;
    case 'pelts':
      return `${Math.round(amount)} pelts`;
    case 'hides':
      return `${Math.round(amount)} hides`;
    case 'leather':
      return `${Math.round(amount)} leather`;
    case 'shoes':
      return `${Math.round(amount)} shoes`;
    case 'ironwork':
      return `${Math.round(amount)} ironwork`;
    case 'polearms':
      return `${Math.round(amount)} polearms`;
    case 'iron':
      return `${Math.round(amount)} iron`;
    case 'clay':
      return `${Math.round(amount)} clay`;
    case 'salt':
      return `${Math.round(amount)} salt`;
    case 'charcoal':
      return `${Math.round(amount)} charcoal`;
    case 'pottery':
      return `${Math.round(amount)} pottery`;
    case 'manure':
      return `${Math.round(amount)} manure`;
    case 'remedies':
      return `${Math.round(amount)} remedies`;
    case 'roofTiles':
      return `${Math.round(amount)} roof tiles`;
    case 'gold':
      return `${Math.round(amount)} gold`;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}
