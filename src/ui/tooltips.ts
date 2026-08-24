import {
  decodeResourceCostTooltip,
  formatResourceCostAmount,
  isResourceCostKind,
  resourceCostLabel,
  type ResourceCostEntry,
  type ResourceCostKind,
} from './resourceCost.ts';

const VIEWPORT_MARGIN = 12;
const TOOLTIP_GAP = 8;
export const UI_TOOLTIP_REPOSITION_EVENT = 'ui-tooltip-reposition';

type TooltipResourceItem = {
  kind: ResourceCostKind;
  amount: number;
};

type TooltipResourceFlow = {
  inputs: ResourceCostKind[];
  outputs: ResourceCostKind[];
};

type SeasonTooltipItem = {
  icon: string;
  label: string;
  months: string;
  description: string;
  season: string;
};

export function mountTooltips(root: HTMLElement): () => void {
  const tooltip = document.createElement('div');
  tooltip.className = 'ui-tooltip';
  tooltip.id = 'ui-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.appendChild(tooltip);

  let activeAnchor: HTMLElement | null = null;
  let showToken = 0;
  const activeAnchorObserver = new MutationObserver(() => {
    if (!activeAnchor) return;
    refresh(activeAnchor);
  });
  const activeContextObserver = new MutationObserver(() => {
    if (!activeAnchor) return;
    if (!isTooltipAnchorAvailable(activeAnchor, root)) hide();
  });

  const refresh = (anchor: HTMLElement): void => {
    if (!isTooltipAnchorAvailable(anchor, root)) {
      hide();
      return;
    }
    const text = anchor.dataset.tooltip?.trim();
    if (!text) {
      hide();
      return;
    }
    renderTooltipContent(anchor, tooltip, text);
    positionTooltip(anchor, tooltip);
  };

  const hide = (): void => {
    showToken += 1;
    activeAnchorObserver.disconnect();
    activeContextObserver.disconnect();
    if (activeAnchor?.getAttribute('aria-describedby') === tooltip.id) {
      activeAnchor.removeAttribute('aria-describedby');
    }
    activeAnchor = null;
    tooltip.classList.remove('is-visible');
    tooltip.hidden = true;
    tooltip.replaceChildren();
  };

  const show = (anchor: HTMLElement): void => {
    if (!isTooltipAnchorAvailable(anchor, root)) return;
    const text = anchor.dataset.tooltip?.trim();
    if (!text) return;

    // Delegated mouseover/focus events can fire again while moving between
    // descendants of the same anchor. Keep the current tooltip visible rather
    // than restarting its fade on every internal boundary crossing.
    if (activeAnchor === anchor && !tooltip.hidden) {
      refresh(anchor);
      return;
    }

    if (activeAnchor && activeAnchor !== anchor && activeAnchor.getAttribute('aria-describedby') === tooltip.id) {
      activeAnchor.removeAttribute('aria-describedby');
    }

    activeAnchor = anchor;
    activeAnchorObserver.disconnect();
    activeAnchorObserver.observe(anchor, {
      attributes: true,
      attributeFilter: [
        'data-tooltip',
        'data-tooltip-title',
        'data-tooltip-amount',
        'data-tooltip-amount-label',
        'data-tooltip-flow',
        'data-tooltip-resources',
        'data-tooltip-cost',
        'data-tooltip-cost-affordable',
        'data-tooltip-placement',
        'data-tooltip-variant',
        'data-tooltip-season',
      ],
    });
    activeContextObserver.disconnect();
    activeContextObserver.observe(root, {
      attributes: true,
      attributeFilter: ['aria-hidden', 'class', 'hidden', 'inert', 'style'],
      childList: true,
      subtree: true,
    });
    const token = showToken + 1;
    showToken = token;
    renderTooltipContent(anchor, tooltip, text);
    tooltip.hidden = false;
    tooltip.classList.remove('is-visible');
    anchor.setAttribute('aria-describedby', tooltip.id);

    requestAnimationFrame(() => {
      if (token !== showToken || activeAnchor !== anchor) return;
      positionTooltip(anchor, tooltip);
      tooltip.classList.add('is-visible');
    });
  };

  const onMouseOver = (event: MouseEvent): void => {
    const anchor = findTooltipAnchor(event.target);
    if (!anchor) return;
    show(anchor);
  };

  const onMouseOut = (event: MouseEvent): void => {
    const anchor = findTooltipAnchor(event.target);
    if (!anchor || activeAnchor !== anchor) return;
    const related = event.relatedTarget;
    if (related instanceof Node && anchor.contains(related)) return;
    hide();
  };

  const onFocusIn = (event: FocusEvent): void => {
    const anchor = findTooltipAnchor(event.target);
    if (anchor) show(anchor);
  };

  const onFocusOut = (event: FocusEvent): void => {
    const anchor = findTooltipAnchor(event.target);
    if (!anchor || activeAnchor !== anchor) return;
    const related = event.relatedTarget;
    if (related instanceof Node && anchor.contains(related)) return;
    hide();
  };

  const onDocumentMouseOver = (event: MouseEvent): void => {
    if (!activeAnchor) return;
    const target = event.target;
    if (target instanceof Node && activeAnchor.contains(target)) return;
    hide();
  };

  const onDocumentVisibilityChange = (): void => {
    if (document.hidden) hide();
  };

  const onReposition = (): void => {
    if (!activeAnchor) return;
    if (!isTooltipAnchorAvailable(activeAnchor, root)) {
      hide();
      return;
    }
    positionTooltip(activeAnchor, tooltip);
  };

  root.addEventListener('mouseover', onMouseOver);
  root.addEventListener('mouseout', onMouseOut);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener(UI_TOOLTIP_REPOSITION_EVENT, onReposition);
  document.addEventListener('mouseover', onDocumentMouseOver, true);
  document.addEventListener('visibilitychange', onDocumentVisibilityChange);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', onReposition);
  window.addEventListener('scroll', onReposition, true);

  return () => {
    hide();
    tooltip.remove();
    root.removeEventListener('mouseover', onMouseOver);
    root.removeEventListener('mouseout', onMouseOut);
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onFocusOut);
    root.removeEventListener(UI_TOOLTIP_REPOSITION_EVENT, onReposition);
    document.removeEventListener('mouseover', onDocumentMouseOver, true);
    document.removeEventListener('visibilitychange', onDocumentVisibilityChange);
    window.removeEventListener('blur', hide);
    window.removeEventListener('resize', onReposition);
    window.removeEventListener('scroll', onReposition, true);
  };
}

