import {
  BUILDING_STORAGE_CAPS,
  MONASTERY_OAT_GRAIN_PER_CYCLE,
  WATERMILL_GRAIN_PER_CYCLE,
} from '../generated/gameBalance.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import {
  normalizeStaffingPriority,
  type StaffingPriority,
} from '../economy/staffingPriority.ts';
import { processorInputStagingCycles } from '../economy/processorOutputPolicy.ts';
import { compareStableEntityIds } from './roadLogistics.ts';
import { breadGrainStock, type BreadGrainKind } from '../economy/cropGoods.ts';
import { wholeResourceUnits } from '../resources/resourceUnits.ts';

export const GRAIN_DISPATCH_SOURCE_KINDS = ['threshing_barn', 'granary'] as const;
export const GRAIN_PROCESSOR_KINDS = ['watermill', 'windmill', 'monastery'] as const;
export const GRAIN_DISPATCH_TARGET_KINDS = [
  'watermill',
  'windmill',
  'granary',
  'monastery',
] as const;
export const GRAIN_INPUT_BUFFER_CYCLES = 3;
export const GRAIN_CRITICAL_RUNWAY_CYCLES = 1;

export type GrainProcessorKind = Extract<
  BuildingKind,
  'watermill' | 'windmill' | 'monastery'
>;
export type GrainDispatchDuty =
  | 'working-buffer'
  | 'granary-reserve'
  | 'workshop-overflow';

type GrainDestinationLike = Pick<
  BuildingState,
  | 'id'
  | 'kind'
  | 'ryeGrain'
  | 'oatGrain'
  | 'maslinGrain'
  | 'assignedLabor'
  | 'constructionComplete'
  | 'constructionPriority'
  | 'processorOutputTargetPercent'
>;

export type RoutedGrainDestination<T extends GrainDestinationLike> = {
  target: T;
  commodity: BreadGrainKind;
  duty: GrainDispatchDuty;
  desiredStock: number;
  runwayCycles: number;
  routeDistance: number;
  workPriority: StaffingPriority;
};

function grainInputPerCycle(
  kind: GrainProcessorKind,
  productivity = 1,
): number {
  return kind === 'watermill' || kind === 'windmill'
    ? WATERMILL_GRAIN_PER_CYCLE
    : MONASTERY_OAT_GRAIN_PER_CYCLE * Math.max(0, productivity);
}

/** Mirrors the authoritative stock-policy working buffer for grain processors. */
export function grainInputTarget(
  kind: GrainProcessorKind,
  productivity = 1,
  processorOutputTargetPercent: number | undefined = 100,
): number {
  const stagingCycles = kind === 'monastery'
    ? GRAIN_INPUT_BUFFER_CYCLES
    : processorInputStagingCycles(processorOutputTargetPercent);
  return grainInputPerCycle(kind, productivity) * stagingCycles;
}

export function grainInputRunwayCycles(
  kind: GrainProcessorKind,
  stock: number,
  productivity = 1,
): number {
  const perCycle = grainInputPerCycle(kind, productivity);
  return perCycle <= 1e-6
    ? Infinity
    : Math.max(0, stock) / perCycle;
}

export function grainDispatchDuty(
  target: GrainDestinationLike,
  productivity = 1,
  commodity: BreadGrainKind = 'ryeGrain',
): GrainDispatchDuty | null {
  if (target.kind === 'granary') return 'granary-reserve';
  if (!(GRAIN_PROCESSOR_KINDS as readonly BuildingKind[]).includes(target.kind)) return null;
  if (target.kind === 'monastery' && commodity !== 'oatGrain') return null;
  const desiredStock = grainInputTarget(
    target.kind as GrainProcessorKind,
    productivity,
    target.processorOutputTargetPercent,
  );
  const operational = target.kind === 'monastery' || target.assignedLabor > 0;
  return operational && (target[commodity] ?? 0) + 1e-6 < desiredStock
    ? 'working-buffer'
    : 'workshop-overflow';
}

const GRAIN_DUTY_RANK: Record<GrainDispatchDuty, number> = {
  'working-buffer': 0,
  'granary-reserve': 1,
  'workshop-overflow': 2,
};

/**
 * Mirrors farmstead dispatch: processors with the lowest runway first;
 * central reserve follows, with full workshop warehouses used
 * only when no granary has room.
 */
