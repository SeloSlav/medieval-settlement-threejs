export const DELIVERY_TRIP_PHASES = ['outbound', 'unloading', 'inbound'] as const;
export type DeliveryTripPhase = (typeof DELIVERY_TRIP_PHASES)[number];

export type DeliveryCargoKind = 'firewood' | 'water' | 'food';

export type DeliveryTripState = {
  id: string;
  buildingId: string;
  residenceId: string;
  cargoKind: DeliveryCargoKind;
  amount: number;
  phase: DeliveryTripPhase;
  x: number;
  z: number;
  progress: number;
  speedMps: number;
  unloadSeconds: number;
  unloadRemaining: number;
  deliveryWorkers: number;
};

export function cargoKindFromId(value: number): DeliveryCargoKind | null {
  switch (value) {
    case 0:
      return 'firewood';
    case 1:
      return 'water';
    case 2:
      return 'food';
    default:
      return null;
  }
}

export function phaseFromId(value: number): DeliveryTripPhase {
  switch (value) {
    case 1:
      return 'unloading';
    case 2:
      return 'inbound';
    default:
      return 'outbound';
  }
}

export function findActiveTripForBuilding(
  trips: Iterable<DeliveryTripState>,
  buildingId: string,
): DeliveryTripState | null {
  for (const trip of trips) {
    if (trip.buildingId === buildingId) return trip;
  }
  return null;
}

/** Remaining round-trip time from authoritative trip state and live path distance.
 *  Keep in sync with server `active_trip_remaining_seconds` in delivery_trips.rs. */
export function tripRemainingSeconds(trip: DeliveryTripState, pathDistance: number | null): number {
  if (pathDistance == null || pathDistance <= 1e-6) return Infinity;

  const workers = Math.max(1, trip.deliveryWorkers);
  const travelSpeed = trip.speedMps * workers;
  if (travelSpeed <= 1e-9) return Infinity;

  const travelPerLeg = pathDistance / travelSpeed;
  const unloadTotal = trip.unloadSeconds / workers;
  const progress = Math.min(Math.max(0, trip.progress), pathDistance);

  switch (trip.phase) {
    case 'outbound':
      return (pathDistance - progress) / travelSpeed + unloadTotal + travelPerLeg;
    case 'unloading':
      return Math.max(0, trip.unloadRemaining) + travelPerLeg;
    case 'inbound':
      return (pathDistance - progress) / travelSpeed;
    default:
      return Infinity;
  }
}

export function formatTripPhaseLabel(phase: DeliveryTripPhase): string {
  switch (phase) {
    case 'outbound':
      return 'Outbound';
    case 'unloading':
      return 'Unloading';
    case 'inbound':
      return 'Returning';
  }
}

export function cargoColor(kind: DeliveryCargoKind): number {
  switch (kind) {
    case 'firewood':
      return 0xc46a2e;
    case 'water':
      return 0x3f8fd6;
    case 'food':
      return 0x5f9f4a;
  }
}
