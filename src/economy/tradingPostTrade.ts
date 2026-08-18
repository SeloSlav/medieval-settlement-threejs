import {
  MARKETPLACE_TRADE_OFFERS,
  TRADE_RESOURCE_KINDS,
  type TradeResourceKind,
} from '../generated/gameBalance.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import { priceMultiplierFor, type RegionalMarketState } from './regionalMarket.ts';

export type TradingPostTradeMode = 0 | 1 | 2;

export type TradingPostTradeRuleState = {
  id: string;
  buildingId: string;
  commodityKind: number;
  commodity: TradeResourceKind;
  mode: TradingPostTradeMode;
  targetSurplus: number;
  lastSettledMonth: number;
  lastTradeAmount: number;
  lastTradeGold: number;
};

export const TRADE_MODE_NONE: TradingPostTradeMode = 0;
export const TRADE_MODE_IMPORT: TradingPostTradeMode = 1;
export const TRADE_MODE_EXPORT: TradingPostTradeMode = 2;

export const TRADE_RESOURCE_COMMODITY_CODES: Record<TradeResourceKind, number> = {
  firewood: 0, water: 1, food: 2, timber: 3, ale: 6, preservedFood: 7,
  honey: 8, wine: 9, stone: 10, polearms: 11, ironwork: 12, wool: 13,
  cloth: 14, barley: 16, malt: 17, flax: 18, iron: 19, clay: 20, salt: 21,
  charcoal: 22, pottery: 23, manure: 24, remedies: 25, roofTiles: 26,
  meat: 28, fish: 29, berries: 30, mushrooms: 31, milk: 32, apples: 33,
  cherries: 34, vegetables: 35, eggs: 36, grapes: 37, porridge: 38,
  curedMeat: 39, smokedFish: 40, cheese: 41, ryeSheaves: 42, oatSheaves: 43,
  barleySheaves: 44, maslinSheaves: 45, ryeGrain: 46, oatGrain: 47,
  maslinGrain: 48, ryeFlour: 49, oatFlour: 50, maslinFlour: 51,
  ryeBread: 52, oatBread: 53, maslinBread: 54,
};

export const TRADE_COMMODITY_BY_CODE = new Map<number, TradeResourceKind>(
  Object.entries(TRADE_RESOURCE_COMMODITY_CODES)
    .map(([resource, code]) => [code, resource as TradeResourceKind]),
);

export const TRADE_RESOURCE_LABELS: Record<TradeResourceKind, string> = {
  timber: 'Timber', stone: 'Stone', firewood: 'Firewood', charcoal: 'Charcoal',
  water: 'Water', food: 'Mixed provisions', ryeSheaves: 'Rye sheaves',
  oatSheaves: 'Oat sheaves', barleySheaves: 'Barley sheaves',
  maslinSheaves: 'Maslin sheaves', ryeGrain: 'Rye grain', oatGrain: 'Oat grain',
  maslinGrain: 'Maslin grain', barley: 'Barley grain', flax: 'Flax',
  ryeFlour: 'Rye flour', oatFlour: 'Oat flour', maslinFlour: 'Maslin flour',
  malt: 'Malt', ryeBread: 'Rye bread', oatBread: 'Oat bread',
  maslinBread: 'Maslin bread', porridge: 'Porridge', meat: 'Meat', fish: 'Fish',
  berries: 'Berries', mushrooms: 'Mushrooms', milk: 'Milk', apples: 'Apples',
  cherries: 'Cherries', vegetables: 'Vegetables', eggs: 'Eggs', grapes: 'Grapes',
  preservedFood: 'Preserved food', curedMeat: 'Cured meat', smokedFish: 'Smoked fish',
  cheese: 'Cheese', honey: 'Honey', ale: 'Ale', wine: 'Wine', wool: 'Wool',
  cloth: 'Cloth', iron: 'Iron', clay: 'Clay', salt: 'Salt', ironwork: 'Ironwork',
  polearms: 'Polearms', pottery: 'Pottery', roofTiles: 'Roof tiles', manure: 'Manure',
  remedies: 'Remedies',
};

