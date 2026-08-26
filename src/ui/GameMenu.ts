import {
  areBuildingShadowsEnabled,
  areTreeShadowsEnabled,
  setBuildingShadowsEnabled,
  setTreeShadowsEnabled,
} from '../scene/shadowPreference.ts';
import {
  areConstellationGuidesEnabled,
  setConstellationGuidesEnabled,
} from '../scene/constellationPreference.ts';
import { GameControlsModal } from './GameControlsModal.ts';
import {
  getAmbienceVolume,
  getMusicVolume,
  getSoundEffectsVolume,
  isForestWindEnabled,
  isGameAudioEnabled,
  isMusicEnabled,
  setAmbienceVolume,
  setForestWindEnabled,
  setGameAudioEnabled,
  setMusicEnabled,
  setMusicVolume,
  setSoundEffectsVolume,
} from '../audio/audioPreferences.ts';
import {
  areResourceIconsAlwaysShown,
  setResourceIconsAlwaysShown,
} from '../map/resourceMapIconPreference.ts';
import {
  areDistantCanopyCardsEnabled,
  setDistantCanopyCardsEnabled,
} from '../scene/distantCanopyCardPreference.ts';
import {
  isPainterlyVegetationEnabled,
  setPainterlyVegetationEnabled,
} from '../scene/painterlyVegetationPreference.ts';
import {
  FIXED_SKY_PRESETS,
  fixedSkyPreset,
  getSkyPresentationPreference,
  isFixedSkyPreset,
  setDayNightCycleDisabled,
  setFixedSkyPreset,
} from '../scene/skyPresentationPreference.ts';

