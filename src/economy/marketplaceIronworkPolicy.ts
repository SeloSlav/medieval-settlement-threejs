import {
  MARKETPLACE_TRADE_OFFERS,
} from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';

export const MARKETPLACE_IRONWORK_TARGETS = [0, 6, 12, 24, 48] as const;
export type MarketplaceIronworkTarget = (typeof MARKETPLACE_IRONWORK_TARGETS)[number];

type IronworkImportOffer = Extract<
  (typeof MARKETPLACE_TRADE_OFFERS)[number],
  { id: 'buy_ironwork' }
>;

function ironworkImportOffer(): IronworkImportOffer {
  const offer = MARKETPLACE_TRADE_OFFERS.find(
    (candidate) => candidate.id === 'buy_ironwork',
  );
  if (!offer || offer.kind !== 'goldBuy' || offer.resource !== 'ironwork') {
    throw new Error('Generated balance is missing the frontier ironwork import offer.');
  }
  return offer;
}

export const MARKETPLACE_IRONWORK_IMPORT_OFFER = ironworkImportOffer();
export const MARKETPLACE_IRONWORK_IMPORT_LOT = MARKETPLACE_IRONWORK_IMPORT_OFFER.amount;

export function normalizeMarketplaceIronworkTarget(target: number | undefined): MarketplaceIronworkTarget {
  const value = Math.max(0, Math.floor(target ?? 0));
  for (let index = MARKETPLACE_IRONWORK_TARGETS.length - 1; index >= 0; index -= 1) {
    const candidate = MARKETPLACE_IRONWORK_TARGETS[index];
    if (candidate <= value) return candidate;
  }
  return 0;
}

export type MarketplaceIronworkProcurementPlan = {
  target: MarketplaceIronworkTarget;
  stock: number;
  ordersToTarget: number;
  nextOrderDue: boolean;
};

export function marketplaceIronworkProcurementPlan(
  building: Pick<BuildingState, 'ironwork' | 'marketplaceIronworkTarget'>,
): MarketplaceIronworkProcurementPlan {
  const target = normalizeMarketplaceIronworkTarget(building.marketplaceIronworkTarget);
  const stock = Math.max(0, building.ironwork ?? 0);
  const ordersToTarget = target <= 0
    ? 0
    : Math.floor(Math.max(0, target - stock) / MARKETPLACE_IRONWORK_IMPORT_LOT);
  return {
    target,
    stock,
    ordersToTarget,
    nextOrderDue: ordersToTarget > 0,
  };
}
