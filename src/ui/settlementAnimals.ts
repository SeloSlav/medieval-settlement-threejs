import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import {
  assignStableOxen,
  type StableOxLike,
} from '../settlement/stableOxen.ts';

export type SettlementOxActivity = 'assisting' | 'hauling' | 'waiting' | 'available';

export type SettlementOxRosterEntry = Readonly<{
  id: string;
  stableId: string;
  stableLabel: string;
  bay: number;
  mode: 'posted' | 'automatic';
  postingBuildingId: string | null;
  postingLabel: string;
  activity: SettlementOxActivity;
  activityLabel: string;
  activityBuildingId: string | null;
}>;

export type SettlementAnimalsView = Readonly<{
  total: number;
  posted: number;
  automatic: number;
  working: number;
  entries: readonly SettlementOxRosterEntry[];
  /** Changes only when roster semantics change, not while a cart moves. */
  signature: string;
}>;

/**
 * Builds the top-HUD draft-animal ledger from the same pairing policy used by
 * the physical ox renderer. This keeps "Posted" (persistent) separate from
 * "Auto" (best-current-task) while still reporting the latter's live work.
 */
export function buildSettlementAnimalsView(
  oxen: Iterable<StableOxLike>,
  buildings: ReadonlyMap<string, BuildingState>,
  deliveryTrips: Iterable<DeliveryTripState>,
  disabledBuildingIds: ReadonlySet<string> = new Set(),
): SettlementAnimalsView {
  const orderedOxen = [...oxen].sort((left, right) =>
    left.stableId.localeCompare(right.stableId)
    || left.slot - right.slot
    || left.id.localeCompare(right.id));
  const trips = [...deliveryTrips];
  const assignmentByOxId = assignStableOxen(
    orderedOxen,
    buildings,
    trips,
    disabledBuildingIds,
  );
  const tripByOxId = new Map<string, DeliveryTripState>();
  for (const trip of trips) {
    if (trip.oxId) tripByOxId.set(trip.oxId, trip);
  }
  const labels = numberedBuildingLabels(buildings);

  const entries = orderedOxen.map<SettlementOxRosterEntry>((ox) => {
    const postingBuildingId = ox.assignedBuildingId ?? null;
    const postingLabel = postingBuildingId
      ? labels.get(postingBuildingId) ?? 'Former workplace'
      : 'Best available task';
    const stableLabel = labels.get(ox.stableId) ?? 'Stable';
    const trip = tripByOxId.get(ox.id);
    if (trip) {
      const originId = trip.laborBuildingId ?? trip.buildingId;
      const originLabel = labels.get(originId) ?? 'settlement stores';
      return {
        id: ox.id,
        stableId: ox.stableId,
        stableLabel,
        bay: ox.slot + 1,
        mode: postingBuildingId ? 'posted' : 'automatic',
        postingBuildingId,
        postingLabel,
        activity: 'hauling',
        activityLabel: `Hauling ${formatCargoLabel(trip.cargoKind)} from ${originLabel}`,
        activityBuildingId: buildings.has(originId) ? originId : null,
      };
    }

    const assignment = assignmentByOxId.get(ox.id);
    if (assignment) {
      const workplaceLabel = labels.get(assignment.buildingId) ?? 'work crew';
      return {
        id: ox.id,
        stableId: ox.stableId,
        stableLabel,
        bay: ox.slot + 1,
        mode: postingBuildingId ? 'posted' : 'automatic',
        postingBuildingId,
        postingLabel,
        activity: 'assisting',
        activityLabel: `Assisting ${workplaceLabel}`,
        activityBuildingId: assignment.buildingId,
      };
    }

    if (disabledBuildingIds.has(ox.stableId)) {
      return {
        id: ox.id,
        stableId: ox.stableId,
        stableLabel,
        bay: ox.slot + 1,
        mode: postingBuildingId ? 'posted' : 'automatic',
        postingBuildingId,
        postingLabel,
        activity: 'waiting',
        activityLabel: `Waiting — ${stableLabel} is unavailable`,
        activityBuildingId: buildings.has(ox.stableId) ? ox.stableId : null,
      };
    }

    if (postingBuildingId) {
      return {
        id: ox.id,
        stableId: ox.stableId,
        stableLabel,
        bay: ox.slot + 1,
        mode: 'posted',
        postingBuildingId,
        postingLabel,
        activity: 'waiting',
        activityLabel: disabledBuildingIds.has(postingBuildingId)
          ? `Waiting — ${postingLabel} is unavailable`
          : `Waiting for useful work at ${postingLabel}`,
        activityBuildingId: buildings.has(postingBuildingId) ? postingBuildingId : null,
      };
    }

    return {
      id: ox.id,
      stableId: ox.stableId,
      stableLabel,
      bay: ox.slot + 1,
      mode: 'automatic',
      postingBuildingId: null,
      postingLabel,
      activity: 'available',
      activityLabel: 'Awaiting the best assistance task',
      activityBuildingId: null,
    };
  });

  const posted = entries.reduce(
    (count, entry) => count + (entry.mode === 'posted' ? 1 : 0),
    0,
  );
  const working = entries.reduce(
    (count, entry) => count + (
      entry.activity === 'assisting' || entry.activity === 'hauling' ? 1 : 0
    ),
    0,
  );
  const signature = entries.map((entry) => [
    entry.id,
    entry.stableId,
    entry.bay,
    entry.mode,
    entry.postingBuildingId ?? '',
    entry.activity,
    entry.activityBuildingId ?? '',
    entry.activityLabel,
  ].join(':')).join('|');
  return {
    total: entries.length,
    posted,
    automatic: entries.length - posted,
    working,
    entries,
    signature,
  };
}

function numberedBuildingLabels(
  buildings: ReadonlyMap<string, BuildingState>,
): Map<string, string> {
  const byKind = new Map<BuildingKind, BuildingState[]>();
  for (const building of buildings.values()) {
    const group = byKind.get(building.kind) ?? [];
    group.push(building);
    byKind.set(building.kind, group);
  }
  const labels = new Map<string, string>();
  for (const [kind, group] of byKind) {
    group.sort((left, right) => left.id.localeCompare(right.id));
    const base = getBuildingDefinition(kind).label;
    group.forEach((building, index) => {
      labels.set(
        building.id,
        group.length > 1 ? `${base} ${index + 1}` : base,
      );
    });
  }
  return labels;
}

function formatCargoLabel(kind: DeliveryTripState['cargoKind']): string {
  return kind
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}
