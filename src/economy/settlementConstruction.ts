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
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import {
  productionRoadBranchKey,
  type ProductionRoadComponentResolver,
} from './settlementProduction.ts';

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
  fireDisabledSourceBuildings: number;
  fireBlockedTimberStock: number;
  fireBlockedStoneStock: number;
  firstFireDisabledSourceId: string | null;
  firstAttention: ConstructionQueueAttention | null;
  roadPlan: SettlementConstructionRoadPlan | null;
};

export type ConstructionRoadMaterialPlan = {
  roadBoundClaim: number;
  matchedRoadBoundClaim: number;
  strandedRoadBoundClaim: number;
  offroadClaim: number;
  offroadPotentialCoverage: number;
  sourceStock: number;
  fragmentationCoverage: number;
  unmatchedSourceStock: number;
};

export type SettlementConstructionRoadBranch = {
  claimSites: number;
  timberClaim: number;
  stoneClaim: number;
  sourceTimberStock: number;
  sourceStoneStock: number;
  matchedTimber: number;
  matchedStone: number;
  strandedTimber: number;
  strandedStone: number;
};

export type SettlementConstructionRoadPlan = {
  activeBranches: number;
  claimBranches: number;
  suppliedClaimBranches: number;
  exposedClaimBranches: number;
  roadBoundSites: number;
  offroadSites: number;
  materials: Record<ConstructionMaterialKind, ConstructionRoadMaterialPlan>;
  firstExposedBuildingId: string | null;
  branches: ReadonlyMap<string, SettlementConstructionRoadBranch>;
};

type TransitAmounts = Record<ConstructionMaterialKind, number>;
const ZERO_TRANSIT_AMOUNTS: TransitAmounts = { timber: 0, stone: 0 };
type PriorityAmounts = [number, number, number, number];
type PriorityBuildingIds = [
  string | null,
  string | null,
  string | null,
  string | null,
];

type MutableConstructionRoadBranch = SettlementConstructionRoadBranch & {
  timberByPriority: PriorityAmounts;
  stoneByPriority: PriorityAmounts;
  firstTimberIdByPriority: PriorityBuildingIds;
  firstStoneIdByPriority: PriorityBuildingIds;
};

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

function emptyPriorityAmounts(): PriorityAmounts {
  return [0, 0, 0, 0];
}

function emptyPriorityBuildingIds(): PriorityBuildingIds {
  return [null, null, null, null];
}

function constructionRoadBranch(
  branches: Map<string, MutableConstructionRoadBranch>,
  key: string,
): MutableConstructionRoadBranch {
  let branch = branches.get(key);
  if (branch) return branch;
  branch = {
    claimSites: 0,
    timberClaim: 0,
    stoneClaim: 0,
    sourceTimberStock: 0,
    sourceStoneStock: 0,
    matchedTimber: 0,
    matchedStone: 0,
    strandedTimber: 0,
    strandedStone: 0,
    timberByPriority: emptyPriorityAmounts(),
    stoneByPriority: emptyPriorityAmounts(),
    firstTimberIdByPriority: emptyPriorityBuildingIds(),
    firstStoneIdByPriority: emptyPriorityBuildingIds(),
  };
  branches.set(key, branch);
  return branch;
}

function recordRoadClaim(
  branch: MutableConstructionRoadBranch,
  material: ConstructionMaterialKind,
  amount: number,
  priority: ConstructionPriority,
  buildingId: string,
): void {
  if (amount <= EPSILON) return;
  const byPriority = material === 'timber'
    ? branch.timberByPriority
    : branch.stoneByPriority;
  const ids = material === 'timber'
    ? branch.firstTimberIdByPriority
    : branch.firstStoneIdByPriority;
  byPriority[priority] += amount;
  if (
    ids[priority] === null
    || compareStableEntityIds(buildingId, ids[priority]) < 0
  ) {
    ids[priority] = buildingId;
  }
}

type ExposedRoadClaim = {
  buildingId: string;
  priority: ConstructionPriority;
};

function firstUndercoveredRoadClaim(
  branch: MutableConstructionRoadBranch,
  material: ConstructionMaterialKind,
): ExposedRoadClaim | null {
  const byPriority = material === 'timber'
    ? branch.timberByPriority
    : branch.stoneByPriority;
  const ids = material === 'timber'
    ? branch.firstTimberIdByPriority
    : branch.firstStoneIdByPriority;
  let sourceStock = material === 'timber'
    ? branch.sourceTimberStock
    : branch.sourceStoneStock;
  for (
    let priority = CONSTRUCTION_PRIORITY_URGENT;
    priority >= CONSTRUCTION_PRIORITY_HOLD;
    priority -= 1
  ) {
    const claim = byPriority[priority];
    if (claim <= EPSILON) continue;
    if (sourceStock + EPSILON >= claim) {
      sourceStock = Math.max(0, sourceStock - claim);
      continue;
    }
    const buildingId = ids[priority];
    if (buildingId === null) return null;
    return {
      buildingId,
      priority: priority as ConstructionPriority,
    };
  }
  return null;
}

