import {
  residenceHasActiveProject,
  type BuildingState,
  type GameState,
} from '../resources/types.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import {
  isStorehouseCommodity,
  storehouseAcceptsCommodity,
  storehouseFilteredCollectionHeadroom,
} from '../economy/storehousePolicy.ts';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type {
  DeliveryCargoKind,
  DeliveryTripState,
} from './deliveryTrips.ts';

export type FoundingStockyardBlocker =
  | 'active-trip'
  | 'shelters'
  | 'empty'
  | 'reserved'
  | 'no-storage'
  | 'intake-disabled'
  | 'target-full'
  | 'fire'
  | 'receiving'
  | 'disconnected'
  | 'labor'
  | 'ready';

export type FoundingRelocationCommodity = Exclude<DeliveryCargoKind, 'gold'>;

export type FoundingStockyardRelocationPlan = {
  blocker: FoundingStockyardBlocker;
  pendingAmount: number;
  relocatableAmount: number;
  commodity: FoundingRelocationCommodity | null;
  targetBuildingId: string | null;
  targetRoom: number;
  routeDistance: number | null;
};

export type FoundingStockyardPlanInput = {
  state: Pick<
    GameState,
    'buildings' | 'residences' | 'deliveryTrips' | 'fireIncidents'
  >;
  camp: BuildingState;
  activeTrip?: DeliveryTripState | null;
  availableLabor: number;
  roadPathDistance(
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ): number | null;
};

const EPSILON = 1e-6;
export const FOUNDING_RELOCATION_COMMODITIES = [
  'timber',
  'stone',
  'firewood',
  'food',
  'grain',
  'barley',
  'malt',
  'flour',
  'preservedFood',
  'ale',
  'honey',
  'wine',
  'cloth',
  'wool',
  'flax',
  'ironwork',
  'polearms',
  'water',
] as const satisfies readonly FoundingRelocationCommodity[];