type GameMenuOptions = {
  onShadowPreferenceChange: () => void;
  onDistantCanopyCardsChange?: (enabled: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  onNewWorld?: () => void;
  onReplayTutorials?: () => void;
  onGrantCheatResources?: (amount: number) => Promise<void>;
  onAudioEnabledChange?: (enabled: boolean) => void;
  onAmbienceVolumeChange?: (volume: number) => void;
  onForestWindEnabledChange?: (enabled: boolean) => void;
  onSoundEffectsVolumeChange?: (volume: number) => void;
  onMusicEnabledChange?: (enabled: boolean) => void;
  onMusicVolumeChange?: (volume: number) => void;
  showButton?: boolean;
  /** When false, Escape will not open the menu while another modal/tool owns it. */
  canOpenFromKeyboard?: () => boolean;
};

export class GameMenu {
  private readonly backdrop: HTMLElement;
  private readonly dialog: HTMLElement;
  private readonly treeShadowsCheckbox: HTMLInputElement;
  private readonly buildingShadowsCheckbox: HTMLInputElement;
  private readonly distantCanopyCardsCheckbox: HTMLInputElement;
  private readonly painterlyVegetationCheckbox: HTMLInputElement;
  private readonly constellationGuidesCheckbox: HTMLInputElement;
  private readonly dayNightCycleCheckbox: HTMLInputElement;
  private readonly fixedSkyPresetSelect: HTMLSelectElement;
  private readonly fixedSkyDescription: HTMLElement;
  private readonly resourceIconsCheckbox: HTMLInputElement;
  private readonly gameAudioCheckbox: HTMLInputElement;
  private readonly ambienceVolumeInput: HTMLInputElement;
  private readonly ambienceVolumeValue: HTMLOutputElement;
  private readonly forestWindCheckbox: HTMLInputElement;
  private readonly soundEffectsVolumeInput: HTMLInputElement;
  private readonly soundEffectsVolumeValue: HTMLOutputElement;
  private readonly musicCheckbox: HTMLInputElement;
  private readonly musicVolumeInput: HTMLInputElement;
  private readonly musicVolumeValue: HTMLOutputElement;
  private readonly cheatAmountInput: HTMLInputElement;
  private readonly cheatGrantButton: HTMLButtonElement;
  private readonly cheatStatus: HTMLElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly controlsModal: GameControlsModal;
  private open = false;
  private readonly onShadowPreferenceChange: () => void;
  private readonly onOpenChange?: (open: boolean) => void;
  private readonly onNewWorld?: () => void;
  private readonly canOpenFromKeyboard?: () => boolean;
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(parent: HTMLElement, options: GameMenuOptions) {
    this.onShadowPreferenceChange = options.onShadowPreferenceChange;
    this.onOpenChange = options.onOpenChange;
    this.onNewWorld = options.onNewWorld;
    this.canOpenFromKeyboard = options.canOpenFromKeyboard;

    this.menuButton = document.createElement('button');
    this.menuButton.type = 'button';
    this.menuButton.className = 'hud-menu-button';
    this.menuButton.setAttribute('aria-label', 'Open menu');
    this.menuButton.setAttribute('aria-haspopup', 'dialog');
    this.menuButton.setAttribute('aria-expanded', 'false');
    this.menuButton.innerHTML =
      '<span class="gk-icon gk-icon--construction gk-icon--settings" aria-hidden="true"></span>';

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'game-menu-backdrop';
    this.backdrop.hidden = true;
    this.backdrop.innerHTML = `
      <div class="game-menu-dialog" role="dialog" aria-modal="true" aria-labelledby="game-menu-title">
        <header class="game-menu-header">
          <div>
            <p class="game-menu-eyebrow">Game paused</p>
            <h2 id="game-menu-title" class="game-menu-title">Settings</h2>
          </div>
          <button type="button" class="game-menu-return" data-return-button>Return to game</button>
        </header>

        <div class="game-menu-settings" aria-label="Settings categories">
          <section class="game-menu-section" aria-labelledby="game-menu-visuals-title">
            <header class="game-menu-section__header">
              <h3 id="game-menu-visuals-title">Visuals</h3>
              <p>World detail and map readability</p>
            </header>
            <div class="game-menu-section__controls">
              <label class="game-menu-option">
                <input type="checkbox" data-tree-shadows-checkbox />
                <span>Tree shadows</span>
              </label>
              <label class="game-menu-option">
                <input type="checkbox" data-building-shadows-checkbox />
                <span>Building shadows</span>
              </label>
              <label class="game-menu-option">
                <input type="checkbox" data-distant-canopy-cards-checkbox />
                <span>Distant canopy cards</span>
              </label>
              <label class="game-menu-option">
                <input type="checkbox" data-painterly-vegetation-checkbox />
                <span>Painterly shader <small>(experimental)</small></span>
              </label>
              <label class="game-menu-option">
                <input type="checkbox" data-resource-icons-checkbox />
                <span>Always show resource icons</span>
              </label>
            </div>
          </section>

          <section class="game-menu-section" aria-labelledby="game-menu-sky-title">
            <header class="game-menu-section__header">
              <h3 id="game-menu-sky-title">Sky &amp; time</h3>
              <p>Celestial display and lighting</p>
            </header>
            <div class="game-menu-section__controls">
              <label class="game-menu-option">
                <input type="checkbox" data-constellation-guides-checkbox />
                <span>Constellation guides</span>
              </label>
              <label class="game-menu-option">
                <input type="checkbox" data-day-night-cycle-checkbox />
                <span>Turn off day/night cycle</span>
              </label>
              <label class="game-menu-select game-menu-option--nested">
                <span>Fixed sky</span>
                <select data-fixed-sky-preset aria-describedby="fixed-sky-description">
                  ${FIXED_SKY_PRESETS.map((preset) => (
                    `<option value="${preset.id}">${preset.label}</option>`
                  )).join('')}
                </select>
                <small id="fixed-sky-description" data-fixed-sky-description></small>
              </label>
            </div>
          </section>

          <section class="game-menu-section" aria-labelledby="game-menu-audio-title">
            <header class="game-menu-section__header">
              <h3 id="game-menu-audio-title">Audio</h3>
              <p>Ambience, effects, and music</p>
            </header>
            <div class="game-menu-section__controls">
              <label class="game-menu-option">
                <input type="checkbox" data-game-audio-checkbox />
                <span>Game audio</span>
              </label>
              <label class="game-menu-volume game-menu-option--nested">
                <span>Ambience</span>
                <output class="game-menu-volume__value" data-ambience-volume-value></output>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  aria-label="Ambience volume"
                  data-ambience-volume
                />
              </label>
              <label class="game-menu-option game-menu-option--nested">
                <input type="checkbox" data-forest-wind-checkbox />
                <span>Forest wind sounds</span>
              </label>
              <label class="game-menu-volume game-menu-option--nested">
                <span>Sound effects</span>
                <output class="game-menu-volume__value" data-sound-effects-volume-value></output>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  aria-label="Sound effects volume"
                  data-sound-effects-volume
                />
              </label>
              <label class="game-menu-option game-menu-option--nested">
                <input type="checkbox" data-music-checkbox />
                <span>Background music</span>
              </label>
              <label class="game-menu-volume game-menu-option--nested">
                <span>Music</span>
                <output class="game-menu-volume__value" data-music-volume-value></output>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  aria-label="Music volume"
                  data-music-volume
                />
              </label>
            </div>
          </section>
        </div>

        <div class="game-menu-lower">
          <section class="game-menu-cheat" aria-labelledby="game-menu-cheat-title">
            <div class="game-menu-cheat__heading">
              <div>
                <h3 id="game-menu-cheat-title">Sandbox</h3>
                <p>Top up every resource for unrestricted building.</p>
              </div>
              <span class="game-menu-cheat__badge">Cheat mode</span>
            </div>
            <div class="game-menu-cheat__controls">
              <label class="game-menu-cheat__amount">
                <span>Resources each</span>
                <input
                  type="number"
                  min="1"
                  max="1000000000"
                  step="10000"
                  value="100000"
                  inputmode="numeric"
                  data-cheat-amount
                />
              </label>
              <button type="button" class="game-menu-cheat__grant" data-cheat-grant>
                Enable cheat mode
              </button>
            </div>
            <p class="game-menu-cheat__status" data-cheat-status aria-live="polite"></p>
          </section>

          <section class="game-menu-actions" aria-labelledby="game-menu-actions-title">
            <header class="game-menu-section__header">
              <h3 id="game-menu-actions-title">Game</h3>
              <p>Help, tutorials, and world management</p>
            </header>
            <div class="game-menu-actions__grid">
              <button type="button" class="game-menu-action" data-game-controls>Game controls…</button>
              <button type="button" class="game-menu-action" data-replay-tutorials>Replay tutorials…</button>
              <button type="button" class="game-menu-action game-menu-action--danger" data-new-world>New world…</button>
            </div>
          </section>
        </div>
      </div>
    `;

    this.dialog = this.backdrop.querySelector<HTMLElement>('.game-menu-dialog')!;
    this.treeShadowsCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-tree-shadows-checkbox]')!;
    this.buildingShadowsCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-building-shadows-checkbox]')!;
    this.distantCanopyCardsCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-distant-canopy-cards-checkbox]')!;
    this.painterlyVegetationCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-painterly-vegetation-checkbox]')!;
    this.constellationGuidesCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-constellation-guides-checkbox]')!;
    this.dayNightCycleCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-day-night-cycle-checkbox]')!;
    this.fixedSkyPresetSelect = this.backdrop.querySelector<HTMLSelectElement>('[data-fixed-sky-preset]')!;
    this.fixedSkyDescription = this.backdrop.querySelector<HTMLElement>('[data-fixed-sky-description]')!;
    this.resourceIconsCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-resource-icons-checkbox]')!;
    this.gameAudioCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-game-audio-checkbox]')!;
    this.ambienceVolumeInput = this.backdrop.querySelector<HTMLInputElement>('[data-ambience-volume]')!;
    this.ambienceVolumeValue = this.backdrop.querySelector<HTMLOutputElement>('[data-ambience-volume-value]')!;
    this.forestWindCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-forest-wind-checkbox]')!;
    this.soundEffectsVolumeInput = this.backdrop.querySelector<HTMLInputElement>('[data-sound-effects-volume]')!;
    this.soundEffectsVolumeValue = this.backdrop.querySelector<HTMLOutputElement>('[data-sound-effects-volume-value]')!;
    this.musicCheckbox = this.backdrop.querySelector<HTMLInputElement>('[data-music-checkbox]')!;
    this.musicVolumeInput = this.backdrop.querySelector<HTMLInputElement>('[data-music-volume]')!;
    this.musicVolumeValue = this.backdrop.querySelector<HTMLOutputElement>('[data-music-volume-value]')!;
    this.cheatAmountInput = this.backdrop.querySelector<HTMLInputElement>('[data-cheat-amount]')!;
    this.cheatGrantButton = this.backdrop.querySelector<HTMLButtonElement>('[data-cheat-grant]')!;
    this.cheatStatus = this.backdrop.querySelector<HTMLElement>('[data-cheat-status]')!;
    const returnButton = this.backdrop.querySelector<HTMLButtonElement>('[data-return-button]')!;
    const controlsButton = this.backdrop.querySelector<HTMLButtonElement>('[data-game-controls]')!;
    const tutorialsButton = this.backdrop.querySelector<HTMLButtonElement>('[data-replay-tutorials]')!;
    const newWorldButton = this.backdrop.querySelector<HTMLButtonElement>('[data-new-world]')!;

    this.controlsModal = new GameControlsModal(parent, {
      onOpenChange: options.onOpenChange,
    });

    if (options.showButton !== false) parent.appendChild(this.menuButton);
    parent.appendChild(this.backdrop);

    this.treeShadowsCheckbox.checked = areTreeShadowsEnabled();
    this.buildingShadowsCheckbox.checked = areBuildingShadowsEnabled();
    this.distantCanopyCardsCheckbox.checked = areDistantCanopyCardsEnabled();
    this.painterlyVegetationCheckbox.checked = isPainterlyVegetationEnabled();
    this.constellationGuidesCheckbox.checked = areConstellationGuidesEnabled();
    this.syncSkyPresentationControls();
    this.resourceIconsCheckbox.checked = areResourceIconsAlwaysShown();
    this.gameAudioCheckbox.checked = isGameAudioEnabled();
    this.forestWindCheckbox.checked = isForestWindEnabled();
    this.musicCheckbox.checked = isMusicEnabled();
    this.syncAmbienceVolume();
    this.syncSoundEffectsVolume();
    this.syncMusicVolume();
    this.syncAudioControls();
    this.menuButton.addEventListener('click', () => this.toggle());
    returnButton.addEventListener('click', () => this.close());
    controlsButton.addEventListener('click', () => {
      this.closeSettingsPanel();
      this.controlsModal.openModal();
    });
    tutorialsButton.addEventListener('click', () => {
      this.close();
      options.onReplayTutorials?.();
    });
    newWorldButton.addEventListener('click', () => {
      this.close();
      this.onNewWorld?.();
    });
    this.cheatGrantButton.addEventListener('click', () => {
      void this.grantCheatResources(options.onGrantCheatResources);
    });
    this.backdrop.addEventListener('click', () => this.close());
    this.dialog.addEventListener('click', (event) => event.stopPropagation());
    this.treeShadowsCheckbox.addEventListener('change', () => {
      setTreeShadowsEnabled(this.treeShadowsCheckbox.checked);
      this.onShadowPreferenceChange();
    });
    this.buildingShadowsCheckbox.addEventListener('change', () => {
      setBuildingShadowsEnabled(this.buildingShadowsCheckbox.checked);
      this.onShadowPreferenceChange();
    });
    this.distantCanopyCardsCheckbox.addEventListener('change', () => {
      const enabled = this.distantCanopyCardsCheckbox.checked;
      setDistantCanopyCardsEnabled(enabled);
      options.onDistantCanopyCardsChange?.(enabled);
    });
    this.painterlyVegetationCheckbox.addEventListener('change', () => {
      setPainterlyVegetationEnabled(this.painterlyVegetationCheckbox.checked);
    });
    this.constellationGuidesCheckbox.addEventListener('change', () => {
      setConstellationGuidesEnabled(this.constellationGuidesCheckbox.checked);
    });
    this.dayNightCycleCheckbox.addEventListener('change', () => {
      setDayNightCycleDisabled(this.dayNightCycleCheckbox.checked);
      this.syncSkyPresentationControls();
    });
    this.fixedSkyPresetSelect.addEventListener('change', () => {
      const preset = this.fixedSkyPresetSelect.value;
      if (isFixedSkyPreset(preset)) setFixedSkyPreset(preset);
      this.syncSkyPresentationControls();
    });
    this.resourceIconsCheckbox.addEventListener('change', () => {
      setResourceIconsAlwaysShown(this.resourceIconsCheckbox.checked);
    });
    this.gameAudioCheckbox.addEventListener('change', () => {
      setGameAudioEnabled(this.gameAudioCheckbox.checked);
      this.syncAudioControls();
      options.onAudioEnabledChange?.(this.gameAudioCheckbox.checked);
    });
    this.ambienceVolumeInput.addEventListener('input', () => {
      const volume = Number(this.ambienceVolumeInput.value) / 100;
      setAmbienceVolume(volume);
      this.syncAmbienceVolume();
      options.onAmbienceVolumeChange?.(volume);
    });
    this.forestWindCheckbox.addEventListener('change', () => {
      const enabled = this.forestWindCheckbox.checked;
      setForestWindEnabled(enabled);
      options.onForestWindEnabledChange?.(enabled);
    });
    this.soundEffectsVolumeInput.addEventListener('input', () => {
      const volume = Number(this.soundEffectsVolumeInput.value) / 100;
      setSoundEffectsVolume(volume);
      this.syncSoundEffectsVolume();
      options.onSoundEffectsVolumeChange?.(volume);
    });
    this.musicCheckbox.addEventListener('change', () => {
      setMusicEnabled(this.musicCheckbox.checked);
      this.syncAudioControls();
      options.onMusicEnabledChange?.(this.musicCheckbox.checked);
    });
    this.musicVolumeInput.addEventListener('input', () => {
      const volume = Number(this.musicVolumeInput.value) / 100;
      setMusicVolume(volume);
      this.syncMusicVolume();
      options.onMusicVolumeChange?.(volume);
    });

    this.onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || this.isTextInputFocused()) return;

      if (this.controlsModal.isOpen()) {
        event.preventDefault();
        event.stopPropagation();
        this.controlsModal.close();
        return;
      }

      if (this.open) {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }

      if (this.canOpenFromKeyboard?.() === false) return;

      event.preventDefault();
      event.stopPropagation();
      this.openMenu();
    };

    window.addEventListener('keydown', this.onKeyDown, true);
  }

  isOpen(): boolean {
    return this.open;
  }

  isControlsOpen(): boolean {
    return this.controlsModal.isOpen();
  }

  dispose(): void {
    this.close();
    this.controlsModal.dispose();
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.menuButton.remove();
    this.backdrop.remove();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openMenu();
  }

  private openMenu(): void {
    this.open = true;
    this.treeShadowsCheckbox.checked = areTreeShadowsEnabled();
    this.buildingShadowsCheckbox.checked = areBuildingShadowsEnabled();
    this.distantCanopyCardsCheckbox.checked = areDistantCanopyCardsEnabled();
    this.painterlyVegetationCheckbox.checked = isPainterlyVegetationEnabled();
    this.constellationGuidesCheckbox.checked = areConstellationGuidesEnabled();
    this.syncSkyPresentationControls();
    this.resourceIconsCheckbox.checked = areResourceIconsAlwaysShown();
    this.gameAudioCheckbox.checked = isGameAudioEnabled();
    this.forestWindCheckbox.checked = isForestWindEnabled();
    this.musicCheckbox.checked = isMusicEnabled();
    this.syncAmbienceVolume();
    this.syncSoundEffectsVolume();
    this.syncMusicVolume();
    this.syncAudioControls();
    this.backdrop.hidden = false;
    this.menuButton.setAttribute('aria-expanded', 'true');
    this.onOpenChange?.(true);
    this.backdrop.querySelector<HTMLButtonElement>('[data-return-button]')?.focus({ preventScroll: true });
  }

  private close(): void {
    if (!this.open) return;
    this.closeSettingsPanel();
    this.onOpenChange?.(false);
  }

  /** Hide settings without changing overlay-open state (e.g. when opening game controls). */
  private closeSettingsPanel(): void {
    if (!this.open) return;
    this.open = false;
    this.backdrop.hidden = true;
    this.menuButton.setAttribute('aria-expanded', 'false');
  }

  private isTextInputFocused(): boolean {
    const target = document.activeElement as HTMLElement | null;
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable);
  }

  private syncAudioControls(): void {
    this.ambienceVolumeInput.disabled = !this.gameAudioCheckbox.checked;
    this.forestWindCheckbox.disabled = !this.gameAudioCheckbox.checked;
    this.soundEffectsVolumeInput.disabled = !this.gameAudioCheckbox.checked;
    this.musicCheckbox.disabled = !this.gameAudioCheckbox.checked;
    this.musicVolumeInput.disabled =
      !this.gameAudioCheckbox.checked || !this.musicCheckbox.checked;
  }

  private syncSkyPresentationControls(): void {
    const preference = getSkyPresentationPreference();
    const preset = fixedSkyPreset(preference.preset);
    this.dayNightCycleCheckbox.checked = preference.cycleDisabled;
    this.fixedSkyPresetSelect.value = preset.id;
    this.fixedSkyPresetSelect.disabled = !preference.cycleDisabled;
    this.fixedSkyDescription.textContent = preference.cycleDisabled
      ? `${preset.description} Visual only — the settlement clock keeps running.`
      : 'The sky follows the settlement clock.';
  }

  private syncAmbienceVolume(): void {
    const percent = Math.round(getAmbienceVolume() * 100);
    this.ambienceVolumeInput.value = String(percent);
    this.ambienceVolumeValue.value = `${percent}%`;
    this.ambienceVolumeValue.textContent = `${percent}%`;
  }

  private syncMusicVolume(): void {
    const percent = Math.round(getMusicVolume() * 100);
    this.musicVolumeInput.value = String(percent);
    this.musicVolumeValue.value = `${percent}%`;
    this.musicVolumeValue.textContent = `${percent}%`;
  }

  private syncSoundEffectsVolume(): void {
    const percent = Math.round(getSoundEffectsVolume() * 100);
    this.soundEffectsVolumeInput.value = String(percent);
    this.soundEffectsVolumeValue.value = `${percent}%`;
    this.soundEffectsVolumeValue.textContent = `${percent}%`;
  }

  private async grantCheatResources(
    grant: GameMenuOptions['onGrantCheatResources'],
  ): Promise<void> {
    if (!grant || this.cheatGrantButton.disabled) return;

    const amount = Math.floor(Number(this.cheatAmountInput.value));
    if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000_000) {
      this.cheatStatus.textContent = 'Enter an amount from 1 to 1,000,000,000.';
      this.cheatStatus.dataset.variant = 'error';
      this.cheatAmountInput.focus();
      return;
    }

    this.cheatGrantButton.disabled = true;
    this.cheatGrantButton.textContent = 'Granting resources…';
    this.cheatStatus.textContent = '';
    this.cheatStatus.dataset.variant = '';
    try {
      await grant(amount);
      this.cheatGrantButton.textContent = 'Top up again';
      this.cheatStatus.textContent = `Cheat mode active · ${amount.toLocaleString()} of every resource.`;
      this.cheatStatus.dataset.variant = 'success';
      this.dialog.classList.add('is-cheat-active');
    } catch (error) {
      this.cheatGrantButton.textContent = 'Enable cheat mode';
      this.cheatStatus.textContent = error instanceof Error
        ? error.message
        : 'Could not grant cheat resources.';
      this.cheatStatus.dataset.variant = 'error';
    } finally {
      this.cheatGrantButton.disabled = false;
    }
  }
}
