import type { BuildingState, GameState, ResidenceState } from '../resources/types.ts';
import { decodeRoutePolyline } from './routePolyline.ts';
import { localDeliveryRoute } from './roadLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { PointXZ } from '../utils/pathGeometry.ts';
import { WORKFORCE_MOVEMENT_SPEED_MULTIPLIER } from '../generated/gameBalance.ts';

export const DELIVERY_TRIP_PHASES = ['outbound', 'unloading', 'inbound'] as const;
export type DeliveryTripPhase = (typeof DELIVERY_TRIP_PHASES)[number];

/** Mirrors server `CommodityKind::as_u8` / residence need cargo ids on delivery trips. */
export const DELIVERY_CARGO_KINDS = [
  'firewood',
  'water',
  'timber',
  'ale',
  'cider',
  'mead',
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
  'flax',
  'iron',
  'clay',
  'salt',
  'charcoal',
  'pottery',
  'manure',
  'remedies',
  'roofTiles',
  'meat',
  'fish',
  'berries',
  'mushrooms',
  'milk',
  'apples',
  'pears',
  'cherries',
  'aronia',
  'rosehips',
  'cabbage',
  'carrots',
  'beetroot',
  'eggs',
  'grapes',
  'curedMeat',
  'smokedFish',
  'cheese',
  'ryeSheaves',
  'oatSheaves',
  'barleySheaves',
  'maslinSheaves',
  'ryeGrain',
  'oatGrain',
  'maslinGrain',
  'ryeFlour',
  'maslinFlour',
  'ryeBread',
  'maslinBread',
  'pelts',
  'hides',
  'leather',
  'shoes',
  'jam',
  'animalFeed',
  'wax',
  'candles',
  'yarn',
  'linen',
  'sidearms',
  'shields',
  'bows',
  'crossbows',
  'paddedArmor',
  'mailArmor',
  'ammunition',
] as const;
export type DeliveryCargoKind = (typeof DELIVERY_CARGO_KINDS)[number];

export const DELIVERY_DESTINATION_KINDS = [
  'residence',
  'building',
  'fire',
  'wealth',
  'care',
  'trade',
  'military',
] as const;
export type DeliveryDestinationKind = (typeof DELIVERY_DESTINATION_KINDS)[number];

export type DeliveryTripState = {
  id: string;
  buildingId: string;
  laborBuildingId?: string | null;
  residenceId: string | null;
  destinationKind: DeliveryDestinationKind;
  targetBuildingId: string | null;
  /** Company rendezvous for a physical field-supply cart. */
  targetCompanyId?: string | null;
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
  /** Reserved draft ox; absent/null for ordinary hand carts and legacy rows. */
  oxId?: string | null;
  pathDistance: number;
  travelSpeedMultiplier: number;
  routePolylineJson: string;
};

export const VISIBLE_CART_CARGO_EPSILON = 0.05;
export const EMPTY_CART_SPEED_MULTIPLIER = 1.3;
const PENDING_DELIVERY_CARGO_EPSILON = 1e-6;

export function deliveryTripHasVisibleCargo(
  trip: Pick<DeliveryTripState, 'amount'>,
): boolean {
  return trip.amount > VISIBLE_CART_CARGO_EPSILON;
}

export function deliveryTripHasPendingCargo(
  trip: Pick<DeliveryTripState, 'amount' | 'phase'>,
): boolean {
  return Number.isFinite(trip.amount)
    && trip.amount > PENDING_DELIVERY_CARGO_EPSILON
    && trip.phase !== 'inbound';
}

/**
 * Mirrors server `inbound_supply_trip_conflicts`. Ordinary buildings receive
 * one supply cart at a time; independent Marketplace tables may receive
 * distinct commodities concurrently, but never duplicate the same cargo.
 */
