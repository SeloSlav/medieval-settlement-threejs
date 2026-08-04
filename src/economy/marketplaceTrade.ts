import {
  BUILDING_STORAGE_CAPS,
  MARKETPLACE_BULK_TRADE_COOLDOWN_SECONDS,
  MARKETPLACE_TRADE_OFFERS,
  TRADE_RESOURCE_SPEND_SCOPES,
  type MarketplaceBarterOffer,
  type MarketplaceTradeOffer,
  type TradeResourceKind,
} from '../generated/gameBalance.ts';
import type { RegionalMarketState } from './regionalMarket.ts';
import {
  DEFAULT_REGIONAL_MARKET_STATE,
  describeCommodityOffer,
  describeMarketplaceTradeOfferWithPrices,
  describeWaterCommodityOffer,
  effectiveCommodityGoldCost,
  effectiveTradeGoldCost,
  effectiveWaterCommodityGoldCost,
  MARKET_COMMODITIES,
  MARKET_WATER_COMMODITIES,
} from './regionalMarket.ts';
import type { MarketCommodityOffer, MarketWaterCommodityOffer } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import { freshFoodStock, preservedFoodStock } from './foodInventory.ts';

export type MarketplaceTradeAvailability = Record<TradeResourceKind | 'gold', number>;

// Stable save codes mirror the authoritative server mapping. They are
// intentionally independent of balance-file presentation order.
const PENDING_TRADE_IDS: Record<number, string> = {
  1: 'sell_timber',
  2: 'sell_stone',
  3: 'sell_firewood',
  4: 'sell_food',
  5: 'timber_for_stone',
  6: 'stone_for_timber',
  7: 'timber_for_firewood',
  8: 'sell_pottery',
};

const RESOURCE_LABELS: Record<TradeResourceKind | 'gold', string> = {
  timber: 'Timber',
  stone: 'Stone',
  firewood: 'Firewood',
  food: 'Bread',
  grain: 'Grain',
  barley: 'Barley',
  ironwork: 'Ironwork',
  iron: 'Iron',
  salt: 'Salt',
  pottery: 'Pottery',
  gold: 'Gold',
};

export function tradeResourceLabel(resource: TradeResourceKind | 'gold'): string {
  return RESOURCE_LABELS[resource];
}

export function describeMarketplaceTradeOffer(offer: MarketplaceTradeOffer): string {
  return describeMarketplaceTradeOfferWithPrices(offer, DEFAULT_REGIONAL_MARKET_STATE, tradeResourceLabel);
}

export function describeMarketplaceTradeOfferForMarket(
  offer: MarketplaceTradeOffer,
  marketState: RegionalMarketState,
): string {
  return describeMarketplaceTradeOfferWithPrices(offer, marketState, tradeResourceLabel);
}

export function marketplaceTradeOfferCost(
  offer: MarketplaceTradeOffer,
  marketState: RegionalMarketState = DEFAULT_REGIONAL_MARKET_STATE,
): { resource: TradeResourceKind | 'gold'; amount: number } {
  switch (offer.kind) {
    case 'goldBuy':
      return { resource: 'gold', amount: effectiveTradeGoldCost(offer, marketState) };
    case 'goldSell':
      return { resource: offer.resource, amount: offer.amount };
    case 'barter':
      return { resource: offer.give, amount: offer.giveAmount };
    default: {
      const unhandled: never = offer;
      return unhandled;
    }
  }
}

export function marketplacePendingTradeOffer(
  code: number | undefined,
): MarketplaceTradeOffer | null {
  const tradeId = PENDING_TRADE_IDS[Math.floor(code ?? 0)];
  if (!tradeId) return null;
  return MARKETPLACE_TRADE_OFFERS.find((offer) => offer.id === tradeId) ?? null;
}

export type MarketplaceTradeStagingPlan = {
  resource: TradeResourceKind | null;
  required: number;
  localStock: number;
  missing: number;
  requiresStaging: boolean;
  inbound: boolean;
};

/**
 * Physical-economy exports settle only from goods already at this Trading Post.
 * The first click may therefore order a visible inbound staging cart rather
 * than immediately changing regional prices or paying the settlement.
 */
export function marketplaceTradeStagingPlan(
  building: BuildingState,
  offer: MarketplaceTradeOffer,
  physicalEconomy: boolean,
  inboundResources: ReadonlySet<TradeResourceKind> = new Set(),
): MarketplaceTradeStagingPlan {
  const cost = marketplaceTradeOfferCost(offer);
  if (!physicalEconomy || cost.resource === 'gold') {
    return {
      resource: null,
      required: 0,
      localStock: 0,
      missing: 0,
      requiresStaging: false,
      inbound: false,
    };
  }
  const localStock = Math.max(0, building[cost.resource] ?? 0);
  const missing = Math.max(0, cost.amount - localStock);
  return {
    resource: cost.resource,
    required: cost.amount,
    localStock,
    missing,
    requiresStaging: missing > 1e-6,
    inbound: missing > 1e-6 && inboundResources.has(cost.resource),
  };
}

