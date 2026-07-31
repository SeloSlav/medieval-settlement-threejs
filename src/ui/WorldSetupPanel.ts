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
  createRegionalDepositSurvey,
  createRegionalResourcePlan,
  describeResourceAbundance,
  describeResourceVariety,
  type RegionalDepositResource,
} from '../world/regionalResourceDistribution.ts';

export class WorldSetupPanel {
  private readonly backdrop: HTMLElement;
  private readonly resolve: (settings: WorldGenerationSettings) => void;
  private draft: WorldGenerationSettings = { ...DEFAULT_WORLD_GENERATION_SETTINGS };

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

          <section class="world-setup-section world-setup-resources" aria-label="Regional resources">
            <h2 class="world-setup-section__title">Regional resources</h2>
            <label class="world-setup-slider-label" for="world-setup-resource-abundance">
              <span>Local abundance</span>
              <strong data-resource-abundance-value>${describeResourceAbundance(this.draft.resourceAbundance)} · ${this.draft.resourceAbundance}</strong>
            </label>
            <input id="world-setup-resource-abundance" class="world-setup-slider" type="range" min="0" max="100" step="5" value="${this.draft.resourceAbundance}" />
            <p class="world-setup-slider-hint">Stone, clay, iron, and salt are all physical local deposits. Every map has finite ordinary sources for all four. Rich stone and clay roll independently; iron and salt share up to one rich-mineral opportunity on small or medium maps and two on large maps, with the seed and local variety deciding which mineral receives them.</p>

            <label class="world-setup-slider-label world-setup-slider-label--secondary" for="world-setup-resource-variety">
              <span>Local variety</span>
              <strong data-resource-variety-value>${describeResourceVariety(this.draft.resourceVariety)} · ${this.draft.resourceVariety}</strong>
            </label>
            <input id="world-setup-resource-variety" class="world-setup-slider" type="range" min="0" max="100" step="5" value="${this.draft.resourceVariety}" />
            <p class="world-setup-slider-hint">Specialized regions concentrate extra deposits and rich mineral rolls into fewer resource families. Staffed marketplaces can import iron and Adriatic salt after local seams run short; trade supplements physical geology rather than replacing it.</p>
            <div class="world-setup-resource-summary" data-resource-summary aria-live="polite">${this.resourceSummaryMarkup()}</div>
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
      </div>
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
      this.draft.seed = randomWorldSeed();
      seedInput.value = formatSeedHex(this.draft.seed);
      this.renderResourceSummary();
    });
    seedInput.addEventListener('change', () => {
      const parsed = parseSeedHex(seedInput.value);
      if (parsed === null) {
        seedInput.value = formatSeedHex(this.draft.seed);
        return;
      }
      this.draft.seed = parsed;
      seedInput.value = formatSeedHex(parsed);
      this.renderResourceSummary();
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
      .map((kind) => `${kindLabels[kind]} ×${plan.foragingNodeCounts[kind]}`)
      .join(', ');

    return `
      <div class="world-setup-resource-summary__heading">
        <strong>This seed's physical deposits</strong>
        <span>All four have finite local sources</span>
      </div>
      <div class="world-setup-deposit-grid">
        ${depositSurvey.map((entry) => this.depositCardMarkup(
          entry.resource,
          entry.ordinary,
          entry.rich,
        )).join('')}
      </div>
      <p class="world-setup-wild-summary"><strong>Wild resources</strong> · ${wildResources}</p>
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
        extractor: 'Stonecutter / Large Quarry',
        ordinaryDetail: 'finite surface outcrop',
        richDetail: 'deep quarry source',
      },
      clay: {
        name: 'Clay',
        extractor: 'Clay Pit',
        ordinaryDetail: 'finite riverbank clay',
        richDetail: 'deep alluvial source',
      },
      iron: {
        name: 'Iron',
        extractor: 'Mine',
        ordinaryDetail: 'finite local seam',
        richDetail: 'deep supported workings',
      },
      salt: {
        name: 'Salt',
        extractor: 'Mine',
        ordinaryDetail: 'finite local deposit',
        richDetail: 'deep supported workings',
      },
    };
    const label = labels[resource];
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
          <span class="world-setup-deposit-grade">Ordinary ×${ordinary}</span>
          ${richMarkup}
        </div>
        <p>${detail}</p>
      </article>
    `;
  }
}