function renderTooltipContent(
  anchor: HTMLElement,
  tooltip: HTMLElement,
  sourceText: string,
): void {
  let title = anchor.dataset.tooltipTitle?.trim() ?? '';
  let body = sourceText;

  // Keep older "Title — description" tooltips readable while callers migrate
  // to the explicit data-tooltip-title attribute.
  if (!title) {
    const separatorIndex = sourceText.indexOf(' — ');
    if (separatorIndex > 0 && separatorIndex <= 48) {
      title = sourceText.slice(0, separatorIndex).trim();
      body = sourceText.slice(separatorIndex + 3).trim();
    }
  }

  const seasonItems = anchor.dataset.tooltipVariant === 'season-almanac'
    ? readSeasonTooltipItems(body)
    : [];
  tooltip.classList.toggle('ui-tooltip--season-almanac', seasonItems.length > 0);
  if (seasonItems.length > 0) {
    renderSeasonAlmanacTooltip(
      tooltip,
      title,
      anchor.dataset.tooltipSeason?.trim() ?? '',
      seasonItems,
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  if (title) {
    const titleElement = document.createElement('strong');
    titleElement.className = 'ui-tooltip__title';
    titleElement.textContent = title;
    fragment.appendChild(titleElement);
  }

  const amountText = anchor.dataset.tooltipAmount?.trim() ?? '';
  tooltip.classList.toggle('has-amount', amountText.length > 0);
  if (amountText) {
    const amountRow = document.createElement('div');
    amountRow.className = 'ui-tooltip__amount';

    const amountLabel = document.createElement('span');
    amountLabel.className = 'ui-tooltip__amount-label';
    amountLabel.textContent = anchor.dataset.tooltipAmountLabel?.trim() || 'Current amount';

    const amountValue = document.createElement('strong');
    amountValue.className = 'ui-tooltip__amount-value';
    amountValue.textContent = amountText;
    amountRow.append(amountLabel, amountValue);
    fragment.appendChild(amountRow);
  }

  const bodyElement = document.createElement('div');
  bodyElement.className = 'ui-tooltip__body';
  const sections = body
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean);

  for (const section of sections) {
    const items = section
      .split(/\s+·\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length > 1) {
      const list = document.createElement('ul');
      list.className = 'ui-tooltip__list';
      for (const item of items) {
        const listItem = document.createElement('li');
        appendTooltipText(listItem, item);
        list.appendChild(listItem);
      }
      bodyElement.appendChild(list);
      continue;
    }

    const paragraph = document.createElement('p');
    paragraph.className = 'ui-tooltip__paragraph';
    appendTooltipText(paragraph, section);
    bodyElement.appendChild(paragraph);
  }

  const resourceFlow = readTooltipResourceFlow(anchor);
  if (resourceFlow) {
    const flowRow = document.createElement('div');
    flowRow.className = 'ui-tooltip__resource-flow';

    if (resourceFlow.inputs.length > 0) {
      const inputGroup = document.createElement('span');
      inputGroup.className = 'ui-tooltip__resource-flow-group';
      for (const kind of resourceFlow.inputs) {
        inputGroup.appendChild(createTooltipResourceIdentity(kind));
      }
      flowRow.appendChild(inputGroup);

      const arrow = document.createElement('span');
      arrow.className = 'ui-tooltip__resource-flow-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '\u2192';
      flowRow.appendChild(arrow);
    }

    const outputGroup = document.createElement('span');
    outputGroup.className = 'ui-tooltip__resource-flow-group ui-tooltip__resource-flow-group--output';
    for (const kind of resourceFlow.outputs) {
      outputGroup.appendChild(createTooltipResourceIdentity(kind));
    }
    flowRow.appendChild(outputGroup);
    bodyElement.appendChild(flowRow);
  }

  const resourceItems = readTooltipResourceItems(anchor);
  if (resourceItems.length > 0) {
    const list = document.createElement('ul');
    list.className = 'ui-tooltip__resource-inventory';
    for (const item of resourceItems) {
      const listItem = document.createElement('li');
      const identity = createTooltipResourceIdentity(item.kind);

      const amount = document.createElement('strong');
      amount.className = 'ui-tooltip__resource-amount';
      amount.textContent = formatResourceCostAmount(item.amount);
      listItem.append(identity, amount);
      list.appendChild(listItem);
    }
    bodyElement.appendChild(list);
  }

  const resourceCost = anchor.dataset.tooltipCost
    ? decodeResourceCostTooltip(anchor.dataset.tooltipCost)
    : null;
  tooltip.classList.toggle('has-cost', resourceCost !== null);
  if (resourceCost) {
    bodyElement.appendChild(createTooltipConstructionCost(
      resourceCost.items,
      resourceCost.suffix,
      anchor.dataset.tooltipCostAffordable !== 'false',
    ));
  }

  fragment.appendChild(bodyElement);
  tooltip.replaceChildren(fragment);
}

function readSeasonTooltipItems(sourceText: string): SeasonTooltipItem[] {
  return sourceText
    .split(/\s+·\s+/)
    .map((item) => item.trim().match(/^(\S+)\s+(Spring|Summer|Autumn|Winter)\s+\(([^)]+)\)\s+—\s+(.+)$/))
    .flatMap((match) => match
      ? [{
        icon: match[1],
        label: match[2],
        months: match[3],
        description: match[4],
        season: match[2].toLowerCase(),
      }]
      : []);
}

