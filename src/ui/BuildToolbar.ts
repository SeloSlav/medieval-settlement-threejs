import { CompassHud } from './CompassHud.ts';
import { GameMenu } from './GameMenu.ts';
import type { BurgageLayoutHudState } from '../residences/BurgageTool.ts';
import {
  FERTILITY_OVERLAY_CROPS,
  getMapOverlaySelection,
  type MapOverlaySelection,
} from '../scene/mapOverlayPreference.ts';
import {
  dismissDockToggles,
  handleDockHotkey,
  syncDockToggleButton,
  toggleDockControl,
  type DockToggle,
} from './constructionDockToggle.ts';
import {
  type BuildMenuAction,
  type BuildMenuHandlers,
  AGRICULTURE_BUILD_MENU_ENTRIES,
  BASIC_BUILD_MENU_ENTRIES,
  MILITARY_BUILD_MENU_ENTRIES,
  RURAL_INDUSTRY_BUILD_MENU_ENTRIES,
  hydrateBuildMenuImages,
  renderBuildMenuCards,
  resolveBuildMenuHotkey,
  runBuildMenuAction,
} from './buildMenuCards.ts';
import { toolbarModeToMenuAction } from './buildMenuMapping.ts';
import type { PlacementBuildMenuAction } from './buildMenuCards.ts';
import type { BuildingKind } from '../generated/gameBalance.ts';
import {
  describeToolbarStatus,
  isBuilderHudMode,
  type ToolbarStats,
} from './buildToolbarStatus.ts';
import { SettlementHud } from './SettlementHud.ts';
import type {
  EnvironmentState,
  NextDayEnvironmentOutlook,
} from '../world/seasonPolicy.ts';
import { resolveGameSpeedHotkey, type GameSpeed } from '../world/gameSpeed.ts';
import { cropLabel } from '../farming/farmFieldMath.ts';

export type { ToolbarStats };

const BASIC_BUILD_MENU_ACTIONS = new Set(BASIC_BUILD_MENU_ENTRIES.map((entry) => entry.action));
const AGRICULTURE_BUILD_MENU_ACTIONS = new Set(AGRICULTURE_BUILD_MENU_ENTRIES.map((entry) => entry.action));
const RURAL_INDUSTRY_BUILD_MENU_ACTIONS = new Set(RURAL_INDUSTRY_BUILD_MENU_ENTRIES.map((entry) => entry.action));
const MILITARY_BUILD_MENU_ACTIONS = new Set(MILITARY_BUILD_MENU_ENTRIES.map((entry) => entry.action));

type DeletePopupOptions = {
  clientX: number;
  clientY: number;
  onRemove: () => void;
  onCancel: () => void;
};

