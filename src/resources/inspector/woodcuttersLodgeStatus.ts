import type { ResidenceState } from '../types.ts';
import { formatFirewoodRunwayDays, residenceFirewoodRunwayDays } from '../../logistics/firewoodLogistics.ts';
import type { LodgeLaborSplit } from '../../logistics/lodgeLogistics.ts';
import type { DeliveryTripState } from '../../logistics/deliveryTrips.ts';
import { formatTripPhaseLabel } from '../../logistics/deliveryTrips.ts';

export function formatCooldown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Ready';
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${seconds.toFixed(1)}s`;
}

export function formatNextDeliveryTargetLabel(target: ResidenceState | null): string {
  if (!target) return 'Protected household reserves covered';
  const runwayDays = residenceFirewoodRunwayDays(target);
  const runwaySuffix = runwayDays != null ? ` (${formatFirewoodRunwayDays(runwayDays)} left)` : '';
  return `Parcel #${target.parcelIndex + 1}${runwaySuffix}`;
}

export type LodgeStatusInput = {
  assignedLabor: number;
  matureTrees: number;
  firewood: number;
  firewoodRoom: number;
  claimedResidenceCount: number;
  crew: LodgeLaborSplit;
  tripRemainingSeconds: number | null;
  activeTrip: DeliveryTripState | null;
  activeDestinationLabel: string;
  hasIndustrialTarget: boolean;
  industrialTargetLabel: string;
};

export function resolveWoodcuttersLodgeStatus(input: LodgeStatusInput): {
  statusText: string;
  statusState: string;
} {
  const {
    assignedLabor,
    matureTrees,
    firewood,
    firewoodRoom,
    claimedResidenceCount,
    crew,
    tripRemainingSeconds,
    activeTrip,
    activeDestinationLabel,
    hasIndustrialTarget,
    industrialTargetLabel,
  } = input;

  if (activeTrip && tripRemainingSeconds != null) {
    return {
      statusText: `Firewood cart ${formatTripPhaseLabel(activeTrip.phase).toLowerCase()} — ${formatCooldown(tripRemainingSeconds)} remaining → ${activeDestinationLabel}`,
      statusState: 'active',
    };
  }
  if (firewoodRoom <= 1e-6) {
    return {
      statusText: 'Firewood storage full — waiting for Storehouse collection',
      statusState: 'ok',
    };
  }
  if (assignedLabor <= 0) {
    return {
      statusText: firewood > 0
        ? 'Stored firewood ready — assign woodcutters to resume harvesting'
        : 'Idle — assign woodcutters to harvest nearby trees',
      statusState: 'idle',
    };
  }
  if (matureTrees <= 0) {
    return {
      statusText: firewood > 0
        ? 'Serving stored firewood — no mature trees in the lodge work area'
        : 'No mature trees in the lodge work area',
      statusState: 'warning',
    };
  }
  if (hasIndustrialTarget && firewood > 0 && crew.delivering <= 0) {
    return {
      statusText: `Harvesting firewood — surplus fuel is waiting for a free hauler to ${industrialTargetLabel}`,
      statusState: 'active',
    };
  }

  const demand = claimedResidenceCount > 0
    ? ` for ${claimedResidenceCount} claimed residence${claimedResidenceCount === 1 ? '' : 's'}`
    : hasIndustrialTarget
      ? ` for ${industrialTargetLabel}`
      : '';
  return {
    statusText: `Harvesting firewood from ${matureTrees} mature tree${matureTrees === 1 ? '' : 's'}${demand}`,
    statusState: 'active',
  };
}
