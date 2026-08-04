import {
  CALENDAR_SECONDS_PER_DAY,
  RESIDENCE_SERVICE_MAX_PENALTY_DAYS,
  RESIDENCE_SERVICE_MIN_ECONOMIC_MULTIPLIER,
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
  economicMultiplier: number;
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
    economicMultiplier: serviceEconomicMultiplier(deficitDays),
  };
}

export function serviceEconomicMultiplier(deficitDays: number): number {
  const days = Number.isFinite(deficitDays) ? Math.max(0, deficitDays) : 0;
  if (days <= RESIDENCE_SERVICE_WARNING_DAYS) return 1;
  const span = Math.max(
    1e-9,
    RESIDENCE_SERVICE_MAX_PENALTY_DAYS - RESIDENCE_SERVICE_WARNING_DAYS,
  );
  const pressure = Math.min(
    1,
    (days - RESIDENCE_SERVICE_WARNING_DAYS) / span,
  );
  const minimum = Math.max(
    0,
    Math.min(1, RESIDENCE_SERVICE_MIN_ECONOMIC_MULTIPLIER),
  );
  return Math.max(minimum, 1 - pressure * (1 - minimum));
}

export function formatResidenceServiceConsequence(
  state: ResidenceServiceState,
): string {
  if (!state.warning) return 'Needs stable · full household market output';
  const output = Math.round(state.economicMultiplier * 100);
  return state.upgradeBlocked
    ? `Sustained shortages · upgrades blocked · ${output}% household market and tax output`
    : `Needs pressure · ${output}% household market and tax output`;
}
