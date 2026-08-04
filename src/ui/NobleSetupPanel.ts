import {
  applyHeraldryToElement,
  chargeAssetUrl,
  createHeraldryShield,
  getCurrentNobleProfile,
  getNoble,
  HERALDRY_CHARGES,
  HERALDRY_PATTERNS,
  HERALDRY_PRESETS,
  HERALDRY_TINCTURES,
  NOBLES,
  setCurrentNobleProfile,
  type Heraldry,
  type HeraldryCharge,
  type HeraldryPattern,
  type NobleProfile,
} from './nobleProfile.ts';

export class NobleSetupPanel {
  private readonly backdrop: HTMLElement;
  private readonly resolve: (profile: NobleProfile) => void;
  private readonly previewPortrait: HTMLImageElement;
  private readonly previewName: HTMLInputElement;
  private readonly previewTitle: HTMLElement;
  private readonly previewYears: HTMLElement;
  private readonly mainShield: HTMLElement;
  private readonly presetStrip: HTMLElement;
  private readonly nobleGrid: HTMLElement;
  private readonly patternGrid: HTMLElement;
  private readonly chargeGrid: HTMLElement;
  private readonly fieldColorRow: HTMLElement;
  private readonly patternColorRow: HTMLElement;
  private readonly chargeColorRow: HTMLElement;
  private readonly tilingInput: HTMLInputElement;
  private readonly angleInput: HTMLInputElement;
  private readonly countInput: HTMLInputElement;
  private readonly scaleInput: HTMLInputElement;
  private readonly tilingValue: HTMLElement;
  private readonly angleValue: HTMLElement;
  private readonly countValue: HTMLElement;
  private readonly scaleValue: HTMLElement;
  private draft = getCurrentNobleProfile();
  private selectedPreset = -1;

