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
  vitalDeficitTicks: number;
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
  const activeNeedKinds = activeResidenceNeedKinds(residence.tier);
  const vitalDeficitTicks = activeNeedKinds
    .filter((kind) => VITAL_NEEDS.has(kind))
    .reduce(
      (max, kind) => Math.max(max, getNeedDeficitTicks(residence.needs, kind)),
      0,
    );
  const nonVitalDeficitTicks = activeNeedKinds
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
    vitalDeficitTicks,
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
    ? 'Sustained shortages · upgrades blocked'
    : 'Needs pressure · approval affected';
  if (state.discretionarySpendingMultiplier >= 1) {
    return `${serviceStatus} · work continues normally`;
  }
  if (state.vitalDeficitTicks > 0) {
    return `${serviceStatus} · optional spending paused until vital buffers recover · work continues normally`;
  }

  const reduction = Math.round((1 - state.discretionarySpendingMultiplier) * 100);
  return `${serviceStatus} · optional spending and local market tax reduced ${reduction}% · work continues normally`;
}
