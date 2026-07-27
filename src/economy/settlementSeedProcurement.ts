import { compareStableEntityIds } from '../logistics/roadLogistics.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import {
  MARKETPLACE_SEED_GRAIN_IMPORT_LOT,
  marketplaceSeedGrainProcurementPlan,
  nextMarketplaceStandingOrder,
} from './marketplaceSeedPolicy.ts';

export type SettlementSeedProcurementAttention =
  | 'construction'
  | 'labor'
  | 'road'
  | 'treasury'
  | 'ironwork'
  | 'cooldown';

export type SettlementSeedProcurementPlan = {
  marketplaces: number;
  targetMarkets: number;
  dueMarkets: number;
  readyMarkets: number;
  currentMarketStock: number;
  targetStock: number;
  plannedImportLots: number;
  plannedImportGrain: number;
  affordableLotsAtCurrentRate: number;
  nextLotGoldCost: number;
  seedShortfall: number;
  potentialCoverage: number;
  uncoveredShortfall: number;
  constructionBlockedMarkets: number;
  laborBlockedMarkets: number;
  roadBlockedMarkets: number;
  treasuryBlockedMarkets: number;
  ironworkQueuedMarkets: number;
  cooldownBlockedMarkets: number;
  firstAttentionMarketId: string | null;
  firstAttentionKind: SettlementSeedProcurementAttention | null;
};

type SettlementSeedProcurementInput = {
  state: Pick<GameState, 'buildings'>;
  seedShortfall: number;
  availableGold: number;
  nextLotGoldCost: number;
  conflictEnabled: boolean;
  hasRoadAccess: (building: BuildingState) => boolean;
};

type AttentionCandidate = {
  buildingId: string;
  kind: SettlementSeedProcurementAttention;
  priority: number;
};

const ATTENTION_PRIORITY: Record<SettlementSeedProcurementAttention, number> = {
  construction: 0,
  labor: 1,
  road: 2,
  treasury: 3,
  ironwork: 4,
  cooldown: 5,
};

function positiveFinite(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 0;
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
 * Physical marketplace grain remains part of the owned grain ledger. Only lots
 * which have not yet been bought appear as planned imports, so callers can show
 * the recovery ceiling without treating contingent purchases as present stock.
 */
export function computeSettlementSeedProcurementPlan(
  input: SettlementSeedProcurementInput,
): SettlementSeedProcurementPlan {
  const seedShortfall = positiveFinite(input.seedShortfall);
  const nextLotGoldCost = positiveFinite(input.nextLotGoldCost);
  const availableGold = positiveFinite(input.availableGold);
  let marketplaces = 0;
  let targetMarkets = 0;
  let dueMarkets = 0;
  let readyMarkets = 0;
  let currentMarketStock = 0;
  let targetStock = 0;
  let plannedImportLots = 0;
  let constructionBlockedMarkets = 0;
  let laborBlockedMarkets = 0;
  let roadBlockedMarkets = 0;
  let treasuryBlockedMarkets = 0;
  let ironworkQueuedMarkets = 0;
  let cooldownBlockedMarkets = 0;
  let firstAttention: AttentionCandidate | null = null;

  for (const building of input.state.buildings.values()) {
    if (building.kind !== 'marketplace') continue;
    marketplaces += 1;
    currentMarketStock += positiveFinite(building.grain);
    const procurement = marketplaceSeedGrainProcurementPlan(building);
    if (procurement.target <= 0) continue;
    targetMarkets += 1;
    targetStock += procurement.target;
    plannedImportLots += procurement.ordersToTarget;
    if (!procurement.nextOrderDue) continue;
    dueMarkets += 1;

    let attention: SettlementSeedProcurementAttention | null = null;
    if (building.constructionComplete === false) {
      constructionBlockedMarkets += 1;
      attention = 'construction';
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
    } else if (nextLotGoldCost > availableGold + 1e-6) {
      treasuryBlockedMarkets += 1;
      attention = 'treasury';
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
  const potentialCoverage = Math.min(
    seedShortfall,
    currentMarketStock + plannedImportGrain,
  );
  const affordableLotsAtCurrentRate = nextLotGoldCost > 1e-9
    ? Math.min(plannedImportLots, Math.floor((availableGold + 1e-6) / nextLotGoldCost))
    : plannedImportLots;

  return {
    marketplaces,
    targetMarkets,
    dueMarkets,
    readyMarkets,
    currentMarketStock,
    targetStock,
    plannedImportLots,
    plannedImportGrain,
    affordableLotsAtCurrentRate,
    nextLotGoldCost,
    seedShortfall,
    potentialCoverage,
    uncoveredShortfall: Math.max(0, seedShortfall - potentialCoverage),
    constructionBlockedMarkets,
    laborBlockedMarkets,
    roadBlockedMarkets,
    treasuryBlockedMarkets,
    ironworkQueuedMarkets,
    cooldownBlockedMarkets,
    firstAttentionMarketId: firstAttention?.buildingId ?? null,
    firstAttentionKind: firstAttention?.kind ?? null,
  };
}
