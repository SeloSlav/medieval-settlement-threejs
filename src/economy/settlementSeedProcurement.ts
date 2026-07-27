import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import {
  productionRoadBranchKey,
  type ProductionRoadComponentResolver,
} from './settlementProduction.ts';
import {
  MARKETPLACE_SEED_GRAIN_IMPORT_LOT,
  marketplaceSeedGrainProcurementPlan,
  nextMarketplaceStandingOrder,
} from './marketplaceSeedPolicy.ts';
import { marketplaceGoldReserveTarget } from './marketplaceGoldReserve.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';

export type SettlementSeedProcurementAttention =
  | 'construction'
  | 'fire'
  | 'labor'
  | 'road'
  | 'cash-policy'
  | 'cash-inbound'
  | 'cash-cart'
  | 'treasury'
  | 'ironwork'
  | 'cooldown';

export type SettlementSeedProcurementPlan = {
  marketplaces: number;
  targetMarkets: number;
  dueMarkets: number;
  readyMarkets: number;
  currentMarketStock: number;
  currentGranaryStock: number;
  targetStock: number;
  plannedImportLots: number;
  plannedImportGrain: number;
  inboundSeedGrain: number;
  affordableLotsAtCurrentRate: number;
  onsiteFundedLotsAtCurrentRate: number;
  committedFundedLotsAtCurrentRate: number;
  treasuryRefillLotsAtCurrentRate: number;
  nextLotGoldCost: number;
  physicalCashEconomy: boolean;
  availableTreasuryGold: number;
  marketCofferGold: number;
  inboundMarketGold: number;
  selectedMarketReserveGold: number;
  seedShortfall: number;
  potentialCoverage: number;
  uncoveredShortfall: number;
  constructionBlockedMarkets: number;
  fireBlockedMarkets: number;
  laborBlockedMarkets: number;
  roadBlockedMarkets: number;
  cashPolicyBlockedMarkets: number;
  cashInboundMarkets: number;
  cashCartMarkets: number;
  treasuryBlockedMarkets: number;
  ironworkQueuedMarkets: number;
  cooldownBlockedMarkets: number;
  firstAttentionMarketId: string | null;
  firstAttentionKind: SettlementSeedProcurementAttention | null;
  roadPlan: SettlementSeedRoadPlan | null;
};

export type SettlementSeedRoadBranch = {
  seedShortfall: number;
  currentMarketStock: number;
  currentGranaryStock: number;
  plannedImportGrain: number;
  potentialCoverage: number;
  uncoveredShortfall: number;
  firstShortBuildingId: string | null;
};

export type SettlementSeedRoadPlan = {
  activeBranches: number;
  shortBranches: number;
  recoverableBranches: number;
  exposedBranches: number;
  seedShortfall: number;
  potentialCoverage: number;
  uncoveredShortfall: number;
  fragmentationCoverage: number;
  unmatchedRecoveryGrain: number;
  unroutableShortfall: number;
  firstExposedBuildingId: string | null;
  branches: ReadonlyMap<string, SettlementSeedRoadBranch>;
};

type SettlementSeedProcurementInput = {
  state: Pick<GameState, 'buildings' | 'deliveryTrips'>
    & Partial<Pick<GameState, 'fireIncidents' | 'physicalFoundingSiteEnabled'>>;
  seedShortfall: number;
  seedGrainByHolding?: ReadonlyMap<string, number>;
  availableGold: number;
  nextLotGoldCost: number;
  conflictEnabled: boolean;
  hasRoadAccess: (building: BuildingState) => boolean;
  roadComponentFor?: ProductionRoadComponentResolver;
};

type AttentionCandidate = {
  buildingId: string;
  kind: SettlementSeedProcurementAttention;
  priority: number;
};

type MutableSeedRoadBranch = SettlementSeedRoadBranch & {
  firstHoldingCoverage: number;
};

const ATTENTION_PRIORITY: Record<SettlementSeedProcurementAttention, number> = {
  construction: 0,
  fire: 1,
  labor: 2,
  road: 3,
  'cash-policy': 4,
  treasury: 5,
  ironwork: 6,
  cooldown: 7,
  'cash-inbound': 8,
  'cash-cart': 9,
};

