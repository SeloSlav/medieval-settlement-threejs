export const GAME_PATCH_MAX_YIELD = 200;
export const BERRY_PATCH_MAX_YIELD = 120;

export const GAME_PATCH_PICK_RADIUS = 42;
export const BERRY_PATCH_PICK_RADIUS = 28;

export function foragingPickRadius(nodeKind: 'game' | 'berries'): number {
  return nodeKind === 'game' ? GAME_PATCH_PICK_RADIUS : BERRY_PATCH_PICK_RADIUS;
}
