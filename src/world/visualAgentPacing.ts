import { SIM_REALTIME_RATE } from '../generated/gameBalance.ts';
import type { GameSpeed } from './gameSpeed.ts';

/**
 * Client-only pace for people, draft animals, and their attached vehicles.
 * This must never be used by authoritative simulation or production code.
 */
export const VISUAL_AGENT_PACE_MULTIPLIER = 2;

export function visualAgentDelta(
  realDeltaSeconds: number,
  gameSpeed: GameSpeed,
): number {
  const realDelta = Number.isFinite(realDeltaSeconds)
    ? Math.max(0, realDeltaSeconds)
    : 0;
  return realDelta
    * gameSpeed
    * SIM_REALTIME_RATE
    * VISUAL_AGENT_PACE_MULTIPLIER;
}
