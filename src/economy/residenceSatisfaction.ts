import {
  CALENDAR_SECONDS_PER_DAY,
  HOUSEHOLD_TIER4_SHORTAGE_DISCRETIONARY_MULTIPLIER,
  RESIDENCE_SERVICE_WARNING_DAYS,
  RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import {
  activeResidenceNeedKinds,
  getNeedDeficitTicks,
  maxActiveNeedDeficitTicks,
  type ResidenceNeedKind,
} from '../residences/residenceNeedState.ts';
import type { ResidenceState } from '../resources/types.ts';

export type ResidenceServiceState = {
  deficitTicks: number;
  deficitDays: number;
  nonVitalDeficitTicks: number;
  discretionarySpendingMultiplier: number;
  warning: boolean;
  upgradeBlocked: boolean;
};

const TICKS_PER_DAY = CALENDAR_SECONDS_PER_DAY / SIM_TICK_SECONDS;
const VITAL_NEEDS = new Set<ResidenceNeedKind>(['food', 'water', 'firewood']);

export function residenceServiceState(
  residence: Pick<ResidenceState, 'needs' | 'tier'>,
): ResidenceServiceState {
  const deficitTicks = Math.max(
    0,
    maxActiveNeedDeficitTicks(residence.needs, residence.tier),
  );
  const deficitDays = deficitTicks / Math.max(1, TICKS_PER_DAY);
  const nonVitalDeficitTicks = activeResidenceNeedKinds(residence.tier)
    .filter((kind) => !VITAL_NEEDS.has(kind))
    .reduce(
      (max, kind) => Math.max(max, getNeedDeficitTicks(residence.needs, kind)),
      0,
    );
  const nonVitalDeficitDays = nonVitalDeficitTicks / Math.max(1, TICKS_PER_DAY);
  const discretionarySpendingMultiplier = residence.tier === 4
    && nonVitalDeficitDays + 1e-9 >= RESIDENCE_SERVICE_WARNING_DAYS
    ? HOUSEHOLD_TIER4_SHORTAGE_DISCRETIONARY_MULTIPLIER
    : 1;
  return {
    deficitTicks,
    deficitDays,
    nonVitalDeficitTicks,
    discretionarySpendingMultiplier,
    warning: deficitDays + 1e-9 >= RESIDENCE_SERVICE_WARNING_DAYS,
    upgradeBlocked:
      deficitDays + 1e-9 >= RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
  };
}

export function formatResidenceServiceConsequence(
  state: ResidenceServiceState,
): string {
  if (!state.warning) return 'Needs stable · promotion eligible';
  const serviceStatus = state.upgradeBlocked
    ? 'Sustained shortages · upgrades blocked · work continues normally'
    : 'Needs pressure · approval affected · work continues normally';
  if (state.discretionarySpendingMultiplier >= 1) return serviceStatus;

  const reduction = Math.round((1 - state.discretionarySpendingMultiplier) * 100);
  return `${serviceStatus} · optional spending and local market tax reduced ${reduction}%`;
}
