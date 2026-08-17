import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_MONTHS_PER_YEAR,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  MONASTERY_OAT_GRAIN_PER_CYCLE,
} from '../generated/gameBalance.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import type { SettlementFarmPlan } from '../farming/farmWorkPlanning.ts';
import {
  granaryExportableGrain,
  type SettlementGranaryReserve,
} from './granaryPolicy.ts';
import type { SettlementLivestockFodderPlan } from './livestockFodder.ts';
import {
  productionRoadBranchKey,
  type ProductionGrainRoadBranch,
  type ProductionRoadComponentResolver,
  type SettlementProductionCapacity,
} from './settlementProduction.ts';
import {
  normalizeStaffingPriority,
  STAFFING_PRIORITY_HIGH,
  STAFFING_PRIORITY_LOW,
  STAFFING_PRIORITY_NORMAL,
  type StaffingPriority,
} from './staffingPriority.ts';
import { breadGrainStock } from './cropGoods.ts';

export const GRAIN_PLAN_DAYS_PER_YEAR =
  CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR;

export type GrainCommitment = {
  target: number;
  protected: number;
  shortfall: number;
};

export type GrainPlanAttentionKind = 'seed' | 'winter-fodder' | 'granary-reserve';

export type SettlementGrainPlan = {
  totalStock: number;
  inTransit: number;
  seed: GrainCommitment;
  winterFodder: GrainCommitment;
  granaryReserve: GrainCommitment;
  totalProtected: number;
  discretionaryStock: number;
  breadGrainPerDay: number;
  monasteryGrainPerDay: number;
  processorGrainPerDay: number;
  processorRunwayDays: number;
  annualProcessorDemand: number;
  annualCommitments: number;
  processorPriorityCounts: Record<StaffingPriority, number>;
  laborCoveredHarvest: number;
  potentialHarvest: number;
  annualBalance: number;
  firstAttentionBuildingId: string | null;
  firstAttentionKind: GrainPlanAttentionKind | null;
  roadPlan: SettlementGrainRoadPlan | null;
};

export type SettlementGrainRoadBranch = ProductionGrainRoadBranch & {
  monasteryGrainPerDay: number;
  processorGrainPerDay: number;
  dispatchableSourceStock: number;
  sourceRunwayDays: number;
};

export type SettlementGrainRoadPlan = {
  activeBranches: number;
  drawingBranches: number;
  stockedDrawingBranches: number;
  unstockedDrawingBranches: number;
  processorGrainPerDay: number;
  dispatchableSourceStock: number;
  matchedSourceStock: number;
  outsideProcessorBranchStock: number;
  weakestSourceRunwayDays: number;
  firstExposedBuildingId: string | null;
  branches: ReadonlyMap<string, SettlementGrainRoadBranch>;
};

type SettlementGrainPlanInput = {
  state: Pick<GameState, 'stockpile' | 'buildings' | 'deliveryTrips'>
    & Partial<Pick<GameState, 'physicalFoundingSiteEnabled'>>;
  farmPlan: Pick<
    SettlementFarmPlan,
    | 'seedGrainRequired'
    | 'seedGrainCovered'
    | 'firstSeedShortBuildingId'
    | 'laborCoveredHarvest'
    | 'expectedHarvest'
  > & {
    seedGrainByHolding?: ReadonlyMap<string, number>;
  };
  livestockFodder: Pick<
    SettlementLivestockFodderPlan,
    | 'winterGrainNeed'
    | 'winterReserveTarget'
    | 'winterReserveStock'
    | 'firstShortBuildingId'
  >;
  granaryReserve: Pick<
    SettlementGranaryReserve,
    | 'reserveTarget'
    | 'protectedStock'
    | 'firstShortGranaryId'
  >;
  production: Pick<
    SettlementProductionCapacity,
    'breadGrainPerDay'
  > & {
    grainRoadBranches?: ReadonlyMap<string, ProductionGrainRoadBranch> | null;
  };
  sabbathObserved: boolean;
  monasteryProductivity: (building: BuildingState) => number;
  roadComponentFor?: ProductionRoadComponentResolver;
};

type GrainTransit = {
  total: number;
  seed: number;
  winterFodder: number;
  granaryReserve: number;
};

