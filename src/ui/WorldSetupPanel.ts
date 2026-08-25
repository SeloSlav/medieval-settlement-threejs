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
import {
  applyTerrainPreset,
  seedForTerrainPreset,
  WORLD_TERRAIN_PRESETS,
  type WorldTerrainPreset,
} from '../world/worldTerrainPresets.ts';
import {
  createRegionalDepositSurvey,
  createRegionalResourcePlan,
  describeResourceAbundance,
  describeResourceVariety,
  type RegionalDepositResource,
} from '../world/regionalResourceDistribution.ts';

export type WorldSetupResult = {
  action: 'back' | 'start';
  settings: WorldGenerationSettings;
};

export type WorldSetupOptions = {
  initialSettings?: WorldGenerationSettings;
};

export class WorldSetupPanel {
  private readonly backdrop: HTMLElement;
  private readonly resolve: (result: WorldSetupResult) => void;
  private draft: WorldGenerationSettings;

  private constructor(
    parent: HTMLElement,
    resolve: (result: WorldSetupResult) => void,
    options: WorldSetupOptions,
  ) {
    this.resolve = resolve;
    this.draft = options.initialSettings
      ? normalizeWorldGenerationSettings(options.initialSettings)
      : applyTerrainPreset(
        { ...DEFAULT_WORLD_GENERATION_SETTINGS },
        'delnice_meadow',
      );
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'world-setup-backdrop';
    this.backdrop.dataset.activeSetupStep = 'map';
    this.backdrop.innerHTML = `
      <video
        class="world-setup-background-video"
        src="/assets/ui/selo_empire_loading_screen.mp4"
        autoplay
        muted
        loop
        playsinline
        preload="auto"
        aria-hidden="true"
      ></video>
      <div class="world-setup-shell">
        <img
          class="world-setup-logo"
          src="/assets/ui/selo-empire-logo-serious.png"
          alt="Selo Empire"
          width="1643"
          height="957"
          fetchpriority="high"
          decoding="sync"
        />
        <form
          class="world-setup-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="world-setup-heading"
        >
          <header class="world-setup-wizard-heading">
            <h1 id="world-setup-heading" class="world-setup-sr-title">Map Generation</h1>
            <nav class="new-game-setup-steps" aria-label="New world setup progress">
              <ol>
                <li class="is-complete" data-setup-progress="house"><span>1</span><strong>Noble House</strong></li>
                <li class="is-complete" data-setup-progress="heraldry"><span>2</span><strong>Heraldry</strong></li>
                <li data-setup-progress="map" data-setup-heading aria-current="step" tabindex="-1"><span>3</span><strong>Map Generation</strong></li>
              </ol>
            </nav>
          </header>
          <div class="world-setup-scroll" aria-label="World settings">
            <section class="world-setup-section" aria-label="Map size">
            <h2 class="world-setup-section__title">Map size</h2>
            <div class="world-setup-size-grid" data-size-grid></div>
            </section>

            <section class="world-setup-section" aria-label="Settlement mode">
            <h2 class="world-setup-section__title">Settlement mode</h2>
            <div class="world-setup-mode-grid" data-mode-grid>
              <button type="button" class="world-setup-mode-option is-selected" data-conflict-mode="peaceful">
                <strong>Peaceful settlement</strong>
                <span>Build, trade, and grow without hostile raids.</span>
              </button>
              <button type="button" class="world-setup-mode-option" data-conflict-mode="frontier">
                <strong>Contested frontier</strong>
                <span>Support watchmen and withstand periodic Ottoman raids.</span>
              </button>
            </div>
            <div class="world-setup-pressure" data-pressure-controls hidden>
              <label class="world-setup-slider-label" for="world-setup-pressure">
                <span>Enemy pressure</span>
                <strong data-pressure-value>50</strong>
              </label>
              <input id="world-setup-pressure" class="world-setup-slider" type="range" min="10" max="100" step="5" value="50" />
              <p class="world-setup-slider-hint">Higher pressure brings earlier scouts and heavier losses at exposed holdings.</p>
            </div>
            </section>

            <section class="world-setup-section" aria-label="Severe weather">
              <h2 class="world-setup-section__title">Severe weather</h2>
              <button
                type="button"
                class="world-setup-hazard-option"
                data-severe-weather
                aria-pressed="false"
              >
                <span class="world-setup-hazard-option__marker" aria-hidden="true">⚡</span>
                <span class="world-setup-hazard-option__copy">
                  <strong>Enable severe weather events</strong>
                  <span>Adds droughts, lightning, and spreading fires.</span>
                </span>
                <span class="world-setup-hazard-option__state" data-severe-weather-state>Off · beginner friendly</span>
              </button>
              <p class="world-setup-slider-hint world-setup-hazard-hint">Normal rain and frost always apply. Raid arson requires Contested frontier.</p>
            </section>

            <section class="world-setup-section" aria-labelledby="world-setup-groundwater-title">
              <h2 class="world-setup-section__title" id="world-setup-groundwater-title">Groundwater</h2>
              <button
                type="button"
                class="world-setup-hazard-option world-setup-hazard-option--aquifer"
                data-aquifer-networks
                aria-pressed="false"
              >
                <span class="world-setup-hazard-option__marker" aria-hidden="true">≋</span>
                <span class="world-setup-hazard-option__copy">
                  <strong>Enable aquifer networks</strong>
                  <span>Well yield varies by location; the overlay reveals strong sites.</span>
                </span>
                <span class="world-setup-hazard-option__state" data-aquifer-networks-state>Off · even groundwater</span>
              </button>
              <p class="world-setup-slider-hint world-setup-hazard-hint">Off gives every well the same yield. Surface water is unchanged.</p>
            </section>

            <section class="world-setup-section world-setup-landscape" aria-label="Landscape">
              <div class="world-setup-section-heading">
                <h2 class="world-setup-section__title">Landscape</h2>
                <span>Seeded regional profiles</span>
              </div>
              <div class="world-setup-landscape-grid" data-landscape-grid></div>
              <p class="world-setup-landscape-note" data-landscape-note></p>
            </section>

            <div class="world-setup-custom-landscape" data-custom-landscape-controls hidden>
            <section class="world-setup-section" aria-label="Custom topography">
            <label class="world-setup-slider-label" for="world-setup-topography">
              <span>Topography</span>
              <strong data-topography-value>${this.draft.topography}</strong>
            </label>
            <input id="world-setup-topography" class="world-setup-slider" type="range" min="0" max="100" step="1" value="${this.draft.topography}" />
            <p class="world-setup-slider-hint">Low: rolling hills. Above 80: mountain-scale ridges.</p>
            </section>

            <section class="world-setup-section" aria-label="Custom hydrology">
            <label class="world-setup-slider-label" for="world-setup-hydrology">
              <span>Hydrology</span>
              <strong data-hydrology-value>${this.draft.hydrology}</strong>
            </label>
            <input id="world-setup-hydrology" class="world-setup-slider" type="range" min="0" max="100" step="1" value="${this.draft.hydrology}" />
            <p class="world-setup-slider-hint">Low: drier with fewer rivers. High: wetter with more waterways and stronger aquifers.</p>
            </section>

            <section class="world-setup-section" aria-label="Custom forest density">
            <label class="world-setup-slider-label" for="world-setup-forest">
              <span>Forest density</span>
              <strong data-forest-value>${this.draft.forestDensity}</strong>
            </label>
            <input id="world-setup-forest" class="world-setup-slider" type="range" min="0" max="100" step="1" value="${this.draft.forestDensity}" />
            <p class="world-setup-slider-hint">Low: open meadow. High: dense conifer forest.</p>
            </section>
            </div>

            <section class="world-setup-section world-setup-resources" aria-label="Regional resources">
            <h2 class="world-setup-section__title">Regional resources</h2>
            <label class="world-setup-slider-label" for="world-setup-resource-abundance">
              <span>Local abundance</span>
              <strong data-resource-abundance-value>${describeResourceAbundance(this.draft.resourceAbundance)} · ${this.draft.resourceAbundance}</strong>
            </label>
            <input id="world-setup-resource-abundance" class="world-setup-slider" type="range" min="0" max="100" step="5" value="${this.draft.resourceAbundance}" />
            <p class="world-setup-slider-hint">Size fixes nodes / rich / guaranteed food: Small 5 / 2 / 1+, Medium 20 / 8 / 4+, Large 40 / 16 / 8+. Abundance and seed can add wild food. Import missing materials through a Trading Post.</p>

            <label class="world-setup-slider-label world-setup-slider-label--secondary" for="world-setup-resource-variety">
              <span>Local variety</span>
              <strong data-resource-variety-value>${describeResourceVariety(this.draft.resourceVariety)} · ${this.draft.resourceVariety}</strong>
            </label>
            <input id="world-setup-resource-variety" class="world-setup-slider" type="range" min="0" max="100" step="5" value="${this.draft.resourceVariety}" />
            <p class="world-setup-slider-hint">Specialized repeats fewer resource families. Broad mix offers more types without changing node counts.</p>
            <div class="world-setup-resource-summary" data-resource-summary aria-live="polite">${this.resourceSummaryMarkup()}</div>
            </section>

          </div>

          <footer class="world-setup-actions">
            <div class="world-setup-footer-seed" data-map-seed-section>
              <label class="world-setup-footer-seed__label" for="world-setup-seed">
                <span>World seed</span>
                <small>Repeatable terrain</small>
              </label>
              <div class="world-setup-seed-row">
                <input id="world-setup-seed" class="world-setup-seed-input" type="text" inputmode="text" spellcheck="false" autocomplete="off" aria-label="World seed" data-seed-input value="${formatSeedHex(this.draft.seed)}" />
                <button type="button" class="world-setup-randomize" data-randomize-seed>Randomize map</button>
              </div>
            </div>
            <nav class="world-setup-actions__navigation" aria-label="Setup navigation">
              <button type="button" class="world-setup-back" data-setup-back>
                <i aria-hidden="true">‹</i> Back to Heraldry
              </button>
              <button type="submit" class="world-setup-start">
                Start world <i aria-hidden="true">›</i>
              </button>
            </nav>
          </footer>
        </form>
      </div>
    `;

    parent.appendChild(this.backdrop);
    this.renderTerrainPresetOptions();
    this.renderSizeOptions();
    this.bindEvents();
    this.backdrop.querySelector<HTMLElement>('[data-setup-heading]')!.focus();
  }

