import {
  MARKETPLACE_TRADE_OFFERS,
} from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';

export const MARKETPLACE_IRON_TARGETS = [0, 12, 24, 36, 48] as const;
export type MarketplaceIronTarget = (typeof MARKETPLACE_IRON_TARGETS)[number];

export const MARKETPLACE_SALT_TARGETS = [0, 12, 24, 48, 72] as const;
export type MarketplaceSaltTarget = (typeof MARKETPLACE_SALT_TARGETS)[number];

type IronImportOffer = Extract<
  (typeof MARKETPLACE_TRADE_OFFERS)[number],
  { id: 'buy_iron' }
>;
type SaltImportOffer = Extract<
  (typeof MARKETPLACE_TRADE_OFFERS)[number],
  { id: 'buy_salt' }
>;

function ironImportOffer(): IronImportOffer {
  const offer = MARKETPLACE_TRADE_OFFERS.find(
    (candidate) => candidate.id === 'buy_iron',
  );
  if (!offer || offer.kind !== 'goldBuy' || offer.resource !== 'iron') {
    throw new Error('Generated balance is missing the raw-iron import offer.');
  }
  return offer;
}

function saltImportOffer(): SaltImportOffer {
  const offer = MARKETPLACE_TRADE_OFFERS.find(
    (candidate) => candidate.id === 'buy_salt',
  );
  if (!offer || offer.kind !== 'goldBuy' || offer.resource !== 'salt') {
    throw new Error('Generated balance is missing the salt import offer.');
  }
  return offer;
}

export const MARKETPLACE_IRON_IMPORT_OFFER = ironImportOffer();
export const MARKETPLACE_IRON_IMPORT_LOT = MARKETPLACE_IRON_IMPORT_OFFER.amount;
export const MARKETPLACE_SALT_IMPORT_OFFER = saltImportOffer();
export const MARKETPLACE_SALT_IMPORT_LOT = MARKETPLACE_SALT_IMPORT_OFFER.amount;

export function normalizeMarketplaceIronTarget(
  target: number | undefined,
): MarketplaceIronTarget {
  const value = Math.max(0, Math.floor(target ?? 0));
  for (let index = MARKETPLACE_IRON_TARGETS.length - 1; index >= 0; index -= 1) {
    const candidate = MARKETPLACE_IRON_TARGETS[index];
    if (candidate <= value) return candidate;
  }
  return 0;
}

export function normalizeMarketplaceSaltTarget(
  target: number | undefined,
): MarketplaceSaltTarget {
  const value = Math.max(0, Math.floor(target ?? 0));
  for (let index = MARKETPLACE_SALT_TARGETS.length - 1; index >= 0; index -= 1) {
    const candidate = MARKETPLACE_SALT_TARGETS[index];
    if (candidate <= value) return candidate;
  }
  return 0;
}

export type MarketplaceMaterialProcurementPlan<Target extends number> = {
  target: Target;
  stock: number;
  ordersToTarget: number;
  nextOrderDue: boolean;
};

export function marketplaceIronProcurementPlan(
  building: Pick<BuildingState, 'iron' | 'marketplaceIronTarget'>,
): MarketplaceMaterialProcurementPlan<MarketplaceIronTarget> {
  const target = normalizeMarketplaceIronTarget(building.marketplaceIronTarget);
  return procurementPlan(target, building.iron, MARKETPLACE_IRON_IMPORT_LOT);
}

export function marketplaceSaltProcurementPlan(
  building: Pick<BuildingState, 'salt' | 'marketplaceSaltTarget'>,
): MarketplaceMaterialProcurementPlan<MarketplaceSaltTarget> {
  const target = normalizeMarketplaceSaltTarget(building.marketplaceSaltTarget);
  return procurementPlan(target, building.salt, MARKETPLACE_SALT_IMPORT_LOT);
}

function procurementPlan<Target extends number>(
  target: Target,
  stockValue: number | undefined,
  lot: number,
): MarketplaceMaterialProcurementPlan<Target> {
  const stock = Math.max(0, stockValue ?? 0);
  const ordersToTarget = target <= 0
    ? 0
    : Math.floor(Math.max(0, target - stock) / lot);
  return {
    target,
    stock,
    ordersToTarget,
    nextOrderDue: ordersToTarget > 0,
  };
}
