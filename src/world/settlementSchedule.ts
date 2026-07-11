import { DEFAULT_PARISH_POLICY } from '../economy/chapelParish.ts';
import type { ParishPolicyState } from '../economy/chapelParish.ts';
import { playerHasStaffedChapel } from '../logistics/landmarkAccess.ts';
import type { GameState } from '../resources/types.ts';
import { computeDayNightState } from './dayNightPresentation.ts';
import {
  gameClock,
  gameClockAtElapsedSeconds,
  isLaborPaused,
  laborPauseLabel,
  type GameClock,
} from './gameCalendar.ts';

export type SettlementSchedule = {
  clock: GameClock;
  laborPaused: boolean;
  laborPauseLabel: string | null;
  dayNight: ReturnType<typeof computeDayNightState>;
  sabbathObservance: boolean;
  staffedChapel: boolean;
};

export function deriveSettlementScheduleFromClock(
  clock: GameClock,
  parishPolicy: ParishPolicyState,
  gameState: GameState | null,
): SettlementSchedule {
  const sabbathObservance = parishPolicy.sabbathObservanceEnabled
    ?? DEFAULT_PARISH_POLICY.sabbathObservanceEnabled;
  const staffedChapel = gameState ? playerHasStaffedChapel(gameState.buildings.values()) : false;
  const laborPaused = isLaborPaused(clock, sabbathObservance, staffedChapel);
  return {
    clock,
    laborPaused,
    laborPauseLabel: laborPauseLabel(clock, sabbathObservance, staffedChapel),
    dayNight: computeDayNightState(clock, laborPaused),
    sabbathObservance,
    staffedChapel,
  };
}

export function settlementScheduleDirtyKey(
  snapshot: { simTick: number; parishPolicy: ParishPolicyState },
  gameState: GameState | null,
): string {
  const sabbathObservance = snapshot.parishPolicy.sabbathObservanceEnabled
    ?? DEFAULT_PARISH_POLICY.sabbathObservanceEnabled;
  let chapelSignature = '';
  if (gameState) {
    for (const building of gameState.buildings.values()) {
      if (building.kind !== 'chapel') continue;
      chapelSignature += `${building.id}:${building.assignedLabor};`;
    }
  }
  return `${snapshot.simTick}|${sabbathObservance ? 1 : 0}|${chapelSignature}`;
}

export function deriveSettlementSchedule(
  snapshot: { simTick: number; parishPolicy: ParishPolicyState },
  gameState: GameState | null,
): SettlementSchedule {
  return deriveSettlementScheduleFromClock(
    gameClock(snapshot.simTick),
    snapshot.parishPolicy,
    gameState,
  );
}

export function deriveInterpolatedSettlementSchedule(
  elapsedSeconds: number,
  parishPolicy: ParishPolicyState,
  gameState: GameState | null,
): SettlementSchedule {
  return deriveSettlementScheduleFromClock(
    gameClockAtElapsedSeconds(elapsedSeconds),
    parishPolicy,
    gameState,
  );
}

/**
 * Client mirror of `labor_and_logistics_paused` when owner policy inputs are known.
 * Server also requires `owner_has_staffed_chapel` from DB — pass staffedChapel from player buildings.
 */
export function expectLaborPausedLikeServer(
  clock: GameClock,
  sabbathObservanceEnabled: boolean,
  staffedChapel: boolean,
): boolean {
  return isLaborPaused(clock, sabbathObservanceEnabled, staffedChapel);
}