const WORKDAY_SECONDS = CALENDAR_SECONDS_PER_DAY
  * (CALENDAR_WORK_END_HOUR - CALENDAR_WORK_START_HOUR)
  / CALENDAR_HOURS_PER_DAY;
const MONASTERY_CYCLES_PER_WORKDAY =
  WORKDAY_SECONDS / getBuildingDefinition('monastery').harvestInterval;

function positiveFinite(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

function earlierStableId(
  current: string | null,
  candidate: string,
): string {
  return current === null || compareStableEntityIds(candidate, current) < 0
    ? candidate
    : current;
}

function grainRoadBranch(
  branches: Map<string, SettlementGrainRoadBranch>,
  key: string,
): SettlementGrainRoadBranch {
  let branch = branches.get(key);
  if (branch) return branch;
  branch = {
    breadGrainPerDay: 0,
    monasteryGrainPerDay: 0,
    processorGrainPerDay: 0,
    dispatchableSourceStock: 0,
    sourceRunwayDays: Number.POSITIVE_INFINITY,
    firstProcessorId: null,
  };
  branches.set(key, branch);
  return branch;
}

function initialGrainRoadBranches(
  source: ReadonlyMap<string, ProductionGrainRoadBranch> | null | undefined,
  componentFor: ProductionRoadComponentResolver | undefined,
): Map<string, SettlementGrainRoadBranch> | null {
  if (!source || !componentFor) return null;
  const branches = new Map<string, SettlementGrainRoadBranch>();
  for (const [key, production] of source) {
    const breadGrainPerDay = positiveFinite(production.breadGrainPerDay);
    const processorGrainPerDay = breadGrainPerDay;
    branches.set(key, {
      ...production,
      breadGrainPerDay,
      monasteryGrainPerDay: 0,
      processorGrainPerDay,
      dispatchableSourceStock: 0,
      sourceRunwayDays: processorGrainPerDay > 1e-9
        ? 0
        : Number.POSITIVE_INFINITY,
    });
  }
  return branches;
}

function buildGrainRoadPlan(
  branches: Map<string, SettlementGrainRoadBranch> | null,
): SettlementGrainRoadPlan | null {
  if (!branches) return null;
  let drawingBranches = 0;
  let stockedDrawingBranches = 0;
  let unstockedDrawingBranches = 0;
  let processorGrainPerDay = 0;
  let dispatchableSourceStock = 0;
  let matchedSourceStock = 0;
  let outsideProcessorBranchStock = 0;
  let weakestSourceRunwayDays = Number.POSITIVE_INFINITY;
  let firstExposedBuildingId: string | null = null;

  for (const branch of branches.values()) {
    const demand = positiveFinite(branch.breadGrainPerDay)
      + positiveFinite(branch.monasteryGrainPerDay);
    const sourceStock = positiveFinite(branch.dispatchableSourceStock);
    branch.processorGrainPerDay = demand;
    branch.dispatchableSourceStock = sourceStock;
    branch.sourceRunwayDays = demand > 1e-9
      ? sourceStock / demand
      : Number.POSITIVE_INFINITY;
    processorGrainPerDay += demand;
    dispatchableSourceStock += sourceStock;
    if (demand <= 1e-9) {
      outsideProcessorBranchStock += sourceStock;
      continue;
    }
    drawingBranches += 1;
    matchedSourceStock += sourceStock;
    if (sourceStock > 1e-9) stockedDrawingBranches += 1;
    else unstockedDrawingBranches += 1;
    if (
      branch.firstProcessorId !== null
      && (
        branch.sourceRunwayDays < weakestSourceRunwayDays - 1e-9
        || (
          Math.abs(branch.sourceRunwayDays - weakestSourceRunwayDays) <= 1e-9
          && (
            firstExposedBuildingId === null
            || compareStableEntityIds(
              branch.firstProcessorId,
              firstExposedBuildingId,
            ) < 0
          )
        )
      )
    ) {
      weakestSourceRunwayDays = branch.sourceRunwayDays;
      firstExposedBuildingId = branch.firstProcessorId;
    }
  }

  return {
    activeBranches: branches.size,
    drawingBranches,
    stockedDrawingBranches,
    unstockedDrawingBranches,
    processorGrainPerDay,
    dispatchableSourceStock,
    matchedSourceStock,
    outsideProcessorBranchStock,
    weakestSourceRunwayDays,
    firstExposedBuildingId,
    branches,
  };
}

function commitment(
  target: number,
  stored: number,
  inbound: number,
): GrainCommitment {
  const normalizedTarget = positiveFinite(target);
  const protectedStock = Math.min(
    normalizedTarget,
    positiveFinite(stored) + positiveFinite(inbound),
  );
  return {
    target: normalizedTarget,
    protected: protectedStock,
    shortfall: Math.max(0, normalizedTarget - protectedStock),
  };
}

function grainTransit(
  state: Pick<GameState, 'buildings' | 'deliveryTrips'>,
): GrainTransit {
  const transit: GrainTransit = {
    total: 0,
    seed: 0,
    winterFodder: 0,
    granaryReserve: 0,
  };
  for (const trip of state.deliveryTrips.values()) {
    if (
      trip.cargoKind !== 'ryeGrain'
      && trip.cargoKind !== 'oatGrain'
      && trip.cargoKind !== 'maslinGrain'
    ) continue;
    const amount = positiveFinite(trip.amount);
    transit.total += amount;
    if (
      amount <= 1e-9
      || trip.phase === 'inbound'
      || trip.destinationKind !== 'building'
      || trip.targetBuildingId === null
    ) {
      continue;
    }
    const target = state.buildings.get(trip.targetBuildingId);
    if (target?.kind === 'threshing_barn') {
      transit.seed += amount;
    } else if (
      target?.kind === 'pastoral_farmstead'
      || target?.kind === 'swineherd'
    ) {
      transit.winterFodder += amount;
    } else if (target?.kind === 'granary') {
      transit.granaryReserve += amount;
    }
  }
  return transit;
}

/**
 * Read-only crop-year allocation forecast. It connects grain already held or
 * traveling with the settlement's existing local reserve policies and current
 * staffed processing capacity; it neither reserves stock nor changes dispatch.
 * With cached component IDs, the optional road plan separately compares local
 * installed draw with only the staffed farmstead and granary surplus that can
 * actually dispatch on that branch. Workshop buffers and carts remain in the
 * per-building production forecast and are deliberately not counted twice.
 */
export function computeSettlementGrainPlan(
  input: SettlementGrainPlanInput,
): SettlementGrainPlan {
  const transit = grainTransit(input.state);
  const roadBranches = initialGrainRoadBranches(
    input.production.grainRoadBranches,
    input.roadComponentFor,
  );
  let totalStock = (
    input.state.physicalFoundingSiteEnabled === true
      ? 0
      : breadGrainStock(input.state.stockpile)
  ) + transit.total;
  let monasteryGrainPerDay = 0;
  const processorPriorityCounts: Record<StaffingPriority, number> = {
    [STAFFING_PRIORITY_LOW]: 0,
    [STAFFING_PRIORITY_NORMAL]: 0,
    [STAFFING_PRIORITY_HIGH]: 0,
  };
  const workShare = input.sabbathObserved ? 6 / 7 : 1;

  for (const building of input.state.buildings.values()) {
    const buildingGrain = breadGrainStock(building);
    const completed = building.constructionComplete !== false;
    totalStock += buildingGrain;
    if (roadBranches && input.roadComponentFor && completed) {
      const key = productionRoadBranchKey(
        input.roadComponentFor(building),
        'building',
        building.id,
      );
      let dispatchableSourceStock = 0;
      if (
        building.assignedLabor > 0
        && building.kind === 'threshing_barn'
        && input.farmPlan.seedGrainByHolding
      ) {
        dispatchableSourceStock = Math.max(
          0,
          buildingGrain
            - (input.farmPlan.seedGrainByHolding.get(building.id) ?? 0),
        );
      } else if (building.assignedLabor > 0 && building.kind === 'granary') {
        dispatchableSourceStock = granaryExportableGrain(
          buildingGrain,
          building.granaryGrainReserve ?? 0,
        );
      }
      if (dispatchableSourceStock > 1e-9) {
        grainRoadBranch(roadBranches, key).dispatchableSourceStock +=
          dispatchableSourceStock;
      }
    }
    if (
      completed
      && (
        (building.kind === 'monastery')
        || (
          (building.kind === 'watermill' || building.kind === 'windmill' || building.kind === 'brewery')
          && building.assignedLabor > 0
        )
      )
    ) {
      processorPriorityCounts[
        normalizeStaffingPriority(building.constructionPriority)
      ] += 1;
    }
    if (building.kind !== 'monastery' || !completed) {
      continue;
    }
    const productivity = Math.min(
      1,
      positiveFinite(input.monasteryProductivity(building)),
    );
    const monasteryDailyDemand = MONASTERY_CYCLES_PER_WORKDAY
      * workShare
      * MONASTERY_OAT_GRAIN_PER_CYCLE
      * productivity;
    monasteryGrainPerDay += monasteryDailyDemand;
    if (roadBranches && input.roadComponentFor && monasteryDailyDemand > 1e-9) {
      const branch = grainRoadBranch(
        roadBranches,
        productionRoadBranchKey(
          input.roadComponentFor(building),
          'building',
          building.id,
        ),
      );
      branch.monasteryGrainPerDay += monasteryDailyDemand;
      branch.firstProcessorId = earlierStableId(
        branch.firstProcessorId,
        building.id,
      );
    }
  }

  const seed = commitment(
    input.farmPlan.seedGrainRequired,
    input.farmPlan.seedGrainCovered,
    transit.seed,
  );
  const winterFodder = commitment(
    input.livestockFodder.winterReserveTarget,
    input.livestockFodder.winterReserveStock,
    transit.winterFodder,
  );
  const granaryReserve = commitment(
    input.granaryReserve.reserveTarget,
    input.granaryReserve.protectedStock,
    transit.granaryReserve,
  );
  const totalProtected = seed.protected
    + winterFodder.protected
    + granaryReserve.protected;
  const discretionaryStock = Math.max(0, totalStock - totalProtected);
  const breadGrainPerDay = positiveFinite(input.production.breadGrainPerDay);
  const processorGrainPerDay =
    breadGrainPerDay + monasteryGrainPerDay;
  const annualProcessorDemand = processorGrainPerDay * GRAIN_PLAN_DAYS_PER_YEAR;
  const annualCommitments = seed.target
    + positiveFinite(input.livestockFodder.winterGrainNeed)
    + annualProcessorDemand;
  const laborCoveredHarvest = positiveFinite(input.farmPlan.laborCoveredHarvest);
  const potentialHarvest = positiveFinite(input.farmPlan.expectedHarvest);
  const roadPlan = buildGrainRoadPlan(roadBranches);

  let firstAttentionBuildingId: string | null = null;
  let firstAttentionKind: GrainPlanAttentionKind | null = null;
  if (seed.shortfall > 0.05 && input.farmPlan.firstSeedShortBuildingId !== null) {
    firstAttentionBuildingId = input.farmPlan.firstSeedShortBuildingId;
    firstAttentionKind = 'seed';
  } else if (
    winterFodder.shortfall > 0.05
    && input.livestockFodder.firstShortBuildingId !== null
  ) {
    firstAttentionBuildingId = input.livestockFodder.firstShortBuildingId;
    firstAttentionKind = 'winter-fodder';
  } else if (
    granaryReserve.shortfall > 0.05
    && input.granaryReserve.firstShortGranaryId !== null
  ) {
    firstAttentionBuildingId = input.granaryReserve.firstShortGranaryId;
    firstAttentionKind = 'granary-reserve';
  }

  return {
    totalStock,
    inTransit: transit.total,
    seed,
    winterFodder,
    granaryReserve,
    totalProtected,
    discretionaryStock,
    breadGrainPerDay,
    monasteryGrainPerDay,
    processorGrainPerDay,
    processorRunwayDays: processorGrainPerDay > 1e-9
      ? discretionaryStock / processorGrainPerDay
      : Number.POSITIVE_INFINITY,
    annualProcessorDemand,
    annualCommitments,
    processorPriorityCounts,
    laborCoveredHarvest,
    potentialHarvest,
    annualBalance: laborCoveredHarvest - annualCommitments,
    firstAttentionBuildingId,
    firstAttentionKind,
    roadPlan,
  };
}
