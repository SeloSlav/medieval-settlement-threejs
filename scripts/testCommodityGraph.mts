import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BUILDING_COSTS,
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  MARKETPLACE_TRADE_OFFERS,
  STARTING_IRONWORK,
  TRADE_RESOURCE_KINDS,
  type StorageCaps,
  type TradeResourceKind,
} from '../src/generated/gameBalance.ts';
import {
  GRANARY_STORAGE_COMMODITIES,
  STORAGE_COMMODITY_CODES,
  STORAGE_COMMODITY_LABELS,
  STOREHOUSE_STORAGE_COMMODITIES,
  storageAcceptsCommodity,
  type StorageCommodity,
} from '../src/economy/storageAcceptancePolicy.ts';
import {
  FRESH_FOOD_KINDS,
  PRESERVED_FOOD_KINDS,
} from '../src/economy/foodInventory.ts';
import {
  DELIVERY_CARGO_KINDS,
  cargoKindFromId,
  cargoKindLabel,
} from '../src/logistics/deliveryTrips.ts';
import {
  TRADE_RESOURCE_COMMODITY_CODES,
  TRADE_RESOURCE_LABELS,
} from '../src/economy/tradingPostTrade.ts';
import { tradeResourceLabel } from '../src/economy/marketplaceTrade.ts';
import {
  RESOURCE_COST_KINDS,
  renderResourceAmount,
  resourceCostLabel,
} from '../src/ui/resourceCost.ts';
import {
  RESOURCE_KINDS,
  createEmptyStockpile,
  type ResourceKind,
} from '../src/resources/types.ts';
import { formatResourceAmount } from '../src/resources/yields.ts';

const commoditySource = readFileSync('server/src/economy/commodities.rs', 'utf8');
const tradeResourceSource = readFileSync('server/src/economy/trade_resources.rs', 'utf8');
const storagePolicySource = readFileSync('server/src/storage_acceptance_policy.rs', 'utf8');
const marketplaceCaravanSource = readFileSync(
  'server/src/simulation/marketplace_caravan.rs',
  'utf8',
);
const expandedEconomySource = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
const deliveryCargoSource = readFileSync(
  'server/src/simulation/delivery_cargo.rs',
  'utf8',
);
const supplyPolicySource = readFileSync('server/src/supply_policy.rs', 'utf8');
const iconographySource = readFileSync('src/ui/iconography.css', 'utf8');
const openingBalanceTestSource = readFileSync('scripts/testOpeningBalance.mts', 'utf8');

const lowerCamel = (value: string): string => value[0].toLowerCase() + value.slice(1);

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function assertSameSet(
  actual: readonly string[],
  expected: readonly string[],
  message: string,
): void {
  assert.equal(new Set(actual).size, actual.length, `${message}: duplicate entry`);
  assert.deepEqual(sortedUnique(actual), sortedUnique(expected), message);
}

const asU8Body = commoditySource.match(
  /pub fn as_u8\(self\) -> u8 \{([\s\S]*?)\n    \}\n\n    pub fn from_u8/,
)?.[1];
assert.ok(asU8Body, 'CommodityKind::as_u8 must remain discoverable as the stable authority');

const authoritativeEntries = [...asU8Body.matchAll(/Self::([A-Z][A-Za-z0-9]*)\s*=>\s*(\d+)/g)]
  .map((match) => ({
    variant: match[1],
    resource: lowerCamel(match[1]),
    code: Number(match[2]),
  }))
  .sort((left, right) => left.code - right.code);
assert.equal(authoritativeEntries.length, 66, 'the audit must cover every authoritative commodity');
assert.deepEqual(
  authoritativeEntries.map(({ code }) => code),
  Array.from({ length: authoritativeEntries.length }, (_, code) => code),
  'CommodityKind codes must remain unique, contiguous, and append-only across persisted mask words',
);

const authoritativeResources = authoritativeEntries.map(({ resource }) => resource);
const codeByResource = new Map(
  authoritativeEntries.map(({ resource, code }) => [resource, code]),
);
assert.equal(
  codeByResource.get('animalFeed'),
  63,
  'Animal Feed must retain its established final low-mask commodity bit',
);
assert.equal(codeByResource.get('wax'), 64, 'Wax must be the first companion high-mask bit');
assert.equal(codeByResource.get('candles'), 65, 'Candles must be the second companion high-mask bit');
assertSameSet(
  RESOURCE_KINDS,
  [...authoritativeResources, 'game'],
  'RESOURCE_KINDS must contain every physical commodity plus only the world-only game node',
);
assertSameSet(
  RESOURCE_COST_KINDS,
  authoritativeResources,
  'resource-cost labels and icons must cover every authoritative commodity',
);
assertSameSet(
  DELIVERY_CARGO_KINDS,
  authoritativeResources,
  'delivery cargo must represent every authoritative commodity',
);