  static prompt(parent: HTMLElement, options: WorldSetupOptions = {}): Promise<WorldSetupResult> {
    return new Promise((resolve) => {
      new WorldSetupPanel(parent, resolve, options);
    });
  }

  private bindEvents(): void {
    const form = this.backdrop.querySelector<HTMLFormElement>('.world-setup-dialog')!;
    const topographySlider = this.backdrop.querySelector<HTMLInputElement>('#world-setup-topography')!;
    const hydrologySlider = this.backdrop.querySelector<HTMLInputElement>('#world-setup-hydrology')!;
    const forestSlider = this.backdrop.querySelector<HTMLInputElement>('#world-setup-forest')!;
    const resourceAbundanceSlider = this.backdrop.querySelector<HTMLInputElement>('#world-setup-resource-abundance')!;
    const resourceVarietySlider = this.backdrop.querySelector<HTMLInputElement>('#world-setup-resource-variety')!;
    const topographyValue = this.backdrop.querySelector<HTMLElement>('[data-topography-value]')!;
    const hydrologyValue = this.backdrop.querySelector<HTMLElement>('[data-hydrology-value]')!;
    const forestValue = this.backdrop.querySelector<HTMLElement>('[data-forest-value]')!;
    const resourceAbundanceValue = this.backdrop.querySelector<HTMLElement>('[data-resource-abundance-value]')!;
    const resourceVarietyValue = this.backdrop.querySelector<HTMLElement>('[data-resource-variety-value]')!;
    const seedInput = this.backdrop.querySelector<HTMLInputElement>('[data-seed-input]')!;
    const randomizeButton = this.backdrop.querySelector<HTMLButtonElement>('[data-randomize-seed]')!;
    const modeGrid = this.backdrop.querySelector<HTMLElement>('[data-mode-grid]')!;
    const pressureControls = this.backdrop.querySelector<HTMLElement>('[data-pressure-controls]')!;
    const pressureSlider = this.backdrop.querySelector<HTMLInputElement>('#world-setup-pressure')!;
    const pressureValue = this.backdrop.querySelector<HTMLElement>('[data-pressure-value]')!;
    const severeWeatherButton = this.backdrop.querySelector<HTMLButtonElement>('[data-severe-weather]')!;
    const severeWeatherState = this.backdrop.querySelector<HTMLElement>('[data-severe-weather-state]')!;
    const aquiferNetworksButton = this.backdrop.querySelector<HTMLButtonElement>('[data-aquifer-networks]')!;
    const aquiferNetworksState = this.backdrop.querySelector<HTMLElement>('[data-aquifer-networks-state]')!;
    const backButton = this.backdrop.querySelector<HTMLButtonElement>('[data-setup-back]')!;
    const landscapeGrid = this.backdrop.querySelector<HTMLElement>('[data-landscape-grid]')!;
    const landscapeNote = this.backdrop.querySelector<HTMLElement>('[data-landscape-note]')!;
    const customLandscapeControls = this.backdrop.querySelector<HTMLElement>('[data-custom-landscape-controls]')!;

    const syncLandscapeControls = (): void => {
      topographySlider.value = String(this.draft.topography);
      hydrologySlider.value = String(this.draft.hydrology);
      forestSlider.value = String(this.draft.forestDensity);
      topographyValue.textContent = topographySlider.value;
      hydrologyValue.textContent = hydrologySlider.value;
      forestValue.textContent = forestSlider.value;
      seedInput.value = formatSeedHex(this.draft.seed);
      customLandscapeControls.hidden = this.draft.terrainPreset !== 'custom';
      const selected = WORLD_TERRAIN_PRESETS.find((preset) => preset.id === this.draft.terrainPreset)!;
      landscapeNote.textContent = this.draft.terrainPreset === 'custom'
        ? 'Seeds vary custom terrain; high topography adds major mountains.'
        : `${selected.name} keeps this landform; seeds vary terrain and resources.`;
      for (const option of landscapeGrid.querySelectorAll<HTMLButtonElement>('[data-terrain-preset]')) {
        const isSelected = option.dataset.terrainPreset === this.draft.terrainPreset;
        option.classList.toggle('is-selected', isSelected);
        option.setAttribute('aria-pressed', String(isSelected));
      }
    };

    for (const button of landscapeGrid.querySelectorAll<HTMLButtonElement>('[data-terrain-preset]')) {
      button.addEventListener('click', () => {
        const preset = button.dataset.terrainPreset as WorldTerrainPreset;
        this.draft = applyTerrainPreset(this.draft, preset);
        syncLandscapeControls();
        this.renderResourceSummary();
      });
    }
    syncLandscapeControls();

    const syncConflictControls = (): void => {
      pressureSlider.value = String(Math.max(10, this.draft.enemyPressure));
      pressureValue.textContent = pressureSlider.value;
      pressureControls.hidden = this.draft.conflictMode !== 'frontier';
      for (const option of modeGrid.querySelectorAll<HTMLButtonElement>('[data-conflict-mode]')) {
        const selected = option.dataset.conflictMode === this.draft.conflictMode;
        option.classList.toggle('is-selected', selected);
        option.setAttribute('aria-pressed', String(selected));
      }
    };

    const syncHazardControls = (): void => {
      severeWeatherButton.classList.toggle('is-selected', this.draft.severeWeatherEnabled);
      severeWeatherButton.setAttribute('aria-pressed', String(this.draft.severeWeatherEnabled));
      severeWeatherState.textContent = this.draft.severeWeatherEnabled
        ? 'On · severe events'
        : 'Off · beginner friendly';
      aquiferNetworksButton.classList.toggle('is-selected', this.draft.wellAquiferNetworksEnabled);
      aquiferNetworksButton.setAttribute('aria-pressed', String(this.draft.wellAquiferNetworksEnabled));
      aquiferNetworksState.textContent = this.draft.wellAquiferNetworksEnabled
        ? 'On · placement matters'
        : 'Off · even groundwater';
    };

    for (const button of modeGrid.querySelectorAll<HTMLButtonElement>('[data-conflict-mode]')) {
      button.addEventListener('click', () => {
        this.draft.conflictMode = button.dataset.conflictMode === 'frontier' ? 'frontier' : 'peaceful';
        if (this.draft.conflictMode === 'frontier' && this.draft.enemyPressure <= 0) {
          this.draft.enemyPressure = 50;
        }
        syncConflictControls();
      });
    }
    pressureSlider.addEventListener('input', () => {
      this.draft.enemyPressure = Number(pressureSlider.value);
      pressureValue.textContent = pressureSlider.value;
    });
    severeWeatherButton.addEventListener('click', () => {
      this.draft.severeWeatherEnabled = !this.draft.severeWeatherEnabled;
      syncHazardControls();
    });
    aquiferNetworksButton.addEventListener('click', () => {
      this.draft.wellAquiferNetworksEnabled = !this.draft.wellAquiferNetworksEnabled;
      syncHazardControls();
    });
    syncConflictControls();
    syncHazardControls();

    topographySlider.addEventListener('input', () => {
      this.draft.topography = Number(topographySlider.value);
      topographyValue.textContent = String(this.draft.topography);
    });
    hydrologySlider.addEventListener('input', () => {
      this.draft.hydrology = Number(hydrologySlider.value);
      hydrologyValue.textContent = String(this.draft.hydrology);
      this.renderResourceSummary();
    });
    forestSlider.addEventListener('input', () => {
      this.draft.forestDensity = Number(forestSlider.value);
      forestValue.textContent = String(this.draft.forestDensity);
      this.renderResourceSummary();
    });
    resourceAbundanceSlider.addEventListener('input', () => {
      this.draft.resourceAbundance = Number(resourceAbundanceSlider.value);
      resourceAbundanceValue.textContent =
        `${describeResourceAbundance(this.draft.resourceAbundance)} · ${this.draft.resourceAbundance}`;
      this.renderResourceSummary();
    });
    resourceVarietySlider.addEventListener('input', () => {
      this.draft.resourceVariety = Number(resourceVarietySlider.value);
      resourceVarietyValue.textContent =
        `${describeResourceVariety(this.draft.resourceVariety)} · ${this.draft.resourceVariety}`;
      this.renderResourceSummary();
    });
    randomizeButton.addEventListener('click', () => {
      this.draft.seed = seedForTerrainPreset(randomWorldSeed(), this.draft.terrainPreset);
      seedInput.value = formatSeedHex(this.draft.seed);
      this.renderResourceSummary();
    });
    seedInput.addEventListener('change', () => {
      const parsed = parseSeedHex(seedInput.value);
      if (parsed === null) {
        seedInput.value = formatSeedHex(this.draft.seed);
        return;
      }
      this.draft.seed = seedForTerrainPreset(parsed, this.draft.terrainPreset);
      seedInput.value = formatSeedHex(this.draft.seed);
      this.renderResourceSummary();
    });

    const readSettings = (): WorldGenerationSettings => {
      const parsed = parseSeedHex(seedInput.value);
      if (parsed !== null) {
        this.draft.seed = seedForTerrainPreset(parsed, this.draft.terrainPreset);
      }
      return normalizeWorldGenerationSettings(this.draft);
    };

    backButton.addEventListener('click', () => {
      const settings = readSettings();
      this.backdrop.remove();
      this.resolve({ action: 'back', settings });
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const settings = readSettings();
      this.backdrop.remove();
      this.resolve({ action: 'start', settings });
    });
  }