function renderSeasonAlmanacTooltip(
  tooltip: HTMLElement,
  title: string,
  currentSeason: string,
  items: readonly SeasonTooltipItem[],
): void {
  const current = items.find((item) => item.season === currentSeason) ?? items[0];
  const fragment = document.createDocumentFragment();

  const header = document.createElement('div');
  header.className = 'ui-tooltip__season-header';
  header.dataset.season = current.season;

  const headerIcon = document.createElement('span');
  headerIcon.className = 'ui-tooltip__season-header-icon';
  headerIcon.setAttribute('aria-hidden', 'true');
  headerIcon.textContent = current.icon;

  const titleElement = document.createElement('strong');
  titleElement.className = 'ui-tooltip__title';
  titleElement.textContent = title || current.label;
  header.append(headerIcon, titleElement);
  fragment.appendChild(header);

  const introduction = document.createElement('p');
  introduction.className = 'ui-tooltip__season-introduction';
  introduction.textContent = 'Seasons shape harvests, livestock, travel, stores, and household needs.';
  fragment.appendChild(introduction);

  const list = document.createElement('ul');
  list.className = 'ui-tooltip__season-list';
  for (const item of items) {
    const listItem = document.createElement('li');
    listItem.dataset.season = item.season;
    const isCurrent = item.season === current.season;
    listItem.classList.toggle('is-current', isCurrent);

    const icon = document.createElement('span');
    icon.className = 'ui-tooltip__season-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = item.icon;

    const copy = document.createElement('span');
    copy.className = 'ui-tooltip__season-copy';
    const identity = document.createElement('span');
    identity.className = 'ui-tooltip__season-identity';
    const label = document.createElement('strong');
    label.className = 'ui-tooltip__season-name';
    label.textContent = item.label;
    const months = document.createElement('span');
    months.className = 'ui-tooltip__season-months';
    months.textContent = `(${item.months})`;
    identity.append(label, document.createTextNode(' '), months);
    if (isCurrent) {
      const currentMarker = document.createElement('span');
      currentMarker.className = 'ui-tooltip__season-current';
      currentMarker.textContent = 'Current';
      identity.append(document.createTextNode(' '), currentMarker);
    }

    const description = document.createElement('span');
    description.className = 'ui-tooltip__season-description';
    description.textContent = item.description;
    copy.append(identity, description);
    listItem.append(icon, copy);
    list.appendChild(listItem);
  }
  fragment.appendChild(list);

  tooltip.classList.remove('has-amount');
  tooltip.classList.remove('has-cost');
  tooltip.replaceChildren(fragment);
}