  private constructor(parent: HTMLElement, resolve: (profile: NobleProfile) => void) {
    this.resolve = resolve;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'noble-setup-backdrop';
    this.backdrop.innerHTML = `
      <form class="noble-setup-shell" aria-label="Odabir plemićkog roda i grba">
        <header class="noble-setup-heading">
          <p>Nova igra · Gorski kotar · ljeta Gospodnjeg 1550.</p>
          <h1>Izaberi svoj plemićki rod</h1>
          <span>Odaberi povijesni lik kao polazište, potom mu podari ime i znamenje.</span>
        </header>

        <div class="noble-setup-layout">
          <section class="noble-setup-identity" aria-labelledby="noble-identity-title">
            <h2 id="noble-identity-title">Tvoj gospodar</h2>
            <div class="noble-setup-portrait-frame">
              <img data-noble-preview-portrait alt="Odabrani plemić" width="560" height="560" />
              <div class="noble-setup-main-shield" data-main-shield></div>
              <div class="noble-setup-portrait-caption">
                <span data-noble-preview-title></span>
                <small data-noble-preview-years></small>
              </div>
            </div>

            <label class="noble-setup-name-label" for="noble-name">
              <span>Ime gospodara</span>
              <input id="noble-name" data-noble-name maxlength="42" autocomplete="off" spellcheck="false" />
            </label>

            <div class="noble-setup-section-heading">
              <h3>Povijesni likovi</h3>
              <span>12 hrvatskih velikaša i krajiških prvaka</span>
            </div>
            <div class="noble-setup-nobles" data-noble-grid></div>
            <p class="noble-setup-history-note">Portreti su povijesno utemeljene interpretacije. Odabrano ime možeš slobodno promijeniti.</p>
          </section>

          <section class="noble-setup-armory" aria-labelledby="noble-armory-title">
            <div class="noble-setup-section-heading noble-setup-section-heading--armory">
              <div>
                <p class="noble-setup-eyebrow">Grb</p>
                <h2 id="noble-armory-title">Znamenje tvoje kuće</h2>
              </div>
              <span>Boje i simboli ostaju vidljivi u igri</span>
            </div>

            <div class="noble-setup-presets" aria-label="Gotovi grbovi" data-preset-strip></div>

            <div class="noble-setup-armory-columns">
              <section class="noble-setup-editor-panel" aria-labelledby="noble-field-title">
                <div class="noble-setup-editor-title">
                  <span aria-hidden="true">I</span>
                  <h3 id="noble-field-title">Polje</h3>
                </div>
                <div class="noble-setup-color-setting">
                  <span>Temeljna boja</span>
                  <div class="noble-setup-colors" data-field-colors></div>
                </div>
                <div class="noble-setup-color-setting">
                  <span>Boja uzorka</span>
                  <div class="noble-setup-colors" data-pattern-colors></div>
                </div>
                <div class="noble-setup-patterns" data-pattern-grid></div>
                <label class="noble-setup-slider-row" for="noble-pattern-tiling">
                  <span>Ponavljanje</span>
                  <input id="noble-pattern-tiling" type="range" min="1" max="6" step="1" data-tiling />
                  <strong data-tiling-value></strong>
                </label>
                <label class="noble-setup-slider-row" for="noble-pattern-angle">
                  <span>Kut</span>
                  <input id="noble-pattern-angle" type="range" min="-45" max="45" step="5" data-angle />
                  <strong data-angle-value></strong>
                </label>
              </section>

              <section class="noble-setup-editor-panel" aria-labelledby="noble-charge-title">
                <div class="noble-setup-editor-title">
                  <span aria-hidden="true">II</span>
                  <h3 id="noble-charge-title">Znamenje</h3>
                </div>
                <div class="noble-setup-color-setting">
                  <span>Boja znamenja</span>
                  <div class="noble-setup-colors" data-charge-colors></div>
                </div>
                <div class="noble-setup-charges" data-charge-grid></div>
                <label class="noble-setup-slider-row" for="noble-charge-count">
                  <span>Broj znamenja</span>
                  <input id="noble-charge-count" type="range" min="1" max="5" step="1" data-count />
                  <strong data-count-value></strong>
                </label>
                <label class="noble-setup-slider-row" for="noble-charge-scale">
                  <span>Veličina</span>
                  <input id="noble-charge-scale" type="range" min="24" max="84" step="1" data-scale />
                  <strong data-scale-value></strong>
                </label>
              </section>
            </div>
          </section>
        </div>

        <footer class="noble-setup-actions">
          <span>Sljedeće: veličina karte, krajolik i način igre</span>
          <button type="submit">Nastavi na uređenje zemlje <i aria-hidden="true">›</i></button>
        </footer>
      </form>
    `;

    parent.appendChild(this.backdrop);
    this.previewPortrait = this.mustImage('[data-noble-preview-portrait]');
    this.previewName = this.mustInput('[data-noble-name]');
    this.previewTitle = this.mustElement('[data-noble-preview-title]');
    this.previewYears = this.mustElement('[data-noble-preview-years]');
    this.presetStrip = this.mustElement('[data-preset-strip]');
    this.nobleGrid = this.mustElement('[data-noble-grid]');
    this.patternGrid = this.mustElement('[data-pattern-grid]');
    this.chargeGrid = this.mustElement('[data-charge-grid]');
    this.fieldColorRow = this.mustElement('[data-field-colors]');
    this.patternColorRow = this.mustElement('[data-pattern-colors]');
    this.chargeColorRow = this.mustElement('[data-charge-colors]');
    this.tilingInput = this.mustInput('[data-tiling]');
    this.angleInput = this.mustInput('[data-angle]');
    this.countInput = this.mustInput('[data-count]');
    this.scaleInput = this.mustInput('[data-scale]');
    this.tilingValue = this.mustElement('[data-tiling-value]');
    this.angleValue = this.mustElement('[data-angle-value]');
    this.countValue = this.mustElement('[data-count-value]');
    this.scaleValue = this.mustElement('[data-scale-value]');
    const mainShieldMount = this.mustElement('[data-main-shield]');
    this.mainShield = createHeraldryShield('heraldry-shield--main');
    mainShieldMount.appendChild(this.mainShield);

    this.renderPresets();
    this.renderNobles();
    this.renderPatterns();
    this.renderCharges();
    this.renderColorRow(this.fieldColorRow, 'fieldColor');
    this.renderColorRow(this.patternColorRow, 'patternColor');
    this.renderColorRow(this.chargeColorRow, 'chargeColor');
    this.bindEvents();
    this.syncAll();
  }

