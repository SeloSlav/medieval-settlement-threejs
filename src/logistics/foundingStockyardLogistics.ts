import {
  residenceHasActiveProject,
  type BuildingState,
  type GameState,
} from '../resources/types.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import {
  isStorehouseCommodity,
  storehouseFilteredCollectionHeadroom,
} from '../economy/storehousePolicy.ts';
import {
  isStorageCommodity,
  storageAcceptsCommodity,
} from '../economy/storageAcceptancePolicy.ts';
import {
  freshFoodStock,
  isFreshFoodCargo,
  isPreservedFoodCargo,
  preservedFoodStock,
} from '../economy/foodInventory.ts';
import {
  BUILDING_STORAGE_CAPS,
  STOREHOUSE_HAUL_PER_WORKER,
} from '../generated/gameBalance.ts';
import {
  DELIVERY_CARGO_KINDS,
  inboundSupplyTripConflicts,
  type DeliveryCargoKind,
  type DeliveryTripState,
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
  loadAmount: number;
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
export const FOUNDING_RELOCATION_COMMODITIES: readonly FoundingRelocationCommodity[] =
  DELIVERY_CARGO_KINDS.filter(
    (kind): kind is FoundingRelocationCommodity => kind !== 'gold',
  );

export const OCCUPIED_SHELTER_RELOCATION_COMMODITIES = [
  'ryeBread',
  'maslinBread',
  'firewood',
  'ironwork',
] as const satisfies readonly FoundingRelocationCommodity[];

function foundingRelocationCommodities(
  shelterActive: boolean,
): readonly FoundingRelocationCommodity[] {
  return shelterActive
    ? OCCUPIED_SHELTER_RELOCATION_COMMODITIES
    : FOUNDING_RELOCATION_COMMODITIES;
}

export function foundingRelocationLoadAmount(
  relocatable: number,
  targetRoom: number,
): number {
  if (!Number.isFinite(relocatable) || !Number.isFinite(targetRoom)) return 0;
  return Math.min(
    Math.max(0, relocatable),
    Math.max(0, targetRoom),
    STOREHOUSE_HAUL_PER_WORKER,
  );
}

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
  const capacities = BUILDING_STORAGE_CAPS[building.kind] as Record<
    string,
    number | undefined
  >;
  const capacityKind = isFreshFoodCargo(commodity)
    ? 'food'
    : isPreservedFoodCargo(commodity)
      ? 'preservedFood'
      : commodity === 'ryeSheaves' || commodity === 'oatSheaves'
        || commodity === 'barleySheaves' || commodity === 'maslinSheaves'
        || commodity === 'ryeGrain' || commodity === 'oatGrain'
        || commodity === 'maslinGrain'
        ? 'grain'
        : commodity === 'ryeFlour'
          || commodity === 'maslinFlour'
          ? 'flour'
          : commodity;
  return finiteStock(capacities[capacityKind]);
}

