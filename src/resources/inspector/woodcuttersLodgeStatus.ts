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
  inboundTimberTrip: DeliveryTripState | null;
  timberTripRemainingSeconds: number | null;
  nextTargetLabel: string;
  activeDestinationLabel: string;
  hasNextTarget: boolean;
  hasIndustrialTarget: boolean;
  industrialTargetLabel: string;
  firewoodPerTrip: number;
  canDeliver: boolean;
  availableUnreservedTimber: number;
  timberReserve: number;
  timberPerCycle: number;
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
    inboundTimberTrip,
    timberTripRemainingSeconds,
    nextTargetLabel,
    activeDestinationLabel,
    hasNextTarget,
    hasIndustrialTarget,
    industrialTargetLabel,
    firewoodPerTrip,
    canDeliver,
    availableUnreservedTimber,
    timberReserve,
    timberPerCycle,
  } = input;

  const haulMode = onRoad ? 'by road' : 'cross-country at reduced speed';
  if (assignedLabor === 0 && firewood <= 0) {
    return {
      statusText: 'Idle — assign lodge workers to process timber',
      statusState: 'idle',
    };
  }
  if (connectedMillCount === 0 && firewood <= 0) {
    return {
      statusText: 'No lumber mill has timber available for this lodge',
      statusState: 'warning',
    };
  }
  if (millsWithTimber === 0 && timber <= 0 && firewood <= 0) {
    return {
      statusText: 'Available lumber mills have no timber yet',
      statusState: 'warning',
    };
  }
  if (claimedResidenceCount === 0 && !hasIndustrialTarget) {
    return {
      statusText: 'No heated homes or staffed fuel-burning workshops currently need fuel',
      statusState: 'warning',
    };
  }
  if (inboundTimberTrip && timberTripRemainingSeconds != null) {
    const timer = formatCooldown(timberTripRemainingSeconds);
    return {
      statusText: `Timber haul ${formatTripPhaseLabel(inboundTimberTrip.phase).toLowerCase()} — ${timer} remaining`,
      statusState: 'active',
    };
  }
  const reserveBlocksProcessing = timberReserve > 0
    && availableUnreservedTimber + 1e-6 < timberReserve + timberPerCycle;
  if (reserveBlocksProcessing && firewood <= 0) {
    const shortfall = Math.ceil(timberReserve + timberPerCycle - availableUnreservedTimber);
    return {
      statusText: `Holding timber for construction — need ${shortfall} more before the next firewood cycle`,
      statusState: 'warning',
    };
  }
  if (firewood <= 0 && timber <= 0) {
    return {
      statusText: `Dispatching timber haul from nearest mill ${haulMode}`,
      statusState: 'active',
    };
  }
  if (firewood <= 0) {
    return {
      statusText: `Processing timber into firewood (${crew.processing} at lodge)`,
      statusState: 'active',
    };
  }
  if (activeTrip && tripRemainingSeconds != null) {
    const timer = formatCooldown(tripRemainingSeconds ?? Infinity);
    return {
      statusText: `Deliverer ${formatTripPhaseLabel(activeTrip.phase).toLowerCase()} — ${timer} remaining → ${activeDestinationLabel}`,
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
  if (reserveBlocksProcessing) {
    return {
      statusText: `Serving stored firewood — timber processing held at the ${Math.round(timberReserve)} reserve`,
      statusState: 'warning',
    };
  }
  if ((hasNextTarget || hasIndustrialTarget) && crew.delivering <= 0) {
    return {
      statusText: 'Stored firewood ready — waiting for an unassigned hauler',
      statusState: 'idle',
    };
  }
  if (!hasNextTarget && hasIndustrialTarget) {
    return {
      statusText: `Protected household reserves covered — surplus fuel ready for ${industrialTargetLabel}`,
      statusState: 'ok',
    };
  }
  return {
    statusText: `Serving ${claimedResidenceCount} claimed residence${claimedResidenceCount === 1 ? '' : 's'} ${haulMode}`,
    statusState: 'active',
  };
}
