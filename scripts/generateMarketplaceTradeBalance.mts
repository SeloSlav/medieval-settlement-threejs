export const MARKETPLACE_TRADE_RESOURCES = [
  'timber', 'stone', 'firewood', 'water', 'food',
  'ryeGrain', 'oatGrain', 'maslinGrain',
  'ryeFlour', 'maslinFlour',
  'ryeBread', 'maslinBread', 'ale', 'cider', 'pearCider',
  'preservedFood', 'honey', 'wax', 'candles', 'wine', 'ironwork', 'polearms', 'wool', 'cloth',
  'hides', 'leather', 'shoes',
  'barley', 'malt', 'flax', 'iron', 'clay', 'salt', 'charcoal', 'pottery',
  'manure', 'remedies', 'roofTiles', 'meat', 'fish', 'berries', 'mushrooms',
  'milk', 'apples', 'pears', 'cherries', 'aronia', 'rosehips',
  'cabbage', 'carrots', 'beetroot', 'eggs', 'grapes',
  'curedMeat', 'smokedFish', 'cheese', 'aroniaJam', 'rosehipJam',
  'ryeSheaves', 'oatSheaves', 'barleySheaves', 'maslinSheaves',
] as const;

export type MarketplaceTradeResource = (typeof MARKETPLACE_TRADE_RESOURCES)[number];

export type MarketplaceBarterOffer = {
  id: string;
  kind: 'barter';
  give: MarketplaceTradeResource;
  giveAmount: number;
  receive: MarketplaceTradeResource;
  receiveAmount: number;
};

export type MarketplaceTradeBalance = {
  bulkTradeCooldownSeconds: number;
  regionalExchangeIntervalSeconds: number;
  resourceSpendScopes: Record<MarketplaceTradeResource, 'marketAccessible' | 'treasury'>;
  offers: Array<
    | {
        id: string;
        kind: 'goldBuy';
        resource: MarketplaceTradeResource;
        amount: number;
        goldCost: number;
      }
    | {
        id: string;
        kind: 'goldSell';
        resource: MarketplaceTradeResource;
        amount: number;
        goldYield: number;
      }
    | MarketplaceBarterOffer
  >;
};

type BalanceWithMarketplaceTrade = {
  marketplaceTrade: MarketplaceTradeBalance;
};

