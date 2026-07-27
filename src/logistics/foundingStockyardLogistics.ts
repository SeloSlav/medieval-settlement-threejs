import {
  residenceHasActiveProject,
  type BuildingState,
  type GameState,
} from '../resources/types.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import {
  STOREHOUSE_COMMODITIES,
  storehouseAcceptsCommodity,
  storehouseFilteredCollectionHeadroom,
  type StorehouseCommodity,
} from '../economy/storehousePolicy.ts';
import type { DeliveryTripState } from './deliveryTrips.ts';

export type FoundingStockyardBlocker =
  | 'active-trip'
  | 'shelters'
  | 'empty'
  | 'reserved'
  | 'no-storehouse'
  | 'intake-disabled'
  | 'target-full'
  | 'fire'
  | 'receiving'
  | 'disconnected'
  | 'labor'
  | 'ready';

export type FoundingStockyardRelocationPlan = {
  blocker: FoundingStockyardBlocker;
  pendingAmount: number;
  relocatableAmount: number;
  commodity: StorehouseCommodity | null;
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

function finiteStock(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

function materialStock(
  building: Pick<BuildingState, 'timber' | 'stone' | 'firewood'>,
  commodity: StorehouseCommodity,
): number {
  return finiteStock(building[commodity]);
}

function reservedPhysicalMaterial(
  state: Pick<GameState, 'buildings' | 'residences'>,
  commodity: StorehouseCommodity,
): number {
  if (commodity === 'firewood') return 0;
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
  commodity: StorehouseCommodity | null = null,
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
 * It is deliberately one pass per material and keeps exact road routing in the
 * supplied query so the planner does not create a second network cache.
 */
export function planFoundingStockyardRelocation(
  input: FoundingStockyardPlanInput,
): FoundingStockyardRelocationPlan {
  const pendingAmount = STOREHOUSE_COMMODITIES.reduce(
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

  const storehouses = Array.from(input.state.buildings.values()).filter(
    (building) =>
      building.kind === 'village_storehouse'
      && building.constructionComplete !== false,
  );
  if (storehouses.length === 0) {
    return emptyPlan('no-storehouse', pendingAmount, pendingAmount);
  }

  const inboundTargets = new Set<string>();
  for (const trip of input.state.deliveryTrips.values()) {
    if (trip.destinationKind === 'building' && trip.targetBuildingId) {
      inboundTargets.add(trip.targetBuildingId);
    }
  }
  const fireDisabled = fireDisabledBuildingIds(input.state.fireIncidents.values());

  let relocatableAmount = 0;
  let firstPendingCommodity: StorehouseCommodity | null = null;
  let hasAcceptedIntake = false;
  let hasTargetRoom = false;
  let hasFireAvailableRoom = false;
  let hasReceivingAvailableRoom = false;
  let hasRoadRoute = false;

  for (const commodity of STOREHOUSE_COMMODITIES) {
    const stock = materialStock(input.camp, commodity);
    if (stock <= EPSILON) continue;
    firstPendingCommodity ??= commodity;
    const relocatable = Math.max(
      0,
      stock - reservedPhysicalMaterial(input.state, commodity),
    );
    relocatableAmount += relocatable;
    if (relocatable <= EPSILON) continue;

    let best:
      | { building: BuildingState; room: number; distance: number }
      | null = null;
    for (const storehouse of storehouses) {
      if (!storehouseAcceptsCommodity(storehouse, commodity)) continue;
      hasAcceptedIntake = true;
      const room = storehouseFilteredCollectionHeadroom(storehouse, commodity);
      if (room <= EPSILON) continue;
      hasTargetRoom = true;
      if (fireDisabled.has(storehouse.id)) continue;
      hasFireAvailableRoom = true;
      if (inboundTargets.has(storehouse.id)) continue;
      hasReceivingAvailableRoom = true;
      const distance = input.roadPathDistance(
        input.camp.x,
        input.camp.z,
        storehouse.x,
        storehouse.z,
      );
      if (distance === null) continue;
      hasRoadRoute = true;
      if (
        best === null
        || distance < best.distance
        || (
          distance === best.distance
          && compareStableBuildingIds(storehouse.id, best.building.id) < 0
        )
      ) {
        best = { building: storehouse, room, distance };
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
  if (!hasAcceptedIntake) {
    return emptyPlan(
      'intake-disabled',
      pendingAmount,
      relocatableAmount,
      firstPendingCommodity,
    );
  }
  if (!hasTargetRoom) {
    return emptyPlan(
      'target-full',
      pendingAmount,
      relocatableAmount,
      firstPendingCommodity,
    );
  }
  if (!hasFireAvailableRoom) {
    return emptyPlan('fire', pendingAmount, relocatableAmount, firstPendingCommodity);
  }
  if (!hasReceivingAvailableRoom) {
    return emptyPlan('receiving', pendingAmount, relocatableAmount, firstPendingCommodity);
  }
  if (!hasRoadRoute) {
    return emptyPlan(
      'disconnected',
      pendingAmount,
      relocatableAmount,
      firstPendingCommodity,
    );
  }
  return emptyPlan('target-full', pendingAmount, relocatableAmount, firstPendingCommodity);
}
