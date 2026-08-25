import type { GameState } from '../resources/types.ts';
import {
  computeSettlementResourceReport,
  type SettlementResourceReportRow,
} from '../resources/settlementResourceReport.ts';
import { formatResourceUnits } from '../resources/resourceUnits.ts';

export type TownReportPanelOptions = {
  uiRoot: HTMLElement;
  getState: () => GameState;
  onFocus?: (x: number, z: number) => void;
  onInspectTownHall?: (buildingId: string) => void;
  onRename?: (settlementId: string) => void;
};

export class TownReportPanel {
  private readonly options: TownReportPanelOptions;
  private readonly panel: HTMLElement;
  private selectedSettlementId: string | null = null;
  private lastSettlements: GameState['settlements'] | null = null;
  private lastBuildings: GameState['buildings'] | null = null;
  private lastResidences: GameState['residences'] | null = null;
  private lastTrips: GameState['deliveryTrips'] | null = null;

  constructor(options: TownReportPanelOptions) {
    this.options = options;
    options.uiRoot.insertAdjacentHTML('beforeend', `
      <aside class="town-report-panel" data-town-report hidden aria-label="Local town report">
        <header class="town-report-panel__header">
          <div><p>Community report</p><button type="button" class="town-report-panel__rename" data-town-report-rename title="Rename town"><span data-town-report-title>Town</span><i aria-hidden="true">✎</i></button></div>
          <button type="button" data-town-report-close aria-label="Close town report">×</button>
        </header>
        <div class="town-report-panel__body" data-town-report-body></div>
      </aside>
    `);
    const panel = options.uiRoot.querySelector<HTMLElement>('[data-town-report]');
    if (!panel) throw new Error('Town report template failed to parse.');
    this.panel = panel;
    this.panel.querySelector<HTMLButtonElement>('[data-town-report-close]')
      ?.addEventListener('click', () => this.close());
    this.panel.addEventListener('click', (event) => this.handleClick(event));
  }

  open(settlementId: string): void {
    this.selectedSettlementId = settlementId;
    this.invalidate();
    this.refresh();
    this.panel.hidden = false;
    this.options.uiRoot.classList.add('is-town-report-open');
  }

  close(): void {
    this.selectedSettlementId = null;
    this.panel.hidden = true;
    this.options.uiRoot.classList.remove('is-town-report-open');
  }

  isOpen(): boolean {
    return !this.panel.hidden;
  }

  refresh(): void {
    const settlementId = this.selectedSettlementId;
    if (!settlementId) return;
    const state = this.options.getState();
    if (
      this.lastSettlements === state.settlements
      && this.lastBuildings === state.buildings
      && this.lastResidences === state.residences
      && this.lastTrips === state.deliveryTrips
    ) return;
    this.lastSettlements = state.settlements;
    this.lastBuildings = state.buildings;
    this.lastResidences = state.residences;
    this.lastTrips = state.deliveryTrips;
    const report = computeSettlementResourceReport(state, settlementId);
    if (!report.settlement) {
      this.close();
      return;
    }
    const settlement = report.settlement;
    const title = this.panel.querySelector<HTMLElement>('[data-town-report-title]');
    const body = this.panel.querySelector<HTMLElement>('[data-town-report-body]');
    if (!title || !body) return;
    title.textContent = settlement.name;
    const visibleResources = report.resources.filter(hasReportValue);
    const hallAction = settlement.townHallId
      ? `<button type="button" class="town-report-panel__action" data-town-report-hall="${escapeHtml(settlement.townHallId)}">Inspect Town Hall</button>`
      : '<span class="town-report-panel__pending">No Town Hall · realm defaults apply</span>';
    body.innerHTML = `
      <p class="town-report-panel__scope">A local physical breakdown inside one realm economy. The top Total/Surplus ledger still covers every community.</p>
      <div class="town-report-panel__stats">
        <span><strong>${report.housed}</strong><small>housed</small></span>
        <span><strong>${report.housingCapacity}</strong><small>capacity</small></span>
        <span><strong>${report.unhousedFounders}</strong><small>at camp</small></span>
        <span><strong>${report.buildingCount}</strong><small>sites</small></span>
      </div>
      <div class="town-report-panel__actions">
        <button type="button" class="town-report-panel__action" data-town-report-focus>Focus community</button>
        ${hallAction}
      </div>
      <section class="town-report-panel__ledger">
        <header><strong>Goods physically here</strong></header>
        <div class="town-report-panel__table" role="table" aria-label="Local resource flows">
          <div class="town-report-panel__row town-report-panel__row--head" role="row">
            <span>Good</span><span>Stored</span><span>Committed</span><span>Inbound</span><span>Outbound</span>
          </div>
          ${visibleResources.length > 0
            ? visibleResources.map(renderResourceRow).join('')
            : '<p class="town-report-panel__empty">No physical stores or loaded carts are recorded here yet.</p>'}
        </div>
        ${report.offMapTradeTrips > 0
          ? `<p class="town-report-panel__trade">${report.offMapTradeTrips} outbound ${report.offMapTradeTrips === 1 ? 'cart is' : 'carts are'} bound for off-map trade.</p>`
          : ''}
      </section>
    `;
  }

  dispose(): void {
    this.options.uiRoot.classList.remove('is-town-report-open');
    this.panel.remove();
  }

  private invalidate(): void {
    this.lastSettlements = null;
    this.lastBuildings = null;
    this.lastResidences = null;
    this.lastTrips = null;
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const settlementId = this.selectedSettlementId;
    const settlement = settlementId
      ? this.options.getState().settlements.get(settlementId)
      : null;
    if (!settlement) return;
    if (target.closest('[data-town-report-rename]')) {
      this.options.onRename?.(settlement.id);
      return;
    }
    if (target.closest('[data-town-report-focus]')) {
      this.options.onFocus?.(settlement.anchorX, settlement.anchorZ);
      return;
    }
    const hallId = target.closest<HTMLElement>('[data-town-report-hall]')?.dataset.townReportHall;
    if (hallId) this.options.onInspectTownHall?.(hallId);
  }
}

function hasReportValue(row: SettlementResourceReportRow): boolean {
  return row.stored > 0 || row.committed > 0 || row.inbound > 0 || row.outbound > 0;
}

function renderResourceRow(row: SettlementResourceReportRow): string {
  return `<div class="town-report-panel__row" role="row">
    <strong class="town-report-panel__good resource-cost__item" data-resource-cost="${escapeHtml(row.resource)}">
      <span class="resource-cost__icon" aria-hidden="true"></span>
      <span>${escapeHtml(resourceLabel(row.resource))}</span>
    </strong>
    <span>${formatAmount(row.stored)}</span>
    <span>${formatAmount(row.committed)}</span>
    <span>${formatAmount(row.inbound)}</span>
    <span>${formatAmount(row.outbound)}</span>
  </div>`;
}

function formatAmount(value: number): string {
  return value > 0 ? formatResourceUnits(value) : '—';
}

function resourceLabel(resource: string): string {
  return resource
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}
