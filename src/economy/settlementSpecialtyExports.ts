import {
  BUILDING_STORAGE_CAPS,
  SPECIALTY_EXPORT_GOLD_PER_ALE,
  SPECIALTY_EXPORT_GOLD_PER_CHEESE,
  SPECIALTY_EXPORT_GOLD_PER_CLOTH,
  SPECIALTY_EXPORT_GOLD_PER_HONEY,
  SPECIALTY_EXPORT_GOLD_PER_WINE,
} from '../generated/gameBalance.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { DeliveryCargoKind } from '../logistics/deliveryTrips.ts';
import type { BuildingKind, BuildingState, GameState } from '../resources/types.ts';
import {
  marketplaceSpecialtyExportRate,
  marketplaceSpecialtyExportWorkers,
  specialtyExportPolicyAllows,
} from './specialtyTrade.ts';
import {
  productionRoadBranchKey,
  type ProductionRoadComponentResolver,
} from './settlementProduction.ts';

export const SPECIALTY_EXPORT_CARGO_KINDS = [
  'ale',
  'honey',
  'wine',
  'cloth',
  'cheese',
] as const;

export type SpecialtyExportCargoKind =
  (typeof SPECIALTY_EXPORT_CARGO_KINDS)[number];

export type SpecialtyExportAttentionKind =
  | 'producer-road'
  | 'producer-storage'
  | 'producer-labor'
  | 'producer-fire'
  | 'producer-market-fire'
  | 'producer-receiving'
  | 'market-construction'
  | 'market-road'
  | 'market-labor'
  | 'market-fire'
  | 'market-policy'
  | 'market-manual-trade';

export type SpecialtyExportCommodityLedger = {
  producerStock: number;
  dispatchReadyProducerStock: number;
  inTransitToMarkets: number;
  marketQueue: number;
  projectedMarketQueue: number;
  projectedMarketValue: number;
};

export type SettlementSpecialtyExportRoadBranch = {
  producers: number;
  staffedProducers: number;
  markets: number;
  staffedMarkets: number;
  operationalMarkets: number;
  activeBrokerMarkets: number;
  producerStock: number;
  dispatchReadyProducerStock: number;
  busyProducerStock: number;
  receivingBlockedProducerStock: number;
  laborBlockedProducerStock: number;
  fireBlockedProducerStock: number;
  marketFireBlockedProducerStock: number;
  roadStrandedProducerStock: number;
  storageBlockedProducerStock: number;
  marketQueueUnits: number;
  inTransitToMarkets: number;
  projectedMarketQueueUnits: number;
  blockedMarketQueueUnits: number;
  exportWorkers: number;
  exportRatePerSecond: number;
  firstProducerId: string | null;
  firstMarketId: string | null;
};

export type SettlementSpecialtyExportRoadPlan = {
  activeBranches: number;
  producerBranches: number;
  marketBranches: number;
  matchedBranches: number;
  staffedBrokerBranches: number;
  activeBrokerBranches: number;
  exposedProducerBranches: number;
  blockedQueueBranches: number;
  roadMatchedProducerStock: number;
  roadStrandedProducerStock: number;
  brokerCoveredProducerStock: number;
  branches: ReadonlyMap<string, SettlementSpecialtyExportRoadBranch>;
};

