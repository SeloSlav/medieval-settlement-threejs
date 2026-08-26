import type { BuildingState, GameState } from '../resources/types.ts';
import {
  computeSettlementConstructionLaborPlan,
  type SettlementConstructionLaborPlan,
} from './constructionLabor.ts';
import {
  computeSettlementProductionStewardPlan,
  type SettlementProductionStewardPlan,
} from './processorLabor.ts';
import {
  applySeasonalLaborRecall,
  computeSettlementSeasonalCallupPlan,
  computeSettlementSeasonalLaborPlan,
  type SettlementSeasonalCallupPlan,
  type SettlementSeasonalLaborPlan,
} from './seasonalLabor.ts';
import { applyWorksiteStallRecall } from './settlementWorksiteStalls.ts';

export type LaborStewardPolicySelection = {
  seasonalEnabled: boolean;
  productionEnabled: boolean;
  constructionEnabled: boolean;
};

export type SeasonalStewardForecastStage = {
  recall: SettlementSeasonalLaborPlan;
  callup: SettlementSeasonalCallupPlan;
  availableLaborBefore: number;
  recalledWorkers: number;
  calledWorkers: number;
  availableLaborAfter: number;
  firstChangedBuildingId: string | null;
};

export type ConstructionStewardForecastStage = {
  plan: SettlementConstructionLaborPlan;
  availableLaborBefore: number;
  recalledWorkers: number;
  calledWorkers: number;
  availableLaborAfter: number;
  firstChangedBuildingId: string | null;
};

export type SettlementLaborStewardForecast = {
  reviewMonth: number;
  laborReserve: number;
  enabledStages: number;
  availableLaborBefore: number;
  availableLaborAfter: number;
  workplaceReserveBefore: number;
  workplaceReserveAfter: number;
  totalRecalledWorkers: number;
  totalCalledWorkers: number;
  firstChangedBuildingId: string | null;
  seasonal: SeasonalStewardForecastStage | null;
  production: SettlementProductionStewardPlan | null;
  construction: ConstructionStewardForecastStage | null;
};

function applyProjectedLaborTargets(
  buildings: Map<string, BuildingState>,
  targets: Iterable<{ buildingId: string; targetLabor: number }>,
): void {
  for (const target of targets) {
    const building = buildings.get(target.buildingId);
    if (!building) continue;
    buildings.set(target.buildingId, {
      ...building,
      assignedLabor: target.targetLabor,
    });
  }
}

/**
 * Projects the authoritative dawn sequence without mutating synchronized state.
 * Each enabled stage receives the buildings and free pool left by the previous
 * stage, matching server order: seasonal, production, then construction.
 */
export function computeSettlementLaborStewardForecast(
  state: Pick<
    GameState,
    'buildings' | 'deliveryTrips' | 'farmFields' | 'quarries' | 'foragingNodes'
  > & Partial<Pick<GameState, 'fireIncidents'>>,
  reviewMonth: number,
  availableLabor: number,
  policies: LaborStewardPolicySelection,
  laborReserve = 0,
  workplaceReserveLabor = availableLabor,
): SettlementLaborStewardForecast {
  const availableLaborBefore = Math.max(0, Math.floor(availableLabor));
  const workplaceReserveBefore = Math.max(0, Math.floor(workplaceReserveLabor));
  const safeLaborReserve = Math.max(0, Math.floor(laborReserve));
  let projectedBuildings = state.buildings;
  let laborRemaining = availableLaborBefore;
  let workplaceReserveRemaining = workplaceReserveBefore;
  let totalRecalledWorkers = 0;
  let totalCalledWorkers = 0;
  let firstChangedBuildingId: string | null = null;

  let seasonal: SeasonalStewardForecastStage | null = null;
  if (policies.seasonalEnabled) {
    const stageAvailableBefore = laborRemaining;
    const recall = computeSettlementSeasonalLaborPlan(
      { ...state, buildings: projectedBuildings },
      reviewMonth,
    );
    projectedBuildings = applySeasonalLaborRecall(projectedBuildings, recall);
    laborRemaining += recall.reclaimableWorkers;
    workplaceReserveRemaining += recall.reclaimableWorkers;
    const callup = computeSettlementSeasonalCallupPlan(
      { ...state, buildings: projectedBuildings },
      reviewMonth,
      Math.max(0, workplaceReserveRemaining - safeLaborReserve),
    );
    applyProjectedLaborTargets(projectedBuildings, callup.assignments);
    laborRemaining = Math.max(0, laborRemaining - callup.callupWorkers);
    workplaceReserveRemaining = Math.max(
      0,
      workplaceReserveRemaining - callup.callupWorkers,
    );
    seasonal = {
      recall,
      callup,
      availableLaborBefore: stageAvailableBefore,
      recalledWorkers: recall.reclaimableWorkers,
      calledWorkers: callup.callupWorkers,
      availableLaborAfter: laborRemaining,
      firstChangedBuildingId: recall.firstReclaimableBuildingId
        ?? callup.firstUnderstaffedBuildingId,
    };
    totalRecalledWorkers += seasonal.recalledWorkers;
    totalCalledWorkers += seasonal.calledWorkers;
    firstChangedBuildingId ??= seasonal.firstChangedBuildingId;
  }

  let production: SettlementProductionStewardPlan | null = null;
  if (policies.productionEnabled) {
    production = computeSettlementProductionStewardPlan(
      { ...state, buildings: projectedBuildings },
      reviewMonth,
      workplaceReserveRemaining,
      safeLaborReserve,
    );
    projectedBuildings = applyWorksiteStallRecall(
      projectedBuildings,
      production.recall,
    );
    applyProjectedLaborTargets(projectedBuildings, production.callup.assignments);
    laborRemaining = Math.max(
      0,
      laborRemaining + production.recalledWorkers - production.calledWorkers,
    );
    workplaceReserveRemaining = Math.max(
      0,
      workplaceReserveRemaining
        + production.recalledWorkers
        - production.calledWorkers,
    );
    totalRecalledWorkers += production.recalledWorkers;
    totalCalledWorkers += production.calledWorkers;
    firstChangedBuildingId ??= production.firstChangedBuildingId;
  }

  let construction: ConstructionStewardForecastStage | null = null;
  if (policies.constructionEnabled) {
    const stageAvailableBefore = laborRemaining;
    const plan = computeSettlementConstructionLaborPlan(
      { ...state, buildings: projectedBuildings },
      laborRemaining,
      safeLaborReserve,
    );
    laborRemaining = plan.freeLaborAfter;
    construction = {
      plan,
      availableLaborBefore: stageAvailableBefore,
      recalledWorkers: plan.recalledWorkers,
      calledWorkers: plan.calledWorkers,
      availableLaborAfter: laborRemaining,
      firstChangedBuildingId: plan.firstBlockedBuildingId
        ?? plan.firstReadyUnderstaffedBuildingId,
    };
    totalRecalledWorkers += construction.recalledWorkers;
    totalCalledWorkers += construction.calledWorkers;
    firstChangedBuildingId ??= construction.firstChangedBuildingId;
  }

  return {
    reviewMonth,
    laborReserve: safeLaborReserve,
    enabledStages: Number(policies.seasonalEnabled)
      + Number(policies.productionEnabled)
      + Number(policies.constructionEnabled),
    availableLaborBefore,
    availableLaborAfter: laborRemaining,
    workplaceReserveBefore,
    workplaceReserveAfter: workplaceReserveRemaining,
    totalRecalledWorkers,
    totalCalledWorkers,
    firstChangedBuildingId,
    seasonal,
    production,
    construction,
  };
}