export function commodityOfferCost(
  commodity: MarketCommodityOffer,
  marketState: RegionalMarketState = DEFAULT_REGIONAL_MARKET_STATE,
): { resource: 'gold'; amount: number } {
  return { resource: 'gold', amount: effectiveCommodityGoldCost(commodity, marketState) };
}

export function waterCommodityOfferCost(
  commodity: MarketWaterCommodityOffer,
  marketState: RegionalMarketState = DEFAULT_REGIONAL_MARKET_STATE,
): { resource: 'gold'; amount: number } {
  return { resource: 'gold', amount: effectiveWaterCommodityGoldCost(commodity, marketState) };
}

function tradeStock(availability: MarketplaceTradeAvailability, resource: TradeResourceKind | 'gold'): number {
  return availability[resource];
}

export function canAffordMarketplaceTrade(
  availability: MarketplaceTradeAvailability,
  offer: MarketplaceTradeOffer,
  marketState: RegionalMarketState = DEFAULT_REGIONAL_MARKET_STATE,
): boolean {
  const cost = marketplaceTradeOfferCost(offer, marketState);
  return tradeStock(availability, cost.resource) + 1e-6 >= cost.amount;
}

export function canAffordCommodityTrade(
  availability: MarketplaceTradeAvailability,
  commodity: MarketCommodityOffer,
  marketState: RegionalMarketState = DEFAULT_REGIONAL_MARKET_STATE,
): boolean {
  const cost = commodityOfferCost(commodity, marketState);
  return tradeStock(availability, cost.resource) + 1e-6 >= cost.amount;
}

export function canAffordWaterCommodityTrade(
  availability: MarketplaceTradeAvailability,
  commodity: MarketWaterCommodityOffer,
  marketState: RegionalMarketState = DEFAULT_REGIONAL_MARKET_STATE,
): boolean {
  const cost = waterCommodityOfferCost(commodity, marketState);
  return tradeStock(availability, cost.resource) + 1e-6 >= cost.amount;
}

export type MarketplaceManualTradeStatus = {
  ready: boolean;
  label: string;
  reason: string | null;
  roadSpeedMultiplier?: number;
  nextCooldownSeconds?: number;
};

export function marketplaceManualTradeStatus(
  building: BuildingState,
  hasRoadAccess: boolean,
  roadSpeedMultiplier = 1,
  fireDisabled = false,
  regionalCaravanActive = false,
): MarketplaceManualTradeStatus {
  const normalizedRoadSpeed = normalizeRoadSpeedMultiplier(roadSpeedMultiplier);
  const timing = {
    roadSpeedMultiplier: normalizedRoadSpeed,
    nextCooldownSeconds: marketplaceManualTradeCooldown(
      building.assignedLabor,
      normalizedRoadSpeed,
    ),
  };
  if (fireDisabled) {
    return {
      ...timing,
      ready: false,
      label: 'Trade desk fire-disabled',
      reason: 'Repair the fire-damaged Trading Post before trading.',
    };
  }
  if (building.constructionComplete === false) {
    return {
      ...timing,
      ready: false,
      label: 'Trade desk under construction',
      reason: 'Complete the Trading Post before trading.',
    };
  }
  if (building.assignedLabor <= 0) {
    return {
      ...timing,
      ready: false,
      label: 'Trade desk unstaffed',
      reason: 'Assign at least one regional trader to place manual orders.',
    };
  }
  if (!hasRoadAccess) {
    return {
      ...timing,
      ready: false,
      label: 'Trade desk has no road access',
      reason: 'Connect the Trading Post to a road before trading.',
    };
  }
  if (regionalCaravanActive) {
    return {
      ...timing,
      ready: false,
      label: 'All regional routes occupied',
      reason: 'Wait for an import or export merchant to complete its round trip and free a trader route slot.',
    };
  }
  if (building.actionCooldown > 1e-6) {
    return {
      ...timing,
      ready: false,
      label: `Regional traders settling caravan · ${building.actionCooldown.toFixed(1)}s`,
      reason: `The regional traders need another ${building.actionCooldown.toFixed(1)} seconds.`,
    };
  }
  if (marketplacePendingTradeOffer(building.marketplacePendingTradeCode)) {
    return {
      ...timing,
      ready: false,
      label: 'Bulk order staging',
      reason: 'This Trading Post is already staging a bulk order. Let it depart or cancel it first.',
    };
  }
  return {
    ...timing,
    ready: true,
    label: 'Trade desk ready',
    reason: null,
  };
}

