import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { KENNEL_DOG_SLOTS, STABLE_OX_SLOTS } from '../generated/gameBalance.ts';
import {
  parseBuildingServerId,
  parseResidenceServerId,
  parseStableOxServerId,
} from '../data/spacetimeIds.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type {
  BackyardGardenState,
  BuildingKind,
  BuildingState,
  LivestockHerdState,
  LivestockSpecies,
  PastureState,
} from '../resources/types.ts';
import type { CombatAgentState } from '../security/combatAgents.ts';
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

export type SettlementStableLedger = Readonly<{
  /** Completed Stables that can physically house oxen. */
  stableCount: number;
  stableIds: readonly string[];
  occupied: number;
  capacity: number;
  openBays: number;
  /** Open bays in completed, currently fire-safe Stables. */
  purchaseReadyOpenBays: number;
  unavailableStableCount: number;
}>;

export type SettlementDogRosterEntry = Readonly<{
  id: string;
  kennelId: string;
  kennelLabel: string;
  bay: number;
  assignmentBuildingId: string | null;
  assignmentLabel: string;
  activityLabel: string;
}>;

export type SettlementDogLedger = Readonly<{
  total: number;
  assigned: number;
  free: number;
  kennelCount: number;
  capacity: number;
  openBays: number;
  entries: readonly SettlementDogRosterEntry[];
}>;

export type SettlementHerdSpeciesLedgerEntry = Readonly<{
  species: LivestockSpecies;
  label: string;
  headCount: number;
  holdingCount: number;
  holdingIds: readonly string[];
  pastureCount: number;
  pastureArea: number;
  /** Server-authored current pasture or woodland-mast support. */
  forageCapacity: number;
  /** Server-authored heads currently supportable after feed and husbandry. */
  suppliedCapacity: number;
  housingLabel: 'Pasture' | 'Woodland pannage';
}>;

export type SettlementHerdLedger = Readonly<{
  headCount: number;
  holdingCount: number;
  pastureCount: number;
  pastureArea: number;
  forageCapacity: number;
  suppliedCapacity: number;
  species: readonly SettlementHerdSpeciesLedgerEntry[];
}>;

export type SettlementBackyardPenKind =
  | 'chickens'
  | 'goats'
  | 'pigs'
  | 'unstocked';

export type SettlementBackyardPenLedgerEntry = Readonly<{
  kind: SettlementBackyardPenKind;
  label: string;
  /** One replicated row is one household pen, not a known animal head count. */
  penCount: number;
  residenceIds: readonly string[];
}>;

export type SettlementBackyardLedger = Readonly<{
  penCount: number;
  specializedPenCount: number;
  unstockedPenCount: number;
  pens: readonly SettlementBackyardPenLedgerEntry[];
}>;

export type SettlementLivestockLedger = Readonly<{
  /** Exact draft-ox, dog, and farm-herd heads, including deployed pasture-owned horses. */
  headCount: number;
  stable: SettlementStableLedger;
  dogs: SettlementDogLedger;
  herds: SettlementHerdLedger;
  backyard: SettlementBackyardLedger;
}>;

export type SettlementLivestockLedgerInput = Readonly<{
  herds?: Iterable<LivestockHerdState>;
  pastures?: Iterable<PastureState>;
  backyardGardens?: Iterable<BackyardGardenState>;
  combatAgents?: Iterable<CombatAgentState>;
  /** Current schedule pause (holy day, Sabbath, raid response, etc.) for production labor. */
  laborPauseLabel?: string | null;
}>;

export type SettlementAnimalsView = Readonly<{
  /** Draft oxen only; retained for assignment-roster compatibility. */
  total: number;
  posted: number;
  automatic: number;
  working: number;
  entries: readonly SettlementOxRosterEntry[];
  /** Present on every built live view; optional only for legacy/reset literals. */
  ledger?: SettlementLivestockLedger;
  /** Changes only when roster semantics change, not while a cart moves. */
  signature: string;
}>;

export type SettlementAnimalsViewWithLedger = SettlementAnimalsView & Readonly<{
  ledger: SettlementLivestockLedger;
}>;

