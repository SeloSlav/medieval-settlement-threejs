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
import { SetupUiAudio } from '../audio/SetupUiAudio.ts';
import { mountTooltips } from './tooltips.ts';

export type NobleSetupStep = 'house' | 'heraldry';

export type NobleSetupOptions = {
  initialStep?: NobleSetupStep;
  initialProfile?: NobleProfile;
};

function heraldryMatches(left: Heraldry, right: Heraldry): boolean {
  return left.pattern === right.pattern
    && left.fieldColor === right.fieldColor
    && left.patternColor === right.patternColor
    && left.patternTiling === right.patternTiling
    && left.patternAngle === right.patternAngle
    && left.charge === right.charge
    && left.chargeColor === right.chargeColor
    && left.chargeCount === right.chargeCount
    && left.chargeScale === right.chargeScale;
}

export class NobleSetupPanel {
  private readonly setupAudio = new SetupUiAudio();
  private readonly backdrop: HTMLElement;
  private readonly resolve: (profile: NobleProfile) => void;
  private readonly heading: HTMLElement;
  private readonly housePage: HTMLElement;
  private readonly heraldryPage: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly previewPortrait: HTMLImageElement;
  private readonly previewName: HTMLInputElement;
  private readonly previewTitle: HTMLElement;
  private readonly previewYears: HTMLElement;
  private readonly previewDescription: HTMLElement;
  private readonly heraldryHouseName: HTMLElement;
  private readonly heraldryPreviewPortrait: HTMLImageElement;
  private readonly heraldryPreviewTitle: HTMLElement;
  private readonly heraldryPreviewYears: HTMLElement;
  private readonly heraldryDescription: HTMLElement;
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
  private readonly disposeTooltips: () => void;
  private draft: NobleProfile;
  private step: NobleSetupStep;
  private selectedPreset: number;

