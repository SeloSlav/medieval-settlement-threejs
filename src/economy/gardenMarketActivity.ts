import {
  FOOD_SALE_GOLD_PER_UNIT,
  HERB_REMEDY_SALE_GOLD_PER_UNIT,
} from '../generated/gameBalance.ts';

export type GardenMarketActivityDef = {
  foodPerPersonPerSec: number;
  foodSelfShare: number;
};

/**
 * Taxable activity backed by goods that can actually reach a market stall.
 * Remedy units are explicit because herb production first fills the household
 * medicine chest; only the overflow deposited at a Marketplace is a sale.
 */
export function gardenMarketActivity(
  def: GardenMarketActivityDef,
  population: number,
  seconds: number,
  remedyUnitsSold = 0,
): number {
  const pop = Math.max(0, population);
  let activity = 0;

  if (def.foodPerPersonPerSec > 0) {
    const totalFood = def.foodPerPersonPerSec * pop * seconds;
    const soldFood = totalFood * (1 - def.foodSelfShare);
    activity += soldFood * FOOD_SALE_GOLD_PER_UNIT;
  }

  activity += Math.max(0, remedyUnitsSold) * HERB_REMEDY_SALE_GOLD_PER_UNIT;

  return activity;
}

export { SECONDS_PER_DAY } from '../world/gameCalendar.ts';
export { GAME_DAY_SECONDS } from '../world/gameCalendar.ts';
