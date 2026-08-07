import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { BuildingState } from '../resources/types.ts';

export const LOCAL_CIVIC_RECEIPT_SOURCE_KINDS = ['monastery'] as const;

export type CivicReceiptCollectionStatus =
  | 'legacy'
  | 'accumulating'
  | 'ready'
  | 'no-treasury'
  | 'no-road'
  | 'en-route';

export type CivicReceiptCollectionPlan = {
  heldGold: number;
  dispatchThreshold: number;
  inTransitGold: number;
  target: BuildingState | null;
  routeDistance: number | null;
  activeTrip: DeliveryTripState | null;
  status: CivicReceiptCollectionStatus;
};

export function localCivicReceiptGold(building: BuildingState): number {
  if (building.kind !== 'monastery') {
    return 0;
  }
  const marked = Number.isFinite(building.civicReceiptsGold)
    ? Math.max(0, building.civicReceiptsGold ?? 0)
    : 0;
  const physicalGold = Number.isFinite(building.gold) ? Math.max(0, building.gold) : 0;
  return Math.min(marked, physicalGold);
}

export function findPreferredCivicTreasurySeat(
  buildings: Iterable<BuildingState>,
): BuildingState | null {
  return [...buildings]
    .filter(
      (building) =>
        building.constructionComplete !== false
        && (
          building.kind === 'town_hall'
          || building.kind === 'founders_camp'
          || building.kind === 'salvage_pile'
        ),
    )
    .sort((a, b) => {
      const priority = (building: BuildingState): number => {
        if (building.kind === 'town_hall') return 0;
        if (building.kind === 'founders_camp') return 1;
        return 2;
      };
      return priority(a) - priority(b) || compareStableEntityIds(a.id, b.id);
    })[0] ?? null;
}

export function civicReceiptCollectionPlan(options: {
  source: BuildingState;
  buildings: Iterable<BuildingState>;
  trips: Iterable<DeliveryTripState>;
  physicalEconomy: boolean;
  dispatchThreshold: number;
  getRoadPathDistance: (
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ) => number | null;
}): CivicReceiptCollectionPlan {
  const buildings = [...options.buildings];
  const heldGold = localCivicReceiptGold(options.source);
  const dispatchThreshold = Number.isFinite(options.dispatchThreshold)
    ? Math.max(0.1, options.dispatchThreshold)
    : 0.1;
  const activeTrip = [...options.trips]
    .filter(
      (trip) =>
        trip.buildingId === options.source.id
        && trip.cargoKind === 'gold',
    )
    .sort((a, b) => compareStableEntityIds(a.id, b.id))[0] ?? null;
  const target = activeTrip
    ? buildings.find((building) => building.id === activeTrip.targetBuildingId) ?? null
    : findPreferredCivicTreasurySeat(buildings);
  const routeDistance = target
    ? options.getRoadPathDistance(
        options.source.x,
        options.source.z,
        target.x,
        target.z,
      )
    : null;
  const inTransitGold = Math.max(0, activeTrip?.amount ?? 0);
  const status: CivicReceiptCollectionStatus = !options.physicalEconomy
    ? 'legacy'
    : activeTrip
      ? 'en-route'
      : heldGold + 1e-6 < dispatchThreshold
        ? 'accumulating'
        : !target
          ? 'no-treasury'
          : routeDistance == null
            ? 'no-road'
            : 'ready';
  return {
    heldGold,
    dispatchThreshold,
    inTransitGold,
    target,
    routeDistance,
    activeTrip,
    status,
  };
}
