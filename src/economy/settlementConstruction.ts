import {
  BUILDING_DEFINITIONS,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  CONSTRUCTION_MAX_BUILDERS,
  CONSTRUCTION_WORK_PER_WORKER_PER_SEC,
} from '../generated/gameBalance.ts';
import {
  CONSTRUCTION_PRIORITY_HOLD,
  CONSTRUCTION_PRIORITY_LOW,
  CONSTRUCTION_PRIORITY_NORMAL,
  CONSTRUCTION_PRIORITY_URGENT,
  normalizeConstructionPriority,
  type ConstructionPriority,
} from '../logistics/constructionPriority.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import type { BuildingState, GameState } from '../resources/types.ts';

const EPSILON = 1e-6;
const WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;

export type ConstructionMaterialKind = 'timber' | 'stone';

export type ConstructionMaterialQueue = {
  required: number;
  delivered: number;
  remaining: number;
  foundersReserve: number;
  awaitingPickup: number;
  inTransit: number;
  uncovered: number;
};

export const CONSTRUCTION_QUEUE_SITE_STATUSES = [
  'held',
  'building',
  'founders-reserve',
  'in-transit',
  'waiting-builders',
  'off-road',
  'waiting-hauler',
  'waiting-materials',
] as const;

export type ConstructionQueueSiteStatus =
  (typeof CONSTRUCTION_QUEUE_SITE_STATUSES)[number];

export type ConstructionQueuePriorityCounts = {
  held: number;
  low: number;
  normal: number;
  urgent: number;
};

export type ConstructionQueueAttention = {
  buildingId: string;
  priority: ConstructionPriority;
  status: Extract<
    ConstructionQueueSiteStatus,
    'waiting-builders' | 'off-road' | 'waiting-hauler' | 'waiting-materials'
  >;
};

export type SettlementConstructionPlan = {
  siteCount: number;
  activeSites: number;
  heldSites: number;
  priorityCounts: ConstructionQueuePriorityCounts;
  statusCounts: Record<ConstructionQueueSiteStatus, number>;
  assignedBuilders: number;
  builderCapacity: number;
  remainingBuilderDays: number;
  materials: Record<ConstructionMaterialKind, ConstructionMaterialQueue>;
  firstAttention: ConstructionQueueAttention | null;
};

type TransitAmounts = Record<ConstructionMaterialKind, number>;
const ZERO_TRANSIT_AMOUNTS: TransitAmounts = { timber: 0, stone: 0 };

function emptyTransitAmounts(): TransitAmounts {
  return { timber: 0, stone: 0 };
}

function emptyMaterialQueue(): ConstructionMaterialQueue {
  return {
    required: 0,
    delivered: 0,
    remaining: 0,
    foundersReserve: 0,
    awaitingPickup: 0,
    inTransit: 0,
    uncovered: 0,
  };
}

function emptyStatusCounts(): Record<ConstructionQueueSiteStatus, number> {
  return {
    held: 0,
    building: 0,
    'founders-reserve': 0,
    'in-transit': 0,
    'waiting-builders': 0,
    'off-road': 0,
    'waiting-hauler': 0,
    'waiting-materials': 0,
  };
}

