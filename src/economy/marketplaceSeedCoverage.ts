import { fieldSeedGrainRemaining } from '../farming/farmWorkPlanning.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import { GRAIN_TRANSFER_PER_TRIP } from '../generated/gameBalance.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type {
  BuildingState,
  GameState,
} from '../resources/types.ts';
import {
  MARKETPLACE_SEED_GRAIN_IMPORT_LOT,
  marketplaceSeedGrainProcurementPlan,
} from './marketplaceSeedPolicy.ts';

export type MarketplaceSeedCoveragePlan = {
  sourceBusy: boolean;
  sourceOperational: boolean;
  connectedHoldings: number;
  staffedHoldings: number;
  shortHoldings: number;
  staffedShortHoldings: number;
  laborBlockedHoldings: number;
  fireBlockedHoldings: number;
  inboundBlockedHoldings: number;
  seedRequired: number;
  seedCovered: number;
  seedShortfall: number;
  dispatchableShortfall: number;
  laborBlockedShortfall: number;
  fireBlockedShortfall: number;
  inboundBlockedShortfall: number;
  inboundGrain: number;
  marketOutboundGrain: number;
  currentMarketStock: number;
  plannedImportLots: number;
  plannedImportGrain: number;
  potentialCoverage: number;
  uncoveredDispatchableShortfall: number;
  firstShortBuildingId: string | null;
  firstShortfall: number;
  nextDispatchBuildingId: string | null;
  nextDispatchDistance: number | null;
  nextDispatchRequired: number;
  nextDispatchStock: number;
  nextDispatchShortfall: number;
  nextDispatchAmount: number;
};

export type SeedGrainSourceCoveragePlan = Omit<
  MarketplaceSeedCoveragePlan,
  | 'currentMarketStock'
  | 'plannedImportLots'
  | 'plannedImportGrain'
  | 'potentialCoverage'
  | 'uncoveredDispatchableShortfall'
>;

type SeedDemand = {
  required: number;
  inbound: number;
};

type SeedCandidate = {
  building: BuildingState;
  coverage: number;
  shortfall: number;
  distance: number;
};

function inboundGrainByHolding(
  trips: Iterable<DeliveryTripState>,
  sourceId: string,
): {
  byHolding: Map<string, number>;
  fromSourceByHolding: Map<string, number>;
  sourceBusy: boolean;
} {
  const byHolding = new Map<string, number>();
  const fromSourceByHolding = new Map<string, number>();
  let sourceBusy = false;
  for (const trip of trips) {
    if (trip.buildingId === sourceId) sourceBusy = true;
    if (
      trip.phase === 'inbound'
      || trip.destinationKind !== 'building'
      || trip.targetBuildingId == null
      || trip.cargoKind !== 'grain'
      || trip.amount <= 1e-6
    ) {
      continue;
    }
    byHolding.set(
      trip.targetBuildingId,
      (byHolding.get(trip.targetBuildingId) ?? 0) + trip.amount,
    );
    if (trip.buildingId === sourceId) {
      fromSourceByHolding.set(
        trip.targetBuildingId,
        (fromSourceByHolding.get(trip.targetBuildingId) ?? 0) + trip.amount,
      );
    }
  }
  return { byHolding, fromSourceByHolding, sourceBusy };
}

function compareSeedCandidates(left: SeedCandidate, right: SeedCandidate): number {
  if (Math.abs(left.coverage - right.coverage) > 1e-9) {
    return left.coverage - right.coverage;
  }
  if (Math.abs(left.distance - right.distance) > 1e-6) {
    return left.distance - right.distance;
  }
  return compareStableEntityIds(left.building.id, right.building.id);
}

/**
 * Read-only road-branch forecast shared by granaries and marketplaces.
 *
 * This is deliberately inspector-time work. It performs one pass over fields,
 * active trips, and buildings, then uses the caller's cached road graph for
 * one connectivity probe per holding. It adds no simulation-tick scans.
 */
