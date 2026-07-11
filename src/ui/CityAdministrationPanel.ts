import {
  CHAPEL_COFFER_RESERVE_MAX,
  CHAPEL_COFFER_RESERVE_MIN,
  ECONOMIC_ACTIVITY_TAX_RATE_MAX,
  ECONOMIC_ACTIVITY_TAX_RATE_MIN,
} from '../generated/gameBalance.ts';
import { clampChapelCofferReserveGold, type ParishPolicyState } from '../economy/chapelParish.ts';
import {
  clampEconomicActivityTaxRate,
  ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT,
} from '../economy/villageEconomy.ts';
import { buildVillageAdminReadout } from '../economy/villageAdminReadout.ts';
import type { GameState } from '../resources/types.ts';
import type { WorldQueries } from '../resources/WorldQueries.ts';

type CityAdministrationPanelOptions = {
  onTaxRateChange: (taxRate: number) => void | Promise<void>;
  onTaxRateChangeFailed?: (error: unknown) => void;
  onParishPolicyChange: (autoSweepEnabled: boolean, cofferReserveGold: number) => void | Promise<void>;
  onParishPolicyChangeFailed?: (error: unknown) => void;
  getGameState: () => GameState | null;
  getTaxRate: () => number;
  getParishPolicy: () => ParishPolicyState;
  getWorldQueries?: () => WorldQueries | null;
  onOpenChange?: (open: boolean) => void;
};

const DEFAULT_TAX_PERCENT = Math.round(ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT * 100);

export class CityAdministrationPanel {
  private readonly root: HTMLElement;
  private readonly slider: HTMLInputElement;
  private readonly reserveSlider: HTMLInputElement;
  private readonly autoSweepToggle: HTMLInputElement;
  private readonly taxRateValue: HTMLElement;
  private readonly reserveValue: HTMLElement;
  private readonly productivityValue: HTMLElement;
  private readonly gdpValue: HTMLElement;
  private readonly householdWealthValue: HTMLElement;
  private readonly householdSavingsValue: HTMLElement;
  private readonly chapelTitheValue: HTMLElement;
  private readonly parishExpenseValue: HTMLElement;
  private readonly autoSweepValue: HTMLElement;
  private readonly parishLedgerValue: HTMLElement;
  private readonly cofferBalanceValue: HTMLElement;
  private readonly taxIncomeValue: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private open = false;
  private pendingRate: number | null = null;
  private pendingReserve: number | null = null;
  private pendingAutoSweep: boolean | null = null;
  private debounceTimer: number | null = null;
  private parishDebounceTimer: number | null = null;
  private readonly options: CityAdministrationPanelOptions;

  constructor(parent: HTMLElement, options: CityAdministrationPanelOptions) {
    this.options = options;

    this.root = document.createElement('section');
    this.root.className = 'city-admin-panel';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'City administration');
    this.root.innerHTML = `
      <header class="city-admin-panel__header">
        <div>
          <p class="city-admin-panel__eyebrow">Mayor's office</p>
          <h2 class="city-admin-panel__title">City administration</h2>
        </div>
        <button type="button" class="city-admin-panel__close" data-action="close" aria-label="Close">×</button>
      </header>
      <p class="city-admin-panel__intro">
        Set trade tax and parish coffer policy. Tithes land in chapel coffers first; salary, upkeep, and charity
        spend from the coffer before you collect or auto-sweep surplus into treasury.
      </p>
      <label class="city-admin-panel__slider-label" for="city-admin-tax-slider">
        <span>Activity tax rate</span>
        <strong data-tax-rate-value>${DEFAULT_TAX_PERCENT}%</strong>
      </label>
      <input
        id="city-admin-tax-slider"
        class="city-admin-panel__slider"
        type="range"
        min="${Math.round(ECONOMIC_ACTIVITY_TAX_RATE_MIN * 100)}"
        max="${Math.round(ECONOMIC_ACTIVITY_TAX_RATE_MAX * 100)}"
        step="1"
        value="${DEFAULT_TAX_PERCENT}"
      />
      <div class="city-admin-panel__range-hints">
        <span>0% — growth</span>
        <span>45% — desperate</span>
      </div>
      <div class="city-admin-panel__section">
        <h3 class="city-admin-panel__section-title">Parish coffer policy</h3>
        <label class="city-admin-panel__toggle">
          <input type="checkbox" data-auto-sweep-toggle />
          <span>Auto-sweep surplus to treasury</span>
        </label>
        <label class="city-admin-panel__slider-label" for="city-admin-reserve-slider">
          <span>Coffer reserve</span>
          <strong data-reserve-value>80 gold</strong>
        </label>
        <input
          id="city-admin-reserve-slider"
          class="city-admin-panel__slider"
          type="range"
          min="${CHAPEL_COFFER_RESERVE_MIN}"
          max="${CHAPEL_COFFER_RESERVE_MAX}"
          step="5"
          value="80"
        />
      </div>
      <dl class="city-admin-panel__stats">
        <div class="city-admin-panel__stat">
          <dt>Village activity (GDP)</dt>
          <dd data-gdp-value>0 gold / day</dd>
        </div>
        <div class="city-admin-panel__stat">
          <dt>Household wealth</dt>
          <dd data-household-wealth-value>0 gold saved</dd>
        </div>
        <div class="city-admin-panel__stat">
          <dt>Household savings rate</dt>
          <dd data-household-savings-value>0 gold / day</dd>
        </div>
        <div class="city-admin-panel__stat">
          <dt>Trade productivity</dt>
          <dd data-productivity-value>100%</dd>
        </div>
        <div class="city-admin-panel__stat">
          <dt>Mayor tax income</dt>
          <dd data-tax-income-value>0 gold / day</dd>
        </div>
        <div class="city-admin-panel__stat">
          <dt>Parish tithe (→ coffer)</dt>
          <dd data-chapel-tithe-value>0 gold / day</dd>
        </div>
        <div class="city-admin-panel__stat">
          <dt>Parish expenses</dt>
          <dd data-parish-expense-value>0 gold / day</dd>
        </div>
        <div class="city-admin-panel__stat">
          <dt>Est. auto-sweep</dt>
          <dd data-auto-sweep-value>Off</dd>
        </div>
        <div class="city-admin-panel__stat city-admin-panel__stat--highlight">
          <dt>Collectable coffer</dt>
          <dd data-coffer-balance-value>0 gold</dd>
        </div>
        <div class="city-admin-panel__stat">
          <dt>Parish ledger (lifetime)</dt>
          <dd data-parish-ledger-value>0 gold moved</dd>
        </div>
      </dl>
    `;

