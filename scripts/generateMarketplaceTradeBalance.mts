export type MarketplaceBarterOffer = {
  id: string;
  kind: 'barter';
  give: 'timber' | 'stone' | 'firewood' | 'food' | 'grain' | 'barley' | 'ironwork';
  giveAmount: number;
  receive: 'timber' | 'stone' | 'firewood' | 'food' | 'grain' | 'barley' | 'ironwork';
  receiveAmount: number;
};

export type MarketplaceTradeBalance = {
  bulkTradeCooldownSeconds: number;
  resourceSpendScopes: Record<
    'timber' | 'stone' | 'firewood' | 'food' | 'grain' | 'barley' | 'ironwork',
    'marketAccessible' | 'treasury'
  >;
  offers: Array<
    | {
        id: string;
        kind: 'goldBuy';
        resource: 'timber' | 'stone' | 'firewood' | 'food' | 'grain' | 'barley' | 'ironwork';
        amount: number;
        goldCost: number;
      }
    | {
        id: string;
        kind: 'goldSell';
        resource: 'timber' | 'stone' | 'firewood' | 'food' | 'grain' | 'barley' | 'ironwork';
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

export function generateMarketplaceTradeRust(balance: BalanceWithMarketplaceTrade): string[] {
  const trade = balance.marketplaceTrade;
  const offers = trade.offers;
  const lines: string[] = [
    `pub const MARKETPLACE_BULK_TRADE_COOLDOWN_SECONDS: f64 = ${rustF64(trade.bulkTradeCooldownSeconds)};`,
    '',
    '#[derive(Clone, Copy, Debug, PartialEq, Eq)]',
    'pub enum TradeResource {',
    '    Timber,',
    '    Stone,',
    '    Firewood,',
    '    Food,',
    '    Grain,',
    '    Barley,',
    '    Ironwork,',
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
  );

  return lines;
}

export function generateMarketplaceTradeTypeScript(balance: BalanceWithMarketplaceTrade): string[] {
  const trade = balance.marketplaceTrade;
  const offers = trade.offers;
  const lines: string[] = [
    `export const MARKETPLACE_BULK_TRADE_COOLDOWN_SECONDS = ${trade.bulkTradeCooldownSeconds};`,
    '',
    "export const TRADE_RESOURCE_KINDS = ['timber', 'stone', 'firewood', 'food', 'grain', 'barley', 'ironwork'] as const;",
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
  );

  return lines;
}