export function inboundSupplyTripConflicts(
  targetKind: BuildingState['kind'],
  requestedCargoKind: DeliveryCargoKind,
  trip: Pick<
    DeliveryTripState,
    'amount' | 'phase' | 'destinationKind' | 'cargoKind'
  >,
): boolean {
  return trip.destinationKind === 'building'
    && deliveryTripHasPendingCargo(trip)
    && (targetKind !== 'marketplace' || trip.cargoKind === requestedCargoKind);
}

export function findConflictingInboundSupplyTripForBuilding(
  trips: Iterable<DeliveryTripState>,
  target: Pick<BuildingState, 'id' | 'kind'>,
  requestedCargoKind: DeliveryCargoKind,
): DeliveryTripState | null {
  for (const trip of trips) {
    if (
      trip.targetBuildingId === target.id
      && inboundSupplyTripConflicts(target.kind, requestedCargoKind, trip)
    ) {
      return trip;
    }
  }
  return null;
}

export function deliveryTripTravelSpeed(
  trip: Pick<
    DeliveryTripState,
    'amount' | 'speedMps' | 'deliveryWorkers' | 'travelSpeedMultiplier'
  >,
): number {
  const loadMultiplier = deliveryTripHasVisibleCargo(trip)
    ? 1
    : EMPTY_CART_SPEED_MULTIPLIER;
  return trip.speedMps
    * WORKFORCE_MOVEMENT_SPEED_MULTIPLIER
    * Math.max(1, trip.deliveryWorkers)
    * Math.max(1e-6, trip.travelSpeedMultiplier)
    * loadMultiplier;
}

export type TripEndpoint = {
  origin: BuildingState;
  destinationX: number;
  destinationZ: number;
};

export function rosteredCartWorkers(
  building: Pick<BuildingState, 'assignedLabor'> & Partial<Pick<BuildingState, 'id'>>,
  trip: DeliveryTripState | null | undefined,
): number {
  if (!trip) return 0;
  const laborBuildingId = tripLaborBuildingId(trip);
  if (laborBuildingId == null) return 0;
  if (building.id != null && laborBuildingId !== building.id) return 0;
  return Math.min(
    Math.max(0, building.assignedLabor),
    Math.max(0, trip.deliveryWorkers - trip.freeHaulerWorkers),
  );
}