  static prompt(parent: HTMLElement): Promise<NobleProfile> {
    return new Promise((resolve) => {
      new NobleSetupPanel(parent, resolve);
    });
  }

  private bindEvents(): void {
    this.previewName.addEventListener('input', () => {
      this.draft.displayName = this.previewName.value;
    });
    this.tilingInput.addEventListener('input', () => {
      this.draft.heraldry.patternTiling = Number(this.tilingInput.value);
      this.clearPresetSelection();
      this.syncHeraldry();
    });
    this.angleInput.addEventListener('input', () => {
      this.draft.heraldry.patternAngle = Number(this.angleInput.value);
      this.clearPresetSelection();
      this.syncHeraldry();
    });
    this.countInput.addEventListener('input', () => {
      this.draft.heraldry.chargeCount = Number(this.countInput.value);
      this.clearPresetSelection();
      this.syncHeraldry();
    });
    this.scaleInput.addEventListener('input', () => {
      this.draft.heraldry.chargeScale = Number(this.scaleInput.value) / 100;
      this.clearPresetSelection();
      this.syncHeraldry();
    });
    this.backdrop.querySelector<HTMLFormElement>('.noble-setup-shell')!.addEventListener('submit', (event) => {
      event.preventDefault();
      const noble = getNoble(this.draft.nobleId);
      this.draft.displayName = this.previewName.value.trim() || noble.name;
      setCurrentNobleProfile(this.draft);
      const profile = getCurrentNobleProfile();
      this.backdrop.classList.add('is-leaving');
      window.setTimeout(() => {
        this.backdrop.remove();
        this.resolve(profile);
      }, 180);
    });
  }

  private renderPresets(): void {
    HERALDRY_PRESETS.forEach((preset, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'noble-setup-preset';
      button.setAttribute('aria-label', `Gotovi grb ${index + 1}`);
      const shield = createHeraldryShield('heraldry-shield--preset');
      applyHeraldryToElement(shield, preset);
      button.appendChild(shield);
      button.addEventListener('click', () => {
        this.draft.heraldry = { ...preset };
        this.selectedPreset = index;
        this.syncHeraldry();
      });
      this.presetStrip.appendChild(button);
    });
  }

