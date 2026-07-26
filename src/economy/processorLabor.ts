import { BUILDING_DEFINITIONS } from '../generated/gameBalance.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import {
  isProcessorOutputTargetKind,
  processorOutputCommodity,
  processorOutputHeadroom,
  type ProcessorOutputTargetKind,
} from './processorOutputPolicy.ts';
import {
  normalizeStaffingPriority,
  STAFFING_PRIORITY_HIGH,
  STAFFING_PRIORITY_LOW,
  type StaffingPriority,
} from './staffingPriority.ts';
import {
  computeSettlementProductionReadiness,
  type ProductionLaborKind,
} from './settlementWorksiteStalls.ts';

export type ProcessorLaborSitePlan = {
  buildingId: string;
  kind: ProcessorOutputTargetKind;
  assignedLabor: number;
  targetLabor: number;
  reclaimableWorkers: number;
  retainedDispatcher: boolean;
};

export type SettlementProcessorLaborRecallPlan = {
  targetPausedSites: number;
  reclaimableSites: number;
  reclaimableWorkers: number;
  retainedDispatchers: number;
  firstReclaimableBuildingId: string | null;
  sites: ProcessorLaborSitePlan[];
};

export type ProcessorLaborCallupAssignment = {
  buildingId: string;
  kind: ProductionLaborKind;
  priority: StaffingPriority;
  assignedLabor: number;
  targetLabor: number;
  calledWorkers: number;
};

export type SettlementProcessorLaborCallupPlan = {
  auditedSites: number;
  readySites: number;
  blockedSites: number;
  understaffedSites: number;
  openPosts: number;
  callupWorkers: number;
  remainingOpenPosts: number;
  firstUnderstaffedBuildingId: string | null;
  assignments: ProcessorLaborCallupAssignment[];
};

export function computeSettlementProcessorLaborRecallPlan(
  state: Pick<GameState, 'buildings' | 'deliveryTrips'>,
): SettlementProcessorLaborRecallPlan {
  const activeTripOrigins = new Set<string>();
  for (const trip of state.deliveryTrips.values()) {
    activeTripOrigins.add(trip.buildingId);
  }

  const sites: ProcessorLaborSitePlan[] = [];
  let targetPausedSites = 0;
  let reclaimableSites = 0;
  let reclaimableWorkers = 0;
  let retainedDispatchers = 0;
  let firstReclaimableBuildingId: string | null = null;

  for (const building of state.buildings.values()) {
    if (
      building.constructionComplete === false
      || building.assignedLabor <= 0
      || !isProcessorOutputTargetKind(building.kind)
      || (processorOutputHeadroom(building) ?? Number.POSITIVE_INFINITY) > 1e-6
    ) {
      continue;
    }
    targetPausedSites += 1;
    const output = processorOutputCommodity(building.kind);
    const hasDispatchDuty = activeTripOrigins.has(building.id)
      || (building[output] ?? 0) > 1e-6;
    const assignedLabor = Math.max(0, Math.floor(building.assignedLabor));
    const targetLabor = Math.min(assignedLabor, hasDispatchDuty ? 1 : 0);
    if (targetLabor === 1) retainedDispatchers += 1;
    if (targetLabor >= assignedLabor) continue;

    const reclaimable = assignedLabor - targetLabor;
    sites.push({
      buildingId: building.id,
      kind: building.kind,
      assignedLabor,
      targetLabor,
      reclaimableWorkers: reclaimable,
      retainedDispatcher: targetLabor === 1,
    });
    reclaimableSites += 1;
    reclaimableWorkers += reclaimable;
    if (
      firstReclaimableBuildingId === null
      || compareStableEntityIds(building.id, firstReclaimableBuildingId) < 0
    ) {
      firstReclaimableBuildingId = building.id;
    }
  }

  return {
    targetPausedSites,
    reclaimableSites,
    reclaimableWorkers,
    retainedDispatchers,
    firstReclaimableBuildingId,
    sites,
  };
}

