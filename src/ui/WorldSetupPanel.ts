import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  formatSeedHex,
  MAP_SIZE_PRESETS,
  normalizeWorldGenerationSettings,
  parseSeedHex,
  randomWorldSeed,
  type WorldGenerationSettings,
  type WorldMapSize,
} from '../world/worldGenerationSettings.ts';

export class WorldSetupPanel {
  private readonly backdrop: HTMLElement;
  private readonly resolve: (settings: WorldGenerationSettings) => void;
  private draft: WorldGenerationSettings = { ...DEFAULT_WORLD_GENERATION_SETTINGS };

  private constructor(parent: HTMLElement, resolve: (settings: WorldGenerationSettings) => void) {
    this.resolve = resolve;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'world-setup-backdrop';
    this.backdrop.innerHTML = `
      <form class="world-setup-dialog" aria-labelledby="world-setup-title">
        <p class="world-setup-dialog__eyebrow">New settlement</p>
        <h1 id="world-setup-title" class="world-setup-dialog__title">Shape your world</h1>
        <p class="world-setup-dialog__intro">
          Choose the map scale and landscape character before roads, forests, and rivers are generated.
        </p>

        <section class="world-setup-section" aria-label="Map size">
          <h2 class="world-setup-section__title">Map size</h2>
          <div class="world-setup-size-grid" data-size-grid></div>
        </section>

        <section class="world-setup-section" aria-label="Settlement mode">
          <h2 class="world-setup-section__title">Settlement mode</h2>
          <div class="world-setup-mode-grid" data-mode-grid>
            <button type="button" class="world-setup-mode-option is-selected" data-conflict-mode="peaceful">
              <strong>Peaceful settlement</strong>
              <span>Construction, survival, trade, and optimization without hostile raids.</span>
            </button>
            <button type="button" class="world-setup-mode-option" data-conflict-mode="frontier">
              <strong>Contested frontier</strong>
              <span>Build an economy that can also support watchmen and withstand periodic incursions.</span>
            </button>
          </div>
          <div class="world-setup-pressure" data-pressure-controls hidden>
            <label class="world-setup-slider-label" for="world-setup-pressure">
              <span>Enemy pressure</span>
              <strong data-pressure-value>50</strong>
            </label>
            <input id="world-setup-pressure" class="world-setup-slider" type="range" min="10" max="100" step="5" value="50" />
            <p class="world-setup-slider-hint">Higher pressure shortens warnings and increases exposed-stock losses. It does not grant enemies extra resources.</p>
          </div>
        </section>

        <section class="world-setup-section" aria-label="Topography">
          <label class="world-setup-slider-label" for="world-setup-topography">
            <span>Topography</span>
            <strong data-topography-value>${this.draft.topography}</strong>
          </label>
          <input id="world-setup-topography" class="world-setup-slider" type="range" min="0" max="100" step="1" value="${this.draft.topography}" />
          <p class="world-setup-slider-hint">Low = gentle rolling hills. High = rugged ridges and steep valleys.</p>
        </section>

        <section class="world-setup-section" aria-label="Hydrology">
          <label class="world-setup-slider-label" for="world-setup-hydrology">
            <span>Hydrology</span>
            <strong data-hydrology-value>${this.draft.hydrology}</strong>
          </label>
          <input id="world-setup-hydrology" class="world-setup-slider" type="range" min="0" max="100" step="1" value="${this.draft.hydrology}" />
          <p class="world-setup-slider-hint">Low = drier land with fewer rivers. High = wetter valleys and more waterways.</p>
        </section>

        <section class="world-setup-section" aria-label="Forest density">
          <label class="world-setup-slider-label" for="world-setup-forest">
            <span>Forest density</span>
            <strong data-forest-value>${this.draft.forestDensity}</strong>
          </label>
          <input id="world-setup-forest" class="world-setup-slider" type="range" min="0" max="100" step="1" value="${this.draft.forestDensity}" />
          <p class="world-setup-slider-hint">Low = open meadows and scattered woodland. High = dense conifer cover.</p>
        </section>

        <section class="world-setup-section" aria-label="World seed">
          <h2 class="world-setup-section__title">World seed</h2>
          <div class="world-setup-seed-row">
            <input class="world-setup-seed-input" type="text" inputmode="text" spellcheck="false" autocomplete="off" aria-label="World seed" data-seed-input value="${formatSeedHex(this.draft.seed)}" />
            <button type="button" class="world-setup-randomize" data-randomize-seed>Randomize</button>
          </div>
        </section>

        <div class="world-setup-actions">
          <button type="submit" class="world-setup-start">Start world</button>
        </div>
      </form>
    `;

    parent.appendChild(this.backdrop);
    this.renderSizeOptions();
    this.bindEvents();
  }

  static prompt(parent: HTMLElement): Promise<WorldGenerationSettings> {
    return new Promise((resolve) => {
      new WorldSetupPanel(parent, resolve);
    });
  }