function foundingDestinationPriority(
  commodity: FoundingRelocationCommodity,
  building: BuildingState,
): number | null {
  if (building.kind === 'village_storehouse' && isStorehouseCommodity(commodity)) {
    return 0;
  }
  switch (commodity) {
    case 'timber':
    case 'stone':
    case 'firewood':
      return null;
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
    case 'vegetables':
    case 'cabbage':
    case 'carrots':
    case 'beetroot':
    case 'eggs':
    case 'grapes':
    case 'curedMeat':
    case 'smokedFish':
    case 'cheese':
    case 'aroniaJam':
    case 'rosehipJam':
    case 'ryeSheaves':
    case 'oatSheaves':
    case 'barleySheaves':
    case 'maslinSheaves':
    case 'ryeGrain':
    case 'oatGrain':
    case 'maslinGrain':
    case 'barley':
    case 'ryeFlour':
    case 'maslinFlour':
    case 'preservedFood':
      if (building.kind === 'granary') return 0;
      if (commodity === 'barley' && building.kind === 'brewery') return 0;
      if (building.kind === 'marketplace') return 1;
      return 3;
    case 'ryeBread':
    case 'maslinBread':
      return building.kind === 'granary' ? 0 : null;
    case 'malt':
      return building.kind === 'brewery' ? 0 : 3;
    case 'ale':
    case 'cider':
    case 'pearCider':
    case 'mead':
      if (building.kind === 'tavern') return 0;
      if (building.kind === 'granary') return 1;
      if (building.kind === 'brewery') return 2;
      if (building.kind === 'marketplace') return 3;
      return 3;
    case 'honey':
    case 'wine':
      if (building.kind === 'marketplace') return 0;
      if (building.kind === 'monastery') return 1;
      return 3;
    case 'wax':
      if (building.kind === 'chandlery') return 0;
      if (building.kind === 'marketplace') return 1;
      return 3;
    case 'candles':
      if (building.kind === 'marketplace') return 0;
      if (building.kind === 'chandlery') return 1;
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
    case 'roofTiles':
      return building.kind === 'potter_kiln' ? 0 : null;
    case 'manure':
      return building.kind === 'threshing_barn' ? 0 : null;
    case 'remedies':
      return building.kind === 'foragers_shed' ? 0 : null;
    case 'polearms':
      if (building.kind === 'guardhouse') return 0;
      if (building.kind === 'carpenter') return 1;
      return 3;
    case 'wool':
      if (building.kind === 'spinning_retting_house') return 0;
      if (building.kind === 'pastoral_farmstead') return 1;
      return 3;
    case 'animalFeed':
      if (building.kind === 'pastoral_farmstead') return 0;
      if (building.kind === 'swineherd') return 1;
      return null;
    case 'flax':
      if (building.kind === 'spinning_retting_house') return 0;
      if (building.kind === 'threshing_barn') return 1;
      return 3;
    case 'yarn':
    case 'linen':
      if (building.kind === 'weaver') return 0;
      if (building.kind === 'village_storehouse') return 1;
      if (building.kind === 'spinning_retting_house') return 2;
      return 3;
    case 'cloth':
      if (building.kind === 'marketplace') return 0;
      if (building.kind === 'weaver') return 1;
      return 3;
    case 'pelts':
      if (building.kind === 'trading_post') return 0;
      if (building.kind === 'hunters_hall') return 1;
      return 3;
    case 'hides':
      if (building.kind === 'tannery') return 0;
      if (building.kind === 'marketplace') return 1;
      return 3;
    case 'leather':
      if (building.kind === 'cobbler') return 0;
      if (building.kind === 'tannery' || building.kind === 'marketplace') return 1;
      return 3;
    case 'shoes':
      if (building.kind === 'marketplace') return 0;
      if (building.kind === 'cobbler') return 1;
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
  if (building.kind === 'village_storehouse' && isStorehouseCommodity(commodity)) {
    return storehouseFilteredCollectionHeadroom(building, commodity);
  }
  if (
    commodity === 'timber'
    || commodity === 'stone'
    || commodity === 'firewood'
  ) {
    return 0;
  }
  const occupied = isFreshFoodCargo(commodity)
    ? freshFoodStock(building)
    : isPreservedFoodCargo(commodity)
      ? preservedFoodStock(building)
      : materialStock(building, commodity);
  return Math.max(0, commodityCapacity(building, commodity) - occupied);
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
    loadAmount: 0,
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
  if (pendingAmount <= EPSILON) {
    return emptyPlan('empty', 0, 0);
  }
  const shelterActive = input.camp.foundingShelterActive !== false;
  const relocationCommodities = foundingRelocationCommodities(shelterActive);
  const eligiblePendingAmount = relocationCommodities.reduce(
    (sum, commodity) => sum + materialStock(input.camp, commodity),
    0,
  );
  if (shelterActive && eligiblePendingAmount <= EPSILON) {
    return emptyPlan('shelters', pendingAmount, 0);
  }

  const destinations = Array.from(input.state.buildings.values()).filter(
    (building) =>
      building.id !== input.camp.id
      && building.kind !== 'founders_camp'
      && building.kind !== 'salvage_pile'
      && building.constructionComplete !== false,
  );

  const inboundTripsByTarget = new Map<string, DeliveryTripState[]>();
  for (const trip of input.state.deliveryTrips.values()) {
    if (trip.destinationKind === 'building' && trip.targetBuildingId) {
      const inbound = inboundTripsByTarget.get(trip.targetBuildingId) ?? [];
      inbound.push(trip);
      inboundTripsByTarget.set(trip.targetBuildingId, inbound);
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

  for (const commodity of relocationCommodities) {
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
        isStorageCommodity(commodity)
        && !storageAcceptsCommodity(destination, commodity)
      ) {
        continue;
      }
      hasAcceptedIntake = true;
      const room = foundingDestinationRoom(destination, commodity);
      if (room <= EPSILON) continue;
      hasTargetRoom = true;
      if (fireDisabled.has(destination.id)) continue;
      hasFireAvailableRoom = true;
      if (
        (inboundTripsByTarget.get(destination.id) ?? []).some((trip) =>
          inboundSupplyTripConflicts(destination.kind, commodity, trip)
        )
      ) continue;
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
        loadAmount: foundingRelocationLoadAmount(relocatable, best.room),
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