function rustF64(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

function rustTradeResourceSlug(resource: string): string {
  return resource.charAt(0).toUpperCase() + resource.slice(1);
}

const LEGACY_PENDING_TRADE_CODES: Readonly<Record<string, number>> = {
  sell_timber: 1,
  sell_stone: 2,
  sell_firewood: 3,
  sell_food: 4,
  timber_for_stone: 5,
  stone_for_timber: 6,
  timber_for_firewood: 7,
  sell_pottery: 8,
};

function pendingTradeCodes(offers: MarketplaceTradeBalance['offers']): Map<string, number> {
  const codes = new Map(Object.entries(LEGACY_PENDING_TRADE_CODES));
  let nextCode = 9;
  for (const offer of offers) {
    if (offer.kind === 'goldBuy' || codes.has(offer.id)) continue;
    codes.set(offer.id, nextCode++);
  }
  if (nextCode > 256) throw new Error('Marketplace export contract codes exceed u8 capacity.');
  return codes;
}

export function generateMarketplaceTradeRust(balance: BalanceWithMarketplaceTrade): string[] {
  const trade = balance.marketplaceTrade;
  if (!Number.isFinite(trade.regionalExchangeIntervalSeconds)
    || trade.regionalExchangeIntervalSeconds <= 0) {
    throw new Error('Regional exchange interval must be a positive number of simulation seconds.');
  }
  const offers = trade.offers;
  const contractCodes = pendingTradeCodes(offers);
  const lines: string[] = [
    `pub const MARKETPLACE_BULK_TRADE_COOLDOWN_SECONDS: f64 = ${rustF64(trade.bulkTradeCooldownSeconds)};`,
    `pub const REGIONAL_EXCHANGE_INTERVAL_SECONDS: f64 = ${rustF64(trade.regionalExchangeIntervalSeconds)};`,
    '',
    '#[derive(Clone, Copy, Debug, PartialEq, Eq)]',
    'pub enum TradeResource {',
    ...MARKETPLACE_TRADE_RESOURCES.map((resource) => `    ${rustTradeResourceSlug(resource)},`),
    '}',
    '',
    '#[derive(Clone, Copy, Debug, PartialEq, Eq)]',
    'pub enum TradeResourceSpendScope {',
    '    MarketAccessible,',
    '    #[allow(dead_code)]',
    '    Treasury,',
    '}',
    '',
    'impl TradeResource {',
    '    pub fn spend_scope(self) -> TradeResourceSpendScope {',
    '        match self {',
  ];

  for (const [resource, scope] of Object.entries(trade.resourceSpendScopes)) {
    const variant = rustTradeResourceSlug(resource);
    const scopeVariant = scope === 'marketAccessible' ? 'MarketAccessible' : 'Treasury';
    lines.push(`            Self::${variant} => TradeResourceSpendScope::${scopeVariant},`);
  }

  lines.push(
    '        }',
    '    }',
    '}',
    '',
    '#[derive(Clone, Copy, Debug)]',
    'pub enum MarketplaceTradeKind {',
    '    GoldBuy { resource: TradeResource, amount: f64, gold_cost: f64 },',
    '    GoldSell { resource: TradeResource, amount: f64, gold_yield: f64 },',
    '    Barter {',
    '        give: TradeResource,',
    '        give_amount: f64,',
    '        receive: TradeResource,',
    '        receive_amount: f64,',
    '    },',
    '}',
    '',
    '#[derive(Clone, Copy, Debug)]',
    'pub struct MarketplaceTradeOffer {',
    '    pub id: &\'static str,',
    '    pub kind: MarketplaceTradeKind,',
    '}',
    '',
  );

  for (const offer of offers) {
    if (offer.kind === 'goldBuy') {
      lines.push(`const TRADE_${offer.id.toUpperCase()}: MarketplaceTradeOffer = MarketplaceTradeOffer {`);
      lines.push(`    id: "${offer.id}",`);
      lines.push('    kind: MarketplaceTradeKind::GoldBuy {');
      lines.push(`        resource: TradeResource::${rustTradeResourceSlug(offer.resource)},`);
      lines.push(`        amount: ${rustF64(offer.amount)},`);
      lines.push(`        gold_cost: ${rustF64(offer.goldCost)},`);
      lines.push('    },');
      lines.push('};');
    } else if (offer.kind === 'goldSell') {
      lines.push(`const TRADE_${offer.id.toUpperCase()}: MarketplaceTradeOffer = MarketplaceTradeOffer {`);
      lines.push(`    id: "${offer.id}",`);
      lines.push('    kind: MarketplaceTradeKind::GoldSell {');
      lines.push(`        resource: TradeResource::${rustTradeResourceSlug(offer.resource)},`);
      lines.push(`        amount: ${rustF64(offer.amount)},`);
      lines.push(`        gold_yield: ${rustF64(offer.goldYield)},`);
      lines.push('    },');
      lines.push('};');
    } else {
      lines.push(`const TRADE_${offer.id.toUpperCase()}: MarketplaceTradeOffer = MarketplaceTradeOffer {`);
      lines.push(`    id: "${offer.id}",`);
      lines.push('    kind: MarketplaceTradeKind::Barter {');
      lines.push(`        give: TradeResource::${rustTradeResourceSlug(offer.give)},`);
      lines.push(`        give_amount: ${rustF64(offer.giveAmount)},`);
      lines.push(`        receive: TradeResource::${rustTradeResourceSlug(offer.receive)},`);
      lines.push(`        receive_amount: ${rustF64(offer.receiveAmount)},`);
      lines.push('    },');
      lines.push('};');
    }
    lines.push('');
  }

  lines.push(
    `const ALL_MARKETPLACE_TRADES: &[MarketplaceTradeOffer] = &[${offers.map((offer) => `TRADE_${offer.id.toUpperCase()}`).join(', ')}];`,
    '',
    'pub fn marketplace_trade_offer(id: &str) -> Option<&\'static MarketplaceTradeOffer> {',
    '    ALL_MARKETPLACE_TRADES.iter().find(|offer| offer.id == id)',
    '}',
    '',
    'pub fn marketplace_trade_offer_for_resource(resource: TradeResource, importing: bool) -> Option<&\'static MarketplaceTradeOffer> {',
    '    ALL_MARKETPLACE_TRADES.iter().find(|offer| match offer.kind {',
    '        MarketplaceTradeKind::GoldBuy { resource: offered, .. } => importing && offered == resource,',
    '        MarketplaceTradeKind::GoldSell { resource: offered, .. } => !importing && offered == resource,',
    '        MarketplaceTradeKind::Barter { .. } => false,',
    '    })',
    '}',
    '',
    'pub fn marketplace_trade_contract_code(id: &str) -> Option<u8> {',
    '    match id {',
    ...Array.from(contractCodes, ([id, code]) => `        "${id}" => Some(${code}),`),
    '        _ => None,',
    '    }',
    '}',
    '',
    'pub fn marketplace_trade_offer_for_contract_code(code: u8) -> Option<&\'static MarketplaceTradeOffer> {',
    '    let id = match code {',
    ...Array.from(contractCodes, ([id, code]) => `        ${code} => "${id}",`),
    '        _ => return None,',
    '    };',
    '    marketplace_trade_offer(id)',
    '}',
    '',
  );

  return lines;
}

export function generateMarketplaceTradeTypeScript(balance: BalanceWithMarketplaceTrade): string[] {
  const trade = balance.marketplaceTrade;
  const offers = trade.offers;
  const contractCodes = pendingTradeCodes(offers);
  const lines: string[] = [
    `export const MARKETPLACE_BULK_TRADE_COOLDOWN_SECONDS = ${trade.bulkTradeCooldownSeconds};`,
    `export const REGIONAL_EXCHANGE_INTERVAL_SECONDS = ${trade.regionalExchangeIntervalSeconds};`,
    '',
    `export const TRADE_RESOURCE_KINDS = ${JSON.stringify(MARKETPLACE_TRADE_RESOURCES)} as const;`,
    'export type TradeResourceKind = (typeof TRADE_RESOURCE_KINDS)[number];',
    '',
    "export type TradeResourceSpendScope = 'marketAccessible' | 'treasury';",
    '',
    'export const TRADE_RESOURCE_SPEND_SCOPES = {',
    ...Object.entries(trade.resourceSpendScopes).map(
      ([resource, scope]) => `  ${resource}: '${scope}',`,
    ),
    '} as const satisfies Record<TradeResourceKind, TradeResourceSpendScope>;',
    '',
    'export type MarketplaceGoldBuyOffer = {',
    "  id: string;",
    "  kind: 'goldBuy';",
    '  resource: TradeResourceKind;',
    '  amount: number;',
    '  goldCost: number;',
    '};',
    '',
    'export type MarketplaceGoldSellOffer = {',
    "  id: string;",
    "  kind: 'goldSell';",
    '  resource: TradeResourceKind;',
    '  amount: number;',
    '  goldYield: number;',
    '};',
    '',
    'export type MarketplaceBarterOffer = {',
    "  id: string;",
    "  kind: 'barter';",
    '  give: TradeResourceKind;',
    '  giveAmount: number;',
    '  receive: TradeResourceKind;',
    '  receiveAmount: number;',
    '};',
    '',
    'export type MarketplaceTradeOffer =',
    '  | MarketplaceGoldBuyOffer',
    '  | MarketplaceGoldSellOffer',
    '  | MarketplaceBarterOffer;',
    '',
    'export const MARKETPLACE_TRADE_OFFERS = [',
  ];

  for (const offer of offers) {
    lines.push(`  ${JSON.stringify(offer)},`);
  }

  lines.push(
    '] as const satisfies readonly MarketplaceTradeOffer[];',
    '',
    "export type MarketplaceTradeOfferId = (typeof MARKETPLACE_TRADE_OFFERS)[number]['id'];",
    '',
    `export const MARKETPLACE_PENDING_TRADE_IDS = ${JSON.stringify(Object.fromEntries(Array.from(contractCodes, ([id, code]) => [code, id])))} as const;`,
    '',
  );

  return lines;
}
