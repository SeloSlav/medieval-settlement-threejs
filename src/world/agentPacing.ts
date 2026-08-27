import {
  SIM_REALTIME_RATE,
  WORKFORCE_MOVEMENT_SPEED_MULTIPLIER,
} from '../generated/gameBalance.ts';
import type { GameSpeed } from './gameSpeed.ts';

/**
 * Presentation time for locally simulated people and draft animals. The same
 * generated multiplier is applied to authoritative world movement on the
 * server, while this paced delta keeps local walking, work, and idle animation
 * cycles moving together.
 */
export function agentPacedDelta(
  realDeltaSeconds: number,
  gameSpeed: GameSpeed,
): number {
  const realDelta = Number.isFinite(realDeltaSeconds)
    ? Math.max(0, realDeltaSeconds)
    : 0;
  return realDelta
    * gameSpeed
    * SIM_REALTIME_RATE
    * WORKFORCE_MOVEMENT_SPEED_MULTIPLIER;
}