export const TRADING_POST_TRADE_CATEGORIES = [
  { label: 'Construction & raw materials', resources: ['timber', 'stone', 'clay', 'iron', 'salt', 'ironwork', 'roofTiles'] },
  { label: 'Fuel & utilities', resources: ['firewood', 'charcoal', 'water'] },
  { label: 'Crops & harvest', resources: ['ryeSheaves', 'oatSheaves', 'barleySheaves', 'maslinSheaves', 'ryeGrain', 'oatGrain', 'maslinGrain', 'barley', 'flax', 'manure'] },
  { label: 'Milled & prepared staples', resources: ['ryeFlour', 'oatFlour', 'maslinFlour', 'malt', 'ryeBread', 'oatBread', 'maslinBread', 'porridge'] },
  { label: 'Fresh food', resources: ['food', 'meat', 'fish', 'berries', 'mushrooms', 'milk', 'apples', 'cherries', 'vegetables', 'eggs', 'grapes'] },
  { label: 'Preserved provisions', resources: ['preservedFood', 'curedMeat', 'smokedFish', 'cheese', 'honey'] },
  { label: 'Finished goods', resources: ['ale', 'wine', 'wool', 'cloth', 'polearms', 'pottery', 'remedies'] },
] as const satisfies ReadonlyArray<{ label: string; resources: readonly TradeResourceKind[] }>;

export function tradingPostRuleId(buildingId: string, resource: TradeResourceKind): string {
  return `${buildingId}:${TRADE_RESOURCE_COMMODITY_CODES[resource]}`;
}

export function tradingPostRule(
  rules: ReadonlyMap<string, TradingPostTradeRuleState> | undefined,
  buildingId: string,
  resource: TradeResourceKind,
): TradingPostTradeRuleState | null {
  return rules?.get(tradingPostRuleId(buildingId, resource)) ?? null;
}

export function buildingTradeStock(building: BuildingState, resource: TradeResourceKind): number {
  return Math.max(0, Number(
    (building as unknown as Partial<Record<TradeResourceKind, number>>)[resource] ?? 0,
  ));
}

export function settlementTradeStock(
  state: Pick<GameState, 'buildings'>,
  resource: TradeResourceKind,
  includeTradingPosts = true,
): number {
  let total = 0;
  for (const building of state.buildings.values()) {
    if (building.constructionComplete === false) continue;
    if (!includeTradingPosts && building.kind === 'trading_post') continue;
    total += buildingTradeStock(building, resource);
  }
  return total;
}

export function tradingPostUnitPrices(
  resource: TradeResourceKind,
  market: RegionalMarketState,
): { importGold: number; exportGold: number } {
  const buy = MARKETPLACE_TRADE_OFFERS.find(
    (offer) => offer.kind === 'goldBuy' && offer.resource === resource,
  );
  const sell = MARKETPLACE_TRADE_OFFERS.find(
    (offer) => offer.kind === 'goldSell' && offer.resource === resource,
  );
  const multiplier = priceMultiplierFor(market, resource);
  return {
    importGold: buy?.kind === 'goldBuy' ? buy.goldCost / buy.amount * multiplier : 0,
    exportGold: sell?.kind === 'goldSell' ? sell.goldYield / sell.amount * multiplier : 0,
  };
}

export function validateTradingPostCommodityCatalog(): boolean {
  const categorized = TRADING_POST_TRADE_CATEGORIES.flatMap((category) => category.resources);
  return categorized.length === TRADE_RESOURCE_KINDS.length
    && new Set(categorized).size === TRADE_RESOURCE_KINDS.length
    && TRADE_RESOURCE_KINDS.every((resource) => categorized.includes(resource));
}
