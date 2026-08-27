import {
  MARKETPLACE_TRADE_OFFERS,
  REGIONAL_EXCHANGE_INTERVAL_SECONDS,
  SIM_REALTIME_RATE,
  SIM_TICK_SECONDS,
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
  firewood: 0, water: 1, timber: 3, ale: 6, preservedFood: 7,
  honey: 8, wine: 9, stone: 10, polearms: 11, ironwork: 12, wool: 13,
  cloth: 14, barley: 16, malt: 17, flax: 18, iron: 19, clay: 20, salt: 21,
  charcoal: 22, pottery: 23, manure: 24, remedies: 25, roofTiles: 26,
  meat: 28, fish: 29, berries: 30, mushrooms: 31, milk: 32, apples: 33,
  cherries: 34, eggs: 36, grapes: 37,
  curedMeat: 39, smokedFish: 40, cheese: 41, ryeSheaves: 42, oatSheaves: 43,
  barleySheaves: 44, maslinSheaves: 45, ryeGrain: 46, oatGrain: 47,
  maslinGrain: 48, ryeFlour: 49, maslinFlour: 51,
  ryeBread: 52, maslinBread: 54, cider: 55,
  pears: 4, aronia: 5, rosehips: 27, cabbage: 38, carrots: 50, beetroot: 53,
  pearCider: 57, aroniaJam: 61, rosehipJam: 62,
  hides: 58, leather: 59, shoes: 60,
  wax: 64, candles: 65, pelts: 66, yarn: 67, linen: 68,
};

export const TRADE_COMMODITY_BY_CODE = new Map<number, TradeResourceKind>(
  Object.entries(TRADE_RESOURCE_COMMODITY_CODES)
    .map(([resource, code]) => [code, resource as TradeResourceKind]),
);

export const TRADE_RESOURCE_LABELS: Record<TradeResourceKind, string> = {
  timber: 'Timber', stone: 'Stone', firewood: 'Firewood', charcoal: 'Charcoal',
  water: 'Water', ryeSheaves: 'Rye sheaves',
  oatSheaves: 'Oat sheaves', barleySheaves: 'Barley sheaves',
  maslinSheaves: 'Maslin sheaves', ryeGrain: 'Rye grain', oatGrain: 'Oats',
  maslinGrain: 'Maslin grain', barley: 'Barley grain', flax: 'Flax',
  ryeFlour: 'Rye flour', maslinFlour: 'Maslin flour',
  malt: 'Malt', ryeBread: 'Rye bread',
  maslinBread: 'Maslin bread', meat: 'Meat', fish: 'Fish',
  berries: 'Raspberries', mushrooms: 'Mushrooms', milk: 'Milk', apples: 'Apples', pears: 'Pears',
  cherries: 'Cherries', aronia: 'Aronia berries', rosehips: 'Rosehips',
  cabbage: 'Cabbage', carrots: 'Carrots', beetroot: 'Beetroot', eggs: 'Eggs', grapes: 'Grapes',
  preservedFood: 'Preserved food', curedMeat: 'Cured meat', smokedFish: 'Smoked fish',
  cheese: 'Cheese', aroniaJam: 'Aronia jam', rosehipJam: 'Rosehip jam', honey: 'Honey', wax: 'Beeswax', candles: 'Candles',
  ale: 'Ale', cider: 'Apple cider', pearCider: 'Pear cider', wine: 'Wine', wool: 'Wool',
  yarn: 'Yarn', linen: 'Linen', cloth: 'Clothing', iron: 'Iron', clay: 'Clay', salt: 'Salt', ironwork: 'Ironwork',
  pelts: 'Pelts', hides: 'Hides', leather: 'Leather', shoes: 'Shoes',
  polearms: 'Polearms', pottery: 'Pottery', roofTiles: 'Roof tiles', manure: 'Manure',
  remedies: 'Remedies',
};

