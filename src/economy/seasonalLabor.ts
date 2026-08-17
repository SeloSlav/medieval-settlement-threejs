import { isForagingHarvestAvailable } from '../foraging/foragingSeason.ts';
import {
  currentFieldWorkRemaining,
  farmsteadExportableGrain,
  fieldStageAllowed,
} from '../farming/farmWorkPlanning.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import { BUILDING_DEFINITIONS } from '../generated/gameBalance.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { BuildingKind, BuildingState, FarmFieldState, GameState } from '../resources/types.ts';
import { apiaryIsActive, vineyardIsHarvesting } from './specialtyTrade.ts';
import { edibleFoodStock } from './foodInventory.ts';
import { breadGrainStock, grainSheafStock } from './cropGoods.ts';
import {
  normalizeStaffingPriority,
  STAFFING_PRIORITY_HIGH,
  STAFFING_PRIORITY_LOW,
  type StaffingPriority,
} from './staffingPriority.ts';

export const SEASONAL_LABOR_KINDS = [
  'foragers_shed',
  'fishing_camp',
  'threshing_barn',
  'apiary',
  'watermill',
  'vineyard',
] as const satisfies readonly BuildingKind[];

export type SeasonalLaborKind = (typeof SEASONAL_LABOR_KINDS)[number];

export type SeasonalLaborSitePlan = {
  buildingId: string;
  kind: SeasonalLaborKind;
  reason: 'seasonal-dormant' | 'fire-disabled';
  assignedLabor: number;
  targetLabor: number;
  reclaimableWorkers: number;
  retainedHauler: boolean;
};

export type SettlementSeasonalLaborPlan = {
  dormantSites: number;
  fireDisabledSites: number;
  reclaimableSites: number;
  reclaimableWorkers: number;
  retainedHaulers: number;
  firstReclaimableBuildingId: string | null;
  sites: SeasonalLaborSitePlan[];
};

export type SeasonalLaborCallupAssignment = {
  buildingId: string;
  kind: SeasonalLaborKind;
  priority: StaffingPriority;
  assignedLabor: number;
  targetLabor: number;
  calledWorkers: number;
};

export type SettlementSeasonalCallupPlan = {
  activeSites: number;
  fireBlockedSites: number;
  understaffedSites: number;
  openPosts: number;
  callupWorkers: number;
  remainingOpenPosts: number;
  firstUnderstaffedBuildingId: string | null;
  assignments: SeasonalLaborCallupAssignment[];
};

type SeasonalLaborState =
  Pick<GameState, 'buildings' | 'farmFields'>
  & Partial<Pick<GameState, 'fireIncidents'>>;

type SeasonalLaborRecallState =
  SeasonalLaborState
  & Pick<GameState, 'deliveryTrips'>;

export function isSeasonalLaborKind(kind: BuildingKind): kind is SeasonalLaborKind {
  return (SEASONAL_LABOR_KINDS as readonly BuildingKind[]).includes(kind);
}

export function seasonalProductionActive(
  kind: BuildingKind,
  month: number,
  farmsteadWorkActive = false,
): boolean | null {
  switch (kind) {
    case 'foragers_shed':
      return isForagingHarvestAvailable('berries', month)
        || isForagingHarvestAvailable('mushrooms', month);
    case 'fishing_camp':
      return isForagingHarvestAvailable('fish', month);
    case 'threshing_barn':
      return farmsteadWorkActive;
    case 'apiary':
      return apiaryIsActive(month);
    case 'watermill':
      return month < 12 && month > 2;
    case 'vineyard':
      return vineyardIsHarvesting(month);
    default:
      return null;
  }
}

export function seasonalLaborTarget(
  kind: BuildingKind,
  month: number,
  assignedLabor: number,
  _hasDispatchDuty: boolean,
  farmsteadWorkActive = false,
): number | null {
  const active = seasonalProductionActive(kind, month, farmsteadWorkActive);
  if (active === null) return null;
  const assigned = Math.max(0, Math.floor(assignedLabor));
  if (active) return assigned;
  return 0;
}

function farmFieldWorkActive(fields: readonly FarmFieldState[], month: number): boolean {
  return fields.some((field) =>
    field.priority > 0
    && fieldStageAllowed(field, month)
    && currentFieldWorkRemaining(field) > 1e-9);
}

function farmsteadWorkActive(
  building: BuildingState,
  fields: readonly FarmFieldState[],
  month: number,
): boolean {
  return farmFieldWorkActive(fields, month)
    || (building.kind === 'threshing_barn' && grainSheafStock(building) > 1e-6);
}

function hasOutboundSeasonalStock(
  building: BuildingState,
  fields: readonly FarmFieldState[],
): boolean {
  switch (building.kind) {
    case 'foragers_shed':
      return edibleFoodStock(building) > 1e-6 || (building.remedies ?? 0) > 1e-6;
    case 'fishing_camp':
      return (building.fish ?? 0) > 1e-6;
    case 'apiary':
      return building.honey > 1e-6;
    case 'vineyard':
      return (building.grapes ?? 0) > 1e-6 || building.wine > 1e-6;
    case 'threshing_barn':
      return farmsteadExportableGrain(breadGrainStock(building), fields) > 1e-6
        || grainSheafStock(building) > 1e-6;
    default:
      return false;
  }
}

