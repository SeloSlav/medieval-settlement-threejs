export type DebugMapAction = 'wildlife' | 'bandits' | 'raiders' | 'company';

export type DebugCalendarDate = {
  year: number;
  month: number;
  monthDay: number;
};

type DebugMenuOptions = {
  domElement: HTMLElement;
  getDate: () => DebugCalendarDate;
  pickMapPoint: (clientX: number, clientY: number) => { x: number; z: number } | null;
  onGrantResources: (amount: number) => Promise<void>;
  onSetDate: (date: DebugCalendarDate) => Promise<void>;
  onRunMapAction: (
    action: DebugMapAction,
    x: number,
    z: number,
    companyKind: number,
  ) => Promise<void>;
  onOpenChange?: (open: boolean) => void;
  onPlacementArmed?: () => void;
  canOpenFromKeyboard?: () => boolean;
};

const ACTION_LABELS: Record<DebugMapAction, string> = {
  wildlife: 'wild animals',
  bandits: 'a bandit camp',
  raiders: 'Ottoman raiders',
  company: 'your company',
};

export class DebugMenu {
  private readonly backdrop = document.createElement('div');
  private readonly dialog: HTMLElement;
  private readonly status: HTMLElement;
  private readonly placementHint = document.createElement('div');
  private readonly resourceAmount: HTMLInputElement;
  private readonly resourceButton: HTMLButtonElement;
  private readonly yearInput: HTMLInputElement;
  private readonly monthInput: HTMLInputElement;
  private readonly dayInput: HTMLInputElement;
  private readonly dateButton: HTMLButtonElement;
  private readonly companyKind: HTMLSelectElement;
  private readonly options: DebugMenuOptions;
  private open = false;
  private armedAction: DebugMapAction | null = null;
  private actionPending = false;

