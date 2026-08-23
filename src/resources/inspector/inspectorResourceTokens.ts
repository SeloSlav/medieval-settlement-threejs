import {
  formatResourceCostAmount,
  resourceCostLabel,
  type ResourceCostEntry,
  type ResourceCostKind,
} from '../../ui/resourceCost.ts';

export type InspectorResourceTokenOptions = {
  kind: ResourceCostKind;
  amount?: number;
  title?: string;
  detail?: string;
  amountLabel?: string;
  resources?: readonly ResourceCostEntry[];
  showAmount?: boolean;
  ariaLabel?: string;
  className?: string;
};

export type InspectorResourceStripOptions = {
  ariaLabel?: string;
  className?: string;
  emptyLabel?: string;
};

export function renderInspectorResourceToken(
  options: InspectorResourceTokenOptions,
): string {
  const amount = options.amount != null && Number.isFinite(options.amount)
    ? Math.max(0, options.amount)
    : null;
  const formattedAmount = amount == null ? '' : formatResourceCostAmount(amount);
  const resourceLabel = resourceCostLabel(options.kind);
  const title = options.title?.trim() || capitalize(resourceLabel);
  const detail = options.detail?.trim() || 'Current amount';
  const amountLabel = options.amountLabel?.trim() || 'On site';
  const showAmount = options.showAmount !== false && formattedAmount.length > 0;
  const ariaLabel = options.ariaLabel?.trim()
    || `${title}${formattedAmount ? `: ${formattedAmount}` : ''}`;
  const extraClass = options.className?.trim();
  const classes = [
    'inspector-resource-token',
    amount === 0 ? 'is-empty' : '',
    extraClass ?? '',
  ].filter(Boolean).join(' ');
  const amountAttributes = formattedAmount
    ? ` data-tooltip-amount="${escapeHtml(formattedAmount)}" data-tooltip-amount-label="${escapeHtml(amountLabel)}"`
    : '';
  const tooltipResources = encodeTooltipResources(options.resources);
  const resourcesAttribute = tooltipResources
    ? ` data-tooltip-resources="${escapeHtml(tooltipResources)}"`
    : '';
  const visibleAmount = showAmount
    ? `<span class="resource-cost__value inspector-resource-token__value">${escapeHtml(formattedAmount)}</span>`
    : '';

  return `<span class="${escapeHtml(classes)}" tabindex="0" data-resource-token="${options.kind}" data-tooltip-title="${escapeHtml(title)}" data-tooltip="${escapeHtml(detail)}"${amountAttributes}${resourcesAttribute} aria-label="${escapeHtml(ariaLabel)}"><span class="resource-cost__item" data-resource-cost="${options.kind}" aria-hidden="true"><span class="resource-cost__icon"></span>${visibleAmount}</span></span>`;
}

export function renderInspectorResourceStrip(
  tokens: readonly InspectorResourceTokenOptions[],
  options: InspectorResourceStripOptions = {},
): string {
  const ariaLabel = options.ariaLabel?.trim() || 'Resources';
  const extraClass = options.className?.trim();
  const classes = ['inspector-resource-strip', extraClass ?? ''].filter(Boolean).join(' ');
  const content = tokens.length > 0
    ? tokens.map(renderInspectorResourceToken).join('')
    : `<span class="inspector-resource-strip__empty">${escapeHtml(options.emptyLabel?.trim() || 'Empty')}</span>`;
  return `<span class="${escapeHtml(classes)}" role="group" aria-label="${escapeHtml(ariaLabel)}">${content}</span>`;
}

function encodeTooltipResources(
  resources: readonly ResourceCostEntry[] | undefined,
): string {
  if (!resources) return '';
  const items = resources.flatMap(({ kind, amount }) =>
    Number.isFinite(amount) && amount > 1e-6
      ? [{ kind, amount: Math.max(0, amount) }]
      : []
  );
  return items.length > 0 ? encodeURIComponent(JSON.stringify(items)) : '';
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
