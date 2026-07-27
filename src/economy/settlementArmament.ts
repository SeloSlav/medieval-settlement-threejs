import {
  CARPENTER_IRONWORK_PER_POLEARM,
  CARPENTER_TIMBER_PER_POLEARM,
} from '../generated/gameBalance.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import {
  carpenterArmoryPlan,
} from './carpenterArmoryPolicy.ts';
import {
  GUARDHOUSE_PAY_PRIORITY_HIGH,
  GUARDHOUSE_PAY_PRIORITY_LOW,
  normalizeGuardhousePayPriority,
} from '../security/guardhousePayrollPolicy.ts';
import {
  productionRoadBranchKey,
  type ProductionRoadComponentResolver,
} from './settlementProduction.ts';

export type SettlementArmamentRoadBranch = {
  guardhouses: number;
  assignedGuards: number;
  armedGuards: number;
  guardhousePolearms: number;
  polearmsApproachingCompanies: number;
  approachingPolearmCoverage: number;
  staffedCarpenters: number;
  carpenterPolearms: number;
  selectedArmoryOutput: number;
  readyArmoryOutput: number;
  timberNeededForTargets: number;
  ironworkNeededForTargets: number;
  roadSourceTimber: number;
  roadSourceIronwork: number;
  armableFromFinishedStock: number;
  armableAfterReadyCrafts: number;
  unarmedAfterFinishedStock: number;
  unarmedAfterReadyCrafts: number;
  serviceableFinishedPolearms: number;
  serviceableIronwork: number;
  firstUnderarmedGuardhouseId: string | null;
  firstCarpenterId: string | null;
};

export type SettlementArmamentRoadPlan = {
  activeBranches: number;
  guardBranches: number;
  staffedArmoryGuardBranches: number;
  finishedStockCoveredBranches: number;
  readyCraftCoveredBranches: number;
  exposedGuardBranches: number;
  unservedGuardBranches: number;
  assignedGuards: number;
  armedGuards: number;
  armableFromFinishedStock: number;
  armableAfterReadyCrafts: number;
  fragmentationGuards: number;
  serviceableFinishedPolearms: number;
  serviceableIronwork: number;
  firstExposedGuardhouseId: string | null;
  branches: ReadonlyMap<string, SettlementArmamentRoadBranch>;
};

export type SettlementArmamentPlan = {
  guardhouses: number;
  assignedGuards: number;
  armedGuards: number;
  unarmedGuards: number;
  highPriorityCompanies: number;
  normalPriorityCompanies: number;
  lowPriorityCompanies: number;
  staffedCarpenters: number;
  polearmStock: number;
  polearmsInTransit: number;
  ironworkStock: number;
  ironworkInTransit: number;
  serviceableFinishedPolearms: number;
  unavailableFinishedPolearms: number;
  serviceableIronwork: number;
  unavailableIronwork: number;
  armableFromFinishedStock: number;
  armableAfterReadyCrafts: number;
  unarmedAfterFinishedStock: number;
  unarmedAfterReadyCrafts: number;
  selectedArmoryOutput: number;
  readyArmoryOutput: number;
  timberNeededForTargets: number;
  ironworkNeededForTargets: number;
  roadSourceTimber: number;
  roadSourceIronwork: number;
  firstExposedGuardhouseId: string | null;
  roadPlan: SettlementArmamentRoadPlan | null;
};

type MutableArmamentBranch = SettlementArmamentRoadBranch;

type GuardhouseRecord = {
  building: BuildingState;
  branch: MutableArmamentBranch;
  remainingGap: number;
};

type CarpenterRecord = {
  building: BuildingState;
  branch: MutableArmamentBranch;
  inboundTimber: number;
  inboundIronwork: number;
};

type UnderarmedCompanyRank = {
  priority: number;
  coverage: number;
  buildingId: string;
};

