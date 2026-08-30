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
import { NAMED_FOOD_LABELS } from './foodInventory.ts';

export type RegionalMarketState = {
  timberPriceMult: number;
  stonePriceMult: number;
  firewoodPriceMult: number;
  foodPriceMult: number;
  specialtyPriceMult: number;
  drinkPriceMult: number;
  provisionPriceMult: number;
  waresPriceMult: number;
  regionalFoodDemand: number;
  regionalFoodSupply: number;
  regionalSpecialtyDemand: number;
  regionalDrinkDemand: number;
  regionalProvisionDemand: number;
  regionalWaresDemand: number;
  bulletin: string;
};

export const DEFAULT_REGIONAL_MARKET_STATE: RegionalMarketState = {
  timberPriceMult: 1,
  stonePriceMult: 1,
  firewoodPriceMult: 1,
  foodPriceMult: 1,
  specialtyPriceMult: 1,
  drinkPriceMult: 1,
  provisionPriceMult: 1,
  waresPriceMult: 1,
  regionalFoodDemand: 0.5,
  regionalFoodSupply: 0.5,
  regionalSpecialtyDemand: 0.5,
  regionalDrinkDemand: 0.5,
  regionalProvisionDemand: 0.5,
  regionalWaresDemand: 0.5,
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
    case 'polearms':
    case 'iron':
    case 'clay':
    case 'roofTiles':
      return state.stonePriceMult;
    case 'firewood':
    case 'water':
    case 'charcoal':
      return state.firewoodPriceMult;
    case 'ryeSheaves':
    case 'oatSheaves':
    case 'barleySheaves':
    case 'maslinSheaves':
    case 'ryeGrain':
    case 'oatGrain':
    case 'maslinGrain':
    case 'ryeFlour':
    case 'maslinFlour':
    case 'ryeBread':
    case 'maslinBread':
    case 'barley':
    case 'malt':
    case 'flax':
    case 'salt':
    case 'meat':
    case 'fish':
    case 'berries':
    case 'mushrooms':
    case 'milk':
    case 'apples':
    case 'pears':
    case 'cherries':
    case 'aronia':
    case 'rosehips':
    case 'cabbage':
    case 'carrots':
    case 'beetroot':
    case 'eggs':
    case 'grapes':
      return state.foodPriceMult;
    case 'ale':
    case 'cider':
    case 'pearCider':
    case 'wine':
      return state.drinkPriceMult;
    case 'preservedFood':
    case 'honey':
    case 'curedMeat':
    case 'smokedFish':
    case 'cheese':
    case 'aroniaJam':
    case 'rosehipJam':
      return state.provisionPriceMult;
    case 'wool':
    case 'yarn':
    case 'linen':
    case 'cloth':
    case 'pelts':
    case 'hides':
    case 'leather':
    case 'shoes':
    case 'sidearms':
    case 'shields':
    case 'bows':
    case 'crossbows':
    case 'paddedArmor':
    case 'mailArmor':
    case 'ammunition':
    case 'wax':
    case 'candles':
    case 'pottery':
    case 'manure':
    case 'remedies':
      return state.waresPriceMult;
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
    ['Iron', 'iron'],
    ['Firewood', 'firewood'],
    ['Food & seed grain', 'ryeGrain'],
    ['Salt', 'salt'],
  ];
  const bulkRates = rates
    .map(([label, resource]) => {
      const signal = formatPriceMultiplier(priceMultiplierFor(state, resource)) ?? 'steady';
      return `${label} ${signal}`;
    })
    .join(' · ');
  const drink = formatPriceMultiplier(state.drinkPriceMult) ?? 'steady';
  const provisions = formatPriceMultiplier(state.provisionPriceMult) ?? 'steady';
  const wares = formatPriceMultiplier(state.waresPriceMult) ?? 'steady';
  return `${bulkRates} · Drinks ${drink} · Provisions ${provisions} · Wares ${wares}`;
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
  const resource = NAMED_FOOD_LABELS[commodity.resourceKind].toLowerCase();
  return `${commodity.label} — ${commodity.foodAmount} ${resource} for ${gold} gold`;
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
    return 'Closed — assign a regional trader to open a route';
  }
  return `${workers} concurrent route slot${workers === 1 ? '' : 's'} — ${assignedLabor} regional trader${assignedLabor === 1 ? '' : 's'} assigned`;
}

export function clampMarketMultiplier(value: number): number {
  return Math.min(MARKET_PRICE_MULTIPLIER_MAX, Math.max(MARKET_PRICE_MULTIPLIER_MIN, value));
}

export { MARKET_COMMODITIES, MARKET_WATER_COMMODITIES };
