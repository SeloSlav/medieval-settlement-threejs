import type { BuildingState, GameState, ResidenceState } from '../resources/types.ts';
import { decodeRoutePolyline } from './routePolyline.ts';
import { roadPathDistance, roadPathRoute } from './roadLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { PointXZ } from '../utils/pathGeometry.ts';

export const DELIVERY_TRIP_PHASES = ['outbound', 'unloading', 'inbound'] as const;
export type DeliveryTripPhase = (typeof DELIVERY_TRIP_PHASES)[number];

/** Mirrors server `CommodityKind::as_u8` / residence need cargo ids on delivery trips. */
export const DELIVERY_CARGO_KINDS = [
  'firewood',
  'water',
  'food',
  'timber',
  'grain',
  'flour',
  'ale',
  'preservedFood',
  'honey',
  'wine',
  'stone',
  'polearms',
  'ironwork',
  'wool',
  'cloth',
  'gold',
  'barley',
  'malt',
] as const;
export type DeliveryCargoKind = (typeof DELIVERY_CARGO_KINDS)[number];

export const DELIVERY_DESTINATION_KINDS = [
  'residence',
  'building',
  'fire',
  'wealth',
] as const;
export type DeliveryDestinationKind = (typeof DELIVERY_DESTINATION_KINDS)[number];

export type DeliveryTripState = {
  id: string;
  buildingId: string;
  residenceId: string | null;
  destinationKind: DeliveryDestinationKind;
  targetBuildingId: string | null;
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
  freeHaulerWorkers: number;
  pathDistance: number;
  travelSpeedMultiplier: number;
  routePolylineJson: string;
};

export type TripEndpoint = {
  origin: BuildingState;
  destinationX: number;
  destinationZ: number;
};

export function rosteredCartWorkers(
  building: Pick<BuildingState, 'assignedLabor'>,
  trip: DeliveryTripState | null | undefined,
): number {
  if (!trip) return 0;
  return Math.min(
    Math.max(0, building.assignedLabor),
    Math.max(0, trip.deliveryWorkers - trip.freeHaulerWorkers),
  );
}

/**
 * Counts regular workplace staff who are physically traveling with active
 * carts. Free founders' camp and institutional haulers do not belong to a
 * producer's visible roster and therefore must not displace a workplace body.
 */
export function rosteredCartWorkersByBuilding(
  buildings: ReadonlyMap<string, Pick<BuildingState, 'assignedLabor'>>,
  trips: Iterable<DeliveryTripState>,
): Map<string, number> {
  const travelingWorkers = new Map<string, number>();
  for (const trip of trips) {
    if (!buildings.has(trip.buildingId)) continue;
    const rosteredWorkers = Math.max(
      0,
      Math.floor(trip.deliveryWorkers) - Math.floor(trip.freeHaulerWorkers),
    );
    if (rosteredWorkers <= 0) continue;
    travelingWorkers.set(
      trip.buildingId,
      (travelingWorkers.get(trip.buildingId) ?? 0) + rosteredWorkers,
    );
  }

  for (const [buildingId, workerCount] of travelingWorkers) {
    const building = buildings.get(buildingId);
    if (!building) {
      travelingWorkers.delete(buildingId);
      continue;
    }
    travelingWorkers.set(
      buildingId,
      Math.min(Math.max(0, Math.floor(building.assignedLabor)), workerCount),
    );
  }
  return travelingWorkers;
}

/** Mirrors the server's authoritative physical-presence rule. */
export function onsiteBuildingLabor(
  building: Pick<BuildingState, 'assignedLabor'>,
  trip: DeliveryTripState | null | undefined,
): number {
  return Math.max(0, building.assignedLabor - rosteredCartWorkers(building, trip));
}

/** Stable identity for the regular hauler attached to a producer between trips. */
export function deliveryWorkerPersonIdentity(
  trip: DeliveryTripState,
  crewIndex = 0,
): string {
  return `delivery:${trip.buildingId}:hauler:${Math.max(0, Math.floor(crewIndex))}`;
}

