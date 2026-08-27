import type {
  BuildingKind,
} from './types.ts';
import type {
  MarketStallRoadDistance,
} from '../economy/marketStallAssignments.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';

export type ServiceCoverageBuildingKind = Extract<
  BuildingKind,
  'well' | 'marketplace' | 'chapel'
>;

export type ServiceCoverageView = {
  kind: ServiceCoverageBuildingKind;
  residenceIds: readonly string[];
};

export function serviceCoverageLabel(kind: ServiceCoverageBuildingKind): string {
  switch (kind) {
    case 'well': return 'water service';
    case 'marketplace': return 'market service';
    case 'chapel': return 'church service';
  }
}

type ServiceCoveragePosition = {
  id: string;
  x: number;
  z: number;
};

/**
 * Assigns each eligible home to its nearest stocked Marketplace over the road
 * network. The inspector passes the already-built active-stall candidate set,
 * so an empty or merely standby square does not advertise household service.
 */
export function marketplaceServiceResidenceIds(
  residences: readonly ServiceCoveragePosition[],
  marketplaces: readonly ServiceCoveragePosition[],
  marketplaceId: string,
  roadDistance: MarketStallRoadDistance,
): string[] {
  if (!marketplaces.some((marketplace) => marketplace.id === marketplaceId)) {
    return [];
  }

  const residenceIds: string[] = [];
  for (const residence of residences) {
    let nearestMarketplaceId: string | null = null;
    let nearestDistance = Infinity;
    for (const marketplace of marketplaces) {
      const distance = roadDistance(
        residence.x,
        residence.z,
        marketplace.x,
        marketplace.z,
      );
      if (distance == null || !Number.isFinite(distance)) continue;
      if (
        distance + 1e-6 < nearestDistance
        || (
          Math.abs(distance - nearestDistance) <= 1e-6
          && (
            nearestMarketplaceId == null
            || compareStableEntityIds(marketplace.id, nearestMarketplaceId) < 0
          )
        )
      ) {
        nearestMarketplaceId = marketplace.id;
        nearestDistance = distance;
      }
    }
    if (nearestMarketplaceId === marketplaceId) residenceIds.push(residence.id);
  }
  return residenceIds;
}
