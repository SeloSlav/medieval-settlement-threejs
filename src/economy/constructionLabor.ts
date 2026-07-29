import { CONSTRUCTION_MAX_BUILDERS } from '../generated/gameBalance.ts';
import {
  CONSTRUCTION_PRIORITY_HOLD,
  CONSTRUCTION_PRIORITY_LOW,
  CONSTRUCTION_PRIORITY_URGENT,
  normalizeConstructionPriority,
  type ConstructionPriority,
} from '../logistics/constructionPriority.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { BuildingState, GameState } from '../resources/types.ts';

const EPSILON = 1e-6;

export type ConstructionLaborAssignment = {
  buildingId: string;
  priority: ConstructionPriority;
  assignedLabor: number;
  targetLabor: number;
  recalledWorkers: number;
  calledWorkers: number;
};

export type SettlementConstructionLaborPlan = {
  activeSites: number;
  workReadySites: number;
  inboundWaitingSites: number;
  blockedSites: number;
  blockedStaffedSites: number;
  readyOpenPosts: number;
  remainingReadyPosts: number;
  recalledWorkers: number;
  calledWorkers: number;
  laborReserve: number;
  freeLaborBefore: number;
  freeLaborAfter: number;
  firstBlockedBuildingId: string | null;
  firstReadyUnderstaffedBuildingId: string | null;
  assignments: ConstructionLaborAssignment[];
};

