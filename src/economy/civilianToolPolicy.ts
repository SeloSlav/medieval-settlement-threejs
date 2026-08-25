import {
  BUILDING_STORAGE_CAPS,
  CALENDAR_HOURS_PER_DAY,
  CALENDAR_SECONDS_PER_DAY,
  CALENDAR_WORK_END_HOUR,
  CALENDAR_WORK_START_HOUR,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  CIVILIAN_TOOL_REORDER_CYCLES,
  CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER,
  FARM_TOOL_IRONWORK_PER_WORKER_DAY,
  FARM_WORK_METERS_PER_WORKER_PER_SEC,
} from '../generated/gameBalance.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';

export const CIVILIAN_TOOL_SITE_KINDS = [
  'lumber_mill',
  'woodcutters_lodge',
  'stone_quarry',
  'large_quarry',
  'mine',
  'clay_pit',
  'threshing_barn',
  'watermill',
  'windmill',
] as const satisfies readonly BuildingKind[];

export type CivilianToolSiteKind = (typeof CIVILIAN_TOOL_SITE_KINDS)[number];

export type CivilianToolPlan = {
  maintained: boolean;
  ironwork: number;
  capacity: number;
  reorderStock: number;
  refillTarget: number;
  refillAmount: number;
  reorderDue: boolean;
  runwayCycles: number;
  throughputMultiplier: number;
};

export function isCivilianToolSite(
  kind: BuildingKind,
): kind is CivilianToolSiteKind {
  return (CIVILIAN_TOOL_SITE_KINDS as readonly BuildingKind[]).includes(kind);
}

export function civilianToolsMaintained(ironwork: number): boolean {
  return Math.max(0, ironwork) + 1e-6 >= CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
}

export function civilianToolRunwayCycles(ironwork: number): number {
  return CIVILIAN_TOOL_IRONWORK_PER_CYCLE <= 1e-9
    ? Infinity
    : Math.max(0, ironwork) / CIVILIAN_TOOL_IRONWORK_PER_CYCLE;
}

export function civilianToolReorderStock(capacity: number): number {
  return Math.min(
    Math.max(0, capacity),
    Math.max(
      CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
      CIVILIAN_TOOL_IRONWORK_PER_CYCLE * CIVILIAN_TOOL_REORDER_CYCLES,
    ),
  );
}

export function civilianToolRefillDue(
  ironwork: number,
  capacity: number,
): boolean {
  return capacity > 1e-6
    && Math.max(0, ironwork) + 1e-6 < civilianToolReorderStock(capacity);
}

export function civilianToolRefillAmount(
  ironwork: number,
  capacity: number,
): number {
  return civilianToolRefillDue(ironwork, capacity)
    ? Math.max(0, capacity - Math.max(0, ironwork))
    : 0;
}

export function civilianToolThroughputMultiplier(ironwork: number): number {
  return civilianToolsMaintained(ironwork)
    ? CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
    : 1;
}

export function farmToolsMaintained(ironwork: number): boolean {
  return Math.max(0, ironwork) > 1e-6;
}

export function farmToolThroughputMultiplier(ironwork: number): number {
  return farmToolsMaintained(ironwork)
    ? CIVILIAN_TOOL_THROUGHPUT_MULTIPLIER
    : 1;
}

export function farmToolIronworkForWork(completedWork: number): number {
  const workPerWorkerDay = FARM_WORK_METERS_PER_WORKER_PER_SEC
    * CALENDAR_SECONDS_PER_DAY;
  return workPerWorkerDay <= 1e-9
    ? 0
    : Math.max(0, completedWork) / workPerWorkerDay
      * FARM_TOOL_IRONWORK_PER_WORKER_DAY;
}

export function farmToolWorkerDayRunway(ironwork: number): number {
  return FARM_TOOL_IRONWORK_PER_WORKER_DAY <= 1e-9
    ? Infinity
    : Math.max(0, ironwork) / FARM_TOOL_IRONWORK_PER_WORKER_DAY;
}

export function civilianToolPlan(
  building: Pick<BuildingState, 'kind' | 'ironwork'>,
): CivilianToolPlan | null {
  if (!isCivilianToolSite(building.kind)) return null;
  const ironwork = Math.max(0, building.ironwork ?? 0);
  const farmstead = building.kind === 'threshing_barn';
  const capacity = BUILDING_STORAGE_CAPS[building.kind].ironwork ?? 0;
  const reorderDue = civilianToolRefillDue(ironwork, capacity);
  return {
    maintained: farmstead
      ? farmToolsMaintained(ironwork)
      : civilianToolsMaintained(ironwork),
    ironwork,
    capacity,
    reorderStock: civilianToolReorderStock(capacity),
    refillTarget: capacity,
    refillAmount: reorderDue ? Math.max(0, capacity - ironwork) : 0,
    reorderDue,
    runwayCycles: civilianToolRunwayCycles(ironwork),
    throughputMultiplier: farmstead
      ? farmToolThroughputMultiplier(ironwork)
      : civilianToolThroughputMultiplier(ironwork),
  };
}
