import {
  BUILDING_STORAGE_CAPS,
  GRANARY_FLOUR_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  WEAVER_WOOL_PER_CYCLE,
} from '../generated/gameBalance.ts';
import {
  normalizeStaffingPriority,
  type StaffingPriority,
} from '../economy/staffingPriority.ts';
import { processorInputStagingCycles } from '../economy/processorOutputPolicy.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import { compareStableEntityIds } from './roadLogistics.ts';

export const PROCESSOR_INPUT_BUFFER_CYCLES = 3;

export type DirectProcessorInputCommodity = 'flour' | 'food' | 'wool';
export type ProcessorInputDispatchDuty = 'working-buffer' | 'workshop-overflow';

type ProcessorInputDestinationLike = Pick<
  BuildingState,
  | 'id'
  | 'kind'
  | 'assignedLabor'
  | 'constructionComplete'
  | 'constructionPriority'
  | 'processorOutputTargetPercent'
  | 'flour'
  | 'food'
  | 'wool'
>;

export type RoutedProcessorInputDestination<T extends ProcessorInputDestinationLike> = {
  target: T;
  duty: ProcessorInputDispatchDuty;
  desiredStock: number;
  runwayCycles: number;
  routeDistance: number;
  workPriority: StaffingPriority;
};

const TARGET_KIND: Record<DirectProcessorInputCommodity, BuildingKind> = {
  flour: 'granary',
  food: 'smokehouse',
  wool: 'weaver',
};

export function directlyDispatchedProcessorInputPerCycle(
  targetKind: BuildingKind,
  commodity: DirectProcessorInputCommodity,
): number {
  if (targetKind !== TARGET_KIND[commodity]) return 0;
  switch (commodity) {
    case 'flour':
      return GRANARY_FLOUR_PER_CYCLE;
    case 'food':
      return SMOKEHOUSE_FOOD_PER_CYCLE;
    case 'wool':
      return WEAVER_WOOL_PER_CYCLE;
  }
}

export function processorInputTarget(
  perCycle: number,
  processorOutputTargetPercent: number | undefined = 100,
): number {
  return Math.max(0, perCycle)
    * processorInputStagingCycles(processorOutputTargetPercent);
}

export function processorInputRunwayCycles(stock: number, perCycle: number): number {
  return perCycle <= 1e-6 ? Infinity : Math.max(0, stock) / perCycle;
}

/**
 * Mirrors source-side mill, granary/swine, and sheep-holding dispatch. Active
 * processors receive their selected stock-policy working buffers by work
 * priority, then lowest runway and route. Once those buffers are covered,
 * nearest storage overflow
 * resumes without letting a high tier monopolize full warehouses.
 */
export function selectDirectProcessorInputTarget<
  T extends ProcessorInputDestinationLike,
>(
  targets: Iterable<T>,
  sourceId: string,
  commodity: DirectProcessorInputCommodity,
  routeDistanceFor: (target: T) => number | null,
  hasInboundSupply: (target: T) => boolean = () => false,
  acceptsInput: (target: T) => boolean = () => true,
): RoutedProcessorInputDestination<T> | null {
  let best: RoutedProcessorInputDestination<T> | null = null;
  for (const target of targets) {
    if (
      target.id === sourceId
      || target.kind !== TARGET_KIND[commodity]
      || target.constructionComplete === false
      || hasInboundSupply(target)
      || !acceptsInput(target)
    ) {
      continue;
    }
    const stock = Math.max(0, Number(target[commodity] ?? 0));
    const capacity = (BUILDING_STORAGE_CAPS[target.kind] as Record<string, number | undefined>)[
      commodity
    ] ?? 0;
    if (stock + 1e-6 >= capacity) continue;
    const routeDistance = routeDistanceFor(target);
    if (routeDistance == null || !Number.isFinite(routeDistance)) continue;

    const perCycle = directlyDispatchedProcessorInputPerCycle(target.kind, commodity);
    const workingTarget = processorInputTarget(
      perCycle,
      target.processorOutputTargetPercent,
    );
    const duty: ProcessorInputDispatchDuty = target.assignedLabor > 0
      && stock + 1e-6 < workingTarget
      ? 'working-buffer'
      : 'workshop-overflow';
    const candidate: RoutedProcessorInputDestination<T> = {
      target,
      duty,
      desiredStock: duty === 'working-buffer' ? workingTarget : capacity,
      runwayCycles: processorInputRunwayCycles(stock, perCycle),
      routeDistance,
      workPriority: normalizeStaffingPriority(target.constructionPriority),
    };
    if (best == null || processorInputCandidatePrecedes(candidate, best)) {
      best = candidate;
    }
  }
  return best;
}

function processorInputCandidatePrecedes<T extends ProcessorInputDestinationLike>(
  candidate: RoutedProcessorInputDestination<T>,
  selected: RoutedProcessorInputDestination<T>,
): boolean {
  if (candidate.duty !== selected.duty) {
    return candidate.duty === 'working-buffer';
  }
  if (candidate.duty === 'working-buffer') {
    if (candidate.workPriority !== selected.workPriority) {
      return candidate.workPriority > selected.workPriority;
    }
    if (Math.abs(candidate.runwayCycles - selected.runwayCycles) > 1e-6) {
      return candidate.runwayCycles < selected.runwayCycles;
    }
  }
  if (Math.abs(candidate.routeDistance - selected.routeDistance) > 1e-6) {
    return candidate.routeDistance < selected.routeDistance;
  }
  return compareStableEntityIds(candidate.target.id, selected.target.id) < 0;
}
