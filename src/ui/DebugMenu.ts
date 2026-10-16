import type { RenderDiagnostics, RenderDiagnosticCategory } from '../scene/RenderDiagnostics.ts';

export type DebugMapAction = 'wildlife' | 'bandits' | 'raiders' | 'company';

export type DebugCalendarDate = {
  year: number;
  month: number;
  monthDay: number;
};

type DebugMenuOptions = {
  renderDiagnostics?: RenderDiagnostics;
  onStartProfile?: () => Promise<void>;
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
  onPerformanceDetails?: (details: string | null) => void;
  onPlacementArmed?: () => void;
  canOpenFromKeyboard?: () => boolean;
};

const ACTION_LABELS: Record<DebugMapAction, string> = {
  wildlife: 'wild animals',
  bandits: 'a bandit camp',
  raiders: 'Ottoman raiders',
  company: 'your company',
};

type RenderSwitch = readonly [RenderDiagnosticCategory, string, string];
const RENDER_SWITCHES: readonly RenderSwitch[] = [
  ['people', 'People', 'Villagers, soldiers & cart crews'],
  ['carts', 'Carts & cargo', 'Includes log hauls'],
  ['oxen', 'Oxen', 'Includes yokes & ploughs'],
  ['animals', 'Animals', 'Dogs, wildlife, livestock & horses'],
  ['trees', 'All trees', 'Forest, horizon & orchard trees'],
  ['grass', 'Grass', 'Grass blades & clumps'],
  ['groundScatter', 'Ground scatter', 'Twigs, loose rocks, felled logs & stumps'],
  ['sky', 'Sky & clouds', 'Keeps world lighting unchanged'],
];
const VEGETATION_SWITCHES: readonly RenderSwitch[] = [
  ['vegetation', 'All vegetation', 'Crops, reeds, shrubs & ground plants'],
  ['crops', 'Crops', 'Field crops, grapevines, vegetables & herbs'],
  ['reeds', 'Reeds', 'Riverbank reed clusters'],
  ['shrubs', 'Shrubs & ferns', 'Undergrowth, berry bushes & hedges'],
  ['groundPlants', 'Flowers & ground plants', 'Wildflowers, ivy, nettles, mushrooms & lily pads'],
];
const renderToggleButtons = (switches: readonly RenderSwitch[]): string => switches.map(([category, label, description]) =>
  `<button type="button" data-render-category="${category}" aria-pressed="false"><strong>${label}: <span data-render-state>ON</span></strong><small>${description}</small></button>`,
).join('');

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
  private lastPerformanceUpdate = 0;
  private meterVisible = false;
  private readonly recordingBar = document.createElement('div');
  private profilePending = false;

  constructor(parent: HTMLElement, options: DebugMenuOptions) {
    this.options = options;
    this.backdrop.className = 'debug-menu-backdrop';
    this.backdrop.hidden = true;
    this.backdrop.innerHTML = `
      <div class="debug-menu-dialog" role="dialog" aria-modal="true" aria-labelledby="debug-menu-title">
        <header class="debug-menu-header">
          <div>
            <p class="debug-menu-eyebrow">Development tools · M</p>
            <h2 id="debug-menu-title">Development menu</h2>
          </div>
          <button type="button" class="debug-menu-close" data-debug-close aria-label="Close debug menu">×</button>
        </header>

        <section class="debug-menu-section debug-menu-performance" data-render-diagnostics ${options.renderDiagnostics ? '' : 'hidden'}>
          <header><h3>Performance &amp; rendering</h3><p>Record while moving, zooming or building. Use the switches to isolate rendering cost; simulation and CPU animation keep running.</p></header>
          <div class="debug-profile-controls">
            <button type="button" data-profile-record>Record profile</button>
            <button type="button" data-profile-stop disabled>Stop &amp; copy</button>
            <button type="button" data-profile-copy hidden>Copy last profile</button>
          </div>
          <p data-profile-status role="status">Record, move the camera or build, then stop and paste the copied report into chat.</p>
          <textarea class="debug-profile-export" data-profile-export aria-label="Recorded performance profile" readonly hidden></textarea>
          <div class="debug-render-buildings"><strong>Buildings &amp; homes</strong><div>
            <button type="button" data-render-buildings="full" aria-pressed="true">Full models</button>
            <button type="button" data-render-buildings="placeholder" aria-pressed="false">Single boxes</button>
            <button type="button" data-render-buildings="hidden" aria-pressed="false">Hide all buildings</button>
          </div></div>
          <p>Single boxes: one 12-triangle mesh per building, including homes and construction sites; simple material and shadows.</p>
          <div class="debug-render-toggles">
            ${renderToggleButtons(RENDER_SWITCHES)}
          </div>
          <fieldset class="debug-render-vegetation"><legend>Vegetation</legend>
            <p>Grass, trees and ground scatter have their own switches above.</p>
            <div class="debug-render-toggles">${renderToggleButtons(VEGETATION_SWITCHES)}</div>
          </fieldset>
          <div class="debug-render-actions">
            <button type="button" data-render-actors>Hide all actors</button>
            <button type="button" data-render-baseline>Save baseline</button>
            <button type="button" data-render-reset>Restore all models</button>
            <label><input type="checkbox" data-render-meter checked /> Show rendering stats in bottom-left HUD</label>
          </div>
          <p data-render-summary>Collecting frame samples…</p>
          <p data-render-comparison>Save a baseline before changing switches. Frame times are measured between animation frames, not GPU execution time.</p>
        </section>
        <details class="debug-menu-simulation"><summary>Simulation tools</summary><div class="debug-menu-grid">
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
        </div></details>
        <p class="debug-menu-status" data-debug-status aria-live="polite">Rendering controls are local. Simulation tools change the current world.</p>
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
    this.recordingBar.className = 'debug-profile-recording';
    this.recordingBar.hidden = true;
    this.recordingBar.innerHTML = '<span data-profile-live></span><button type="button" data-profile-stop-floating>Stop &amp; copy</button>';
    parent.append(this.recordingBar);
    this.backdrop.querySelector('[data-profile-record]')?.addEventListener('click', () => void this.startProfile());
    this.backdrop.querySelector('[data-profile-stop]')?.addEventListener('click', () => void this.stopAndCopyProfile());
    this.backdrop.querySelector('[data-profile-copy]')?.addEventListener('click', () => void this.copyProfile());
    this.recordingBar.querySelector('[data-profile-stop-floating]')?.addEventListener('click', () => void this.stopAndCopyProfile());
    for (const button of this.backdrop.querySelectorAll<HTMLButtonElement>('[data-render-category]')) {
      button.addEventListener('click', () => {
        const diagnostics = this.options.renderDiagnostics;
        const category = button.dataset.renderCategory as RenderDiagnosticCategory;
        diagnostics?.setHidden(category, !diagnostics.isHidden(category));
        this.syncPerformanceControls();
      });
    }
    for (const button of this.backdrop.querySelectorAll<HTMLButtonElement>('[data-render-buildings]')) {
      button.addEventListener('click', () => {
        this.options.renderDiagnostics?.setBuildingMode(button.dataset.renderBuildings as 'full' | 'placeholder' | 'hidden');
        this.syncPerformanceControls();
      });
    }
    this.backdrop.querySelector('[data-render-reset]')?.addEventListener('click', () => {
      this.options.renderDiagnostics?.reset();
      this.syncPerformanceControls();
    });
    this.backdrop.querySelector('[data-render-baseline]')?.addEventListener('click', () => {
      this.options.renderDiagnostics?.captureBaseline();
      this.options.renderDiagnostics?.profiler.event('baseline-saved');
      this.lastPerformanceUpdate = 0;
    });
    this.backdrop.querySelector('[data-render-actors]')?.addEventListener('click', () => {
      const diagnostics = this.options.renderDiagnostics;
      if (!diagnostics) return;
      const categories = ['people', 'carts', 'oxen', 'animals'] as const;
      const hide = !categories.every(category => diagnostics.isHidden(category));
      for (const category of categories) diagnostics.setHidden(category, hide);
      this.syncPerformanceControls();
    });
    this.backdrop.querySelector<HTMLInputElement>('[data-render-meter]')?.addEventListener('change', (event) => {
      this.meterVisible = (event.target as HTMLInputElement).checked;
      if (!this.meterVisible) this.options.onPerformanceDetails?.(null);
      this.options.renderDiagnostics?.profiler.event('frame-meter', { visible: this.meterVisible });
      this.lastPerformanceUpdate = 0;
    });

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

  isPerformanceMonitoring(): boolean {
    return Boolean(this.options.renderDiagnostics) && (this.open || this.meterVisible || (this.options.renderDiagnostics?.profiler.isRecording() ?? false));
  }

  updatePerformance(time: number): void {
    const diagnostics = this.options.renderDiagnostics;
    if (!diagnostics || time - this.lastPerformanceUpdate < 400) return;
    this.lastPerformanceUpdate = time;
    this.syncProfileControls();
    if (!this.open && !this.meterVisible) return;
    const sample = diagnostics.getSample();
    const renderStats = sample
      ? `${sample.p95Ms.toFixed(2)} ms P95 · ${Math.round(sample.calls).toLocaleString()} draws · ${(sample.triangles / 1e6).toFixed(2)}M triangles`
      : 'Settling after switch / collecting frames…';
    const summary = sample
      ? `${sample.fps.toFixed(1)} FPS · ${sample.meanMs.toFixed(2)} ms avg · ${renderStats}`
      : renderStats;
    const modes = [diagnostics.buildingMode === 'full' ? '' : `buildings: ${diagnostics.buildingMode}`,
      ...[...RENDER_SWITCHES, ...VEGETATION_SWITCHES]
        .filter(([category]) => diagnostics.isHidden(category)).map(([, label]) => `${label}: OFF`)].filter(Boolean);
    const baseline = diagnostics.baseline;
    const delta = baseline && sample ? ` · ${(sample.meanMs - baseline.meanMs).toFixed(2)} ms vs baseline` : '';
    this.options.onPerformanceDetails?.(this.meterVisible
      ? `${renderStats}\n${modes.join(' · ') || 'Full scene'}${delta}`
      : null);
    if (!this.open) return;
    this.backdrop.querySelector('[data-render-summary]')!.textContent = summary;
    this.backdrop.querySelector<HTMLButtonElement>('[data-render-baseline]')!.disabled = !sample;
    this.backdrop.querySelector('[data-render-comparison]')!.textContent = baseline && sample
      ? `Baseline: ${baseline.fps.toFixed(1)} FPS / ${baseline.meanMs.toFixed(2)} ms · change: ${(sample.meanMs - baseline.meanMs).toFixed(2)} ms (${((sample.meanMs / baseline.meanMs - 1) * 100).toFixed(1)}%). Lower frame time is better.`
      : 'Save a baseline before changing switches. Frame times are animation-frame intervals, not GPU execution time.';
  }

  private syncProfileControls(): void {
    const profiler = this.options.renderDiagnostics?.profiler;
    const recording = profiler?.isRecording() ?? false;
    this.backdrop.querySelector<HTMLButtonElement>('[data-profile-record]')!.disabled = recording || this.profilePending;
    this.backdrop.querySelector<HTMLButtonElement>('[data-profile-stop]')!.disabled = !recording || this.profilePending;
    const copy = this.backdrop.querySelector<HTMLButtonElement>('[data-profile-copy]')!;
    copy.hidden = !profiler?.getLastReport();
    copy.disabled = recording || this.profilePending;
    this.recordingBar.hidden = !recording || this.open;
    if (recording && profiler) {
      const seconds = Math.floor(profiler.getElapsedMs() / 1000);
      const text = `● Recording ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ${profiler.getFrameCount().toLocaleString()} frames`;
      this.recordingBar.querySelector('[data-profile-live]')!.textContent = text;
      this.backdrop.querySelector('[data-profile-status]')!.textContent = `${text}. Move, zoom, pan, change toggles or build; every switch is recorded.`;
    }
  }

  private async startProfile(): Promise<void> {
    const diagnostics = this.options.renderDiagnostics;
    if (!diagnostics || this.profilePending || diagnostics.profiler.isRecording()) return;
    this.profilePending = true;
    this.backdrop.querySelector('[data-profile-status]')!.textContent = 'Preparing profiler…';
    this.syncProfileControls();
    try {
      if (this.options.onStartProfile) await this.options.onStartProfile();
      else diagnostics.profiler.start({
        metadata: { source: 'development-menu', gpu: 'unavailable' }, toggles: diagnostics.getState(),
        getContext: () => ({ camera: { position: [], rotation: [], target: [], distance: 0, mode: 'unknown', navigating: false },
          tool: 'none', menuOpen: this.open, visible: document.visibilityState === 'visible', gameSpeed: 1, world: {} }),
      });
      diagnostics.profiler.event('frame-meter', { visible: this.meterVisible });
      this.backdrop.querySelector<HTMLTextAreaElement>('[data-profile-export]')!.hidden = true;
      this.close();
    } catch (error) {
      diagnostics.profiler.stop();
      this.backdrop.querySelector('[data-profile-status]')!.textContent = error instanceof Error ? error.message : 'Could not start profiling.';
    } finally {
      this.profilePending = false;
      this.syncProfileControls();
      this.lastPerformanceUpdate = 0;
    }
  }

  private async stopAndCopyProfile(): Promise<void> {
    if (this.profilePending) return;
    this.options.renderDiagnostics?.profiler.stop();
    this.syncProfileControls();
    // Call the clipboard API in this click's user gesture; do not wait for GPU readback.
    await this.copyProfile();
  }

  private async copyProfile(): Promise<void> {
    const report = this.options.renderDiagnostics?.profiler.getLastReport();
    if (!report || this.profilePending) return;
    this.profilePending = true;
    this.syncProfileControls();
    const status = this.backdrop.querySelector('[data-profile-status]')!;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(report);
      status.textContent = `Copied ${(report.length / 1024).toFixed(1)} KB. Paste the profile into chat for analysis.`;
      this.openMenu(true);
    } catch {
      this.openMenu(true);
      const field = this.backdrop.querySelector<HTMLTextAreaElement>('[data-profile-export]')!;
      field.value = report;
      field.hidden = false;
      field.focus(); field.select();
      status.textContent = 'Clipboard access was blocked. The report is selected below: press Ctrl+C (or Cmd+C), then paste it into chat. Copy last profile retries.';
    } finally {
      this.profilePending = false;
      this.syncProfileControls();
      this.lastPerformanceUpdate = 0;
    }
  }

  private syncPerformanceControls(): void {
    const diagnostics = this.options.renderDiagnostics;
    if (!diagnostics) return;
    for (const button of this.backdrop.querySelectorAll<HTMLButtonElement>('[data-render-category]')) {
      const category = button.dataset.renderCategory as RenderDiagnosticCategory;
      const off = diagnostics.isHidden(category);
      const effectiveOff = diagnostics.isEffectivelyHidden(category);
      button.setAttribute('aria-pressed', String(effectiveOff));
      button.querySelector('[data-render-state]')!.textContent = off ? 'OFF' : effectiveOff ? 'OFF (vegetation)' : 'ON';
      // Keep each child's saved preference; restore the master to edit it again.
      button.disabled = category !== 'vegetation' && diagnostics.isHidden('vegetation')
        && VEGETATION_SWITCHES.some(([child]) => child === category);
    }
    for (const button of this.backdrop.querySelectorAll<HTMLButtonElement>('[data-render-buildings]')) {
      button.setAttribute('aria-pressed', String(button.dataset.renderBuildings === diagnostics.buildingMode));
    }
    const actorsHidden = (['people', 'carts', 'oxen', 'animals'] as const).every(category => diagnostics.isHidden(category));
    this.backdrop.querySelector('[data-render-actors]')!.textContent = actorsHidden ? 'Show all actors' : 'Hide all actors';
    this.lastPerformanceUpdate = 0;
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
    this.options.onPerformanceDetails?.(null);
    this.recordingBar.remove();
    this.options.renderDiagnostics?.profiler.dispose();
  }

  private openMenu(force = false): void {
    if (this.open || this.actionPending || (!force && this.options.canOpenFromKeyboard?.() === false)) return;
    this.cancelPlacement();
    this.syncDate();
    this.open = true;
    this.options.renderDiagnostics?.profiler.event('development-menu', { open: true });
    this.meterVisible = this.backdrop.querySelector<HTMLInputElement>('[data-render-meter]')?.checked ?? false;
    this.syncPerformanceControls();
    this.backdrop.hidden = false;
    this.options.onOpenChange?.(true);
    this.syncProfileControls();
    this.backdrop.querySelector<HTMLButtonElement>('[data-debug-close]')?.focus({ preventScroll: true });
  }

  private close(): void {
    if (!this.open) return;
    this.open = false;
    this.options.renderDiagnostics?.profiler.event('development-menu', { open: false });
    this.backdrop.hidden = true;
    this.options.onOpenChange?.(false);
    this.syncProfileControls();
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
    const companyKind = Math.max(0, Math.min(10, Math.floor(Number(this.companyKind.value))));
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
