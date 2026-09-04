import type { BuildingState } from '../resources/types.ts';
import type { ResidenceNeedKind } from '../residences/residenceNeedState.ts';
import {
  MARKETPLACE_FOOD_STALL_SLOTS,
  MARKETPLACE_GOODS_STALL_SLOTS,
} from '../generated/gameBalance.ts';
import {
  FRESH_FOOD_KINDS,
  SAVORY_PRESERVE_KINDS,
  freshFoodStock,
  savoryPreservesStock,
  type FoodInventoryKind,
} from './foodInventory.ts';
import { combinedFuelEquivalent } from './fuelReservePolicy.ts';

export const MARKET_FOOD_STALL_NEEDS = [
  'food',
  'savoryPreserves',
  'luxury',
] as const satisfies readonly ResidenceNeedKind[];

export const MARKET_GOODS_STALL_NEEDS = [
  'firewood',
  'cloth',
  'shoes',
  'pottery',
] as const satisfies readonly ResidenceNeedKind[];

export type MarketStallNeed =
  | (typeof MARKET_FOOD_STALL_NEEDS)[number]
  | (typeof MARKET_GOODS_STALL_NEEDS)[number];

export type MarketStallGroup = 'food' | 'goods';

export type MarketStallCommodityKind =
  | FoodInventoryKind
  | 'firewood'
  | 'charcoal'
  | 'cloth'
  | 'shoes'
  | 'pottery'
  | 'candles'
  | 'wine';

/**
 * A deliberately small visual kit. Closely related commodities share a prop
 * module while `commodityKind` below preserves the exact stock identity.
 */
export type MarketStallDisplayKind =
  | 'provisions'
  | 'bread'
  | 'meat'
  | 'fish'
  | 'foraged'
  | 'milk'
  | 'fruit'
  | 'vegetables'
  | 'eggs'
  | 'honey'
  | 'wine'
  | 'preserves'
  | 'curedMeat'
  | 'smokedFish'
  | 'cheese'
  | 'firewood'
  | 'charcoal'
  | 'cloth'
  | 'shoes'
  | 'pottery'
  | 'candles';

export type MarketStallRepresentative = {
  commodityKind: MarketStallCommodityKind;
  displayKind: MarketStallDisplayKind;
};

export type MarketStallAssignment = {
  marketplaceId: string;
  workplaceId: string;
  workplaceKind: 'granary' | 'village_storehouse';
  group: MarketStallGroup;
  needKind: MarketStallNeed;
};

export type MarketStallWorkerAssignment = Omit<
  MarketStallAssignment,
  'needKind'
> & {
  needKind: MarketStallNeed | null;
};

export type MarketplaceStallRoster = {
  stalls: MarketStallAssignment[];
  workers: MarketStallWorkerAssignment[];
};

export type IndexedMarketStallWorkerAssignment = MarketStallWorkerAssignment & {
  marketplaceSlotIndex: number;
  workplaceSlotIndex: number;
};

type StallCandidate = MarketStallAssignment & {
  distance: number;
  sourceHasStock: boolean;
};

export type MarketStallRoadDistance = (
  ax: number,
  az: number,
  bx: number,
  bz: number,
) => number | null;

const MARKET_STALL_LABELS: Readonly<Record<MarketStallNeed, string>> = {
  food: 'Fresh food',
  savoryPreserves: 'Savory preserves',
  luxury: 'Luxury provisions',
  firewood: 'Fuel',
  cloth: 'Clothing',
  shoes: 'Shoes',
  pottery: 'Household wares',
};

export function marketStallLabel(needKind: MarketStallNeed): string {
  return MARKET_STALL_LABELS[needKind];
}

const MARKET_STALL_COMMODITIES_BY_NEED: Readonly<
  Record<MarketStallNeed, readonly MarketStallCommodityKind[]>