export function computeSettlementSeasonalLaborPlan(
  state: SeasonalLaborRecallState,
  month: number,
): SettlementSeasonalLaborPlan {
  const fireDisabled = fireDisabledBuildingIds(
    state.fireIncidents?.values() ?? [],
  );
  const fieldsByFarmstead = new Map<string, FarmFieldState[]>();
  for (const field of state.farmFields.values()) {
    const fields = fieldsByFarmstead.get(field.farmsteadId);
    if (fields) {
      fields.push(field);
    } else {
      fieldsByFarmstead.set(field.farmsteadId, [field]);
    }
  }
  const activeTripOrigins = new Set<string>();
  for (const trip of state.deliveryTrips.values()) {
    activeTripOrigins.add(trip.buildingId);
  }

  const sites: SeasonalLaborSitePlan[] = [];
  let dormantSites = 0;
  let fireDisabledSites = 0;
  let reclaimableWorkers = 0;
  let reclaimableSites = 0;
  let retainedHaulers = 0;
  let firstReclaimableBuildingId: string | null = null;

  for (const building of state.buildings.values()) {
    if (
      building.constructionComplete === false
      || building.assignedLabor <= 0
      || !isSeasonalLaborKind(building.kind)
    ) {
      continue;
    }
    if (fireDisabled.has(building.id)) {
      fireDisabledSites += 1;
      const reclaimable = Math.max(0, Math.floor(building.assignedLabor));
      sites.push({
        buildingId: building.id,
        kind: building.kind,
        reason: 'fire-disabled',
        assignedLabor: building.assignedLabor,
        targetLabor: 0,
        reclaimableWorkers: reclaimable,
        retainedHauler: false,
      });
      reclaimableWorkers += reclaimable;
      reclaimableSites += 1;
      if (
        firstReclaimableBuildingId === null
        || compareStableEntityIds(building.id, firstReclaimableBuildingId) < 0
      ) {
        firstReclaimableBuildingId = building.id;
      }
      continue;
    }
    const fields = fieldsByFarmstead.get(building.id) ?? [];
    const activeFarmWork = building.kind === 'threshing_barn'
      && farmsteadWorkActive(building, fields, month);
    if (seasonalProductionActive(building.kind, month, activeFarmWork) !== false) {
      continue;
    }
    dormantSites += 1;
    const hasDispatchDuty = activeTripOrigins.has(building.id)
      || hasOutboundSeasonalStock(building, fields);
    const targetLabor = seasonalLaborTarget(
      building.kind,
      month,
      building.assignedLabor,
      hasDispatchDuty,
      activeFarmWork,
    );
    if (targetLabor === null || targetLabor >= building.assignedLabor) continue;

    const reclaimable = building.assignedLabor - targetLabor;
    sites.push({
      buildingId: building.id,
      kind: building.kind,
      reason: 'seasonal-dormant',
      assignedLabor: building.assignedLabor,
      targetLabor,
      reclaimableWorkers: reclaimable,
      retainedHauler: false,
    });
    reclaimableWorkers += reclaimable;
    reclaimableSites += 1;
    if (
      firstReclaimableBuildingId === null
      || compareStableEntityIds(building.id, firstReclaimableBuildingId) < 0
    ) {
      firstReclaimableBuildingId = building.id;
    }
  }

  return {
    dormantSites,
    fireDisabledSites,
    reclaimableSites,
    reclaimableWorkers,
    retainedHaulers,
    firstReclaimableBuildingId,
    sites,
  };
}

export function computeSettlementSeasonalCallupPlan(
  state: SeasonalLaborState,
  month: number,
  availableLabor: number,
): SettlementSeasonalCallupPlan {
  const fireDisabled = fireDisabledBuildingIds(
    state.fireIncidents?.values() ?? [],
  );
  const fieldsByFarmstead = new Map<string, FarmFieldState[]>();
  for (const field of state.farmFields.values()) {
    const fields = fieldsByFarmstead.get(field.farmsteadId);
    if (fields) {
      fields.push(field);
    } else {
      fieldsByFarmstead.set(field.farmsteadId, [field]);
    }
  }

  type Candidate = SeasonalLaborCallupAssignment & { maxLabor: number };
  const priorityBuckets: Candidate[][] = [[], [], []];
  let activeSites = 0;
  let fireBlockedSites = 0;
  let understaffedSites = 0;
  let openPosts = 0;

  for (const building of state.buildings.values()) {
    if (building.constructionComplete === false || !isSeasonalLaborKind(building.kind)) {
      continue;
    }
    const fields = fieldsByFarmstead.get(building.id) ?? [];
    const activeFarmWork = building.kind === 'threshing_barn'
      && farmsteadWorkActive(building, fields, month);
    if (seasonalProductionActive(building.kind, month, activeFarmWork) !== true) {
      continue;
    }
    activeSites += 1;
    if (fireDisabled.has(building.id)) {
      fireBlockedSites += 1;
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
      kind: building.kind,
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
  const orderedCandidates = priorityBuckets
    .slice()
    .reverse()
    .flat();
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
    activeSites,
    fireBlockedSites,
    understaffedSites,
    openPosts,
    callupWorkers,
    remainingOpenPosts: openPosts - callupWorkers,
    firstUnderstaffedBuildingId,
    assignments,
  };
}

export function applySeasonalLaborRecall(
  buildings: ReadonlyMap<string, BuildingState>,
  plan: SettlementSeasonalLaborPlan,
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

export function applySeasonalLaborCallup(
  buildings: ReadonlyMap<string, BuildingState>,
  plan: SettlementSeasonalCallupPlan,
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
