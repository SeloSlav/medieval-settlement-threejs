import {
  MARKET_CARAVAN_LABOR_PER_WORKER,
  MARKET_CARAVAN_DELIVERY_WORKERS,
  MARKET_COMMODITIES,
  MARKET_WATER_COMMODITIES,
  MARKET_PRICE_MULTIPLIER_MAX,
  MARKET_PRICE_MULTIPLIER_MIN,
  MARKET_TRADE_IMPACT_PER_TEN_UNITS,
  type MarketCommodityOffer,
  type MarketWaterCommodityOffer,
  type MarketplaceGoldBuyOffer,
  type MarketplaceGoldSellOffer,
  type MarketplaceTradeOffer,
  type TradeResourceKind,
} from '../generated/gameBalance.ts';

export type RegionalMarketState = {
  timberPriceMult: number;
  stonePriceMult: number;
  firewoodPriceMult: number;
  foodPriceMult: number;
  specialtyPriceMult: number;
  regionalFoodDemand: number;
  regionalFoodSupply: number;
  regionalSpecialtyDemand: number;
  bulletin: string;
};

export const DEFAULT_REGIONAL_MARKET_STATE: RegionalMarketState = {
  timberPriceMult: 1,
  stonePriceMult: 1,
  firewoodPriceMult: 1,
  foodPriceMult: 1,
  specialtyPriceMult: 1,
  regionalFoodDemand: 0.5,
  regionalFoodSupply: 0.5,
  regionalSpecialtyDemand: 0.5,
  bulletin: 'Caravans from Kvarner and the nearby highlands report steady trade.',
};

export function priceMultiplierFor(
  state: RegionalMarketState,
  resource: TradeResourceKind,
): number {
  switch (resource) {
    case 'timber':
      return state.timberPriceMult;
    case 'stone':
    case 'ironwork':
      return state.stonePriceMult;
    case 'firewood':
      return state.firewoodPriceMult;
    case 'food':
    case 'grain':
    case 'barley':
      return state.foodPriceMult;
    default: {
      const unhandled: never = resource;
      return unhandled;
    }
  }
}

export function scaledGoldCost(base: number, multiplier: number): number {
  return Math.max(1, Math.ceil(base * multiplier));
}

export function scaledGoldYield(base: number, multiplier: number): number {
  return Math.max(0, Math.floor(base * multiplier));
}

export function effectiveCommodityGoldCost(
  commodity: MarketCommodityOffer,
  state: RegionalMarketState,
): number {
  return scaledGoldCost(commodity.baseGoldCost, state.foodPriceMult);
}

export function effectiveTradeGoldCost(
  offer: MarketplaceGoldBuyOffer,
  state: RegionalMarketState,
): number {
  return scaledGoldCost(offer.goldCost, priceMultiplierFor(state, offer.resource));
}

export function effectiveTradeGoldYield(
  offer: MarketplaceGoldSellOffer,
  state: RegionalMarketState,
): number {
  return scaledGoldYield(offer.goldYield, priceMultiplierFor(state, offer.resource));
}

export function formatPriceMultiplier(multiplier: number): string | null {
  if (Math.abs(multiplier - 1) < 0.04) return null;
  const pct = Math.round((multiplier - 1) * 100);
  if (pct > 0) return `+${pct}% market`;
  return `${pct}% market`;
}

export function formatRegionalRateSummary(state: RegionalMarketState): string {
  const rates: Array<[string, TradeResourceKind]> = [
    ['Timber', 'timber'],
    ['Stone', 'stone'],
    ['Firewood', 'firewood'],
    ['Food & seed grain', 'food'],
  ];
  const bulkRates = rates
    .map(([label, resource]) => {
      const signal = formatPriceMultiplier(priceMultiplierFor(state, resource)) ?? 'steady';
      return `${label} ${signal}`;
    })
    .join(' · ');
  const specialtySignal = formatPriceMultiplier(state.specialtyPriceMult) ?? 'steady';
  return `${bulkRates} · Specialties ${specialtySignal}`;
}

export function specialtyPriceMultiplier(demand: number): number {
  const boundedDemand = Math.min(1, Math.max(0, demand));
  return clampMarketMultiplier(1 + (boundedDemand * 2 - 1) * 0.55);
}

export function formatMarketDepthHint(): string {
  const points = Math.round(MARKET_TRADE_IMPACT_PER_TEN_UNITS * 100);
  return `Market depth: each 10-unit trade shifts regional supply or demand by about ${points} points. Repeated orders move prices; caravan routes settle gradually.`;
}

export function describeCommodityOffer(
  commodity: MarketCommodityOffer,
  state: RegionalMarketState,
): string {
  const gold = effectiveCommodityGoldCost(commodity, state);
  return `${commodity.label} — ${commodity.foodAmount} food for ${gold} gold`;
}

export function describeMarketplaceTradeOfferWithPrices(
  offer: MarketplaceTradeOffer,
  state: RegionalMarketState,
  resourceLabel: (resource: TradeResourceKind | 'gold') => string,
): string {
  switch (offer.kind) {
    case 'goldBuy': {
      const gold = effectiveTradeGoldCost(offer, state);
      if (offer.id === 'buy_seed_grain') {
        return `Import ${offer.amount} seed grain for ${gold} gold`;
      }
      if (offer.id === 'buy_barley_seed') {
        return `Import ${offer.amount} barley seed for ${gold} gold`;
      }
      return `Buy ${offer.amount} ${resourceLabel(offer.resource).toLowerCase()} for ${gold} gold`;
    }
    case 'goldSell': {
      const gold = effectiveTradeGoldYield(offer, state);
      return `Sell ${offer.amount} ${resourceLabel(offer.resource).toLowerCase()} for ${gold} gold`;
    }
    case 'barter':
      return `Trade ${offer.giveAmount} ${resourceLabel(offer.give).toLowerCase()} for ${offer.receiveAmount} ${resourceLabel(offer.receive).toLowerCase()}`;
    default: {
      const unhandled: never = offer;
      return unhandled;
    }
  }
}

export function effectiveWaterCommodityGoldCost(
  commodity: MarketWaterCommodityOffer,
  state: RegionalMarketState,
): number {
  return scaledGoldCost(commodity.baseGoldCost, state.firewoodPriceMult);
}

export function describeWaterCommodityOffer(
  commodity: MarketWaterCommodityOffer,
  state: RegionalMarketState,
): string {
  const gold = effectiveWaterCommodityGoldCost(commodity, state);
  return `${commodity.label} — ${commodity.waterAmount} water for ${gold} gold`;
}

export function marketplaceCaravanWorkers(assignedLabor: number): number {
  return MARKET_CARAVAN_DELIVERY_WORKERS + assignedLabor * MARKET_CARAVAN_LABOR_PER_WORKER;
}

export function formatMarketplaceCaravanCrew(assignedLabor: number): string {
  const workers = marketplaceCaravanWorkers(assignedLabor);
  if (assignedLabor <= 0) {
    return `${workers} caravan hand — baseline throughput`;
  }
  return `${workers} caravan hands — ${assignedLabor} marketplace worker${assignedLabor === 1 ? '' : 's'} assigned`;
}

export function clampMarketMultiplier(value: number): number {
  return Math.min(MARKET_PRICE_MULTIPLIER_MAX, Math.max(MARKET_PRICE_MULTIPLIER_MIN, value));
}

export { MARKET_COMMODITIES, MARKET_WATER_COMMODITIES };
