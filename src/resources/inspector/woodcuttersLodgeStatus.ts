import type { ResidenceState } from '../types.ts';
import { formatFirewoodRunwayDays, residenceFirewoodRunwayDays } from '../../logistics/firewoodLogistics.ts';
import type { LodgeLaborSplit } from '../../logistics/lodgeLogistics.ts';
import { lodgeLaborAlternates } from '../../logistics/lodgeLogistics.ts';
import type { DeliveryTripState } from '../../logistics/deliveryTrips.ts';
import { formatTripPhaseLabel } from '../../logistics/deliveryTrips.ts';

export function formatCooldown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Ready';
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} min`;
  return `${seconds.toFixed(1)}s`;
}

export function formatNextDeliveryTargetLabel(target: ResidenceState | null): string {
  if (!target) return 'None needing fuel';
  const runwayDays = residenceFirewoodRunwayDays(target);
  const runwaySuffix = runwayDays != null ? ` (${formatFirewoodRunwayDays(runwayDays)} left)` : '';
  return `Parcel #${target.parcelIndex + 1}${runwaySuffix}`;
}

export type LodgeStatusInput = {
  onRoad: boolean;
  assignedLabor: number;
  connectedMillCount: number;
  millsWithTimber: number;
  timber: number;
  firewood: number;
  claimedResidenceCount: number;
  crew: LodgeLaborSplit;
  tripRemainingSeconds: number | null;
  activeTrip: DeliveryTripState | null;
  nextTargetLabel: string;
  hasNextTarget: boolean;
  firewoodPerTrip: number;
  canDeliver: boolean;
};

export function resolveWoodcuttersLodgeStatus(input: LodgeStatusInput): {
  statusText: string;
  statusState: string;
} {
  const {
    onRoad,
    assignedLabor,
    connectedMillCount,
    millsWithTimber,
    timber,
    firewood,
    claimedResidenceCount,
    crew,
    tripRemainingSeconds,
    activeTrip,
    nextTargetLabel,
    hasNextTarget,
    firewoodPerTrip,
    canDeliver,
  } = input;

  if (!onRoad) {
    return {
      statusText: 'Not connected — place near a road and link with paths',
      statusState: 'idle',
    };
  }
  if (assignedLabor === 0) {
    return {
      statusText: 'Idle — assign lodge workers to process timber and run deliveries',
      statusState: 'idle',
    };
  }
  if (connectedMillCount === 0) {
    return {
      statusText: 'No road-linked lumber mills — connect a mill by road',
      statusState: 'warning',
    };
  }
  if (millsWithTimber === 0 && timber <= 0) {
    return {
      statusText: 'Road-linked mills have no timber yet',
      statusState: 'warning',
    };
  }
  if (claimedResidenceCount === 0) {
    return {
      statusText: 'No residences claimed on this road branch',
      statusState: 'warning',
    };
  }
  if (firewood <= 0 && timber <= 0) {
    return {
      statusText: `Pulling timber from ${millsWithTimber} nearest mill${millsWithTimber === 1 ? '' : 's'} by road`,
      statusState: 'active',
    };
  }
  if (firewood <= 0) {
    return {
      statusText: lodgeLaborAlternates(assignedLabor)
        ? 'Processing timber — lone worker alternates with delivery runs'
        : `Processing timber into firewood (${crew.processing} at lodge)`,
      statusState: 'active',
    };
  }
  if (activeTrip && tripRemainingSeconds != null) {
    const timer = formatCooldown(tripRemainingSeconds ?? Infinity);
    return {
      statusText: `Deliverer ${formatTripPhaseLabel(activeTrip.phase).toLowerCase()} — ${timer} remaining → ${nextTargetLabel}`,
      statusState: 'active',
    };
  }
  if (canDeliver) {
    return {
      statusText: hasNextTarget
        ? `Dispatching firewood to ${nextTargetLabel} (${firewoodPerTrip} per trip)`
        : 'No claimed residences need firewood right now',
      statusState: hasNextTarget ? 'active' : 'idle',
    };
  }
  return {
    statusText: `Serving ${claimedResidenceCount} claimed residence${claimedResidenceCount === 1 ? '' : 's'} on this branch`,
    statusState: 'active',
  };
}