  private renderTerrainPresetOptions(): void {
    const grid = this.backdrop.querySelector<HTMLElement>('[data-landscape-grid]')!;
    const displayPresets = [
      ...WORLD_TERRAIN_PRESETS.filter((preset) => preset.id === 'delnice_meadow'),
      ...WORLD_TERRAIN_PRESETS.filter((preset) => preset.id !== 'delnice_meadow'),
    ];
    grid.innerHTML = displayPresets.map((preset) => {
      const selected = preset.id === this.draft.terrainPreset ? ' is-selected' : '';
      const features = preset.features
        .map((feature) => `<span>${feature}</span>`)
        .join('');
      return `
        <button
          type="button"
          class="world-setup-landscape-option${selected}"
          data-terrain-preset="${preset.id}"
          aria-pressed="${preset.id === this.draft.terrainPreset}"
        >
          <span class="world-setup-landscape-option__heading">
            <strong>${preset.name}</strong>
            ${preset.region ? `<small>${preset.region}</small>` : ''}
          </span>
          <span class="world-setup-landscape-option__description">${preset.description}</span>
          <span class="world-setup-landscape-option__features">${features}</span>
        </button>
      `;
    }).join('');
  }

  private renderSizeOptions(): void {
    const grid = this.backdrop.querySelector<HTMLElement>('[data-size-grid]')!;
    grid.innerHTML = (Object.keys(MAP_SIZE_PRESETS) as WorldMapSize[]).map((size) => {
      const preset = MAP_SIZE_PRESETS[size];
      const selected = size === this.draft.mapSize ? ' is-selected' : '';
      const playableKm = (preset.playableSize / 1000).toFixed(1);
      return `
        <button
          type="button"
          class="world-setup-size-option${selected}"
          data-map-size="${size}"
          aria-pressed="${size === this.draft.mapSize}"
        >
          <strong>${preset.label}</strong>
          <span>${playableKm} km wide · ${preset.smallMapAreas}× small-map area</span>
        </button>
      `;
    }).join('');

    for (const button of grid.querySelectorAll<HTMLButtonElement>('[data-map-size]')) {
      button.addEventListener('click', () => {
        const size = button.dataset.mapSize as WorldMapSize;
        this.draft.mapSize = size;
        for (const option of grid.querySelectorAll<HTMLButtonElement>('[data-map-size]')) {
          const isSelected = option.dataset.mapSize === size;
          option.classList.toggle('is-selected', isSelected);
          option.setAttribute('aria-pressed', String(isSelected));
        }
        this.renderResourceSummary();
      });
    }
  }