function positive(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function assignedGuards(building: BuildingState): number {
  return Math.max(0, Math.floor(building.assignedLabor));
}

function onsiteArmedGuards(building: BuildingState): number {
  return Math.min(
    assignedGuards(building),
    Math.floor(positive(building.polearms)),
  );
}

function earlierStableId(current: string | null, candidate: string): string {
  return current === null || compareStableEntityIds(candidate, current) < 0
    ? candidate
    : current;
}

function shouldReplaceUnderarmedCompany(
  current: UnderarmedCompanyRank | undefined,
  candidate: UnderarmedCompanyRank,
): boolean {
  if (!current) return true;
  if (candidate.priority !== current.priority) {
    return candidate.priority > current.priority;
  }
  if (Math.abs(candidate.coverage - current.coverage) > 1e-9) {
    return candidate.coverage < current.coverage;
  }
  return compareStableEntityIds(candidate.buildingId, current.buildingId) < 0;
}

function emptyArmamentBranch(): MutableArmamentBranch {
  return {
    guardhouses: 0,
    assignedGuards: 0,
    armedGuards: 0,
    guardhousePolearms: 0,
    polearmsApproachingCompanies: 0,
    approachingPolearmCoverage: 0,
    staffedCarpenters: 0,
    carpenterPolearms: 0,
    selectedArmoryOutput: 0,
    readyArmoryOutput: 0,
    timberNeededForTargets: 0,
    ironworkNeededForTargets: 0,
    roadSourceTimber: 0,
    roadSourceIronwork: 0,
    armableFromFinishedStock: 0,
    armableAfterReadyCrafts: 0,
    unarmedAfterFinishedStock: 0,
    unarmedAfterReadyCrafts: 0,
    serviceableFinishedPolearms: 0,
    serviceableIronwork: 0,
    firstUnderarmedGuardhouseId: null,
    firstCarpenterId: null,
  };
}

function armamentBranch(
  branches: Map<string, MutableArmamentBranch>,
  key: string,
): MutableArmamentBranch {
  let branch = branches.get(key);
  if (branch) return branch;
  branch = emptyArmamentBranch();
  branches.set(key, branch);
  return branch;
}

function branchKey(
  building: BuildingState,
  roadComponentFor: ProductionRoadComponentResolver | undefined,
): string {
  return roadComponentFor
    ? productionRoadBranchKey(
        roadComponentFor(building),
        'building',
        building.id,
      )
    : 'aggregate';
}

function buildRoadPlan(
  source: Map<string, MutableArmamentBranch>,
  totalStaffedCarpenterPolearms: number,
  totalReadyArmoryOutput: number,
): SettlementArmamentRoadPlan {
  const branches = new Map<string, SettlementArmamentRoadBranch>();
  let guardBranches = 0;
  let staffedArmoryGuardBranches = 0;
  let finishedStockCoveredBranches = 0;
  let readyCraftCoveredBranches = 0;
  let exposedGuardBranches = 0;
  let unservedGuardBranches = 0;
  let assignedGuards = 0;
  let armedGuards = 0;
  let armableFromFinishedStock = 0;
  let armableAfterReadyCrafts = 0;
  let serviceableFinishedPolearms = 0;
  let serviceableIronwork = 0;
  let firstExposedGuardhouseId: string | null = null;
  let firstExposureRatio = Number.POSITIVE_INFINITY;
  let firstExposureGap = 0;

  for (const [key, branch] of source) {
    const relevant = branch.guardhouses > 0
      || branch.staffedCarpenters > 0
      || branch.roadSourceIronwork > 1e-9;
    if (!relevant) continue;
    branches.set(key, branch);
    serviceableFinishedPolearms += branch.serviceableFinishedPolearms;
    serviceableIronwork += branch.serviceableIronwork;

    if (branch.assignedGuards <= 0) continue;
    guardBranches += 1;
    assignedGuards += branch.assignedGuards;
    armedGuards += branch.armedGuards;
    armableFromFinishedStock += branch.armableFromFinishedStock;
    armableAfterReadyCrafts += branch.armableAfterReadyCrafts;
    if (branch.staffedCarpenters > 0) {
      staffedArmoryGuardBranches += 1;
    } else {
      unservedGuardBranches += 1;
    }
    if (branch.unarmedAfterFinishedStock <= 1e-9) {
      finishedStockCoveredBranches += 1;
    }
    if (branch.unarmedAfterReadyCrafts <= 1e-9) {
      readyCraftCoveredBranches += 1;
      continue;
    }

    exposedGuardBranches += 1;
    const exposureRatio = branch.armableAfterReadyCrafts
      / branch.assignedGuards;
    const candidateId = branch.firstUnderarmedGuardhouseId;
    if (
      candidateId !== null
      && (
        exposureRatio < firstExposureRatio - 1e-9
        || (
          Math.abs(exposureRatio - firstExposureRatio) <= 1e-9
          && (
            branch.unarmedAfterReadyCrafts > firstExposureGap + 1e-9
            || (
              Math.abs(
                branch.unarmedAfterReadyCrafts - firstExposureGap,
              ) <= 1e-9
              && (
                firstExposedGuardhouseId === null
                || compareStableEntityIds(
                  candidateId,
                  firstExposedGuardhouseId,
                ) < 0
              )
            )
          )
        )
      )
    ) {
      firstExposureRatio = exposureRatio;
      firstExposureGap = branch.unarmedAfterReadyCrafts;
      firstExposedGuardhouseId = candidateId;
    }
  }

  const hypotheticalArmableAfterReadyCrafts = Math.min(
    assignedGuards,
    armedGuards
      + [...source.values()].reduce(
          (sum, branch) => sum + branch.approachingPolearmCoverage,
          0,
        )
      + totalStaffedCarpenterPolearms
      + totalReadyArmoryOutput,
  );

  return {
    activeBranches: branches.size,
    guardBranches,
    staffedArmoryGuardBranches,
    finishedStockCoveredBranches,
    readyCraftCoveredBranches,
    exposedGuardBranches,
    unservedGuardBranches,
    assignedGuards,
    armedGuards,
    armableFromFinishedStock,
    armableAfterReadyCrafts,
    fragmentationGuards: Math.max(
      0,
      hypotheticalArmableAfterReadyCrafts - armableAfterReadyCrafts,
    ),
    serviceableFinishedPolearms,
    serviceableIronwork,
    firstExposedGuardhouseId,
    branches,
  };
}

/**
 * Read-only frontier armament forecast. It mirrors the physical chain already
 * simulated by the server: guardhouse stocks stay at their company, finished
 * arms move only from staffed carpenters, and raw inputs become immediately
 * craftable only when they are already at or approaching that carpenter.
 *
 * Road-component matching is linear and performs no shortest-path searches.
 */
export function computeSettlementArmamentPlan(input: {
  state: Pick<GameState, 'stockpile' | 'buildings' | 'deliveryTrips'>;
  roadComponentFor?: ProductionRoadComponentResolver;
}): SettlementArmamentPlan {
  const branches = new Map<string, MutableArmamentBranch>();
  const guardhouses = new Map<string, GuardhouseRecord>();
  const carpenters = new Map<string, CarpenterRecord>();
  const underarmedRanks = new Map<MutableArmamentBranch, UnderarmedCompanyRank>();
  let guardhouseCount = 0;
  let assignedGuardCount = 0;
  let armedGuardCount = 0;
  let highPriorityCompanies = 0;
  let normalPriorityCompanies = 0;
  let lowPriorityCompanies = 0;
  let staffedCarpenters = 0;
  let totalStaffedCarpenterPolearms = 0;
  let polearmStock = positive(input.state.stockpile.polearms);
  let ironworkStock = positive(input.state.stockpile.ironwork);

  for (const building of input.state.buildings.values()) {
    polearmStock += positive(building.polearms);
    ironworkStock += positive(building.ironwork);
    if (building.constructionComplete === false) continue;

    const branch = armamentBranch(
      branches,
      branchKey(building, input.roadComponentFor),
    );
    if (building.kind === 'guardhouse') {
      const assigned = assignedGuards(building);
      const armed = onsiteArmedGuards(building);
      guardhouseCount += 1;
      assignedGuardCount += assigned;
      armedGuardCount += armed;
      if (assigned > 0) {
        const priority = normalizeGuardhousePayPriority(
          building.guardhousePayPriority,
        );
        if (priority === GUARDHOUSE_PAY_PRIORITY_HIGH) {
          highPriorityCompanies += 1;
        } else if (priority === GUARDHOUSE_PAY_PRIORITY_LOW) {
          lowPriorityCompanies += 1;
        } else {
          normalPriorityCompanies += 1;
        }
      }
      branch.guardhouses += 1;
      branch.assignedGuards += assigned;
      branch.armedGuards += armed;
      branch.guardhousePolearms += positive(building.polearms);
      if (assigned > armed) {
        const rank = {
          priority: normalizeGuardhousePayPriority(
            building.guardhousePayPriority,
          ),
          coverage: assigned > 0 ? armed / assigned : 1,
          buildingId: building.id,
        };
        if (shouldReplaceUnderarmedCompany(underarmedRanks.get(branch), rank)) {
          underarmedRanks.set(branch, rank);
          branch.firstUnderarmedGuardhouseId = building.id;
        }
      }
      guardhouses.set(building.id, {
        building,
        branch,
        remainingGap: Math.max(0, assigned - armed),
      });
      continue;
    }

    if (building.kind === 'carpenter') {
      const record: CarpenterRecord = {
        building,
        branch,
        inboundTimber: 0,
        inboundIronwork: 0,
      };
      carpenters.set(building.id, record);
      if (building.assignedLabor > 0) {
        staffedCarpenters += 1;
        totalStaffedCarpenterPolearms += positive(building.polearms);
        branch.staffedCarpenters += 1;
        branch.carpenterPolearms += positive(building.polearms);
        branch.firstCarpenterId = earlierStableId(
          branch.firstCarpenterId,
          building.id,
        );
      }
      continue;
    }

    if (
      building.kind === 'marketplace'
      && building.assignedLabor > 0
    ) {
      branch.roadSourceIronwork += positive(building.ironwork);
    }
    if (
      building.kind === 'lumber_mill'
      || building.kind === 'village_storehouse'
    ) {
      branch.roadSourceTimber += positive(building.timber);
    }
  }

  let polearmsInTransit = 0;
  let ironworkInTransit = 0;
  for (const trip of input.state.deliveryTrips.values()) {
    if (trip.phase === 'inbound') continue;
    const amount = positive(trip.amount);
    if (trip.cargoKind === 'polearms') {
      polearmsInTransit += amount;
      polearmStock += amount;
      if (
        trip.destinationKind !== 'building'
        || trip.targetBuildingId === null
      ) {
        continue;
      }
      const guardhouse = guardhouses.get(trip.targetBuildingId);
      if (!guardhouse) continue;
      guardhouse.branch.polearmsApproachingCompanies += amount;
      const coverage = Math.min(amount, guardhouse.remainingGap);
      guardhouse.remainingGap -= coverage;
      guardhouse.branch.approachingPolearmCoverage += coverage;
      continue;
    }
    if (trip.cargoKind === 'ironwork') {
      ironworkInTransit += amount;
      ironworkStock += amount;
    }
    if (
      trip.destinationKind !== 'building'
      || trip.targetBuildingId === null
    ) {
      continue;
    }
    const carpenter = carpenters.get(trip.targetBuildingId);
    if (!carpenter) continue;
    if (trip.cargoKind === 'timber') {
      carpenter.inboundTimber += amount;
    } else if (trip.cargoKind === 'ironwork') {
      carpenter.inboundIronwork += amount;
    }
  }

  let selectedArmoryOutput = 0;
  let readyArmoryOutput = 0;
  let timberNeededForTargets = 0;
  let ironworkNeededForTargets = 0;
  for (const carpenter of carpenters.values()) {
    if (carpenter.building.assignedLabor <= 0) continue;
    const timber = positive(carpenter.building.timber)
      + carpenter.inboundTimber;
    const ironwork = positive(carpenter.building.ironwork)
      + carpenter.inboundIronwork;
    const plan = carpenterArmoryPlan({
      polearms: positive(carpenter.building.polearms),
      carpenterPolearmReserve:
        carpenter.building.carpenterPolearmReserve,
      timber,
      ironwork,
    });
    const readyOutput = Math.min(
      plan.shortfall,
      Math.floor(timber / CARPENTER_TIMBER_PER_POLEARM),
      Math.floor(ironwork / CARPENTER_IRONWORK_PER_POLEARM),
    );
    selectedArmoryOutput += plan.shortfall;
    readyArmoryOutput += readyOutput;
    timberNeededForTargets += plan.timberToTarget;
    ironworkNeededForTargets += plan.ironworkToTarget;
    carpenter.branch.selectedArmoryOutput += plan.shortfall;
    carpenter.branch.readyArmoryOutput += readyOutput;
    carpenter.branch.timberNeededForTargets += plan.timberToTarget;
    carpenter.branch.ironworkNeededForTargets += plan.ironworkToTarget;
    carpenter.branch.serviceableIronwork += ironwork;
  }

  let aggregateArmableFromFinishedStock = 0;
  let aggregateArmableAfterReadyCrafts = 0;
  let serviceableFinishedPolearms = 0;
  let serviceableIronwork = 0;
  let roadSourceTimber = 0;
  let roadSourceIronwork = 0;
  for (const branch of branches.values()) {
    const afterOnsiteAndCarts = Math.max(
      0,
      branch.assignedGuards
        - branch.armedGuards
        - branch.approachingPolearmCoverage,
    );
    const carpenterCoverage = Math.min(
      afterOnsiteAndCarts,
      branch.carpenterPolearms,
    );
    branch.armableFromFinishedStock = Math.min(
      branch.assignedGuards,
      branch.armedGuards
        + branch.approachingPolearmCoverage
        + carpenterCoverage,
    );
    branch.unarmedAfterFinishedStock = Math.max(
      0,
      branch.assignedGuards - branch.armableFromFinishedStock,
    );
    branch.armableAfterReadyCrafts = Math.min(
      branch.assignedGuards,
      branch.armableFromFinishedStock + branch.readyArmoryOutput,
    );
    branch.unarmedAfterReadyCrafts = Math.max(
      0,
      branch.assignedGuards - branch.armableAfterReadyCrafts,
    );
    branch.serviceableFinishedPolearms = branch.armedGuards
      + branch.approachingPolearmCoverage
      + (branch.assignedGuards > 0 ? branch.carpenterPolearms : 0);
    if (branch.staffedCarpenters > 0) {
      branch.serviceableIronwork += branch.roadSourceIronwork;
      roadSourceTimber += branch.roadSourceTimber;
      roadSourceIronwork += branch.roadSourceIronwork;
    }
    aggregateArmableFromFinishedStock += branch.armableFromFinishedStock;
    aggregateArmableAfterReadyCrafts += branch.armableAfterReadyCrafts;
    serviceableFinishedPolearms += branch.serviceableFinishedPolearms;
    serviceableIronwork += branch.serviceableIronwork;
  }

  const roadPlan = input.roadComponentFor
    ? buildRoadPlan(
        branches,
        totalStaffedCarpenterPolearms,
        readyArmoryOutput,
      )
    : null;
  const firstExposedGuardhouseId = roadPlan?.firstExposedGuardhouseId
    ?? [...branches.values()].find(
      (branch) => branch.unarmedAfterReadyCrafts > 1e-9,
    )?.firstUnderarmedGuardhouseId
    ?? null;

  return {
    guardhouses: guardhouseCount,
    assignedGuards: assignedGuardCount,
    armedGuards: armedGuardCount,
    unarmedGuards: Math.max(0, assignedGuardCount - armedGuardCount),
    highPriorityCompanies,
    normalPriorityCompanies,
    lowPriorityCompanies,
    staffedCarpenters,
    polearmStock,
    polearmsInTransit,
    ironworkStock,
    ironworkInTransit,
    serviceableFinishedPolearms,
    unavailableFinishedPolearms: Math.max(
      0,
      polearmStock - serviceableFinishedPolearms,
    ),
    serviceableIronwork,
    unavailableIronwork: Math.max(0, ironworkStock - serviceableIronwork),
    armableFromFinishedStock: aggregateArmableFromFinishedStock,
    armableAfterReadyCrafts: aggregateArmableAfterReadyCrafts,
    unarmedAfterFinishedStock: Math.max(
      0,
      assignedGuardCount - aggregateArmableFromFinishedStock,
    ),
    unarmedAfterReadyCrafts: Math.max(
      0,
      assignedGuardCount - aggregateArmableAfterReadyCrafts,
    ),
    selectedArmoryOutput,
    readyArmoryOutput,
    timberNeededForTargets,
    ironworkNeededForTargets,
    roadSourceTimber,
    roadSourceIronwork,
    firstExposedGuardhouseId,
    roadPlan,
  };
}
