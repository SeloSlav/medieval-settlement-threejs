import {
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
} from '../generated/gameBalance.ts';
import { hashStringSeed, mulberry32 } from '../utils/random.ts';
import type { GameClock } from '../world/gameCalendar.ts';
import type { NightPolicyState } from '../economy/nightPolicy.ts';

export type HouseholdHomeState = 'home_outdoors' | 'indoors' | 'asleep';

export type HouseholdMemberRoutine = {
  readonly indoorsHour: number;
  readonly bedtimeHour: number;
  readonly wakeHour: number;
};

const ROUTINE_CACHE = new Map<string, HouseholdMemberRoutine>();

export function householdMemberRoutine(personIdentity: string): HouseholdMemberRoutine {
  const cached = ROUTINE_CACHE.get(personIdentity);
  if (cached) return cached;

  const random = mulberry32(hashStringSeed(`household-routine:${personIdentity}`));
  const indoorsHour = Math.min(
    CALENDAR_HOURS_PER_DAY - 2.5,
    CALENDAR_WORK_END_HOUR + 0.08 + random() * 0.62,
  );
  const bedtimeHour = Math.min(
    CALENDAR_HOURS_PER_DAY - 0.2,
    indoorsHour + 0.7 + random() * 2.1,
  );
  const wakeHour = Math.max(
    0,
    CALENDAR_WORK_START_HOUR - 1.45 + random() * 1.1,
  );
  const routine = { indoorsHour, bedtimeHour, wakeHour };
  ROUTINE_CACHE.set(personIdentity, routine);
  return routine;
}

export function householdMemberHomeState(
  personIdentity: string,
  clock: Pick<GameClock, 'hour' | 'minute'>,
  nightPolicy?: Pick<NightPolicyState, 'gathering' | 'curfew'>,
): HouseholdHomeState {
  const hour = fractionalHour(clock);
  const routine = householdMemberRoutine(personIdentity);
  const group = hashStringSeed(`night-routine:${personIdentity}`) % 100;
  let indoorsHour = routine.indoorsHour;
  let bedtimeHour = routine.bedtimeHour;
  if (nightPolicy?.gathering === 1 && group < 48) {
    indoorsHour = Math.min(22.15, indoorsHour + 0.85);
    bedtimeHour = Math.min(23.45, bedtimeHour + 0.45);
  } else if (nightPolicy?.gathering === 2 && group < 72) {
    indoorsHour = Math.min(23.1, indoorsHour + 1.75);
    bedtimeHour = Math.min(23.8, bedtimeHour + 0.75);
  }
  if (nightPolicy?.curfew === 2) {
    indoorsHour = Math.min(indoorsHour, CALENDAR_WORK_END_HOUR + 0.12);
  } else if (nightPolicy?.curfew === 1 && group < 34) {
    indoorsHour = Math.min(indoorsHour, CALENDAR_WORK_END_HOUR + 0.08);
  }
  if (hour >= bedtimeHour || hour < routine.wakeHour) {
    return 'asleep';
  }
  if (hour >= indoorsHour || hour < CALENDAR_WORK_START_HOUR) {
    return 'indoors';
  }
  return 'home_outdoors';
}

/**
 * Returns the fraction-strength of lamps visible in a residence. A household
 * stays lit while at least one member is indoors and awake; individual
 * bedtimes make different homes go dark at different times.
 */
export function residenceWindowActivity(
  residenceId: string,
  population: number,
  clock: Pick<GameClock, 'hour' | 'minute'>,
  nightPolicy?: Pick<NightPolicyState, 'gathering' | 'curfew'>,
): number {
  const memberCount = Math.max(0, Math.min(32, Math.floor(population)));
  if (memberCount === 0) return 0;

  let awakeIndoors = 0;
  for (let memberIndex = 0; memberIndex < memberCount; memberIndex++) {
    const state = householdMemberHomeState(
      `${residenceId}:person:${memberIndex}`,
      clock,
      nightPolicy,
    );
    if (state === 'indoors') awakeIndoors += 1;
  }
  if (awakeIndoors === 0) return 0;

  const occupiedShare = Math.min(1, awakeIndoors / Math.max(1, memberCount * 0.5));
  return 0.62 + occupiedShare * 0.38;
}

function fractionalHour(clock: Pick<GameClock, 'hour' | 'minute'>): number {
  return clock.hour + clock.minute / 60;
}