function normalizeRoadSpeedMultiplier(roadSpeedMultiplier: number): number {
  return Number.isFinite(roadSpeedMultiplier) && roadSpeedMultiplier > 0
    ? Math.max(0.05, Math.min(1, roadSpeedMultiplier))
    : 1;
}

export function marketplaceManualTradeCooldown(
  assignedLabor: number,
  roadSpeedMultiplier = 1,
): number {
  return MARKETPLACE_BULK_TRADE_COOLDOWN_SECONDS
    / Math.max(1, Math.floor(assignedLabor))
    / normalizeRoadSpeedMultiplier(roadSpeedMultiplier);
}

export function marketplaceResourceRoom(
  building: BuildingState,
  resource: TradeResourceKind,
): number {
  const cap = BUILDING_STORAGE_CAPS.trading_post[resource] ?? 0;
  const stock = resource === 'food'
    ? freshFoodStock(building)
    : (building[resource] ?? 0);
  return Math.max(0, cap - stock);
}

export function marketplaceTradeOfferReceive(
  offer: MarketplaceTradeOffer,
): { resource: TradeResourceKind | 'gold'; amount: number } {
  switch (offer.kind) {
    case 'goldBuy':
      return { resource: offer.resource, amount: offer.amount };
    case 'goldSell':
      return { resource: 'gold', amount: offer.goldYield };
    case 'barter':
      return { resource: offer.receive, amount: offer.receiveAmount };
    default: {
      const unhandled: never = offer;
      return unhandled;
    }
  }
}

export function canReceiveMarketplaceTrade(
  building: BuildingState,
  offer: MarketplaceTradeOffer,
): boolean {
  const receive = marketplaceTradeOfferReceive(offer);
  return receive.resource === 'gold'
    || marketplaceResourceRoom(building, receive.resource) + 1e-6 >= receive.amount;
}

export function canReceiveCommodityTrade(
  building: BuildingState,
  commodity: MarketCommodityOffer,
): boolean {
  const preserved = commodity.resourceKind === 'curedMeat'
    || commodity.resourceKind === 'cheese';
  const room = preserved
    ? (BUILDING_STORAGE_CAPS.trading_post.preservedFood ?? 0) - preservedFoodStock(building)
    : (BUILDING_STORAGE_CAPS.trading_post.food ?? 0) - freshFoodStock(building);
  return Math.max(0, room) + 1e-6 >= commodity.foodAmount;
}

export function canReceiveWaterCommodityTrade(
  building: BuildingState,
  commodity: MarketWaterCommodityOffer,
): boolean {
  return Math.max(0, (BUILDING_STORAGE_CAPS.trading_post.water ?? 0) - building.water) + 1e-6
    >= commodity.waterAmount;
}

export function formatTradeAvailabilitySummary(availability: MarketplaceTradeAvailability): string {
  const parts = (
    ['gold', 'timber', 'stone', 'firewood', 'food', 'iron', 'salt', 'pottery'] as const
  ).map((resource) => {
    const amount = Math.round(availability[resource]);
    return `${tradeResourceLabel(resource)} ${amount}`;
  });
  return `Available: ${parts.join(' · ')}`;
}

export function marketplaceTradeOffersBySection(includeFrontierOffers = true): {
  goldBuy: MarketplaceTradeOffer[];
  goldSell: MarketplaceTradeOffer[];
  barter: MarketplaceBarterOffer[];
} {
  const goldBuy: MarketplaceTradeOffer[] = [];
  const goldSell: MarketplaceTradeOffer[] = [];
  const barter: MarketplaceBarterOffer[] = [];
  for (const offer of MARKETPLACE_TRADE_OFFERS) {
    const frontierOffer = offer.kind === 'barter'
      ? (offer.give as TradeResourceKind) === 'ironwork'
        || (offer.receive as TradeResourceKind) === 'ironwork'
      : offer.resource === 'ironwork';
    if (!includeFrontierOffers && frontierOffer) {
      continue;
    }
    if (offer.kind === 'goldBuy') goldBuy.push(offer);
    else if (offer.kind === 'goldSell') goldSell.push(offer);
    else barter.push(offer);
  }
  return { goldBuy, goldSell, barter };
}

export function parseMarketplaceTradeId(button: HTMLElement): string | null {
  if (button.closest('[data-inspector-action="marketplace-trade"]') === null) {
    return null;
  }
  return button.closest('[data-trade-id]')?.getAttribute('data-trade-id') ?? null;
}

export function tradeResourceSpendScope(resource: TradeResourceKind): (typeof TRADE_RESOURCE_SPEND_SCOPES)[TradeResourceKind] {
  return TRADE_RESOURCE_SPEND_SCOPES[resource];
}

export {
  describeCommodityOffer,
  describeWaterCommodityOffer,
  MARKET_COMMODITIES,
  MARKET_WATER_COMMODITIES,
};
