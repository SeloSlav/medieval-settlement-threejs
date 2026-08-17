export const MIN_VISIBLE_BERRY_CLUMPS = 4;
export const ORDINARY_BERRY_CLUMPS = 16;
export const RICH_BERRY_CLUMPS = 24;
export const MAX_RASPBERRIES_PER_CLUMP = 5;

export function berryClumpTargetCount(isRich: boolean): number {
  return isRich ? RICH_BERRY_CLUMPS : ORDINARY_BERRY_CLUMPS;
}

/** Fruit depletes continuously even while the persistent woody canes remain. */
export function isBerryFruitVisible(
  remaining: number,
  maxYield: number,
  seasonAvailable: boolean,
  visibilityNoise: number,
): boolean {
  if (!seasonAvailable || remaining <= 0 || maxYield <= 0) return false;
  const stockRatio = Math.max(0, Math.min(1, remaining / maxYield));
  return visibilityNoise < Math.sqrt(stockRatio);
}

/** Keeps the woody patch legible while fruiting density follows season and stock. */
export function isBerryClumpVisible(
  clumpIndex: number,
  remaining: number,
  maxYield: number,
  seasonAvailable: boolean,
  visibilityNoise: number,
): boolean {
  if (clumpIndex < MIN_VISIBLE_BERRY_CLUMPS) return true;
  if (!seasonAvailable || maxYield <= 0) return false;
  const stockRatio = Math.max(0, Math.min(1, remaining / maxYield));
  // Canes recede more slowly than fruit. Applying sqrt here and to fruit
  // visibility makes the combined visible-fruit density track stock roughly
  // linearly while leaving a small persistent woody patch at zero.
  return visibilityNoise < Math.sqrt(stockRatio);
}

/** Reapplies a startup-local clump offset around the authoritative node center. */
export function resolveBerryClumpPosition(
  startupCenterX: number,
  startupCenterZ: number,
  startupX: number,
  startupZ: number,
  authoritativeCenterX: number,
  authoritativeCenterZ: number,
): { x: number; z: number } {
  return {
    x: authoritativeCenterX + startupX - startupCenterX,
    z: authoritativeCenterZ + startupZ - startupCenterZ,
  };
}