  private constructor(
    parent: HTMLElement,
    resolve: (profile: NobleProfile) => void,
    options: NobleSetupOptions,
  ) {
    this.resolve = resolve;
    const initialProfile = options.initialProfile ?? getCurrentNobleProfile();
    this.draft = {
      ...initialProfile,
      heraldry: { ...initialProfile.heraldry },
    };
    this.step = options.initialStep ?? 'house';
    this.selectedPreset = HERALDRY_PRESETS.findIndex((preset) => (
      heraldryMatches(preset, this.draft.heraldry)
    ));
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'noble-setup-backdrop';
    this.backdrop.innerHTML = `
      <form
        class="noble-setup-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="noble-setup-heading"
      >
        <header class="noble-setup-heading">
          <nav class="new-game-setup-steps" aria-label="New world setup progress">
            <ol>
              <li data-setup-progress="house"><span>1</span><strong>Legacy</strong></li>
              <li data-setup-progress="heraldry"><span>2</span><strong>Heraldry</strong></li>
              <li data-setup-progress="map"><span>3</span><strong>Map Generation</strong></li>
            </ol>
          </nav>
          <h1 id="noble-setup-heading" data-setup-heading tabindex="-1">Choose Your Legacy</h1>
        </header>

        <div class="noble-setup-layout">
          <section class="noble-setup-identity" data-setup-step="house" aria-label="Historical figure selection">
            <div class="noble-setup-house-content">
              <div class="noble-setup-house-profile">
                <div class="noble-setup-identity-showcase">
                  <div class="noble-setup-portrait-frame">
                    <img data-noble-preview-portrait alt="Selected historical figure" width="560" height="737" />
                  </div>
                </div>

                <div
                  class="noble-setup-portrait-caption"
                  data-noble-description
                  data-tooltip-placement="above"
                  tabindex="0"
                >
                  <span data-noble-preview-title></span>
                  <small data-noble-preview-years></small>
                </div>

                <label class="noble-setup-name-label" for="noble-name">
                  <span>Character Name</span>
                  <input id="noble-name" data-noble-name maxlength="42" autocomplete="off" spellcheck="false" />
                </label>
              </div>

              <div class="noble-setup-house-roster">
                <div class="noble-setup-section-heading">
                  <h3>Historical Figures</h3>
                </div>
                <div class="noble-setup-nobles" data-noble-grid></div>
              </div>
            </div>
          </section>

          <section class="noble-setup-armory" data-setup-step="heraldry" aria-label="Heraldry editor" hidden>
            <div class="noble-setup-heraldry-layout">
              <aside class="noble-setup-heraldry-profile" aria-label="Chosen legacy and live heraldry">
                <div class="noble-setup-heraldry-portrait-shell">
                  <div class="noble-setup-heraldry-portrait-frame">
                    <img data-heraldry-preview-portrait alt="Selected historical figure" width="560" height="737" />
                  </div>
                  <div class="noble-setup-heraldry-shield" data-main-shield></div>
                </div>
                <div
                  class="noble-setup-heraldry-identity"
                  data-heraldry-description
                  data-tooltip-placement="above"
                  tabindex="0"
                >
                  <p class="noble-setup-eyebrow">Chosen Legacy</p>
                  <h2 data-heraldry-house-name></h2>
                  <p data-heraldry-preview-title></p>
                  <small data-heraldry-preview-years></small>
                </div>
              </aside>

              <div class="noble-setup-heraldry-editor">
                <div class="noble-setup-presets" aria-label="Coat of arms presets" data-preset-strip></div>

                <div class="noble-setup-armory-columns">
                  <section class="noble-setup-editor-panel" aria-labelledby="noble-field-title">
                    <div class="noble-setup-editor-title">
                      <span aria-hidden="true">I</span>
                      <h3 id="noble-field-title">Field</h3>
                    </div>
                    <div class="noble-setup-color-setting">
                      <span>Primary Color</span>
                      <div class="noble-setup-colors" data-field-colors></div>
                    </div>
                    <div class="noble-setup-color-setting">
                      <span>Pattern Color</span>
                      <div class="noble-setup-colors" data-pattern-colors></div>
                    </div>
                    <div class="noble-setup-patterns" data-pattern-grid></div>
                    <label class="noble-setup-slider-row" for="noble-pattern-tiling">
                      <span>Tiling</span>
                      <input id="noble-pattern-tiling" type="range" min="1" max="6" step="1" data-tiling />
                      <strong data-tiling-value></strong>
                    </label>
                    <label class="noble-setup-slider-row" for="noble-pattern-angle">
                      <span>Angle</span>
                      <input id="noble-pattern-angle" type="range" min="-45" max="45" step="5" data-angle />
                      <strong data-angle-value></strong>
                    </label>
                  </section>

                  <section class="noble-setup-editor-panel" aria-labelledby="noble-charge-title">
                    <div class="noble-setup-editor-title">
                      <span aria-hidden="true">II</span>
                      <h3 id="noble-charge-title">Charge</h3>
                    </div>
                    <div class="noble-setup-color-setting">
                      <span>Charge Color</span>
                      <div class="noble-setup-colors" data-charge-colors></div>
                    </div>
                    <div class="noble-setup-charges" data-charge-grid></div>
                    <label class="noble-setup-slider-row" for="noble-charge-count">
                      <span>Number of Charges</span>
                      <input id="noble-charge-count" type="range" min="1" max="5" step="1" data-count />
                      <strong data-count-value></strong>
                    </label>
                    <label class="noble-setup-slider-row" for="noble-charge-scale">
                      <span>Scale</span>
                      <input id="noble-charge-scale" type="range" min="24" max="84" step="1" data-scale />
                      <strong data-scale-value></strong>
                    </label>
                  </section>
                </div>
              </div>
            </div>
          </section>
        </div>

        <footer class="noble-setup-actions">
          <button type="button" class="noble-setup-back" data-setup-back hidden>
            <i aria-hidden="true">‹</i> Back to Legacy
          </button>
          <button type="submit" data-setup-next>
            Continue to Heraldry <i aria-hidden="true">›</i>
          </button>
        </footer>
      </form>
    `;

    parent.appendChild(this.backdrop);
    this.disposeTooltips = mountTooltips(this.backdrop);
    document.getElementById('ui-tooltip')?.classList.add('ui-tooltip--noble-setup');
    this.heading = this.mustElement('[data-setup-heading]');
    this.housePage = this.mustElement('[data-setup-step="house"]');
    this.heraldryPage = this.mustElement('[data-setup-step="heraldry"]');
    this.backButton = this.mustButton('[data-setup-back]');
    this.nextButton = this.mustButton('[data-setup-next]');
    this.previewPortrait = this.mustImage('[data-noble-preview-portrait]');
    this.previewName = this.mustInput('[data-noble-name]');
    this.previewTitle = this.mustElement('[data-noble-preview-title]');
    this.previewYears = this.mustElement('[data-noble-preview-years]');
    this.previewDescription = this.mustElement('[data-noble-description]');
    this.heraldryHouseName = this.mustElement('[data-heraldry-house-name]');
    this.heraldryPreviewPortrait = this.mustImage('[data-heraldry-preview-portrait]');
    this.heraldryPreviewTitle = this.mustElement('[data-heraldry-preview-title]');
    this.heraldryPreviewYears = this.mustElement('[data-heraldry-preview-years]');
    this.heraldryDescription = this.mustElement('[data-heraldry-description]');
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
    this.syncStep(true);
  }

