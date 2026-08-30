import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  formatSeedHex,
  MAP_SIZE_PRESETS,
  normalizeWorldGenerationSettings,
  parseSeedHex,
  randomWorldSeed,
  type WorldDifficultyRate,
  type WorldGenerationSettings,
  type WorldMapSize,
  type WorldMilitaryDemands,
} from '../world/worldGenerationSettings.ts';
import {
  applyTerrainPreset,
  seedForTerrainPreset,
  WORLD_TERRAIN_PRESETS,
  type WorldTerrainPreset,
} from '../world/worldTerrainPresets.ts';
import {
  difficultyPresetForSettings,
  WORLD_DIFFICULTY_PRESET_ORDER,
  WORLD_DIFFICULTY_PRESETS,
} from '../world/worldDifficulty.ts';
export type WorldSetupResult = {
  action: 'back' | 'start';
  settings: WorldGenerationSettings;
};

export type WorldSetupOptions = {
  initialSettings?: WorldGenerationSettings;
};

const MAP_SIZE_ORDER: readonly WorldMapSize[] = ['small', 'medium', 'large'];
const CONFLICT_MODE_ORDER = ['peaceful', 'frontier'] as const;
const DIFFICULTY_RATE_ORDER: readonly WorldDifficultyRate[] = [0, 50, 100, 150];
const INITIAL_GOODS_ORDER = [1, 2] as const;
const MILITARY_DEMAND_ORDER: readonly WorldMilitaryDemands[] = [0, 1, 2, 3];
const BOOLEAN_ORDER = [false, true] as const;