  private bindEvents(): void {
    const form = this.backdrop.querySelector<HTMLFormElement>('.world-setup-dialog')!;
    const topographySlider = this.backdrop.querySelector<HTMLInputElement>('#world-setup-topography')!;
    const hydrologySlider = this.backdrop.querySelector<HTMLInputElement>('#world-setup-hydrology')!;
    const forestSlider = this.backdrop.querySelector<HTMLInputElement>('#world-setup-forest')!;
    const topographyValue = this.backdrop.querySelector<HTMLElement>('[data-topography-value]')!;
    const hydrologyValue = this.backdrop.querySelector<HTMLElement>('[data-hydrology-value]')!;
    const forestValue = this.backdrop.querySelector<HTMLElement>('[data-forest-value]')!;
    const seedInput = this.backdrop.querySelector<HTMLInputElement>('[data-seed-input]')!;
    const randomizeButton = this.backdrop.querySelector<HTMLButtonElement>('[data-randomize-seed]')!;
    const modeGrid = this.backdrop.querySelector<HTMLElement>('[data-mode-grid]')!;
    const pressureControls = this.backdrop.querySelector<HTMLElement>('[data-pressure-controls]')!;
    const pressureSlider = this.backdrop.querySelector<HTMLInputElement>('#world-setup-pressure')!;
    const pressureValue = this.backdrop.querySelector<HTMLElement>('[data-pressure-value]')!;

    for (const button of modeGrid.querySelectorAll<HTMLButtonElement>('[data-conflict-mode]')) {
      button.addEventListener('click', () => {
        this.draft.conflictMode = button.dataset.conflictMode === 'frontier' ? 'frontier' : 'peaceful';
        if (this.draft.conflictMode === 'frontier' && this.draft.enemyPressure <= 0) {
          this.draft.enemyPressure = 50;
        }
        pressureSlider.value = String(Math.max(10, this.draft.enemyPressure));
        pressureValue.textContent = pressureSlider.value;
        pressureControls.hidden = this.draft.conflictMode !== 'frontier';
        for (const option of modeGrid.querySelectorAll<HTMLButtonElement>('[data-conflict-mode]')) {
          option.classList.toggle('is-selected', option.dataset.conflictMode === this.draft.conflictMode);
        }
      });
    }
    pressureSlider.addEventListener('input', () => {
      this.draft.enemyPressure = Number(pressureSlider.value);
      pressureValue.textContent = pressureSlider.value;
    });

    topographySlider.addEventListener('input', () => {
      this.draft.topography = Number(topographySlider.value);
      topographyValue.textContent = String(this.draft.topography);
    });
    hydrologySlider.addEventListener('input', () => {
      this.draft.hydrology = Number(hydrologySlider.value);
      hydrologyValue.textContent = String(this.draft.hydrology);
    });
    forestSlider.addEventListener('input', () => {
      this.draft.forestDensity = Number(forestSlider.value);
      forestValue.textContent = String(this.draft.forestDensity);
    });
    randomizeButton.addEventListener('click', () => {
      this.draft.seed = randomWorldSeed();
      seedInput.value = formatSeedHex(this.draft.seed);
    });
    seedInput.addEventListener('change', () => {
      const parsed = parseSeedHex(seedInput.value);
      if (parsed === null) {
        seedInput.value = formatSeedHex(this.draft.seed);
        return;
      }
      this.draft.seed = parsed;
      seedInput.value = formatSeedHex(parsed);
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const parsed = parseSeedHex(seedInput.value);
      if (parsed !== null) {
        this.draft.seed = parsed;
      }
      const settings = normalizeWorldGenerationSettings(this.draft);
      this.backdrop.remove();
      this.resolve(settings);
    });
  }

  private renderSizeOptions(): void {
    const grid = this.backdrop.querySelector<HTMLElement>('[data-size-grid]')!;
    grid.innerHTML = (Object.keys(MAP_SIZE_PRESETS) as WorldMapSize[]).map((size) => {
      const preset = MAP_SIZE_PRESETS[size];
      const selected = size === this.draft.mapSize ? ' is-selected' : '';
      const playableKm = (preset.playableSize / 1000).toFixed(1);
      return `
        <button type="button" class="world-setup-size-option${selected}" data-map-size="${size}">
          <strong>${preset.label}</strong>
          <span>${playableKm} km playable</span>
        </button>
      `;
    }).join('');

    for (const button of grid.querySelectorAll<HTMLButtonElement>('[data-map-size]')) {
      button.addEventListener('click', () => {
        const size = button.dataset.mapSize as WorldMapSize;
        this.draft.mapSize = size;
        for (const option of grid.querySelectorAll<HTMLButtonElement>('[data-map-size]')) {
          option.classList.toggle('is-selected', option.dataset.mapSize === size);
        }
      });
    }
  }
}
