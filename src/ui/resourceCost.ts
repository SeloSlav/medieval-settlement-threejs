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
  'firewood',
  'water',
  'food',
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
  firewood: 'firewood',
  water: 'water',
  food: 'food',
};

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

/**
 * Renders a numeric construction cost with the same semantic material icons
 * used by the settlement HUD. The full resource names remain available to
 * assistive technology and native hover hints.
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

function formatResourceCostAmount(amount: number): string {
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
