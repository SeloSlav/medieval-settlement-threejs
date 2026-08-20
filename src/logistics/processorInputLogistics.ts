import {
  BREWERY_BARLEY_PER_MALT_CYCLE,
  BREWERY_BREWING_FIREWOOD_PER_CYCLE,
  BREWERY_MALTING_FIREWOOD_PER_CYCLE,
  BUILDING_STORAGE_CAPS,
  CHARCOAL_BURNER_FIREWOOD_PER_CYCLE,
  CIVILIAN_TOOL_IRONWORK_PER_CYCLE,
  BAKERY_FIREWOOD_PER_CYCLE,
  BAKERY_FLOUR_PER_CYCLE,
  LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE,
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
import {
  civilianToolRefillDue,
  isCivilianToolSite,
} from '../economy/civilianToolPolicy.ts';
import { smithyCharcoalRefillTarget } from '../economy/fuelReservePolicy.ts';
import {
  normalizeStaffingPriority,
  type StaffingPriority,
} from '../economy/staffingPriority.ts';
import {
  normalizeMarketplaceIronTarget,
  normalizeMarketplaceSaltTarget,
} from '../economy/marketplaceMaterialProcurementPolicy.ts';
import { processorInputStagingCycles } from '../economy/processorOutputPolicy.ts';
import { weaverFibreDeliveryPreferenceRank } from '../economy/weaverInputPolicy.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import { compareStableEntityIds } from './roadLogistics.ts';
import {
  preservableFoodStock,
  preservedFoodStock,
  type FoodInventoryLike,
} from '../economy/foodInventory.ts';

export const PROCESSOR_INPUT_BUFFER_CYCLES = 3;

export type DirectProcessorInputCommodity =
  | 'barley'
  | 'firewood'
  | 'ryeFlour'
  | 'oatFlour'
  | 'maslinFlour'
  | 'food'
  | 'preservedFood'
  | 'wool'
  | 'flax'
  | 'ironwork'
  | 'iron'
  | 'clay'
  | 'salt'
  | 'charcoal'
  | 'pottery';
export type MarketplaceMaterialInputCommodity = 'iron' | 'salt' | 'pottery';
export type ProcessorInputDispatchDuty =
  | 'working-buffer'
  | 'central-storage'
  | 'workshop-overflow';

type ProcessorInputDestinationLike = Pick<
  BuildingState,
  | 'id'
  | 'kind'
  | 'assignedLabor'
  | 'constructionComplete'
  | 'constructionPriority'
  | 'processorOutputTargetPercent'
  | 'marketplaceIronTarget'
  | 'marketplaceSaltTarget'
  | 'granaryAcceptsFreshFood'
  | 'weaverInputPolicy'
  | 'ryeFlour'
  | 'oatFlour'
  | 'maslinFlour'
  | 'food'
  | 'preservedFood'
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
> & FoodInventoryLike;

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
    'bakery',
    'brewery',
    'smokehouse',
    'charcoal_burner',
    'potter_kiln',
  ],
  ryeFlour: ['bakery', 'granary'],
  oatFlour: ['bakery', 'granary'],
  maslinFlour: ['bakery', 'granary'],
  food: ['smokehouse'],
  preservedFood: ['granary'],
  wool: ['weaver'],
  flax: ['weaver', 'granary'],
  ironwork: [
    'lumber_mill',
    'woodcutters_lodge',
    'stone_quarry',
    'large_quarry',
    'mine',
    'clay_pit',
    'threshing_barn',
    'watermill',
    'windmill',
    'carpenter',
  ],
  iron: ['smithy', 'trading_post'],
  clay: ['potter_kiln'],
  salt: ['smokehouse', 'pastoral_farmstead', 'trading_post'],
  charcoal: ['smithy'],
  pottery: ['smokehouse', 'village_storehouse', 'trading_post'],
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
        case 'bakery':
          return BAKERY_FIREWOOD_PER_CYCLE;
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
    case 'ryeFlour':
    case 'oatFlour':
    case 'maslinFlour':
      return targetKind === 'bakery' ? BAKERY_FLOUR_PER_CYCLE : 0;
    case 'food':
      return SMOKEHOUSE_FOOD_PER_CYCLE;
    case 'preservedFood':
      return 0;
    case 'wool':
      return WEAVER_WOOL_PER_CYCLE;
    case 'flax':
      return WEAVER_FLAX_PER_CYCLE;
    case 'ironwork':
      return isCivilianToolSite(targetKind)
        ? CIVILIAN_TOOL_IRONWORK_PER_CYCLE
        : 0;
    case 'iron':
      return targetKind === 'smithy' ? SMITHY_IRON_PER_CYCLE : 0;
    case 'clay':
      return POTTER_CLAY_PER_CYCLE;
    case 'salt':
      return targetKind === 'pastoral_farmstead'
        ? LIVESTOCK_FARMSTEAD_SALT_STAGING_PER_CYCLE
        : targetKind === 'smokehouse'
          ? SMOKEHOUSE_SALT_PER_CYCLE
          : 0;
    case 'charcoal':
      return targetKind === 'smithy' ? SMITHY_CHARCOAL_PER_CYCLE : 0;
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
 * their selected stock-policy working buffers by lowest runway. Looms route
 * matching fibres to their selected specialization before
 * lowest runway and route; staffed heavy-tool worksites use the same ordering
 * for replacement iron tools. Imported raw iron and salt stop at processor
 * working buffers. Local mine carts do the same first, then may centralize
 * surplus up to a staffed Trading Post's selected reserve, where imports cover
 * only any remaining gap;
 * after the kiln's household-ware duty, pottery reaches staffed smokehouses
 * before becoming market export stock. Preserved food is a
 * storage-only overflow route to the nearest granary that accepts perishable
 * surplus, never a processor input.
 * Flour centralizes at a staffed granary once bakery working buffers are
 * covered; bakery warehouse overflow remains available only as a last resort.
 * Other inputs resume nearest storage overflow once buffers are covered.
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
      || (target.kind === 'granary' && target.assignedLabor <= 0)
      || ((commodity === 'firewood' || commodity === 'charcoal' || marketplaceMaterial)
        && target.assignedLabor <= 0)
      || hasInboundSupply(target)
      || !acceptsInput(target)
      || (
        commodity === 'preservedFood'
        && target.kind === 'granary'
        && target.granaryAcceptsFreshFood === false
      )
    ) {
      continue;
    }
    const stock = processorInputCommodityStock(target, commodity);
    const capacityKey = commodity === 'ryeFlour' || commodity === 'oatFlour' || commodity === 'maslinFlour'
      ? 'flour'
      : commodity;
    const capacity = (BUILDING_STORAGE_CAPS[target.kind] as Record<string, number | undefined>)[
      capacityKey
    ] ?? 0;
    if (stock + 1e-6 >= capacity) continue;
    const routeDistance = routeDistanceFor(target);
    if (routeDistance == null || !Number.isFinite(routeDistance)) continue;

    const marketplaceReserveTarget = target.kind === 'trading_post'
      ? commodity === 'iron'
        ? normalizeMarketplaceIronTarget(target.marketplaceIronTarget)
        : commodity === 'salt'
          ? normalizeMarketplaceSaltTarget(target.marketplaceSaltTarget)
          : null
      : null;
    const perCycle = directlyDispatchedProcessorInputPerCycle(target.kind, commodity);
    let workingTarget = processorInputTarget(
      perCycle,
      target.processorOutputTargetPercent,
    );
    const smithyCharcoalTarget = commodity === 'charcoal' && target.kind === 'smithy'
      ? smithyCharcoalRefillTarget(stock)
      : null;
    if (commodity === 'charcoal' && target.kind === 'smithy') {
      if (smithyCharcoalTarget == null) continue;
      workingTarget = Math.min(capacity, smithyCharcoalTarget);
    }
    const toolRack = commodity === 'ironwork' && isCivilianToolSite(target.kind);
    if (toolRack && !civilianToolRefillDue(stock, capacity)) continue;
    const centralFlourStorage = (
      commodity === 'ryeFlour'
      || commodity === 'oatFlour'
      || commodity === 'maslinFlour'
    ) && target.kind === 'granary';
    const duty: ProcessorInputDispatchDuty = toolRack
      ? target.assignedLabor > 0
        ? 'working-buffer'
        : 'workshop-overflow'
      : centralFlourStorage
        ? 'central-storage'
      : target.assignedLabor > 0 && stock + 1e-6 < workingTarget
        ? 'working-buffer'
        : 'workshop-overflow';
    if (
      marketplaceMaterial
      && (
        duty !== 'working-buffer'
        && (
          marketplaceReserveTarget == null
          || marketplaceReserveTarget <= 0
          || stock + 1e-6 >= marketplaceReserveTarget
        )
      )
    ) {
      continue;
    }
    const desiredStock = toolRack
      ? capacity
      : marketplaceReserveTarget != null
      ? Math.min(capacity, marketplaceReserveTarget)
      : duty === 'working-buffer'
        ? workingTarget
        : capacity;
    if (stock + 1e-6 >= desiredStock) continue;
    const candidate: RoutedProcessorInputDestination<T> = {
      target,
      duty,
      desiredStock,
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

export function processorInputCommodityStock(
  inventory: FoodInventoryLike & Partial<Record<DirectProcessorInputCommodity, number>>,
  commodity: DirectProcessorInputCommodity,
): number {
  if (commodity === 'food') return preservableFoodStock(inventory);
  if (commodity === 'preservedFood') return preservedFoodStock(inventory);
  if (commodity === 'ryeFlour' || commodity === 'oatFlour' || commodity === 'maslinFlour') {
    return Math.max(0, Number(inventory[commodity] ?? 0));
  }
  return Math.max(0, Number(inventory[commodity] ?? 0));
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

export const LOCAL_MATERIAL_SOURCE_KINDS = [
  'mine',
  'clay_pit',
  'charcoal_burner',
  'smithy',
  'potter_kiln',
  'village_storehouse',
] as const satisfies readonly BuildingKind[];

export type LocalMaterialInputCommodity =
  | 'iron'
  | 'salt'
  | 'clay'
  | 'charcoal'
  | 'ironwork'
  | 'pottery';

export type RoutedDirectProcessorInputAssignment<
  S extends { id: string },
  T extends ProcessorInputDestinationLike,
  C extends DirectProcessorInputCommodity,
> = RoutedProcessorInputDestination<T> & {
  source: S;
  commodity: C;
};

type LocalMaterialSourceLike = Pick<
  BuildingState,
  | 'iron'
  | 'salt'
  | 'clay'
  | 'charcoal'
  | 'ironwork'
  | 'pottery'
  | 'storehouseAcceptsIron'
  | 'storehouseAcceptsClay'
  | 'storehouseAcceptsSalt'
>;

export function localMaterialInputCommodities(
  kind: BuildingKind,
  source?: Partial<LocalMaterialSourceLike>,
): readonly LocalMaterialInputCommodity[] {
  switch (kind) {
    case 'stone_quarry':
    case 'large_quarry':
      return (['iron', 'salt', 'clay'] as const)
        .filter((commodity) => (source?.[commodity] ?? 0) > 1e-6);
    case 'mine':
      return (['iron', 'salt'] as const)
        .filter((commodity) => (source?.[commodity] ?? 0) > 1e-6);
    case 'clay_pit': return ['clay'];
    case 'charcoal_burner': return ['charcoal'];
    case 'smithy': return ['ironwork'];
    case 'potter_kiln': return ['pottery'];
    case 'village_storehouse':
      return [
        ...((source?.charcoal ?? 0) > 1e-6 ? ['charcoal'] as const : []),
        ...((['iron', 'clay', 'salt'] as const)
          .filter((commodity) =>
            (source?.[commodity] ?? 0) > 1e-6
            && source?.[storehouseAcceptsField(commodity)] !== false
          )),
      ];
    default: return [];
  }
}

/** Legacy single-offer accessor retained for inspector and test compatibility. */
export function localMaterialInputCommodity(
  kind: BuildingKind,
  source?: Partial<LocalMaterialSourceLike>,
): LocalMaterialInputCommodity | null {
  return localMaterialInputCommodities(kind, source)[0] ?? null;
}

/**
 * One Trading Post cart chooses between imported iron, salt, and uncommitted
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
 * Match every free Trading Post cart across the settlement in one pass.
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
  const offers: ProcessorInputOffer<S, MarketplaceMaterialInputCommodity>[] = [];
  for (const source of sources) {
    if (!sourceIsAvailable(source)) continue;
    for (const commodity of ['iron', 'salt', 'pottery'] as const) {
      if (
        isSourceCommodityReserved(source, commodity)
        || Math.max(0, source[commodity] ?? 0) <= 1e-6
      ) {
        continue;
      }
      offers.push({ source, commodity });
    }
  }
  return assignProcessorInputOffers(
    offers,
    targets,
    routeDistanceFor,
    hasInboundSupply,
    acceptsInput,
    true,
  );
}

/**
 * Match local or imported raw iron, salt, clay, charcoal, ironwork, and pottery
 * in one pass.
 * The same processor policy still decides urgency, but equal candidates now
 * choose the shortest source route across every producer cart.
 */
export function assignLocalMaterialInputTargets<
  S extends ProcessorInputDestinationLike,
  T extends ProcessorInputDestinationLike,
>(
  sources: Iterable<S>,
  targets: Iterable<T>,
  routeDistanceFor: (source: S, target: T) => number | null,
  sourceIsAvailable: (source: S) => boolean = () => true,
  hasInboundSupply: (target: T) => boolean = () => false,
  acceptsInput: (
    target: T,
    commodity: LocalMaterialInputCommodity,
  ) => boolean = () => true,
): Map<string, RoutedDirectProcessorInputAssignment<S, T, LocalMaterialInputCommodity>> {
  const offers: ProcessorInputOffer<S, LocalMaterialInputCommodity>[] = [];
  for (const source of sources) {
    if (!sourceIsAvailable(source)) continue;
    for (const commodity of localMaterialInputCommodities(source.kind, source)) {
      if (Math.max(0, Number(source[commodity] ?? 0)) <= 1e-6) continue;
      offers.push({ source, commodity });
    }
  }
  return assignProcessorInputOffers(
    offers,
    targets,
    routeDistanceFor,
    hasInboundSupply,
    acceptsInput,
    false,
  );
}

function storehouseAcceptsField(
  commodity: 'iron' | 'clay' | 'salt',
): 'storehouseAcceptsIron' | 'storehouseAcceptsClay' | 'storehouseAcceptsSalt' {
  switch (commodity) {
    case 'iron': return 'storehouseAcceptsIron';
    case 'clay': return 'storehouseAcceptsClay';
    case 'salt': return 'storehouseAcceptsSalt';
  }
}

type ProcessorInputOffer<
  S extends { id: string },
  C extends DirectProcessorInputCommodity,
> = {
  source: S;
  commodity: C;
};

function assignProcessorInputOffers<
  S extends { id: string },
  T extends ProcessorInputDestinationLike,
  C extends DirectProcessorInputCommodity,
>(
  offers: Iterable<ProcessorInputOffer<S, C>>,
  targets: Iterable<T>,
  routeDistanceFor: (source: S, target: T) => number | null,
  hasInboundSupply: (target: T) => boolean,
  acceptsInput: (target: T, commodity: C) => boolean,
  workingBuffersOnly: boolean,
): Map<string, RoutedDirectProcessorInputAssignment<S, T, C>> {
  const materialTargets = [...targets];
  const candidates: RoutedDirectProcessorInputAssignment<S, T, C>[] = [];
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

  for (const { source, commodity } of offers) {
    for (const target of materialTargets) {
      const candidate = selectDirectProcessorInputTarget(
        [target],
        source.id,
        commodity,
        (destination) => cachedRouteDistanceFor(source, destination),
        hasInboundSupply,
        (destination) => acceptsInput(destination, commodity),
      );
      if (
        candidate == null
        || (workingBuffersOnly && candidate.duty !== 'working-buffer')
      ) {
        continue;
      }
      candidates.push({ ...candidate, source, commodity });
    }
  }

  candidates.sort((left, right) => {
    const policyOrder = compareProcessorInputCandidates(left, right);
    if (policyOrder !== 0) return policyOrder;
    const commodityOrder = directMaterialCommodityRank(left.commodity)
      - directMaterialCommodityRank(right.commodity);
    if (commodityOrder !== 0) return commodityOrder;
    return compareStableEntityIds(left.source.id, right.source.id);
  });

  const assignments = new Map<
    string,
    RoutedDirectProcessorInputAssignment<S, T, C>
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
    return processorInputDutyRank(candidate.duty) - processorInputDutyRank(selected.duty);
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

function processorInputDutyRank(duty: ProcessorInputDispatchDuty): number {
  switch (duty) {
    case 'working-buffer': return 0;
    case 'central-storage': return 1;
    case 'workshop-overflow': return 2;
  }
}

function directMaterialCommodityRank(
  commodity: DirectProcessorInputCommodity,
): number {
  switch (commodity) {
    case 'iron': return 0;
    case 'salt': return 1;
    case 'pottery': return 2;
    case 'clay': return 3;
    case 'charcoal': return 4;
    case 'ironwork': return 5;
    case 'barley': return 6;
    case 'firewood': return 7;
    case 'ryeFlour': return 8;
    case 'oatFlour': return 9;
    case 'maslinFlour': return 10;
    case 'food': return 11;
    case 'preservedFood': return 12;
    case 'wool': return 13;
    case 'flax': return 14;
  }
}