export function computeSettlementProcessorLaborCallupPlan(
  state: Pick<GameState, 'buildings' | 'quarries' | 'foragingNodes'>,
  availableLabor: number,
): SettlementProcessorLaborCallupPlan {
  type Candidate = ProcessorLaborCallupAssignment & { maxLabor: number };
  const priorityBuckets: Candidate[][] = [[], [], []];
  const readiness = computeSettlementProductionReadiness(state);
  let understaffedSites = 0;
  let openPosts = 0;

  for (const building of state.buildings.values()) {
    if (
      building.constructionComplete === false
      || !readiness.readyBuildingIds.has(building.id)
    ) {
      continue;
    }
    const maxLabor = BUILDING_DEFINITIONS[building.kind].maxLabor;
    const assignedLabor = Math.max(0, Math.min(maxLabor, Math.floor(building.assignedLabor)));
    if (assignedLabor >= maxLabor) continue;
    const priority = normalizeStaffingPriority(building.constructionPriority);
    understaffedSites += 1;
    openPosts += maxLabor - assignedLabor;
    priorityBuckets[priority - STAFFING_PRIORITY_LOW].push({
      buildingId: building.id,
      kind: building.kind as ProductionLaborKind,
      priority,
      assignedLabor,
      targetLabor: assignedLabor,
      calledWorkers: 0,
      maxLabor,
    });
  }

  for (const bucket of priorityBuckets) {
    bucket.sort((left, right) => compareStableEntityIds(left.buildingId, right.buildingId));
  }
  const orderedCandidates = priorityBuckets.slice().reverse().flat();
  const firstUnderstaffedBuildingId = orderedCandidates[0]?.buildingId ?? null;
  let workersRemaining = Math.max(0, Math.floor(availableLabor));

  for (
    let priority = STAFFING_PRIORITY_HIGH;
    priority >= STAFFING_PRIORITY_LOW && workersRemaining > 0;
    priority -= 1
  ) {
    const bucket = priorityBuckets[priority - STAFFING_PRIORITY_LOW];
    while (workersRemaining > 0) {
      let assignedThisPass = false;
      for (const candidate of bucket) {
        if (workersRemaining === 0) break;
        if (candidate.targetLabor >= candidate.maxLabor) continue;
        candidate.targetLabor += 1;
        candidate.calledWorkers += 1;
        workersRemaining -= 1;
        assignedThisPass = true;
      }
      if (!assignedThisPass) break;
    }
  }

  const assignments = orderedCandidates
    .filter((candidate) => candidate.calledWorkers > 0)
    .map(({ maxLabor: _maxLabor, ...assignment }) => assignment);
  const callupWorkers = assignments.reduce(
    (total, assignment) => total + assignment.calledWorkers,
    0,
  );
  return {
    auditedSites: readiness.auditedSites,
    readySites: readiness.readySites,
    blockedSites: readiness.blockedSites,
    understaffedSites,
    openPosts,
    callupWorkers,
    remainingOpenPosts: openPosts - callupWorkers,
    firstUnderstaffedBuildingId,
    assignments,
  };
}

export function applyProcessorLaborRecall(
  buildings: ReadonlyMap<string, BuildingState>,
  plan: SettlementProcessorLaborRecallPlan,
): Map<string, BuildingState> {
  const recalled = new Map(buildings);
  for (const site of plan.sites) {
    const building = recalled.get(site.buildingId);
    if (!building) continue;
    recalled.set(site.buildingId, {
      ...building,
      assignedLabor: site.targetLabor,
    });
  }
  return recalled;
}

export function applyProcessorLaborCallup(
  buildings: ReadonlyMap<string, BuildingState>,
  plan: SettlementProcessorLaborCallupPlan,
): Map<string, BuildingState> {
  const calledUp = new Map(buildings);
  for (const assignment of plan.assignments) {
    const building = calledUp.get(assignment.buildingId);
    if (!building) continue;
    calledUp.set(assignment.buildingId, {
      ...building,
      assignedLabor: assignment.targetLabor,
    });
  }
  return calledUp;
}
