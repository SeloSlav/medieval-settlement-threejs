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

export class WorldSetupPanel {
  private readonly backdrop: HTMLElement;
  private readonly resolve: (settings: WorldGenerationSettings) => void;
  private draft: WorldGenerationSettings = applyTerrainPreset(
    { ...DEFAULT_WORLD_GENERATION_SETTINGS },
    'delnice_meadow',
  );

  private constructor(parent: HTMLElement, resolve: (settings: WorldGenerationSettings) => void) {
    this.resolve = resolve;
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'world-setup-backdrop';
    this.backdrop.innerHTML = `
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
        <form class="world-setup-dialog" aria-label="World setup">
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
                <span>Construction, survival, trade, and optimization without hostile raids.</span>
              </button>
              <button type="button" class="world-setup-mode-option" data-conflict-mode="frontier">
                <strong>Contested frontier</strong>
                <span>Build an economy that can support watchmen and withstand periodic Ottoman raiding parties.</span>
              </button>
            </div>
            <div class="world-setup-pressure" data-pressure-controls hidden>
              <label class="world-setup-slider-label" for="world-setup-pressure">
                <span>Enemy pressure</span>
                <strong data-pressure-value>50</strong>
              </label>
              <input id="world-setup-pressure" class="world-setup-slider" type="range" min="10" max="100" step="5" value="50" />
              <p class="world-setup-slider-hint">Higher pressure brings scouts sooner and increases portable-goods losses at exposed holdings.</p>
            </div>
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
            <p class="world-setup-slider-hint">Low = gentle rolling hills. Above 80 creates mountain-scale ridges hundreds of metres high.</p>
            </section>

            <section class="world-setup-section" aria-label="Custom hydrology">
            <label class="world-setup-slider-label" for="world-setup-hydrology">
              <span>Hydrology</span>
              <strong data-hydrology-value>${this.draft.hydrology}</strong>
            </label>
            <input id="world-setup-hydrology" class="world-setup-slider" type="range" min="0" max="100" step="1" value="${this.draft.hydrology}" />
            <p class="world-setup-slider-hint">Low = drier land with fewer rivers. High = wetter valleys and more waterways.</p>
            </section>

            <section class="world-setup-section" aria-label="Custom forest density">
            <label class="world-setup-slider-label" for="world-setup-forest">
              <span>Forest density</span>
              <strong data-forest-value>${this.draft.forestDensity}</strong>
            </label>
            <input id="world-setup-forest" class="world-setup-slider" type="range" min="0" max="100" step="1" value="${this.draft.forestDensity}" />
            <p class="world-setup-slider-hint">Low = open meadows and scattered woodland. High = dense conifer cover.</p>
            </section>
            </div>

            <section class="world-setup-section world-setup-resources" aria-label="Regional resources">
            <h2 class="world-setup-section__title">Regional resources</h2>
            <label class="world-setup-slider-label" for="world-setup-resource-abundance">
              <span>Local abundance</span>
              <strong data-resource-abundance-value>${describeResourceAbundance(this.draft.resourceAbundance)} · ${this.draft.resourceAbundance}</strong>
            </label>
            <input id="world-setup-resource-abundance" class="world-setup-slider" type="range" min="0" max="100" step="5" value="${this.draft.resourceAbundance}" />
            <p class="world-setup-slider-hint">Map size fixes the complete resource roll: small has 5 nodes with 2 rich, medium has 20 with 8 rich, and large has 40 with 16 rich. Every roll guarantees at least 1, 4, or 8 food nodes from game, berries, or mushrooms; abundance and seed can roll additional wild-food sites. Rich grades roll separately across every node, so wild food can also be rich. Clay follows river or coastal sediment where water exists; waterless maps use leaner inland lenses. Missing local materials can be imported through a staffed Trading Post.</p>

            <label class="world-setup-slider-label world-setup-slider-label--secondary" for="world-setup-resource-variety">
              <span>Local variety</span>
              <strong data-resource-variety-value>${describeResourceVariety(this.draft.resourceVariety)} · ${this.draft.resourceVariety}</strong>
            </label>
            <input id="world-setup-resource-variety" class="world-setup-slider" type="range" min="0" max="100" step="5" value="${this.draft.resourceVariety}" />
            <p class="world-setup-slider-hint">Specialized regions concentrate repeated rolls into fewer food and mineral families. Broad regions expose a wider mix while keeping the same size-based total and rich-node counts.</p>
            <div class="world-setup-resource-summary" data-resource-summary aria-live="polite">${this.resourceSummaryMarkup()}</div>
            </section>

          </div>

          <div class="world-setup-actions">
            <div class="world-setup-footer-seed">
              <label class="world-setup-footer-seed__label" for="world-setup-seed">World seed</label>
              <div class="world-setup-seed-row">
                <input id="world-setup-seed" class="world-setup-seed-input" type="text" inputmode="text" spellcheck="false" autocomplete="off" aria-label="World seed" data-seed-input value="${formatSeedHex(this.draft.seed)}" />
                <button type="button" class="world-setup-randomize" data-randomize-seed>Randomize</button>
              </div>
            </div>
            <button type="submit" class="world-setup-start">Start world</button>
          </div>
        </form>
      </div>
    `;

    parent.appendChild(this.backdrop);
    this.renderTerrainPresetOptions();
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
        ? 'Custom map seeds vary the procedural terrain; the highest topography settings add major mountain massifs.'
        : `${selected.name} seeds keep this landform and vary its bends, ridges, forests, and resources.`;
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

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const parsed = parseSeedHex(seedInput.value);
      if (parsed !== null) {
        this.draft.seed = seedForTerrainPreset(parsed, this.draft.terrainPreset);
      }
      const settings = normalizeWorldGenerationSettings(this.draft);
      this.backdrop.remove();
      this.resolve(settings);
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
        <button type="button" class="world-setup-size-option${selected}" data-map-size="${size}">
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
          option.classList.toggle('is-selected', option.dataset.mapSize === size);
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
      ordinaryDetail: string;
      richDetail: string;
    }> = {
      stone: {
        name: 'Stone',
        extractor: 'Mining Pit / Quarry',
        ordinaryDetail: 'finite surface deposit',
        richDetail: 'finite surface + unlimited underground',
      },
      clay: {
        name: 'Clay',
        extractor: 'Mining Pit / Quarry',
        ordinaryDetail: 'finite surface deposit',
        richDetail: 'finite surface + unlimited underground',
      },
      iron: {
        name: 'Iron',
        extractor: 'Mining Pit / Quarry',
        ordinaryDetail: 'finite surface deposit',
        richDetail: 'finite surface + unlimited underground',
      },
      salt: {
        name: 'Salt',
        extractor: 'Mining Pit / Quarry',
        ordinaryDetail: 'finite surface deposit',
        richDetail: 'finite surface + unlimited underground',
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
          <p>No local deposit in this roll; regional trade can supply it.</p>
        </article>
      `;
    }
    const richMarkup = rich > 0
      ? `<span class="world-setup-deposit-grade world-setup-deposit-grade--rich">Rich ×${rich}</span>`
      : '<span class="world-setup-deposit-grade world-setup-deposit-grade--none">No rich roll</span>';
    const detail = rich > 0
      ? `${label.ordinaryDetail}; ${label.richDetail}`
      : label.ordinaryDetail;

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
