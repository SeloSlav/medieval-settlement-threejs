import type { CombatAgentState } from '../security/combatAgents.ts';
import { MILITARY_COMPANY_CARD_ART } from '../security/militaryCompanyCardArt.ts';
import { MILITARY_COMPANY_STRATEGIC_ICON_ART } from '../security/militaryCompanyPresentation.ts';
import { militaryCompanyDisplayName, militaryCompanyRankLabel, type MilitaryCompanyState } from '../security/militaryProgression.ts';
import { AlertDialog } from './AlertDialog.ts';
import {
  militaryOrderAvailable, renderMilitaryOrders,
  type MilitaryOrder,
} from './militaryMenuPresentation.ts';

export type MilitaryMenuHandlers = {
  onSelectCompany: (id: string) => void;
  onOrder: (ids: string[], order: MilitaryOrder) => Promise<void>;
  onClose: () => void;
};

type CompanyCard = { button: HTMLButtonElement; count: HTMLElement };

export class MilitaryMenu {
  readonly element = document.createElement('section');
  private readonly viewport: HTMLElement;
  private readonly cardsRoot: HTMLElement;
  private readonly orders: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly empty: HTMLElement;
  private readonly cards = new Map<string, CompanyCard>();
  private readonly observer: ResizeObserver;
  private readonly dialog: AlertDialog;
  private companies: MilitaryCompanyState[] = [];
  private selected = new Set<string>();
  private ordersHtml = '';
  private pending = false;
  private readonly handlers: MilitaryMenuHandlers;

  constructor(parent: HTMLElement, handlers: MilitaryMenuHandlers) {
    this.handlers = handlers;
    this.element.className = 'military-menu';
    this.element.id = 'military-menu';
    this.element.setAttribute('aria-label', 'Military');
    this.element.hidden = true;
    this.element.innerHTML = `
      <button type="button" class="military-menu__utility military-menu__close" data-close-military aria-label="Close military" data-tooltip="Close military">×</button>
      <div class="military-menu__rail" data-military-orders-rail hidden>
        <div class="military-menu__orders" data-military-orders></div>
      </div>
      <div class="military-menu__roster">
        <button type="button" class="military-menu__scroll" data-scroll-previous aria-label="Scroll companies left">‹</button>
        <div class="military-menu__viewport" data-military-viewport tabindex="0" aria-label="Company cards">
          <div class="military-menu__cards" data-military-cards></div>
          <p class="military-menu__empty" data-military-empty>No companies in service.</p>
        </div>
        <button type="button" class="military-menu__scroll" data-scroll-next aria-label="Scroll companies right">›</button>
      </div>`;
    parent.prepend(this.element);
    const find = <T extends HTMLElement>(selector: string) => this.element.querySelector<T>(selector)!;
    this.viewport = find('[data-military-viewport]');
    this.cardsRoot = find('[data-military-cards]');
    this.orders = find('[data-military-orders]');
    this.rail = find('[data-military-orders-rail]');
    this.previous = find('[data-scroll-previous]');
    this.next = find('[data-scroll-next]');
    this.empty = find('[data-military-empty]');
    this.dialog = new AlertDialog(parent.closest<HTMLElement>('[data-ui-root]') ?? parent);
    find('[data-close-military]').addEventListener('click', handlers.onClose);
    this.previous.addEventListener('click', () => this.scroll(-1));
    this.next.addEventListener('click', () => this.scroll(1));
    this.viewport.addEventListener('scroll', this.syncScroll);
    this.element.addEventListener('wheel', this.onWheel, { passive: false });
    this.element.addEventListener('mousedown', (event) => event.stopPropagation());
    this.element.addEventListener('click', this.onClick);
    this.observer = new ResizeObserver(this.syncScroll);
    this.observer.observe(this.viewport);
    this.renderOrders();
  }

  get isOpen(): boolean { return !this.element.hidden; }

  setOpen(open: boolean): void {
    this.element.hidden = !open;
    if (open) this.syncScroll();
  }

  select(ids: readonly string[]): void {
    this.selected = new Set(ids);
    this.syncSelection();
    this.renderOrders();
    const card = this.cards.get(ids[0] ?? '')?.button;
    if (card && this.isOpen) this.revealCard(card);
  }

