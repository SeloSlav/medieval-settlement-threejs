import {
  RESOURCE_KINDS,
  residenceHasActiveProject,
  type BuildingState,
  type GameState,
  type ResourceKind,
  type ResidenceState,
  type SettlementState,
} from './types.ts';
import { deliveryTripHasPendingCargo } from '../logistics/deliveryTrips.ts';

export type SettlementResourceReportRow = {
  resource: ResourceKind;
  stored: number;
  committed: number;
  inbound: number;
  outbound: number;
};

export type SettlementResourceReport = {
  settlement: SettlementState | null;
  homes: number;
  housed: number;
  housingCapacity: number;
  unhousedFounders: number;
  buildingCount: number;
  offMapTradeTrips: number;
  resources: SettlementResourceReportRow[];
};

type SettlementReportState = Pick<
  GameState,
  'settlements' | 'buildings' | 'residences' | 'deliveryTrips'
>;

/**
 * Read-only physical breakdown for one community. This never feeds spending,
 * affordability, or the realm Total/Surplus HUD.
 */
export function computeSettlementResourceReport(
  state: SettlementReportState,
  settlementId: string,
): SettlementResourceReport {
  const rows = new Map<ResourceKind, SettlementResourceReportRow>(
    RESOURCE_KINDS.map((resource) => [resource, emptyResourceRow(resource)]),
  );
  let homes = 0;
  let housed = 0;
  let housingCapacity = 0;
  let buildingCount = 0;

  for (const building of state.buildings.values()) {
    if (building.settlementId !== settlementId) continue;
    buildingCount += 1;
    addStoredBuildingResources(rows, building);
    if (building.constructionComplete === false) {
      add(rows, 'timber', 'committed', building.constructionReservedTimber);
      add(rows, 'stone', 'committed', building.constructionReservedStone);
      add(rows, 'ironwork', 'committed', building.constructionReservedIronwork ?? 0);
      add(rows, 'roofTiles', 'committed', building.constructionReservedRoofTiles ?? 0);
    }
  }

  for (const residence of state.residences.values()) {
    if (residence.settlementId !== settlementId) continue;
    if (residence.tier > 0 && !residence.abandoned) {
      homes += 1;
      housed += Math.max(0, residence.population);
      housingCapacity += Math.max(0, residence.populationCapacity);
    }
    addStoredResidenceResources(rows, residence);
    if (residenceHasActiveProject(residence)) {
      add(rows, 'timber', 'committed', residence.upgradeReservedTimber ?? 0);
      add(rows, 'stone', 'committed', residence.upgradeReservedStone ?? 0);
      add(rows, 'gold', 'committed', residence.upgradeReservedGold ?? 0);
      add(rows, 'roofTiles', 'committed', residence.upgradeReservedRoofTiles ?? 0);
    }
  }

  let offMapTradeTrips = 0;
  for (const trip of state.deliveryTrips.values()) {
    if (!deliveryTripHasPendingCargo(trip)) continue;
    const originSettlementId = state.buildings.get(trip.buildingId)?.settlementId;
    const destinationSettlementId = trip.destinationKind === 'residence'
      ? state.residences.get(trip.residenceId ?? '')?.settlementId
      : trip.destinationKind === 'building'
        ? state.buildings.get(trip.targetBuildingId ?? '')?.settlementId
        : undefined;
    if (destinationSettlementId === settlementId && originSettlementId !== settlementId) {
      add(rows, trip.cargoKind, 'inbound', trip.amount);
    }
    if (originSettlementId === settlementId && destinationSettlementId !== settlementId) {
      add(rows, trip.cargoKind, 'outbound', trip.amount);
      if (trip.destinationKind === 'trade') offMapTradeTrips += 1;
    }
  }

  return {
    settlement: state.settlements.get(settlementId) ?? null,
    homes,
    housed,
    housingCapacity,
    unhousedFounders: state.settlements.get(settlementId)?.unhousedFounders ?? 0,
    buildingCount,
    offMapTradeTrips,
    resources: [...rows.values()],
  };
}

function emptyResourceRow(resource: ResourceKind): SettlementResourceReportRow {
  return { resource, stored: 0, committed: 0, inbound: 0, outbound: 0 };
}

function addStoredBuildingResources(
  rows: Map<ResourceKind, SettlementResourceReportRow>,
  building: BuildingState,
): void {
  const holder = building as unknown as Partial<Record<ResourceKind, number>>;
  for (const resource of RESOURCE_KINDS) add(rows, resource, 'stored', holder[resource] ?? 0);
}

function addStoredResidenceResources(
  rows: Map<ResourceKind, SettlementResourceReportRow>,
  residence: ResidenceState,
): void {
  const holder = residence as unknown as Partial<Record<ResourceKind, number>>;
  for (const resource of RESOURCE_KINDS) add(rows, resource, 'stored', holder[resource] ?? 0);
  for (const resource of ['firewood', 'water', 'ale', 'cloth', 'shoes', 'pottery'] as const) {
    add(rows, resource, 'stored', residence.needs[resource]?.stock ?? 0);
  }
  add(rows, 'remedies', 'stored', residence.remedyStock ?? 0);
}

function add(
  rows: Map<ResourceKind, SettlementResourceReportRow>,
  resource: ResourceKind,
  field: Exclude<keyof SettlementResourceReportRow, 'resource'>,
  amount: number,
): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const row = rows.get(resource);
  if (row) row[field] += amount;
}
