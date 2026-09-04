/** Game stock is an authoritative whole-animal count. */
export const GAME_PATCH_MAX_YIELD = 12;
/** The second, larger habitat supports a visibly broader herd. */
export const RICH_GAME_PATCH_MAX_YIELD = 20;
/** Two berry patches share the old single-patch budget (2 × 60 = 120). */
export const BERRY_PATCH_MAX_YIELD = 60;
/** A mature thicket carries more fruit without changing its seasonal lifecycle. */
export const RICH_BERRY_PATCH_MAX_YIELD = 100;
/** Deep-forest mushroom beds are smaller but replenish during the growing season. */
export const MUSHROOM_PATCH_MAX_YIELD = 42;
/** A rich forest bed supports a denser, longer-lasting mushroom crop. */
export const RICH_MUSHROOM_PATCH_MAX_YIELD = 72;
/** Fish values are persistent population carrying capacities. */
export const FISH_SHOAL_MAX_YIELD = 120;
export const RICH_FISH_SHOAL_MAX_YIELD = 240;

/** Maximum representative actors submitted for a full ordinary/rich node. */
export const GAME_PATCH_VISUAL_CAPACITY = 12;
export const RICH_GAME_PATCH_VISUAL_CAPACITY = 15;
export const MUSHROOM_PATCH_VISUAL_CAPACITY = 26;
export const RICH_MUSHROOM_PATCH_VISUAL_CAPACITY = 30;
export const FISH_SHOAL_VISUAL_CAPACITY = 24;
export const RICH_FISH_SHOAL_VISUAL_CAPACITY = 28;

export const GAME_PATCH_PICK_RADIUS = 42;
export const RICH_GAME_PATCH_PICK_RADIUS = 60;
export const BERRY_PATCH_PICK_RADIUS = 28;
export const RICH_BERRY_PATCH_PICK_RADIUS = 34;
/** Base radius used to distribute visible raspberry clumps around a resource node. */
export const BERRY_PATCH_RADIUS = 9.6;
/** Furthest a clump can reach after the patch's slight axis variation. */
export const BERRY_PATCH_MAX_SPAWN_RADIUS = BERRY_PATCH_RADIUS * 1.08;
export const MUSHROOM_PATCH_PICK_RADIUS = 24;
export const RICH_MUSHROOM_PATCH_PICK_RADIUS = 30;
/** Furthest a visible mushroom can spawn from its deep-forest resource node. */
export const MUSHROOM_PATCH_MAX_SPAWN_RADIUS = 7.2;
export const FISH_SHOAL_PICK_RADIUS = 24;

export function gamePatchMaxYield(isRich = false): number {
  return isRich ? RICH_GAME_PATCH_MAX_YIELD : GAME_PATCH_MAX_YIELD;
}

export function berryPatchMaxYield(isRich = false): number {
  return isRich ? RICH_BERRY_PATCH_MAX_YIELD : BERRY_PATCH_MAX_YIELD;
}

export function mushroomPatchMaxYield(isRich = false): number {
  return isRich ? RICH_MUSHROOM_PATCH_MAX_YIELD : MUSHROOM_PATCH_MAX_YIELD;
}

export function gamePatchVisualCapacity(isRich = false): number {
  return isRich ? RICH_GAME_PATCH_VISUAL_CAPACITY : GAME_PATCH_VISUAL_CAPACITY;
}

export function mushroomPatchVisualCapacity(isRich = false): number {
  return isRich ? RICH_MUSHROOM_PATCH_VISUAL_CAPACITY : MUSHROOM_PATCH_VISUAL_CAPACITY;
}

export function fishShoalVisualCapacity(isRich = false): number {
  return isRich ? RICH_FISH_SHOAL_VISUAL_CAPACITY : FISH_SHOAL_VISUAL_CAPACITY;
}

/**
 * Maps authoritative stock to a representative actor count. The clamp keeps
 * very small populations literal, while the logarithmic curve increasingly
 * compresses larger populations and still reaches the authored visual cap.
 */
export function logarithmicPopulationVisualCount(
  remaining: number,
  maxYield: number,
  referenceMaxYield: number,
  referenceVisualCount: number,
): number {
  if (
    !Number.isFinite(remaining)
    || !Number.isFinite(maxYield)
    || !Number.isFinite(referenceMaxYield)
    || !Number.isFinite(referenceVisualCount)
  ) return 0;

  const wholeMaximum = Math.max(0, Math.floor(maxYield + 1e-6));
  const wholeRemaining = Math.min(
    wholeMaximum,
    Math.max(0, Math.floor(remaining + 1e-6)),
  );
  const wholeReferenceMaximum = Math.max(0, Math.floor(referenceMaxYield + 1e-6));
  const wholeReferenceVisualCount = Math.min(
    wholeReferenceMaximum,
    Math.max(0, Math.floor(referenceVisualCount + 1e-6)),
  );
  if (
    wholeRemaining === 0
    || wholeMaximum === 0
    || wholeReferenceMaximum === 0
    || wholeReferenceVisualCount === 0
  ) return 0;

  const scaled = Math.ceil(
    wholeReferenceVisualCount
      * Math.log1p(wholeRemaining)
      / Math.log1p(wholeReferenceMaximum),
  );
  return Math.min(wholeRemaining, Math.max(1, scaled));
}

export function isRichForagingCapacity(
  nodeKind: 'game' | 'berries' | 'mushrooms' | 'fish',
  maxYield: number,
): boolean {
  if (nodeKind === 'game') return maxYield > GAME_PATCH_MAX_YIELD;
  if (nodeKind === 'berries') return maxYield > BERRY_PATCH_MAX_YIELD;
  if (nodeKind === 'mushrooms') return maxYield > MUSHROOM_PATCH_MAX_YIELD;
  if (nodeKind === 'fish') return maxYield > FISH_SHOAL_MAX_YIELD;
  return false;
}

export function gamePatchSpawnRadius(isRich = false): number {
  return isRich ? 20 : 12;
}

/**
 * Game reproduction is continuous server-side, but a fraction is not yet a
 * visible animal. Both the resource HUD and deer visibility use this count.
 */
export function displayedGameAnimalCount(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.floor(amount + 1e-6));
}

export function foragingPickRadius(
  nodeKind: 'game' | 'berries' | 'mushrooms' | 'fish',
  isRich = false,
): number {
  if (nodeKind === 'game') {
    return isRich ? RICH_GAME_PATCH_PICK_RADIUS : GAME_PATCH_PICK_RADIUS;
  }
  if (nodeKind === 'mushrooms') {
    return isRich ? RICH_MUSHROOM_PATCH_PICK_RADIUS : MUSHROOM_PATCH_PICK_RADIUS;
  }
  if (nodeKind === 'fish') return FISH_SHOAL_PICK_RADIUS;
  return isRich ? RICH_BERRY_PATCH_PICK_RADIUS : BERRY_PATCH_PICK_RADIUS;
}