  constructor(parent: HTMLElement, options: DebugMenuOptions) {
    this.options = options;
    this.backdrop.className = 'debug-menu-backdrop';
    this.backdrop.hidden = true;
    this.backdrop.innerHTML = `
      <div class="debug-menu-dialog" role="dialog" aria-modal="true" aria-labelledby="debug-menu-title">
        <header class="debug-menu-header">
          <div>
            <p class="debug-menu-eyebrow">Development tools · M</p>
            <h2 id="debug-menu-title">Debug menu</h2>
          </div>
          <button type="button" class="debug-menu-close" data-debug-close aria-label="Close debug menu">×</button>
        </header>

        <div class="debug-menu-grid">
          <section class="debug-menu-section">
            <header><h3>Resources</h3><p>Top up every physical or treasury commodity.</p></header>
            <label class="debug-menu-field debug-menu-field--wide">
              <span>Each resource</span>
              <input type="number" min="1" max="1000000000" step="10000" value="100000" data-debug-resource-amount />
            </label>
            <button type="button" class="debug-menu-primary" data-debug-resources>Grant resources</button>
          </section>

          <section class="debug-menu-section">
            <header><h3>Calendar date</h3><p>Changes the date while preserving the current time of day.</p></header>
            <div class="debug-menu-date">
              <label class="debug-menu-field"><span>Year</span><input type="number" min="1" max="9999" step="1" data-debug-year /></label>
              <label class="debug-menu-field"><span>Month</span><input type="number" min="1" max="12" step="1" data-debug-month /></label>
              <label class="debug-menu-field"><span>Day</span><input type="number" min="1" max="30" step="1" data-debug-day /></label>
            </div>
            <button type="button" class="debug-menu-primary" data-debug-date>Set date</button>
          </section>

          <section class="debug-menu-section debug-menu-section--map">
            <header><h3>Map encounters</h3><p>Choose an action, then click its exact entry point on the terrain.</p></header>
            <div class="debug-menu-actions">
              <button type="button" data-debug-action="wildlife"><strong>Wild animals</strong><span>Fox and wolf pack</span></button>
              <button type="button" data-debug-action="bandits"><strong>Bandits</strong><span>Camp and defenders</span></button>
              <button type="button" data-debug-action="raiders"><strong>Ottoman raiders</strong><span>Live incursion party</span></button>
            </div>
          </section>

          <section class="debug-menu-section debug-menu-section--map">
            <header><h3>Player military</h3><p>Deploy a ready, selectable company without costs or household call-up.</p></header>
            <label class="debug-menu-field debug-menu-field--wide">
              <span>Company</span>
              <select data-debug-company-kind>
                <option value="0">Town militia</option>
                <option value="1">Spearmen</option>
                <option value="2">Men-at-arms</option>
                <option value="3">Crossbowmen</option>
                <option value="4">Mercenary spears</option>
                <option value="5">Footmen</option>
                <option value="6">Polearms</option>
                <option value="7">Bowmen</option>
                <option value="8">Frontier hussars</option>
                <option value="9">Armored lancers</option>
                <option value="10">Mounted archers</option>
              </select>
            </label>
            <button type="button" class="debug-menu-primary" data-debug-action="company">Deploy on map</button>
          </section>
        </div>
        <p class="debug-menu-status" data-debug-status aria-live="polite">Debug tools write authoritative simulation state.</p>
      </div>
    `;
    this.dialog = this.backdrop.querySelector<HTMLElement>('.debug-menu-dialog')!;
    this.status = this.backdrop.querySelector<HTMLElement>('[data-debug-status]')!;
    this.resourceAmount = this.backdrop.querySelector<HTMLInputElement>('[data-debug-resource-amount]')!;
    this.resourceButton = this.backdrop.querySelector<HTMLButtonElement>('[data-debug-resources]')!;
    this.yearInput = this.backdrop.querySelector<HTMLInputElement>('[data-debug-year]')!;
    this.monthInput = this.backdrop.querySelector<HTMLInputElement>('[data-debug-month]')!;
    this.dayInput = this.backdrop.querySelector<HTMLInputElement>('[data-debug-day]')!;
    this.dateButton = this.backdrop.querySelector<HTMLButtonElement>('[data-debug-date]')!;
    this.companyKind = this.backdrop.querySelector<HTMLSelectElement>('[data-debug-company-kind]')!;

    this.placementHint.className = 'debug-placement-hint';
    this.placementHint.hidden = true;
    parent.append(this.backdrop, this.placementHint);

    this.backdrop.querySelector<HTMLButtonElement>('[data-debug-close]')!
      .addEventListener('click', () => this.close());
    this.backdrop.addEventListener('click', () => this.close());
    this.dialog.addEventListener('click', (event) => event.stopPropagation());
    this.dialog.addEventListener('wheel', (event) => event.stopPropagation(), { capture: true });
    this.resourceButton.addEventListener('click', () => void this.grantResources());
    this.dateButton.addEventListener('click', () => void this.setDate());
    for (const button of this.backdrop.querySelectorAll<HTMLButtonElement>('[data-debug-action]')) {
      button.addEventListener('click', () => {
        const action = button.dataset.debugAction as DebugMapAction | undefined;
        if (action) this.armPlacement(action);
      });
    }
    window.addEventListener('keydown', this.onKeyDown, true);
    options.domElement.addEventListener('pointerdown', this.onMapPointerDown, true);
  }

  isOpen(): boolean {
    return this.open;
  }

  isPlacementActive(): boolean {
    return this.armedAction !== null || this.actionPending;
  }

  dispose(): void {
    this.actionPending = false;
    this.cancelPlacement();
    this.close();
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.options.domElement.removeEventListener('pointerdown', this.onMapPointerDown, true);
    this.backdrop.remove();
    this.placementHint.remove();
  }

  private openMenu(): void {
    if (this.open || this.actionPending || this.options.canOpenFromKeyboard?.() === false) return;
    this.cancelPlacement();
    this.syncDate();
    this.open = true;
    this.backdrop.hidden = false;
    this.options.onOpenChange?.(true);
    this.backdrop.querySelector<HTMLButtonElement>('[data-debug-close]')?.focus({ preventScroll: true });
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.backdrop.hidden = true;
    this.options.onOpenChange?.(false);
  }

  private syncDate(): void {
    const date = this.options.getDate();
    this.yearInput.value = String(date.year);
    this.monthInput.value = String(date.month);
    this.dayInput.value = String(date.monthDay);
  }

