import {
  CALENDAR_SECONDS_PER_DAY,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
  FARM_TOOL_IRONWORK_PER_WORKER_DAY,
} from '../generated/gameBalance.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import { CIVILIAN_TOOL_SITE_KINDS } from './civilianToolPolicy.ts';

export const DEFAULT_PRODUCTION_RATE_PERCENT = 50;
export const MIN_PRODUCTION_RATE_PERCENT = 0;
export const MAX_PRODUCTION_RATE_PERCENT = 100;

export type ProductionRateBuildingKind =
  (typeof CIVILIAN_TOOL_SITE_KINDS)[number];

export function isProductionRateBuilding(
  kind: BuildingKind,
): kind is ProductionRateBuildingKind {
  return (CIVILIAN_TOOL_SITE_KINDS as readonly BuildingKind[]).includes(kind);
}

export function normalizeProductionRatePercent(
  percent: number | undefined,
): number {
  if (!Number.isFinite(percent)) return DEFAULT_PRODUCTION_RATE_PERCENT;
  return Math.max(
    MIN_PRODUCTION_RATE_PERCENT,
    Math.min(MAX_PRODUCTION_RATE_PERCENT, Math.round(percent ?? DEFAULT_PRODUCTION_RATE_PERCENT)),
  );
}

/** 50% is the existing production pace; the endpoints are paused and 2x. */
export function productionRateMultiplier(percent: number | undefined): number {
  return normalizeProductionRatePercent(percent) / DEFAULT_PRODUCTION_RATE_PERCENT;
}

export type ProductionRatePlan = {
  percent: number;
  throughputMultiplier: number;
  ironworkPerYear: number;
  ironworkPerWorkerYear: number;
};

/**
 * Maximum maintained-tool wear at the current roster. Actual wear is lower
 * whenever inputs, seasons, source stock, output room, or worker travel stop
 * completed work. The farmstead's work-priced wear is already expressed per
 * active worker-day; the other racks wear once per completed production cycle.
 */
export function productionRatePlan(
  building: Pick<BuildingState, 'kind' | 'assignedLabor' | 'productionRatePercent'>,
): ProductionRatePlan | null {
  if (!isProductionRateBuilding(building.kind)) return null;
  const percent = normalizeProductionRatePercent(building.productionRatePercent);
  const throughputMultiplier = productionRateMultiplier(percent);
  const definition = getBuildingDefinition(building.kind);
  const workerCount = Math.max(0, building.assignedLabor);
  const ironworkPerWorkerYear = building.kind === 'threshing_barn'
    ? 365 * FARM_TOOL_IRONWORK_PER_WORKER_DAY * throughputMultiplier
    : definition.harvestInterval > 1e-6
      ? 365 * CALENDAR_SECONDS_PER_DAY
        / definition.harvestInterval
        * CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
        * CIVILIAN_TOOL_IRONWORK_PER_CYCLE
        * throughputMultiplier
      : 0;
  const annualWorkerEquivalent = building.kind === 'woodcutters_lodge'
    ? (workerCount > 0 ? 1 : 0)
    : workerCount;
  return {
    percent,
    throughputMultiplier,
    ironworkPerYear: ironworkPerWorkerYear * annualWorkerEquivalent,
    ironworkPerWorkerYear,
  };
}
