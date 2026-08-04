import { WORKFORCE_ROAD_SPEED_MULTIPLIER } from '../generated/gameBalance.ts';

/**
 * Roads reward agents for using the network without making intentional
 * off-road work (forestry, foraging, fields) unnaturally fast.
 */
export const PEDESTRIAN_ROAD_SPEED_MULTIPLIER = WORKFORCE_ROAD_SPEED_MULTIPLIER;
export const DELIVERY_ROAD_SPEED_MULTIPLIER = 1.35;

export function surfaceAdjustedTravelSpeed(
  baseSpeed: number,
  onRoadSurface: boolean,
  roadMultiplier: number,
): number {
  return baseSpeed * (onRoadSurface ? roadMultiplier : 1);
}
