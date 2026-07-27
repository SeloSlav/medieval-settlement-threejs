import {
  DELIVERY_CARGO_KINDS,
  tripRemainingSeconds,
  type DeliveryCargoKind,
  type DeliveryTripPhase,
  type DeliveryTripState,
} from '../logistics/deliveryTrips.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';

export type HaulageTripSummary = {
  tripId: string;
  cargoKind: DeliveryCargoKind;
  phase: DeliveryTripPhase;
  amount: number;
  deliveryWorkers: number;
  oneWayDistance: number;
  remainingSeconds: number | null;
};

export type SettlementHaulagePlan = {
  activeTrips: number;
  deliveryWorkers: number;
  freeHaulerWorkers: number;
  outboundTrips: number;
  unloadingTrips: number;
  returningTrips: number;
  loadedTrips: number;
  emergencyTrips: number;
  cargoInTransit: number;
  cargoTrips: Record<DeliveryCargoKind, number>;
  cargoInTransitByKind: Record<DeliveryCargoKind, number>;
  busiestCargoKind: DeliveryCargoKind | null;
  busiestCargoTrips: number;
  measuredTrips: number;
  unresolvedTrips: number;
  totalOneWayDistance: number;
  averageOneWayDistance: number;
  totalRemainingTripSeconds: number;
  totalRemainingWorkerSeconds: number;
  longestRoute: HaulageTripSummary | null;
};

function emptyCargoRecord(): Record<DeliveryCargoKind, number> {
  const record = {} as Record<DeliveryCargoKind, number>;
  for (const kind of DELIVERY_CARGO_KINDS) record[kind] = 0;
  return record;
}

/**
 * Summarizes authoritative active cart rows without rebuilding routes. Every
 * trip already carries the one-way road distance chosen by the server, so this
 * remains one bounded pass and adds no pathfinding work to inspector refreshes.
 */
export function computeSettlementHaulagePlan(
  trips: Iterable<DeliveryTripState>,
): SettlementHaulagePlan {
  const cargoTrips = emptyCargoRecord();
  const cargoInTransitByKind = emptyCargoRecord();
  const plan: SettlementHaulagePlan = {
    activeTrips: 0,
    deliveryWorkers: 0,
    freeHaulerWorkers: 0,
    outboundTrips: 0,
    unloadingTrips: 0,
    returningTrips: 0,
    loadedTrips: 0,
    emergencyTrips: 0,
    cargoInTransit: 0,
    cargoTrips,
    cargoInTransitByKind,
    busiestCargoKind: null,
    busiestCargoTrips: 0,
    measuredTrips: 0,
    unresolvedTrips: 0,
    totalOneWayDistance: 0,
    averageOneWayDistance: 0,
    totalRemainingTripSeconds: 0,
    totalRemainingWorkerSeconds: 0,
    longestRoute: null,
  };

  for (const trip of trips) {
    plan.activeTrips += 1;
    const deliveryWorkers = Math.max(0, trip.deliveryWorkers);
    plan.deliveryWorkers += deliveryWorkers;
    plan.freeHaulerWorkers += Math.max(0, trip.freeHaulerWorkers);
    cargoTrips[trip.cargoKind] += 1;

    if (trip.phase === 'outbound') plan.outboundTrips += 1;
    else if (trip.phase === 'unloading') plan.unloadingTrips += 1;
    else plan.returningTrips += 1;

    if (trip.destinationKind === 'fire') plan.emergencyTrips += 1;
    const amount = Math.max(0, trip.amount);
    if (trip.phase !== 'inbound' && amount > 1e-9) {
      plan.loadedTrips += 1;
      plan.cargoInTransit += amount;
      cargoInTransitByKind[trip.cargoKind] += amount;
    }

    const oneWayDistance = Number.isFinite(trip.pathDistance)
      && trip.pathDistance > 1e-6
      ? trip.pathDistance
      : null;
    if (oneWayDistance === null) {
      plan.unresolvedTrips += 1;
      continue;
    }

    plan.measuredTrips += 1;
    plan.totalOneWayDistance += oneWayDistance;
    const rawRemainingSeconds = tripRemainingSeconds(trip, oneWayDistance);
    const remainingSeconds = Number.isFinite(rawRemainingSeconds)
      ? Math.max(0, rawRemainingSeconds)
      : null;
    if (remainingSeconds === null) {
      plan.unresolvedTrips += 1;
    } else {
      plan.totalRemainingTripSeconds += remainingSeconds;
      plan.totalRemainingWorkerSeconds += remainingSeconds * deliveryWorkers;
    }

    if (
      plan.longestRoute === null
      || oneWayDistance > plan.longestRoute.oneWayDistance + 1e-6
      || (
        Math.abs(oneWayDistance - plan.longestRoute.oneWayDistance) <= 1e-6
        && compareStableEntityIds(trip.id, plan.longestRoute.tripId) < 0
      )
    ) {
      plan.longestRoute = {
        tripId: trip.id,
        cargoKind: trip.cargoKind,
        phase: trip.phase,
        amount,
        deliveryWorkers,
        oneWayDistance,
        remainingSeconds,
      };
    }
  }

  if (plan.measuredTrips > 0) {
    plan.averageOneWayDistance = plan.totalOneWayDistance / plan.measuredTrips;
  }
  for (const kind of DELIVERY_CARGO_KINDS) {
    if (cargoTrips[kind] > plan.busiestCargoTrips) {
      plan.busiestCargoKind = kind;
      plan.busiestCargoTrips = cargoTrips[kind];
    }
  }

  return plan;
}
