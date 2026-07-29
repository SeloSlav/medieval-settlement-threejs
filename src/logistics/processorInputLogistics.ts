import {
  BREWERY_BARLEY_PER_MALT_CYCLE,
  BUILDING_STORAGE_CAPS,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  GRANARY_FLOUR_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  WEAVER_FLAX_PER_CYCLE,
  WEAVER_WOOL_PER_CYCLE,
} from '../generated/gameBalance.ts';
import { isCivilianToolSite } from '../economy/civilianToolPolicy.ts';
import {
  normalizeStaffingPriority,
  type StaffingPriority,
} from '../economy/staffingPriority.ts';
import { processorInputStagingCycles } from '../economy/processorOutputPolicy.ts';
import { weaverFibreDeliveryPreferenceRank } from '../economy/weaverInputPolicy.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import { compareStableEntityIds } from './roadLogistics.ts';

export const PROCESSOR_INPUT_BUFFER_CYCLES = 3;

export type DirectProcessorInputCommodity =
  | 'barley'
  | 'flour'
  | 'food'
  | 'wool'
  | 'flax'
  | 'ironwork';
export type ProcessorInputDispatchDuty = 'working-buffer' | 'workshop-overflow';

type ProcessorInputDestinationLike = Pick<
  BuildingState,
  | 'id'
  | 'kind'
  | 'assignedLabor'
  | 'constructionComplete'
  | 'constructionPriority'
  | 'processorOutputTargetPercent'
  | 'weaverInputPolicy'
  | 'flour'
  | 'food'
  | 'wool'
  | 'flax'
  | 'barley'
  | 'ironwork'
>;

export type RoutedProcessorInputDestination<T extends ProcessorInputDestinationLike> = {
  target: T;
  duty: ProcessorInputDispatchDuty;
  desiredStock: number;
  runwayCycles: number;
  routeDistance: number;
  workPriority: StaffingPriority;
  inputPreferenceRank: number;
};

const TARGET_KINDS: Record<
  DirectProcessorInputCommodity,
  readonly BuildingKind[]
> = {
  barley: ['brewery'],
  flour: ['granary'],
  food: ['smokehouse'],
  wool: ['weaver'],
  flax: ['weaver'],
  ironwork: [
    'lumber_mill',
    'stone_quarry',
    'large_quarry',
    'clay_pit',
    'carpenter',
  ],
};

export function directlyDispatchedProcessorInputPerCycle(
  targetKind: BuildingKind,
  commodity: DirectProcessorInputCommodity,
): number {
  if (!TARGET_KINDS[commodity].includes(targetKind)) return 0;
  switch (commodity) {
    case 'barley':
      return BREWERY_BARLEY_PER_MALT_CYCLE;
    case 'flour':
      return GRANARY_FLOUR_PER_CYCLE;
    case 'food':
      return SMOKEHOUSE_FOOD_PER_CYCLE;
    case 'wool':
      return WEAVER_WOOL_PER_CYCLE;
    case 'flax':
      return WEAVER_FLAX_PER_CYCLE;
    case 'ironwork':
      return isCivilianToolSite(targetKind)
        ? CIVILIAN_TOOL_IRONWORK_PER_CYCLE
        : 0;
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
 * Mirrors source-side mill, granary/swine, sheep-holding, and smithy dispatch. Active
 * processors receive their selected stock-policy working buffers by work
 * priority. Equal-tier looms then route matching fibres to their selected
 * specialization before lowest runway and route; staffed extractive worksites
 * use the same ordering for replacement iron tools. Once those buffers are
 * covered, nearest storage overflow resumes without letting a high tier
 * monopolize full warehouses.
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
      || !TARGET_KINDS[commodity].includes(target.kind)
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
      inputPreferenceRank: target.kind === 'weaver'
        && (commodity === 'wool' || commodity === 'flax')
        ? weaverFibreDeliveryPreferenceRank(target.weaverInputPolicy, commodity)
        : 0,
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
    if (candidate.inputPreferenceRank !== selected.inputPreferenceRank) {
      return candidate.inputPreferenceRank < selected.inputPreferenceRank;
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