    parent.appendChild(this.root);

    this.slider = this.root.querySelector<HTMLInputElement>('#city-admin-tax-slider')!;
    this.reserveSlider = this.root.querySelector<HTMLInputElement>('#city-admin-reserve-slider')!;
    this.autoSweepToggle = this.root.querySelector<HTMLInputElement>('[data-auto-sweep-toggle]')!;
    this.taxRateValue = this.root.querySelector<HTMLElement>('[data-tax-rate-value]')!;
    this.reserveValue = this.root.querySelector<HTMLElement>('[data-reserve-value]')!;
    this.productivityValue = this.root.querySelector<HTMLElement>('[data-productivity-value]')!;
    this.gdpValue = this.root.querySelector<HTMLElement>('[data-gdp-value]')!;
    this.householdWealthValue = this.root.querySelector<HTMLElement>('[data-household-wealth-value]')!;
    this.householdSavingsValue = this.root.querySelector<HTMLElement>('[data-household-savings-value]')!;
    this.chapelTitheValue = this.root.querySelector<HTMLElement>('[data-chapel-tithe-value]')!;
    this.parishExpenseValue = this.root.querySelector<HTMLElement>('[data-parish-expense-value]')!;
    this.autoSweepValue = this.root.querySelector<HTMLElement>('[data-auto-sweep-value]')!;
    this.parishLedgerValue = this.root.querySelector<HTMLElement>('[data-parish-ledger-value]')!;
    this.cofferBalanceValue = this.root.querySelector<HTMLElement>('[data-coffer-balance-value]')!;
    this.taxIncomeValue = this.root.querySelector<HTMLElement>('[data-tax-income-value]')!;
    this.closeButton = this.root.querySelector<HTMLButtonElement>('[data-action="close"]')!;