function createTooltipConstructionCost(
  items: readonly ResourceCostEntry[],
  suffix: string,
  affordable: boolean,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'ui-tooltip__construction-cost';
  row.classList.toggle('is-unaffordable', !affordable);

  const label = document.createElement('span');
  label.className = 'ui-tooltip__construction-cost-label';
  label.textContent = 'Construction cost';

  const cost = document.createElement('span');
  cost.className = `resource-cost resource-cost--compact${affordable ? '' : ' resource-cost--unaffordable'}`;
  if (items.length === 0) {
    cost.classList.add('resource-cost--free');
    cost.textContent = 'Free';
  } else {
    cost.setAttribute('role', 'img');
    cost.setAttribute('aria-label', `${affordable ? '' : 'Not enough resources. '}${items
      .map(({ kind, amount }) => `${formatResourceCostAmount(amount)} ${resourceCostLabel(kind)}`)
      .join(', ')}${suffix ? ` ${suffix}` : ''}`);
    for (const item of items) {
      const identity = document.createElement('span');
      identity.className = 'resource-cost__item';
      identity.dataset.resourceCost = item.kind;

      const icon = document.createElement('span');
      icon.className = 'resource-cost__icon';
      icon.setAttribute('aria-hidden', 'true');
      const amount = document.createElement('span');
      amount.className = 'resource-cost__value';
      amount.textContent = formatResourceCostAmount(item.amount);
      identity.append(icon, amount);
      cost.appendChild(identity);
    }
  }
  if (suffix) {
    const suffixElement = document.createElement('span');
    suffixElement.className = 'resource-cost__suffix';
    suffixElement.textContent = suffix;
    cost.appendChild(suffixElement);
  }

  row.append(label, cost);
  return row;
}

function readTooltipResourceFlow(anchor: HTMLElement): TooltipResourceFlow | null {
  const source = anchor.dataset.tooltipFlow;
  if (!source) return null;
  try {
    const decoded: unknown = JSON.parse(decodeURIComponent(source));
    if (decoded == null || typeof decoded !== 'object') return null;
    const inputs = 'inputs' in decoded
      ? readTooltipResourceKinds(decoded.inputs)
      : [];
    const outputs = 'outputs' in decoded
      ? readTooltipResourceKinds(decoded.outputs)
      : [];
    return outputs.length > 0 ? { inputs, outputs } : null;
  } catch {
    return null;
  }
}

