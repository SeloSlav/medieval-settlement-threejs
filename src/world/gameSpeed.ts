export const GAME_SPEEDS = [0, 1, 5, 20, 120] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];
export const PLAYER_GAME_SPEEDS = [1, 5, 20, 120] as const satisfies readonly GameSpeed[];
export const PLAYER_GAME_SPEED_HOTKEYS = ['1', '2', '3', '4'] as const;

export function gameSpeedForHotkey(key: string): GameSpeed | null {
  const index = PLAYER_GAME_SPEED_HOTKEYS.indexOf(
    key as (typeof PLAYER_GAME_SPEED_HOTKEYS)[number],
  );
  return index >= 0 ? PLAYER_GAME_SPEEDS[index] : null;
}

export function hotkeyForGameSpeed(speed: GameSpeed): string | null {
  const index = PLAYER_GAME_SPEEDS.indexOf(
    speed as (typeof PLAYER_GAME_SPEEDS)[number],
  );
  return index >= 0 ? PLAYER_GAME_SPEED_HOTKEYS[index] : null;
}

export function normalizeGameSpeed(value: number): GameSpeed {
  // Preserve the nearest intent for worlds saved before the 1x / 5x / 20x rebalance.
  if (value === 4) return 5;
  if (value === 12) return 20;
  return GAME_SPEEDS.includes(value as GameSpeed) ? value as GameSpeed : 1;
}

export function gameSpeedLabel(speed: GameSpeed): string {
  if (speed === 0) return 'Paused';
  if (speed === 1) return 'Scenic';
  if (speed === 5) return 'Normal';
  if (speed === 20) return 'Fast';
  return 'Ultra';
}
