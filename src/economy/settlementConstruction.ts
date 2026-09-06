import {
  BUILDING_DEFINITIONS,
  CALENDAR_SECONDS_PER_DAY,
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
export type ConstructionMaterialKind = 'timber' | 'stone' | 'ironwork' | 'roofTiles' | 'dressedStone';

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
  fireBlockedIronworkStock: number;
  fireBlockedRoofTilesStock: number;
  fireBlockedDressedStoneStock: number;
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
  ironworkClaim: number;
  roofTilesClaim: number;
  dressedStoneClaim: number;
  sourceTimberStock: number;
  sourceStoneStock: number;
  sourceIronworkStock: number;
  sourceRoofTilesStock: number;
  sourceDressedStoneStock: number;
  matchedTimber: number;
  matchedStone: number;
  matchedIronwork: number;
  matchedRoofTiles: number;
  matchedDressedStone: number;
  strandedTimber: number;
  strandedStone: number;
  strandedIronwork: number;
  strandedRoofTiles: number;
  strandedDressedStone: number;
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
const ZERO_TRANSIT_AMOUNTS: TransitAmounts = { timber: 0, stone: 0, ironwork: 0, roofTiles: 0, dressedStone: 0 };
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
  ironworkByPriority: PriorityAmounts;
  roofTilesByPriority: PriorityAmounts;
  dressedStoneByPriority: PriorityAmounts;
  firstTimberIdByPriority: PriorityBuildingIds;
  firstStoneIdByPriority: PriorityBuildingIds;
  firstIronworkIdByPriority: PriorityBuildingIds;
  firstRoofTilesIdByPriority: PriorityBuildingIds;
  firstDressedStoneIdByPriority: PriorityBuildingIds;
};

