import {
  ABANDON_AFTER_DEFICIT_TICKS,
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_RECOVERY_FIREWOOD_MIN,
  RESIDENCE_SETTLE_TICKS,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import {
  formatFirewoodRunwayDays,
  residenceFirewoodRunwayDays,
} from '../logistics/firewoodLogistics.ts';
import type { ResidenceState } from '../resources/types.ts';
import {
  getNeed,
  maxNeedDeficitTicks,
  type ResidenceNeedKind,
  type ResidenceNeedRecoveryStatus,
  type ResidenceNeedSupplyContext,
  type ResidenceNeedsStatus,
  RESIDENCE_NEED_KINDS,
} from './residenceNeedState.ts';

export type {
  ResidenceNeedKind,
  ResidenceNeedRecoveryStatus,
  ResidenceNeedSupplyContext,
  ResidenceNeedsStatus,
};
export {
  createDefaultNeeds,
  getNeed,
  getNeedStock,
  RESIDENCE_NEED_KINDS,
} from './residenceNeedState.ts';

export function evaluateResidenceNeedRecovery(
  residence: ResidenceState,
  supply: ResidenceNeedSupplyContext,
): ResidenceNeedRecoveryStatus[] {
  return RESIDENCE_NEED_KINDS.map((kind) => evaluateNeedRecovery(kind, residence, supply));
}

export function residenceRecoveryReady(
  statuses: readonly ResidenceNeedRecoveryStatus[],
): boolean {
  return statuses.length > 0 && statuses.every((status) => status.ready);
}

export function residenceNeedsStatus(
  residence: ResidenceState,
  supply: ResidenceNeedSupplyContext = { servingLodgeId: null },
): ResidenceNeedsStatus {
  if (residence.abandoned) {
    return describeAbandonedResidence(residence, supply);
  }
  if (residence.population === 0) {
    return describeAwaitingSettlers(residence);
  }

  const deficitWarning = describeDeficitWarning(residence);
  if (deficitWarning) return deficitWarning;

  return describeActiveNeeds(residence);
}

function evaluateNeedRecovery(
  kind: ResidenceNeedKind,
  residence: ResidenceState,
  supply: ResidenceNeedSupplyContext,
): ResidenceNeedRecoveryStatus {
  const need = getNeed(residence.needs, kind);
  switch (kind) {
    case 'firewood':
      return {
        kind,
        label: 'Firewood',
        ready: supply.servingLodgeId != null
          && need.stock + 1e-6 >= RESIDENCE_RECOVERY_FIREWOOD_MIN,
        stock: need.stock,
        threshold: RESIDENCE_RECOVERY_FIREWOOD_MIN,
        supplyAvailable: supply.servingLodgeId != null,
      };
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

function describeAbandonedResidence(
  residence: ResidenceState,
  supply: ResidenceNeedSupplyContext,
): ResidenceNeedsStatus {
  const recovery = evaluateResidenceNeedRecovery(residence, supply);
  if (residenceRecoveryReady(recovery)) {
    return {
      label: 'Restocking complete — settlers return once supply holds',
      state: 'idle',
    };
  }

  const pending = recovery.filter((status) => !status.ready);
  const restocking = pending.find((status) => status.stock > 0);
  if (restocking) {
    return {
      label: `Abandoned — restocking ${restocking.label.toLowerCase()} (${Math.round(restocking.stock)} / ${restocking.threshold})`,
      state: 'warning',
    };
  }

  const waitingOn = pending.map((status) => status.label.toLowerCase()).join(', ');
  return {
    label: waitingOn
      ? `Abandoned — awaiting ${waitingOn} from supply routes`
      : 'Abandoned — awaiting supply routes',
    state: 'abandoned',
  };
}

function describeAwaitingSettlers(residence: ResidenceState): ResidenceNeedsStatus {
  const capacity = residence.populationCapacity;
  const settleSeconds = Math.max(
    1,
    Math.round((RESIDENCE_SETTLE_TICKS - residence.settlementTicks) * SIM_TICK_SECONDS),
  );
  return {
    label: capacity > 0
      ? `Awaiting settlers — first arrival in ~${formatShortDuration(settleSeconds)}`
      : 'Vacant — awaiting settlers',
    state: 'idle',
  };
}

function describeDeficitWarning(residence: ResidenceState): ResidenceNeedsStatus | null {
  const deficitTicks = maxNeedDeficitTicks(residence.needs);
  if (deficitTicks <= 0) return null;

  const unmetNeeds = RESIDENCE_NEED_KINDS
    .filter((kind) => getNeed(residence.needs, kind).deficitTicks > 0)
    .map((kind) => needLabel(kind).toLowerCase());

  const remainingTicks = Math.max(0, ABANDON_AFTER_DEFICIT_TICKS - deficitTicks);
  const remainingSeconds = remainingTicks * SIM_TICK_SECONDS;
  const needLabelText = unmetNeeds.length > 0 ? unmetNeeds.join(', ') : 'needs';
  return {
    label: `Low ${needLabelText} — abandons in ${formatShortDuration(remainingSeconds)}`,
    state: 'warning',
  };
}

function describeActiveNeeds(residence: ResidenceState): ResidenceNeedsStatus {
  const warnings = RESIDENCE_NEED_KINDS
    .map((kind) => describeActiveNeed(kind, residence))
    .filter((status): status is ResidenceNeedsStatus => status != null);

  if (warnings.length === 0) {
    return { label: 'Needs met', state: 'active' };
  }

  return warnings.sort((a, b) => warningPriority(a) - warningPriority(b))[0];
}

function describeActiveNeed(
  kind: ResidenceNeedKind,
  residence: ResidenceState,
): ResidenceNeedsStatus | null {
  switch (kind) {
    case 'firewood': {
      const runwayDays = residenceFirewoodRunwayDays(residence);
      if (runwayDays == null) return null;
      if (runwayDays <= 0.25) {
        return {
          label: 'Out of firewood — awaiting delivery',
          state: 'warning',
        };
      }
      if (runwayDays < 1) {
        return {
          label: `Low firewood — ${formatFirewoodRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      if (runwayDays < 3) {
        return {
          label: `Firewood low — ${formatFirewoodRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      return {
        label: `Needs met — ${formatFirewoodRunwayDays(runwayDays)} of firewood`,
        state: 'active',
      };
    }
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

function needLabel(kind: ResidenceNeedKind): string {
  switch (kind) {
    case 'firewood':
      return 'Firewood';
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

function warningPriority(status: ResidenceNeedsStatus): number {
  if (status.state === 'warning' && status.label.startsWith('Out of')) return 0;
  if (status.state === 'warning' && status.label.startsWith('Low')) return 1;
  if (status.state === 'warning') return 2;
  return 3;
}

function formatShortDuration(seconds: number): string {
  if (seconds >= 120) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `~${minutes} min`;
  }
  return `~${Math.max(1, Math.round(seconds))}s`;
}

export { RESIDENCE_FIREWOOD_CAPACITY };