  sync(companies: Iterable<MilitaryCompanyState>, _agents: Iterable<CombatAgentState>): void {
    this.companies = [...companies].filter((c) => c.status !== 'destroyed')
      .sort((a, b) => a.formedTick - b.formedTick || a.id.localeCompare(b.id, undefined, { numeric: true }));
    const live = new Set(this.companies.map((c) => c.id));
    for (const [id, card] of this.cards) {
      if (live.has(id)) continue;
      card.button.remove();
      this.cards.delete(id);
      this.selected.delete(id);
    }
    this.companies.forEach((company, index) => {
      let card = this.cards.get(company.id);
      if (!card) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'military-unit-card';
        button.dataset.militaryCompany = company.id;
        button.innerHTML = `<span class="military-unit-card__frame"><img class="military-unit-card__art" src="${MILITARY_COMPANY_CARD_ART[company.kind]}" alt="" draggable="false"><span class="military-unit-card__type" style="background-image:url('${MILITARY_COMPANY_STRATEGIC_ICON_ART[company.kind]}')" aria-hidden="true"></span><span class="military-unit-card__count" data-count></span></span>`;
        card = { button, count: button.querySelector('[data-count]')! };
        this.cards.set(company.id, card);
      }
      // Preserve nodes and focus during simulation ticks, including while scrolling.
      const position = this.cardsRoot.children[index];
      if (position !== card.button) this.cardsRoot.insertBefore(card.button, position ?? null);
      const name = militaryCompanyDisplayName(company);
      const rank = militaryCompanyRankLabel(company);
      card.button.dataset.tooltip = rank ? `${name} — ${rank}` : name;
      card.button.dataset.companyStatus = company.status;
      card.button.setAttribute('aria-label', `${name}, ${company.livingMembers}/${company.targetSize}, ${company.status}`);
      card.count.textContent = `${company.livingMembers}/${company.targetSize}`;
    });
    this.empty.hidden = this.companies.length > 0;
    this.syncSelection();
    this.renderOrders();
    this.syncScroll();
  }

  dispose(): void {
    this.observer.disconnect();
    this.dialog.dispose();
    this.element.remove();
  }

  private syncSelection(): void {
    for (const [id, card] of this.cards) {
      card.button.classList.toggle('is-selected', this.selected.has(id));
      card.button.setAttribute('aria-pressed', String(this.selected.has(id)));
    }
  }

  private renderOrders(): void {
    const selectedCompanies = this.companies.filter((c) => this.selected.has(c.id));
    this.rail.hidden = selectedCompanies.length === 0;
    const html = renderMilitaryOrders(selectedCompanies);
    if (html !== this.ordersHtml) {
      const focused = this.orders.contains(document.activeElement)
        ? document.activeElement as HTMLButtonElement : null;
      const kind = focused?.dataset.militaryOrder;
      const value = focused?.dataset.orderValue;
      const scroll = this.orders.scrollLeft;
      this.orders.innerHTML = html;
      this.ordersHtml = html;
      this.orders.scrollLeft = scroll;
      if (kind) [...this.orders.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.dataset.militaryOrder === kind && button.dataset.orderValue === value)
        ?.focus({ preventScroll: true });
    }
    this.orders.inert = this.pending;
    this.orders.setAttribute('aria-busy', String(this.pending));
  }

  private readonly syncScroll = (): void => {
    const max = this.viewport.scrollWidth - this.viewport.clientWidth;
    this.element.classList.toggle('is-scrollable', max > 2);
    this.previous.disabled = this.viewport.scrollLeft <= 1;
    this.next.disabled = this.viewport.scrollLeft >= max - 1;
  };

  private scroll(direction: number): void {
    this.viewport.scrollBy({ left: direction * Math.max(110, this.viewport.clientWidth * .75), behavior: 'smooth' });
  }

  private revealCard(card: HTMLElement): void {
    const viewportRect = this.viewport.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    if (cardRect.left < viewportRect.left) this.viewport.scrollLeft += cardRect.left - viewportRect.left - 6;
    else if (cardRect.right > viewportRect.right) this.viewport.scrollLeft += cardRect.right - viewportRect.right + 6;
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const target = this.rail.contains(event.target as Node) ? this.orders : this.viewport;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    target.scrollLeft += delta * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? target.clientWidth : 1);
  };

  private readonly onClick = (event: MouseEvent): void => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.dataset.militaryCompany) this.handlers.onSelectCompany(button.dataset.militaryCompany);
    if (button.dataset.militaryOrder) void this.issueOrder(button);
  };

  private async issueOrder(button: HTMLButtonElement): Promise<void> {
    if (this.pending) return;
    const kind = button.dataset.militaryOrder as MilitaryOrder['kind'];
    const order: MilitaryOrder = kind === 'formation' || kind === 'stance' || kind === 'running' || kind === 'fire-at-will'
      ? { kind, value: Number(button.dataset.orderValue) } : { kind };
    const companies = this.companies.filter((c) => this.selected.has(c.id));
    if (!companies.length || !companies.every((c) => militaryOrderAvailable(c, order))) return;
    this.pending = true;
    this.renderOrders();
    try {
      if (kind === 'disband') {
        const confirmed = await this.dialog.confirm({
          title: 'Disband company',
          description: `${companies.map(militaryCompanyDisplayName).join(', ')} will leave service. Survivors return their equipment and go home; mercenaries march to the region edge.`,
          confirmLabel: 'Disband', cancelLabel: 'Keep company',
        });
        if (!confirmed) return;
      }
      const ids = companies.map((c) => c.id).filter((id) => this.companies.some((c) => c.id === id && militaryOrderAvailable(c, order)));
      if (ids.length) await this.handlers.onOrder(ids, order);
    } finally {
      this.pending = false;
      this.renderOrders();
    }
  }
}
