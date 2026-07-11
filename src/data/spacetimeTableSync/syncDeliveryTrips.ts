import type { DeliveryTrip } from '../../generated/types.ts';
import {
  cargoKindFromId,
  phaseFromId,
  type DeliveryTripState,
} from '../../logistics/deliveryTrips.ts';
import { buildingClientId, residenceClientId, tripClientId } from '../spacetimeIds.ts';

export function syncDeliveryTrips(
  rows: Iterable<DeliveryTrip>,
  identityHex: string | null,
): Map<string, DeliveryTripState> {
  const deliveryTrips = new Map<string, DeliveryTripState>();
  if (!identityHex) return deliveryTrips;

  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const cargoKind = cargoKindFromId(Number(row.cargoKind));
    if (!cargoKind) continue;
    const tripId = tripClientId(row.id);
    deliveryTrips.set(tripId, {
      id: tripId,
      buildingId: buildingClientId(row.buildingId),
      residenceId: residenceClientId(row.residenceId),
      cargoKind,
      amount: row.amount,
      phase: phaseFromId(Number(row.phase)),
      x: row.x,
      z: row.z,
      progress: row.progress,
      speedMps: row.speedMps,
      unloadSeconds: row.unloadSeconds,
      unloadRemaining: row.unloadRemaining,
      deliveryWorkers: Number(row.deliveryWorkers),
    });
  }
  return deliveryTrips;
}
