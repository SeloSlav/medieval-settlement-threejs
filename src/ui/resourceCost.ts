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
  'grain',
  'barley',
  'malt',
  'flour',
  'ale',
  'preservedFood',
  'honey',
  'wine',
  'wool',
  'flax',
  'cloth',
  'polearms',
  'bread',
  'meat',
  'fish',
  'berries',
  'mushrooms',
  'milk',
  'apples',
  'cherries',
  'vegetables',
  'eggs',
  'grapes',
  'porridge',
  'curedMeat',
  'smokedFish',
  'cheese',
] as const;

export type ResourceCostKind = (typeof RESOURCE_COST_KINDS)[number];
export type ResourceCostAmounts = Partial<Record<ResourceCostKind, number>>;

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
  grain: 'grain',
  barley: 'barley',
  malt: 'malt',
  flour: 'flour',
  ale: 'ale',
  preservedFood: 'preserved staples',
  honey: 'honey',
  wine: 'wine',
  wool: 'wool',
  flax: 'flax',
  cloth: 'cloth',
  polearms: 'polearms',
  bread: 'bread',
  meat: 'meat',
  fish: 'fish',
  berries: 'berries',
  mushrooms: 'mushrooms',
  milk: 'milk',
  apples: 'apples',
  cherries: 'cherries',
  vegetables: 'vegetables',
  eggs: 'eggs',
  grapes: 'grapes',
  porridge: 'porridge',
  curedMeat: 'cured meat',
  smokedFish: 'smoked fish',
  cheese: 'cheese',
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
};

export function buildingResourceCostAmounts(
  cost: BuildingResourceCost,
): ResourceCostAmounts {
  return {
    timber: cost.timber,
    stone: cost.stone,
    ironwork: cost.ironwork,
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
  const entries = RESOURCE_COST_KINDS.flatMap((kind) => {
    const amount = amounts[kind];
    return amount != null && Number.isFinite(amount) && amount > 1e-9
      ? [{ kind, amount }]
      : [];
  });
  if (entries.length === 0) {
    return '<span class="resource-cost resource-cost--free">Free</span>';
  }

  const suffix = options.suffix?.trim() ?? '';
  const accessibleLabel = `${entries
    .map(({ kind, amount }) => `${formatResourceCostAmount(amount)} ${RESOURCE_COST_LABELS[kind]}`)
    .join(', ')}${suffix ? ` ${suffix}` : ''}`;
  const classes = options.compact
    ? 'resource-cost resource-cost--compact'
    : 'resource-cost';
  const items = entries.map(({ kind, amount }) => {
    const label = RESOURCE_COST_LABELS[kind];
    return `<span class="resource-cost__item" data-resource-cost="${kind}" title="${capitalize(label)}"><span class="resource-cost__icon" aria-hidden="true"></span><span class="resource-cost__value">${formatResourceCostAmount(amount)}</span></span>`;
  }).join('');
  const visibleSuffix = suffix
    ? `<span class="resource-cost__suffix">${escapeHtml(suffix)}</span>`
    : '';

  return `<span class="${classes}" role="img" aria-label="${escapeHtml(accessibleLabel)}">${items}${visibleSuffix}</span>`;
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
