export const MIN_VISIBLE_BERRY_CLUMPS = 4;

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
  return visibilityNoise < stockRatio;
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