  private renderResourceSummary(): void {
    const summary = this.backdrop.querySelector<HTMLElement>('[data-resource-summary]');
    if (summary) summary.innerHTML = this.resourceSummaryMarkup();
  }

  private resourceSummaryMarkup(): string {
    const plan = createRegionalResourcePlan(this.draft);
    const depositSurvey = createRegionalDepositSurvey(this.draft, plan);
    const kindLabels: Record<(typeof plan.presentForagingKinds)[number], string> = {
      game: 'game',
      berries: 'berries',
      mushrooms: 'mushrooms',
      fish: 'fish',
    };
    const wildResources = plan.presentForagingKinds
      .map((kind) => {
        const rich = plan.foragingRichNodeCounts[kind];
        return `${kindLabels[kind]} ×${plan.foragingNodeCounts[kind]}`
          + (rich > 0 ? ` (${rich} rich)` : '');
      })
      .join(', ');

    return `
      <div class="world-setup-resource-summary__heading">
        <strong>This seed's resource roll</strong>
        <span>${plan.totalResourceNodes} nodes · ${plan.richResourceNodeCount} rich · ${plan.totalForagingNodes} wild food (${plan.minimumFoodNodeCount}+ guaranteed)</span>
      </div>
      <div class="world-setup-deposit-grid">
        ${depositSurvey.map((entry) => this.depositCardMarkup(
          entry.resource,
          entry.ordinary,
          entry.rich,
        )).join('')}
      </div>
      <p class="world-setup-wild-summary"><strong>Wild food</strong> · ${wildResources}</p>
    `;
  }

