import {
  BREWERY_BARLEY_PER_MALT_CYCLE,
  BREWERY_BREWING_FIREWOOD_PER_CYCLE,
  BREWERY_MALTING_FIREWOOD_PER_CYCLE,
  BUILDING_STORAGE_CAPS,
  CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  GRANARY_FIREWOOD_PER_CYCLE,
  GRANARY_FLOUR_PER_CYCLE,
  POTTER_CLAY_PER_CYCLE,
  POTTER_FIREWOOD_PER_CYCLE,
  SMITHY_IRON_PER_CYCLE,
  SMITHY_CHARCOAL_PER_CYCLE,
  SMOKEHOUSE_FIREWOOD_PER_CYCLE,
  SMOKEHOUSE_FOOD_PER_CYCLE,
  SMOKEHOUSE_POTTERY_PER_CYCLE,
  SMOKEHOUSE_SALT_PER_CYCLE,
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
  | 'firewood'
  | 'flour'
  | 'food'
  | 'wool'
  | 'flax'
  | 'ironwork'
  | 'iron'
  | 'clay'
  | 'salt'
  | 'charcoal'
  | 'pottery';
export type MarketplaceMaterialInputCommodity = 'iron' | 'salt' | 'pottery';
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
  | 'firewood'
  | 'ironwork'
  | 'iron'
  | 'clay'
  | 'salt'
  | 'charcoal'
  | 'pottery'
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
  firewood: [
    'granary',
    'brewery',
    'smokehouse',
    'charcoal_burner',
    'potter_kiln',
  ],
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
  iron: ['smithy'],
  clay: ['potter_kiln'],
  salt: ['smokehouse'],
  charcoal: ['smithy'],
  pottery: ['smokehouse', 'marketplace'],
};

