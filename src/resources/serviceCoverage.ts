import type {
  BuildingKind,
  ResidenceState,
} from './types.ts';
import type {
  MarketStallRoadDistance,
} from '../economy/marketStallAssignments.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import {
  activeResidenceNeedKinds,
  getNeed,
  type ResidenceNeedKind,
} from '../residences/residenceNeedState.ts';

export type ServiceCoverageBuildingKind = Extract<
  BuildingKind,
  'well' | 'marketplace' | 'chapel' | 'tavern'
>;

export type ServiceCoverageView = {
  kind: ServiceCoverageBuildingKind;
  residenceIds: readonly string[];
  marketplaceFulfillment?: ReadonlyMap<string, MarketplaceServiceFulfillment>;
};

export type MarketplaceServiceFulfillment =
  | 'fulfilled'
  | 'partial'
  | 'unfulfilled';

const MARKETPLACE_FULFILLED_NEEDS = new Set<ResidenceNeedKind>([
  'food',
  'firewood',
  'savoryPreserves',
  'cloth',
  'shoes',
  'pottery',
  'luxury',
]);

export function serviceCoverageLabel(kind: ServiceCoverageBuildingKind): string {
  switch (kind) {
    case 'well': return 'water service';
    case 'marketplace': return 'market service';
    case 'chapel': return 'church service';
    case 'tavern': return 'beverage service';
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

/** Traffic-light state from the household buffers a local Marketplace fills. */
export function marketplaceResidenceFulfillment(
  residence: Pick<ResidenceState, 'needs' | 'tier'>,
): MarketplaceServiceFulfillment {
  const activeNeeds = activeResidenceNeedKinds(residence.tier)
    .filter((kind) => MARKETPLACE_FULFILLED_NEEDS.has(kind));
  const fulfilledNeeds = activeNeeds.filter(
    (kind) => {
      const need = getNeed(residence.needs, kind);
      return need.stock > 1e-6 && need.deficitTicks <= 0;
    },
  ).length;
  if (activeNeeds.length > 0 && fulfilledNeeds === activeNeeds.length) {
    return 'fulfilled';
  }
  return fulfilledNeeds > 0 ? 'partial' : 'unfulfilled';
}
