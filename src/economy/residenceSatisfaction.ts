import {
  CALENDAR_SECONDS_PER_DAY,
  RESIDENCE_SERVICE_WARNING_DAYS,
  RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import { maxActiveNeedDeficitTicks } from '../residences/residenceNeedState.ts';
import type { ResidenceState } from '../resources/types.ts';

export type ResidenceServiceState = {
  deficitTicks: number;
  deficitDays: number;
  warning: boolean;
  upgradeBlocked: boolean;
};

const TICKS_PER_DAY = CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS;

export function residenceServiceState(
  residence: Pick<ResidenceState, 'needs' | 'tier'>,
): ResidenceServiceState {
  const deficitTicks = Math.max(
    0,
    maxActiveNeedDeficitTicks(residence.needs, residence.tier),
  );
  const deficitDays = deficitTicks / Math.max(1, TICKS_PER_DAY);
  return {
    deficitTicks,
    deficitDays,
    warning: deficitDays + 1e-9 >= RESIDENCE_SERVICE_WARNING_DAYS,
    upgradeBlocked:
      deficitDays + 1e-9 >= RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
  };
}

export function formatResidenceServiceConsequence(
  state: ResidenceServiceState,
): string {
  if (!state.warning) return 'Needs stable · promotion eligible';
  return state.upgradeBlocked
    ? 'Sustained shortages · upgrades blocked · work continues normally'
    : 'Needs pressure · approval affected · work continues normally';
}