    this.closeButton.addEventListener('click', () => this.close());
    this.root.addEventListener('mousedown', (event) => event.stopPropagation());
    this.root.addEventListener('click', (event) => event.stopPropagation());
    this.slider.addEventListener('input', () => this.onSliderInput());
    this.reserveSlider.addEventListener('input', () => this.onReserveInput());
    this.autoSweepToggle.addEventListener('change', () => this.onAutoSweepToggle());
  }

  isOpen(): boolean {
    return this.open;
  }

  openPanel(): void {
    if (this.open) return;
    this.open = true;
    this.root.hidden = false;
    this.syncPanel();
    this.options.onOpenChange?.(true);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    this.flushPendingChanges();
    this.options.onOpenChange?.(false);
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openPanel();
  }

  refresh(): void {
    if (!this.open) return;
    this.syncPanel();
  }

  dispose(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.parishDebounceTimer !== null) {
      window.clearTimeout(this.parishDebounceTimer);
      this.parishDebounceTimer = null;
    }
    this.root.remove();
  }

  private syncPanel(): void {
    const taxRate = this.options.getTaxRate();
    const parishPolicy = this.options.getParishPolicy();
    if (this.pendingRate === null) {
      this.slider.value = String(Math.round(taxRate * 100));
    }
    if (this.pendingReserve === null) {
      this.reserveSlider.value = String(Math.round(parishPolicy.cofferReserveGold));
    }
    if (this.pendingAutoSweep === null) {
      this.autoSweepToggle.checked = parishPolicy.autoSweepEnabled;
    }
    this.updateReadout(this.pendingRate ?? taxRate, this.getEffectiveParishPolicy(parishPolicy));
  }

  private getEffectiveParishPolicy(base: ParishPolicyState): ParishPolicyState {
    return {
      ...base,
      autoSweepEnabled: this.pendingAutoSweep ?? base.autoSweepEnabled,
      cofferReserveGold: this.pendingReserve ?? base.cofferReserveGold,
    };
  }

  private onSliderInput(): void {
    const rate = clampEconomicActivityTaxRate(Number(this.slider.value) / 100);
    this.pendingRate = rate;
    this.updateReadout(rate, this.getEffectiveParishPolicy(this.options.getParishPolicy()));
    this.scheduleRateCommit(rate);
  }

  private onReserveInput(): void {
    const reserve = clampChapelCofferReserveGold(Number(this.reserveSlider.value));
    this.pendingReserve = reserve;
    this.updateReadout(
      this.pendingRate ?? this.options.getTaxRate(),
      this.getEffectiveParishPolicy(this.options.getParishPolicy()),
    );
    this.scheduleParishCommit();
  }

  private onAutoSweepToggle(): void {
    this.pendingAutoSweep = this.autoSweepToggle.checked;
    this.updateReadout(
      this.pendingRate ?? this.options.getTaxRate(),
      this.getEffectiveParishPolicy(this.options.getParishPolicy()),
    );
    this.scheduleParishCommit();
  }

  private scheduleRateCommit(rate: number): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.commitRate(rate);
    }, 280);
  }

  private scheduleParishCommit(): void {
    if (this.parishDebounceTimer !== null) {
      window.clearTimeout(this.parishDebounceTimer);
    }
    this.parishDebounceTimer = window.setTimeout(() => {
      this.parishDebounceTimer = null;
      void this.commitParishPolicy();
    }, 280);
  }

  private flushPendingChanges(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.parishDebounceTimer !== null) {
      window.clearTimeout(this.parishDebounceTimer);
      this.parishDebounceTimer = null;
    }
    if (this.pendingRate !== null) {
      void this.commitRate(this.pendingRate);
    }
    if (this.pendingReserve !== null || this.pendingAutoSweep !== null) {
      void this.commitParishPolicy();
    }
  }

  private async commitRate(rate: number): Promise<void> {
    try {
      await this.options.onTaxRateChange(rate);
      this.pendingRate = null;
    } catch (error) {
      this.options.onTaxRateChangeFailed?.(error);
      this.syncPanel();
    }
  }

  private async commitParishPolicy(): Promise<void> {
    const policy = this.getEffectiveParishPolicy(this.options.getParishPolicy());
    try {
      await this.options.onParishPolicyChange(policy.autoSweepEnabled, policy.cofferReserveGold);
      this.pendingReserve = null;
      this.pendingAutoSweep = null;
    } catch (error) {
      this.options.onParishPolicyChangeFailed?.(error);
      this.syncPanel();
    }
  }

  private updateReadout(taxRate: number, parishPolicy: ParishPolicyState): void {
    const readout = buildVillageAdminReadout({
      gameState: this.options.getGameState(),
      worldQueries: this.options.getWorldQueries?.() ?? null,
      taxRate,
      parishPolicy,
    });

    this.taxRateValue.textContent = readout.taxRateLabel;
    this.reserveValue.textContent = readout.reserveLabel;
    this.productivityValue.textContent = readout.productivityLabel;
    this.gdpValue.textContent = readout.gdpLabel;
    this.householdWealthValue.textContent = readout.householdWealthLabel;
    this.householdSavingsValue.textContent = readout.householdSavingsLabel;
    this.taxIncomeValue.textContent = readout.taxIncomeLabel;
    this.chapelTitheValue.textContent = readout.chapelTitheLabel;
    this.parishExpenseValue.textContent = readout.parishExpenseLabel;
    this.autoSweepValue.textContent = readout.autoSweepLabel;
    this.cofferBalanceValue.textContent = readout.cofferBalanceLabel;
    this.parishLedgerValue.textContent = readout.parishLedgerLabel;
  }
}