/**
 * Builds the top-HUD livestock ledger. Draft-ox activity comes from the same
 * pairing policy used by the physical renderer, while farm herds and household
 * pens retain the units their replicated tables actually author.
 */
export function buildSettlementAnimalsView(
  oxen: Iterable<StableOxLike>,
  buildings: ReadonlyMap<string, BuildingState>,
  deliveryTrips: Iterable<DeliveryTripState>,
  disabledBuildingIds: ReadonlySet<string> = new Set(),
  livestock: SettlementLivestockLedgerInput = {},
): SettlementAnimalsViewWithLedger {
  const orderedOxen = [...oxen].sort((left, right) =>
    compareServerIds(left.stableId, right.stableId, parseBuildingServerId)
    || left.slot - right.slot
    || compareServerIds(left.id, right.id, parseStableOxServerId));
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
  const dogLedger = buildSettlementDogLedger(
    livestock.combatAgents ?? [],
    buildings,
    disabledBuildingIds,
    labels,
  );
  const laborPauseLabel = livestock.laborPauseLabel?.trim() || null;

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
      if (laborPauseLabel) {
        return {
          id: ox.id,
          stableId: ox.stableId,
          stableLabel,
          bay: ox.slot + 1,
          mode: postingBuildingId ? 'posted' : 'automatic',
          postingBuildingId,
          postingLabel,
          activity: 'waiting',
          activityLabel: `Resting — ${laborPauseLabel}`,
          activityBuildingId: null,
        };
      }
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
  const ledger = buildSettlementLivestockLedger(
    orderedOxen,
    buildings,
    disabledBuildingIds,
    livestock,
    dogLedger,
  );
  const rosterSignature = entries.map((entry) => [
    entry.id,
    entry.stableId,
    entry.stableLabel,
    entry.bay,
    entry.mode,
    entry.postingBuildingId ?? '',
    entry.postingLabel,
    entry.activity,
    entry.activityBuildingId ?? '',
    entry.activityLabel,
  ].join(':')).join('|');
  const ledgerSignature = [
    ledger.headCount,
    ledger.stable.stableCount,
    ledger.stable.stableIds.join(','),
    ledger.stable.occupied,
    ledger.stable.capacity,
    ledger.stable.purchaseReadyOpenBays,
    ledger.stable.unavailableStableCount,
    ledger.dogs.total,
    ledger.dogs.assigned,
    ledger.dogs.kennelCount,
    ledger.dogs.capacity,
    ...ledger.dogs.entries.map((entry) => [
      entry.id,
      entry.kennelId,
      entry.bay,
      entry.assignmentBuildingId ?? '',
      entry.activityLabel,
    ].join(':')),
    ...ledger.herds.species.map((entry) => [
      entry.species,
      entry.headCount,
      entry.holdingIds.join(','),
      entry.pastureCount,
      entry.pastureArea,
      entry.forageCapacity,
      entry.suppliedCapacity,
    ].join(':')),
    ...ledger.backyard.pens.map((entry) => [
      entry.kind,
      entry.penCount,
      entry.residenceIds.join(','),
    ].join(':')),
  ].join('|');
  return {
    total: entries.length,
    posted,
    automatic: entries.length - posted,
    working,
    entries,
    ledger,
    signature: `${rosterSignature}#${ledgerSignature}`,
  };
}

const HERD_SPECIES_ROWS = [
  { species: 'cattle', label: 'Cattle', housingLabel: 'Pasture' },
  { species: 'sheep', label: 'Sheep', housingLabel: 'Pasture' },
  { species: 'swine', label: 'Swine', housingLabel: 'Woodland pannage' },
  { species: 'horses', label: 'Horses', housingLabel: 'Pasture' },
] as const satisfies readonly Readonly<{
  species: LivestockSpecies;
  label: string;
  housingLabel: SettlementHerdSpeciesLedgerEntry['housingLabel'];
}>[];

const BACKYARD_PEN_ROWS = [
  { kind: 'chickens', label: 'Chicken pens', gardenKind: 'chicken_pen' },
  { kind: 'goats', label: 'Goat pens', gardenKind: 'goat_pen' },
  { kind: 'pigs', label: 'Pig pens', gardenKind: 'pig_pen' },
  { kind: 'unstocked', label: 'Unstocked animal pens', gardenKind: 'animal_pen' },
] as const satisfies readonly Readonly<{
  kind: SettlementBackyardPenKind;
  label: string;
  gardenKind: BackyardGardenState['kind'];
}>[];

