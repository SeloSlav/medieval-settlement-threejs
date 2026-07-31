export const GAME_SPEEDS = [0, 1, 4, 8] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];
export const PLAYER_GAME_SPEEDS = [1, 4, 8] as const satisfies readonly GameSpeed[];
export const PLAYER_GAME_SPEED_HOTKEYS = ['1', '2', '3'] as const;
export const PAUSE_GAME_SPEED_HOTKEY = ' ' as const;

export function gameSpeedForHotkey(key: string): GameSpeed | null {
  if (key === PAUSE_GAME_SPEED_HOTKEY) return 0;
  const index = PLAYER_GAME_SPEED_HOTKEYS.indexOf(
    key as (typeof PLAYER_GAME_SPEED_HOTKEYS)[number],
  );
  return index >= 0 ? PLAYER_GAME_SPEEDS[index] : null;
}

export function resolveGameSpeedHotkey(
  key: string,
  currentSpeed: GameSpeed,
  lastRunningSpeed: GameSpeed,
  firstPersonActive: boolean,
): GameSpeed | null {
  const requestedSpeed = gameSpeedForHotkey(key);
  if (requestedSpeed !== 0) return requestedSpeed;
  if (firstPersonActive) return null;
  return currentSpeed === 0 ? lastRunningSpeed : 0;
}

export function hotkeyForGameSpeed(speed: GameSpeed): string | null {
  if (speed === 0) return 'Space';
  const index = PLAYER_GAME_SPEEDS.indexOf(
    speed as (typeof PLAYER_GAME_SPEEDS)[number],
  );
  return index >= 0 ? PLAYER_GAME_SPEED_HOTKEYS[index] : null;
}

export function normalizeGameSpeed(value: number): GameSpeed {
  // Preserve the nearest intent for worlds saved with earlier speed controls.
  if (value === 5) return 4;
  if (value === 12 || value === 20 || value === 120) return 8;
  return GAME_SPEEDS.includes(value as GameSpeed) ? value as GameSpeed : 1;
}

export function gameSpeedLabel(speed: GameSpeed): string {
  if (speed === 0) return 'Pause';
  if (speed === 1) return 'Normal';
  if (speed === 4) return 'Fast';
  return 'Fastest';
}

export function worldAnimationDelta(realDeltaSeconds: number, speed: GameSpeed): number {
  return speed === 0 ? 0 : Math.max(0, realDeltaSeconds);
}
