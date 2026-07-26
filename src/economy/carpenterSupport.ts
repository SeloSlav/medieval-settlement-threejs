import {
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
): boolean {
  if (!network) return false;
  for (const building of buildings) {
    if (!isOperationalCarpenter(building)) continue;
    if (disabledBuildingIds.has(building.id)) continue;
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
  };
}

export function carpenterDeliverySpeedMultiplier(
  buildings: Iterable<CarpenterSupportBuilding>,
  network: RoadNetwork,
  origin: RoadPoint,
  disabledBuildingIds: ReadonlySet<string> = EMPTY_DISABLED_BUILDINGS,
): number {
  return hasRoadLinkedCarpenter(buildings, network, origin, disabledBuildingIds)
    ? CARPENTER_DELIVERY_SPEED_MULTIPLIER
    : 1;
}

const EMPTY_DISABLED_BUILDINGS: ReadonlySet<string> = new Set();