  private depositCardMarkup(
    resource: RegionalDepositResource,
    ordinary: number,
    rich: number,
  ): string {
    const labels: Record<RegionalDepositResource, {
      name: string;
      extractor: string;
    }> = {
      stone: {
        name: 'Stone',
        extractor: 'Mining Camp / Quarry',
      },
      clay: {
        name: 'Clay',
        extractor: 'Mining Camp / Mineworks',
      },
      iron: {
        name: 'Iron',
        extractor: 'Mining Camp / Mineworks',
      },
      salt: {
        name: 'Salt',
        extractor: 'Mining Camp / Mineworks',
      },
    };
    const label = labels[resource];
    const total = ordinary + rich;
    if (total === 0) {
      return `
        <article class="world-setup-deposit-card" data-resource="${resource}">
          <div class="world-setup-deposit-card__title">
            <strong>${label.name}</strong>
            <span>${label.extractor}</span>
          </div>
          <div class="world-setup-deposit-card__grades">
            <span class="world-setup-deposit-grade world-setup-deposit-grade--none">Not present</span>
          </div>
          <p>Absent locally; import through trade.</p>
        </article>
      `;
    }
    const richMarkup = rich > 0
      ? `<span class="world-setup-deposit-grade world-setup-deposit-grade--rich">Rich ×${rich}</span>`
      : '<span class="world-setup-deposit-grade world-setup-deposit-grade--none">No rich roll</span>';
    const detail = rich > 0
      ? 'Rich sites unlock unlimited underground extraction.'
      : 'Finite surface extraction only.';

    return `
      <article class="world-setup-deposit-card" data-resource="${resource}">
        <div class="world-setup-deposit-card__title">
          <strong>${label.name}</strong>
          <span>${label.extractor}</span>
        </div>
        <div class="world-setup-deposit-card__grades">
          ${ordinary > 0 ? `<span class="world-setup-deposit-grade">Ordinary ×${ordinary}</span>` : ''}
          ${richMarkup}
        </div>
        <p>${detail}</p>
      </article>
    `;
  }
}
