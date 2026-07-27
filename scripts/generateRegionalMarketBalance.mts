export type MarketCommodityBalance = {
  id: string;
  label: string;
  origin: string;
  description: string;
  foodAmount: number;
  baseGoldCost: number;
};

export type MarketWaterCommodityBalance = {
  id: string;
  label: string;
  origin: string;
  description: string;
  waterAmount: number;
  baseGoldCost: number;
};

export type RegionalMarketBalance = {
  priceUpdateIntervalTicks: number;
  priceMultiplierMin: number;
  priceMultiplierMax: number;
  regionalIndexDrift: number;
  regionalIndexMeanReversion: number;
  tradeImpactPerTenUnits: number;
  localFoodDemandWeight: number;
  caravanDeliveryWorkers: number;
  caravanLaborPerWorker: number;
  caravanFoodPerDelivery: number;
  caravanWaterPerDelivery: number;
  caravanFirewoodPerDelivery: number;
  householdAutoBuyRunwayDays: number;
  householdAutoBuyCooldownTicks: number;
};

type BalanceWithRegionalMarket = {
  regionalMarket: RegionalMarketBalance;
  marketCommodities: MarketCommodityBalance[];
  marketWaterCommodities: MarketWaterCommodityBalance[];
};

function rustF64(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

function generateFoodCommodityRust(commodities: MarketCommodityBalance[]): string[] {
  const lines: string[] = [
    '#[derive(Clone, Copy, Debug)]',
    'pub struct MarketCommodityOffer {',
    '    pub id: &\'static str,',
    '    pub label: &\'static str,',
    '    pub origin: &\'static str,',
    '    pub description: &\'static str,',
    '    pub food_amount: f64,',
    '    pub base_gold_cost: f64,',
    '}',
    '',
  ];

  for (const commodity of commodities) {
    const constName = commodity.id.toUpperCase();
    lines.push(`const COMMODITY_${constName}: MarketCommodityOffer = MarketCommodityOffer {`);
    lines.push(`    id: "${commodity.id}",`);
    lines.push(`    label: "${commodity.label}",`);
    lines.push(`    origin: "${commodity.origin}",`);
    lines.push(`    description: "${commodity.description}",`);
    lines.push(`    food_amount: ${rustF64(commodity.foodAmount)},`);
    lines.push(`    base_gold_cost: ${rustF64(commodity.baseGoldCost)},`);
    lines.push('};');
    lines.push('');
  }

  lines.push(
    `const ALL_MARKET_COMMODITIES: &[MarketCommodityOffer] = &[${commodities.map((c) => `COMMODITY_${c.id.toUpperCase()}`).join(', ')}];`,
    '',
    'pub fn all_market_food_commodities() -> &\'static [MarketCommodityOffer] {',
    '    ALL_MARKET_COMMODITIES',
    '}',
    '',
    'pub fn market_commodity_offer(id: &str) -> Option<&\'static MarketCommodityOffer> {',
    '    ALL_MARKET_COMMODITIES.iter().find(|offer| offer.id == id)',
    '}',
    '',
  );

  return lines;
}

function generateWaterCommodityRust(commodities: MarketWaterCommodityBalance[]): string[] {
  const lines: string[] = [
    '#[derive(Clone, Copy, Debug)]',
    'pub struct MarketWaterCommodityOffer {',
    '    pub id: &\'static str,',
    '    pub label: &\'static str,',
    '    pub origin: &\'static str,',
    '    pub description: &\'static str,',
    '    pub water_amount: f64,',
    '    pub base_gold_cost: f64,',
    '}',
    '',
  ];

  for (const commodity of commodities) {
    const constName = commodity.id.toUpperCase();
    lines.push(`const WATER_COMMODITY_${constName}: MarketWaterCommodityOffer = MarketWaterCommodityOffer {`);
    lines.push(`    id: "${commodity.id}",`);
    lines.push(`    label: "${commodity.label}",`);
    lines.push(`    origin: "${commodity.origin}",`);
    lines.push(`    description: "${commodity.description}",`);
    lines.push(`    water_amount: ${rustF64(commodity.waterAmount)},`);
    lines.push(`    base_gold_cost: ${rustF64(commodity.baseGoldCost)},`);
    lines.push('};');
    lines.push('');
  }

  lines.push(
    `const ALL_MARKET_WATER_COMMODITIES: &[MarketWaterCommodityOffer] = &[${commodities.map((c) => `WATER_COMMODITY_${c.id.toUpperCase()}`).join(', ')}];`,
    '',
    'pub fn all_market_water_commodities() -> &\'static [MarketWaterCommodityOffer] {',
    '    ALL_MARKET_WATER_COMMODITIES',
    '}',
    '',
    'pub fn market_water_commodity_offer(id: &str) -> Option<&\'static MarketWaterCommodityOffer> {',
    '    ALL_MARKET_WATER_COMMODITIES.iter().find(|offer| offer.id == id)',
    '}',
    '',
  );

  return lines;
}

export function generateRegionalMarketRust(balance: BalanceWithRegionalMarket): string[] {
  const market = balance.regionalMarket;
  const lines: string[] = [
    `pub const MARKET_PRICE_UPDATE_INTERVAL_TICKS: u64 = ${market.priceUpdateIntervalTicks};`,
    `pub const MARKET_PRICE_MULTIPLIER_MIN: f64 = ${rustF64(market.priceMultiplierMin)};`,
    `pub const MARKET_PRICE_MULTIPLIER_MAX: f64 = ${rustF64(market.priceMultiplierMax)};`,
    `pub const MARKET_REGIONAL_INDEX_DRIFT: f64 = ${rustF64(market.regionalIndexDrift)};`,
    `pub const MARKET_REGIONAL_INDEX_MEAN_REVERSION: f64 = ${rustF64(market.regionalIndexMeanReversion)};`,
    `pub const MARKET_TRADE_IMPACT_PER_TEN_UNITS: f64 = ${rustF64(market.tradeImpactPerTenUnits)};`,
    `pub const MARKET_LOCAL_FOOD_DEMAND_WEIGHT: f64 = ${rustF64(market.localFoodDemandWeight)};`,
    `pub const MARKET_CARAVAN_DELIVERY_WORKERS: u32 = ${market.caravanDeliveryWorkers};`,
    `pub const MARKET_CARAVAN_LABOR_PER_WORKER: u32 = ${market.caravanLaborPerWorker};`,
    `pub const MARKET_CARAVAN_FOOD_PER_DELIVERY: f64 = ${rustF64(market.caravanFoodPerDelivery)};`,
    `pub const MARKET_CARAVAN_WATER_PER_DELIVERY: f64 = ${rustF64(market.caravanWaterPerDelivery)};`,
    `pub const MARKET_CARAVAN_FIREWOOD_PER_DELIVERY: f64 = ${rustF64(market.caravanFirewoodPerDelivery)};`,
    `pub const HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS: f64 = ${rustF64(market.householdAutoBuyRunwayDays)};`,
    `pub const HOUSEHOLD_AUTO_BUY_COOLDOWN_TICKS: u64 = ${market.householdAutoBuyCooldownTicks};`,
    '',
  ];

  lines.push(...generateFoodCommodityRust(balance.marketCommodities));
  lines.push(...generateWaterCommodityRust(balance.marketWaterCommodities));

  return lines;
}

export function generateRegionalMarketTypeScript(balance: BalanceWithRegionalMarket): string[] {
  const market = balance.regionalMarket;
  const foodCommodities = balance.marketCommodities;
  const waterCommodities = balance.marketWaterCommodities;
  return [
    `export const MARKET_PRICE_UPDATE_INTERVAL_TICKS = ${market.priceUpdateIntervalTicks};`,
    `export const MARKET_PRICE_MULTIPLIER_MIN = ${market.priceMultiplierMin};`,
    `export const MARKET_PRICE_MULTIPLIER_MAX = ${market.priceMultiplierMax};`,
    `export const MARKET_TRADE_IMPACT_PER_TEN_UNITS = ${market.tradeImpactPerTenUnits};`,
    `export const MARKET_CARAVAN_FOOD_PER_DELIVERY = ${market.caravanFoodPerDelivery};`,
    `export const MARKET_CARAVAN_WATER_PER_DELIVERY = ${market.caravanWaterPerDelivery};`,
    `export const MARKET_CARAVAN_FIREWOOD_PER_DELIVERY = ${market.caravanFirewoodPerDelivery};`,
    `export const MARKET_CARAVAN_DELIVERY_WORKERS = ${market.caravanDeliveryWorkers};`,
    `export const MARKET_CARAVAN_LABOR_PER_WORKER = ${market.caravanLaborPerWorker};`,
    `export const HOUSEHOLD_AUTO_BUY_RUNWAY_DAYS = ${market.householdAutoBuyRunwayDays};`,
    `export const HOUSEHOLD_AUTO_BUY_COOLDOWN_TICKS = ${market.householdAutoBuyCooldownTicks};`,
    '',
    'export type MarketCommodityOffer = {',
    '  id: string;',
    '  label: string;',
    '  origin: string;',
    '  description: string;',
    '  foodAmount: number;',
    '  baseGoldCost: number;',
    '};',
    '',
    'export const MARKET_COMMODITIES = [',
    ...foodCommodities.map((c) => `  ${JSON.stringify(c)},`),
    '] as const satisfies readonly MarketCommodityOffer[];',
    '',
    "export type MarketCommodityId = (typeof MARKET_COMMODITIES)[number]['id'];",
    '',
    'export type MarketWaterCommodityOffer = {',
    '  id: string;',
    '  label: string;',
    '  origin: string;',
    '  description: string;',
    '  waterAmount: number;',
    '  baseGoldCost: number;',
    '};',
    '',
    'export const MARKET_WATER_COMMODITIES = [',
    ...waterCommodities.map((c) => `  ${JSON.stringify(c)},`),
    '] as const satisfies readonly MarketWaterCommodityOffer[];',
    '',
    "export type MarketWaterCommodityId = (typeof MARKET_WATER_COMMODITIES)[number]['id'];",
    '',
  ];
}
