import {
  formatResourceCostAmount,
  isResourceCostKind,
  resourceCostLabel,
  type ResourceCostKind,
} from './resourceCost.ts';

const VIEWPORT_MARGIN = 12;
const TOOLTIP_GAP = 8;

type TooltipResourceItem = {
  kind: ResourceCostKind;
  amount: number;
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

  const refresh = (anchor: HTMLElement): void => {
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
    if (activeAnchor?.getAttribute('aria-describedby') === tooltip.id) {
      activeAnchor.removeAttribute('aria-describedby');
    }
    activeAnchor = null;
    tooltip.classList.remove('is-visible');
    tooltip.hidden = true;
    tooltip.replaceChildren();
  };

  const show = (anchor: HTMLElement): void => {
    const text = anchor.dataset.tooltip?.trim();
    if (!text) return;

    if (activeAnchor && activeAnchor !== anchor && activeAnchor.getAttribute('aria-describedby') === tooltip.id) {
      activeAnchor.removeAttribute('aria-describedby');
    }

    activeAnchor = anchor;
    activeAnchorObserver.disconnect();
    activeAnchorObserver.observe(anchor, {
      attributes: true,
      attributeFilter: ['data-tooltip', 'data-tooltip-title'],
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

  const onReposition = (): void => {
    if (!activeAnchor) return;
    positionTooltip(activeAnchor, tooltip);
  };

  root.addEventListener('mouseover', onMouseOver);
  root.addEventListener('mouseout', onMouseOut);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  window.addEventListener('resize', onReposition);
  window.addEventListener('scroll', onReposition, true);

  return () => {
    hide();
    tooltip.remove();
    root.removeEventListener('mouseover', onMouseOver);
    root.removeEventListener('mouseout', onMouseOut);
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', onFocusOut);
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

  const fragment = document.createDocumentFragment();
  if (title) {
    const titleElement = document.createElement('strong');
    titleElement.className = 'ui-tooltip__title';
    titleElement.textContent = title;
    fragment.appendChild(titleElement);
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

  const resourceItems = readTooltipResourceItems(anchor);
  if (resourceItems.length > 0) {
    const list = document.createElement('ul');
    list.className = 'ui-tooltip__resource-inventory';
    for (const item of resourceItems) {
      const listItem = document.createElement('li');
      const identity = document.createElement('span');
      identity.className = 'resource-cost__item';
      identity.dataset.resourceCost = item.kind;

      const icon = document.createElement('span');
      icon.className = 'resource-cost__icon';
      icon.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'ui-tooltip__resource-name';
      name.textContent = resourceCostLabel(item.kind);
      identity.append(icon, name);

      const amount = document.createElement('strong');
      amount.className = 'ui-tooltip__resource-amount';
      amount.textContent = formatResourceCostAmount(item.amount);
      listItem.append(identity, amount);
      list.appendChild(listItem);
    }
    bodyElement.appendChild(list);
  }

  fragment.appendChild(bodyElement);
  tooltip.replaceChildren(fragment);
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

function positionTooltip(anchor: HTMLElement, tooltip: HTMLElement): void {
  const anchorRect = anchor.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  let top = anchorRect.bottom + TOOLTIP_GAP;
  let left = anchorRect.left + (anchorRect.width - tooltipRect.width) * 0.5;

  const aboveTop = anchorRect.top - tooltipRect.height - TOOLTIP_GAP;
  if (top + tooltipRect.height > window.innerHeight - VIEWPORT_MARGIN && aboveTop >= VIEWPORT_MARGIN) {
    top = aboveTop;
  }

  left = Math.max(VIEWPORT_MARGIN, Math.min(window.innerWidth - tooltipRect.width - VIEWPORT_MARGIN, left));
  top = Math.max(VIEWPORT_MARGIN, Math.min(window.innerHeight - tooltipRect.height - VIEWPORT_MARGIN, top));

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}