  static prompt(parent: HTMLElement, options: NobleSetupOptions = {}): Promise<NobleProfile> {
    return new Promise((resolve) => {
      new NobleSetupPanel(parent, resolve, options);
    });
  }

  private bindEvents(): void {
    this.previewName.addEventListener('input', () => {
      this.draft.displayName = this.previewName.value;
    });
    this.tilingInput.addEventListener('input', () => {
      this.draft.heraldry.patternTiling = Number(this.tilingInput.value);
      this.setupAudio.playAdjustment(
        this.draft.heraldry.patternTiling,
        Number(this.tilingInput.min),
        Number(this.tilingInput.max),
      );
      this.clearPresetSelection();
      this.syncHeraldry();
    });
    this.angleInput.addEventListener('input', () => {
      this.draft.heraldry.patternAngle = Number(this.angleInput.value);
      this.setupAudio.playAdjustment(
        this.draft.heraldry.patternAngle,
        Number(this.angleInput.min),
        Number(this.angleInput.max),
      );
      this.clearPresetSelection();
      this.syncHeraldry();
    });
    this.countInput.addEventListener('input', () => {
      this.draft.heraldry.chargeCount = Number(this.countInput.value);
      this.setupAudio.playAdjustment(
        this.draft.heraldry.chargeCount,
        Number(this.countInput.min),
        Number(this.countInput.max),
      );
      this.clearPresetSelection();
      this.syncHeraldry();
    });
    this.scaleInput.addEventListener('input', () => {
      this.draft.heraldry.chargeScale = Number(this.scaleInput.value) / 100;
      this.setupAudio.playAdjustment(
        Number(this.scaleInput.value),
        Number(this.scaleInput.min),
        Number(this.scaleInput.max),
      );
      this.clearPresetSelection();
      this.syncHeraldry();
    });
    this.backButton.addEventListener('click', () => {
      this.setupAudio.play('setup_back');
      this.step = 'house';
      this.syncStep(true);
    });
    this.backdrop.querySelector<HTMLFormElement>('.noble-setup-shell')!.addEventListener('submit', (event) => {
      event.preventDefault();
      const noble = getNoble(this.draft.nobleId);
      this.draft.displayName = this.previewName.value.trim() || noble.name;
      this.previewName.value = this.draft.displayName;
      this.heraldryHouseName.textContent = this.draft.displayName;
      if (this.step === 'house') {
        this.setupAudio.play('setup_advance');
        this.step = 'heraldry';
        this.syncStep(true);
        return;
      }
      this.setupAudio.play('setup_advance');
      setCurrentNobleProfile(this.draft);
      const profile = getCurrentNobleProfile();
      this.disposeTooltips();
      this.backdrop.classList.add('is-leaving');
      // Resolve while this panel is still covering the screen so the map setup
      // mounts underneath it before the fade completes. Otherwise the persistent
      // app loader flashes through during the handoff.
      this.resolve(profile);
      this.setupAudio.disposeAfterTail();
      window.setTimeout(() => {
        this.backdrop.remove();
      }, 180);
    });
  }

