import type { DeliveryTrip } from '../../generated/types.ts';
import {
  cargoKindFromId,
  destinationKindFromId,
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
    if (!cargoKind) {
      console.warn('[syncDeliveryTrips] Skipping trip with unknown cargo_kind:', row.cargoKind, row.id);
      continue;
    }

    const destinationKind = destinationKindFromId(Number(row.destinationKind ?? 0));
    if (!destinationKind) {
      console.warn('[syncDeliveryTrips] Skipping trip with unknown destination_kind:', row.destinationKind, row.id);
      continue;
    }

    const tripId = tripClientId(row.id);
    deliveryTrips.set(tripId, {
      id: tripId,
      buildingId: buildingClientId(row.buildingId),
      residenceId: destinationKind === 'residence' ? residenceClientId(row.residenceId) : null,
      destinationKind,
      targetBuildingId: destinationKind === 'building'
        ? buildingClientId(row.targetBuildingId)
        : null,
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
      pathDistance: Number(row.pathDistance ?? 0),
      travelSpeedMultiplier: Number(row.travelSpeedMultiplier ?? 1),
      routePolylineJson: row.routePolylineJson ?? '',
    });
  }
  return deliveryTrips;
}