export function directlyDispatchedProcessorInputPerCycle(
  targetKind: BuildingKind,
  commodity: DirectProcessorInputCommodity,
): number {
  if (!TARGET_KINDS[commodity].includes(targetKind)) return 0;
  switch (commodity) {
    case 'barley':
      return BREWERY_BARLEY_PER_MALT_CYCLE;
    case 'firewood':
      switch (targetKind) {
        case 'granary':
          return GRANARY_FIREWOOD_PER_CYCLE;
        case 'brewery':
          return BREWERY_MALTING_FIREWOOD_PER_CYCLE
            + BREWERY_BREWING_FIREWOOD_PER_CYCLE;
        case 'smokehouse':
          return SMOKEHOUSE_FIREWOOD_PER_CYCLE;
        case 'charcoal_burner':
          return CHARCOAL_BURNER_FIREWOOD_PER_CYCLE;
        case 'potter_kiln':
          return POTTER_FIREWOOD_PER_CYCLE;
        default:
          return 0;
      }
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
    case 'iron':
      return SMITHY_IRON_PER_CYCLE;
    case 'clay':
      return POTTER_CLAY_PER_CYCLE;
    case 'salt':
      return SMOKEHOUSE_SALT_PER_CYCLE;
    case 'charcoal':
      return SMITHY_CHARCOAL_PER_CYCLE;
    case 'pottery':
      return targetKind === 'smokehouse'
        ? SMOKEHOUSE_POTTERY_PER_CYCLE
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
 * Mirrors every source-side processor-input cart. Active processors receive
 * their selected stock-policy working buffers by work priority. Equal-tier
 * looms then route matching fibres to their selected specialization before
 * lowest runway and route; staffed extractive worksites use the same ordering
 * for replacement iron tools. Imported iron and salt stop at their working
 * buffers; pottery reaches staffed smokehouses before becoming market export
 * stock. Other inputs resume nearest storage overflow once buffers are covered.
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
  const marketplaceMaterial = commodity === 'iron' || commodity === 'salt';
  for (const target of targets) {
    if (
      target.id === sourceId
      || !TARGET_KINDS[commodity].includes(target.kind)
      || target.constructionComplete === false
      || ((commodity === 'firewood' || marketplaceMaterial) && target.assignedLabor <= 0)
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
    if (marketplaceMaterial && duty !== 'working-buffer') continue;
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

export type RoutedMarketplaceMaterialDestination<
  T extends ProcessorInputDestinationLike,
> = RoutedProcessorInputDestination<T> & {
  commodity: MarketplaceMaterialInputCommodity;
};

type MarketplaceMaterialSourceLike = Pick<
  BuildingState,
  'id' | 'iron' | 'salt' | 'pottery'
>;

export type RoutedMarketplaceMaterialAssignment<
  S extends MarketplaceMaterialSourceLike,
  T extends ProcessorInputDestinationLike,
> = RoutedMarketplaceMaterialDestination<T> & {
  source: S;
};

/**
 * One marketplace cart chooses between imported iron, salt, and uncommitted
 * pottery returned from export stock. This mirrors the authoritative
 * source-side pass, so a later-built urgent workshop can beat an older target
 * instead of losing to update order.
 */
export function selectMarketplaceMaterialInputTarget<
  T extends ProcessorInputDestinationLike,
>(
  targets: Iterable<T>,
  source: Pick<BuildingState, 'id' | 'iron' | 'salt' | 'pottery'>,
  routeDistanceFor: (target: T) => number | null,
  hasInboundSupply: (target: T) => boolean = () => false,
  acceptsInput: (
    target: T,
    commodity: MarketplaceMaterialInputCommodity,
  ) => boolean = () => true,
  isSourceCommodityReserved: (
    commodity: MarketplaceMaterialInputCommodity,
  ) => boolean = () => false,
): RoutedMarketplaceMaterialDestination<T> | null {
  let best: RoutedMarketplaceMaterialDestination<T> | null = null;
  const materialTargets = [...targets];
  const routeDistanceByTargetId = new Map<string, number | null>();
  const cachedRouteDistanceFor = (target: T): number | null => {
    if (routeDistanceByTargetId.has(target.id)) {
      return routeDistanceByTargetId.get(target.id) ?? null;
    }
    const distance = routeDistanceFor(target);
    routeDistanceByTargetId.set(target.id, distance);
    return distance;
  };
  for (const commodity of ['iron', 'salt', 'pottery'] as const) {
    if (
      isSourceCommodityReserved(commodity)
      || Math.max(0, source[commodity] ?? 0) <= 1e-6
    ) {
      continue;
    }
    const candidate = selectDirectProcessorInputTarget(
      materialTargets,
      source.id,
      commodity,
      cachedRouteDistanceFor,
      hasInboundSupply,
      (target) => acceptsInput(target, commodity),
    );
    if (
      candidate
      && candidate.duty === 'working-buffer'
      && (best == null || processorInputCandidatePrecedes(candidate, best))
    ) {
      best = { ...candidate, commodity };
    }
  }
  return best;
}

/**
 * Match every free marketplace cart across the settlement in one pass.
 * Workshop urgency remains authoritative; among equal needs the shortest
 * source-to-target road wins, so an older remote market cannot reserve work
 * that a newer nearby market could serve more efficiently.
 */
export function assignMarketplaceMaterialInputTargets<
  S extends MarketplaceMaterialSourceLike,
  T extends ProcessorInputDestinationLike,
>(
  sources: Iterable<S>,
  targets: Iterable<T>,
  routeDistanceFor: (source: S, target: T) => number | null,
  sourceIsAvailable: (source: S) => boolean = () => true,
  hasInboundSupply: (target: T) => boolean = () => false,
  acceptsInput: (
    target: T,
    commodity: MarketplaceMaterialInputCommodity,
  ) => boolean = () => true,
  isSourceCommodityReserved: (
    source: S,
    commodity: MarketplaceMaterialInputCommodity,
  ) => boolean = () => false,
): Map<string, RoutedMarketplaceMaterialAssignment<S, T>> {
  const materialTargets = [...targets];
  const candidates: RoutedMarketplaceMaterialAssignment<S, T>[] = [];
  const routeDistanceBySource = new Map<string, Map<string, number | null>>();
  const cachedRouteDistanceFor = (source: S, target: T): number | null => {
    let sourceRoutes = routeDistanceBySource.get(source.id);
    if (sourceRoutes == null) {
      sourceRoutes = new Map();
      routeDistanceBySource.set(source.id, sourceRoutes);
    }
    if (sourceRoutes.has(target.id)) {
      return sourceRoutes.get(target.id) ?? null;
    }
    const distance = routeDistanceFor(source, target);
    sourceRoutes.set(target.id, distance);
    return distance;
  };

  for (const source of sources) {
    if (!sourceIsAvailable(source)) continue;
    for (const commodity of ['iron', 'salt', 'pottery'] as const) {
      if (
        isSourceCommodityReserved(source, commodity)
        || Math.max(0, source[commodity] ?? 0) <= 1e-6
      ) {
        continue;
      }
      for (const target of materialTargets) {
        const candidate = selectDirectProcessorInputTarget(
          [target],
          source.id,
          commodity,
          (destination) => cachedRouteDistanceFor(source, destination),
          hasInboundSupply,
          (destination) => acceptsInput(destination, commodity),
        );
        if (candidate?.duty !== 'working-buffer') continue;
        candidates.push({ ...candidate, source, commodity });
      }
    }
  }

  candidates.sort((left, right) => {
    const policyOrder = compareProcessorInputCandidates(left, right);
    if (policyOrder !== 0) return policyOrder;
    const commodityOrder = marketplaceMaterialCommodityRank(left.commodity)
      - marketplaceMaterialCommodityRank(right.commodity);
    if (commodityOrder !== 0) return commodityOrder;
    return compareStableEntityIds(left.source.id, right.source.id);
  });

  const assignments = new Map<
    string,
    RoutedMarketplaceMaterialAssignment<S, T>
  >();
  const usedTargets = new Set<string>();
  for (const candidate of candidates) {
    if (
      assignments.has(candidate.source.id)
      || usedTargets.has(candidate.target.id)
    ) {
      continue;
    }
    assignments.set(candidate.source.id, candidate);
    usedTargets.add(candidate.target.id);
  }
  return assignments;
}

function processorInputCandidatePrecedes<T extends ProcessorInputDestinationLike>(
  candidate: RoutedProcessorInputDestination<T>,
  selected: RoutedProcessorInputDestination<T>,
): boolean {
  return compareProcessorInputCandidates(candidate, selected) < 0;
}

function compareProcessorInputCandidates<T extends ProcessorInputDestinationLike>(
  candidate: RoutedProcessorInputDestination<T>,
  selected: RoutedProcessorInputDestination<T>,
): number {
  if (candidate.duty !== selected.duty) {
    return candidate.duty === 'working-buffer' ? -1 : 1;
  }
  if (candidate.duty === 'working-buffer') {
    if (candidate.workPriority !== selected.workPriority) {
      return selected.workPriority - candidate.workPriority;
    }
    if (candidate.inputPreferenceRank !== selected.inputPreferenceRank) {
      return candidate.inputPreferenceRank - selected.inputPreferenceRank;
    }
    if (Math.abs(candidate.runwayCycles - selected.runwayCycles) > 1e-6) {
      return candidate.runwayCycles - selected.runwayCycles;
    }
  }
  if (Math.abs(candidate.routeDistance - selected.routeDistance) > 1e-6) {
    return candidate.routeDistance - selected.routeDistance;
  }
  return compareStableEntityIds(candidate.target.id, selected.target.id);
}

function marketplaceMaterialCommodityRank(
  commodity: MarketplaceMaterialInputCommodity,
): number {
  switch (commodity) {
    case 'iron': return 0;
    case 'salt': return 1;
    case 'pottery': return 2;
  }
}