  private armPlacement(action: DebugMapAction): void {
    if (this.actionPending) return;
    this.options.onPlacementArmed?.();
    this.armedAction = action;
    this.close();
    this.options.domElement.classList.add('is-debug-placement');
    this.placementHint.textContent = `Debug: click the map to place ${ACTION_LABELS[action]} · Esc cancels`;
    this.placementHint.hidden = false;
  }

  private cancelPlacement(): void {
    if (this.actionPending) return;
    this.armedAction = null;
    this.options.domElement.classList.remove('is-debug-placement');
    this.placementHint.hidden = true;
  }

  private readonly onMapPointerDown = (event: PointerEvent): void => {
    const action = this.armedAction;
    if (!action || this.actionPending || event.button !== 0) return;
    const point = this.options.pickMapPoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.armedAction = null;
    this.actionPending = true;
    this.placementHint.textContent = `Deploying ${ACTION_LABELS[action]}…`;
    const companyKind = Math.max(0, Math.min(7, Math.floor(Number(this.companyKind.value))));
    void this.options.onRunMapAction(action, point.x, point.z, companyKind)
      .then(() => {
        this.status.textContent = `${ACTION_LABELS[action][0]!.toUpperCase()}${ACTION_LABELS[action].slice(1)} placed at ${point.x.toFixed(0)}, ${point.z.toFixed(0)}.`;
        this.status.dataset.variant = 'success';
      })
      .catch((error) => {
        this.status.textContent = error instanceof Error ? error.message : 'Debug placement failed.';
        this.status.dataset.variant = 'error';
      })
      .finally(() => {
        this.actionPending = false;
        this.cancelPlacement();
      });
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    const target = event.target as HTMLElement | null;
    const typing = target?.tagName === 'INPUT'
      || target?.tagName === 'TEXTAREA'
      || target?.tagName === 'SELECT'
      || Boolean(target?.isContentEditable);
    if (key === 'm' && !typing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (this.actionPending) return;
      if (this.open) this.close();
      else this.openMenu();
      return;
    }
    if (key !== 'escape' || typing) return;
    if (this.open) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
    } else if (this.armedAction || this.actionPending) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.cancelPlacement();
    }
  };

  private async grantResources(): Promise<void> {
    if (this.resourceButton.disabled) return;
    const amount = Math.floor(Number(this.resourceAmount.value));
    if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000_000) {
      this.setError('Enter a resource amount from 1 to 1,000,000,000.');
      return;
    }
    this.resourceButton.disabled = true;
    this.resourceButton.textContent = 'Granting…';
    try {
      await this.options.onGrantResources(amount);
      this.status.textContent = `${amount.toLocaleString()} of every resource is available.`;
      this.status.dataset.variant = 'success';
    } catch (error) {
      this.setError(error instanceof Error ? error.message : 'Could not grant resources.');
    } finally {
      this.resourceButton.disabled = false;
      this.resourceButton.textContent = 'Grant resources';
    }
  }

  private async setDate(): Promise<void> {
    if (this.dateButton.disabled) return;
    const date = {
      year: Math.floor(Number(this.yearInput.value)),
      month: Math.floor(Number(this.monthInput.value)),
      monthDay: Math.floor(Number(this.dayInput.value)),
    };
    if (!Number.isFinite(date.year) || date.year < 1 || date.year > 9_999
      || !Number.isFinite(date.month) || date.month < 1 || date.month > 12
      || !Number.isFinite(date.monthDay) || date.monthDay < 1 || date.monthDay > 30) {
      this.setError('Enter a year from 1–9,999, month from 1–12, and day from 1–30.');
      return;
    }
    this.dateButton.disabled = true;
    this.dateButton.textContent = 'Setting…';
    try {
      await this.options.onSetDate(date);
      this.status.textContent = `Calendar set to ${date.monthDay}/${date.month}, Year ${date.year}; time of day preserved.`;
      this.status.dataset.variant = 'success';
    } catch (error) {
      this.setError(error instanceof Error ? error.message : 'Could not set the date.');
    } finally {
      this.dateButton.disabled = false;
      this.dateButton.textContent = 'Set date';
    }
  }

  private setError(message: string): void {
    this.status.textContent = message;
    this.status.dataset.variant = 'error';
  }
}