function buildSettlementLivestockLedger(
  oxen: readonly StableOxLike[],
  buildings: ReadonlyMap<string, BuildingState>,
  disabledBuildingIds: ReadonlySet<string>,
  input: SettlementLivestockLedgerInput,
  dogs: SettlementDogLedger,
): SettlementLivestockLedger {
  const oxenByStable = new Map<string, number>();
  for (const ox of oxen) {
    oxenByStable.set(ox.stableId, (oxenByStable.get(ox.stableId) ?? 0) + 1);
  }

  const stableIds = [...buildings.values()]
    .filter((building) => building.kind === 'stable' && building.constructionComplete !== false)
    .map((building) => building.id)
    .sort((left, right) => compareServerIds(left, right, parseBuildingServerId));
  const stableCapacity = stableIds.length * STABLE_OX_SLOTS;
  const purchaseReadyOpenBays = stableIds.reduce((open, stableId) => {
    if (disabledBuildingIds.has(stableId)) return open;
    return open + Math.max(0, STABLE_OX_SLOTS - (oxenByStable.get(stableId) ?? 0));
  }, 0);

  const pasturesById = new Map<string, PastureState>();
  for (const pasture of input.pastures ?? []) {
    pasturesById.set(pasture.id, pasture);
  }
  const herdsBySpecies = new Map<LivestockSpecies, LivestockHerdState[]>();
  for (const herd of input.herds ?? []) {
    const speciesHerds = herdsBySpecies.get(herd.species) ?? [];
    speciesHerds.push(herd);
    herdsBySpecies.set(herd.species, speciesHerds);
  }
  const herdSpecies = HERD_SPECIES_ROWS.map<SettlementHerdSpeciesLedgerEntry>((row) => {
    const herds = herdsBySpecies.get(row.species) ?? [];
    const holdingIds = [...new Set(herds.map((herd) => herd.buildingId))]
      .sort((left, right) => compareServerIds(left, right, parseBuildingServerId));
    const pastures = herds
      .map((herd) => pasturesById.get(herd.pastureId))
      .filter((pasture): pasture is PastureState => pasture != null);
    return {
      species: row.species,
      label: row.label,
      headCount: sumNumbers(herds.map((herd) => herd.headCount), true),
      holdingCount: holdingIds.length,
      holdingIds,
      pastureCount: pastures.length,
      pastureArea: sumNumbers(pastures.map((pasture) => pasture.area)),
      forageCapacity: sumNumbers(herds.map((herd) => herd.pastureCapacity)),
      suppliedCapacity: sumNumbers(herds.map((herd) => herd.suppliedCapacity)),
      housingLabel: row.housingLabel,
    };
  });

  const gardens = [...(input.backyardGardens ?? [])];
  const backyardPens = BACKYARD_PEN_ROWS.map<SettlementBackyardPenLedgerEntry>((row) => {
    const residenceIds = gardens
      .filter((garden) => garden.kind === row.gardenKind)
      .map((garden) => garden.residenceId)
      .sort((left, right) => compareServerIds(left, right, parseResidenceServerId));
    return {
      kind: row.kind,
      label: row.label,
      penCount: residenceIds.length,
      residenceIds,
    };
  });

  const herdHeadCount = sumNumbers(herdSpecies.map((entry) => entry.headCount), true);
  const livestockHoldingCount = new Set(
    [...(input.herds ?? [])].map((herd) => herd.buildingId),
  ).size;
  const backyardPenCount = sumNumbers(backyardPens.map((entry) => entry.penCount), true);
  const unstockedPenCount = backyardPens.find((entry) => entry.kind === 'unstocked')?.penCount ?? 0;
  return {
    headCount: oxen.length + dogs.total + herdHeadCount,
    stable: {
      stableCount: stableIds.length,
      stableIds,
      occupied: oxen.length,
      capacity: stableCapacity,
      openBays: Math.max(0, stableCapacity - oxen.length),
      purchaseReadyOpenBays,
      unavailableStableCount: stableIds.reduce(
        (count, stableId) => count + (disabledBuildingIds.has(stableId) ? 1 : 0),
        0,
      ),
    },
    dogs,
    herds: {
      headCount: herdHeadCount,
      holdingCount: livestockHoldingCount,
      pastureCount: sumNumbers(herdSpecies.map((entry) => entry.pastureCount), true),
      pastureArea: sumNumbers(herdSpecies.map((entry) => entry.pastureArea)),
      forageCapacity: sumNumbers(herdSpecies.map((entry) => entry.forageCapacity)),
      suppliedCapacity: sumNumbers(herdSpecies.map((entry) => entry.suppliedCapacity)),
      species: herdSpecies,
    },
    backyard: {
      penCount: backyardPenCount,
      specializedPenCount: backyardPenCount - unstockedPenCount,
      unstockedPenCount,
      pens: backyardPens,
    },
  };
}