  private renderPresets(): void {
    HERALDRY_PRESETS.forEach((preset, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'noble-setup-preset';
      button.setAttribute('aria-label', `Coat of arms preset ${index + 1}`);
      const shield = createHeraldryShield('heraldry-shield--preset');
      applyHeraldryToElement(shield, preset);
      button.appendChild(shield);
      button.addEventListener('click', () => {
        this.setupAudio.play('setup_preset');
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
      button.dataset.tooltipTitle = noble.name;
      button.dataset.tooltip = `${noble.title}\n\n${noble.years}`;
      button.dataset.tooltipPlacement = 'above';
      button.setAttribute('aria-label', `${noble.name}. ${noble.title}. ${noble.years}`);
      button.innerHTML = `
        ${noble.portrait
          ? `<img src="${noble.portrait}" alt="" width="560" height="560" loading="eager" />`
          : '<i class="noble-setup-noble__portrait-placeholder" aria-hidden="true"></i>'}
      `;
      button.addEventListener('click', () => {
        this.setupAudio.play('setup_portrait_select');
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
        this.setupAudio.play('setup_choice');
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
        this.setupAudio.play('setup_choice');
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
        this.setupAudio.play('setup_choice');
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
    this.syncPortrait(this.previewPortrait, noble.portrait, noble.name);
    this.previewName.value = this.draft.displayName;
    this.previewTitle.textContent = noble.title;
    this.previewYears.textContent = noble.years;
    this.heraldryHouseName.textContent = this.draft.displayName;
    this.syncPortrait(this.heraldryPreviewPortrait, noble.portrait, noble.name);
    this.heraldryPreviewTitle.textContent = noble.title;
    this.heraldryPreviewYears.textContent = noble.years;
    const tooltipBody = `${noble.title}\n\n${noble.years}`;
    this.previewDescription.dataset.tooltipTitle = noble.name;
    this.previewDescription.dataset.tooltip = tooltipBody;
    this.heraldryDescription.dataset.tooltipTitle = noble.name;
    this.heraldryDescription.dataset.tooltip = tooltipBody;
    for (const button of this.nobleGrid.querySelectorAll<HTMLButtonElement>('[data-noble-id]')) {
      const selected = button.dataset.nobleId === noble.id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  private syncPortrait(image: HTMLImageElement, portrait: string | null, name: string): void {
    image.parentElement?.classList.toggle('is-portrait-pending', portrait === null);
    if (portrait) {
      image.src = portrait;
      image.alt = `Portrait of ${name}`;
      return;
    }
    image.removeAttribute('src');
    image.alt = '';
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

  private syncStep(moveFocus = false): void {
    const isHouse = this.step === 'house';
    this.housePage.hidden = !isHouse;
    this.heraldryPage.hidden = isHouse;
    this.backButton.hidden = isHouse;
    this.heading.textContent = isHouse
      ? 'Choose Your Legacy'
      : 'Design Your Heraldry';
    this.nextButton.innerHTML = isHouse
      ? 'Continue to Heraldry <i aria-hidden="true">›</i>'
      : 'Continue to Map Generation <i aria-hidden="true">›</i>';
    this.backdrop.dataset.activeSetupStep = this.step;

    for (const item of this.backdrop.querySelectorAll<HTMLElement>('[data-setup-progress]')) {
      const progressStep = item.dataset.setupProgress;
      const active = progressStep === this.step;
      if (active) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.classList.toggle('is-complete', this.step === 'heraldry' && progressStep === 'house');
    }

    if (moveFocus) this.heading.focus();
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

  private mustButton(selector: string): HTMLButtonElement {
    const button = this.backdrop.querySelector<HTMLButtonElement>(selector);
    if (!button) throw new Error(`Noble setup is missing ${selector}.`);
    return button;
  }

  private mustImage(selector: string): HTMLImageElement {
    const image = this.backdrop.querySelector<HTMLImageElement>(selector);
    if (!image) throw new Error(`Noble setup is missing ${selector}.`);
    return image;
  }
}