const emptyStockpile = createEmptyStockpile();
for (const { resource, code } of authoritativeEntries) {
  assert.equal(cargoKindFromId(code), resource, `${resource} cargo id must mirror Rust code ${code}`);
  assert.ok(cargoKindLabel(resource as (typeof DELIVERY_CARGO_KINDS)[number]).trim());
  assert.equal(emptyStockpile[resource as ResourceKind], 0, `${resource} needs an empty-ledger slot`);
  assert.ok(resourceCostLabel(resource as (typeof RESOURCE_COST_KINDS)[number]).trim());
  assert.match(
    renderResourceAmount(resource as (typeof RESOURCE_COST_KINDS)[number], 1),
    new RegExp(`data-resource-cost="${resource}"`),
  );
  assert.ok(
    iconographySource.includes(`data-resource-cost='${resource}'`),
    `${resource} needs an intentional resource-cost icon rule`,
  );
  assert.ok(
    formatResourceAmount(resource as ResourceKind, 1).trim(),
    `${resource} needs a player-facing amount label`,
  );
}
assert.ok(formatResourceAmount('game', 1).trim());

const rustTradeMappings = [...tradeResourceSource.matchAll(
  /CommodityKind::([A-Z][A-Za-z0-9]*)\s*=>\s*TradeResource::([A-Z][A-Za-z0-9]*)/g,
)].map((match) => {
  assert.equal(match[1], match[2], `Rust trade mapping renamed ${match[1]} unexpectedly`);
  return lowerCamel(match[1]);
});
const explicitNonTrade = [...tradeResourceSource.matchAll(
  /CommodityKind::([A-Z][A-Za-z0-9]*)\s*=>\s*return None/g,
)].map((match) => lowerCamel(match[1]));
assertSameSet(
  explicitNonTrade,
  ['animalFeed', 'gold', 'mead', 'vegetables'],
  'only currency, local-only mead, local-only Animal Feed, and retired aggregate vegetables may lack trade',
);
assertSameSet(
  TRADE_RESOURCE_KINDS,
  rustTradeMappings,
  'generated trade resources must mirror the authoritative Rust mapping',
);

for (const resource of TRADE_RESOURCE_KINDS) {
  const code = codeByResource.get(resource);
  assert.notEqual(code, undefined, `${resource} must be an authoritative commodity`);
  assert.equal(
    TRADE_RESOURCE_COMMODITY_CODES[resource],
    code,
    `${resource} trade code must mirror CommodityKind::as_u8`,
  );
  assert.ok(TRADE_RESOURCE_LABELS[resource].trim());
  assert.ok(tradeResourceLabel(resource).trim());
  const buy = MARKETPLACE_TRADE_OFFERS.find(
    (offer) => offer.kind === 'goldBuy' && offer.resource === resource,
  );
  const sell = MARKETPLACE_TRADE_OFFERS.find(
    (offer) => offer.kind === 'goldSell' && offer.resource === resource,
  );
  assert.ok(buy, `${resource} needs an attainable import fallback`);
  assert.ok(sell, `${resource} needs a regional export consumer`);
  assert.ok(buy.amount > 0 && buy.goldCost > 0, `${resource} import must be finite and positive`);
  assert.ok(sell.amount > 0 && sell.goldYield > 0, `${resource} export must be finite and positive`);
}

const storageCommodities = [
  ...STOREHOUSE_STORAGE_COMMODITIES,
  ...GRANARY_STORAGE_COMMODITIES,
] as StorageCommodity[];
assertSameSet(
  Object.keys(STORAGE_COMMODITY_CODES),
  sortedUnique(storageCommodities),
  'storage-code UI must cover exactly the player-configurable storage commodities',
);
for (const commodity of storageCommodities) {
  assert.equal(
    STORAGE_COMMODITY_CODES[commodity],
    codeByResource.get(commodity),
    `${commodity} storage bit must mirror CommodityKind::as_u8`,
  );
  assert.ok(STORAGE_COMMODITY_LABELS[commodity].trim());
}

