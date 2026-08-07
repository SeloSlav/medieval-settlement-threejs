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
import {
  holidayObservanceForClock,
  type HolidayObservance,
} from './holidayCalendar.ts';

export type SettlementSchedule = {
  clock: GameClock;
  laborPaused: boolean;
  laborPauseLabel: string | null;
  dayNight: ReturnType<typeof computeDayNightState>;
  sabbathObservance: boolean;
  staffedChapel: boolean;
  holiday: HolidayObservance | null;
};

export function deriveSettlementScheduleFromClock(
  clock: GameClock,
  parishPolicy: ParishPolicyState,
  gameState: GameState | null,
  staffedChapelOverride?: boolean,
  target?: SettlementSchedule,
): SettlementSchedule {
  const sabbathObservance = parishPolicy.sabbathObservanceEnabled
    ?? DEFAULT_PARISH_POLICY.sabbathObservanceEnabled;
  const staffedChapel = staffedChapelOverride
    ?? (gameState ? playerHasStaffedChapel(gameState.buildings.values()) : false);
  const holiday = holidayObservanceForClock(clock);
  const laborPaused = isLaborPaused(clock, sabbathObservance, staffedChapel);
  const pauseLabel = laborPauseLabel(clock, sabbathObservance, staffedChapel);
  if (target) {
    target.clock = clock;
    target.laborPaused = laborPaused;
    target.laborPauseLabel = pauseLabel;
    computeDayNightState(clock, laborPaused, target.dayNight);
    target.sabbathObservance = sabbathObservance;
    target.staffedChapel = staffedChapel;
    target.holiday = holiday;
    return target;
  }
  return {
    clock,
    laborPaused,
    laborPauseLabel: pauseLabel,
    dayNight: computeDayNightState(clock, laborPaused),
    sabbathObservance,
    staffedChapel,
    holiday,
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