export class BuildToolbar {
  private readonly roadButton: HTMLButtonElement;
  private readonly basicBuildMenuButton: HTMLButtonElement;
  private readonly agricultureBuildMenuButton: HTMLButtonElement;
  private readonly ruralIndustryBuildMenuButton: HTMLButtonElement;
  private readonly militaryBuildMenuButton: HTMLButtonElement;
  private readonly overlayButton: HTMLButtonElement;
  private readonly overlayMenu: HTMLElement;
  private readonly overlayCropPicker: HTMLElement;
  private readonly overlayModeButtons: HTMLButtonElement[];
  private readonly overlayCropButtons: HTMLButtonElement[];
  private readonly cityAdminButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly tutorialsButton: HTMLButtonElement;
  private readonly starterCampButton: HTMLButtonElement;
  private readonly buildButton: HTMLButtonElement;
  private readonly basicBuildMenu: HTMLElement;
  private readonly agricultureBuildMenu: HTMLElement;
  private readonly ruralIndustryBuildMenu: HTMLElement;
  private readonly militaryBuildMenu: HTMLElement;
  private readonly roadSnapControl: HTMLElement;
  private readonly roadSnapToggle: HTMLInputElement;
  private readonly burgageLayoutHud: HTMLElement;
  private readonly burgagePlotDecreaseButton: HTMLButtonElement;
  private readonly burgagePlotIncreaseButton: HTMLButtonElement;
  private readonly burgagePlotCountLabel: HTMLElement;
  private readonly burgagePlotMaxLabel: HTMLElement;
  private readonly burgageRotateFrontageButton: HTMLButtonElement;
  private readonly burgageFrontageLabel: HTMLElement;
  private readonly deletePopup: HTMLElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly cancelDeleteButton: HTMLButtonElement;
  readonly settlementHud: SettlementHud;
  private readonly fpModePanel: HTMLElement;
  private readonly constructionDock: HTMLElement;
  private readonly zoomStat: HTMLElement;
  private readonly cropSuitabilityLegend: HTMLElement;
  private readonly cropSuitabilityTitle: HTMLElement;
  private readonly cropSuitabilitySubtitle: HTMLElement;
  private readonly cropSuitabilityLabels: HTMLElement;
  private readonly cropSuitabilityDescription: HTMLElement;
  private readonly builderStatusBar: HTMLElement;
  private readonly root: HTMLElement;
  private readonly compassHud: CompassHud;
  private gameMenu: GameMenu | null = null;
  private firstPersonActive = false;
  private starterCampRequired = false;
  private basicBuildMenuOpen = false;
  private agricultureBuildMenuOpen = false;
  private ruralIndustryBuildMenuOpen = false;
  private militaryBuildMenuOpen = false;
  private overlayMenuOpen = false;
  private mapOverlaySelection: MapOverlaySelection = getMapOverlaySelection();
  private buildButtonVisible = false;
  private burgageLayoutHudVisible = false;
  private lastBuildLeft = Number.NaN;
  private lastBuildTop = Number.NaN;
  private lastHudLeft = Number.NaN;
  private lastHudTop = Number.NaN;
  private burgageHudStateInitialized = false;
  private lastHudPlotCount = 0;
  private lastHudMaxPlotCount = 0;
  private lastHudResidenceCount: number | null | undefined;
  private lastHudCanDecrease = false;
  private lastHudCanIncrease = false;
  private lastHudValid = false;
  private lastHudShowFrontage = false;
  private lastHudFrontageLabel: string | null = null;
  private hudMode: ToolbarStats['mode'] = 'idle';
  private deleteCancel: (() => void) | null = null;
  private deleteRemove: (() => void) | null = null;
  private readonly onDeleteOutsidePointerDown = (event: PointerEvent): void => {
    if (this.deletePopup.hidden) return;
    if (this.deletePopup.contains(event.target as Node)) return;
    this.hideDeletePopup(true);
  };
  private readonly onBuildMenuOutsideMouseDown = (event: MouseEvent): void => {
    if (!this.isAnyBuildMenuOpen()) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (this.constructionDock.contains(target)) return;
    if (
      this.basicBuildMenu.contains(target)
      || this.agricultureBuildMenu.contains(target)
      || this.ruralIndustryBuildMenu.contains(target)
      || this.militaryBuildMenu.contains(target)
      || this.overlayMenu.contains(target)
      || this.roadSnapControl.contains(target)
    ) return;

    this.closeAllBuildMenus();
    if (!this.root.contains(target)) {
      // A world click dismisses the open palette without placing the previously active tool.
      event.preventDefault();
      event.stopPropagation();
    }
  };
  private readonly basicBuildMenuToggle: DockToggle;
  private readonly agricultureBuildMenuToggle: DockToggle;
  private readonly ruralIndustryBuildMenuToggle: DockToggle;
  private readonly militaryBuildMenuToggle: DockToggle;
  private readonly dockToggles: DockToggle[];
  private readonly toolbarHandlers: BuildMenuHandlers & {
    onOpenRoads: () => void;
    onSetMapOverlay?: (selection: MapOverlaySelection) => void;
  };
  private readonly onToggleCityAdministration: () => void;
  private cityAdministrationOpen = false;
  private gameplayEnabled = true;
  private conflictEnabled = false;
  private cropSuitabilityActive = false;
  private currentFarmCrop: MapOverlaySelection['crop'] = 'wheat';
  private currentGameSpeed: GameSpeed = 1;
  private lastRunningGameSpeed: GameSpeed = 1;
  private readonly requestGameSpeed: (speed: GameSpeed) => void;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || this.isGameMenuOpen()) return;
    if (!this.gameplayEnabled) return;
    if (this.starterCampRequired) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const key = event.key.toLowerCase();
    const speed = resolveGameSpeedHotkey(
      key,
      this.currentGameSpeed,
      this.lastRunningGameSpeed,
      this.firstPersonActive,
    );
    if (speed !== null) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) {
        this.requestGameSpeed(speed);
      }
      return;
    }
    if (this.firstPersonActive) return;
    if (key === 'escape') {
      if (this.overlayMenuOpen) {
        this.setOverlayMenuOpen(false);
        event.preventDefault();
        event.stopPropagation();
      } else if (dismissDockToggles(this.dockToggles)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (key === 'm') {
      event.preventDefault();
      event.stopPropagation();
      this.setOverlayMenuOpen(!this.overlayMenuOpen);
      return;
    }
    if (key === 'i' && !this.isAnyBuildMenuOpen()) {
      event.preventDefault();
      event.stopPropagation();
      this.onToggleCityAdministration();
      return;
    }
    if (this.basicBuildMenuOpen) {
      const buildAction = resolveBuildMenuHotkey(key, BASIC_BUILD_MENU_ENTRIES);
      if (buildAction) {
        event.preventDefault();
        event.stopPropagation();
        runBuildMenuAction(buildAction, this.toolbarHandlers, () => this.setBasicBuildMenuOpen(false));
        return;
      }
    }
    if (this.agricultureBuildMenuOpen) {
      const agricultureAction = resolveBuildMenuHotkey(key, AGRICULTURE_BUILD_MENU_ENTRIES);
      if (agricultureAction) {
        event.preventDefault();
        event.stopPropagation();
        runBuildMenuAction(agricultureAction, this.toolbarHandlers, () => this.setAgricultureBuildMenuOpen(false));
        return;
      }
    }
    if (this.ruralIndustryBuildMenuOpen) {
      const industryAction = resolveBuildMenuHotkey(key, RURAL_INDUSTRY_BUILD_MENU_ENTRIES);
      if (industryAction) {
        event.preventDefault();
        event.stopPropagation();
        runBuildMenuAction(industryAction, this.toolbarHandlers, () => this.setRuralIndustryBuildMenuOpen(false));
        return;
      }
    }
    if (this.militaryBuildMenuOpen) {
      const militaryAction = resolveBuildMenuHotkey(key, MILITARY_BUILD_MENU_ENTRIES);
      if (militaryAction) {
        event.preventDefault();
        event.stopPropagation();
        runBuildMenuAction(militaryAction, this.toolbarHandlers, () => this.setMilitaryBuildMenuOpen(false));
        return;
      }
    }
    if (this.isAnyBuildMenuOpen() && key === 'r') {
      event.preventDefault();
      event.stopPropagation();
      this.closeAllBuildMenus();
      return;
    }
    if (handleDockHotkey(key, this.dockToggles)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (key === 'i') {
      event.preventDefault();
      event.stopPropagation();
      this.onToggleCityAdministration();
    }
  };

  constructor(
    root: HTMLElement,
    handlers: {
      onOpenRoads: () => void;
      onBuildRoad: () => void;
      onSelectBuilding: (kind: BuildingKind) => void;
      onPlaceStarterCamp: () => void;
      onSelectResidences: () => void;
      onToggleCityAdministration: () => void;
      onSetMapOverlay?: (selection: MapOverlaySelection) => void;
      onSetRoadSnap?: (enabled: boolean) => void;
      onBurgagePlotDecrease?: () => void;
      onBurgagePlotIncrease?: () => void;
      onBurgageRotateFrontage?: () => void;
      onMenuOpenChange?: (open: boolean) => void;
      onShadowPreferenceChange?: () => void;
      onDistantCanopyCardsChange?: (enabled: boolean) => void;
      canOpenMenuFromKeyboard?: () => boolean;
      onNewWorld?: () => void;
      onReplayTutorials?: () => void;
      onGrantCheatResources?: (amount: number) => Promise<void>;
      onSetGameSpeed?: (speed: GameSpeed) => void;
      onAudioEnabledChange?: (enabled: boolean) => void;
      onAmbienceVolumeChange?: (volume: number) => void;
      onMusicEnabledChange?: (enabled: boolean) => void;
      onMusicVolumeChange?: (volume: number) => void;
    },
  ) {
    root.insertAdjacentHTML('beforeend', `
      <button type="button" class="tutorial-launcher" data-action="tutorials" aria-label="Open tutorials">
        <span class="tutorial-launcher__mark" aria-hidden="true">?</span>
        <span>Tutorials</span>
      </button>

      <div class="hud-right-stack">
        <aside class="crop-suitability-legend map-overlay-legend" data-crop-suitability-legend hidden aria-label="Map overlay legend">
          <header>
            <strong data-crop-suitability-title>Crop suitability</strong>
            <span data-map-overlay-subtitle>first-crop site potential</span>
          </header>
          <div class="crop-suitability-scale" aria-hidden="true">
            <span class="crop-suitability-scale__poor"></span>
            <span class="crop-suitability-scale__marginal"></span>
            <span class="crop-suitability-scale__good"></span>
            <span class="crop-suitability-scale__prime"></span>
          </div>
          <div class="crop-suitability-labels" data-map-overlay-labels><span>Poor</span><span>Marginal</span><span>Good</span><span>Prime</span></div>
          <p data-map-overlay-description>Combines groundwater, predicted starting soil, and slope. Parcel size and shape still affect final yield.</p>
        </aside>
      </div>

      <div class="hud-bottom-center" data-hud-bottom-center>
        <label class="construction-road-snap" data-road-snap-control hidden>
          <input type="checkbox" data-road-snap-toggle checked>
          <span>Snap to Roads</span>
        </label>

        <section class="construction-menu" id="basic-build-menu" data-build-menu="basic" hidden aria-label="Build menu">
          <div class="construction-menu__cards">
            ${renderBuildMenuCards(BASIC_BUILD_MENU_ENTRIES)}
          </div>
        </section>

        <section class="construction-menu" id="agriculture-build-menu" data-build-menu="agriculture" hidden aria-label="Agriculture menu">
          <div class="construction-menu__cards">
            ${renderBuildMenuCards(AGRICULTURE_BUILD_MENU_ENTRIES)}
          </div>
        </section>

        <section class="construction-menu" id="industry-build-menu" data-build-menu="industry" hidden aria-label="Industry menu">
          <div class="construction-menu__cards">
            ${renderBuildMenuCards(RURAL_INDUSTRY_BUILD_MENU_ENTRIES)}
          </div>
        </section>

        <section class="construction-menu" id="military-build-menu" data-build-menu="military" hidden aria-label="Military menu">
          <div class="construction-menu__cards">
            ${renderBuildMenuCards(MILITARY_BUILD_MENU_ENTRIES)}
          </div>
        </section>

        <section class="map-overlay-menu" id="map-overlay-menu" data-overlay-menu hidden aria-label="Map overlays">
          <header class="map-overlay-menu__header">
            <strong>Map overlays</strong>
            <span>Choose a planning layer</span>
          </header>
          <div class="map-overlay-menu__modes">
            <button type="button" class="map-overlay-option" data-overlay-mode="water" aria-pressed="false">
              <span class="map-overlay-option__icon map-overlay-option__icon--water" aria-hidden="true"></span>
              <span><strong>Water</strong><small>Wells &amp; watermills</small></span>
            </button>
            <button type="button" class="map-overlay-option" data-overlay-mode="wind" aria-pressed="false">
              <span class="map-overlay-option__icon map-overlay-option__icon--wind" aria-hidden="true"></span>
              <span><strong>Wind</strong><small>Windmill exposure</small></span>
            </button>
            <button type="button" class="map-overlay-option" data-overlay-mode="fertility" aria-pressed="false">
              <span class="map-overlay-option__icon map-overlay-option__icon--fertility" aria-hidden="true"></span>
              <span><strong>Fertility</strong><small>Crop-specific potential</small></span>
            </button>
          </div>
          <div class="map-overlay-crops" data-overlay-crop-picker hidden aria-label="Fertility crop">
            ${FERTILITY_OVERLAY_CROPS.map((crop) => `
              <button type="button" data-overlay-crop="${crop}" aria-pressed="false">${cropLabel(crop)}</button>
            `).join('')}
          </div>
        </section>

        <div class="hud-bottom-messages" data-hud-bottom-messages aria-live="polite">
          <div class="builder-status-bar" data-builder-status hidden></div>
        </div>

        <button type="button" class="starter-camp-button" data-action="place-starter-camp" aria-pressed="false" hidden>
          <span class="gk-icon gk-icon--construction gk-icon--camp" aria-hidden="true"></span>
          <span class="starter-camp-button__copy">
            <strong>Place starter camp</strong>
            <small>Choose where your settlement begins</small>
          </span>
        </button>

        <nav class="construction-dock" data-construction-dock aria-label="Construction tools">
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="road" data-tooltip="Roads (R)" aria-label="Roads (R)" aria-pressed="false">
          <span class="gk-icon gk-icon--construction gk-icon--road" aria-hidden="true"></span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">R</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="basic-build-menu" data-tooltip="Build (B)" aria-label="Build menu (B)" aria-controls="basic-build-menu" aria-haspopup="true" aria-expanded="false" aria-pressed="false">
          <span class="gk-icon gk-icon--construction gk-icon--hammer" aria-hidden="true"></span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">B</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="agriculture-build-menu" data-tooltip="Agriculture (U)" aria-label="Agriculture menu (U)" aria-controls="agriculture-build-menu" aria-haspopup="true" aria-expanded="false" aria-pressed="false">
          <span class="gk-icon gk-icon--construction gk-icon--agriculture" aria-hidden="true"></span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">U</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="industry-build-menu" data-tooltip="Industry (V)" aria-label="Industry menu (V)" aria-controls="industry-build-menu" aria-haspopup="true" aria-expanded="false" aria-pressed="false">
          <span class="gk-icon gk-icon--construction gk-icon--industry" aria-hidden="true"></span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">V</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="military-build-menu" data-tooltip="Defenses (X)" aria-label="Military menu (X)" aria-controls="military-build-menu" aria-haspopup="true" aria-expanded="false" aria-pressed="false" hidden>
          <span class="gk-icon gk-icon--construction gk-icon--defense" aria-hidden="true"></span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">X</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey construction-dock-button--overlay" data-action="overlay-menu" data-tooltip="Map overlays (M)" aria-label="Map overlays (M)" aria-controls="map-overlay-menu" aria-haspopup="true" aria-expanded="false" aria-pressed="false">
          <span class="map-overlay-launcher-icon" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">M</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="city-admin" data-tooltip="Select Town Hall administration (I)" aria-label="Select Town Hall administration (I)" aria-pressed="false">
          <span class="gk-icon gk-icon--construction gk-icon--town-hall" aria-hidden="true"></span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">I</span>
        </button>
        <button type="button" class="construction-dock-button" data-action="settings" data-tooltip="Settings (Esc)" aria-label="Settings (Esc)">
          <span class="gk-icon gk-icon--construction gk-icon--settings" aria-hidden="true"></span>
        </button>
      </nav>
      </div>

      <button type="button" class="road-tool-button icon-button floating-build-button" data-action="commit-build" title="Build road (Enter)" aria-label="Build road" disabled hidden>
        <span class="gk-icon gk-icon--construction gk-icon--hammer" aria-hidden="true"></span>
      </button>

      <div class="burgage-layout-hud" data-burgage-layout-hud hidden aria-label="Residence plot layout">
        <button type="button" class="burgage-layout-hud-button" data-action="burgage-plot-decrease" title="Fewer plots (−)" aria-label="Fewer plots">−</button>
        <div class="burgage-layout-hud-count">
          <strong data-burgage-plot-count>1</strong>
          <span data-burgage-plot-max>plot</span>
        </div>
        <button type="button" class="burgage-layout-hud-button" data-action="burgage-plot-increase" title="More plots (+)" aria-label="More plots">+</button>
        <button type="button" class="burgage-layout-hud-frontage" data-action="burgage-rotate-frontage" title="Rotate frontage (F)" aria-label="Rotate frontage" hidden>
          <span aria-hidden="true">↻</span>
          <span class="burgage-layout-hud-frontage-label" data-burgage-frontage-label>A–B</span>
        </button>
      </div>

      <div class="delete-popup" data-delete-popup hidden>
        <button type="button" data-action="confirm-delete">Remove</button>
        <button type="button" class="ghost-button" data-action="cancel-delete">Cancel</button>
      </div>

      <div class="hud-bottom-right">
        <div class="fps-panel fp-mode-panel" data-fp-mode-panel aria-label="First person mode">
          <div class="fps-stat">
            <strong>~</strong>
            <span>Walk</span>
          </div>
        </div>
      </div>

    `);

    this.root = root;
    this.onToggleCityAdministration = handlers.onToggleCityAdministration;
    this.requestGameSpeed = (speed) => {
      if (!this.gameplayEnabled) return;
      handlers.onSetGameSpeed?.(speed);
    };
    const hudStack = this.mustElement(root, '.hud-right-stack');
    this.settlementHud = new SettlementHud(hudStack, this.requestGameSpeed);
    this.toolbarHandlers = {
      onSelectBuilding: handlers.onSelectBuilding,
      onSelectResidences: handlers.onSelectResidences,
      onOpenRoads: handlers.onOpenRoads,
      onSetMapOverlay: handlers.onSetMapOverlay,
    };
    window.addEventListener('keydown', this.onKeyDown, true);
    this.gameMenu = new GameMenu(root, {
      onShadowPreferenceChange: () => handlers.onShadowPreferenceChange?.(),
      onDistantCanopyCardsChange: handlers.onDistantCanopyCardsChange,
      onOpenChange: handlers.onMenuOpenChange,
      canOpenFromKeyboard: handlers.canOpenMenuFromKeyboard,
      onNewWorld: handlers.onNewWorld,
      onReplayTutorials: handlers.onReplayTutorials,
      onGrantCheatResources: handlers.onGrantCheatResources,
      onAudioEnabledChange: handlers.onAudioEnabledChange,
      onAmbienceVolumeChange: handlers.onAmbienceVolumeChange,
      onMusicEnabledChange: handlers.onMusicEnabledChange,
      onMusicVolumeChange: handlers.onMusicVolumeChange,
      showButton: false,
    });

    this.roadButton = this.mustButton(root, '[data-action="road"]');
    this.basicBuildMenuButton = this.mustButton(root, '[data-action="basic-build-menu"]');
    this.agricultureBuildMenuButton = this.mustButton(root, '[data-action="agriculture-build-menu"]');
    this.ruralIndustryBuildMenuButton = this.mustButton(root, '[data-action="industry-build-menu"]');
    this.militaryBuildMenuButton = this.mustButton(root, '[data-action="military-build-menu"]');
    this.overlayButton = this.mustButton(root, '[data-action="overlay-menu"]');
    this.cityAdminButton = this.mustButton(root, '[data-action="city-admin"]');
    this.settingsButton = this.mustButton(root, '[data-action="settings"]');
    this.tutorialsButton = this.mustButton(root, '[data-action="tutorials"]');
    this.starterCampButton = this.mustButton(root, '[data-action="place-starter-camp"]');
    this.buildButton = this.mustButton(root, '[data-action="commit-build"]');
    this.basicBuildMenu = this.mustElement(root, '[data-build-menu="basic"]');
    this.agricultureBuildMenu = this.mustElement(root, '[data-build-menu="agriculture"]');
    this.ruralIndustryBuildMenu = this.mustElement(root, '[data-build-menu="industry"]');
    this.militaryBuildMenu = this.mustElement(root, '[data-build-menu="military"]');
    this.overlayMenu = this.mustElement(root, '[data-overlay-menu]');
    this.overlayCropPicker = this.mustElement(root, '[data-overlay-crop-picker]');
    this.overlayModeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-overlay-mode]'));
    this.overlayCropButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-overlay-crop]'));
    this.roadSnapControl = this.mustElement(root, '[data-road-snap-control]');
    this.roadSnapToggle = this.mustInput(root, '[data-road-snap-toggle]');
    this.cropSuitabilityLegend = this.mustElement(root, '[data-crop-suitability-legend]');
    this.cropSuitabilityTitle = this.mustElement(root, '[data-crop-suitability-title]');
    this.cropSuitabilitySubtitle = this.mustElement(root, '[data-map-overlay-subtitle]');
    this.cropSuitabilityLabels = this.mustElement(root, '[data-map-overlay-labels]');
    this.cropSuitabilityDescription = this.mustElement(root, '[data-map-overlay-description]');
    this.burgageLayoutHud = this.mustElement(root, '[data-burgage-layout-hud]');
    this.burgagePlotDecreaseButton = this.mustButton(root, '[data-action="burgage-plot-decrease"]');
    this.burgagePlotIncreaseButton = this.mustButton(root, '[data-action="burgage-plot-increase"]');
    this.burgagePlotCountLabel = this.mustElement(root, '[data-burgage-plot-count]');
    this.burgagePlotMaxLabel = this.mustElement(root, '[data-burgage-plot-max]');
    this.burgageRotateFrontageButton = this.mustButton(root, '[data-action="burgage-rotate-frontage"]');
    this.burgageFrontageLabel = this.mustElement(root, '[data-burgage-frontage-label]');
    this.deletePopup = this.mustElement(root, '[data-delete-popup]');
    this.removeButton = this.mustButton(root, '[data-action="confirm-delete"]');
    this.cancelDeleteButton = this.mustButton(root, '[data-action="cancel-delete"]');
    this.fpModePanel = this.mustElement(root, '[data-fp-mode-panel]');
    this.constructionDock = this.mustElement(root, '[data-construction-dock]');
    this.zoomStat = this.settlementHud.zoomStat;
    this.builderStatusBar = this.mustElement(root, '[data-builder-status]');
    this.compassHud = new CompassHud(root);

    this.basicBuildMenuToggle = {
      button: this.basicBuildMenuButton,
      hotkey: 'b',
      getActive: () => this.basicBuildMenuOpen,
      setActive: (active) => this.setBasicBuildMenuOpen(active),
    };
    this.agricultureBuildMenuToggle = {
      button: this.agricultureBuildMenuButton,
      hotkey: 'u',
      getActive: () => this.agricultureBuildMenuOpen,
      setActive: (active) => this.setAgricultureBuildMenuOpen(active),
    };
    this.ruralIndustryBuildMenuToggle = {
      button: this.ruralIndustryBuildMenuButton,
      hotkey: 'v',
      getActive: () => this.ruralIndustryBuildMenuOpen,
      setActive: (active) => this.setRuralIndustryBuildMenuOpen(active),
    };
    this.militaryBuildMenuToggle = {
      button: this.militaryBuildMenuButton,
      hotkey: 'x',
      getActive: () => this.militaryBuildMenuOpen,
      setActive: (active) => this.setMilitaryBuildMenuOpen(active),
    };
    this.dockToggles = [
      this.basicBuildMenuToggle,
      this.agricultureBuildMenuToggle,
      this.ruralIndustryBuildMenuToggle,
      this.militaryBuildMenuToggle,
    ];
    for (const toggle of this.dockToggles) {
      syncDockToggleButton(toggle);
    }
    this.syncMapOverlayUi();
    window.addEventListener('mousedown', this.onBuildMenuOutsideMouseDown, true);

    this.roadButton.addEventListener('click', () => {
      this.closeAllBuildMenus();
      handlers.onOpenRoads();
    });
    this.basicBuildMenuButton.addEventListener('click', () => toggleDockControl(this.basicBuildMenuToggle));
    this.agricultureBuildMenuButton.addEventListener('click', () => toggleDockControl(this.agricultureBuildMenuToggle));
    this.ruralIndustryBuildMenuButton.addEventListener('click', () => toggleDockControl(this.ruralIndustryBuildMenuToggle));
    this.militaryBuildMenuButton.addEventListener('click', () => toggleDockControl(this.militaryBuildMenuToggle));
    this.overlayButton.addEventListener('click', () => {
      this.setOverlayMenuOpen(!this.overlayMenuOpen);
    });
    for (const button of this.overlayModeButtons) {
      button.addEventListener('click', () => {
        const mode = button.dataset.overlayMode as MapOverlaySelection['mode'];
        const nextMode = this.mapOverlaySelection.mode === mode ? 'none' : mode;
        this.applyMapOverlaySelection({ ...this.mapOverlaySelection, mode: nextMode });
        if (mode !== 'fertility' || nextMode === 'none') this.setOverlayMenuOpen(false);
      });
    }
    for (const button of this.overlayCropButtons) {
      button.addEventListener('click', () => {
        const crop = button.dataset.overlayCrop as MapOverlaySelection['crop'];
        this.applyMapOverlaySelection({ mode: 'fertility', crop });
      });
    }
    this.cityAdminButton.addEventListener('click', () => {
      this.closeAllBuildMenus();
      this.onToggleCityAdministration();
    });
    this.settingsButton.addEventListener('click', () => {
      this.closeAllBuildMenus();
      this.gameMenu?.toggle();
    });
    this.tutorialsButton.addEventListener('click', () => {
      this.closeAllBuildMenus();
      handlers.onReplayTutorials?.();
    });
    this.starterCampButton.addEventListener('click', handlers.onPlaceStarterCamp);
    this.bindBuildMenuClicks(this.basicBuildMenu, () => this.setBasicBuildMenuOpen(false));
    this.bindBuildMenuClicks(this.agricultureBuildMenu, () => this.setAgricultureBuildMenuOpen(false));
    this.bindBuildMenuClicks(this.ruralIndustryBuildMenu, () => this.setRuralIndustryBuildMenuOpen(false));
    this.bindBuildMenuClicks(this.militaryBuildMenu, () => this.setMilitaryBuildMenuOpen(false));
    this.roadSnapToggle.addEventListener('change', () => {
      handlers.onSetRoadSnap?.(this.roadSnapToggle.checked);
    });
    this.roadSnapControl.addEventListener('mousedown', (event) => event.stopPropagation());
    this.roadSnapControl.addEventListener('click', (event) => event.stopPropagation());
    this.buildButton.addEventListener('click', handlers.onBuildRoad);
    this.burgagePlotDecreaseButton.addEventListener('click', () => handlers.onBurgagePlotDecrease?.());
    this.burgagePlotIncreaseButton.addEventListener('click', () => handlers.onBurgagePlotIncrease?.());
    this.burgageRotateFrontageButton.addEventListener('click', () => handlers.onBurgageRotateFrontage?.());
    this.burgageLayoutHud.addEventListener('mousedown', (event) => event.stopPropagation());
    this.burgageLayoutHud.addEventListener('click', (event) => event.stopPropagation());
    this.deletePopup.addEventListener('mousedown', (event) => event.stopPropagation());
    this.deletePopup.addEventListener('click', (event) => event.stopPropagation());
    this.removeButton.addEventListener('click', () => {
      const remove = this.deleteRemove;
      this.hideDeletePopup(false);
      remove?.();
    });
    this.cancelDeleteButton.addEventListener('click', () => this.hideDeletePopup(true));
  }

  setMapOverlaySelection(selection: MapOverlaySelection): void {
    this.applyMapOverlaySelection(selection, false);
  }

  setGameplayEnabled(enabled: boolean): void {
    if (this.gameplayEnabled === enabled) return;
    this.gameplayEnabled = enabled;
    this.constructionDock.classList.toggle('is-session-blocked', !enabled);
    this.roadButton.disabled = !enabled;
    this.basicBuildMenuButton.disabled = !enabled;
    this.agricultureBuildMenuButton.disabled = !enabled;
    this.ruralIndustryBuildMenuButton.disabled = !enabled;
    this.militaryBuildMenuButton.disabled = !enabled || !this.conflictEnabled;
    this.overlayButton.disabled = !enabled || this.cropSuitabilityActive;
    this.cityAdminButton.disabled = !enabled;
    this.starterCampButton.disabled = !enabled;
    this.settlementHud.setSpeedControlsEnabled(enabled && !this.starterCampRequired);
    if (!enabled) {
      this.closeAllBuildMenus();
      dismissDockToggles(this.dockToggles);
    }
  }

  setStarterCampRequired(required: boolean): void {
    if (this.starterCampRequired === required) {
      this.syncPrimaryHudVisibility();
      return;
    }
    this.starterCampRequired = required;
    if (required) {
      this.closeAllBuildMenus();
      dismissDockToggles(this.dockToggles);
    }
    this.settlementHud.setSpeedControlsEnabled(this.gameplayEnabled && !required);
    this.syncPrimaryHudVisibility();
  }

  private applyMapOverlaySelection(selection: MapOverlaySelection, notify = true): void {
    this.mapOverlaySelection = selection;
    this.syncMapOverlayUi();
    if (notify) this.toolbarHandlers.onSetMapOverlay?.(selection);
  }

  private syncMapOverlayUi(): void {
    const active = this.mapOverlaySelection.mode !== 'none';
    this.overlayButton.classList.toggle('is-active', active);
    this.overlayButton.classList.toggle('has-active-tool', active && this.overlayMenuOpen);
    this.overlayButton.setAttribute('aria-pressed', String(active));
    for (const button of this.overlayModeButtons) {
      const selected = button.dataset.overlayMode === this.mapOverlaySelection.mode;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    this.overlayCropPicker.hidden = this.mapOverlaySelection.mode !== 'fertility';
    for (const button of this.overlayCropButtons) {
      const selected = button.dataset.overlayCrop === this.mapOverlaySelection.crop;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    this.syncMapOverlayLegend();
  }

  private syncMapOverlayLegend(): void {
    const selection = this.mapOverlaySelection;
    const visible = this.cropSuitabilityActive || selection.mode !== 'none';
    this.cropSuitabilityLegend.hidden = this.firstPersonActive || !visible;
    if (this.cropSuitabilityActive || selection.mode === 'fertility') {
      const crop = this.cropSuitabilityActive
        ? this.currentFarmCrop
        : selection.crop;
      this.cropSuitabilityTitle.textContent = `${cropLabel(crop)} suitability`;
      this.cropSuitabilitySubtitle.textContent = 'first-crop site potential';
      this.cropSuitabilityLabels.innerHTML = '<span>Poor</span><span>Marginal</span><span>Good</span><span>Prime</span>';
      this.cropSuitabilityDescription.textContent = 'Combines groundwater, predicted starting soil, and slope. Parcel size and shape still affect final yield.';
      this.cropSuitabilityLegend.dataset.overlay = 'fertility';
      return;
    }
    if (selection.mode === 'water') {
      this.cropSuitabilityTitle.textContent = 'Water availability';
      this.cropSuitabilitySubtitle.textContent = 'groundwater & stream power';
      this.cropSuitabilityLabels.innerHTML = '<span>Dry</span><span>Limited</span><span>Good</span><span>Abundant</span>';
      this.cropSuitabilityDescription.textContent = 'Use wetter ground for reliable wells; watermills still require a valid riverbank site.';
      this.cropSuitabilityLegend.dataset.overlay = 'water';
      return;
    }
    this.cropSuitabilityTitle.textContent = 'Wind exposure';
    this.cropSuitabilitySubtitle.textContent = 'live windmill potential';
    this.cropSuitabilityLabels.innerHTML = '<span>Sheltered</span><span>Weak</span><span>Good</span><span>Strong</span>';
    this.cropSuitabilityDescription.textContent = 'Local exposure sets windmill power; rain strengthens wind while drought calms it.';
    this.cropSuitabilityLegend.dataset.overlay = 'wind';
  }

  setStats(stats: ToolbarStats): void {
    this.hudMode = stats.mode;
    const placingStarterCamp = stats.mode === 'founders_camp';
    this.starterCampButton.classList.toggle('is-active', placingStarterCamp);
    this.starterCampButton.setAttribute('aria-pressed', String(placingStarterCamp));
    const roadMode = stats.mode === 'road';
    this.roadButton.classList.toggle('is-active', roadMode);
    this.roadButton.setAttribute('aria-pressed', String(roadMode));
    this.syncBuildMenuButtons();
    this.syncBuildMenuCardActiveState(stats.mode);
    this.buildButton.disabled = !stats.canBuild;
    this.buildButton.classList.toggle('is-ready', stats.canBuild);
    this.buildButton.classList.toggle('has-draft', stats.hasDraft);
    const statusState = stats.placementBlocked
      ? 'warning'
      : stats.placementReady
        ? 'ready'
        : stats.canBuild
          ? 'ready'
          : isBuilderHudMode(stats.mode)
            ? (stats.hasDraft ? 'draft' : 'active')
            : 'idle';
    const cropSuitabilityVisible = stats.mode === 'farm-fields' && stats.farmCrop != null;
    this.cropSuitabilityActive = cropSuitabilityVisible;
    if (stats.farmCrop != null) this.currentFarmCrop = stats.farmCrop;
    this.overlayButton.disabled = !this.gameplayEnabled || cropSuitabilityVisible;
    this.overlayButton.dataset.tooltip = cropSuitabilityVisible
      ? 'Crop suitability map is active during field layout'
      : 'Map overlays (M)';
    if (cropSuitabilityVisible) this.setOverlayMenuOpen(false);
    this.syncMapOverlayLegend();
    const statusText = describeToolbarStatus(stats);
    this.builderStatusBar.textContent = statusText;
    this.builderStatusBar.hidden = this.firstPersonActive || !isBuilderHudMode(stats.mode);
    this.builderStatusBar.dataset.state = statusState;
  }

  setBuildButtonPosition(position: { clientX: number; clientY: number } | null, visible: boolean): void {
    if (this.firstPersonActive || !visible || !position) {
      if (!this.buildButtonVisible) return;
      this.buildButton.hidden = true;
      this.buildButtonVisible = false;
      this.lastBuildLeft = Number.NaN;
      this.lastBuildTop = Number.NaN;
      return;
    }

    const size = 44;
    const margin = 10;
    const gap = 12;
    const left = Math.round(Math.max(margin, Math.min(window.innerWidth - size - margin, position.clientX + gap)));
    const top = Math.round(Math.max(margin, Math.min(window.innerHeight - size - margin, position.clientY - size - gap)));
    if (this.buildButtonVisible && left === this.lastBuildLeft && top === this.lastBuildTop) return;

    this.buildButton.hidden = false;
    this.buildButtonVisible = true;
    this.lastBuildLeft = left;
    this.lastBuildTop = top;
    this.buildButton.style.left = `${left}px`;
    this.buildButton.style.top = `${top}px`;
  }

  setBurgageLayoutHud(
    position: { clientX: number; clientY: number } | null,
    state: BurgageLayoutHudState | null,
  ): void {
    if (!position || !state) {
      if (!this.burgageLayoutHudVisible) return;
      this.burgageLayoutHud.hidden = true;
      this.burgageLayoutHudVisible = false;
      this.lastHudLeft = Number.NaN;
      this.lastHudTop = Number.NaN;
      return;
    }

    const showFrontage = state.canRotateFrontage && state.frontageLabel != null;
    const initialized = this.burgageHudStateInitialized;
    const plotCountChanged = !initialized
      || state.plotCount !== this.lastHudPlotCount;
    const maxLabelChanged = plotCountChanged
      || state.maxPlotCount !== this.lastHudMaxPlotCount
      || state.residenceCount !== this.lastHudResidenceCount;
    if (plotCountChanged) {
      this.burgagePlotCountLabel.textContent = state.plotCount.toString();
    }
    if (maxLabelChanged) {
      const plotLabel = state.plotCount === 1 ? 'plot' : 'plots';
      const residenceHint = state.residenceCount != null
        && state.residenceCount !== state.plotCount
        ? ` · ${state.residenceCount} fit`
        : '';
      this.burgagePlotMaxLabel.textContent =
        `${plotLabel} / ${state.maxPlotCount} max${residenceHint}`;
    }
    if (!initialized || state.canDecrease !== this.lastHudCanDecrease) {
      this.burgagePlotDecreaseButton.disabled = !state.canDecrease;
    }
    if (!initialized || state.canIncrease !== this.lastHudCanIncrease) {
      this.burgagePlotIncreaseButton.disabled = !state.canIncrease;
    }
    if (!initialized || state.valid !== this.lastHudValid) {
      this.burgageLayoutHud.dataset.state = state.valid ? 'ready' : 'warning';
    }
    if (!initialized || showFrontage !== this.lastHudShowFrontage) {
      this.burgageRotateFrontageButton.hidden = !showFrontage;
    }
    if (
      showFrontage
      && (!initialized || state.frontageLabel !== this.lastHudFrontageLabel)
    ) {
      this.burgageFrontageLabel.textContent = state.frontageLabel;
    }
    this.lastHudPlotCount = state.plotCount;
    this.lastHudMaxPlotCount = state.maxPlotCount;
    this.lastHudResidenceCount = state.residenceCount;
    this.lastHudCanDecrease = state.canDecrease;
    this.lastHudCanIncrease = state.canIncrease;
    this.lastHudValid = state.valid;
    this.lastHudShowFrontage = showFrontage;
    this.lastHudFrontageLabel = state.frontageLabel;
    this.burgageHudStateInitialized = true;

    if (!this.burgageLayoutHudVisible) {
      this.burgageLayoutHud.hidden = false;
      this.burgageLayoutHudVisible = true;
    }

    const width = this.burgageLayoutHud.offsetWidth || 168;
    const height = this.burgageLayoutHud.offsetHeight || 44;
    const margin = 10;
    const left = Math.round(Math.max(margin, Math.min(window.innerWidth - width - margin, position.clientX - width * 0.5)));
    const top = Math.round(Math.max(margin, Math.min(window.innerHeight - height - margin, position.clientY - height - 14)));
    if (left === this.lastHudLeft && top === this.lastHudTop) return;

    this.lastHudLeft = left;
    this.lastHudTop = top;
    this.burgageLayoutHud.style.left = `${left}px`;
    this.burgageLayoutHud.style.top = `${top}px`;
  }

  setSettlementClock(schedule: Parameters<SettlementHud['setSettlementClock']>[0]): void {
    this.settlementHud.setSettlementClock(schedule);
  }

  setFps(fps: number): void {
    this.settlementHud.setFps(fps);
  }

  setZoomPercent(zoomPercent: number): void {
    this.settlementHud.setZoomPercent(zoomPercent);
  }

  setCityAdministrationOpen(open: boolean): void {
    if (this.cityAdministrationOpen === open) return;
    this.cityAdministrationOpen = open;
    this.cityAdminButton.classList.toggle('is-active', open);
    this.cityAdminButton.setAttribute('aria-pressed', String(open));
  }

  isGameMenuOpen(): boolean {
    return (this.gameMenu?.isOpen() ?? false) || (this.gameMenu?.isControlsOpen() ?? false);
  }

  setFirstPersonMode(active: boolean): void {
    if (this.firstPersonActive === active) return;
    this.firstPersonActive = active;
    this.settlementHud.setFirstPersonActive(active);
    this.root.classList.toggle('is-first-person', active);
    this.fpModePanel.classList.toggle('is-active', active);
    this.syncPrimaryHudVisibility();
    this.zoomStat.hidden = active;
    this.compassHud.setVisible(active);
    if (active) {
      this.closeAllBuildMenus();
      dismissDockToggles(this.dockToggles);
      this.setBuildButtonPosition(null, false);
      this.setBurgageLayoutHud(null, null);
      this.hideDeletePopup(false);
      this.builderStatusBar.hidden = true;
    }
    this.syncMapOverlayLegend();
  }

  setFirstPersonToggle(handler: (() => void) | null): void {
    this.settlementHud.setFirstPersonToggle(handler);
  }

  private syncPrimaryHudVisibility(): void {
    this.tutorialsButton.hidden = this.firstPersonActive;
    this.starterCampButton.hidden = this.firstPersonActive || !this.starterCampRequired;
    this.constructionDock.hidden = this.firstPersonActive || this.starterCampRequired;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('mousedown', this.onBuildMenuOutsideMouseDown, true);
    window.removeEventListener('pointerdown', this.onDeleteOutsidePointerDown, true);
    this.gameMenu?.dispose();
    this.settlementHud.dispose();
    this.compassHud.dispose();
  }

  showDeletePopup(options: DeletePopupOptions): void {
    this.deleteCancel = options.onCancel;
    this.deleteRemove = options.onRemove;
    const width = 168;
    const height = 44;
    const margin = 10;
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, options.clientX + 12));
    const top = Math.max(margin, Math.min(window.innerHeight - height - margin, options.clientY - height * 0.5));
    this.deletePopup.style.left = `${left}px`;
    this.deletePopup.style.top = `${top}px`;
    this.deletePopup.hidden = false;
    window.addEventListener('pointerdown', this.onDeleteOutsidePointerDown, true);
    this.removeButton.focus({ preventScroll: true });
  }

  hideDeletePopup(runCancel = true): void {
    if (this.deletePopup.hidden) return;
    window.removeEventListener('pointerdown', this.onDeleteOutsidePointerDown, true);
    const cancel = this.deleteCancel;
    this.deletePopup.hidden = true;
    this.deleteCancel = null;
    this.deleteRemove = null;
    if (runCancel) cancel?.();
  }

  private isAnyBuildMenuOpen(): boolean {
    return this.isAnyConstructionMenuOpen()
      || this.overlayMenuOpen;
  }

  private isAnyConstructionMenuOpen(): boolean {
    return this.basicBuildMenuOpen
      || this.agricultureBuildMenuOpen
      || this.ruralIndustryBuildMenuOpen
      || this.militaryBuildMenuOpen;
  }

  private closeAllBuildMenus(): void {
    this.setBasicBuildMenuOpen(false);
    this.setAgricultureBuildMenuOpen(false);
    this.setRuralIndustryBuildMenuOpen(false);
    this.setMilitaryBuildMenuOpen(false);
    this.setOverlayMenuOpen(false);
  }

  private closeOtherBuildMenus(except: 'basic' | 'agriculture' | 'industry' | 'military'): void {
    if (except !== 'basic') this.setBasicBuildMenuOpen(false);
    if (except !== 'agriculture') this.setAgricultureBuildMenuOpen(false);
    if (except !== 'industry') this.setRuralIndustryBuildMenuOpen(false);
    if (except !== 'military') this.setMilitaryBuildMenuOpen(false);
    this.setOverlayMenuOpen(false);
  }

  private setOverlayMenuOpen(open: boolean): void {
    const allowed = open && this.gameplayEnabled && !this.cropSuitabilityActive;
    if (this.overlayMenuOpen === allowed) return;
    if (allowed) {
      this.setBasicBuildMenuOpen(false);
      this.setAgricultureBuildMenuOpen(false);
      this.setRuralIndustryBuildMenuOpen(false);
      this.setMilitaryBuildMenuOpen(false);
    }
    this.overlayMenuOpen = allowed;
    this.overlayMenu.hidden = !allowed;
    this.overlayButton.classList.toggle('is-open', allowed);
    this.overlayButton.setAttribute('aria-expanded', String(allowed));
    this.syncMapOverlayUi();
  }

  private setBasicBuildMenuOpen(open: boolean): void {
    if (this.basicBuildMenuOpen === open) return;
    if (open) this.closeOtherBuildMenus('basic');
    if (open) hydrateBuildMenuImages(this.basicBuildMenu);
    this.basicBuildMenuOpen = open;
    this.basicBuildMenu.hidden = !open;
    this.basicBuildMenuButton.setAttribute('aria-expanded', String(open));
    syncDockToggleButton(this.basicBuildMenuToggle);
    this.syncBuildMenuButtons();
  }

  private setAgricultureBuildMenuOpen(open: boolean): void {
    if (this.agricultureBuildMenuOpen === open) return;
    if (open) this.closeOtherBuildMenus('agriculture');
    if (open) hydrateBuildMenuImages(this.agricultureBuildMenu);
    this.agricultureBuildMenuOpen = open;
    this.agricultureBuildMenu.hidden = !open;
    this.agricultureBuildMenuButton.setAttribute('aria-expanded', String(open));
    syncDockToggleButton(this.agricultureBuildMenuToggle);
    this.syncBuildMenuButtons();
  }

  private setRuralIndustryBuildMenuOpen(open: boolean): void {
    if (this.ruralIndustryBuildMenuOpen === open) return;
    if (open) this.closeOtherBuildMenus('industry');
    if (open) hydrateBuildMenuImages(this.ruralIndustryBuildMenu);
    this.ruralIndustryBuildMenuOpen = open;
    this.ruralIndustryBuildMenu.hidden = !open;
    this.ruralIndustryBuildMenuButton.setAttribute('aria-expanded', String(open));
    syncDockToggleButton(this.ruralIndustryBuildMenuToggle);
    this.syncBuildMenuButtons();
  }

  private setMilitaryBuildMenuOpen(open: boolean): void {
    const allowed = open && this.conflictEnabled && this.gameplayEnabled;
    if (this.militaryBuildMenuOpen === allowed) return;
    if (allowed) this.closeOtherBuildMenus('military');
    if (allowed) hydrateBuildMenuImages(this.militaryBuildMenu);
    this.militaryBuildMenuOpen = allowed;
    this.militaryBuildMenu.hidden = !allowed;
    this.militaryBuildMenuButton.setAttribute('aria-expanded', String(allowed));
    syncDockToggleButton(this.militaryBuildMenuToggle);
    this.syncBuildMenuButtons();
  }

  private syncBuildMenuButtons(): void {
    const activeAction = toolbarModeToMenuAction(this.hudMode);
    const basicConstruction = activeAction != null && BASIC_BUILD_MENU_ACTIONS.has(activeAction);
    const agricultureConstruction = activeAction != null && AGRICULTURE_BUILD_MENU_ACTIONS.has(activeAction);
    const ruralIndustryConstruction = activeAction != null && RURAL_INDUSTRY_BUILD_MENU_ACTIONS.has(activeAction);
    const militaryConstruction = activeAction != null && MILITARY_BUILD_MENU_ACTIONS.has(activeAction);
    const browsing = this.isAnyConstructionMenuOpen();
    this.roadSnapControl.hidden = !browsing;

    this.syncBuildMenuButton(
      this.basicBuildMenuButton,
      this.basicBuildMenuOpen,
      basicConstruction,
      browsing,
    );
    this.syncBuildMenuButton(
      this.agricultureBuildMenuButton,
      this.agricultureBuildMenuOpen,
      agricultureConstruction,
      browsing,
    );
    this.syncBuildMenuButton(
      this.ruralIndustryBuildMenuButton,
      this.ruralIndustryBuildMenuOpen,
      ruralIndustryConstruction,
      browsing,
    );
    this.syncBuildMenuButton(
      this.militaryBuildMenuButton,
      this.militaryBuildMenuOpen,
      militaryConstruction,
      browsing,
    );
  }

  setConflictEnabled(enabled: boolean): void {
    if (this.conflictEnabled === enabled) return;
    this.conflictEnabled = enabled;
    this.settlementHud.setConflictEnabled(enabled);
    this.militaryBuildMenuButton.hidden = !enabled;
    this.militaryBuildMenuButton.disabled = !enabled || !this.gameplayEnabled;
    if (!enabled) {
      this.setMilitaryBuildMenuOpen(false);
    }
  }

  setSimulationState(
    speed: GameSpeed,
    environment: EnvironmentState,
    outlook?: NextDayEnvironmentOutlook,
  ): void {
    this.currentGameSpeed = speed;
    if (speed !== 0) this.lastRunningGameSpeed = speed;
    this.settlementHud.setSimulationState(speed, environment, outlook);
  }

  private syncBuildMenuButton(
    button: HTMLButtonElement,
    menuOpen: boolean,
    toolActive: boolean,
    browsing: boolean,
  ): void {
    button.classList.toggle('is-menu-open', menuOpen);
    button.classList.toggle('has-active-tool', toolActive);
    button.classList.toggle('is-active', menuOpen || (toolActive && !browsing));
    button.setAttribute('aria-pressed', String(toolActive));
  }

  private syncBuildMenuCardActiveState(mode: ToolbarStats['mode']): void {
    const activeAction = toolbarModeToMenuAction(mode);
    this.syncBuildMenuCards(this.basicBuildMenu, activeAction);
    this.syncBuildMenuCards(this.agricultureBuildMenu, activeAction);
    this.syncBuildMenuCards(this.ruralIndustryBuildMenu, activeAction);
    this.syncBuildMenuCards(this.militaryBuildMenu, activeAction);
  }

  private syncBuildMenuCards(menu: HTMLElement, activeAction: PlacementBuildMenuAction | null): void {
    for (const button of menu.querySelectorAll<HTMLButtonElement>('.construction-card[data-action]')) {
      const isActive = button.dataset.action === activeAction;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  }

  private bindBuildMenuClicks(menu: HTMLElement, closeMenu: () => void): void {
    menu.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
      if (!button || !menu.contains(button)) return;
      const action = button.dataset.action as BuildMenuAction | undefined;
      if (!action) return;
      runBuildMenuAction(action, this.toolbarHandlers, closeMenu);
    });
    menu.addEventListener('mousedown', (event) => event.stopPropagation());
    menu.addEventListener('click', (event) => event.stopPropagation());
  }

  private mustButton(root: HTMLElement, selector: string): HTMLButtonElement {
    const element = root.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`Missing toolbar button ${selector}`);
    return element;
  }

  private mustElement(root: HTMLElement, selector: string): HTMLElement {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing toolbar element ${selector}`);
    return element;
  }

  private mustInput(root: HTMLElement, selector: string): HTMLInputElement {
    const element = root.querySelector<HTMLInputElement>(selector);
    if (!element) throw new Error(`Missing toolbar input ${selector}`);
    return element;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element?.isContentEditable);
}