export type SettlementSpecialtyExportPlan = {
  marketRate: number;
  producers: number;
  staffedProducers: number;
  markets: number;
  completedMarkets: number;
  roadLinkedMarkets: number;
  staffedMarkets: number;
  operationalMarkets: number;
  activeBrokerMarkets: number;
  producerStock: number;
  dispatchReadyProducerStock: number;
  busyProducerStock: number;
  receivingBlockedProducerStock: number;
  laborBlockedProducerStock: number;
  fireBlockedProducerStock: number;
  marketFireBlockedProducerStock: number;
  roadStrandedProducerStock: number;
  storageBlockedProducerStock: number;
  marketQueueUnits: number;
  inTransitToMarkets: number;
  projectedMarketQueueUnits: number;
  activeMarketQueueUnits: number;
  roadBlockedMarketQueueUnits: number;
  constructionBlockedMarketQueueUnits: number;
  laborBlockedMarketQueueUnits: number;
  fireBlockedMarketQueueUnits: number;
  policyHeldMarketQueueUnits: number;
  manualTradeBlockedMarketQueueUnits: number;
  blockedMarketQueueUnits: number;
  exportWorkers: number;
  exportRatePerSecond: number;
  slowestActiveMarketClearSeconds: number | null;
  slowestActiveMarketId: string | null;
  firstAttentionBuildingId: string | null;
  firstAttentionKind: SpecialtyExportAttentionKind | null;
  firstAttentionUnits: number;
  commodities: Readonly<Record<
    SpecialtyExportCargoKind,
    SpecialtyExportCommodityLedger
  >>;
  roadPlan: SettlementSpecialtyExportRoadPlan | null;
};

type MutableRoadBranch = SettlementSpecialtyExportRoadBranch;

type MarketRecord = {
  building: BuildingState;
  branch: MutableRoadBranch;
  roadLinked: boolean;
  inboundByCommodity: Record<SpecialtyExportCargoKind, number>;
  hasInboundSupply: boolean;
  projectedQueue: number;
  active: boolean;
  operational: boolean;
};

type ProducerRecord = {
  building: BuildingState;
  branch: MutableRoadBranch;
  commodity: SpecialtyExportCargoKind;
  stock: number;
};

type BranchMarketCapacity = {
  completedMarkets: number;
  fireDisabledMarkets: number;
  hasRoom: Record<SpecialtyExportCargoKind, boolean>;
  hasFreeReceivingRoom: Record<SpecialtyExportCargoKind, boolean>;
};

type AttentionCandidate = {
  kind: SpecialtyExportAttentionKind;
  buildingId: string;
  units: number;
  priority: number;
};

const SOURCE_COMMODITY_BY_KIND: Partial<
  Record<BuildingKind, SpecialtyExportCargoKind>
> = {
  brewery: 'ale',
  apiary: 'honey',
  vineyard: 'wine',
  pastoral_farmstead: 'cheese',
  weaver: 'cloth',
};

const ATTENTION_PRIORITY: Record<SpecialtyExportAttentionKind, number> = {
  'producer-road': 8,
  'market-road': 8,
  'market-construction': 8,
  'producer-storage': 7,
  'market-fire': 7,
  'producer-fire': 7,
  'producer-market-fire': 7,
  'market-labor': 6,
  'producer-labor': 6,
  'market-policy': 5,
  'market-manual-trade': 4,
  'producer-receiving': 3,
};