export function tripLaborBuildingId(trip: DeliveryTripState): string | null {
  if (trip.laborBuildingId) return trip.laborBuildingId;
  // Compatibility for trips synchronized from a pre-split server schema.
  return trip.freeHaulerWorkers < trip.deliveryWorkers ? trip.buildingId : null;
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
    const laborBuildingId = tripLaborBuildingId(trip);
    if (!laborBuildingId || !buildings.has(laborBuildingId)) continue;
    const rosteredWorkers = Math.max(
      0,
      Math.floor(trip.deliveryWorkers) - Math.floor(trip.freeHaulerWorkers),
    );
    if (rosteredWorkers <= 0) continue;
    travelingWorkers.set(
      laborBuildingId,
      (travelingWorkers.get(laborBuildingId) ?? 0) + rosteredWorkers,
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
  building: Pick<BuildingState, 'assignedLabor'> & Partial<Pick<BuildingState, 'id'>>,
  trip: DeliveryTripState | null | undefined,
): number {
  return Math.max(0, building.assignedLabor - rosteredCartWorkers(building, trip));
}

export function raidWithdrawingCartCount(
  trips: Iterable<DeliveryTripState>,
  activeRaiderThreat: boolean,
): number {
  if (!activeRaiderThreat) return 0;
  let count = 0;
  for (const trip of trips) {
    if (
      trip.destinationKind !== 'fire'
      && trip.phase === 'inbound'
      && !isRegionalMarketTrip(trip)
    ) {
      count += 1;
    }
  }
  return count;
}

export function isRegionalImportTrip(trip: DeliveryTripState): boolean {
  return (
    trip.targetBuildingId === trip.buildingId
    && (
      trip.destinationKind === 'building'
      || trip.destinationKind === 'residence'
    )
  );
}

export function isRegionalExportTrip(trip: DeliveryTripState): boolean {
  return (
    trip.destinationKind === 'trade'
    && trip.targetBuildingId === trip.buildingId
  );
}

export function isRegionalMarketTrip(trip: DeliveryTripState): boolean {
  return isRegionalImportTrip(trip) || isRegionalExportTrip(trip);
}

/** Stable identity for the regular hauler attached to a producer between trips. */
export function deliveryWorkerPersonIdentity(
  trip: DeliveryTripState,
  crewIndex = 0,
): string {
  if (isRegionalMarketTrip(trip)) {
    return `regional-merchant:${trip.id}:crew:${Math.max(0, Math.floor(crewIndex))}`;
  }
  return `delivery:${trip.buildingId}:hauler:${Math.max(0, Math.floor(crewIndex))}`;
}

export function cargoKindFromId(value: number): DeliveryCargoKind | null {
  switch (value) {
    case 0:
      return 'firewood';
    case 1:
      return 'water';
    case 3:
      return 'timber';
    case 4:
      return 'pears';
    case 5:
      return 'aronia';
    case 6:
      return 'ale';
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
    case 18:
      return 'flax';
    case 19:
      return 'iron';
    case 20:
      return 'clay';
    case 21:
      return 'salt';
    case 22:
      return 'charcoal';
    case 23:
      return 'pottery';
    case 24:
      return 'manure';
    case 25:
      return 'remedies';
    case 26:
      return 'roofTiles';
    case 27:
      return 'rosehips';
    case 28:
      return 'meat';
    case 29:
      return 'fish';
    case 30:
      return 'berries';
    case 31:
      return 'mushrooms';
    case 32:
      return 'milk';
    case 33:
      return 'apples';
    case 34:
      return 'cherries';
    case 36:
      return 'eggs';
    case 37:
      return 'grapes';
    case 38:
      return 'cabbage';
    case 39:
      return 'curedMeat';
    case 40:
      return 'smokedFish';
    case 41:
      return 'cheese';
    case 42:
      return 'ryeSheaves';
    case 43:
      return 'oatSheaves';
    case 44:
      return 'barleySheaves';
    case 45:
      return 'maslinSheaves';
    case 46:
      return 'ryeGrain';
    case 47:
      return 'oatGrain';
    case 48:
      return 'maslinGrain';
    case 49:
      return 'ryeFlour';
    case 50:
      return 'carrots';
    case 51:
      return 'maslinFlour';
    case 52:
      return 'ryeBread';
    case 53:
      return 'beetroot';
    case 54:
      return 'maslinBread';
    case 55:
      return 'cider';
    case 56:
      return 'mead';
    case 58:
      return 'hides';
    case 59:
      return 'leather';
    case 60:
      return 'shoes';
    case 61:
      return 'jam';
    case 63:
      return 'animalFeed';
    case 64:
      return 'wax';
    case 65:
      return 'candles';
    case 66:
      return 'pelts';
    case 67:
      return 'yarn';
    case 68:
      return 'linen';
    case 69:
      return 'sidearms';
    case 70:
      return 'shields';
    case 71:
      return 'bows';
    case 72:
      return 'crossbows';
    case 73:
      return 'paddedArmor';
    case 74:
      return 'mailArmor';
    case 75:
      return 'ammunition';
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
    case 4:
      return 'care';
    case 5:
      return 'trade';
    case 6:
      return 'military';
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
    case 'timber':
      return 'Timber';
    case 'ryeSheaves':
      return 'Rye sheaves';
    case 'oatSheaves':
      return 'Oat sheaves';
    case 'barleySheaves':
      return 'Barley sheaves';
    case 'maslinSheaves':
      return 'Maslin sheaves';
    case 'ryeGrain':
      return 'Rye grain';
    case 'oatGrain':
      return 'Oats';
    case 'animalFeed':
      return 'Animal feed';
    case 'maslinGrain':
      return 'Maslin grain';
    case 'barley':
      return 'Barley';
    case 'malt':
      return 'Malt';
    case 'ryeFlour':
      return 'Rye flour';
    case 'maslinFlour':
      return 'Maslin flour';
    case 'ale':
      return 'Ale';
    case 'cider':
      return 'Cider';
    case 'mead':
      return 'Mead';
    case 'ryeBread':
      return 'Rye bread';
    case 'maslinBread':
      return 'Maslin bread';
    case 'meat':
      return 'Meat';
    case 'fish':
      return 'Fish';
    case 'berries':
      return 'Raspberries';
    case 'mushrooms':
      return 'Mushrooms';
    case 'milk':
      return 'Milk';
    case 'apples':
      return 'Apples';
    case 'pears':
      return 'Pears';
    case 'cherries':
      return 'Cherries';
    case 'aronia':
      return 'Aronia berries';
    case 'rosehips':
      return 'Rosehips';
    case 'cabbage':
      return 'Cabbage';
    case 'carrots':
      return 'Carrots';
    case 'beetroot':
      return 'Beetroot';
    case 'eggs':
      return 'Eggs';
    case 'grapes':
      return 'Grapes';
    case 'curedMeat':
      return 'Cured meat';
    case 'smokedFish':
      return 'Smoked fish';
    case 'cheese':
      return 'Cheese';
    case 'jam':
      return 'Jam';
    case 'honey':
      return 'Honey';
    case 'wax':
      return 'Beeswax';
    case 'candles':
      return 'Candles';
    case 'wine':
      return 'Wine';
    case 'stone':
      return 'Stone';
    case 'polearms':
      return 'Polearms';
    case 'sidearms':
      return 'Sidearms';
    case 'shields':
      return 'Shields';
    case 'bows':
      return 'Bows';
    case 'crossbows':
      return 'Crossbows';
    case 'paddedArmor':
      return 'Padded armor';
    case 'mailArmor':
      return 'Mail armor';
    case 'ammunition':
      return 'Ammunition';
    case 'ironwork':
      return 'Ironwork';
    case 'wool':
      return 'Wool fleece';
    case 'flax':
      return 'Flax fibre';
    case 'yarn':
      return 'Yarn';
    case 'linen':
      return 'Linen';
    case 'cloth':
      return 'Clothing';
    case 'pelts':
      return 'Wild-game pelts';
    case 'hides':
      return 'Untanned hides';
    case 'leather':
      return 'Leather';
    case 'shoes':
      return 'Shoes';
    case 'gold':
      return 'Gold';
    case 'iron':
      return 'Raw iron';
    case 'clay':
      return 'River clay';
    case 'salt':
      return 'Salt';
    case 'charcoal':
      return 'Charcoal';
    case 'pottery':
      return 'Pottery';
    case 'manure':
      return 'Field manure';
    case 'remedies':
      return 'Dried remedies';
    case 'roofTiles':
      return 'Fired roof tiles';
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

  if (trip.destinationKind === 'trade' || trip.destinationKind === 'military') return null;

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
  return localDeliveryRoute(
    network,
    endpoints.origin.x,
    endpoints.origin.z,
    endpoints.destinationX,
    endpoints.destinationZ,
  )?.distance ?? null;
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
  return localDeliveryRoute(
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
    && trip.destinationKind !== 'care'
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
      deliveryTripHasPendingCargo(trip)
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
  const travelSpeed = deliveryTripTravelSpeed(trip);
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
  const travelSpeed = deliveryTripTravelSpeed(trip);
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

export type DeliveryTripPresentation = {
  eyebrow: string;
  activity: string;
  current: string;
  occupation: 'Cart hauler' | 'Cart guide' | 'Regional merchant';
  workplaceHeading: 'Origin' | 'Contracting market';
  routeHeading: 'Route target' | 'Trade leg';
  routeTarget: string;
  cargoSummary: string;
};

/**
 * Human-readable account of the same route encoded by the authoritative trip.
 * External imports use the marketplace as their save-compatible origin and
 * target marker, even though the loaded merchant actually starts at the map
 * edge. Keeping this distinction here prevents the inspector from describing
 * a live Adriatic caravan as a local cart delivering a market to itself.
 */
export function describeDeliveryTrip(
  trip: DeliveryTripState,
  originLabel: string,
  destinationLabel: string,
): DeliveryTripPresentation {
  const cargo = cargoKindLabelForTrip(trip);
  const cargoLower = cargo.toLocaleLowerCase();
  const cargoAmount = formatCargoAmount(trip.amount);
  const crew = trip.oxId
    ? trip.deliveryWorkers === 1
      ? '1 guide - ox-drawn'
      : `1 guide + ${trip.deliveryWorkers - 1} ${
          trip.deliveryWorkers === 2 ? 'hauler' : 'haulers'
        } - ox-drawn`
    : `${trip.deliveryWorkers} ${
        trip.deliveryWorkers === 1 ? 'hauler' : 'haulers'
      }`;
  const returning = trip.phase === 'inbound';
  const returningLoaded = returning && trip.amount > 0.05;
  const regionalImport = isRegionalImportTrip(trip);
  const regionalExport = isRegionalExportTrip(trip);

  if (regionalImport) {
    const routeTarget = returning ? 'Adriatic trade route' : destinationLabel;
    return {
      eyebrow: `Regional merchant - ${formatTripPhaseLabel(trip.phase)}`,
      activity: returning
        ? `Returning empty from ${destinationLabel} to the Adriatic trade route`
        : trip.phase === 'unloading'
          ? `Unloading ${cargoLower} at ${destinationLabel}`
          : `Bringing ${cargoAmount} ${cargoLower} from the Adriatic trade route to ${destinationLabel}`,
      current: returning
        ? 'Returning to the Adriatic trade route'
        : trip.phase === 'unloading'
          ? `Unloading at ${destinationLabel}`
          : 'Inbound from the Adriatic trade route',
      occupation: 'Regional merchant',
      workplaceHeading: 'Contracting market',
      routeHeading: 'Trade leg',
      routeTarget,
      cargoSummary: returning
        ? `Empty - ${cargo} import`
        : `${cargoAmount} ${cargoLower} - ${crew}`,
    };
  }

  if (regionalExport) {
    return {
      eyebrow: `Regional merchant - ${formatTripPhaseLabel(trip.phase)}`,
      activity: returning
        ? returningLoaded
          ? `Returning ${cargoAmount} ${cargoLower} from the regional exchange to ${originLabel}`
          : `Returning empty from the regional exchange to ${originLabel}`
        : trip.phase === 'unloading'
          ? `Exchanging ${cargoAmount} ${cargoLower} at the regional route`
          : `Carrying ${cargoAmount} ${cargoLower} from ${originLabel} to the regional exchange`,
      current: returning
        ? `Returning receipts to ${originLabel}`
        : trip.phase === 'unloading'
          ? 'Settling at regional exchange'
          : 'Outbound on regional route',
      occupation: 'Regional merchant',
      workplaceHeading: 'Contracting market',
      routeHeading: 'Trade leg',
      routeTarget: returning ? originLabel : 'Regional exchange route',
      cargoSummary: returning
        ? returningLoaded
          ? `${cargoAmount} ${cargoLower} - ${crew}`
          : `Empty - ${cargo} run`
        : `${cargoAmount} ${cargoLower} - ${crew}`,
    };
  }

  return {
    eyebrow: `Delivery agent - ${formatTripPhaseLabel(trip.phase)}`,
    activity: returning
      ? returningLoaded
        ? `Returning ${cargoAmount} undelivered ${cargoLower} to ${originLabel}`
        : `Returning to ${originLabel} after the ${cargoLower} delivery`
      : trip.phase === 'unloading'
        ? `Unloading ${cargoLower} at ${destinationLabel}`
        : `Delivering ${cargoAmount} ${cargoLower} to ${destinationLabel}`,
    current: returning
      ? `Returning to ${originLabel}`
      : trip.phase === 'unloading'
        ? `Unloading at ${destinationLabel}`
        : `Traveling to ${destinationLabel}`,
    occupation: trip.oxId ? 'Cart guide' : 'Cart hauler',
    workplaceHeading: 'Origin',
    routeHeading: 'Route target',
    routeTarget: returning ? originLabel : destinationLabel,
    cargoSummary: returning
      ? returningLoaded
        ? `${cargoAmount} ${cargoLower} - ${crew}`
        : `Empty - ${cargo} run`
      : `${cargoAmount} ${cargoLower} - ${crew}`,
  };
}

export function cargoKindLabelForTrip(trip: DeliveryTripState): string {
  const label = cargoKindLabel(trip.cargoKind);
  if (!isRegionalImportTrip(trip)) return label;
  switch (trip.cargoKind) {
    case 'iron':
      return 'Imported iron bars';
    case 'salt':
      return 'Adriatic salt';
    case 'water':
      return 'Imported water';
    default:
      return `Imported ${label.toLocaleLowerCase()}`;
  }
}

function formatCargoAmount(amount: number): string {
  return Math.max(0, Math.round(amount)).toLocaleString();
}

export function cargoColor(kind: DeliveryCargoKind): number {
  switch (kind) {
    case 'firewood':
      return 0xc46a2e;
    case 'water':
      return 0x3f8fd6;
    case 'ryeBread':
    case 'maslinBread':
    case 'meat':
    case 'fish':
    case 'berries':
    case 'mushrooms':
    case 'milk':
    case 'apples':
    case 'pears':
    case 'cherries':
    case 'aronia':
    case 'rosehips':
    case 'cabbage':
    case 'carrots':
    case 'beetroot':
    case 'eggs':
    case 'grapes':
      return 0x5f9f4a;
    case 'timber':
      return 0x8a684c;
    case 'ryeSheaves':
    case 'oatSheaves':
    case 'barleySheaves':
    case 'maslinSheaves':
    case 'ryeGrain':
    case 'oatGrain':
    case 'maslinGrain':
      return 0xc9a227;
    case 'barley':
      return 0xb99232;
    case 'malt':
      return 0x9d7335;
    case 'animalFeed':
      return 0x9a7a43;
    case 'ryeFlour':
    case 'maslinFlour':
      return 0xe8dcc8;
    case 'ale':
      return 0xb8860b;
    case 'cider':
      return 0xc27c32;
    case 'mead':
      return 0xd4a017;
    case 'curedMeat':
    case 'smokedFish':
    case 'cheese':
    case 'jam':
      return 0x8b5a3c;
    case 'honey':
      return 0xd4a017;
    case 'wax':
      return 0xc99a42;
    case 'candles':
      return 0xe3c878;
    case 'wine':
      return 0x6b2d5c;
    case 'stone':
      return 0x8b8985;
    case 'polearms':
      return 0x695642;
    case 'sidearms':
      return 0x777b7c;
    case 'shields':
      return 0x805c36;
    case 'bows':
      return 0x8b6845;
    case 'crossbows':
      return 0x5e5042;
    case 'paddedArmor':
      return 0x8b8067;
    case 'mailArmor':
      return 0x747b80;
    case 'ammunition':
      return 0x9a7346;
    case 'ironwork':
      return 0x687078;
    case 'wool':
      return 0xd8d1c2;
    case 'flax':
      return 0xc8ad69;
    case 'yarn':
      return 0xbcae92;
    case 'linen':
      return 0xd7c9a4;
    case 'cloth':
      return 0x52697a;
    case 'pelts':
      return 0xb77945;
    case 'hides':
      return 0xa68768;
    case 'leather':
      return 0x704c32;
    case 'shoes':
      return 0x3d2b22;
    case 'gold':
      return 0xd4af37;
    case 'iron':
      return 0x4f5961;
    case 'clay':
      return 0x8e553d;
    case 'salt':
      return 0xe6e0cf;
    case 'charcoal':
      return 0x26292a;
    case 'pottery':
      return 0xa65e3b;
    case 'roofTiles':
      return 0xb75e3b;
    case 'manure':
      return 0x5f4a2f;
    case 'remedies':
      return 0x74844c;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