function nonnegative(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function constructionTransitBySite(
  trips: Iterable<DeliveryTripState>,
): Map<string, TransitAmounts> {
  const bySite = new Map<string, TransitAmounts>();
  for (const trip of trips) {
    if (
      trip.phase === 'inbound'
      || trip.destinationKind !== 'building'
      || trip.targetBuildingId === null
      || (trip.cargoKind !== 'timber' && trip.cargoKind !== 'stone')
      || trip.amount <= EPSILON
    ) {
      continue;
    }
    let amounts = bySite.get(trip.targetBuildingId);
    if (!amounts) {
      amounts = emptyTransitAmounts();
      bySite.set(trip.targetBuildingId, amounts);
    }
    amounts[trip.cargoKind] += trip.amount;
  }
  return bySite;
}

function priorityKey(
  priority: ConstructionPriority,
): keyof ConstructionQueuePriorityCounts {
  switch (priority) {
    case CONSTRUCTION_PRIORITY_HOLD: return 'held';
    case CONSTRUCTION_PRIORITY_LOW: return 'low';
    case CONSTRUCTION_PRIORITY_NORMAL: return 'normal';
    case CONSTRUCTION_PRIORITY_URGENT: return 'urgent';
  }
  return 'normal';
}

function materialValues(
  building: BuildingState,
  material: ConstructionMaterialKind,
  inTransit: number,
): ConstructionMaterialQueue {
  const required = material === 'timber'
    ? nonnegative(building.constructionRequiredTimber)
    : nonnegative(building.constructionRequiredStone);
  const delivered = material === 'timber'
    ? nonnegative(building.constructionDeliveredTimber)
    : nonnegative(building.constructionDeliveredStone);
  const reserved = material === 'timber'
    ? nonnegative(building.constructionReservedTimber)
    : nonnegative(building.constructionReservedStone);
  const foundersReserve = Math.min(
    reserved,
    material === 'timber'
      ? nonnegative(building.constructionTreasuryTimber)
      : nonnegative(building.constructionTreasuryStone),
  );
  const remaining = Math.max(0, required - delivered);
  const coveredByFounders = Math.min(remaining, foundersReserve);
  const awaitingPickup = Math.min(
    Math.max(0, remaining - coveredByFounders),
    Math.max(0, reserved - foundersReserve),
  );
  const traveling = Math.min(
    Math.max(0, remaining - coveredByFounders - awaitingPickup),
    nonnegative(inTransit),
  );
  const covered = coveredByFounders + awaitingPickup + traveling;
  return {
    required,
    delivered: Math.min(required, delivered),
    remaining,
    foundersReserve: coveredByFounders,
    awaitingPickup,
    inTransit: traveling,
    uncovered: Math.max(0, remaining - covered),
  };
}

function addMaterialQueue(
  target: ConstructionMaterialQueue,
  source: ConstructionMaterialQueue,
): void {
  target.required += source.required;
  target.delivered += source.delivered;
  target.remaining += source.remaining;
  target.foundersReserve += source.foundersReserve;
  target.awaitingPickup += source.awaitingPickup;
  target.inTransit += source.inTransit;
  target.uncovered += source.uncovered;
}

function statusForSite(input: {
  building: BuildingState;
  priority: ConstructionPriority;
  timber: ConstructionMaterialQueue;
  stone: ConstructionMaterialQueue;
  hasRoadAccess: () => boolean;
}): ConstructionQueueSiteStatus {
  const {
    building,
    priority,
    timber,
    stone,
    hasRoadAccess,
  } = input;
  if (priority === CONSTRUCTION_PRIORITY_HOLD) return 'held';
  if (nonnegative(building.assignedLabor) <= EPSILON) return 'waiting-builders';

  const requiredTotal = timber.required + stone.required;
  const deliveredTotal = timber.delivered + stone.delivered;
  const materialReadiness = requiredTotal <= EPSILON
    ? 1
    : Math.min(1, deliveredTotal / requiredTotal);
  const progress = Math.min(1, nonnegative(building.constructionProgress));
  if (progress + EPSILON < materialReadiness) return 'building';

  if (timber.foundersReserve + stone.foundersReserve > EPSILON) {
    return 'founders-reserve';
  }
  if (timber.inTransit + stone.inTransit > EPSILON) return 'in-transit';
  if (
    BUILDING_DEFINITIONS[building.kind].requiresRoad
    && !hasRoadAccess()
    && timber.awaitingPickup + stone.awaitingPickup > EPSILON
  ) {
    return 'off-road';
  }
  if (timber.awaitingPickup + stone.awaitingPickup > EPSILON) {
    return 'waiting-hauler';
  }
  if (timber.remaining + stone.remaining > EPSILON) return 'waiting-materials';
  return 'building';
}

function attentionRank(status: ConstructionQueueAttention['status']): number {
  switch (status) {
    case 'waiting-builders': return 0;
    case 'off-road': return 1;
    case 'waiting-materials': return 2;
    case 'waiting-hauler': return 3;
  }
}

function shouldReplaceAttention(
  candidate: ConstructionQueueAttention,
  current: ConstructionQueueAttention | null,
): boolean {
  if (current === null) return true;
  if (candidate.priority !== current.priority) {
    return candidate.priority > current.priority;
  }
  const rankDifference = attentionRank(candidate.status) - attentionRank(current.status);
  if (rankDifference !== 0) return rankDifference < 0;
  return compareStableEntityIds(candidate.buildingId, current.buildingId) < 0;
}

export function constructionQueueStatusLabel(
  status: ConstructionQueueSiteStatus,
): string {
  switch (status) {
    case 'held': return 'held by policy';
    case 'building': return 'builder work available';
    case 'founders-reserve': return "moving founders' reserve";
    case 'in-transit': return 'cart inbound';
    case 'waiting-builders': return 'needs builders';
    case 'off-road': return 'off-road materials';
    case 'waiting-hauler': return 'materials await a hauler';
    case 'waiting-materials': return 'materials not yet reserved';
  }
}

export function computeSettlementConstructionPlan(input: {
  state: Pick<GameState, 'buildings' | 'deliveryTrips'>;
  hasRoadAccess?: (building: BuildingState) => boolean;
}): SettlementConstructionPlan {
  const transitBySite = constructionTransitBySite(input.state.deliveryTrips.values());
  const priorityCounts: ConstructionQueuePriorityCounts = {
    held: 0,
    low: 0,
    normal: 0,
    urgent: 0,
  };
  const statusCounts = emptyStatusCounts();
  const materials: SettlementConstructionPlan['materials'] = {
    timber: emptyMaterialQueue(),
    stone: emptyMaterialQueue(),
  };
  let siteCount = 0;
  let activeSites = 0;
  let heldSites = 0;
  let assignedBuilders = 0;
  let remainingBuilderDays = 0;
  let firstAttention: ConstructionQueueAttention | null = null;

  for (const building of input.state.buildings.values()) {
    if (building.constructionComplete !== false) continue;
    siteCount += 1;
    const priority = normalizeConstructionPriority(building.constructionPriority);
    priorityCounts[priorityKey(priority)] += 1;
    if (priority === CONSTRUCTION_PRIORITY_HOLD) {
      heldSites += 1;
    } else {
      activeSites += 1;
      assignedBuilders += nonnegative(building.assignedLabor);
    }

    const transit = transitBySite.get(building.id) ?? ZERO_TRANSIT_AMOUNTS;
    const timber = materialValues(building, 'timber', transit.timber);
    const stone = materialValues(building, 'stone', transit.stone);
    addMaterialQueue(materials.timber, timber);
    addMaterialQueue(materials.stone, stone);

    if (priority !== CONSTRUCTION_PRIORITY_HOLD) {
      const requiredTotal = timber.required + stone.required;
      remainingBuilderDays += Math.max(
        0,
        requiredTotal * (1 - Math.min(1, nonnegative(building.constructionProgress))),
      ) / Math.max(EPSILON, CONSTRUCTION_WORK_PER_WORKER_PER_SEC * WORKDAY_SECONDS);
    }

    const status = statusForSite({
      building,
      priority,
      timber,
      stone,
      hasRoadAccess: () => input.hasRoadAccess?.(building) ?? true,
    });
    statusCounts[status] += 1;
    if (
      status === 'waiting-builders'
      || status === 'off-road'
      || status === 'waiting-hauler'
      || status === 'waiting-materials'
    ) {
      const candidate: ConstructionQueueAttention = {
        buildingId: building.id,
        priority,
        status,
      };
      if (shouldReplaceAttention(candidate, firstAttention)) {
        firstAttention = candidate;
      }
    }
  }

  return {
    siteCount,
    activeSites,
    heldSites,
    priorityCounts,
    statusCounts,
    assignedBuilders,
    builderCapacity: activeSites * CONSTRUCTION_MAX_BUILDERS,
    remainingBuilderDays,
    materials,
    firstAttention,
  };
}
