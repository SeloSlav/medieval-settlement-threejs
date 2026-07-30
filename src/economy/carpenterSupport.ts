import {
  CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP,
  CARPENTER_CART_SERVICE_TARGET_TRIPS,
  CARPENTER_CART_SERVICE_TIMBER_PER_TRIP,
  CARPENTER_DELIVERY_SPEED_MULTIPLIER,
  CARPENTER_TIMBER_COST_MULTIPLIER,
  type BuildingKind,
  type BuildingResourceCost,
} from '../generated/gameBalance.ts';
import { roadPathDistance } from '../logistics/roadLogistics.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { getBuildingCost } from '../resources/buildingEconomy.ts';

type RoadPoint = { x: number; z: number };

export type CarpenterSupportBuilding = RoadPoint & {
  id: string;
  kind: BuildingKind;
  constructionComplete: boolean;
  assignedLabor: number;
  timber?: number;
  ironwork?: number;
};

export function isOperationalCarpenter(
  building: CarpenterSupportBuilding,
): boolean {
  return building.kind === 'carpenter'
    && building.constructionComplete
    && building.assignedLabor > 0;
}

/**
 * A staffed carpenter supports the whole road component it can reach. Mirrors
 * the server checks used for both construction discounts and delivery trips.
 */
export function hasRoadLinkedCarpenter(
  buildings: Iterable<CarpenterSupportBuilding>,
  network: RoadNetwork | undefined,
  origin: RoadPoint,
  disabledBuildingIds: ReadonlySet<string> = EMPTY_DISABLED_BUILDINGS,
  isEligible: (building: CarpenterSupportBuilding) => boolean = () => true,
): boolean {
  if (!network) return false;
  for (const building of buildings) {
    if (!isOperationalCarpenter(building)) continue;
    if (disabledBuildingIds.has(building.id)) continue;
    if (!isEligible(building)) continue;
    if (roadPathDistance(network, origin.x, origin.z, building.x, building.z) != null) {
      return true;
    }
  }
  return false;
}

export function buildingCostWithCarpenterSupport(
  kind: BuildingKind,
  supported: boolean,
): BuildingResourceCost {
  const cost = getBuildingCost(kind);
  return {
    timber: cost.timber * (supported ? CARPENTER_TIMBER_COST_MULTIPLIER : 1),
    stone: cost.stone,
    ironwork: cost.ironwork,
  };
}

export function carpenterDeliverySpeedMultiplier(
  buildings: Iterable<CarpenterSupportBuilding>,
  network: RoadNetwork,
  origin: RoadPoint,
  disabledBuildingIds: ReadonlySet<string> = EMPTY_DISABLED_BUILDINGS,
): number {
  return hasRoadLinkedCarpenter(
    buildings,
    network,
    origin,
    disabledBuildingIds,
    carpenterCartServiceReady,
  )
    ? CARPENTER_DELIVERY_SPEED_MULTIPLIER
    : 1;
}

/** Number of accelerated departures the workshop can currently service. */
export function carpenterCartServiceTripsAvailable(
  building: Pick<CarpenterSupportBuilding, 'timber' | 'ironwork'>,
): number {
  const timberTrips = Math.floor(
    (Math.max(0, building.timber ?? 0) + 1e-9)
      / CARPENTER_CART_SERVICE_TIMBER_PER_TRIP,
  );
  const ironworkTrips = Math.floor(
    (Math.max(0, building.ironwork ?? 0) + 1e-9)
      / CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP,
  );
  return Math.max(0, Math.min(timberTrips, ironworkTrips));
}

export function carpenterCartServiceReady(
  building: CarpenterSupportBuilding,
): boolean {
  return isOperationalCarpenter(building)
    && carpenterCartServiceTripsAvailable(building) > 0;
}

export const CARPENTER_CART_SERVICE_TIMBER_TARGET =
  CARPENTER_CART_SERVICE_TIMBER_PER_TRIP * CARPENTER_CART_SERVICE_TARGET_TRIPS;

export const CARPENTER_CART_SERVICE_IRONWORK_TARGET =
  CARPENTER_CART_SERVICE_IRONWORK_PER_TRIP * CARPENTER_CART_SERVICE_TARGET_TRIPS;

const EMPTY_DISABLED_BUILDINGS: ReadonlySet<string> = new Set();