function buildSettlementDogLedger(
  combatAgents: Iterable<CombatAgentState>,
  buildings: ReadonlyMap<string, BuildingState>,
  disabledBuildingIds: ReadonlySet<string>,
  labels: ReadonlyMap<string, string>,
): SettlementDogLedger {
  const dogs = [...combatAgents]
    .filter((agent) =>
      agent.faction === 'dog'
      && agent.sourceBuildingId != null
      && agent.health > 0
      && agent.status !== 'downed')
    .sort((left, right) =>
      compareServerIds(
        left.sourceBuildingId ?? '',
        right.sourceBuildingId ?? '',
        parseBuildingServerId,
      )
      || left.sourceSlot - right.sourceSlot
      || left.id.localeCompare(right.id));
  const kennelIds = [...buildings.values()]
    .filter((building) => building.kind === 'kennel' && building.constructionComplete !== false)
    .map((building) => building.id)
    .sort((left, right) => compareServerIds(left, right, parseBuildingServerId));
  const entries = dogs.map<SettlementDogRosterEntry>((dog) => {
    const kennelId = dog.sourceBuildingId as string;
    const assignmentBuildingId = dog.assignedBuildingId ?? null;
    const assignmentLabel = assignmentBuildingId
      ? labels.get(assignmentBuildingId) ?? "Former Hunter's Hall"
      : 'Free patrol';
    const responding = dog.status === 'fighting'
      || (dog.status === 'advancing' && dog.targetKind === 'combat-agent');
    return {
      id: dog.id,
      kennelId,
      kennelLabel: labels.get(kennelId) ?? 'Kennel',
      bay: dog.sourceSlot + 1,
      assignmentBuildingId,
      assignmentLabel,
      activityLabel: responding
        ? 'Responding to a nearby threat'
        : assignmentBuildingId
          ? `Hunting at ${assignmentLabel}`
          : 'Wandering and protecting the settlement',
    };
  });
  const assigned = entries.reduce(
    (count, entry) => count + (entry.assignmentBuildingId ? 1 : 0),
    0,
  );
  const occupiedByKennel = new Map<string, number>();
  for (const entry of entries) {
    occupiedByKennel.set(entry.kennelId, (occupiedByKennel.get(entry.kennelId) ?? 0) + 1);
  }
  const capacity = kennelIds.length * KENNEL_DOG_SLOTS;
  const readyOpenBays = kennelIds.reduce((open, kennelId) =>
    open + (disabledBuildingIds.has(kennelId)
      ? 0
      : Math.max(0, KENNEL_DOG_SLOTS - (occupiedByKennel.get(kennelId) ?? 0))), 0);
  return {
    total: entries.length,
    assigned,
    free: entries.length - assigned,
    kennelCount: kennelIds.length,
    capacity,
    openBays: readyOpenBays,
    entries,
  };
}

function sumNumbers(values: Iterable<number>, whole = false): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    total += Math.max(0, whole ? Math.floor(value) : value);
  }
  return total;
}

function compareServerIds(
  left: string,
  right: string,
  parse: (id: string) => bigint | null,
): number {
  const leftId = parse(left);
  const rightId = parse(right);
  if (leftId != null && rightId != null) {
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  }
  return left.localeCompare(right);
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
    group.sort((left, right) =>
      compareServerIds(left.id, right.id, parseBuildingServerId));
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