export function selectGrainDispatchTarget<T extends GrainDestinationLike>(
  targets: Iterable<T>,
  sourceId: string,
  routeDistanceFor: (target: T) => number | null,
  productivityFor: (target: T) => number = () => 1,
  hasInboundSupply: (target: T) => boolean = () => false,
  acceptsGrain: (target: T) => boolean = () => true,
  commodity: BreadGrainKind = 'ryeGrain',
): RoutedGrainDestination<T> | null {
  let best: RoutedGrainDestination<T> | null = null;
  for (const target of targets) {
    if (
      target.id === sourceId
      || target.constructionComplete === false
      || !(GRAIN_DISPATCH_TARGET_KINDS as readonly BuildingKind[]).includes(target.kind)
      || hasInboundSupply(target)
      || !acceptsGrain(target)
    ) continue;
    const capacity = (BUILDING_STORAGE_CAPS[target.kind] as { grain?: number }).grain ?? 0;
    const stock = target[commodity] ?? 0;
    if (breadGrainStock(target) + 1e-6 >= capacity) continue;

    const productivity = productivityFor(target);
    const duty = grainDispatchDuty(target, productivity, commodity);
    if (!duty) continue;
    const desiredStock = target.kind === 'granary'
      ? capacity
      : grainInputTarget(
          target.kind as GrainProcessorKind,
          productivity,
          target.processorOutputTargetPercent,
        );
    const runwayCycles = target.kind === 'granary'
      ? Infinity
      : grainInputRunwayCycles(target.kind as GrainProcessorKind, stock, productivity);
    const routeDistance = routeDistanceFor(target);
    if (routeDistance == null || !Number.isFinite(routeDistance)) continue;
    const candidate = {
      target,
      commodity,
      duty,
      desiredStock,
      runwayCycles,
      routeDistance,
      workPriority: normalizeStaffingPriority(target.constructionPriority),
    };
    if (best == null) {
      best = candidate;
      continue;
    }
    const rankDelta = GRAIN_DUTY_RANK[candidate.duty] - GRAIN_DUTY_RANK[best.duty];
    const priorityDelta = candidate.duty === 'working-buffer'
      && best.duty === 'working-buffer'
      ? best.workPriority - candidate.workPriority
      : 0;
    const runwayDelta = candidate.duty === 'working-buffer' && best.duty === 'working-buffer'
      ? candidate.runwayCycles - best.runwayCycles
      : 0;
    if (
      rankDelta < 0
      || (rankDelta === 0 && priorityDelta < 0)
      || (rankDelta === 0 && priorityDelta === 0 && runwayDelta < -1e-6)
      || (
        rankDelta === 0
        && priorityDelta === 0
        && Math.abs(runwayDelta) <= 1e-6
        && candidate.routeDistance + 1e-6 < best.routeDistance
      )
      || (
        rankDelta === 0
        && priorityDelta === 0
        && Math.abs(runwayDelta) <= 1e-6
        && Math.abs(candidate.routeDistance - best.routeDistance) <= 1e-6
        && compareStableEntityIds(candidate.target.id, best.target.id) < 0
      )
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Mirrors assigned granary-hauler dispatch. Only processors below their working buffer
 * are eligible; least cycle runway, route distance, and stable id decide.
 * Multiple granaries skip targets that already have
 * an inbound grain cart.
 */
export function selectGrainProcessorTarget<T extends GrainDestinationLike>(
  targets: Iterable<T>,
  sourceId: string,
  routeDistanceFor: (target: T) => number | null,
  productivityFor: (target: T) => number = () => 1,
  hasInboundSupply: (target: T) => boolean = () => false,
  acceptsGrain: (target: T) => boolean = () => true,
  commodity: BreadGrainKind = 'ryeGrain',
): RoutedGrainDestination<T> | null {
  let best: RoutedGrainDestination<T> | null = null;
  for (const target of targets) {
    if (
      target.id === sourceId
      || target.constructionComplete === false
      || !(GRAIN_PROCESSOR_KINDS as readonly BuildingKind[]).includes(target.kind)
      || (target.kind !== 'monastery' && target.assignedLabor <= 0)
      || hasInboundSupply(target)
      || !acceptsGrain(target)
      || (target.kind === 'monastery' && commodity !== 'oatGrain')
    ) continue;
    const kind = target.kind as GrainProcessorKind;
    const productivity = productivityFor(target);
    const desiredStock = grainInputTarget(
      kind,
      productivity,
      target.processorOutputTargetPercent,
    );
    const stock = target[commodity] ?? 0;
    if (desiredStock <= 1e-6 || stock + 1e-6 >= desiredStock) continue;
    const routeDistance = routeDistanceFor(target);
    if (routeDistance == null || !Number.isFinite(routeDistance)) continue;
    const candidate: RoutedGrainDestination<T> = {
      target,
      commodity,
      duty: 'working-buffer',
      desiredStock,
      runwayCycles: grainInputRunwayCycles(kind, stock, productivity),
      routeDistance,
      workPriority: normalizeStaffingPriority(target.constructionPriority),
    };
    if (
      best == null
      || candidate.workPriority > best.workPriority
      || (
        candidate.workPriority === best.workPriority
        && candidate.runwayCycles < best.runwayCycles - 1e-6
      )
      || (
        candidate.workPriority === best.workPriority
        &&
        Math.abs(candidate.runwayCycles - best.runwayCycles) <= 1e-6
        && candidate.routeDistance < best.routeDistance - 1e-6
      )
      || (
        candidate.workPriority === best.workPriority
        &&
        Math.abs(candidate.runwayCycles - best.runwayCycles) <= 1e-6
        && Math.abs(candidate.routeDistance - best.routeDistance) <= 1e-6
        && compareStableEntityIds(candidate.target.id, best.target.id) < 0
      )
    ) {
      best = candidate;
    }
  }
  return best;
}

export function formatGrainWorkingBuffer(
  stock: number,
  kind: GrainProcessorKind,
  productivity = 1,
  processorOutputTargetPercent: number | undefined = 100,
): string {
  const target = grainInputTarget(kind, productivity, processorOutputTargetPercent);
  return `${wholeResourceUnits(stock)} / ${Math.ceil(target)} · farmstead or granary supply`;
}
