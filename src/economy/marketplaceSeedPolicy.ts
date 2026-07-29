import {
  MARKETPLACE_TRADE_OFFERS,
} from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import {
  marketplaceIronworkProcurementPlan,
} from './marketplaceIronworkPolicy.ts';
import {
  marketplaceIronProcurementPlan,
  marketplaceSaltProcurementPlan,
} from './marketplaceMaterialProcurementPolicy.ts';

export const MARKETPLACE_SEED_GRAIN_TARGETS = [0, 24, 48, 72, 96] as const;
export type MarketplaceSeedGrainTarget = (typeof MARKETPLACE_SEED_GRAIN_TARGETS)[number];

type SeedGrainImportOffer = Extract<
  (typeof MARKETPLACE_TRADE_OFFERS)[number],
  { id: 'buy_seed_grain' }
>;

function seedGrainImportOffer(): SeedGrainImportOffer {
  const offer = MARKETPLACE_TRADE_OFFERS.find(
    (candidate) => candidate.id === 'buy_seed_grain',
  );
  if (!offer || offer.kind !== 'goldBuy' || offer.resource !== 'grain') {
    throw new Error('Generated balance is missing the seed-grain import offer.');
  }
  return offer;
}

export const MARKETPLACE_SEED_GRAIN_IMPORT_OFFER = seedGrainImportOffer();
export const MARKETPLACE_SEED_GRAIN_IMPORT_LOT = MARKETPLACE_SEED_GRAIN_IMPORT_OFFER.amount;

export function normalizeMarketplaceSeedGrainTarget(
  target: number | undefined,
): MarketplaceSeedGrainTarget {
  const value = Math.max(0, Math.floor(target ?? 0));
  for (let index = MARKETPLACE_SEED_GRAIN_TARGETS.length - 1; index >= 0; index -= 1) {
    const candidate = MARKETPLACE_SEED_GRAIN_TARGETS[index];
    if (candidate <= value) return candidate;
  }
  return 0;
}

export type MarketplaceSeedGrainProcurementPlan = {
  target: MarketplaceSeedGrainTarget;
  stock: number;
  ordersToTarget: number;
  nextOrderDue: boolean;
};

export function marketplaceSeedGrainProcurementPlan(
  building: Pick<BuildingState, 'grain' | 'marketplaceSeedGrainTarget'>,
): MarketplaceSeedGrainProcurementPlan {
  const target = normalizeMarketplaceSeedGrainTarget(building.marketplaceSeedGrainTarget);
  const stock = Math.max(0, building.grain ?? 0);
  const ordersToTarget = target <= 0
    ? 0
    : Math.floor(Math.max(0, target - stock) / MARKETPLACE_SEED_GRAIN_IMPORT_LOT);
  return {
    target,
    stock,
    ordersToTarget,
    nextOrderDue: ordersToTarget > 0,
  };
}

export type MarketplaceStandingOrder =
  | 'seedGrain'
  | 'salt'
  | 'iron'
  | 'ironwork'
  | null;

export function nextMarketplaceStandingOrder(
  building: Pick<
    BuildingState,
    | 'grain'
    | 'ironwork'
    | 'iron'
    | 'salt'
    | 'marketplaceSeedGrainTarget'
    | 'marketplaceIronworkTarget'
    | 'marketplaceIronTarget'
    | 'marketplaceSaltTarget'
  >,
  conflictEnabled: boolean,
): MarketplaceStandingOrder {
  const seed = marketplaceSeedGrainProcurementPlan(building);
  const ironwork = marketplaceIronworkProcurementPlan(building);
  const iron = marketplaceIronProcurementPlan(building);
  const salt = marketplaceSaltProcurementPlan(building);
  let nextOrder: MarketplaceStandingOrder = null;
  let nextStock = 0;
  let nextTarget = 1;

  if (seed.nextOrderDue) {
    nextOrder = 'seedGrain';
    nextStock = seed.stock;
    nextTarget = seed.target;
  }
  if (
    salt.nextOrderDue
    && (
      nextOrder === null
      || salt.stock * nextTarget < nextStock * salt.target
    )
  ) {
    nextOrder = 'salt';
    nextStock = salt.stock;
    nextTarget = salt.target;
  }
  if (
    iron.nextOrderDue
    && (
      nextOrder === null
      || iron.stock * nextTarget < nextStock * iron.target
    )
  ) {
    nextOrder = 'iron';
    nextStock = iron.stock;
    nextTarget = iron.target;
  }
  if (
    conflictEnabled
    && ironwork.nextOrderDue
    && (
      nextOrder === null
      || ironwork.stock * nextTarget < nextStock * ironwork.target
    )
  ) {
    nextOrder = 'ironwork';
  }
  return nextOrder;
}