export function seedGrainSourceCoveragePlan(
  source: Pick<
    BuildingState,
    'id' | 'kind' | 'grain' | 'assignedLabor' | 'constructionComplete'
  >,
  state: Pick<GameState, 'buildings' | 'farmFields' | 'deliveryTrips'>
    & Partial<Pick<GameState, 'fireIncidents'>>,
  routeDistance: (
    source: Pick<BuildingState, 'id'>,
    farmstead: BuildingState,
  ) => number | null,
): SeedGrainSourceCoveragePlan {
  const inbound = inboundGrainByHolding(state.deliveryTrips.values(), source.id);
  const fireDisabled = fireDisabledBuildingIds(
    state.fireIncidents?.values() ?? [],
  );
  const demandByHolding = new Map<string, SeedDemand>();
  for (const field of state.farmFields.values()) {
    const required = fieldSeedGrainRemaining(field);
    if (required <= 1e-9) continue;
    const demand = demandByHolding.get(field.farmsteadId);
    if (demand) demand.required += required;
    else {
      demandByHolding.set(field.farmsteadId, {
        required,
        inbound: inbound.byHolding.get(field.farmsteadId) ?? 0,
      });
    }
  }

  let connectedHoldings = 0;
  let staffedHoldings = 0;
  let shortHoldings = 0;
  let staffedShortHoldings = 0;
  let laborBlockedHoldings = 0;
  let fireBlockedHoldings = 0;
  let inboundBlockedHoldings = 0;
  let seedRequired = 0;
  let seedCovered = 0;
  let seedShortfall = 0;
  let dispatchableShortfall = 0;
  let laborBlockedShortfall = 0;
  let fireBlockedShortfall = 0;
  let inboundBlockedShortfall = 0;
  let inboundGrain = 0;
  let marketOutboundGrain = 0;
  let firstShort: SeedCandidate | null = null;
  let nextDispatch: SeedCandidate | null = null;

  for (const [farmsteadId, demand] of demandByHolding) {
    const farmstead = state.buildings.get(farmsteadId);
    if (
      farmstead?.kind !== 'threshing_barn'
      || farmstead.constructionComplete === false
    ) {
      continue;
    }
    const required = demand.required;
    if (required <= 1e-6) continue;
    const distance = routeDistance(source, farmstead);
    if (distance == null) continue;

    connectedHoldings += 1;
    const staffed = farmstead.assignedLabor > 0;
    const fireBlocked = fireDisabled.has(farmstead.id);
    if (staffed) staffedHoldings += 1;
    const onsite = Math.max(0, farmstead.grain);
    const inboundStock = Math.max(0, demand.inbound);
    const available = onsite + inboundStock;
    inboundGrain += Math.max(0, demand.inbound);
    marketOutboundGrain += Math.max(
      0,
      inbound.fromSourceByHolding.get(farmsteadId) ?? 0,
    );
    const covered = Math.min(required, available);
    const shortfall = Math.max(0, required - available);
    seedRequired += required;
    seedCovered += covered;
    seedShortfall += shortfall;
    if (shortfall <= 0.05) continue;

    shortHoldings += 1;
    if (staffed) {
      staffedShortHoldings += 1;
      dispatchableShortfall += shortfall;
    } else {
      laborBlockedHoldings += 1;
      laborBlockedShortfall += shortfall;
    }
    const candidate: SeedCandidate = {
      building: farmstead,
      coverage: required > 1e-9 ? Math.min(1, available / required) : 1,
      shortfall,
      distance,
    };
    if (firstShort == null || compareSeedCandidates(candidate, firstShort) < 0) {
      firstShort = candidate;
    }

    const onsiteShortfall = Math.max(0, required - onsite);
    if (!staffed || onsiteShortfall <= 0.05) continue;
    if (fireBlocked) {
      fireBlockedHoldings += 1;
      fireBlockedShortfall += onsiteShortfall;
      continue;
    }
    if (inboundStock > 0.05) {
      inboundBlockedHoldings += 1;
      inboundBlockedShortfall += onsiteShortfall;
      continue;
    }
    const dispatchCandidate: SeedCandidate = {
      building: farmstead,
      coverage: required > 1e-9 ? Math.min(1, onsite / required) : 1,
      shortfall: onsiteShortfall,
      distance,
    };
    if (
      nextDispatch == null
      || compareSeedCandidates(dispatchCandidate, nextDispatch) < 0
    ) {
      nextDispatch = dispatchCandidate;
    }
  }

  const sourceStock = Math.max(0, source.grain);
  const sourceOperational = source.constructionComplete !== false
    && !fireDisabled.has(source.id)
    && (source.kind !== 'marketplace' || source.assignedLabor > 0);

  return {
    sourceBusy: inbound.sourceBusy,
    sourceOperational,
    connectedHoldings,
    staffedHoldings,
    shortHoldings,
    staffedShortHoldings,
    laborBlockedHoldings,
    fireBlockedHoldings,
    inboundBlockedHoldings,
    seedRequired,
    seedCovered,
    seedShortfall,
    dispatchableShortfall,
    laborBlockedShortfall,
    fireBlockedShortfall,
    inboundBlockedShortfall,
    inboundGrain,
    marketOutboundGrain,
    firstShortBuildingId: firstShort?.building.id ?? null,
    firstShortfall: firstShort?.shortfall ?? 0,
    nextDispatchBuildingId: nextDispatch?.building.id ?? null,
    nextDispatchDistance: nextDispatch?.distance ?? null,
    nextDispatchRequired: nextDispatch == null
      ? 0
      : nextDispatch.shortfall + Math.max(0, nextDispatch.building.grain),
    nextDispatchStock: Math.max(0, nextDispatch?.building.grain ?? 0),
    nextDispatchShortfall: nextDispatch?.shortfall ?? 0,
    nextDispatchAmount: nextDispatch == null || !sourceOperational || inbound.sourceBusy
      ? 0
      : Math.min(
          nextDispatch.shortfall,
          sourceStock,
          GRAIN_TRANSFER_PER_TRIP,
        ),
  };
}

export function marketplaceSeedCoveragePlan(
  market: Pick<
    BuildingState,
    | 'id'
    | 'kind'
    | 'grain'
    | 'assignedLabor'
    | 'constructionComplete'
    | 'marketplaceSeedGrainTarget'
  >,
  state: Pick<GameState, 'buildings' | 'farmFields' | 'deliveryTrips'>
    & Partial<Pick<GameState, 'fireIncidents'>>,
  routeDistance: (
    market: Pick<BuildingState, 'id'>,
    farmstead: BuildingState,
  ) => number | null,
): MarketplaceSeedCoveragePlan {
  const coverage = seedGrainSourceCoveragePlan(
    market,
    state,
    routeDistance,
  );
  const procurement = marketplaceSeedGrainProcurementPlan(market);
  const currentMarketStock = Math.max(0, market.grain);
  const plannedImportLots = procurement.ordersToTarget;
  const plannedImportGrain = plannedImportLots * MARKETPLACE_SEED_GRAIN_IMPORT_LOT;
  const potentialCoverage = Math.min(
    coverage.dispatchableShortfall,
    currentMarketStock + plannedImportGrain,
  );

  return {
    ...coverage,
    currentMarketStock,
    plannedImportLots,
    plannedImportGrain,
    potentialCoverage,
    uncoveredDispatchableShortfall: Math.max(
      0,
      coverage.dispatchableShortfall - potentialCoverage,
    ),
  };
}