function emptyTransitAmounts(): TransitAmounts {
  return { timber: 0, stone: 0, ironwork: 0, roofTiles: 0, dressedStone: 0 };
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
      || (
        trip.cargoKind !== 'timber'
        && trip.cargoKind !== 'stone'
        && trip.cargoKind !== 'ironwork'
        && trip.cargoKind !== 'roofTiles' && trip.cargoKind !== 'dressedStone'
      )
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
    : material === 'stone'
      ? nonnegative(building.constructionRequiredStone)
      : material === 'ironwork'
        ? nonnegative(building.constructionRequiredIronwork)
        : material === 'dressedStone' ? nonnegative(building.constructionRequiredDressedStone) : nonnegative(building.constructionRequiredRoofTiles);
  const delivered = material === 'timber'
    ? nonnegative(building.constructionDeliveredTimber)
    : material === 'stone'
      ? nonnegative(building.constructionDeliveredStone)
      : material === 'ironwork'
        ? nonnegative(building.constructionDeliveredIronwork)
        : material === 'dressedStone' ? nonnegative(building.constructionDeliveredDressedStone) : nonnegative(building.constructionDeliveredRoofTiles);
  const reserved = material === 'timber'
    ? nonnegative(building.constructionReservedTimber)
    : material === 'stone'
      ? nonnegative(building.constructionReservedStone)
      : material === 'ironwork'
        ? nonnegative(building.constructionReservedIronwork)
        : material === 'dressedStone' ? nonnegative(building.constructionReservedDressedStone) : nonnegative(building.constructionReservedRoofTiles);
  const foundersReserve = Math.min(
    reserved,
    material === 'timber'
      ? nonnegative(building.constructionTreasuryTimber)
      : material === 'stone'
        ? nonnegative(building.constructionTreasuryStone)
        : material === 'ironwork'
          ? nonnegative(building.constructionTreasuryIronwork)
          : material === 'dressedStone' ? nonnegative(building.constructionTreasuryDressedStone) : nonnegative(building.constructionTreasuryRoofTiles),
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
    ironworkClaim: 0,
    roofTilesClaim: 0,
    dressedStoneClaim: 0,
    sourceTimberStock: 0,
    sourceStoneStock: 0,
    sourceIronworkStock: 0,
    sourceRoofTilesStock: 0,
    sourceDressedStoneStock: 0,
    matchedTimber: 0,
    matchedStone: 0,
    matchedIronwork: 0,
    matchedRoofTiles: 0,
    matchedDressedStone: 0,
    strandedTimber: 0,
    strandedStone: 0,
    strandedIronwork: 0,
    strandedRoofTiles: 0,
    strandedDressedStone: 0,
    timberByPriority: emptyPriorityAmounts(),
    stoneByPriority: emptyPriorityAmounts(),
    ironworkByPriority: emptyPriorityAmounts(),
    roofTilesByPriority: emptyPriorityAmounts(),
    dressedStoneByPriority: emptyPriorityAmounts(),
    firstTimberIdByPriority: emptyPriorityBuildingIds(),
    firstStoneIdByPriority: emptyPriorityBuildingIds(),
    firstIronworkIdByPriority: emptyPriorityBuildingIds(),
    firstRoofTilesIdByPriority: emptyPriorityBuildingIds(),
    firstDressedStoneIdByPriority: emptyPriorityBuildingIds(),
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
    : material === 'stone'
      ? branch.stoneByPriority
      : material === 'ironwork'
        ? branch.ironworkByPriority
        : material === 'dressedStone' ? branch.dressedStoneByPriority : branch.roofTilesByPriority;
  const ids = material === 'timber'
    ? branch.firstTimberIdByPriority
    : material === 'stone'
      ? branch.firstStoneIdByPriority
      : material === 'ironwork'
        ? branch.firstIronworkIdByPriority
        : material === 'dressedStone' ? branch.firstDressedStoneIdByPriority : branch.firstRoofTilesIdByPriority;
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
    : material === 'stone'
      ? branch.stoneByPriority
      : material === 'ironwork'
        ? branch.ironworkByPriority
        : material === 'dressedStone' ? branch.dressedStoneByPriority : branch.roofTilesByPriority;
  const ids = material === 'timber'
    ? branch.firstTimberIdByPriority
    : material === 'stone'
      ? branch.firstStoneIdByPriority
      : material === 'ironwork'
        ? branch.firstIronworkIdByPriority
        : material === 'dressedStone' ? branch.firstDressedStoneIdByPriority : branch.firstRoofTilesIdByPriority;
  let sourceStock = material === 'timber'
    ? branch.sourceTimberStock
    : material === 'stone'
      ? branch.sourceStoneStock
      : material === 'ironwork'
        ? branch.sourceIronworkStock
        : material === 'dressedStone' ? branch.sourceDressedStoneStock : branch.sourceRoofTilesStock;
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
  let roadBoundIronworkClaim = 0;
  let roadBoundRoofTilesClaim = 0;
  let roadBoundDressedStoneClaim = 0;
  let matchedTimber = 0;
  let matchedStone = 0;
  let matchedIronwork = 0;
  let matchedRoofTiles = 0;
  let matchedDressedStone = 0;
  let sourceTimberStock = 0;
  let sourceStoneStock = 0;
  let sourceIronworkStock = 0;
  let sourceRoofTilesStock = 0;
  let sourceDressedStoneStock = 0;
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
    branch.matchedIronwork = Math.min(
      branch.ironworkClaim,
      branch.sourceIronworkStock,
    );
    branch.matchedRoofTiles = Math.min(
      branch.roofTilesClaim,
      branch.sourceRoofTilesStock,
    );
    branch.matchedDressedStone = Math.min(
      branch.dressedStoneClaim,
      branch.sourceDressedStoneStock,
    );
    branch.strandedTimber = Math.max(
      0,
      branch.timberClaim - branch.matchedTimber,
    );
    branch.strandedStone = Math.max(
      0,
      branch.stoneClaim - branch.matchedStone,
    );
    branch.strandedIronwork = Math.max(
      0,
      branch.ironworkClaim - branch.matchedIronwork,
    );
    branch.strandedRoofTiles = Math.max(
      0,
      branch.roofTilesClaim - branch.matchedRoofTiles,
    );
    branch.strandedDressedStone = Math.max(
      0,
      branch.dressedStoneClaim - branch.matchedDressedStone,
    );
    roadBoundTimberClaim += branch.timberClaim;
    roadBoundStoneClaim += branch.stoneClaim;
    roadBoundIronworkClaim += branch.ironworkClaim;
    roadBoundRoofTilesClaim += branch.roofTilesClaim;
    roadBoundDressedStoneClaim += branch.dressedStoneClaim;
    matchedTimber += branch.matchedTimber;
    matchedStone += branch.matchedStone;
    matchedIronwork += branch.matchedIronwork;
    matchedRoofTiles += branch.matchedRoofTiles;
    matchedDressedStone += branch.matchedDressedStone;
    sourceTimberStock += branch.sourceTimberStock;
    sourceStoneStock += branch.sourceStoneStock;
    sourceIronworkStock += branch.sourceIronworkStock;
    sourceRoofTilesStock += branch.sourceRoofTilesStock;
    sourceDressedStoneStock += branch.sourceDressedStoneStock;

    const claim = branch.timberClaim + branch.stoneClaim + branch.ironworkClaim + branch.roofTilesClaim + branch.dressedStoneClaim;
    if (claim <= EPSILON) continue;
    claimBranches += 1;
    const exposure = branch.strandedTimber
      + branch.strandedStone
      + branch.strandedIronwork
      + branch.strandedRoofTiles + branch.strandedDressedStone;
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
    const ironworkCandidate = branch.strandedIronwork > 0.05
      ? firstUndercoveredRoadClaim(branch, 'ironwork')
      : null;
    const roofTilesCandidate = branch.strandedRoofTiles > 0.05
      ? firstUndercoveredRoadClaim(branch, 'roofTiles')
      : null;
    const dressedStoneCandidate = branch.strandedDressedStone > 0.05
      ? firstUndercoveredRoadClaim(branch, 'dressedStone')
      : null;
    let candidate = timberCandidate;
    if (dressedStoneCandidate) candidate = dressedStoneCandidate;
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
    if (
      ironworkCandidate !== null
      && (
        candidate === null
        || ironworkCandidate.priority > candidate.priority
        || (
          ironworkCandidate.priority === candidate.priority
          && compareStableEntityIds(
            ironworkCandidate.buildingId,
            candidate.buildingId,
          ) < 0
        )
      )
    ) {
      candidate = ironworkCandidate;
    }
    if (
      roofTilesCandidate !== null
      && (
        candidate === null
        || roofTilesCandidate.priority > candidate.priority
        || (
          roofTilesCandidate.priority === candidate.priority
          && compareStableEntityIds(
            roofTilesCandidate.buildingId,
            candidate.buildingId,
          ) < 0
        )
      )
    ) {
      candidate = roofTilesCandidate;
    }
    if (candidate === null) continue;
    const coverageRatio = claim > EPSILON
      ? (branch.matchedTimber + branch.matchedStone + branch.matchedIronwork + branch.matchedRoofTiles + branch.matchedDressedStone) / claim
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
      ironwork: roadMaterialPlan({
        roadBoundClaim: roadBoundIronworkClaim,
        matchedRoadBoundClaim: matchedIronwork,
        offroadClaim: input.offroadClaims.ironwork,
        sourceStock: sourceIronworkStock,
      }),
      roofTiles: roadMaterialPlan({
        roadBoundClaim: roadBoundRoofTilesClaim,
        matchedRoadBoundClaim: matchedRoofTiles,
        offroadClaim: input.offroadClaims.roofTiles,
        sourceStock: sourceRoofTilesStock,
      }),
      dressedStone: roadMaterialPlan({
        roadBoundClaim: roadBoundDressedStoneClaim,
        matchedRoadBoundClaim: matchedDressedStone,
        offroadClaim: input.offroadClaims.dressedStone,
        sourceStock: sourceDressedStoneStock,
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
  ironwork: ConstructionMaterialQueue;
  roofTiles: ConstructionMaterialQueue;
  dressedStone: ConstructionMaterialQueue;
  hasRoadAccess: () => boolean;
  hasOffroadFoundingSupply: boolean;
}): ConstructionQueueSiteStatus {
  const {
    building,
    priority,
    timber,
    stone,
    ironwork,
    roofTiles,
    dressedStone,
    hasRoadAccess,
  } = input;
  if (priority === CONSTRUCTION_PRIORITY_HOLD) return 'held';
  if (nonnegative(building.assignedLabor) <= EPSILON) return 'waiting-builders';

  const requiredTotal = timber.required + stone.required + ironwork.required + roofTiles.required + dressedStone.required;
  const deliveredTotal = timber.delivered + stone.delivered + ironwork.delivered + roofTiles.delivered + dressedStone.delivered;
  const materialReadiness = requiredTotal <= EPSILON
    ? 1
    : Math.min(1, deliveredTotal / requiredTotal);
  const progress = Math.min(1, nonnegative(building.constructionProgress));
  if (progress + EPSILON < materialReadiness) return 'building';

  if (
    timber.foundersReserve
      + stone.foundersReserve
      + ironwork.foundersReserve
      + roofTiles.foundersReserve + dressedStone.foundersReserve > EPSILON
  ) {
    return 'founders-reserve';
  }
  if (
    timber.inTransit + stone.inTransit + ironwork.inTransit + roofTiles.inTransit + dressedStone.inTransit > EPSILON
  ) return 'in-transit';
  if (
    BUILDING_DEFINITIONS[building.kind].requiresRoad
    && !hasRoadAccess()
    && !input.hasOffroadFoundingSupply
    && timber.awaitingPickup + stone.awaitingPickup + ironwork.awaitingPickup + roofTiles.awaitingPickup + dressedStone.awaitingPickup > EPSILON
  ) {
    return 'off-road';
  }
  if (
    timber.awaitingPickup + stone.awaitingPickup + ironwork.awaitingPickup + roofTiles.awaitingPickup + dressedStone.awaitingPickup > EPSILON
  ) {
    return 'waiting-hauler';
  }
  if (timber.remaining + stone.remaining + ironwork.remaining + roofTiles.remaining + dressedStone.remaining > EPSILON) {
    return 'waiting-materials';
  }
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
    ironwork: emptyMaterialQueue(),
    roofTiles: emptyMaterialQueue(),
    dressedStone: emptyMaterialQueue(),
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
  let fireBlockedIronworkStock = 0;
  let fireBlockedRoofTilesStock = 0;
  let fireBlockedDressedStoneStock = 0;
  let firstFireDisabledSourceId: string | null = null;
  const foundingStockyard = [...input.state.buildings.values()].find(
    (building) =>
      building.kind === 'founders_camp'
      && building.constructionComplete !== false
      && !fireDisabled.has(building.id),
  );

  for (const building of input.state.buildings.values()) {
    if (building.constructionComplete !== false) {
      const timberStock = nonnegative(building.timber);
      const stoneStock = nonnegative(building.stone);
      const ironworkStock = nonnegative(building.ironwork);
      const roofTilesStock = nonnegative(building.roofTiles);
      const dressedStoneStock = nonnegative(building.dressedStone);
      if (
        fireDisabled.has(building.id)
        && (
          timberStock > EPSILON
          || stoneStock > EPSILON
          || ironworkStock > EPSILON
          || roofTilesStock > EPSILON || dressedStoneStock > EPSILON
        )
      ) {
        fireDisabledSourceBuildings += 1;
        fireBlockedTimberStock += timberStock;
        fireBlockedStoneStock += stoneStock;
        fireBlockedIronworkStock += ironworkStock;
        fireBlockedRoofTilesStock += roofTilesStock;
        fireBlockedDressedStoneStock += dressedStoneStock;
        firstFireDisabledSourceId = firstFireDisabledSourceId === null
          || compareStableEntityIds(building.id, firstFireDisabledSourceId) < 0
          ? building.id
          : firstFireDisabledSourceId;
        continue;
      }
      if (roadBranches && input.roadComponentFor) {
        if (
          timberStock > EPSILON
          || stoneStock > EPSILON
          || ironworkStock > EPSILON
          || roofTilesStock > EPSILON || dressedStoneStock > EPSILON
        ) {
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
          branch.sourceIronworkStock += ironworkStock;
          branch.sourceRoofTilesStock += roofTilesStock;
          branch.sourceDressedStoneStock += dressedStoneStock;
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
    const ironwork = materialValues(building, 'ironwork', transit.ironwork);
    const roofTiles = materialValues(building, 'roofTiles', transit.roofTiles);
    const dressedStone = materialValues(building, 'dressedStone', transit.dressedStone);
    addMaterialQueue(materials.timber, timber);
    addMaterialQueue(materials.stone, stone);
    addMaterialQueue(materials.ironwork, ironwork);
    addMaterialQueue(materials.roofTiles, roofTiles);
    addMaterialQueue(materials.dressedStone, dressedStone);
    if (
      roadBranches
      && input.roadComponentFor
      && timber.awaitingPickup + stone.awaitingPickup + ironwork.awaitingPickup + roofTiles.awaitingPickup + dressedStone.awaitingPickup > EPSILON
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
        branch.ironworkClaim += ironwork.awaitingPickup;
        branch.roofTilesClaim += roofTiles.awaitingPickup;
        branch.dressedStoneClaim += dressedStone.awaitingPickup;
        recordRoadClaim(
          branch,
          'timber',
          timber.awaitingPickup,
          priority,
          building.id,
        );

        recordRoadClaim(
          branch,
          'roofTiles',
          roofTiles.awaitingPickup,
          priority,
          building.id,
        );
        recordRoadClaim(
          branch,
          'dressedStone',
          dressedStone.awaitingPickup,
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

        recordRoadClaim(
          branch,
          'ironwork',
          ironwork.awaitingPickup,
          priority,
          building.id,
        );

      } else {
        offroadSites += 1;
        offroadClaims.timber += timber.awaitingPickup;
        offroadClaims.stone += stone.awaitingPickup;
        offroadClaims.ironwork += ironwork.awaitingPickup;
        offroadClaims.roofTiles += roofTiles.awaitingPickup;
        offroadClaims.dressedStone += dressedStone.awaitingPickup;
      }
    }

    if (priority !== CONSTRUCTION_PRIORITY_HOLD) {
      const requiredTotal = timber.required + stone.required + ironwork.required + roofTiles.required + dressedStone.required;
      remainingBuilderDays += Math.max(
        0,
        requiredTotal * (1 - Math.min(1, nonnegative(building.constructionProgress))),
      ) / Math.max(
        EPSILON,
        CONSTRUCTION_WORK_PER_WORKER_PER_SEC * CALENDAR_SECONDS_PER_DAY,
      );
    }

    const status = statusForSite({
      building,
      priority,
      timber,
      stone,
      ironwork,
      roofTiles,
      dressedStone,
      hasRoadAccess: () => input.hasRoadAccess?.(building) ?? true,
      hasOffroadFoundingSupply: Boolean(
        foundingStockyard
        && (
          (timber.awaitingPickup > EPSILON && foundingStockyard.timber > EPSILON)
          || (stone.awaitingPickup > EPSILON && foundingStockyard.stone > EPSILON)
          || (
            ironwork.awaitingPickup > EPSILON
            && (foundingStockyard.ironwork ?? 0) > EPSILON
          )
          || (
            roofTiles.awaitingPickup > EPSILON
            && (foundingStockyard.roofTiles ?? 0) > EPSILON
          )
        ),
      ),
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
    fireBlockedIronworkStock,
    fireBlockedRoofTilesStock,
    fireBlockedDressedStoneStock,
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
