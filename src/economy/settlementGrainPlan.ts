import {
  CALENDAR_DAYS_PER_MONTH,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_MONTHS_PER_YEAR,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  MONASTERY_GRAIN_PER_CYCLE,
} from '../generated/gameBalance.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import type { SettlementFarmPlan } from '../farming/farmWorkPlanning.ts';
import type { SettlementGranaryReserve } from './granaryPolicy.ts';
import type { SettlementLivestockFodderPlan } from './livestockFodder.ts';
import type { SettlementProductionCapacity } from './settlementProduction.ts';
import {
  normalizeStaffingPriority,
  STAFFING_PRIORITY_HIGH,
  STAFFING_PRIORITY_LOW,
  STAFFING_PRIORITY_NORMAL,
  type StaffingPriority,
} from './staffingPriority.ts';

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
  aleGrainPerDay: number;
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
};

type SettlementGrainPlanInput = {
  state: Pick<GameState, 'stockpile' | 'buildings' | 'deliveryTrips'>;
  farmPlan: Pick<
    SettlementFarmPlan,
    | 'seedGrainRequired'
    | 'seedGrainCovered'
    | 'firstSeedShortBuildingId'
    | 'laborCoveredHarvest'
    | 'expectedHarvest'
  >;
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
    'breadGrainPerDay' | 'aleGrainPerDay'
  >;
  sabbathObserved: boolean;
  monasteryProductivity: (building: BuildingState) => number;
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
    if (trip.cargoKind !== 'grain') continue;
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
 */
export function computeSettlementGrainPlan(
  input: SettlementGrainPlanInput,
): SettlementGrainPlan {
  const transit = grainTransit(input.state);
  let totalStock = positiveFinite(input.state.stockpile.grain) + transit.total;
  let monasteryGrainPerDay = 0;
  const processorPriorityCounts: Record<StaffingPriority, number> = {
    [STAFFING_PRIORITY_LOW]: 0,
    [STAFFING_PRIORITY_NORMAL]: 0,
    [STAFFING_PRIORITY_HIGH]: 0,
  };
  const workShare = input.sabbathObserved ? 6 / 7 : 1;

  for (const building of input.state.buildings.values()) {
    totalStock += positiveFinite(building.grain);
    if (
      building.constructionComplete !== false
      && (
        (building.kind === 'monastery')
        || (
          (building.kind === 'watermill' || building.kind === 'brewery')
          && building.assignedLabor > 0
        )
      )
    ) {
      processorPriorityCounts[
        normalizeStaffingPriority(building.constructionPriority)
      ] += 1;
    }
    if (building.kind !== 'monastery' || building.constructionComplete === false) {
      continue;
    }
    const productivity = Math.min(
      1,
      positiveFinite(input.monasteryProductivity(building)),
    );
    monasteryGrainPerDay += MONASTERY_CYCLES_PER_WORKDAY
      * workShare
      * MONASTERY_GRAIN_PER_CYCLE
      * productivity;
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
  const aleGrainPerDay = positiveFinite(input.production.aleGrainPerDay);
  const processorGrainPerDay =
    breadGrainPerDay + aleGrainPerDay + monasteryGrainPerDay;
  const annualProcessorDemand = processorGrainPerDay * GRAIN_PLAN_DAYS_PER_YEAR;
  const annualCommitments = seed.target
    + positiveFinite(input.livestockFodder.winterGrainNeed)
    + annualProcessorDemand;
  const laborCoveredHarvest = positiveFinite(input.farmPlan.laborCoveredHarvest);
  const potentialHarvest = positiveFinite(input.farmPlan.expectedHarvest);

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
    aleGrainPerDay,
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
  };
}