  private renderNobles(): void {
    NOBLES.forEach((noble) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'noble-setup-noble';
      button.dataset.nobleId = noble.id;
      button.title = `${noble.name} — ${noble.title}`;
      button.innerHTML = `
        <img src="${noble.portrait}" alt="" width="560" height="560" loading="eager" />
        <span>${noble.name.replace(/\s+(?=[^ ]+$)/, '<br>')}</span>
      `;
      button.addEventListener('click', () => {
        this.draft.nobleId = noble.id;
        this.draft.displayName = noble.name;
        this.syncIdentity();
      });
      this.nobleGrid.appendChild(button);
    });
  }

  private renderPatterns(): void {
    HERALDRY_PATTERNS.forEach((pattern) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'noble-setup-pattern';
      button.dataset.patternChoice = pattern.id;
      button.setAttribute('aria-label', pattern.name);
      const shield = createHeraldryShield('heraldry-shield--pattern');
      const patternHeraldry: Heraldry = {
        ...this.draft.heraldry,
        pattern: pattern.id,
        chargeCount: 1,
        chargeScale: 0.01,
      };
      applyHeraldryToElement(shield, patternHeraldry);
      button.append(shield, document.createTextNode(pattern.name));
      button.addEventListener('click', () => {
        this.draft.heraldry.pattern = pattern.id as HeraldryPattern;
        this.clearPresetSelection();
        this.syncHeraldry();
      });
      this.patternGrid.appendChild(button);
    });
  }

  private renderCharges(): void {
    HERALDRY_CHARGES.forEach((charge) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'noble-setup-charge';
      button.dataset.chargeChoice = charge.id;
      button.setAttribute('aria-label', charge.name);
      const icon = document.createElement('span');
      icon.style.setProperty('--charge-icon', `url("${chargeAssetUrl(charge.id)}")`);
      button.append(icon, document.createTextNode(charge.name));
      button.addEventListener('click', () => {
        this.draft.heraldry.charge = charge.id as HeraldryCharge;
        this.clearPresetSelection();
        this.syncHeraldry();
      });
      this.chargeGrid.appendChild(button);
    });
  }

  private renderColorRow(
    target: HTMLElement,
    key: 'fieldColor' | 'patternColor' | 'chargeColor',
  ): void {
    HERALDRY_TINCTURES.forEach((tincture) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'noble-setup-color';
      button.dataset.colorKey = key;
      button.dataset.colorValue = tincture.value;
      button.style.setProperty('--swatch-color', tincture.value);
      button.setAttribute('aria-label', tincture.name);
      button.title = tincture.name;
      button.addEventListener('click', () => {
        this.draft.heraldry[key] = tincture.value;
        this.clearPresetSelection();
        this.syncHeraldry();
      });
      target.appendChild(button);
    });
  }

  private syncAll(): void {
    this.syncIdentity();
    this.syncHeraldry();
  }

  private syncIdentity(): void {
    const noble = getNoble(this.draft.nobleId);
    this.previewPortrait.src = noble.portrait;
    this.previewPortrait.alt = `Portret: ${noble.name}`;
    this.previewName.value = this.draft.displayName;
    this.previewTitle.textContent = noble.title;
    this.previewYears.textContent = noble.years;
    for (const button of this.nobleGrid.querySelectorAll<HTMLButtonElement>('[data-noble-id]')) {
      const selected = button.dataset.nobleId === noble.id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  private syncHeraldry(): void {
    const heraldry = this.draft.heraldry;
    applyHeraldryToElement(this.mainShield, heraldry);
    this.tilingInput.value = String(heraldry.patternTiling);
    this.angleInput.value = String(heraldry.patternAngle);
    this.countInput.value = String(heraldry.chargeCount);
    this.scaleInput.value = String(Math.round(heraldry.chargeScale * 100));
    this.tilingValue.textContent = `×${heraldry.patternTiling}`;
    this.angleValue.textContent = `${heraldry.patternAngle}°`;
    this.countValue.textContent = String(heraldry.chargeCount);
    this.scaleValue.textContent = `${Math.round(heraldry.chargeScale * 100)}%`;

    for (const button of this.patternGrid.querySelectorAll<HTMLButtonElement>('[data-pattern-choice]')) {
      const selected = button.dataset.patternChoice === heraldry.pattern;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      const shield = button.querySelector<HTMLElement>('.heraldry-shield');
      if (shield) {
        applyHeraldryToElement(shield, {
          ...heraldry,
          pattern: button.dataset.patternChoice as HeraldryPattern,
          chargeScale: 0.01,
        });
      }
    }
    for (const button of this.chargeGrid.querySelectorAll<HTMLButtonElement>('[data-charge-choice]')) {
      const selected = button.dataset.chargeChoice === heraldry.charge;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.style.setProperty('--charge-preview-color', heraldry.chargeColor);
    }
    for (const button of this.backdrop.querySelectorAll<HTMLButtonElement>('[data-color-key]')) {
      const key = button.dataset.colorKey as 'fieldColor' | 'patternColor' | 'chargeColor';
      const selected = button.dataset.colorValue === heraldry[key];
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    for (const [index, button] of [...this.presetStrip.querySelectorAll<HTMLButtonElement>('.noble-setup-preset')].entries()) {
      button.classList.toggle('is-selected', index === this.selectedPreset);
      button.setAttribute('aria-pressed', String(index === this.selectedPreset));
    }
  }

  private clearPresetSelection(): void {
    this.selectedPreset = -1;
  }

  private mustElement(selector: string): HTMLElement {
    const element = this.backdrop.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Noble setup is missing ${selector}.`);
    return element;
  }

  private mustInput(selector: string): HTMLInputElement {
    const input = this.backdrop.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`Noble setup is missing ${selector}.`);
    return input;
  }

  private mustImage(selector: string): HTMLImageElement {
    const image = this.backdrop.querySelector<HTMLImageElement>(selector);
    if (!image) throw new Error(`Noble setup is missing ${selector}.`);
    return image;
  }
}