export function cargoKindFromId(value: number): DeliveryCargoKind | null {
  switch (value) {
    case 0:
      return 'firewood';
    case 1:
      return 'water';
    case 2:
      return 'food';
    case 3:
      return 'timber';
    case 4:
      return 'grain';
    case 5:
      return 'flour';
    case 6:
      return 'ale';
    case 7:
      return 'preservedFood';
    case 8:
      return 'honey';
    case 9:
      return 'wine';
    case 10:
      return 'stone';
    case 11:
      return 'polearms';
    case 12:
      return 'ironwork';
    case 13:
      return 'wool';
    case 14:
      return 'cloth';
    case 15:
      return 'gold';
    case 16:
      return 'barley';
    case 17:
      return 'malt';
    default:
      return null;
  }
}

export function destinationKindFromId(value: number): DeliveryDestinationKind | null {
  switch (value) {
    case 0:
      return 'residence';
    case 1:
      return 'building';
    case 2:
      return 'fire';
    case 3:
      return 'wealth';
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

export function cargoKindLabel(kind: DeliveryCargoKind): string {
  switch (kind) {
    case 'firewood':
      return 'Firewood';
    case 'water':
      return 'Water';
    case 'food':
      return 'Food';
    case 'timber':
      return 'Timber';
    case 'grain':
      return 'Grain';
    case 'barley':
      return 'Barley';
    case 'malt':
      return 'Malt';
    case 'flour':
      return 'Flour';
    case 'ale':
      return 'Ale';
    case 'preservedFood':
      return 'Preserved food';
    case 'honey':
      return 'Honey';
    case 'wine':
      return 'Wine';
    case 'stone':
      return 'Stone';
    case 'polearms':
      return 'Polearms';
    case 'ironwork':
      return 'Ironwork';
    case 'wool':
      return 'Raw textile fibre';
    case 'cloth':
      return 'Cloth';
    case 'gold':
      return 'Gold';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function resolveTripEndpoints(
  trip: DeliveryTripState,
  state: Pick<GameState, 'buildings' | 'residences'>,
): TripEndpoint | null {
  const origin = state.buildings.get(trip.buildingId);
  if (!origin) return null;

  if (trip.destinationKind === 'building') {
    if (!trip.targetBuildingId) return null;
    const target = state.buildings.get(trip.targetBuildingId);
    if (!target) return null;
    return { origin, destinationX: target.x, destinationZ: target.z };
  }

  if (trip.destinationKind === 'fire') {
    if (trip.targetBuildingId) {
      const target = state.buildings.get(trip.targetBuildingId);
      if (target) return { origin, destinationX: target.x, destinationZ: target.z };
    }
    if (trip.residenceId) {
      const target = state.residences.get(trip.residenceId);
      if (target) return { origin, destinationX: target.x, destinationZ: target.z };
    }
    return null;
  }

  if (!trip.residenceId) return null;
  const residence = state.residences.get(trip.residenceId);
  if (!residence) return null;
  return { origin, destinationX: residence.x, destinationZ: residence.z };
}

export function tripPathDistance(
  network: RoadNetwork,
  trip: DeliveryTripState,
  state: Pick<GameState, 'buildings' | 'residences'>,
): number | null {
  if (trip.pathDistance > 1e-6) return trip.pathDistance;

  const endpoints = resolveTripEndpoints(trip, state);
  if (!endpoints) return null;
  return roadPathDistance(
    network,
    endpoints.origin.x,
    endpoints.origin.z,
    endpoints.destinationX,
    endpoints.destinationZ,
  );
}

export function tripRoutePolyline(
  network: RoadNetwork,
  trip: DeliveryTripState,
  state: Pick<GameState, 'buildings' | 'residences'>,
): PointXZ[] | null {
  const cached = decodeRoutePolyline(trip.routePolylineJson);
  if (cached && cached.length >= 2) return cached;

  const endpoints = resolveTripEndpoints(trip, state);
  if (!endpoints) return null;
  return roadPathRoute(
    network,
    endpoints.origin.x,
    endpoints.origin.z,
    endpoints.destinationX,
    endpoints.destinationZ,
  )?.polyline ?? null;
}

export function formatTripDestinationLabel(
  trip: DeliveryTripState | null,
  getResidence: (id: string) => ResidenceState | null,
  fallback: string,
): string {
  if (!trip) return fallback;
  if (
    trip.destinationKind !== 'residence'
    && trip.destinationKind !== 'wealth'
  ) return fallback;
  if (!trip.residenceId) return fallback;
  const residence = getResidence(trip.residenceId);
  if (!residence) return fallback;
  return `Parcel #${residence.parcelIndex + 1}`;
}

export function formatTripBuildingDestinationLabel(
  trip: DeliveryTripState | null,
  getBuildingLabel: (kind: BuildingState['kind']) => string,
  getBuilding: (id: string) => BuildingState | null,
  fallback: string,
): string {
  if (!trip || trip.destinationKind !== 'building' || !trip.targetBuildingId) return fallback;
  const target = getBuilding(trip.targetBuildingId);
  if (!target) return fallback;
  return getBuildingLabel(target.kind);
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

export function findInboundTimberTripForBuilding(
  trips: Iterable<DeliveryTripState>,
  buildingId: string,
): DeliveryTripState | null {
  for (const trip of trips) {
    if (
      trip.cargoKind === 'timber'
      && trip.destinationKind === 'building'
      && trip.targetBuildingId === buildingId
    ) {
      return trip;
    }
  }
  return null;
}

export function findInboundSupplyTripForBuilding(
  trips: Iterable<DeliveryTripState>,
  buildingId: string,
): DeliveryTripState | null {
  for (const trip of trips) {
    if (
      trip.phase !== 'inbound'
      && trip.destinationKind === 'building'
      && trip.targetBuildingId === buildingId
    ) {
      return trip;
    }
  }
  return null;
}

/** Remaining round-trip time from authoritative trip state and live path distance.
 *  Keep in sync with server `active_trip_remaining_seconds` in delivery_trips.rs. */
export function tripRemainingSeconds(trip: DeliveryTripState, pathDistance: number | null): number {
  if (pathDistance == null || pathDistance <= 1e-6) return Infinity;

  const workers = Math.max(1, trip.deliveryWorkers);
  const travelSpeed = trip.speedMps * workers * Math.max(1e-6, trip.travelSpeedMultiplier);
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
    default: {
      const _exhaustive: never = trip.phase;
      return _exhaustive;
    }
  }
}

/**
 * Time until a loaded cart finishes unloading at its destination. Unlike
 * `tripRemainingSeconds`, this excludes the empty return leg so economic
 * forecasts can decide whether traveling stock will arrive before a site
 * runs dry.
 */
export function tripDeliveryRemainingSeconds(trip: DeliveryTripState): number {
  if (trip.phase === 'inbound') return Infinity;

  const workers = Math.max(1, trip.deliveryWorkers);
  if (trip.phase === 'unloading') {
    return Math.max(0, trip.unloadRemaining);
  }

  const pathDistance = Number.isFinite(trip.pathDistance)
    ? Math.max(0, trip.pathDistance)
    : 0;
  const travelSpeed = trip.speedMps * workers * Math.max(1e-6, trip.travelSpeedMultiplier);
  if (pathDistance <= 1e-6 || travelSpeed <= 1e-9) return Infinity;

  const progress = Math.min(Math.max(0, trip.progress), pathDistance);
  return (pathDistance - progress) / travelSpeed + trip.unloadSeconds / workers;
}

export function deliveryLegRemainingMeters(
  pathDistance: number,
  progress: number,
  phase: DeliveryTripPhase,
): number | null {
  if (!Number.isFinite(pathDistance) || pathDistance <= 1e-6) return null;
  if (phase === 'unloading') return 0;
  return Math.max(0, pathDistance - Math.max(0, progress));
}

export function formatTripPhaseLabel(phase: DeliveryTripPhase): string {
  switch (phase) {
    case 'outbound':
      return 'Outbound';
    case 'unloading':
      return 'Unloading';
    case 'inbound':
      return 'Returning';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
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
    case 'timber':
      return 0x8a684c;
    case 'grain':
      return 0xc9a227;
    case 'barley':
      return 0xb99232;
    case 'malt':
      return 0x9d7335;
    case 'flour':
      return 0xe8dcc8;
    case 'ale':
      return 0xb8860b;
    case 'preservedFood':
      return 0x8b5a3c;
    case 'honey':
      return 0xd4a017;
    case 'wine':
      return 0x6b2d5c;
    case 'stone':
      return 0x8b8985;
    case 'polearms':
      return 0x695642;
    case 'ironwork':
      return 0x687078;
    case 'wool':
      return 0xd8d1c2;
    case 'cloth':
      return 0x52697a;
    case 'gold':
      return 0xd4af37;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