function nonnegative(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

export function constructionLaborReady(
  building: Pick<
    BuildingState,
    | 'constructionRequiredTimber'
    | 'constructionRequiredStone'
    | 'constructionRequiredIronwork'
    | 'constructionDeliveredTimber'
    | 'constructionDeliveredStone'
    | 'constructionDeliveredIronwork'
    | 'constructionProgress'
    | 'constructionTreasuryTimber'
    | 'constructionTreasuryStone'
    | 'constructionTreasuryIronwork'
  >,
): boolean {
  const requiredTotal = nonnegative(building.constructionRequiredTimber)
    + nonnegative(building.constructionRequiredStone)
    + nonnegative(building.constructionRequiredIronwork);
  const deliveredTotal = nonnegative(building.constructionDeliveredTimber)
    + nonnegative(building.constructionDeliveredStone)
    + nonnegative(building.constructionDeliveredIronwork);
  const materialReadiness = requiredTotal <= EPSILON
    ? 1
    : Math.min(1, deliveredTotal / requiredTotal);
  const progress = Math.min(1, nonnegative(building.constructionProgress));
  return progress + EPSILON < materialReadiness
    || nonnegative(building.constructionTreasuryTimber)
      + nonnegative(building.constructionTreasuryStone)
      + nonnegative(building.constructionTreasuryIronwork) > EPSILON;
}

export function computeSettlementConstructionLaborPlan(
  state: Pick<GameState, 'buildings' | 'deliveryTrips'>,
  availableLabor: number,
  laborReserve = 0,
): SettlementConstructionLaborPlan {
  type Candidate = ConstructionLaborAssignment & { maxLabor: number };
  const inboundSiteIds = new Set<string>();
  for (const trip of state.deliveryTrips.values()) {
    if (trip.destinationKind === 'building' && trip.targetBuildingId !== null) {
      inboundSiteIds.add(trip.targetBuildingId);
    }
  }

  const priorityBuckets: Candidate[][] = [[], [], []];
  const assignments: ConstructionLaborAssignment[] = [];
  let activeSites = 0;
  let workReadySites = 0;
  let inboundWaitingSites = 0;
  let blockedSites = 0;
  let blockedStaffedSites = 0;
  let readyOpenPosts = 0;
  let recalledWorkers = 0;
  let firstBlockedBuildingId: string | null = null;

  for (const building of state.buildings.values()) {
    if (building.constructionComplete !== false) continue;
    const priority = normalizeConstructionPriority(building.constructionPriority);
    if (priority === CONSTRUCTION_PRIORITY_HOLD) continue;
    activeSites += 1;

    const assignedLabor = Math.max(
      0,
      Math.min(CONSTRUCTION_MAX_BUILDERS, Math.floor(building.assignedLabor)),
    );
    const workReady = constructionLaborReady(building);
    const inboundSupply = inboundSiteIds.has(building.id);
    if (!workReady) {
      if (inboundSupply) {
        inboundWaitingSites += 1;
        continue;
      }
      blockedSites += 1;
      if (assignedLabor <= 0) continue;
      blockedStaffedSites += 1;
      recalledWorkers += assignedLabor;
      assignments.push({
        buildingId: building.id,
        priority,
        assignedLabor,
        targetLabor: 0,
        recalledWorkers: assignedLabor,
        calledWorkers: 0,
      });
      if (
        firstBlockedBuildingId === null
        || compareStableEntityIds(building.id, firstBlockedBuildingId) < 0
      ) {
        firstBlockedBuildingId = building.id;
      }
      continue;
    }

    workReadySites += 1;
    if (assignedLabor >= CONSTRUCTION_MAX_BUILDERS) continue;
    readyOpenPosts += CONSTRUCTION_MAX_BUILDERS - assignedLabor;
    priorityBuckets[priority - CONSTRUCTION_PRIORITY_LOW].push({
      buildingId: building.id,
      priority,
      assignedLabor,
      targetLabor: assignedLabor,
      recalledWorkers: 0,
      calledWorkers: 0,
      maxLabor: CONSTRUCTION_MAX_BUILDERS,
    });
  }

  assignments.sort((left, right) =>
    compareStableEntityIds(left.buildingId, right.buildingId));
  for (const bucket of priorityBuckets) {
    bucket.sort((left, right) => compareStableEntityIds(left.buildingId, right.buildingId));
  }
  const orderedCandidates = priorityBuckets.slice().reverse().flat();
  const firstReadyUnderstaffedBuildingId = orderedCandidates[0]?.buildingId ?? null;
  const freeLaborBefore = Math.max(0, Math.floor(availableLabor));
  const safeLaborReserve = Math.max(0, Math.floor(laborReserve));
  let laborRemaining = Math.max(
    0,
    freeLaborBefore + recalledWorkers - safeLaborReserve,
  );

  for (
    let priority = CONSTRUCTION_PRIORITY_URGENT;
    priority >= CONSTRUCTION_PRIORITY_LOW && laborRemaining > 0;
    priority -= 1
  ) {
    const bucket = priorityBuckets[priority - CONSTRUCTION_PRIORITY_LOW];
    while (laborRemaining > 0) {
      let assignedThisPass = false;
      for (const candidate of bucket) {
        if (laborRemaining === 0) break;
        if (candidate.targetLabor >= candidate.maxLabor) continue;
        candidate.targetLabor += 1;
        candidate.calledWorkers += 1;
        laborRemaining -= 1;
        assignedThisPass = true;
      }
      if (!assignedThisPass) break;
    }
  }

  const calledAssignments = orderedCandidates
    .filter((candidate) => candidate.calledWorkers > 0)
    .map(({ maxLabor: _maxLabor, ...assignment }) => assignment);
  assignments.push(...calledAssignments);
  const calledWorkers = calledAssignments.reduce(
    (total, assignment) => total + assignment.calledWorkers,
    0,
  );

  return {
    activeSites,
    workReadySites,
    inboundWaitingSites,
    blockedSites,
    blockedStaffedSites,
    readyOpenPosts,
    remainingReadyPosts: readyOpenPosts - calledWorkers,
    recalledWorkers,
    calledWorkers,
    laborReserve: safeLaborReserve,
    freeLaborBefore,
    freeLaborAfter: freeLaborBefore + recalledWorkers - calledWorkers,
    firstBlockedBuildingId,
    firstReadyUnderstaffedBuildingId,
    assignments,
  };
}

export function applyConstructionLaborRotation(
  buildings: ReadonlyMap<string, BuildingState>,
  plan: SettlementConstructionLaborPlan,
): Map<string, BuildingState> {
  const rotated = new Map(buildings);
  for (const assignment of plan.assignments) {
    const building = rotated.get(assignment.buildingId);
    if (!building) continue;
    rotated.set(assignment.buildingId, {
      ...building,
      assignedLabor: assignment.targetLabor,
    });
  }
  return rotated;
}