const maskCodes = (name: string, next: string, offset = 0): number[] => {
  const body = storagePolicySource.match(
    new RegExp(`${name}: u64 =([\\s\\S]*?)${next}`),
  )?.[1];
  assert.ok(body, `${name} must remain discoverable`);
  return [...body.matchAll(/(?:high_)?bit\((\d+)\)/g)]
    .map((match) => Number(match[1]) + offset);
};
assert.deepEqual(
  [
    ...maskCodes('STOREHOUSE_ACCEPTANCE_MASK', 'pub const STOREHOUSE_ACCEPTANCE_MASK_HIGH'),
    ...maskCodes('STOREHOUSE_ACCEPTANCE_MASK_HIGH', 'pub const GRANARY_ACCEPTANCE_MASK'),
  ].sort((a, b) => a - b),
  [...STOREHOUSE_STORAGE_COMMODITIES].map((commodity) => STORAGE_COMMODITY_CODES[commodity]).sort((a, b) => a - b),
  'client Storehouse controls must exactly mirror the Rust default mask',
);
assert.deepEqual(
  [
    ...maskCodes('GRANARY_ACCEPTANCE_MASK', 'pub const GRANARY_ACCEPTANCE_MASK_HIGH'),
    ...maskCodes('GRANARY_ACCEPTANCE_MASK_HIGH', 'const fn bit'),
  ].sort((a, b) => a - b),
  [...GRANARY_STORAGE_COMMODITIES].map((commodity) => STORAGE_COMMODITY_CODES[commodity]).sort((a, b) => a - b),
  'client Granary controls must exactly mirror the Rust default mask',
);

const freshFoods = new Set<string>(FRESH_FOOD_KINDS);
const preservedFoods = new Set<string>(PRESERVED_FOOD_KINDS);
assert.equal(freshFoods.has('animalFeed'), false, 'Animal Feed must not count as human food');
assert.equal(preservedFoods.has('animalFeed'), false, 'Animal Feed must not count as preserved human food');
assert.equal(
  (storageCommodities as readonly string[]).includes('animalFeed'),
  false,
  'Animal Feed must remain local livestock storage rather than a configurable central-store good',
);
assert.equal(BUILDING_STORAGE_CAPS.pastoral_farmstead.animalFeed, 240);
assert.equal(BUILDING_STORAGE_CAPS.swineherd.animalFeed, 180);
assert.ok(
  (BUILDING_STORAGE_CAPS.salvage_pile.animalFeed ?? 0) > 0,
  'recovery piles need enough Animal Feed room to preserve stranded local fodder',
);
function storageCapacity(caps: StorageCaps, commodity: ResourceKind): number {
  const direct = (caps as Record<string, number | undefined>)[commodity];
  if (direct != null) return direct;
  if (['ryeSheaves', 'oatSheaves', 'maslinSheaves', 'ryeGrain', 'oatGrain', 'maslinGrain'].includes(commodity)) {
    return caps.grain ?? 0;
  }
  if (commodity === 'barleySheaves') return caps.barley ?? 0;
  if (commodity === 'ryeFlour' || commodity === 'maslinFlour') return caps.flour ?? 0;
  if (freshFoods.has(commodity)) return caps.food ?? 0;
  if (preservedFoods.has(commodity)) return caps.preservedFood ?? 0;
  return 0;
}

for (const resource of TRADE_RESOURCE_KINDS) {
  assert.ok(
    storageCapacity(BUILDING_STORAGE_CAPS.trading_post, resource as ResourceKind) > 0,
    `${resource} import needs positive physical Trading Post capacity`,
  );
}

for (const [kind, commodities] of [
  ['village_storehouse', STOREHOUSE_STORAGE_COMMODITIES],
  ['granary', GRANARY_STORAGE_COMMODITIES],
] as const) {
  const caps = BUILDING_STORAGE_CAPS[kind];
  for (const commodity of commodities) {
    assert.ok(
      storageCapacity(caps, commodity) > 0,
      `${kind} exposes ${commodity} acceptance but has no positive capacity`,
    );
    assert.equal(
      storageAcceptsCommodity({ kind } as never, commodity),
      true,
      `${kind} must accept ${commodity} by default`,
    );
  }
}

const constructionInputs = new Set<string>();
for (const [kind, cost] of Object.entries(BUILDING_COSTS)) {
  for (const [resource, amount] of Object.entries(cost)) {
    assert.ok(Number.isFinite(amount) && amount >= 0, `${kind} ${resource} cost must be finite`);
    if (amount > 0) constructionInputs.add(resource);
  }
}
for (const resource of constructionInputs) {
  assert.ok(codeByResource.has(resource), `${resource} construction input must be a commodity`);
  assert.ok(
    resource === 'gold' || (TRADE_RESOURCE_KINDS as readonly string[]).includes(resource),
    `${resource} construction input needs a trade fallback`,
  );
}

