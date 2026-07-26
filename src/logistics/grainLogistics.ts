import {
  BREWERY_GRAIN_PER_CYCLE,
  BUILDING_STORAGE_CAPS,
  MONASTERY_GRAIN_PER_CYCLE,
  WATERMILL_GRAIN_PER_CYCLE,
} from '../generated/gameBalance.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import { compareStableEntityIds } from './roadLogistics.ts';

export const GRAIN_DISPATCH_SOURCE_KINDS = ['threshing_barn', 'granary'] as const;
export const GRAIN_PROCESSOR_KINDS = ['watermill', 'brewery', 'monastery'] as const;
export const GRAIN_DISPATCH_TARGET_KINDS = [
  'watermill',
  'brewery',
  'granary',
  'monastery',
] as const;
export const GRAIN_INPUT_BUFFER_CYCLES = 3;
export const GRAIN_CRITICAL_RUNWAY_CYCLES = 1;

export type GrainProcessorKind = Extract<
  BuildingKind,
  'watermill' | 'brewery' | 'monastery'
>;
export type GrainDispatchDuty =
  | 'working-buffer'
  | 'granary-reserve'
  | 'workshop-overflow';

type GrainDestinationLike = Pick<
  BuildingState,
  'id' | 'kind' | 'grain' | 'assignedLabor' | 'constructionComplete'
>;

export type RoutedGrainDestination<T extends GrainDestinationLike> = {
  target: T;
  duty: GrainDispatchDuty;
  desiredStock: number;
  runwayCycles: number;
  routeDistance: number;
};

/** Mirrors the authoritative three-cycle working stock requested by processors. */
export function grainInputTarget(
  kind: GrainProcessorKind,
  productivity = 1,
): number {
  const perCycle = kind === 'watermill'
    ? WATERMILL_GRAIN_PER_CYCLE
    : kind === 'brewery'
      ? BREWERY_GRAIN_PER_CYCLE
      : MONASTERY_GRAIN_PER_CYCLE * Math.max(0, productivity);
  return perCycle * GRAIN_INPUT_BUFFER_CYCLES;
}

export function grainInputRunwayCycles(
  kind: GrainProcessorKind,
  stock: number,
  productivity = 1,
): number {
  const target = grainInputTarget(kind, productivity);
  return target <= 1e-6
    ? Infinity
    : Math.max(0, stock) * GRAIN_INPUT_BUFFER_CYCLES / target;
}

export function grainDispatchDuty(
  target: GrainDestinationLike,
  productivity = 1,
): GrainDispatchDuty | null {
  if (target.kind === 'granary') return 'granary-reserve';
  if (!(GRAIN_PROCESSOR_KINDS as readonly BuildingKind[]).includes(target.kind)) return null;
  const desiredStock = grainInputTarget(target.kind as GrainProcessorKind, productivity);
  const operational = target.kind === 'monastery' || target.assignedLabor > 0;
  return operational && target.grain + 1e-6 < desiredStock
    ? 'working-buffer'
    : 'workshop-overflow';
}

const GRAIN_DUTY_RANK: Record<GrainDispatchDuty, number> = {
  'working-buffer': 0,
  'granary-reserve': 1,
  'workshop-overflow': 2,
};

/**
 * Mirrors farmstead dispatch: lowest processor runway, then central reserve,
 * with full workshop warehouses used only when no granary has room.
 */
export function selectGrainDispatchTarget<T extends GrainDestinationLike>(
  targets: Iterable<T>,
  sourceId: string,
  routeDistanceFor: (target: T) => number | null,
  productivityFor: (target: T) => number = () => 1,
  hasInboundSupply: (target: T) => boolean = () => false,
  acceptsGrain: (target: T) => boolean = () => true,
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
    if (target.grain + 1e-6 >= capacity) continue;

    const productivity = productivityFor(target);
    const duty = grainDispatchDuty(target, productivity);
    if (!duty) continue;
    const desiredStock = target.kind === 'granary'
      ? capacity
      : grainInputTarget(target.kind as GrainProcessorKind, productivity);
    const runwayCycles = target.kind === 'granary'
      ? Infinity
      : grainInputRunwayCycles(target.kind as GrainProcessorKind, target.grain, productivity);
    const routeDistance = routeDistanceFor(target);
    if (routeDistance == null || !Number.isFinite(routeDistance)) continue;
    const candidate = { target, duty, desiredStock, runwayCycles, routeDistance };
    if (best == null) {
      best = candidate;
      continue;
    }
    const rankDelta = GRAIN_DUTY_RANK[candidate.duty] - GRAIN_DUTY_RANK[best.duty];
    const runwayDelta = candidate.duty === 'working-buffer' && best.duty === 'working-buffer'
      ? candidate.runwayCycles - best.runwayCycles
      : 0;
    if (
      rankDelta < 0
      || (rankDelta === 0 && runwayDelta < -1e-6)
      || (
        rankDelta === 0
        && Math.abs(runwayDelta) <= 1e-6
        && candidate.routeDistance + 1e-6 < best.routeDistance
      )
      || (
        rankDelta === 0
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
 * Mirrors staffed granary dispatch. Only processors below their working buffer
 * are eligible; the least cycle runway wins before route distance and stable
 * id. Multiple granaries skip targets that already have an inbound grain cart.
 */
export function selectGrainProcessorTarget<T extends GrainDestinationLike>(
  targets: Iterable<T>,
  sourceId: string,
  routeDistanceFor: (target: T) => number | null,
  productivityFor: (target: T) => number = () => 1,
  hasInboundSupply: (target: T) => boolean = () => false,
  acceptsGrain: (target: T) => boolean = () => true,
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
    ) continue;
    const kind = target.kind as GrainProcessorKind;
    const productivity = productivityFor(target);
    const desiredStock = grainInputTarget(kind, productivity);
    if (desiredStock <= 1e-6 || target.grain + 1e-6 >= desiredStock) continue;
    const routeDistance = routeDistanceFor(target);
    if (routeDistance == null || !Number.isFinite(routeDistance)) continue;
    const candidate: RoutedGrainDestination<T> = {
      target,
      duty: 'working-buffer',
      desiredStock,
      runwayCycles: grainInputRunwayCycles(kind, target.grain, productivity),
      routeDistance,
    };
    if (
      best == null
      || candidate.runwayCycles < best.runwayCycles - 1e-6
      || (
        Math.abs(candidate.runwayCycles - best.runwayCycles) <= 1e-6
        && candidate.routeDistance < best.routeDistance - 1e-6
      )
      || (
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
): string {
  const target = grainInputTarget(kind, productivity);
  return `${stock.toFixed(1)} / ${target.toFixed(1)} · farmstead or granary supply`;
}
