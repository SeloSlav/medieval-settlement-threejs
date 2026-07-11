import {
  FIREWOOD_DELIVERY_SPEED_MPS,
  FIREWOOD_DELIVERY_UNLOAD_SEC,
  FOOD_DELIVERY_SPEED_MPS,
  FOOD_DELIVERY_UNLOAD_SEC,
  MIN_DELIVERY_TRIP_SEC,
  WATER_DELIVERY_SPEED_MPS,
  WATER_DELIVERY_UNLOAD_SEC,
} from '../generated/gameBalance.ts';
import { roadPathDistance } from './roadLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';

type RoadPoint = { x: number; z: number };

/** Planned round-trip duration; mirrors server `planned_delivery_trip_seconds`. */
export function roadDeliveryTripSeconds(
  network: RoadNetwork,
  origin: RoadPoint,
  target: RoadPoint | null,
  speedMps: number,
  deliveryWorkers: number,
  unloadSeconds: number,
): number {
  if (deliveryWorkers <= 0 || speedMps <= 1e-9 || !target) {
    return Infinity;
  }

  const oneWayMeters = roadPathDistance(network, origin.x, origin.z, target.x, target.z);
  if (oneWayMeters == null) {
    return Infinity;
  }

  const workers = Math.max(1, deliveryWorkers);
  const roundTripMeters = oneWayMeters * 2;
  const travelSeconds = roundTripMeters / (speedMps * workers);
  const tripSeconds = travelSeconds + unloadSeconds / workers;
  return Math.max(MIN_DELIVERY_TRIP_SEC, tripSeconds);
}

export function roadDeliveryOneWayMeters(
  network: RoadNetwork,
  origin: RoadPoint,
  target: RoadPoint | null,
): number | null {
  if (!target) return null;
  return roadPathDistance(network, origin.x, origin.z, target.x, target.z);
}

export function firewoodDeliveryTripSeconds(
  network: RoadNetwork,
  origin: RoadPoint,
  target: RoadPoint | null,
  deliveryWorkers: number,
): number {
  return roadDeliveryTripSeconds(
    network,
    origin,
    target,
    FIREWOOD_DELIVERY_SPEED_MPS,
    deliveryWorkers,
    FIREWOOD_DELIVERY_UNLOAD_SEC,
  );
}

export function waterDeliveryTripSeconds(
  network: RoadNetwork,
  origin: RoadPoint,
  target: RoadPoint | null,
  deliveryWorkers: number,
): number {
  return roadDeliveryTripSeconds(
    network,
    origin,
    target,
    WATER_DELIVERY_SPEED_MPS,
    deliveryWorkers,
    WATER_DELIVERY_UNLOAD_SEC,
  );
}

export function foodDeliveryTripSeconds(
  network: RoadNetwork,
  origin: RoadPoint,
  target: RoadPoint | null,
  deliveryWorkers: number,
): number {
  return roadDeliveryTripSeconds(
    network,
    origin,
    target,
    FOOD_DELIVERY_SPEED_MPS,
    deliveryWorkers,
    FOOD_DELIVERY_UNLOAD_SEC,
  );
}

export function formatDeliveryTripDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds >= 120) return `${Math.ceil(seconds / 60)} min`;
  return `${seconds.toFixed(0)}s`;
}

export function formatDeliveryRoadDistance(meters: number | null): string {
  if (meters == null) return 'off road';
  return `${Math.round(meters)} m one-way`;
}