// The local ironwork and roof-tile chains must be startable without consuming
// their own outputs. This protects the intentional bootstrap independently of
// whatever small recovery reserve balance eventually chooses.
for (const kind of [
  'stone_quarry',
  'charcoal_burner',
  'smithy',
  'well',
  'potter_kiln',
] as const) {
  const cost = BUILDING_COSTS[kind];
  assert.equal(cost.ironwork ?? 0, 0, `${kind} must not circularly require ironwork`);
  assert.equal(cost.roofTiles ?? 0, 0, `${kind} must not circularly require roof tiles`);
  assert.equal(cost.gold ?? 0, 0, `${kind} must retain a local physical bootstrap`);
}
for (const kind of ['stone_quarry', 'charcoal_burner', 'smithy', 'potter_kiln'] as const) {
  assert.equal(BUILDING_DEFINITIONS[kind].acceptsLabor, true, `${kind} must expose production labor`);
  assert.ok(BUILDING_DEFINITIONS[kind].maxLabor > 0, `${kind} needs positive labor capacity`);
}

assert.match(
  marketplaceCaravanSource,
  /ResidenceNeedKind::Luxury, Some\(CommodityKind::Wine\)[\s\S]*ResidenceNeedKind::Luxury, Some\(CommodityKind::Honey\)/,
  'imported luxury stock must leave the Trading Post for its Marketplace outlet',
);
assert.match(
  marketplaceCaravanSource,
  /ResidenceNeedKind::Luxury => Some\("marketplace"\)/,
  'luxury imports must target the household-facing Marketplace',
);
assert.match(
  marketplaceCaravanSource,
  /building\.kind == "trading_post"[\s\S]*building\.shoes > 1e-6/,
  'a Trading Post holding only imported shoes must enter the service-dispatch pass',
);
for (const commodity of ['shoes', 'honey', 'wine'] as const) {
  assert.ok(
    (BUILDING_STORAGE_CAPS.marketplace[commodity] ?? 0) > 0,
    `the Marketplace serving route needs positive ${commodity} destination capacity`,
  );
}
for (const commodity of ['ale', 'cider', 'pearCider'] as const) {
  assert.ok(
    (BUILDING_STORAGE_CAPS.tavern[commodity] ?? 0) > 0,
    `the Tavern serving route needs positive ${commodity} destination capacity`,
  );
}
for (const variant of ['RyeSheaves', 'OatSheaves', 'BarleySheaves', 'MaslinSheaves']) {
  assert.match(
    expandedEconomySource,
    new RegExp(`DISPATCHABLE_INPUTS[\\s\\S]*CommodityKind::${variant}`),
    `imported ${variant} must leave the Trading Post`,
  );
  assert.match(
    expandedEconomySource,
    new RegExp(`CommodityKind::${variant} => Some\\("${lowerCamel(variant)}"\\)`),
    `${variant} needs a processor-dispatch identity`,
  );
}
assert.match(
  supplyPolicySource,
  /"threshing_barn",[\s\S]*"ryeSheaves" \| "oatSheaves" \| "barleySheaves" \| "maslinSheaves"[\s\S]*THRESHING_SHEAVES_PER_CYCLE/,
  'imported sheaves must request a real threshing working buffer',
);
assert.match(
  expandedEconomySource,
  /step_brewery[\s\S]*CommodityKind::Mead/,
  'local-only mead needs a physical brewery source',
);
assert.equal(BUILDING_DEFINITIONS.brewery.acceptsLabor, true);
assert.ok((BUILDING_STORAGE_CAPS.brewery.mead ?? 0) > 0);
assert.ok((BUILDING_STORAGE_CAPS.tavern.mead ?? 0) > 0);
assert.match(
  deliveryCargoSource,
  /building\.ale \+ building\.cider \+ building\.pear_cider \+ building\.mead/,
  'local-only mead needs a Tavern/household consumption path',
);

const maxIronworkCost = Math.max(
  ...Object.values(BUILDING_COSTS).map((cost) => cost.ironwork ?? 0),
);
const starterIronworkCostRatio = STARTING_IRONWORK / Math.max(1, maxIronworkCost);
assert.doesNotMatch(
  openingBalanceTestSource,
  /fiveYearEarlyToolWear|five years of the three opening heavy-tool sites/,
  'opening tests must exercise replacement instead of preserving a multi-year starter mask',
);
assert.match(openingBalanceTestSource, /smithyReplacementCycles/);

console.log(
  `Commodity graph passed (${authoritativeResources.length} authority/catalog/cargo/icon labels; `
    + `${TRADE_RESOURCE_KINDS.length} bidirectional trade fallbacks; `
    + `${new Set(storageCommodities).size} configurable storage goods; `
    + `${constructionInputs.size} construction inputs). `
    + `Audit flag: starter ironwork ${STARTING_IRONWORK} = ${starterIronworkCostRatio.toFixed(1)}× `
    + 'the largest building ironwork cost; bounded Smithy replacement is asserted.',
);
