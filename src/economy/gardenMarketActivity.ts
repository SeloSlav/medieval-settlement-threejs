import {
  FOOD_SALE_GOLD_PER_UNIT,
  HERB_REMEDY_SALE_GOLD_PER_UNIT,
} from '../generated/gameBalance.ts';

/**
 * Taxable activity backed by goods that can actually reach a market stall.
 * Remedy units are explicit because herb production first fills the household
 * medicine chest; only the overflow deposited at a Marketplace is a sale.
 */
export function gardenMarketActivity(
  foodUnitsSold: number,
  remedyUnitsSold = 0,
): number {
  return Math.max(0, foodUnitsSold) * FOOD_SALE_GOLD_PER_UNIT
    + Math.max(0, remedyUnitsSold) * HERB_REMEDY_SALE_GOLD_PER_UNIT;
}

export { SECONDS_PER_DAY } from '../world/gameCalendar.ts';
export { GAME_DAY_SECONDS } from '../world/gameCalendar.ts';