> = {
  food: [...FRESH_FOOD_KINDS, 'honey'],
  savoryPreserves: SAVORY_PRESERVE_KINDS,
  luxury: ['wine', 'honey'],
  firewood: ['firewood', 'charcoal'],
  cloth: ['cloth'],
  shoes: ['shoes'],
  pottery: ['pottery', 'candles'],
};

/**
 * Pick the dominant exact commodity available to this seller and table. The
 * source depot and goods already staged at the Marketplace both count, so a
 * delivery does not make the visible counter revert while its depot refills.
 */
export function marketStallRepresentative(
  source: BuildingState,
  marketplace: BuildingState,
  needKind: MarketStallNeed,
): MarketStallRepresentative | null {
  let commodityKind: MarketStallCommodityKind | null = null;
  let largestStock = 1e-6;
  for (const candidate of MARKET_STALL_COMMODITIES_BY_NEED[needKind]) {
    const stock = finiteStock(source[candidate])
      + finiteStock(marketplace[candidate]);
    if (stock <= largestStock) continue;
    commodityKind = candidate;
    largestStock = stock;
  }
  return commodityKind == null
    ? null
    : {
        commodityKind,
        displayKind: marketStallDisplayKind(commodityKind),
      };
}

function marketStallDisplayKind(
  commodityKind: MarketStallCommodityKind,
): MarketStallDisplayKind {
  switch (commodityKind) {
    case 'oatGrain': return 'provisions';
    case 'ryeBread':
    case 'maslinBread': return 'bread';
    case 'meat': return 'meat';
    case 'fish': return 'fish';
    case 'berries':
    case 'aronia':
    case 'rosehips':
    case 'mushrooms': return 'foraged';
    case 'milk': return 'milk';
    case 'apples':
    case 'pears':
    case 'cherries':
    case 'grapes': return 'fruit';
    case 'cabbage':
    case 'carrots':
    case 'beetroot': return 'vegetables';
    case 'eggs': return 'eggs';
    case 'honey': return 'honey';
    case 'wine': return 'wine';
    case 'jam': return 'preserves';
    case 'curedMeat': return 'curedMeat';
    case 'smokedFish': return 'smokedFish';
    case 'cheese': return 'cheese';
    case 'firewood': return 'firewood';
    case 'charcoal': return 'charcoal';
    case 'cloth': return 'cloth';
    case 'shoes': return 'shoes';
    case 'pottery': return 'pottery';
    case 'candles': return 'candles';
    default: {
      const unreachable: never = commodityKind;
      return unreachable;
    }
  }
}

/**
 * Build the deterministic market-day roster. One depot worker may occupy one
 * table at one Marketplace, and one table carries one household-need category.
 * Exact road distance assigns workers before stable building ids break ties.
 */
export function assignMarketplaceStalls(
  buildings: Iterable<BuildingState>,
  roadDistance: MarketStallRoadDistance,
  disabledBuildingIds: ReadonlySet<string> = new Set(),
): MarketStallAssignment[] {
  return assignMarketplaceStallRoster(
    buildings,
    roadDistance,
    disabledBuildingIds,
  ).stalls;
}

/**
 * Include both stocked tables and workers standing by at an empty table. A
 * standby table can accept its first producer delivery, then advertises that
 * category on the next roster pass.
 */