function readTooltipResourceKinds(value: unknown): ResourceCostKind[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (candidate): candidate is ResourceCostKind =>
      typeof candidate === 'string' && isResourceCostKind(candidate),
  );
}

function createTooltipResourceIdentity(kind: ResourceCostKind): HTMLSpanElement {
  const identity = document.createElement('span');
  identity.className = 'resource-cost__item';
  identity.dataset.resourceCost = kind;

  const icon = document.createElement('span');
  icon.className = 'resource-cost__icon';
  icon.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'ui-tooltip__resource-name';
  name.textContent = resourceCostLabel(kind);
  identity.append(icon, name);
  return identity;
}

function readTooltipResourceItems(anchor: HTMLElement): TooltipResourceItem[] {
  const source = anchor.dataset.tooltipResources;
  if (!source) return [];
  try {
    const decoded: unknown = JSON.parse(decodeURIComponent(source));
    if (!Array.isArray(decoded)) return [];
    return decoded.flatMap((candidate) => {
      if (candidate == null || typeof candidate !== 'object') return [];
      const kind = 'kind' in candidate ? candidate.kind : null;
      const amount = 'amount' in candidate ? candidate.amount : null;
      return typeof kind === 'string'
        && isResourceCostKind(kind)
        && typeof amount === 'number'
        && Number.isFinite(amount)
        && amount > 1e-6
        ? [{ kind, amount }]
        : [];
    });
  } catch {
    return [];
  }
}

function appendTooltipText(parent: HTMLElement, text: string): void {
  const labelledText = text.match(/^([^:\n]{2,48}:)\s+(.+)$/s);
  if (!labelledText) {
    parent.textContent = text;
    return;
  }

  const label = document.createElement('strong');
  label.className = 'ui-tooltip__label';
  label.textContent = labelledText[1];
  parent.append(label, document.createTextNode(` ${labelledText[2]}`));
}

function findTooltipAnchor(target: EventTarget | null): HTMLElement | null {
  const element = target as HTMLElement | null;
  if (!element?.closest) return null;
  return element.closest<HTMLElement>('[data-tooltip]');
}

function isTooltipAnchorAvailable(anchor: HTMLElement, root: HTMLElement): boolean {
  if (!anchor.isConnected || !root.contains(anchor)) return false;
  if (anchor.closest('[hidden], [inert]')) return false;
  const visibility = getComputedStyle(anchor).visibility;
  return visibility !== 'hidden'
    && visibility !== 'collapse'
    && anchor.getClientRects().length > 0;
}

function positionTooltip(anchor: HTMLElement, tooltip: HTMLElement): void {
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const placement = anchor.dataset.tooltipPlacement === 'above' ? 'above' : 'auto';
  const position = resolveTooltipPosition(
    anchorRect,
    tooltipRect,
    window.innerWidth,
    window.innerHeight,
    placement,
  );

  tooltip.style.left = `${Math.round(position.left)}px`;
  tooltip.style.top = `${Math.round(position.top)}px`;
}

export type TooltipPlacement = 'auto' | 'above';

export function resolveTooltipPosition(
  anchorRect: Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>,
  tooltipRect: Pick<DOMRect, 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
  placement: TooltipPlacement = 'auto',
): { left: number; top: number } {
  const belowTop = anchorRect.bottom + TOOLTIP_GAP;
  const aboveTop = anchorRect.top - tooltipRect.height - TOOLTIP_GAP;
  let top = placement === 'above' ? aboveTop : belowTop;
  let left = anchorRect.left + (anchorRect.width - tooltipRect.width) * 0.5;

  if (placement === 'auto' && belowTop + tooltipRect.height > viewportHeight - VIEWPORT_MARGIN && aboveTop >= VIEWPORT_MARGIN) {
    top = aboveTop;
  }

  left = Math.max(VIEWPORT_MARGIN, Math.min(viewportWidth - tooltipRect.width - VIEWPORT_MARGIN, left));
  top = Math.max(VIEWPORT_MARGIN, Math.min(viewportHeight - tooltipRect.height - VIEWPORT_MARGIN, top));

  return { left, top };
}
