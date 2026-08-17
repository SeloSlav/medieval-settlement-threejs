/** Game stock is an animal count so visible deer disappear one-for-one. */
export const GAME_PATCH_MAX_YIELD = 12;
/** The second, larger habitat supports a visibly broader herd. */
export const RICH_GAME_PATCH_MAX_YIELD = 20;
/** Two berry patches share the old single-patch budget (2 × 60 = 120). */
export const BERRY_PATCH_MAX_YIELD = 60;
/** A mature thicket carries more fruit without changing its seasonal lifecycle. */
export const RICH_BERRY_PATCH_MAX_YIELD = 100;
/** Deep-forest mushroom beds are smaller but replenish during the growing season. */
export const MUSHROOM_PATCH_MAX_YIELD = 42;
/** Fish values are persistent population carrying capacities. */
export const FISH_SHOAL_MAX_YIELD = 120;
export const RICH_FISH_SHOAL_MAX_YIELD = 240;

export const GAME_PATCH_PICK_RADIUS = 42;
export const RICH_GAME_PATCH_PICK_RADIUS = 60;
export const BERRY_PATCH_PICK_RADIUS = 28;
export const RICH_BERRY_PATCH_PICK_RADIUS = 34;
/** Base radius used to distribute visible raspberry clumps around a resource node. */
export const BERRY_PATCH_RADIUS = 9.6;
/** Furthest a clump can reach after the patch's slight axis variation. */
export const BERRY_PATCH_MAX_SPAWN_RADIUS = BERRY_PATCH_RADIUS * 1.08;
export const MUSHROOM_PATCH_PICK_RADIUS = 24;
export const FISH_SHOAL_PICK_RADIUS = 24;

export function gamePatchMaxYield(isRich = false): number {
  return isRich ? RICH_GAME_PATCH_MAX_YIELD : GAME_PATCH_MAX_YIELD;
}

export function berryPatchMaxYield(isRich = false): number {
  return isRich ? RICH_BERRY_PATCH_MAX_YIELD : BERRY_PATCH_MAX_YIELD;
}

export function isRichForagingCapacity(
  nodeKind: 'game' | 'berries' | 'mushrooms' | 'fish',
  maxYield: number,
): boolean {
  if (nodeKind === 'game') return maxYield > GAME_PATCH_MAX_YIELD;
  if (nodeKind === 'berries') return maxYield > BERRY_PATCH_MAX_YIELD;
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
  if (nodeKind === 'mushrooms') return MUSHROOM_PATCH_PICK_RADIUS;
  if (nodeKind === 'fish') return FISH_SHOAL_PICK_RADIUS;
  return isRich ? RICH_BERRY_PATCH_PICK_RADIUS : BERRY_PATCH_PICK_RADIUS;
}
