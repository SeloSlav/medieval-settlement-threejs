export const GAME_SPEEDS = [0, 1, 4, 12] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];
export const PLAYER_GAME_SPEEDS = [1, 4, 12] as const satisfies readonly GameSpeed[];

export function normalizeGameSpeed(value: number): GameSpeed {
  return GAME_SPEEDS.includes(value as GameSpeed) ? value as GameSpeed : 1;
}

export function gameSpeedLabel(speed: GameSpeed): string {
  if (speed === 0) return 'Paused';
  if (speed === 1) return 'Leisurely';
  if (speed === 4) return 'Fast';
  return 'Very fast';
}
