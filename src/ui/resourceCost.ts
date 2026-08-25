import type { BuildingResourceCost } from '../resources/buildingEconomy.ts';

export const RESOURCE_COST_KINDS = [
  'timber',
  'stone',
  'ironwork',
  'roofTiles',
  'gold',
  'iron',
  'clay',
  'salt',
  'charcoal',
  'pottery',
  'manure',
  'remedies',
  'firewood',
  'water',
  'food',
  'ryeSheaves',
  'oatSheaves',
  'barleySheaves',
  'maslinSheaves',
  'ryeGrain',
  'oatGrain',
  'animalFeed',
  'maslinGrain',
  'barley',
  'malt',
  'ryeFlour',
  'maslinFlour',
  'ale',
  'cider',
  'pearCider',
  'mead',
  'preservedFood',
  'honey',
  'wine',
  'wool',
  'flax',
  'cloth',
  'hides',
  'leather',
  'shoes',
  'polearms',
  'ryeBread',
  'maslinBread',
  'meat',
  'fish',
  'berries',
  'mushrooms',
  'milk',
  'apples',
  'pears',
  'cherries',
  'aronia',
  'rosehips',
  'vegetables',
  'cabbage',
  'carrots',
  'beetroot',
  'eggs',
  'grapes',
  'curedMeat',
  'smokedFish',
  'cheese',
  'aroniaJam',
  'rosehipJam',
] as const;

export type ResourceCostKind = (typeof RESOURCE_COST_KINDS)[number];
export type ResourceCostAmounts = Partial<Record<ResourceCostKind, number>>;
export type ResourceCostEntry = {
  kind: ResourceCostKind;
  amount: number;
};

export type ResourceCostTooltipData = {
  items: ResourceCostEntry[];
  suffix: string;
};

const RESOURCE_COST_LABELS: Record<ResourceCostKind, string> = {
  timber: 'timber',
  stone: 'stone',
  ironwork: 'ironwork',
  roofTiles: 'roof tiles',
  gold: 'gold',
  iron: 'iron',
  clay: 'clay',
  salt: 'salt',
  charcoal: 'charcoal',
  pottery: 'pottery',
  manure: 'manure',
  remedies: 'remedies',
  firewood: 'firewood',
  water: 'water',
  food: 'food',
  ryeSheaves: 'rye sheaves',
  oatSheaves: 'oat sheaves',
  barleySheaves: 'barley sheaves',
  maslinSheaves: 'maslin sheaves',
  ryeGrain: 'rye grain',
  oatGrain: 'oats',
  animalFeed: 'animal feed',
  maslinGrain: 'maslin grain',
  barley: 'barley',
  malt: 'malt',
  ryeFlour: 'rye flour',
  maslinFlour: 'maslin flour',
  ale: 'ale',
  cider: 'apple cider',
  pearCider: 'pear cider',
  mead: 'mead',
  preservedFood: 'preserved staples',
  honey: 'honey',
  wine: 'wine',
  wool: 'wool',
  flax: 'flax',
  cloth: 'cloth',
  hides: 'hides',
  leather: 'leather',
  shoes: 'shoes',
  polearms: 'polearms',
  ryeBread: 'rye bread',
  maslinBread: 'maslin bread',
  meat: 'meat',
  fish: 'fish',
  berries: 'berries',
  mushrooms: 'mushrooms',
  milk: 'milk',
  apples: 'apples',
  pears: 'pears',
  cherries: 'cherries',
  aronia: 'aronia berries',
  rosehips: 'rosehips',
  vegetables: 'vegetables',
  cabbage: 'cabbage',
  carrots: 'carrots',
  beetroot: 'beetroot',
  eggs: 'eggs',
  grapes: 'grapes',
  curedMeat: 'cured meat',
  smokedFish: 'smoked fish',
  cheese: 'cheese',
  aroniaJam: 'aronia jam',
  rosehipJam: 'rosehip jam',
};

export function isResourceCostKind(value: string): value is ResourceCostKind {
  return (RESOURCE_COST_KINDS as readonly string[]).includes(value);
}

export function resourceCostLabel(kind: ResourceCostKind): string {
  return RESOURCE_COST_LABELS[kind];
}

export type ResourceCostMarkupOptions = {
  compact?: boolean;
  suffix?: string;
  unaffordable?: boolean;
};

export function buildingResourceCostAmounts(
  cost: BuildingResourceCost,
): ResourceCostAmounts {
  return {
    timber: cost.timber,
    stone: cost.stone,
    ironwork: cost.ironwork,
    roofTiles: cost.roofTiles,
    gold: cost.gold,
  };
}