function roadMaterialPlan(input: {
  roadBoundClaim: number;
  matchedRoadBoundClaim: number;
  offroadClaim: number;
  sourceStock: number;
}): ConstructionRoadMaterialPlan {
  const strandedRoadBoundClaim = Math.max(
    0,
    input.roadBoundClaim - input.matchedRoadBoundClaim,
  );
  const remainingSourceStock = Math.max(
    0,
    input.sourceStock - input.matchedRoadBoundClaim,
  );
  const offroadPotentialCoverage = Math.min(
    input.offroadClaim,
    remainingSourceStock,
  );
  return {
    roadBoundClaim: input.roadBoundClaim,
    matchedRoadBoundClaim: input.matchedRoadBoundClaim,
    strandedRoadBoundClaim,
    offroadClaim: input.offroadClaim,
    offroadPotentialCoverage,
    sourceStock: input.sourceStock,
    fragmentationCoverage: Math.max(
      0,
      Math.min(input.roadBoundClaim, input.sourceStock)
        - input.matchedRoadBoundClaim,
    ),
    unmatchedSourceStock: Math.max(
      0,
      remainingSourceStock - offroadPotentialCoverage,
    ),
  };
}

function buildConstructionRoadPlan(input: {
  branches: Map<string, MutableConstructionRoadBranch> | null;
  roadBoundSites: number;
  offroadSites: number;
  offroadClaims: TransitAmounts;
}): SettlementConstructionRoadPlan | null {
  if (input.branches === null) return null;
  let claimBranches = 0;
  let suppliedClaimBranches = 0;
  let exposedClaimBranches = 0;
  let roadBoundTimberClaim = 0;
  let roadBoundStoneClaim = 0;
  let matchedTimber = 0;
  let matchedStone = 0;
  let sourceTimberStock = 0;
  let sourceStoneStock = 0;
  let firstExposedBuildingId: string | null = null;
  let firstExposedPriority = CONSTRUCTION_PRIORITY_HOLD;
  let firstExposureRatio = Number.POSITIVE_INFINITY;
  let firstExposureAmount = 0;

  for (const branch of input.branches.values()) {
    branch.matchedTimber = Math.min(
      branch.timberClaim,
      branch.sourceTimberStock,
    );
    branch.matchedStone = Math.min(
      branch.stoneClaim,
      branch.sourceStoneStock,
    );
    branch.strandedTimber = Math.max(
      0,
      branch.timberClaim - branch.matchedTimber,
    );
    branch.strandedStone = Math.max(
      0,
      branch.stoneClaim - branch.matchedStone,
    );
    roadBoundTimberClaim += branch.timberClaim;
    roadBoundStoneClaim += branch.stoneClaim;
    matchedTimber += branch.matchedTimber;
    matchedStone += branch.matchedStone;
    sourceTimberStock += branch.sourceTimberStock;
    sourceStoneStock += branch.sourceStoneStock;

    const claim = branch.timberClaim + branch.stoneClaim;
    if (claim <= EPSILON) continue;
    claimBranches += 1;
    const exposure = branch.strandedTimber + branch.strandedStone;
    if (exposure <= 0.05) {
      suppliedClaimBranches += 1;
      continue;
    }
    exposedClaimBranches += 1;

    const timberCandidate = branch.strandedTimber > 0.05
      ? firstUndercoveredRoadClaim(branch, 'timber')
      : null;
    const stoneCandidate = branch.strandedStone > 0.05
      ? firstUndercoveredRoadClaim(branch, 'stone')
      : null;
    let candidate = timberCandidate;
    if (
      stoneCandidate !== null
      && (
        candidate === null
        || stoneCandidate.priority > candidate.priority
        || (
          stoneCandidate.priority === candidate.priority
          && compareStableEntityIds(
            stoneCandidate.buildingId,
            candidate.buildingId,
          ) < 0
        )
      )
    ) {
      candidate = stoneCandidate;
    }
    if (candidate === null) continue;
    const coverageRatio = claim > EPSILON
      ? (branch.matchedTimber + branch.matchedStone) / claim
      : 1;
    if (
      firstExposedBuildingId === null
      || candidate.priority > firstExposedPriority
      || (
        candidate.priority === firstExposedPriority
        && (
          coverageRatio < firstExposureRatio - EPSILON
          || (
            Math.abs(coverageRatio - firstExposureRatio) <= EPSILON
            && (
              exposure > firstExposureAmount + EPSILON
              || (
                Math.abs(exposure - firstExposureAmount) <= EPSILON
                && compareStableEntityIds(
                  candidate.buildingId,
                  firstExposedBuildingId,
                ) < 0
              )
            )
          )
        )
      )
    ) {
      firstExposedBuildingId = candidate.buildingId;
      firstExposedPriority = candidate.priority;
      firstExposureRatio = coverageRatio;
      firstExposureAmount = exposure;
    }
  }

  return {
    activeBranches: input.branches.size,
    claimBranches,
    suppliedClaimBranches,
    exposedClaimBranches,
    roadBoundSites: input.roadBoundSites,
    offroadSites: input.offroadSites,
    materials: {
      timber: roadMaterialPlan({
        roadBoundClaim: roadBoundTimberClaim,
        matchedRoadBoundClaim: matchedTimber,
        offroadClaim: input.offroadClaims.timber,
        sourceStock: sourceTimberStock,
      }),
      stone: roadMaterialPlan({
        roadBoundClaim: roadBoundStoneClaim,
        matchedRoadBoundClaim: matchedStone,
        offroadClaim: input.offroadClaims.stone,
        sourceStock: sourceStoneStock,
      }),
    },
    firstExposedBuildingId,
    branches: input.branches,
  };
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
  state: Pick<GameState, 'buildings' | 'deliveryTrips'>
    & Partial<Pick<GameState, 'fireIncidents'>>;
  hasRoadAccess?: (building: BuildingState) => boolean;
  roadComponentFor?: ProductionRoadComponentResolver;
}): SettlementConstructionPlan {
  const transitBySite = constructionTransitBySite(input.state.deliveryTrips.values());
  const fireDisabled = fireDisabledBuildingIds(
    input.state.fireIncidents?.values() ?? [],
  );
  const roadBranches = input.roadComponentFor
    ? new Map<string, MutableConstructionRoadBranch>()
    : null;
  const offroadClaims = emptyTransitAmounts();
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
  let roadBoundSites = 0;
  let offroadSites = 0;
  let fireDisabledSourceBuildings = 0;
  let fireBlockedTimberStock = 0;
  let fireBlockedStoneStock = 0;
  let firstFireDisabledSourceId: string | null = null;

  for (const building of input.state.buildings.values()) {
    if (building.constructionComplete !== false) {
      const timberStock = nonnegative(building.timber);
      const stoneStock = nonnegative(building.stone);
      if (
        fireDisabled.has(building.id)
        && (timberStock > EPSILON || stoneStock > EPSILON)
      ) {
        fireDisabledSourceBuildings += 1;
        fireBlockedTimberStock += timberStock;
        fireBlockedStoneStock += stoneStock;
        firstFireDisabledSourceId = firstFireDisabledSourceId === null
          || compareStableEntityIds(building.id, firstFireDisabledSourceId) < 0
          ? building.id
          : firstFireDisabledSourceId;
        continue;
      }
      if (roadBranches && input.roadComponentFor) {
        if (timberStock > EPSILON || stoneStock > EPSILON) {
          const branch = constructionRoadBranch(
            roadBranches,
            productionRoadBranchKey(
              input.roadComponentFor(building),
              'building',
              building.id,
            ),
          );
          branch.sourceTimberStock += timberStock;
          branch.sourceStoneStock += stoneStock;
        }
      }
      continue;
    }
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
    if (
      roadBranches
      && input.roadComponentFor
      && timber.awaitingPickup + stone.awaitingPickup > EPSILON
    ) {
      if (BUILDING_DEFINITIONS[building.kind].requiresRoad) {
        roadBoundSites += 1;
        const branch = constructionRoadBranch(
          roadBranches,
          productionRoadBranchKey(
            input.roadComponentFor(building),
            'building',
            building.id,
          ),
        );
        branch.claimSites += 1;
        branch.timberClaim += timber.awaitingPickup;
        branch.stoneClaim += stone.awaitingPickup;
        recordRoadClaim(
          branch,
          'timber',
          timber.awaitingPickup,
          priority,
          building.id,
        );
        recordRoadClaim(
          branch,
          'stone',
          stone.awaitingPickup,
          priority,
          building.id,
        );
      } else {
        offroadSites += 1;
        offroadClaims.timber += timber.awaitingPickup;
        offroadClaims.stone += stone.awaitingPickup;
      }
    }

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
    fireDisabledSourceBuildings,
    fireBlockedTimberStock,
    fireBlockedStoneStock,
    firstFireDisabledSourceId,
    firstAttention,
    roadPlan: buildConstructionRoadPlan({
      branches: roadBranches,
      roadBoundSites,
      offroadSites,
      offroadClaims,
    }),
  };
}