function positive(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function isSpecialtyCargo(
  cargo: DeliveryCargoKind,
): cargo is SpecialtyExportCargoKind {
  return (SPECIALTY_EXPORT_CARGO_KINDS as readonly string[]).includes(cargo);
}

function buildingCommodityStock(
  building: BuildingState,
  commodity: SpecialtyExportCargoKind,
): number {
  return positive(building[commodity]);
}

function marketplaceCommodityRoom(
  market: BuildingState,
  commodity: SpecialtyExportCargoKind,
  approaching: number,
): number {
  const capacity = commodity === 'cheese'
    ? BUILDING_STORAGE_CAPS.trading_post.preservedFood ?? 0
    : BUILDING_STORAGE_CAPS.trading_post[commodity] ?? 0;
  return Math.max(
    0,
    capacity - buildingCommodityStock(market, commodity) - positive(approaching),
  );
}

function specialtyGoldPerUnit(commodity: SpecialtyExportCargoKind): number {
  switch (commodity) {
    case 'ale': return SPECIALTY_EXPORT_GOLD_PER_ALE;
    case 'honey': return SPECIALTY_EXPORT_GOLD_PER_HONEY;
    case 'wine': return SPECIALTY_EXPORT_GOLD_PER_WINE;
    case 'cloth': return SPECIALTY_EXPORT_GOLD_PER_CLOTH;
    case 'cheese': return SPECIALTY_EXPORT_GOLD_PER_CHEESE;
  }
}

function emptyCommodityLedger(): SpecialtyExportCommodityLedger {
  return {
    producerStock: 0,
    dispatchReadyProducerStock: 0,
    inTransitToMarkets: 0,
    marketQueue: 0,
    projectedMarketQueue: 0,
    projectedMarketValue: 0,
  };
}

function emptyCommodityMap(): Record<
  SpecialtyExportCargoKind,
  SpecialtyExportCommodityLedger
> {
  return {
    ale: emptyCommodityLedger(),
    honey: emptyCommodityLedger(),
    wine: emptyCommodityLedger(),
    cloth: emptyCommodityLedger(),
    cheese: emptyCommodityLedger(),
  };
}

function emptyBranchMarketCapacity(): BranchMarketCapacity {
  return {
    completedMarkets: 0,
    fireDisabledMarkets: 0,
    hasRoom: {
      ale: false,
      honey: false,
      wine: false,
      cloth: false,
      cheese: false,
    },
    hasFreeReceivingRoom: {
      ale: false,
      honey: false,
      wine: false,
      cloth: false,
      cheese: false,
    },
  };
}

function specialtyBranch(
  branches: Map<string, MutableRoadBranch>,
  key: string,
): MutableRoadBranch {
  let branch = branches.get(key);
  if (branch) return branch;
  branch = {
    producers: 0,
    staffedProducers: 0,
    markets: 0,
    staffedMarkets: 0,
    operationalMarkets: 0,
    activeBrokerMarkets: 0,
    producerStock: 0,
    dispatchReadyProducerStock: 0,
    busyProducerStock: 0,
    receivingBlockedProducerStock: 0,
    laborBlockedProducerStock: 0,
    fireBlockedProducerStock: 0,
    marketFireBlockedProducerStock: 0,
    roadStrandedProducerStock: 0,
    storageBlockedProducerStock: 0,
    marketQueueUnits: 0,
    inTransitToMarkets: 0,
    projectedMarketQueueUnits: 0,
    blockedMarketQueueUnits: 0,
    exportWorkers: 0,
    exportRatePerSecond: 0,
    firstProducerId: null,
    firstMarketId: null,
  };
  branches.set(key, branch);
  return branch;
}

function branchKey(
  building: BuildingState,
  resolver: ProductionRoadComponentResolver | undefined,
): string {
  if (!resolver) return 'settlement';
  return productionRoadBranchKey(
    resolver(building),
    'building',
    building.id,
  );
}

function earlierStableId(current: string | null, candidate: string): string {
  return current === null || compareStableEntityIds(candidate, current) < 0
    ? candidate
    : current;
}

function shouldReplaceAttention(
  current: AttentionCandidate | null,
  candidate: AttentionCandidate,
): boolean {
  if (current === null) return true;
  if (candidate.priority !== current.priority) {
    return candidate.priority > current.priority;
  }
  if (Math.abs(candidate.units - current.units) > 1e-9) {
    return candidate.units > current.units;
  }
  return compareStableEntityIds(candidate.buildingId, current.buildingId) < 0;
}

/**
 * Inspector-time specialty export ledger for the physical producer -> market
 * -> regional-sale chain already simulated by the server.
 *
 * The pass is linear in buildings and active carts. Cached road-component ids
 * replace shortest-path searches, so opening the Town Hall does not add any
 * simulation-tick work.
 */
export function computeSettlementSpecialtyExportPlan(input: {
  state: Pick<GameState, 'buildings' | 'deliveryTrips'>
    & Partial<Pick<GameState, 'fireIncidents'>>;
  marketRate: number;
  roadComponentFor?: ProductionRoadComponentResolver;
}): SettlementSpecialtyExportPlan {
  const marketRate = Number.isFinite(input.marketRate)
    ? Math.max(0, input.marketRate)
    : 0;
  const branches = new Map<string, MutableRoadBranch>();
  const markets = new Map<string, MarketRecord>();
  const producers: ProducerRecord[] = [];
  const activeSourceIds = new Set<string>();
  const fireDisabled = fireDisabledBuildingIds(
    input.state.fireIncidents?.values() ?? [],
  );
  const commodities = emptyCommodityMap();
  const marketCapacityByBranch = new Map<
    MutableRoadBranch,
    BranchMarketCapacity
  >();
  let attention: AttentionCandidate | null = null;

  const recordAttention = (
    kind: SpecialtyExportAttentionKind,
    buildingId: string,
    units: number,
  ): void => {
    const candidate: AttentionCandidate = {
      kind,
      buildingId,
      units,
      priority: ATTENTION_PRIORITY[kind],
    };
    if (shouldReplaceAttention(attention, candidate)) attention = candidate;
  };

  for (const building of input.state.buildings.values()) {
    if (building.kind === 'trading_post') {
      const component = input.roadComponentFor
        ? input.roadComponentFor(building)
        : 'settlement';
      const branch = specialtyBranch(
        branches,
        input.roadComponentFor
          ? productionRoadBranchKey(component, 'building', building.id)
          : 'settlement',
      );
      markets.set(building.id, {
        building,
        branch,
        roadLinked: component !== null,
        inboundByCommodity: {
          ale: 0,
          honey: 0,
          wine: 0,
          cloth: 0,
          cheese: 0,
        },
        hasInboundSupply: false,
        projectedQueue: 0,
        active: false,
        operational: false,
      });
      continue;
    }

    const commodity = SOURCE_COMMODITY_BY_KIND[building.kind];
    if (commodity === undefined || building.constructionComplete === false) {
      continue;
    }
    const branch = specialtyBranch(
      branches,
      branchKey(building, input.roadComponentFor),
    );
    const stock = buildingCommodityStock(building, commodity);
    branch.producers += 1;
    if (building.assignedLabor > 0) branch.staffedProducers += 1;
    branch.producerStock += stock;
    branch.firstProducerId = earlierStableId(
      branch.firstProducerId,
      building.id,
    );
    commodities[commodity].producerStock += stock;
    producers.push({ building, branch, commodity, stock });
  }

  for (const trip of input.state.deliveryTrips.values()) {
    activeSourceIds.add(trip.buildingId);
    if (
      trip.phase === 'inbound'
      || trip.destinationKind !== 'building'
      || trip.targetBuildingId === null
    ) {
      continue;
    }
    const market = markets.get(trip.targetBuildingId);
    if (!market) continue;
    market.hasInboundSupply = true;
    if (!isSpecialtyCargo(trip.cargoKind)) continue;
    const amount = positive(trip.amount);
    market.inboundByCommodity[trip.cargoKind] += amount;
    market.branch.inTransitToMarkets += amount;
    commodities[trip.cargoKind].inTransitToMarkets += amount;
  }

  let marketCount = 0;
  let completedMarkets = 0;
  let roadLinkedMarkets = 0;
  let staffedMarkets = 0;
  let operationalMarkets = 0;
  let activeBrokerMarkets = 0;
  let marketQueueUnits = 0;
  let inTransitToMarkets = 0;
  let projectedMarketQueueUnits = 0;
  let activeMarketQueueUnits = 0;
  let roadBlockedMarketQueueUnits = 0;
  let constructionBlockedMarketQueueUnits = 0;
  let laborBlockedMarketQueueUnits = 0;
  let fireBlockedMarketQueueUnits = 0;
  let policyHeldMarketQueueUnits = 0;
  let manualTradeBlockedMarketQueueUnits = 0;
  let exportWorkers = 0;
  let exportRatePerSecond = 0;
  let slowestActiveMarketClearSeconds: number | null = null;
  let slowestActiveMarketId: string | null = null;

  for (const market of markets.values()) {
    const { building, branch } = market;
    const complete = building.constructionComplete !== false;
    const queue = SPECIALTY_EXPORT_CARGO_KINDS.reduce(
      (sum, commodity) => sum + buildingCommodityStock(building, commodity),
      0,
    );
    const inbound = SPECIALTY_EXPORT_CARGO_KINDS.reduce(
      (sum, commodity) => sum + market.inboundByCommodity[commodity],
      0,
    );
    const projectedQueue = queue + inbound;
    const workers = marketplaceSpecialtyExportWorkers(building);
    const rate = marketplaceSpecialtyExportRate(building);
    const policyAllows = specialtyExportPolicyAllows(
      building.marketplaceSpecialtyExportPolicy,
      marketRate,
    );
    const fireBlocked = fireDisabled.has(building.id);
    const operational = complete
      && market.roadLinked
      && building.assignedLabor > 0
      && !fireBlocked;
    const active = operational && policyAllows && workers > 0;

    market.projectedQueue = projectedQueue;
    market.operational = operational;
    market.active = active;
    marketCount += 1;
    if (complete) {
      completedMarkets += 1;
      branch.markets += 1;
      if (market.roadLinked) roadLinkedMarkets += 1;
      let capacity = marketCapacityByBranch.get(branch);
      if (!capacity) {
        capacity = emptyBranchMarketCapacity();
        marketCapacityByBranch.set(branch, capacity);
      }
      if (fireBlocked) {
        capacity.fireDisabledMarkets += 1;
      } else {
        capacity.completedMarkets += 1;
        for (const commodity of SPECIALTY_EXPORT_CARGO_KINDS) {
          if (
            marketplaceCommodityRoom(
              building,
              commodity,
              market.inboundByCommodity[commodity],
            ) <= 1e-9
          ) {
            continue;
          }
          capacity.hasRoom[commodity] = true;
          if (!market.hasInboundSupply) {
            capacity.hasFreeReceivingRoom[commodity] = true;
          }
        }
      }
    }
    if (complete && building.assignedLabor > 0) {
      staffedMarkets += 1;
      branch.staffedMarkets += 1;
    }
    if (operational) {
      operationalMarkets += 1;
      branch.operationalMarkets += 1;
    }
    if (active) {
      activeBrokerMarkets += 1;
      branch.activeBrokerMarkets += 1;
      exportWorkers += workers;
      exportRatePerSecond += rate;
      branch.exportWorkers += workers;
      branch.exportRatePerSecond += rate;
      activeMarketQueueUnits += projectedQueue;
      if (projectedQueue > 1e-9 && rate > 1e-9) {
        const clearSeconds = projectedQueue / rate;
        if (
          slowestActiveMarketClearSeconds === null
          || clearSeconds > slowestActiveMarketClearSeconds + 1e-9
          || (
            Math.abs(clearSeconds - slowestActiveMarketClearSeconds) <= 1e-9
            && (
              slowestActiveMarketId === null
              || compareStableEntityIds(
                building.id,
                slowestActiveMarketId,
              ) < 0
            )
          )
        ) {
          slowestActiveMarketClearSeconds = clearSeconds;
          slowestActiveMarketId = building.id;
        }
      }
    }

    marketQueueUnits += queue;
    inTransitToMarkets += inbound;
    projectedMarketQueueUnits += projectedQueue;
    branch.marketQueueUnits += queue;
    branch.projectedMarketQueueUnits += projectedQueue;
    branch.firstMarketId = earlierStableId(branch.firstMarketId, building.id);

    for (const commodity of SPECIALTY_EXPORT_CARGO_KINDS) {
      const onsite = buildingCommodityStock(building, commodity);
      const approaching = market.inboundByCommodity[commodity];
      commodities[commodity].marketQueue += onsite;
      commodities[commodity].projectedMarketQueue += onsite + approaching;
      commodities[commodity].projectedMarketValue += (
        onsite + approaching
      ) * specialtyGoldPerUnit(commodity) * marketRate;
    }

    if (projectedQueue <= 1e-9 || active) continue;
    branch.blockedMarketQueueUnits += projectedQueue;
    if (!complete) {
      constructionBlockedMarketQueueUnits += projectedQueue;
      recordAttention('market-construction', building.id, projectedQueue);
    } else if (!market.roadLinked) {
      roadBlockedMarketQueueUnits += projectedQueue;
      recordAttention('market-road', building.id, projectedQueue);
    } else if (fireBlocked) {
      fireBlockedMarketQueueUnits += projectedQueue;
      recordAttention('market-fire', building.id, projectedQueue);
    } else if (building.assignedLabor <= 0) {
      laborBlockedMarketQueueUnits += projectedQueue;
      recordAttention('market-labor', building.id, projectedQueue);
    } else if (!policyAllows) {
      policyHeldMarketQueueUnits += projectedQueue;
      recordAttention('market-policy', building.id, projectedQueue);
    } else {
      manualTradeBlockedMarketQueueUnits += projectedQueue;
      recordAttention('market-manual-trade', building.id, projectedQueue);
    }
  }

  let producerStock = 0;
  let dispatchReadyProducerStock = 0;
  let busyProducerStock = 0;
  let receivingBlockedProducerStock = 0;
  let laborBlockedProducerStock = 0;
  let fireBlockedProducerStock = 0;
  let marketFireBlockedProducerStock = 0;
  let roadStrandedProducerStock = 0;
  let storageBlockedProducerStock = 0;
  let producerCount = 0;
  let staffedProducerCount = 0;

  for (const producer of producers) {
    const { building, branch, commodity, stock } = producer;
    producerCount += 1;
    if (building.assignedLabor > 0) staffedProducerCount += 1;
    producerStock += stock;
    if (stock <= 1e-9) continue;
    if (fireDisabled.has(building.id)) {
      fireBlockedProducerStock += stock;
      branch.fireBlockedProducerStock += stock;
      recordAttention('producer-fire', building.id, stock);
      continue;
    }

    const marketCapacity = marketCapacityByBranch.get(branch);
    if (!marketCapacity || marketCapacity.completedMarkets === 0) {
      if (marketCapacity && marketCapacity.fireDisabledMarkets > 0) {
        marketFireBlockedProducerStock += stock;
        branch.marketFireBlockedProducerStock += stock;
        recordAttention('producer-market-fire', building.id, stock);
      } else {
        roadStrandedProducerStock += stock;
        branch.roadStrandedProducerStock += stock;
        recordAttention('producer-road', building.id, stock);
      }
      continue;
    }
    if (!marketCapacity.hasRoom[commodity]) {
      storageBlockedProducerStock += stock;
      branch.storageBlockedProducerStock += stock;
      recordAttention('producer-storage', building.id, stock);
      continue;
    }
    if (building.assignedLabor <= 0) {
      laborBlockedProducerStock += stock;
      branch.laborBlockedProducerStock += stock;
      recordAttention('producer-labor', building.id, stock);
      continue;
    }
    if (activeSourceIds.has(building.id)) {
      busyProducerStock += stock;
      branch.busyProducerStock += stock;
      continue;
    }
    if (!marketCapacity.hasFreeReceivingRoom[commodity]) {
      receivingBlockedProducerStock += stock;
      branch.receivingBlockedProducerStock += stock;
      recordAttention('producer-receiving', building.id, stock);
      continue;
    }
    dispatchReadyProducerStock += stock;
    branch.dispatchReadyProducerStock += stock;
    commodities[commodity].dispatchReadyProducerStock += stock;
  }

  let activeBranches = 0;
  let producerBranches = 0;
  let marketBranches = 0;
  let matchedBranches = 0;
  let staffedBrokerBranches = 0;
  let activeBrokerBranches = 0;
  let exposedProducerBranches = 0;
  let blockedQueueBranches = 0;
  let roadMatchedProducerStock = 0;
  let brokerCoveredProducerStock = 0;
  const relevantBranches = new Map<string, SettlementSpecialtyExportRoadBranch>();
  for (const [key, branch] of branches) {
    if (
      branch.producers === 0
      && branch.markets === 0
      && branch.projectedMarketQueueUnits <= 1e-9
    ) {
      continue;
    }
    activeBranches += 1;
    relevantBranches.set(key, branch);
    if (branch.producers > 0) producerBranches += 1;
    if (branch.markets > 0) marketBranches += 1;
    if (branch.producers > 0 && branch.markets > 0) {
      matchedBranches += 1;
      roadMatchedProducerStock += branch.producerStock;
    }
    if (branch.operationalMarkets > 0) {
      staffedBrokerBranches += 1;
      if (branch.producers > 0) brokerCoveredProducerStock += branch.producerStock;
    }
    if (branch.activeBrokerMarkets > 0) activeBrokerBranches += 1;
    if (
      branch.roadStrandedProducerStock > 1e-9
      || branch.storageBlockedProducerStock > 1e-9
      || branch.marketFireBlockedProducerStock > 1e-9
    ) {
      exposedProducerBranches += 1;
    }
    if (branch.blockedMarketQueueUnits > 1e-9) blockedQueueBranches += 1;
  }

  const blockedMarketQueueUnits =
    roadBlockedMarketQueueUnits
    + constructionBlockedMarketQueueUnits
    + laborBlockedMarketQueueUnits
    + fireBlockedMarketQueueUnits
    + policyHeldMarketQueueUnits
    + manualTradeBlockedMarketQueueUnits;
  const selectedAttention = attention as AttentionCandidate | null;

  return {
    marketRate,
    producers: producerCount,
    staffedProducers: staffedProducerCount,
    markets: marketCount,
    completedMarkets,
    roadLinkedMarkets,
    staffedMarkets,
    operationalMarkets,
    activeBrokerMarkets,
    producerStock,
    dispatchReadyProducerStock,
    busyProducerStock,
    receivingBlockedProducerStock,
    laborBlockedProducerStock,
    fireBlockedProducerStock,
    marketFireBlockedProducerStock,
    roadStrandedProducerStock,
    storageBlockedProducerStock,
    marketQueueUnits,
    inTransitToMarkets,
    projectedMarketQueueUnits,
    activeMarketQueueUnits,
    roadBlockedMarketQueueUnits,
    constructionBlockedMarketQueueUnits,
    laborBlockedMarketQueueUnits,
    fireBlockedMarketQueueUnits,
    policyHeldMarketQueueUnits,
    manualTradeBlockedMarketQueueUnits,
    blockedMarketQueueUnits,
    exportWorkers,
    exportRatePerSecond,
    slowestActiveMarketClearSeconds,
    slowestActiveMarketId,
    firstAttentionBuildingId: selectedAttention?.buildingId ?? null,
    firstAttentionKind: selectedAttention?.kind ?? null,
    firstAttentionUnits: selectedAttention?.units ?? 0,
    commodities,
    roadPlan: input.roadComponentFor
      ? {
          activeBranches,
          producerBranches,
          marketBranches,
          matchedBranches,
          staffedBrokerBranches,
          activeBrokerBranches,
          exposedProducerBranches,
          blockedQueueBranches,
          roadMatchedProducerStock,
          roadStrandedProducerStock,
          brokerCoveredProducerStock,
          branches: relevantBranches,
        }
      : null,
  };
}
