import {
  RESIDENCE_FIREWOOD_CAPACITY,
  RESIDENCE_FOOD_CAPACITY,
  RESIDENCE_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_WATER_CAPACITY,
  SIM_TICK_SECONDS,
} from '../generated/gameBalance.ts';
import {
  effectiveAbandonAfterDeficitTicks,
  effectiveResidenceSettleTicks,
  recoveryNeedsRequired,
  recoveryStockMin,
} from '../economy/chapelCommunity.ts';
import {
  formatFirewoodRunwayDays,
  residenceFirewoodRunwayDays,
} from '../logistics/firewoodLogistics.ts';
import {
  formatWaterRunwayDays,
  residenceWaterRunwayDays,
} from '../logistics/waterLogistics.ts';
import type { ResidenceState } from '../resources/types.ts';
import {
  getNeed,
  maxNeedDeficitTicks,
  type ResidenceNeedKind,
  type ResidenceNeedRecoveryStatus,
  type ResidenceNeedSupplyContext,
  type ResidenceCommunityContext,
  type ResidenceNeedsStatus,
  DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
  RESIDENCE_NEED_KINDS,
} from './residenceNeedState.ts';

export type {
  ResidenceNeedKind,
  ResidenceNeedRecoveryStatus,
  ResidenceNeedSupplyContext,
  ResidenceCommunityContext,
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
  community: ResidenceCommunityContext = DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
): ResidenceNeedRecoveryStatus[] {
  return RESIDENCE_NEED_KINDS.map((kind) => evaluateNeedRecovery(kind, residence, supply, community));
}

export function residenceRecoveryReady(
  statuses: readonly ResidenceNeedRecoveryStatus[],
  community: ResidenceCommunityContext = DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
): boolean {
  const required = recoveryNeedsRequired(community.hasChapelAccess);
  return statuses.filter((status) => status.ready).length >= required;
}

export function residenceNeedsStatus(
  residence: ResidenceState,
  supply: ResidenceNeedSupplyContext = {
    servingLodgeId: null,
    servingWellId: null,
    servingFoodSupplierId: null,
  },
  community: ResidenceCommunityContext = DEFAULT_RESIDENCE_COMMUNITY_CONTEXT,
): ResidenceNeedsStatus {
  if (residence.abandoned) {
    return describeAbandonedResidence(residence, supply, community);
  }
  if (residence.population === 0) {
    return describeAwaitingSettlers(residence, community);
  }

  const deficitWarning = describeDeficitWarning(residence, community.hasChapelAccess);
  if (deficitWarning) return deficitWarning;

  return describeActiveNeeds(residence);
}

function evaluateNeedRecovery(
  kind: ResidenceNeedKind,
  residence: ResidenceState,
  supply: ResidenceNeedSupplyContext,
  community: ResidenceCommunityContext,
): ResidenceNeedRecoveryStatus {
  const need = getNeed(residence.needs, kind);
  const threshold = recoveryStockMin(kind, community.hasChapelAccess);
  switch (kind) {
    case 'firewood':
      return {
        kind,
        label: 'Firewood',
        ready: supply.servingLodgeId != null && need.stock + 1e-6 >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: supply.servingLodgeId != null,
      };
    case 'water':
      return {
        kind,
        label: 'Water',
        ready: supply.servingWellId != null && need.stock + 1e-6 >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: supply.servingWellId != null,
      };
    case 'food':
      return {
        kind,
        label: 'Food',
        ready: supply.servingFoodSupplierId != null && need.stock + 1e-6 >= threshold,
        stock: need.stock,
        threshold,
        supplyAvailable: supply.servingFoodSupplierId != null,
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
  community: ResidenceCommunityContext,
): ResidenceNeedsStatus {
  const recovery = evaluateResidenceNeedRecovery(residence, supply, community);
  if (residenceRecoveryReady(recovery, community)) {
    return {
      label: community.hasChapelAccess
        ? 'Restocking complete — chapel parish welcomes settlers back'
        : 'Restocking complete — settlers return once supply holds',
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

function describeAwaitingSettlers(
  residence: ResidenceState,
  community: ResidenceCommunityContext,
): ResidenceNeedsStatus {
  const capacity = residence.populationCapacity;
  const settleTicks = effectiveResidenceSettleTicks(
    community.hasChapelAccess,
    community.sabbathObservance,
  );
  const settleSeconds = Math.max(
    1,
    Math.round((settleTicks - residence.settlementTicks) * SIM_TICK_SECONDS),
  );
  const chapelNote = community.hasChapelAccess ? ' (staffed chapel)' : '';
  return {
    label: capacity > 0
      ? `Awaiting settlers — first arrival in ~${formatShortDuration(settleSeconds)}${chapelNote}`
      : 'Vacant — awaiting settlers',
    state: 'idle',
  };
}

function describeDeficitWarning(
  residence: ResidenceState,
  hasChapelAccess: boolean,
): ResidenceNeedsStatus | null {
  const deficitTicks = maxNeedDeficitTicks(residence.needs);
  if (deficitTicks <= 0) return null;

  const unmetNeeds = RESIDENCE_NEED_KINDS
    .filter((kind) => getNeed(residence.needs, kind).deficitTicks > 0)
    .map((kind) => needLabel(kind).toLowerCase());

  const abandonThreshold = effectiveAbandonAfterDeficitTicks(hasChapelAccess);
  const remainingTicks = Math.max(0, abandonThreshold - deficitTicks);
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
    case 'water': {
      const runwayDays = residenceWaterRunwayDays(residence);
      if (runwayDays == null) return null;
      if (runwayDays <= 0.25) {
        return {
          label: 'Out of water — awaiting well supply',
          state: 'warning',
        };
      }
      if (runwayDays < 1) {
        return {
          label: `Low water — ${formatWaterRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      if (runwayDays < 3) {
        return {
          label: `Water low — ${formatWaterRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      return null;
    }
    case 'food': {
      const runwayDays = residenceFoodRunwayDays(residence);
      if (runwayDays == null) return null;
      if (runwayDays <= 0.25) {
        return {
          label: 'Out of food — awaiting delivery',
          state: 'warning',
        };
      }
      if (runwayDays < 1) {
        return {
          label: `Low food — ${formatFoodRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      if (runwayDays < 3) {
        return {
          label: `Food low — ${formatFoodRunwayDays(runwayDays)} left`,
          state: 'warning',
        };
      }
      return null;
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
    case 'water':
      return 'Water';
    case 'food':
      return 'Food';
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

function residenceFoodRunwayDays(residence: ResidenceState): number | null {
  if (residence.abandoned || residence.population === 0) return null;
  const stock = getNeed(residence.needs, 'food').stock;
  const dailyUse = residence.population * RESIDENCE_FOOD_PER_PERSON_PER_SEC * 86400;
  if (dailyUse <= 1e-9) return null;
  return stock / dailyUse;
}

function formatFoodRunwayDays(days: number): string {
  if (days >= 2) return `${days.toFixed(1)} days`;
  const hours = Math.max(1, Math.round(days * 24));
  return `${hours}h`;
}

export { RESIDENCE_FIREWOOD_CAPACITY, RESIDENCE_WATER_CAPACITY, RESIDENCE_FOOD_CAPACITY };