export function assignMarketplaceStallRoster(
  buildings: Iterable<BuildingState>,
  roadDistance: MarketStallRoadDistance,
  disabledBuildingIds: ReadonlySet<string> = new Set(),
): MarketplaceStallRoster {
  const all = [...buildings];
  const markets = all
    .filter((building) =>
      building.kind === 'marketplace'
      && building.constructionComplete !== false
      && !disabledBuildingIds.has(building.id)
    )
    .sort(compareBuildingIds);
  const assignments: MarketStallAssignment[] = [];
  const workers: MarketStallWorkerAssignment[] = [];

  assignGroup(
    assignments,
    workers,
    markets,
    all,
    'food',
    'granary',
    MARKET_FOOD_STALL_NEEDS,
    MARKETPLACE_FOOD_STALL_SLOTS,
    roadDistance,
    disabledBuildingIds,
  );
  assignGroup(
    assignments,
    workers,
    markets,
    all,
    'goods',
    'village_storehouse',
    MARKET_GOODS_STALL_NEEDS,
    MARKETPLACE_GOODS_STALL_SLOTS,
    roadDistance,
    disabledBuildingIds,
  );

  const compareRosterEntries = (
    left: MarketStallWorkerAssignment,
    right: MarketStallWorkerAssignment,
  ) =>
    compareIds(left.marketplaceId, right.marketplaceId)
    || left.group.localeCompare(right.group)
    || (left.needKind == null ? 1 : 0) - (right.needKind == null ? 1 : 0)
    || (left.needKind != null && right.needKind != null
      ? stallNeedRank(left.needKind) - stallNeedRank(right.needKind)
      : 0)
    || compareIds(left.workplaceId, right.workplaceId)
  ;
  assignments.sort(compareRosterEntries);
  workers.sort(compareRosterEntries);
  return { stalls: assignments, workers };
}

/**
 * Give each deterministic roster entry both of its physical identities: the
 * Marketplace table it occupies and the source depot labor slot that walks
 * there. Presentation uses these indexes for stable counter props and agents.
 */
export function indexMarketplaceStallWorkers(
  roster: MarketplaceStallRoster,
): IndexedMarketStallWorkerAssignment[] {
  const nextMarketplaceSlot = new Map<string, number>();
  const nextWorkplaceSlot = new Map<string, number>();
  return roster.workers.map((worker) => {
    const marketKey = `${worker.marketplaceId}:${worker.group}`;
    const marketplaceSlotIndex = nextMarketplaceSlot.get(marketKey) ?? 0;
    const workplaceSlotIndex = nextWorkplaceSlot.get(worker.workplaceId) ?? 0;
    nextMarketplaceSlot.set(marketKey, marketplaceSlotIndex + 1);
    nextWorkplaceSlot.set(worker.workplaceId, workplaceSlotIndex + 1);
    return {
      ...worker,
      marketplaceSlotIndex,
      workplaceSlotIndex,
    };
  });
}