function finiteStock(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

function materialStock(
  building: BuildingState,
  commodity: FoundingRelocationCommodity,
): number {
  return finiteStock(building[commodity]);
}

function reservedPhysicalMaterial(
  state: Pick<GameState, 'buildings' | 'residences'>,
  commodity: FoundingRelocationCommodity,
): number {
  if (commodity !== 'timber' && commodity !== 'stone') return 0;
  let reserved = 0;
  for (const building of state.buildings.values()) {
    if (building.constructionComplete !== false) continue;
    reserved += commodity === 'timber'
      ? Math.max(
          0,
          finiteStock(building.constructionReservedTimber)
            - finiteStock(building.constructionTreasuryTimber),
        )
      : Math.max(
          0,
          finiteStock(building.constructionReservedStone)
            - finiteStock(building.constructionTreasuryStone),
        );
  }
  for (const residence of state.residences.values()) {
    if (!residenceHasActiveProject(residence)) continue;
    reserved += commodity === 'timber'
      ? finiteStock(residence.upgradeReservedTimber)
      : finiteStock(residence.upgradeReservedStone);
  }
  return reserved;
}

function commodityCapacity(
  building: BuildingState,
  commodity: FoundingRelocationCommodity,
): number {
  const capacities = BUILDING_STORAGE_CAPS[building.kind] as Partial<
    Record<FoundingRelocationCommodity, number>
  >;
  return finiteStock(capacities[commodity]);
}

function foundingDestinationPriority(
  commodity: FoundingRelocationCommodity,
  building: BuildingState,
): number | null {
  if (isStorehouseCommodity(commodity)) {
    return building.kind === 'village_storehouse' ? 0 : null;
  }
  switch (commodity) {
    case 'food':
    case 'grain':
    case 'barley':
    case 'flour':
    case 'preservedFood':
      if (building.kind === 'granary') return 0;
      if (commodity === 'barley' && building.kind === 'brewery') return 0;
      if (building.kind === 'marketplace') return 1;
      return 3;
    case 'malt':
      return building.kind === 'brewery' ? 0 : 3;
    case 'ale':
    case 'honey':
    case 'wine':
      if (building.kind === 'marketplace') return 0;
      if (building.kind === 'monastery') return 1;
      return 3;
    case 'ironwork':
      if (building.kind === 'carpenter') return 0;
      if (building.kind === 'marketplace') return 1;
      return 3;
    case 'iron':
      if (building.kind === 'smithy') return 0;
      if (building.kind === 'marketplace') return 1;
      return 3;
    case 'clay':
      if (building.kind === 'potter_kiln') return 0;
      if (building.kind === 'clay_pit') return 1;
      return 3;
    case 'salt':
      if (building.kind === 'smokehouse') return 0;
      if (building.kind === 'marketplace') return 1;
      return 3;
    case 'charcoal':
      if (building.kind === 'smithy') return 0;
      if (building.kind === 'charcoal_burner') return 1;
      return 3;
    case 'pottery':
      if (building.kind === 'smokehouse') return 0;
      if (building.kind === 'marketplace') return 1;
      if (building.kind === 'potter_kiln') return 2;
      return 3;
    case 'manure':
      return building.kind === 'threshing_barn' ? 0 : null;
    case 'remedies':
      return building.kind === 'foragers_shed' ? 0 : null;
    case 'polearms':
      if (building.kind === 'guardhouse') return 0;
      if (building.kind === 'carpenter') return 1;
      return 3;
    case 'wool':
      if (building.kind === 'weaver') return 0;
      if (building.kind === 'pastoral_farmstead') return 1;
      return 3;
    case 'flax':
      if (building.kind === 'weaver') return 0;
      if (building.kind === 'threshing_barn') return 1;
      return 3;
    case 'cloth':
      if (building.kind === 'marketplace') return 0;
      if (building.kind === 'weaver') return 1;
      return 3;
    case 'water':
      return building.kind === 'well' ? 0 : 2;
    default: {
      const unreachable: never = commodity;
      return unreachable;
    }
  }
}

function foundingDestinationRoom(
  building: BuildingState,
  commodity: FoundingRelocationCommodity,
): number {
  if (isStorehouseCommodity(commodity)) {
    return building.kind === 'village_storehouse'
      ? storehouseFilteredCollectionHeadroom(building, commodity)
      : 0;
  }
  return Math.max(0, commodityCapacity(building, commodity) - materialStock(
    building,
    commodity,
  ));
}

function compareStableBuildingIds(a: string, b: string): number {
  const numericA = /^\d+$/.test(a);
  const numericB = /^\d+$/.test(b);
  if (numericA && numericB) {
    return a.length - b.length || a.localeCompare(b);
  }
  return a.localeCompare(b);
}

function emptyPlan(
  blocker: FoundingStockyardBlocker,
  pendingAmount: number,
  relocatableAmount: number,
  commodity: FoundingRelocationCommodity | null = null,
): FoundingStockyardRelocationPlan {
  return {
    blocker,
    pendingAmount,
    relocatableAmount,
    commodity,
    targetBuildingId: null,
    targetRoom: 0,
    routeDistance: null,
  };
}

/**
 * Mirrors the authoritative founding-yard relocation rule for readable UI.
 * It is deliberately one pass per stocked commodity and keeps exact road
 * routing in the supplied query so the planner does not create a second
 * network cache.
 */
export function planFoundingStockyardRelocation(
  input: FoundingStockyardPlanInput,
): FoundingStockyardRelocationPlan {
  const pendingAmount = FOUNDING_RELOCATION_COMMODITIES.reduce(
    (sum, commodity) => sum + materialStock(input.camp, commodity),
    0,
  );
  if (input.activeTrip) {
    return emptyPlan('active-trip', pendingAmount, 0);
  }
  if (input.camp.foundingShelterActive !== false) {
    return emptyPlan('shelters', pendingAmount, 0);
  }
  if (pendingAmount <= EPSILON) {
    return emptyPlan('empty', 0, 0);
  }

  const destinations = Array.from(input.state.buildings.values()).filter(
    (building) =>
      building.id !== input.camp.id
      && building.kind !== 'founders_camp'
      && building.kind !== 'salvage_pile'
      && building.constructionComplete !== false,
  );

  const inboundTargets = new Set<string>();
  for (const trip of input.state.deliveryTrips.values()) {
    if (trip.destinationKind === 'building' && trip.targetBuildingId) {
      inboundTargets.add(trip.targetBuildingId);
    }
  }
  const fireDisabled = fireDisabledBuildingIds(input.state.fireIncidents.values());

  let relocatableAmount = 0;
  let firstPendingCommodity: FoundingRelocationCommodity | null = null;
  let firstRelocatableCommodity: FoundingRelocationCommodity | null = null;
  let hasCompatibleStorage = false;
  let hasAcceptedIntake = false;
  let hasTargetRoom = false;
  let hasFireAvailableRoom = false;
  let hasReceivingAvailableRoom = false;
  let hasRoadRoute = false;

  for (const commodity of FOUNDING_RELOCATION_COMMODITIES) {
    const stock = materialStock(input.camp, commodity);
    if (stock <= EPSILON) continue;
    firstPendingCommodity ??= commodity;
    const relocatable = Math.max(
      0,
      stock - reservedPhysicalMaterial(input.state, commodity),
    );
    relocatableAmount += relocatable;
    if (relocatable <= EPSILON) continue;
    firstRelocatableCommodity ??= commodity;

    let best:
      | { building: BuildingState; priority: number; room: number; distance: number }
      | null = null;
    for (const destination of destinations) {
      const priority = foundingDestinationPriority(commodity, destination);
      if (priority === null || commodityCapacity(destination, commodity) <= EPSILON) {
        continue;
      }
      hasCompatibleStorage = true;
      if (
        isStorehouseCommodity(commodity)
        && !storehouseAcceptsCommodity(destination, commodity)
      ) {
        continue;
      }
      hasAcceptedIntake = true;
      const room = foundingDestinationRoom(destination, commodity);
      if (room <= EPSILON) continue;
      hasTargetRoom = true;
      if (fireDisabled.has(destination.id)) continue;
      hasFireAvailableRoom = true;
      if (inboundTargets.has(destination.id)) continue;
      hasReceivingAvailableRoom = true;
      const distance = input.roadPathDistance(
        input.camp.x,
        input.camp.z,
        destination.x,
        destination.z,
      );
      if (distance === null) continue;
      hasRoadRoute = true;
      if (
        best === null
        || priority < best.priority
        || (
          priority === best.priority
          && (
            distance < best.distance
            || (
              distance === best.distance
              && compareStableBuildingIds(destination.id, best.building.id) < 0
            )
          )
        )
      ) {
        best = { building: destination, priority, room, distance };
      }
    }

    if (best) {
      return {
        blocker: input.availableLabor > 0 ? 'ready' : 'labor',
        pendingAmount,
        relocatableAmount,
        commodity,
        targetBuildingId: best.building.id,
        targetRoom: Math.min(relocatable, best.room),
        routeDistance: best.distance,
      };
    }
  }

  if (relocatableAmount <= EPSILON) {
    return emptyPlan('reserved', pendingAmount, 0, firstPendingCommodity);
  }
  if (!hasCompatibleStorage) {
    return emptyPlan(
      'no-storage',
      pendingAmount,
      relocatableAmount,
      firstRelocatableCommodity,
    );
  }
  if (!hasAcceptedIntake) {
    return emptyPlan(
      'intake-disabled',
      pendingAmount,
      relocatableAmount,
      firstRelocatableCommodity,
    );
  }
  if (!hasTargetRoom) {
    return emptyPlan(
      'target-full',
      pendingAmount,
      relocatableAmount,
      firstRelocatableCommodity,
    );
  }
  if (!hasFireAvailableRoom) {
    return emptyPlan('fire', pendingAmount, relocatableAmount, firstRelocatableCommodity);
  }
  if (!hasReceivingAvailableRoom) {
    return emptyPlan('receiving', pendingAmount, relocatableAmount, firstRelocatableCommodity);
  }
  if (!hasRoadRoute) {
    return emptyPlan(
      'disconnected',
      pendingAmount,
      relocatableAmount,
      firstRelocatableCommodity,
    );
  }
  return emptyPlan('target-full', pendingAmount, relocatableAmount, firstRelocatableCommodity);
}