export function renderBuildingResourceCost(
  cost: BuildingResourceCost,
  options: ResourceCostMarkupOptions = {},
): string {
  return renderResourceCost(buildingResourceCostAmounts(cost), options);
}

export function renderResourceAmount(
  kind: ResourceCostKind,
  amount: number,
  options: ResourceCostMarkupOptions = {},
): string {
  return renderResourceCost({ [kind]: amount }, options);
}

/**
 * Renders a numeric resource cost with the same semantic icons used by the
 * settlement HUD. Full resource names remain available to assistive
 * technology and native hover hints.
 */
export function renderResourceCost(
  amounts: ResourceCostAmounts,
  options: ResourceCostMarkupOptions = {},
): string {
  const entries = resourceCostEntries(amounts);
  if (entries.length === 0) {
    const classes = options.unaffordable
      ? 'resource-cost resource-cost--free resource-cost--unaffordable'
      : 'resource-cost resource-cost--free';
    return `<span class="${classes}">Free</span>`;
  }

  const suffix = options.suffix?.trim() ?? '';
  const accessibleLabel = `${options.unaffordable ? 'Not enough resources. ' : ''}${entries
    .map(({ kind, amount }) => `${formatResourceCostAmount(amount)} ${RESOURCE_COST_LABELS[kind]}`)
    .join(', ')}${suffix ? ` ${suffix}` : ''}`;
  const classes = [
    'resource-cost',
    options.compact ? 'resource-cost--compact' : '',
    options.unaffordable ? 'resource-cost--unaffordable' : '',
  ].filter(Boolean).join(' ');
  const items = entries.map(({ kind, amount }) => {
    const label = RESOURCE_COST_LABELS[kind];
    return `<span class="resource-cost__item" data-resource-cost="${kind}" title="${capitalize(label)}"><span class="resource-cost__icon" aria-hidden="true"></span><span class="resource-cost__value">${formatResourceCostAmount(amount)}</span></span>`;
  }).join('');
  const visibleSuffix = suffix
    ? `<span class="resource-cost__suffix">${escapeHtml(suffix)}</span>`
    : '';

  return `<span class="${classes}" role="img" aria-label="${escapeHtml(accessibleLabel)}">${items}${visibleSuffix}</span>`;
}

export function resourceCostEntries(amounts: ResourceCostAmounts): ResourceCostEntry[] {
  return RESOURCE_COST_KINDS.flatMap((kind) => {
    const amount = amounts[kind];
    return amount != null && Number.isFinite(amount) && amount > 1e-9
      ? [{ kind, amount }]
      : [];
  });
}

export function isResourceCostAffordable(
  available: ResourceCostAmounts,
  required: ResourceCostAmounts,
): boolean {
  return resourceCostEntries(required).every(
    ({ kind, amount }) => (available[kind] ?? 0) + 1e-6 >= amount,
  );
}

export function encodeResourceCostTooltip(
  amounts: ResourceCostAmounts,
  options: Pick<ResourceCostMarkupOptions, 'suffix'> = {},
): string {
  return encodeURIComponent(JSON.stringify({
    items: resourceCostEntries(amounts),
    suffix: options.suffix?.trim() ?? '',
  } satisfies ResourceCostTooltipData));
}

export const FREE_CONSTRUCTION_COST_TOOLTIP = encodeResourceCostTooltip({});

export function decodeResourceCostTooltip(source: string): ResourceCostTooltipData | null {
  try {
    const decoded: unknown = JSON.parse(decodeURIComponent(source));
    if (decoded == null || typeof decoded !== 'object') return null;
    const items = 'items' in decoded && Array.isArray(decoded.items)
      ? decoded.items.flatMap((candidate): ResourceCostEntry[] => {
          if (candidate == null || typeof candidate !== 'object') return [];
          const kind = 'kind' in candidate ? candidate.kind : null;
          const amount = 'amount' in candidate ? candidate.amount : null;
          return typeof kind === 'string'
            && isResourceCostKind(kind)
            && typeof amount === 'number'
            && Number.isFinite(amount)
            && amount > 1e-9
            ? [{ kind, amount }]
            : [];
        })
      : [];
    const suffix = 'suffix' in decoded && typeof decoded.suffix === 'string'
      ? decoded.suffix.trim()
      : '';
    return { items, suffix };
  } catch {
    return null;
  }
}

export function formatResourceCostAmount(amount: number): string {
  if (Number.isInteger(amount)) return amount.toString();
  return (Math.round(amount * 100) / 100).toString();
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
