import { BUILDING_DEFINITIONS, type BuildingKind } from '../generated/gameBalance.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import { isSeasonalLaborKind } from './seasonalLabor.ts';
import { isProductionLaborKind } from './settlementWorksiteStalls.ts';
import {
  normalizeStaffingPriority,
  STAFFING_PRIORITY_HIGH,
  STAFFING_PRIORITY_LOW,
  type StaffingPriority,
} from './staffingPriority.ts';

export type YearRoundLaborRotationAssignment = {
  buildingId: string;
  kind: BuildingKind;
  priority: StaffingPriority;
  assignedLabor: number;
  targetLabor: number;
  recalledWorkers: number;
  calledWorkers: number;
};

export type SettlementYearRoundLaborRotation = {
  worksites: number;
  fireDisabledSites: number;
  fireRecalledWorkers: number;
  understaffedSites: number;
  openPosts: number;
  recalledWorkers: number;
  calledWorkers: number;
  remainingOpenPosts: number;
  freeLaborBefore: number;
  freeLaborAfter: number;
  firstRecalledBuildingId: string | null;
  firstUnderstaffedBuildingId: string | null;
  assignments: YearRoundLaborRotationAssignment[];
};

export function isYearRoundLaborKind(kind: BuildingKind): boolean {
  return kind !== 'town_hall'
    && !isSeasonalLaborKind(kind)
    && !isProductionLaborKind(kind);
}

export function computeSettlementYearRoundLaborRotation(
  state: Pick<GameState, 'buildings'> & Partial<Pick<GameState, 'fireIncidents'>>,
  availableLabor: number,
): SettlementYearRoundLaborRotation {
  const fireDisabled = fireDisabledBuildingIds(
    state.fireIncidents?.values() ?? [],
  );
  type Candidate = YearRoundLaborRotationAssignment & { maxLabor: number };
  const priorityBuckets: Candidate[][] = [[], [], []];
  const fireAssignments: YearRoundLaborRotationAssignment[] = [];
  let worksites = 0;
  let fireDisabledSites = 0;
  let fireRecalledWorkers = 0;
  let understaffedSites = 0;
  let openPosts = 0;

  for (const building of state.buildings.values()) {
    const definition = BUILDING_DEFINITIONS[building.kind];
    if (
      building.constructionComplete === false
      || !definition.acceptsLabor
      || definition.maxLabor <= 0
      || !isYearRoundLaborKind(building.kind)
    ) {
      continue;
    }
    worksites += 1;
    const maxLabor = definition.maxLabor;
    const assignedLabor = Math.max(
      0,
      Math.min(maxLabor, Math.floor(building.assignedLabor)),
    );
    const priority = normalizeStaffingPriority(building.constructionPriority);
    if (fireDisabled.has(building.id)) {
      fireDisabledSites += 1;
      fireRecalledWorkers += assignedLabor;
      if (assignedLabor > 0) {
        fireAssignments.push({
          buildingId: building.id,
          kind: building.kind,
          priority,
          assignedLabor,
          targetLabor: 0,
          recalledWorkers: assignedLabor,
          calledWorkers: 0,
        });
      }
      continue;
    }
    if (assignedLabor < maxLabor) {
      understaffedSites += 1;
      openPosts += maxLabor - assignedLabor;
    }
    priorityBuckets[priority - STAFFING_PRIORITY_LOW].push({
      buildingId: building.id,
      kind: building.kind,
      priority,
      assignedLabor,
      targetLabor: assignedLabor,
      recalledWorkers: 0,
      calledWorkers: 0,
      maxLabor,
    });
  }

  for (const bucket of priorityBuckets) {
    bucket.sort((left, right) => compareStableEntityIds(left.buildingId, right.buildingId));
  }

  const freeLaborBefore = Math.max(0, Math.floor(availableLabor));
  let workersRemaining = freeLaborBefore + fireRecalledWorkers;
  let recalledWorkers = fireRecalledWorkers;
  let calledWorkers = 0;
  let firstRecalledBuildingId: string | null = fireAssignments
    .map((assignment) => assignment.buildingId)
    .sort(compareStableEntityIds)[0] ?? null;

  for (
    let destinationPriority = STAFFING_PRIORITY_HIGH;
    destinationPriority >= STAFFING_PRIORITY_LOW;
    destinationPriority -= 1
  ) {
    const destinationBucket = priorityBuckets[destinationPriority - STAFFING_PRIORITY_LOW];
    const vacancies = destinationBucket.reduce(
      (total, candidate) => total + candidate.maxLabor - candidate.targetLabor,
      0,
    );
    if (vacancies <= 0) continue;

    let recallNeeded = Math.max(0, vacancies - workersRemaining);
    for (
      let donorPriority = STAFFING_PRIORITY_LOW;
      donorPriority < destinationPriority && recallNeeded > 0;
      donorPriority += 1
    ) {
      const donorBucket = priorityBuckets[donorPriority - STAFFING_PRIORITY_LOW];
      for (let index = donorBucket.length - 1; index >= 0 && recallNeeded > 0; index -= 1) {
        const donor = donorBucket[index];
        const released = Math.min(donor.targetLabor, recallNeeded);
        if (released <= 0) continue;
        donor.targetLabor -= released;
        donor.recalledWorkers += released;
        recallNeeded -= released;
        workersRemaining += released;
        recalledWorkers += released;
        firstRecalledBuildingId ??= donor.buildingId;
      }
    }

    while (workersRemaining > 0) {
      let assignedThisPass = false;
      for (const candidate of destinationBucket) {
        if (workersRemaining === 0) break;
        if (candidate.targetLabor >= candidate.maxLabor) continue;
        candidate.targetLabor += 1;
        candidate.calledWorkers += 1;
        workersRemaining -= 1;
        calledWorkers += 1;
        assignedThisPass = true;
      }
      if (!assignedThisPass) break;
    }
  }

  const orderedCandidates = priorityBuckets.slice().reverse().flat();
  const firstUnderstaffedBuildingId = orderedCandidates.find(
    (candidate) => candidate.assignedLabor < candidate.maxLabor,
  )?.buildingId ?? null;
  const assignments = fireAssignments.concat(priorityBuckets
    .flat()
    .filter((candidate) => candidate.targetLabor !== candidate.assignedLabor)
    .sort((left, right) => compareStableEntityIds(left.buildingId, right.buildingId))
    .map(({ maxLabor: _maxLabor, ...assignment }) => assignment))
    .sort((left, right) => compareStableEntityIds(left.buildingId, right.buildingId));

  return {
    worksites,
    fireDisabledSites,
    fireRecalledWorkers,
    understaffedSites,
    openPosts,
    recalledWorkers,
    calledWorkers,
    remainingOpenPosts:
      openPosts - calledWorkers + recalledWorkers - fireRecalledWorkers,
    freeLaborBefore,
    freeLaborAfter: workersRemaining,
    firstRecalledBuildingId,
    firstUnderstaffedBuildingId,
    assignments,
  };
}

export function applyYearRoundLaborRotation(
  buildings: ReadonlyMap<string, BuildingState>,
  plan: SettlementYearRoundLaborRotation,
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