export const TRADING_POST_TRADE_CATEGORIES = [
  { label: 'Construction & raw materials', resources: ['timber', 'stone', 'clay', 'iron', 'salt', 'ironwork', 'roofTiles'] },
  { label: 'Fuel & utilities', resources: ['firewood', 'charcoal', 'water'] },
  { label: 'Crops & harvest', resources: ['ryeSheaves', 'oatSheaves', 'barleySheaves', 'maslinSheaves', 'ryeGrain', 'oatGrain', 'maslinGrain', 'barley', 'flax', 'manure'] },
  { label: 'Milled & prepared staples', resources: ['ryeFlour', 'maslinFlour', 'malt', 'ryeBread', 'maslinBread'] },
  { label: 'Fresh food', resources: ['meat', 'fish', 'berries', 'mushrooms', 'milk', 'apples', 'pears', 'cherries', 'aronia', 'rosehips', 'cabbage', 'carrots', 'beetroot', 'eggs', 'grapes'] },
  { label: 'Preserved provisions', resources: ['preservedFood', 'curedMeat', 'smokedFish', 'cheese', 'aroniaJam', 'rosehipJam', 'honey'] },
  { label: 'Textiles & wares', resources: ['ale', 'cider', 'pearCider', 'wine', 'wool', 'yarn', 'linen', 'cloth', 'pelts', 'hides', 'leather', 'shoes', 'wax', 'candles', 'polearms', 'pottery', 'remedies'] },
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

const REGIONAL_EXCHANGE_INTERVAL_TICKS = Math.max(
  1,
  Math.ceil(REGIONAL_EXCHANGE_INTERVAL_SECONDS / SIM_TICK_SECONDS),
);

export function regionalExchangeSequence(simTick: number): number {
  return Math.floor(Math.max(0, Math.floor(simTick)) / REGIONAL_EXCHANGE_INTERVAL_TICKS);
}

export function regionalExchangeSecondsUntilNext(simTick: number): number {
  const tick = Math.max(0, Math.floor(simTick));
  const ticksRemaining = REGIONAL_EXCHANGE_INTERVAL_TICKS
    - (tick % REGIONAL_EXCHANGE_INTERVAL_TICKS);
  return ticksRemaining * SIM_TICK_SECONDS;
}

export function regionalExchangeRealSecondsAt4x(simSeconds: number): number {
  return Math.max(0, simSeconds) / (SIM_REALTIME_RATE * 4);
}

export function formatRegionalExchangeCountdown(simTick: number, dueNow = false): string {
  if (dueNow) return 'Ready now';
  const simSeconds = Math.ceil(regionalExchangeSecondsUntilNext(simTick));
  const realSeconds = Math.ceil(regionalExchangeRealSecondsAt4x(simSeconds));
  return `In ${simSeconds} simulation seconds (~${realSeconds} real seconds at 4×)`;
}

export function tradingPostExchangeDue(
  rules: readonly TradingPostTradeRuleState[],
  simTick: number,
): boolean {
  const currentExchange = regionalExchangeSequence(simTick);
  return rules.some((rule) => rule.mode !== TRADE_MODE_NONE
    && rule.lastSettledMonth < currentExchange);
}

/**
 * Mirrors the authority's deterministic fair ordering for imports that share
 * a limited civic treasury. Exports always settle first; this order only
 * describes which active import receives the first funding opportunity.
 */
export function tradingPostImportFundingOrder(
  rules: readonly TradingPostTradeRuleState[],
  simTick: number,
  publicStock: (resource: TradeResourceKind) => number = () => 0,
): TradeResourceKind[] {
  const imports = rules
    .filter((rule) => rule.mode === TRADE_MODE_IMPORT)
    .sort((left, right) => left.commodityKind - right.commodityKind);
  if (imports.length === 0) return [];
  const currentExchange = regionalExchangeSequence(simTick);
  const currentCohort = imports.filter((rule) => rule.lastSettledMonth < currentExchange);
  const settlementExchange = currentCohort.length > 0 ? currentExchange : currentExchange + 1;
  const cohort = currentCohort.length > 0
    ? currentCohort
    : imports.filter((rule) => rule.lastSettledMonth < settlementExchange);
  if (cohort.length === 0) return [];
  const offset = settlementExchange % cohort.length;
  return [...cohort.slice(offset), ...cohort.slice(0, offset)]
    .sort((left, right) => importTargetFulfillment(
      publicStock(left.commodity),
      left.targetSurplus,
    ) - importTargetFulfillment(
      publicStock(right.commodity),
      right.targetSurplus,
    ))
    .map((rule) => rule.commodity);
}

export function importTargetFulfillment(publicStock: number, targetSurplus: number): number {
  const target = Math.max(0, Math.min(9_999, Math.round(
    Number.isFinite(targetSurplus) ? targetSurplus : 0,
  )));
  if (target <= 1e-9) return 1;
  return Math.max(0, Math.min(1, publicStock / target));
}

export function fairImportGoldBudget(remainingGold: number, remainingRules: number): number {
  if (!Number.isFinite(remainingGold) || remainingRules <= 0) return 0;
  const availableCents = Math.floor(Math.max(0, remainingGold) * 100);
  return Math.floor(availableCents / Math.floor(remainingRules)) / 100;
}

export function tradingPostServiceRouteOrder(
  actionCooldown: number,
  routeCount: number,
): number[] {
  const count = Math.max(0, Math.floor(routeCount));
  if (count === 0) return [];
  const start = Number.isFinite(actionCooldown) && actionCooldown >= 0
    ? Math.floor(actionCooldown) % count
    : 0;
  return Array.from({ length: count }, (_, offset) => (start + offset) % count);
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