function cycleValue<T>(values: readonly T[], current: T, step: number): T {
  const currentIndex = Math.max(0, values.indexOf(current));
  return values[(currentIndex + step + values.length) % values.length]!;
}

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
        { ...DEFAULT_WORLD_GENERATION_SETTINGS, mapSize: 'small' },
        'delnice_meadow',
      );
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'world-setup-backdrop';
    this.backdrop.dataset.activeSetupStep = 'map';
    this.backdrop.innerHTML = `
      <div class="world-setup-shell">
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
                <li class="is-complete" data-setup-progress="house"><span>1</span><strong>Legacy</strong></li>
                <li class="is-complete" data-setup-progress="heraldry"><span>2</span><strong>Heraldry</strong></li>
                <li data-setup-progress="map" data-setup-heading aria-current="step" tabindex="-1"><span>3</span><strong>Map Generation</strong></li>
              </ol>
            </nav>
          </header>
          <div class="world-setup-scroll" aria-label="World settings">
            <div class="world-setup-column world-setup-column--terrain" aria-label="Terrain settings">
            <section class="world-setup-section world-setup-map-size" aria-label="Map size">
              <h2 class="world-setup-section__title">Map size</h2>
              <div class="world-setup-arrow-select" data-world-selector="map-size">
                <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="-1" aria-label="Previous map size">‹</button>
                <div class="world-setup-arrow-select__value" aria-live="polite">
                  <strong data-map-size-value></strong>
                  <span data-map-size-description></span>
                </div>
                <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="1" aria-label="Next map size">›</button>
              </div>
            </section>

            <section class="world-setup-section world-setup-landscape" aria-label="Landscape">
              <div class="world-setup-section-heading">
                <h2 class="world-setup-section__title">Landscape</h2>
                <span>Seeded regional profiles</span>
              </div>
              <div class="world-setup-landscape-grid" data-landscape-grid></div>
            </section>

            <div class="world-setup-custom-landscape" data-custom-landscape-controls hidden>
            <section class="world-setup-section" aria-label="Custom topography">
            <label class="world-setup-slider-label" for="world-setup-topography">
              <span>Topography</span>
              <strong data-topography-value>${this.draft.topography}</strong>
            </label>
            <input id="world-setup-topography" class="world-setup-slider" type="range" min="0" max="100" step="1" value="${this.draft.topography}" />
            <p class="world-setup-slider-hint">Higher values create larger, steeper ridges.</p>
            </section>

            <section class="world-setup-section" aria-label="Custom hydrology">
            <label class="world-setup-slider-label" for="world-setup-hydrology">
              <span>Hydrology</span>
              <strong data-hydrology-value>${this.draft.hydrology}</strong>
            </label>
            <input id="world-setup-hydrology" class="world-setup-slider" type="range" min="0" max="100" step="1" value="${this.draft.hydrology}" />
            <p class="world-setup-slider-hint">Higher values add rivers and stronger aquifers.</p>
            </section>

            <section class="world-setup-section" aria-label="Custom forest density">
            <label class="world-setup-slider-label" for="world-setup-forest">
              <span>Forest density</span>
              <strong data-forest-value>${this.draft.forestDensity}</strong>
            </label>
            <input id="world-setup-forest" class="world-setup-slider" type="range" min="0" max="100" step="1" value="${this.draft.forestDensity}" />
            <p class="world-setup-slider-hint">Higher values create denser woodland.</p>
            </section>
            </div>
            </div>

            <div class="world-setup-column world-setup-column--rules" aria-label="Gameplay settings">
            <section class="world-setup-section world-setup-game-rules" aria-label="Gameplay rules">
              <div class="world-setup-section-heading">
                <h2 class="world-setup-section__title">Gameplay rules</h2>
                <span>Optional difficulty</span>
              </div>
              <div class="world-setup-difficulty-preset">
                <span class="world-setup-difficulty-preset__label">Rule preset</span>
                <div class="world-setup-arrow-select" data-world-selector="difficulty-preset">
                  <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="-1" aria-label="Previous difficulty preset">‹</button>
                  <div class="world-setup-arrow-select__value" aria-live="polite">
                    <strong data-difficulty-preset-value></strong><span data-difficulty-preset-description></span>
                  </div>
                  <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="1" aria-label="Next difficulty preset">›</button>
                </div>
              </div>
              <div class="world-setup-setting-list">
                <div class="world-setup-setting-row">
                  <span class="world-setup-setting-row__icon" data-rule-icon="settlement" role="img" aria-label="Settlement mode"></span>
                  <div class="world-setup-arrow-select" data-world-selector="settlement-mode">
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="-1" aria-label="Previous settlement mode">‹</button>
                    <div class="world-setup-arrow-select__value" aria-live="polite">
                      <strong data-conflict-mode-value></strong><span data-conflict-mode-description></span>
                    </div>
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="1" aria-label="Next settlement mode">›</button>
                  </div>
                </div>
                <div class="world-setup-pressure" data-pressure-controls hidden>
                  <label class="world-setup-slider-label" for="world-setup-pressure"><span>Enemy pressure</span><strong data-pressure-value>50</strong></label>
                  <input id="world-setup-pressure" class="world-setup-slider" type="range" min="10" max="100" step="5" value="50" />
                  <p class="world-setup-slider-hint">Higher pressure means earlier, stronger raids.</p>
                </div>
                <div class="world-setup-setting-row">
                  <span class="world-setup-setting-row__icon" data-rule-icon="bandits" role="img" aria-label="Bandit presence"></span>
                  <div class="world-setup-arrow-select" data-world-selector="bandit-camps">
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="-1" aria-label="Previous bandit camp setting">‹</button>
                    <div class="world-setup-arrow-select__value" aria-live="polite">
                      <strong data-bandit-camps-value></strong><span data-bandit-camps-description></span>
                    </div>
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="1" aria-label="Next bandit camp setting">›</button>
                  </div>
                </div>
                <div class="world-setup-setting-row">
                  <span class="world-setup-setting-row__icon" data-rule-icon="military-demands" role="img" aria-label="Military demands"></span>
                  <div class="world-setup-arrow-select" data-world-selector="military-demands">
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="-1" aria-label="Lower military demands">‹</button>
                    <div class="world-setup-arrow-select__value" aria-live="polite">
                      <strong data-military-demands-value></strong><span data-military-demands-description></span>
                    </div>
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="1" aria-label="Higher military demands">›</button>
                  </div>
                </div>
                <div class="world-setup-setting-row">
                  <span class="world-setup-setting-row__icon" data-rule-icon="approval" role="img" aria-label="Approval decline"></span>
                  <div class="world-setup-arrow-select" data-world-selector="approval-decline">
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="-1" aria-label="Lower approval decline">‹</button>
                    <div class="world-setup-arrow-select__value" aria-live="polite">
                      <strong data-approval-decline-value></strong><span data-approval-decline-description></span>
                    </div>
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="1" aria-label="Higher approval decline">›</button>
                  </div>
                </div>
                <div class="world-setup-setting-row">
                  <span class="world-setup-setting-row__icon" data-rule-icon="food" role="img" aria-label="Food spoilage"></span>
                  <div class="world-setup-arrow-select" data-world-selector="food-spoilage">
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="-1" aria-label="Lower food spoilage">‹</button>
                    <div class="world-setup-arrow-select__value" aria-live="polite">
                      <strong data-food-spoilage-value></strong><span data-food-spoilage-description></span>
                    </div>
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="1" aria-label="Higher food spoilage">›</button>
                  </div>
                </div>
                <div class="world-setup-setting-row">
                  <span class="world-setup-setting-row__icon" data-rule-icon="supplies" role="img" aria-label="First camp supplies"></span>
                  <div class="world-setup-arrow-select" data-world-selector="initial-goods">
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="-1" aria-label="Fewer first camp supplies">‹</button>
                    <div class="world-setup-arrow-select__value" aria-live="polite">
                      <strong data-initial-goods-value></strong><span data-initial-goods-description></span>
                    </div>
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="1" aria-label="More first camp supplies">›</button>
                  </div>
                </div>
                <div class="world-setup-setting-row">
                  <span class="world-setup-setting-row__icon" data-rule-icon="weather" role="img" aria-label="Severe weather"></span>
                  <div class="world-setup-arrow-select" data-world-selector="severe-weather">
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="-1" aria-label="Previous severe weather setting">‹</button>
                    <div class="world-setup-arrow-select__value" aria-live="polite">
                      <strong data-severe-weather-value></strong><span data-severe-weather-description></span>
                    </div>
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="1" aria-label="Next severe weather setting">›</button>
                  </div>
                </div>
                <div class="world-setup-setting-row">
                  <span class="world-setup-setting-row__icon" data-rule-icon="groundwater" role="img" aria-label="Groundwater"></span>
                  <div class="world-setup-arrow-select" data-world-selector="groundwater">
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="-1" aria-label="Previous groundwater setting">‹</button>
                    <div class="world-setup-arrow-select__value" aria-live="polite">
                      <strong data-aquifer-networks-value></strong><span data-aquifer-networks-description></span>
                    </div>
                    <button type="button" class="world-setup-arrow-select__arrow" data-selector-step="1" aria-label="Next groundwater setting">›</button>
                  </div>
                </div>
              </div>
            </section>
            </div>

          </div>

          <footer class="world-setup-actions">
            <div class="world-setup-footer-seed" data-map-seed-section>
              <label class="world-setup-footer-seed__label" for="world-setup-seed">
                <span>World seed</span>
                <small>Repeatable terrain</small>
              </label>
              <div class="world-setup-seed-row">
                <input id="world-setup-seed" class="world-setup-seed-input" type="text" inputmode="text" spellcheck="false" autocomplete="off" aria-label="World seed" data-seed-input value="${formatSeedHex(this.draft.seed)}" />
                <button type="button" class="world-setup-randomize" data-randomize-seed>Randomize seed</button>
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
    const topographyValue = this.backdrop.querySelector<HTMLElement>('[data-topography-value]')!;
    const hydrologyValue = this.backdrop.querySelector<HTMLElement>('[data-hydrology-value]')!;
    const forestValue = this.backdrop.querySelector<HTMLElement>('[data-forest-value]')!;
    const seedInput = this.backdrop.querySelector<HTMLInputElement>('[data-seed-input]')!;
    const randomizeButton = this.backdrop.querySelector<HTMLButtonElement>('[data-randomize-seed]')!;
    const mapSizeSelector = this.backdrop.querySelector<HTMLElement>('[data-world-selector="map-size"]')!;
    const mapSizeValue = this.backdrop.querySelector<HTMLElement>('[data-map-size-value]')!;
    const mapSizeDescription = this.backdrop.querySelector<HTMLElement>('[data-map-size-description]')!;
    const difficultyPresetSelector = this.backdrop.querySelector<HTMLElement>('[data-world-selector="difficulty-preset"]')!;
    const difficultyPresetValue = this.backdrop.querySelector<HTMLElement>('[data-difficulty-preset-value]')!;
    const difficultyPresetDescription = this.backdrop.querySelector<HTMLElement>('[data-difficulty-preset-description]')!;
    const conflictModeSelector = this.backdrop.querySelector<HTMLElement>('[data-world-selector="settlement-mode"]')!;
    const conflictModeIcon = this.backdrop.querySelector<HTMLElement>('[data-rule-icon="settlement"]')!;
    const conflictModeValue = this.backdrop.querySelector<HTMLElement>('[data-conflict-mode-value]')!;
    const conflictModeDescription = this.backdrop.querySelector<HTMLElement>('[data-conflict-mode-description]')!;
    const pressureControls = this.backdrop.querySelector<HTMLElement>('[data-pressure-controls]')!;
    const pressureSlider = this.backdrop.querySelector<HTMLInputElement>('#world-setup-pressure')!;
    const pressureValue = this.backdrop.querySelector<HTMLElement>('[data-pressure-value]')!;
    const banditCampsSelector = this.backdrop.querySelector<HTMLElement>('[data-world-selector="bandit-camps"]')!;
    const banditCampsIcon = this.backdrop.querySelector<HTMLElement>('[data-rule-icon="bandits"]')!;
    const banditCampsValue = this.backdrop.querySelector<HTMLElement>('[data-bandit-camps-value]')!;
    const banditCampsDescription = this.backdrop.querySelector<HTMLElement>('[data-bandit-camps-description]')!;
    const militaryDemandsSelector = this.backdrop.querySelector<HTMLElement>('[data-world-selector="military-demands"]')!;
    const militaryDemandsIcon = this.backdrop.querySelector<HTMLElement>('[data-rule-icon="military-demands"]')!;
    const militaryDemandsValue = this.backdrop.querySelector<HTMLElement>('[data-military-demands-value]')!;
    const militaryDemandsDescription = this.backdrop.querySelector<HTMLElement>('[data-military-demands-description]')!;
    const approvalDeclineSelector = this.backdrop.querySelector<HTMLElement>('[data-world-selector="approval-decline"]')!;
    const approvalDeclineIcon = this.backdrop.querySelector<HTMLElement>('[data-rule-icon="approval"]')!;
    const approvalDeclineValue = this.backdrop.querySelector<HTMLElement>('[data-approval-decline-value]')!;
    const approvalDeclineDescription = this.backdrop.querySelector<HTMLElement>('[data-approval-decline-description]')!;
    const foodSpoilageSelector = this.backdrop.querySelector<HTMLElement>('[data-world-selector="food-spoilage"]')!;
    const foodSpoilageIcon = this.backdrop.querySelector<HTMLElement>('[data-rule-icon="food"]')!;
    const foodSpoilageValue = this.backdrop.querySelector<HTMLElement>('[data-food-spoilage-value]')!;
    const foodSpoilageDescription = this.backdrop.querySelector<HTMLElement>('[data-food-spoilage-description]')!;
    const initialGoodsSelector = this.backdrop.querySelector<HTMLElement>('[data-world-selector="initial-goods"]')!;
    const initialGoodsIcon = this.backdrop.querySelector<HTMLElement>('[data-rule-icon="supplies"]')!;
    const initialGoodsValue = this.backdrop.querySelector<HTMLElement>('[data-initial-goods-value]')!;
    const initialGoodsDescription = this.backdrop.querySelector<HTMLElement>('[data-initial-goods-description]')!;
    const severeWeatherSelector = this.backdrop.querySelector<HTMLElement>('[data-world-selector="severe-weather"]')!;
    const severeWeatherIcon = this.backdrop.querySelector<HTMLElement>('[data-rule-icon="weather"]')!;
    const severeWeatherValue = this.backdrop.querySelector<HTMLElement>('[data-severe-weather-value]')!;
    const severeWeatherDescription = this.backdrop.querySelector<HTMLElement>('[data-severe-weather-description]')!;
    const aquiferNetworksSelector = this.backdrop.querySelector<HTMLElement>('[data-world-selector="groundwater"]')!;
    const aquiferNetworksIcon = this.backdrop.querySelector<HTMLElement>('[data-rule-icon="groundwater"]')!;
    const aquiferNetworksValue = this.backdrop.querySelector<HTMLElement>('[data-aquifer-networks-value]')!;
    const aquiferNetworksDescription = this.backdrop.querySelector<HTMLElement>('[data-aquifer-networks-description]')!;
    const backButton = this.backdrop.querySelector<HTMLButtonElement>('[data-setup-back]')!;
    const landscapeGrid = this.backdrop.querySelector<HTMLElement>('[data-landscape-grid]')!;
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
      });
    }
    syncLandscapeControls();

    const syncMapSizeControl = (): void => {
      const preset = MAP_SIZE_PRESETS[this.draft.mapSize];
      const playableKm = (preset.playableSize / 1000).toFixed(1);
      mapSizeValue.textContent = preset.label;
      mapSizeValue.dataset.value = this.draft.mapSize;
      mapSizeDescription.textContent = `${playableKm} km wide · ${preset.smallMapAreas}× small-map area`;
    };

    const syncConflictControls = (): void => {
      pressureSlider.value = String(Math.max(10, this.draft.enemyPressure));
      pressureValue.textContent = pressureSlider.value;
      pressureControls.hidden = this.draft.conflictMode !== 'frontier';
      conflictModeIcon.dataset.state = this.draft.conflictMode;
      conflictModeValue.dataset.value = this.draft.conflictMode;
      conflictModeValue.textContent = this.draft.conflictMode === 'frontier'
        ? 'Contested frontier'
        : 'Peaceful settlement';
      conflictModeDescription.textContent = this.draft.conflictMode === 'frontier'
        ? 'Periodic Ottoman raids; bandits use their own rule.'
        : 'No Ottoman raids; bandits use their own rule.';
      banditCampsIcon.dataset.state = this.draft.banditCampsEnabled ? 'on' : 'off';
      banditCampsValue.dataset.value = this.draft.banditCampsEnabled ? 'on' : 'off';
      banditCampsValue.textContent = this.draft.banditCampsEnabled ? 'Roaming bandits' : 'None';
      banditCampsDescription.textContent = this.draft.banditCampsEnabled
        ? 'Independent camps steal stored goods; they never damage buildings.'
        : 'No bandit camps or thefts.';
    };

    const syncHazardControls = (): void => {
      severeWeatherIcon.dataset.state = this.draft.severeWeatherEnabled ? 'on' : 'off';
      severeWeatherValue.dataset.value = this.draft.severeWeatherEnabled ? 'on' : 'off';
      severeWeatherValue.textContent = this.draft.severeWeatherEnabled ? 'On' : 'Off';
      severeWeatherDescription.textContent = this.draft.severeWeatherEnabled
        ? 'Droughts, lightning, and fire.'
        : 'Normal rain and frost only.';
      aquiferNetworksIcon.dataset.state = this.draft.wellAquiferNetworksEnabled ? 'aquifers' : 'even';
      aquiferNetworksValue.dataset.value = this.draft.wellAquiferNetworksEnabled ? 'aquifers' : 'even';
      aquiferNetworksValue.textContent = this.draft.wellAquiferNetworksEnabled ? 'Aquifers' : 'Even';
      aquiferNetworksDescription.textContent = this.draft.wellAquiferNetworksEnabled
        ? 'Well yield varies by location.'
        : 'Every well has reliable yield.';
    };

    const syncRuleControls = (): void => {
      const approvalCopy: Record<WorldDifficultyRate, readonly [string, string]> = {
        0: ['Disabled', 'No passive approval loss.'],
        50: ['Relaxed', 'Approval falls 50% slower.'],
        100: ['Normal', 'Standard approval decline.'],
        150: ['Demanding', 'Approval falls 50% faster.'],
      };
      const foodCopy: Record<WorldDifficultyRate, readonly [string, string]> = {
        0: ['None', 'Food never spoils.'],
        50: ['Reduced', 'Food spoils 50% slower.'],
        100: ['Normal', 'Standard seasonal spoilage.'],
        150: ['Harsh', 'Food spoils 50% faster.'],
      };
      const militaryCopy: Record<WorldMilitaryDemands, readonly [string, string]> = {
        0: ['Muster only', 'Equipment and available resident men only.'],
        1: ['Light rations', 'One preserved ration per soldier for three field days.'],
        2: ['Full upkeep', 'Two rations per soldier, shared ale, and wages.'],
        3: ['Campaign burden', 'Two rations and one ale per soldier, plus wages.'],
      };
      const approval = approvalCopy[this.draft.approvalDeclineRate];
      approvalDeclineIcon.dataset.state = String(this.draft.approvalDeclineRate);
      approvalDeclineValue.dataset.value = String(this.draft.approvalDeclineRate);
      approvalDeclineValue.textContent = approval[0];
      approvalDeclineDescription.textContent = approval[1];
      const food = foodCopy[this.draft.foodSpoilageRate];
      foodSpoilageIcon.dataset.state = String(this.draft.foodSpoilageRate);
      foodSpoilageValue.dataset.value = String(this.draft.foodSpoilageRate);
      foodSpoilageValue.textContent = food[0];
      foodSpoilageDescription.textContent = food[1];
      initialGoodsIcon.dataset.state = String(this.draft.initialGoodsMultiplier);
      initialGoodsValue.dataset.value = String(this.draft.initialGoodsMultiplier);
      initialGoodsValue.textContent = this.draft.initialGoodsMultiplier === 2 ? 'Double' : 'Normal';
      initialGoodsDescription.textContent = this.draft.initialGoodsMultiplier === 2
        ? 'Twice the goods in the original camp.'
        : 'Standard starting stock.';
      const military = militaryCopy[this.draft.militaryDemands];
      militaryDemandsIcon.dataset.state = String(this.draft.militaryDemands);
      militaryDemandsValue.dataset.value = String(this.draft.militaryDemands);
      militaryDemandsValue.textContent = military[0];
      militaryDemandsDescription.textContent = military[1];
    };

    const syncDifficultyPresetControl = (): void => {
      const preset = difficultyPresetForSettings(this.draft);
      difficultyPresetValue.dataset.value = preset?.id ?? 'custom';
      difficultyPresetValue.textContent = preset?.name ?? 'Custom';
      difficultyPresetDescription.textContent = preset?.description ?? 'Individual rules adjusted.';
    };

    const syncGameplayControls = (): void => {
      syncConflictControls();
      syncHazardControls();
      syncRuleControls();
      syncDifficultyPresetControl();
    };

    const bindArrowSelector = (
      selector: HTMLElement,
      onStep: (step: number) => void,
    ): void => {
      for (const button of selector.querySelectorAll<HTMLButtonElement>('[data-selector-step]')) {
        button.addEventListener('click', () => onStep(Number(button.dataset.selectorStep)));
      }
    };

    bindArrowSelector(mapSizeSelector, (step) => {
      this.draft.mapSize = cycleValue(MAP_SIZE_ORDER, this.draft.mapSize, step);
      syncMapSizeControl();
    });
    bindArrowSelector(difficultyPresetSelector, (step) => {
      const currentPreset = difficultyPresetForSettings(this.draft)?.id ?? 'normal';
      const nextPresetId = cycleValue(WORLD_DIFFICULTY_PRESET_ORDER, currentPreset, step);
      const nextPreset = WORLD_DIFFICULTY_PRESETS.find((preset) => preset.id === nextPresetId)!;
      Object.assign(this.draft, nextPreset.settings);
      syncGameplayControls();
    });
    bindArrowSelector(conflictModeSelector, (step) => {
      this.draft.conflictMode = cycleValue(CONFLICT_MODE_ORDER, this.draft.conflictMode, step);
      if (this.draft.conflictMode === 'frontier' && this.draft.enemyPressure <= 0) {
        this.draft.enemyPressure = 50;
      }
      syncGameplayControls();
    });
    bindArrowSelector(banditCampsSelector, (step) => {
      this.draft.banditCampsEnabled = cycleValue(BOOLEAN_ORDER, this.draft.banditCampsEnabled, step);
      syncGameplayControls();
    });
    bindArrowSelector(militaryDemandsSelector, (step) => {
      this.draft.militaryDemands = cycleValue(
        MILITARY_DEMAND_ORDER,
        this.draft.militaryDemands,
        step,
      );
      syncGameplayControls();
    });
    pressureSlider.addEventListener('input', () => {
      this.draft.enemyPressure = Number(pressureSlider.value);
      pressureValue.textContent = pressureSlider.value;
      syncDifficultyPresetControl();
    });
    bindArrowSelector(severeWeatherSelector, (step) => {
      this.draft.severeWeatherEnabled = cycleValue(BOOLEAN_ORDER, this.draft.severeWeatherEnabled, step);
      syncGameplayControls();
    });
    bindArrowSelector(aquiferNetworksSelector, (step) => {
      this.draft.wellAquiferNetworksEnabled = cycleValue(BOOLEAN_ORDER, this.draft.wellAquiferNetworksEnabled, step);
      syncGameplayControls();
    });
    bindArrowSelector(approvalDeclineSelector, (step) => {
      this.draft.approvalDeclineRate = cycleValue(
        DIFFICULTY_RATE_ORDER,
        this.draft.approvalDeclineRate,
        step,
      );
      syncGameplayControls();
    });
    bindArrowSelector(foodSpoilageSelector, (step) => {
      this.draft.foodSpoilageRate = cycleValue(
        DIFFICULTY_RATE_ORDER,
        this.draft.foodSpoilageRate,
        step,
      );
      syncGameplayControls();
    });
    bindArrowSelector(initialGoodsSelector, (step) => {
      this.draft.initialGoodsMultiplier = cycleValue(
        INITIAL_GOODS_ORDER,
        this.draft.initialGoodsMultiplier,
        step,
      );
      syncGameplayControls();
    });
    syncMapSizeControl();
    syncGameplayControls();

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
      this.draft.seed = seedForTerrainPreset(randomWorldSeed(), this.draft.terrainPreset);
      seedInput.value = formatSeedHex(this.draft.seed);
    });
    seedInput.addEventListener('change', () => {
      const parsed = parseSeedHex(seedInput.value);
      if (parsed === null) {
        seedInput.value = formatSeedHex(this.draft.seed);
        return;
      }
      this.draft.seed = seedForTerrainPreset(parsed, this.draft.terrainPreset);
      seedInput.value = formatSeedHex(this.draft.seed);
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

}