function assignGroup(
  assignments: MarketStallAssignment[],
  workers: MarketStallWorkerAssignment[],
  markets: readonly BuildingState[],
  allBuildings: readonly BuildingState[],
  group: MarketStallGroup,
  workplaceKind: 'granary' | 'village_storehouse',
  needs: readonly MarketStallNeed[],
  slotCount: number,
  roadDistance: MarketStallRoadDistance,
  disabledBuildingIds: ReadonlySet<string>,
): void {
  const workplaces = allBuildings
    .filter((building): building is BuildingState & {
      kind: typeof workplaceKind;
    } =>
      building.kind === workplaceKind
      && building.constructionComplete !== false
      && building.assignedLabor > 0
      && !disabledBuildingIds.has(building.id)
    )
    .sort(compareBuildingIds);
  const workersRemaining = new Map(
    workplaces.map((workplace) => [
      workplace.id,
      Math.max(0, Math.floor(workplace.assignedLabor)),
    ]),
  );
  const slotsRemaining = new Map(
    markets.map((market) => [market.id, Math.max(0, Math.floor(slotCount))]),
  );
  const candidates: StallCandidate[] = [];
  const workplaceMarketPairs: Array<{
    distance: number;
    marketplaceId: string;
    workplaceId: string;
  }> = [];

  for (const workplace of workplaces) {
    for (const market of markets) {
      const distance = roadDistance(
        workplace.x,
        workplace.z,
        market.x,
        market.z,
      );
      if (distance == null || !Number.isFinite(distance)) continue;
      workplaceMarketPairs.push({
        distance,
        marketplaceId: market.id,
        workplaceId: workplace.id,
      });
      for (const needKind of needs) {
        const sourceHasStock = marketStallStock(workplace, needKind) > 1e-6;
        if (!sourceHasStock && marketStallStock(market, needKind) <= 1e-6) continue;
        candidates.push({
          marketplaceId: market.id,
          workplaceId: workplace.id,
          workplaceKind,
          group,
          needKind,
          distance,
          sourceHasStock,
        });
      }
    }
  }

  candidates.sort((left, right) =>
    left.distance - right.distance
    || Number(right.sourceHasStock) - Number(left.sourceHasStock)
    || stallNeedRank(left.needKind) - stallNeedRank(right.needKind)
    || compareIds(left.marketplaceId, right.marketplaceId)
    || compareIds(left.workplaceId, right.workplaceId)
  );

  const filledNeeds = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.marketplaceId}:${candidate.needKind}`;
    const sourceWorkers = workersRemaining.get(candidate.workplaceId) ?? 0;
    const marketSlots = slotsRemaining.get(candidate.marketplaceId) ?? 0;
    if (sourceWorkers <= 0 || marketSlots <= 0 || filledNeeds.has(key)) continue;
    assignments.push({
      marketplaceId: candidate.marketplaceId,
      workplaceId: candidate.workplaceId,
      workplaceKind: candidate.workplaceKind,
      group: candidate.group,
      needKind: candidate.needKind,
    });
    workers.push({
      marketplaceId: candidate.marketplaceId,
      workplaceId: candidate.workplaceId,
      workplaceKind: candidate.workplaceKind,
      group: candidate.group,
      needKind: candidate.needKind,
    });
    filledNeeds.add(key);
    workersRemaining.set(candidate.workplaceId, sourceWorkers - 1);
    slotsRemaining.set(candidate.marketplaceId, marketSlots - 1);
  }

  workplaceMarketPairs.sort((left, right) =>
    left.distance - right.distance
    || compareIds(left.marketplaceId, right.marketplaceId)
    || compareIds(left.workplaceId, right.workplaceId)
  );
  for (const pair of workplaceMarketPairs) {
    const sourceWorkers = workersRemaining.get(pair.workplaceId) ?? 0;
    const marketSlots = slotsRemaining.get(pair.marketplaceId) ?? 0;
    const standbyWorkers = Math.min(sourceWorkers, marketSlots);
    for (let index = 0; index < standbyWorkers; index += 1) {
      workers.push({
        marketplaceId: pair.marketplaceId,
        workplaceId: pair.workplaceId,
        workplaceKind,
        group,
        needKind: null,
      });
    }
    workersRemaining.set(pair.workplaceId, sourceWorkers - standbyWorkers);
    slotsRemaining.set(pair.marketplaceId, marketSlots - standbyWorkers);
  }
}

export function marketStallStock(
  building: BuildingState,
  needKind: MarketStallNeed,
): number {
  switch (needKind) {
    case 'food':
      return freshFoodStock(building) + finiteStock(building.honey);
    case 'savoryPreserves':
      return savoryPreservesStock(building);
    case 'luxury':
      return finiteStock(building.wine) + finiteStock(building.honey);
    case 'firewood':
      return combinedFuelEquivalent(
        finiteStock(building.firewood),
        finiteStock(building.charcoal),
      );
    case 'cloth':
      return finiteStock(building.cloth);
    case 'shoes':
      return finiteStock(building.shoes);
    case 'pottery':
      return finiteStock(building.pottery) + finiteStock(building.candles);
  }
}

function stallNeedRank(needKind: MarketStallNeed): number {
  switch (needKind) {
    case 'food': return 0;
    case 'firewood': return 0;
    case 'savoryPreserves': return 1;
    case 'luxury': return 2;
    case 'cloth': return 1;
    case 'shoes': return 2;
    case 'pottery': return 2;
  }
}

function finiteStock(stock: number | undefined): number {
  return Number.isFinite(stock) ? Math.max(0, stock ?? 0) : 0;
}

function compareBuildingIds(left: BuildingState, right: BuildingState): number {
  return compareIds(left.id, right.id);
}

function compareIds(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}