function positiveFinite(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

function seedRoadBranch(
  branches: Map<string, MutableSeedRoadBranch>,
  key: string,
): MutableSeedRoadBranch {
  let branch = branches.get(key);
  if (branch) return branch;
  branch = {
    seedShortfall: 0,
    currentMarketStock: 0,
    currentGranaryStock: 0,
    plannedImportGrain: 0,
    potentialCoverage: 0,
    uncoveredShortfall: 0,
    firstShortBuildingId: null,
    firstHoldingCoverage: Number.POSITIVE_INFINITY,
  };
  branches.set(key, branch);
  return branch;
}

function inboundSeedByHolding(
  state: Pick<GameState, 'deliveryTrips'>,
): Map<string, number> {
  const inbound = new Map<string, number>();
  for (const trip of state.deliveryTrips.values()) {
    if (
      trip.phase === 'inbound'
      || trip.destinationKind !== 'building'
      || trip.targetBuildingId === null
      || trip.cargoKind !== 'grain'
      || trip.amount <= 1e-9
    ) {
      continue;
    }
    inbound.set(
      trip.targetBuildingId,
      (inbound.get(trip.targetBuildingId) ?? 0) + positiveFinite(trip.amount),
    );
  }
  return inbound;
}

function inboundGoldByMarket(
  state: Pick<GameState, 'deliveryTrips'>,
): Map<string, number> {
  const inbound = new Map<string, number>();
  for (const trip of state.deliveryTrips.values()) {
    if (
      trip.phase === 'inbound'
      || trip.destinationKind !== 'building'
      || trip.targetBuildingId === null
      || trip.cargoKind !== 'gold'
      || trip.amount <= 1e-9
    ) {
      continue;
    }
    inbound.set(
      trip.targetBuildingId,
      (inbound.get(trip.targetBuildingId) ?? 0) + positiveFinite(trip.amount),
    );
  }
  return inbound;
}

function seedRoadDemand(input: SettlementSeedProcurementInput): {
  branches: Map<string, MutableSeedRoadBranch> | null;
  seedShortfall: number;
  unroutableShortfall: number;
  inboundSeedGrain: number;
} {
  const fallbackShortfall = positiveFinite(input.seedShortfall);
  if (!input.seedGrainByHolding || !input.roadComponentFor) {
    return {
      branches: null,
      seedShortfall: fallbackShortfall,
      unroutableShortfall: 0,
      inboundSeedGrain: 0,
    };
  }

  const branches = new Map<string, MutableSeedRoadBranch>();
  const inbound = inboundSeedByHolding(input.state);
  let preInboundShortfall = 0;
  let routableShortfall = 0;
  let unroutableShortfall = 0;
  let inboundSeedGrain = 0;

  for (const [buildingId, rawRequired] of input.seedGrainByHolding) {
    const required = positiveFinite(rawRequired);
    if (required <= 1e-9) continue;
    const farmstead = input.state.buildings.get(buildingId);
    if (
      farmstead?.kind !== 'threshing_barn'
      || farmstead.constructionComplete === false
    ) {
      preInboundShortfall += required;
      unroutableShortfall += required;
      continue;
    }

    const onsite = positiveFinite(farmstead.grain);
    const preInboundGap = Math.max(0, required - onsite);
    preInboundShortfall += preInboundGap;
    const approaching = positiveFinite(inbound.get(buildingId));
    inboundSeedGrain += Math.min(preInboundGap, approaching);
    const shortfall = Math.max(0, preInboundGap - approaching);
    if (shortfall <= 1e-9) continue;

    const branch = seedRoadBranch(
      branches,
      productionRoadBranchKey(
        input.roadComponentFor(farmstead),
        'building',
        farmstead.id,
      ),
    );
    branch.seedShortfall += shortfall;
    routableShortfall += shortfall;
    const coverage = required > 1e-9
      ? Math.min(1, (onsite + approaching) / required)
      : 1;
    if (
      branch.firstShortBuildingId === null
      || coverage < branch.firstHoldingCoverage - 1e-9
      || (
        Math.abs(coverage - branch.firstHoldingCoverage) <= 1e-9
        && compareStableEntityIds(
          farmstead.id,
          branch.firstShortBuildingId,
        ) < 0
      )
    ) {
      branch.firstHoldingCoverage = coverage;
      branch.firstShortBuildingId = farmstead.id;
    }
  }

  unroutableShortfall += Math.max(
    0,
    fallbackShortfall - preInboundShortfall,
  );
  return {
    branches,
    seedShortfall: routableShortfall + unroutableShortfall,
    unroutableShortfall,
    inboundSeedGrain,
  };
}

function buildSeedRoadPlan(input: {
  branches: Map<string, MutableSeedRoadBranch> | null;
  seedShortfall: number;
  unroutableShortfall: number;
  totalRecoveryGrain: number;
}): SettlementSeedRoadPlan | null {
  if (!input.branches) return null;
  let shortBranches = 0;
  let recoverableBranches = 0;
  let exposedBranches = 0;
  let potentialCoverage = 0;
  let firstExposedBuildingId: string | null = null;
  let firstExposureCoverage = Number.POSITIVE_INFINITY;
  let firstExposureShortfall = 0;

  for (const branch of input.branches.values()) {
    const recoveryGrain = positiveFinite(branch.currentMarketStock)
      + positiveFinite(branch.currentGranaryStock)
      + positiveFinite(branch.plannedImportGrain);
    branch.potentialCoverage = Math.min(branch.seedShortfall, recoveryGrain);
    branch.uncoveredShortfall = Math.max(
      0,
      branch.seedShortfall - branch.potentialCoverage,
    );
    potentialCoverage += branch.potentialCoverage;
    if (branch.seedShortfall <= 1e-9) continue;
    shortBranches += 1;
    if (branch.uncoveredShortfall <= 0.05) {
      recoverableBranches += 1;
      continue;
    }
    exposedBranches += 1;
    const coverage = branch.seedShortfall > 1e-9
      ? branch.potentialCoverage / branch.seedShortfall
      : 1;
    if (
      branch.firstShortBuildingId !== null
      && (
        coverage < firstExposureCoverage - 1e-9
        || (
          Math.abs(coverage - firstExposureCoverage) <= 1e-9
          && (
            branch.uncoveredShortfall > firstExposureShortfall + 1e-9
            || (
              Math.abs(
                branch.uncoveredShortfall - firstExposureShortfall,
              ) <= 1e-9
              && (
                firstExposedBuildingId === null
                || compareStableEntityIds(
                  branch.firstShortBuildingId,
                  firstExposedBuildingId,
                ) < 0
              )
            )
          )
        )
      )
    ) {
      firstExposureCoverage = coverage;
      firstExposureShortfall = branch.uncoveredShortfall;
      firstExposedBuildingId = branch.firstShortBuildingId;
    }
  }

  const uncoveredShortfall = Math.max(
    0,
    input.seedShortfall - potentialCoverage,
  );
  const globalPotentialCoverage = Math.min(
    input.seedShortfall,
    input.totalRecoveryGrain,
  );
  return {
    activeBranches: input.branches.size,
    shortBranches,
    recoverableBranches,
    exposedBranches,
    seedShortfall: input.seedShortfall,
    potentialCoverage,
    uncoveredShortfall,
    fragmentationCoverage: Math.max(
      0,
      globalPotentialCoverage - potentialCoverage,
    ),
    unmatchedRecoveryGrain: Math.max(
      0,
      input.totalRecoveryGrain - potentialCoverage,
    ),
    unroutableShortfall: input.unroutableShortfall,
    firstExposedBuildingId,
    branches: input.branches,
  };
}

function earlierAttention(
  current: AttentionCandidate | null,
  buildingId: string,
  kind: SettlementSeedProcurementAttention,
): AttentionCandidate {
  const candidate = {
    buildingId,
    kind,
    priority: ATTENTION_PRIORITY[kind],
  };
  if (
    current === null
    || candidate.priority < current.priority
    || (
      candidate.priority === current.priority
      && compareStableEntityIds(candidate.buildingId, current.buildingId) < 0
    )
  ) {
    return candidate;
  }
  return current;
}

/**
 * Inspector-time settlement forecast for configured seed-grain imports.
 *
 * Completed granary and marketplace stocks are grouped with seed-short holdings
 * by cached road component. Grain already approaching a holding reduces its
 * branch demand. Only lots which have not yet been bought appear as planned
 * imports, so callers can show the recovery ceiling without treating contingent
 * purchases as present stock.
 */
export function computeSettlementSeedProcurementPlan(
  input: SettlementSeedProcurementInput,
): SettlementSeedProcurementPlan {
  const roadDemand = seedRoadDemand(input);
  const seedShortfall = roadDemand.seedShortfall;
  const nextLotGoldCost = positiveFinite(input.nextLotGoldCost);
  const availableGold = positiveFinite(input.availableGold);
  const physicalCashEconomy =
    input.state.physicalFoundingSiteEnabled === true;
  const inboundMarketGoldById = physicalCashEconomy
    ? inboundGoldByMarket(input.state)
    : null;
  let forecastTreasuryGold = availableGold;
  let marketplaces = 0;
  let targetMarkets = 0;
  let dueMarkets = 0;
  let readyMarkets = 0;
  let currentMarketStock = 0;
  let currentGranaryStock = 0;
  let targetStock = 0;
  let plannedImportLots = 0;
  let onsiteFundedLotsAtCurrentRate = 0;
  let committedFundedLotsAtCurrentRate = 0;
  let treasuryRefillLotsAtCurrentRate = 0;
  let marketCofferGold = 0;
  let inboundMarketGold = 0;
  let selectedMarketReserveGold = 0;
  let constructionBlockedMarkets = 0;
  let fireBlockedMarkets = 0;
  let laborBlockedMarkets = 0;
  let roadBlockedMarkets = 0;
  let cashPolicyBlockedMarkets = 0;
  let cashInboundMarkets = 0;
  let cashCartMarkets = 0;
  let treasuryBlockedMarkets = 0;
  let ironworkQueuedMarkets = 0;
  let cooldownBlockedMarkets = 0;
  let firstAttention: AttentionCandidate | null = null;
  const fireDisabled = fireDisabledBuildingIds(
    input.state.fireIncidents?.values() ?? [],
  );

  for (const building of input.state.buildings.values()) {
    const completed = building.constructionComplete !== false;
    if (building.kind === 'granary' && completed) {
      const grain = positiveFinite(building.grain);
      currentGranaryStock += grain;
      if (roadDemand.branches && input.roadComponentFor) {
        seedRoadBranch(
          roadDemand.branches,
          productionRoadBranchKey(
            input.roadComponentFor(building),
            'building',
            building.id,
          ),
        ).currentGranaryStock += grain;
      }
      continue;
    }
    if (building.kind !== 'marketplace') continue;
    marketplaces += 1;
    const currentStock = completed ? positiveFinite(building.grain) : 0;
    currentMarketStock += currentStock;
    let branch: MutableSeedRoadBranch | null = null;
    if (roadDemand.branches && input.roadComponentFor) {
      branch = seedRoadBranch(
        roadDemand.branches,
        productionRoadBranchKey(
          input.roadComponentFor(building),
          'building',
          building.id,
        ),
      );
      branch.currentMarketStock += currentStock;
    }
    const procurement = marketplaceSeedGrainProcurementPlan(building);
    if (procurement.target <= 0) continue;
    targetMarkets += 1;
    targetStock += procurement.target;
    plannedImportLots += procurement.ordersToTarget;
    const onsiteGold = physicalCashEconomy
      ? positiveFinite(building.gold)
      : 0;
    const approachingGold = physicalCashEconomy
      ? positiveFinite(inboundMarketGoldById?.get(building.id))
      : 0;
    const reserveTarget = physicalCashEconomy
      ? marketplaceGoldReserveTarget(building)
      : 0;
    if (physicalCashEconomy) {
      marketCofferGold += onsiteGold;
      inboundMarketGold += approachingGold;
      selectedMarketReserveGold += reserveTarget;
      if (nextLotGoldCost <= 1e-9) {
        onsiteFundedLotsAtCurrentRate += procurement.ordersToTarget;
        committedFundedLotsAtCurrentRate += procurement.ordersToTarget;
      } else {
        const onsiteLots = Math.min(
          procurement.ordersToTarget,
          Math.floor((onsiteGold + 1e-6) / nextLotGoldCost),
        );
        const committedLots = Math.min(
          procurement.ordersToTarget,
          Math.floor(
            (onsiteGold + approachingGold + 1e-6) / nextLotGoldCost,
          ),
        );
        onsiteFundedLotsAtCurrentRate += onsiteLots;
        committedFundedLotsAtCurrentRate += committedLots;
        let simulatedMarketGold =
          onsiteGold + approachingGold - committedLots * nextLotGoldCost;
        let remainingOrders = procurement.ordersToTarget - committedLots;
        while (
          remainingOrders > 0
          && reserveTarget + 1e-6 >= nextLotGoldCost
          && forecastTreasuryGold > 1e-9
        ) {
          const refill = Math.min(
            forecastTreasuryGold,
            Math.max(0, reserveTarget - simulatedMarketGold),
          );
          if (refill <= 1e-9) break;
          forecastTreasuryGold -= refill;
          simulatedMarketGold += refill;
          if (simulatedMarketGold + 1e-6 < nextLotGoldCost) break;
          simulatedMarketGold -= nextLotGoldCost;
          remainingOrders -= 1;
          treasuryRefillLotsAtCurrentRate += 1;
        }
      }
    }
    if (branch) {
      branch.plannedImportGrain +=
        procurement.ordersToTarget * MARKETPLACE_SEED_GRAIN_IMPORT_LOT;
    }
    if (!procurement.nextOrderDue) continue;
    dueMarkets += 1;

    let attention: SettlementSeedProcurementAttention | null = null;
    if (building.constructionComplete === false) {
      constructionBlockedMarkets += 1;
      attention = 'construction';
    } else if (fireDisabled.has(building.id)) {
      fireBlockedMarkets += 1;
      attention = 'fire';
    } else if (building.assignedLabor <= 0) {
      laborBlockedMarkets += 1;
      attention = 'labor';
    } else if (!input.hasRoadAccess(building)) {
      roadBlockedMarkets += 1;
      attention = 'road';
    } else if (nextMarketplaceStandingOrder(building, input.conflictEnabled) === 'ironwork') {
      ironworkQueuedMarkets += 1;
      attention = 'ironwork';
    } else if (building.actionCooldown > 1e-6) {
      cooldownBlockedMarkets += 1;
      attention = 'cooldown';
    } else if (!physicalCashEconomy && nextLotGoldCost > availableGold + 1e-6) {
      treasuryBlockedMarkets += 1;
      attention = 'treasury';
    } else if (
      physicalCashEconomy
      && onsiteGold + 1e-6 >= nextLotGoldCost
    ) {
      readyMarkets += 1;
    } else if (
      physicalCashEconomy
      && onsiteGold + approachingGold + 1e-6 >= nextLotGoldCost
    ) {
      cashInboundMarkets += 1;
      attention = 'cash-inbound';
    } else if (
      physicalCashEconomy
      && reserveTarget + 1e-6 < nextLotGoldCost
    ) {
      cashPolicyBlockedMarkets += 1;
      attention = 'cash-policy';
    } else if (
      physicalCashEconomy
      && nextLotGoldCost
        > onsiteGold + approachingGold + availableGold + 1e-6
    ) {
      treasuryBlockedMarkets += 1;
      attention = 'treasury';
    } else if (physicalCashEconomy) {
      cashCartMarkets += 1;
      attention = 'cash-cart';
    } else {
      readyMarkets += 1;
    }

    if (attention !== null) {
      firstAttention = earlierAttention(
        firstAttention,
        building.id,
        attention,
      );
    }
  }

  const plannedImportGrain =
    plannedImportLots * MARKETPLACE_SEED_GRAIN_IMPORT_LOT;
  const totalRecoveryGrain =
    currentMarketStock + currentGranaryStock + plannedImportGrain;
  const roadPlan = buildSeedRoadPlan({
    branches: roadDemand.branches,
    seedShortfall,
    unroutableShortfall: roadDemand.unroutableShortfall,
    totalRecoveryGrain,
  });
  const potentialCoverage = roadPlan?.potentialCoverage
    ?? Math.min(seedShortfall, totalRecoveryGrain);
  if (!physicalCashEconomy) {
    treasuryRefillLotsAtCurrentRate = nextLotGoldCost > 1e-9
      ? Math.min(
          plannedImportLots,
          Math.floor((availableGold + 1e-6) / nextLotGoldCost),
        )
      : plannedImportLots;
  }
  if (!physicalCashEconomy) {
    onsiteFundedLotsAtCurrentRate = 0;
    committedFundedLotsAtCurrentRate = 0;
  }
  const affordableLotsAtCurrentRate = physicalCashEconomy
    ? Math.min(
        plannedImportLots,
        committedFundedLotsAtCurrentRate
          + treasuryRefillLotsAtCurrentRate,
      )
    : treasuryRefillLotsAtCurrentRate;

  return {
    marketplaces,
    targetMarkets,
    dueMarkets,
    readyMarkets,
    currentMarketStock,
    currentGranaryStock,
    targetStock,
    plannedImportLots,
    plannedImportGrain,
    inboundSeedGrain: roadDemand.inboundSeedGrain,
    affordableLotsAtCurrentRate,
    onsiteFundedLotsAtCurrentRate,
    committedFundedLotsAtCurrentRate,
    treasuryRefillLotsAtCurrentRate,
    nextLotGoldCost,
    physicalCashEconomy,
    availableTreasuryGold: availableGold,
    marketCofferGold,
    inboundMarketGold,
    selectedMarketReserveGold,
    seedShortfall,
    potentialCoverage,
    uncoveredShortfall: Math.max(0, seedShortfall - potentialCoverage),
    constructionBlockedMarkets,
    fireBlockedMarkets,
    laborBlockedMarkets,
    roadBlockedMarkets,
    cashPolicyBlockedMarkets,
    cashInboundMarkets,
    cashCartMarkets,
    treasuryBlockedMarkets,
    ironworkQueuedMarkets,
    cooldownBlockedMarkets,
    firstAttentionMarketId: firstAttention?.buildingId ?? null,
    firstAttentionKind: firstAttention?.kind ?? null,
    roadPlan,
  };
}
