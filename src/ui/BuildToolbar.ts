import { CompassHud } from './CompassHud.ts';
import { MilitaryMenu, type MilitaryMenuHandlers } from './MilitaryMenu.ts';
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
  type BuildMenuCategoryId,
  type BuildMenuHandlers,
  BUILD_MENU_CATEGORIES,
  hydrateBuildMenuImages,
  renderBuildMenuCards,
  runBuildMenuAction,
  syncBuildMenuCardAffordability,
} from './buildMenuCards.ts';
import { toolbarModeToMenuAction } from './buildMenuMapping.ts';
import type { PlacementBuildMenuAction } from './buildMenuCards.ts';
import type { BuildingKind } from '../generated/gameBalance.ts';
import {
  describeToolbarStatus,
  isBuilderHudMode,
  renderToolbarStatus,
  type ToolbarStats,
} from './buildToolbarStatus.ts';
import { SettlementHud } from './SettlementHud.ts';
import type {
  EnvironmentState,
  NextDayEnvironmentOutlook,
} from '../world/seasonPolicy.ts';
import { resolveGameSpeedHotkey, type GameSpeed } from '../world/gameSpeed.ts';
import type { WorldMapSize } from '../world/worldGenerationSettings.ts';
import { cropDefinition, cropLabel } from '../farming/farmFieldMath.ts';
import type { ResourceCostAmounts } from './resourceCost.ts';
import type { SettlementState } from '../resources/types.ts';
import {
  COMMUNITY_REACH_PALETTE,
  stableCommunityPaletteIndex,
} from '../settlement/CommunityReachRaster.ts';
import { SecondaryClickGesture } from '../input/SecondaryClickGesture.ts';
import { SUBREGION_DEFINITIONS } from '../regions/subregionField.ts';
import {
  getPublishedLandUseProfile,
  subscribeLandUseProfile,
} from '../regions/landUseProfile.ts';

export type { ToolbarStats };

const DEFAULT_BUILD_MENU_CATEGORY: BuildMenuCategoryId = 'civic';
const BUILD_MENU_ACTION_CATEGORY = new Map(
  BUILD_MENU_CATEGORIES.flatMap((category) => category.entries.map((entry) => [entry.action, category.id] as const)),
);

function renderBuildMenuCategoryIcon(category: BuildMenuCategoryId): string {
  return `<span class="build-menu-category__icon" data-build-category-icon="${category}" aria-hidden="true"></span>`;
}

function escapeToolbarHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}

type DeletePopupOptions = {
  clientX: number;
  clientY: number;
  onRemove: () => void;
  onCancel: () => void;
};

export class BuildToolbar {
  private readonly roadButton: HTMLButtonElement;
  private readonly buildMenuButton: HTMLButtonElement;
  private readonly militaryButton: HTMLButtonElement;
  readonly militaryMenu: MilitaryMenu;
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
  private readonly buildMenu: HTMLElement;
  private readonly buildMenuCards: HTMLElement;
  private readonly buildMenuCategoryTitle: HTMLElement;
  private readonly buildMenuCategoryHint: HTMLElement;
  private readonly buildMenuCategoryButtons: HTMLButtonElement[];
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
  private readonly constructionDock: HTMLElement;
  private readonly zoomStat: HTMLElement;
  private readonly cropSuitabilityLegend: HTMLElement;
  private readonly cropSuitabilityTitle: HTMLElement;
  private readonly cropSuitabilitySubtitle: HTMLElement;
  private readonly cropSuitabilityLabels: HTMLElement;
  private readonly cropSuitabilityDescription: HTMLElement;
  private communityLegendEntries: Array<{ id: string; name: string; color: string }> = [];
  private communityLegendSignature = '';
  private readonly builderStatusBar: HTMLElement;
  private readonly buildMenuScrollCleanups: Array<() => void> = [];
  private readonly unsubscribeLandUseProfile: () => void;
  private readonly root: HTMLElement;
  private readonly compassHud: CompassHud;
  private readonly buildMenuOutsideSecondaryClick: SecondaryClickGesture;
  private gameMenu: GameMenu | null = null;
  private firstPersonActive = false;
  private firstPersonPlacementActive = false;
  private starterCampRequired = false;
  private mapSize: WorldMapSize = 'medium';
  private buildMenuOpen = false;
  private buildMenuCategory: BuildMenuCategoryId = DEFAULT_BUILD_MENU_CATEGORY;
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
      this.buildMenu.contains(target)
      || this.overlayMenu.contains(target)
      || this.roadSnapControl.contains(target)
    ) return;

    if (this.buildMenuOutsideSecondaryClick.begin(event)) return;

    this.closeAllBuildMenus();
    if (!this.root.contains(target)) {
      // A world click dismisses the open palette without placing the previously active tool.
      event.preventDefault();
      event.stopPropagation();
    }
  };
  private readonly onBuildMenuOutsideSecondaryClick = (event: MouseEvent): void => {
    if (!this.isAnyBuildMenuOpen()) return;
    event.preventDefault();
    this.closeAllBuildMenus();
  };
  private readonly buildMenuToggle: DockToggle;
  private readonly dockToggles: DockToggle[];
  private readonly toolbarHandlers: BuildMenuHandlers & {
    onOpenRoads: () => void;
    onCancelPlacement: () => void;
    onSetMapOverlay?: (selection: MapOverlaySelection) => void;
  };
  private readonly onToggleCityAdministration: () => void;
  private readonly onMilitaryMenuOpen: (() => void) | undefined;
  private cityAdministrationOpen = false;
  private gameplayEnabled = true;
  private conflictEnabled = false;
  private cropSuitabilityActive = false;
  private vineyardSuitabilityActive = false;
  private wellAquiferNetworksEnabled = false;
  private currentFarmCrop: MapOverlaySelection['crop'] = 'wheat';
  private availableResourceCosts: ResourceCostAmounts | null = null;
  private readonly requestGameSpeed: (speed: GameSpeed) => void;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || this.isGameMenuOpen()) return;
    if (this.root.querySelector('.alert-dialog-backdrop:not([hidden])')) return;
    if (!this.gameplayEnabled) return;
    if (this.starterCampRequired) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const key = event.key.toLowerCase();
    const speed = resolveGameSpeedHotkey(key);
    if (speed !== null) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) {
        this.requestGameSpeed(speed);
      }
      return;
    }
    if (this.firstPersonActive) return;
    if (event.repeat) {
      // A held palette or card hotkey must remain a single action. In particular,
      // repeats can arrive after the first event opened or closed a different menu.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (key === 'escape') {
      if (this.militaryMenu.isOpen) {
        this.setMilitaryMenuOpen(false);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
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
    if (key === 'o') {
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
    if (this.buildMenuOpen && key === 'r') {
      // Let the road tool receive R while dismissing the palette it replaces.
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
      onSelectMilitaryCompany?: MilitaryMenuHandlers['onSelectCompany'];
      onMilitaryOrder?: MilitaryMenuHandlers['onOrder'];
      onMilitaryMenuOpen?: () => void;
      onSelectBuilding: (kind: BuildingKind) => void;
      onSelectDryStoneWall: () => void;
      onPlaceStarterCamp: () => void;
      onSelectResidences: () => void;
      onCancelPlacement: () => void;
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
      onSetGameSpeed?: (speed: GameSpeed) => void;
      onAudioEnabledChange?: (enabled: boolean) => void;
      onAmbienceVolumeChange?: (volume: number) => void;
      onForestWindEnabledChange?: (enabled: boolean) => void;
      onSoundEffectsVolumeChange?: (volume: number) => void;
      onMusicEnabledChange?: (enabled: boolean) => void;
      onMusicVolumeChange?: (volume: number) => void;
    },
  ) {
    root.insertAdjacentHTML('beforeend', `
      <div class="hud-right-stack">
        <aside class="crop-suitability-legend map-overlay-legend" data-crop-suitability-legend hidden aria-label="Map overlay legend">
          <header>
            <strong data-crop-suitability-title>Crop suitability</strong>
            <span data-map-overlay-subtitle>first-crop site potential</span>
          </header>
          <div class="crop-suitability-scale" data-map-overlay-scale aria-hidden="true">
            <span class="crop-suitability-scale__poor"></span>
            <span class="crop-suitability-scale__marginal"></span>
            <span class="crop-suitability-scale__good"></span>
            <span class="crop-suitability-scale__prime"></span>
          </div>
          <div class="crop-suitability-labels" data-map-overlay-labels><span>Poor</span><span>Marginal</span><span>Good</span><span>Prime</span></div>
          <p data-map-overlay-description>Crop-specific soil, water, and slope conditions drive actual yield.</p>
        </aside>
      </div>

      <div class="hud-bottom-center" data-hud-bottom-center>
        <label class="construction-road-snap" data-road-snap-control hidden>
          <input type="checkbox" data-road-snap-toggle checked>
          <span>Snap to Roads</span>
        </label>

        <section class="construction-menu construction-menu--unified" id="build-menu" data-build-menu hidden aria-label="Build menu">
          <header class="construction-menu__header">
            <strong data-build-category-title>Civic</strong>
            <small data-build-category-hint>Homes, water, and settlement government</small>
          </header>
          <button type="button" class="construction-menu__scroll construction-menu__scroll--previous" data-build-menu-scroll="previous" aria-label="Scroll buildings left" disabled><span aria-hidden="true">&#8249;</span></button>
          <div class="construction-menu__viewport" data-build-menu-viewport>
            <div class="construction-menu__cards" data-build-menu-cards>
              ${renderBuildMenuCards(BUILD_MENU_CATEGORIES[0].entries, { mapSize: this.mapSize })}
            </div>
          </div>
          <button type="button" class="construction-menu__scroll construction-menu__scroll--next" data-build-menu-scroll="next" aria-label="Scroll buildings right"><span aria-hidden="true">&#8250;</span></button>
          <nav class="build-menu-categories" aria-label="Build categories">
            ${BUILD_MENU_CATEGORIES.map((category, index) => `
              <button type="button" class="build-menu-category${index === 0 ? ' is-active' : ''}" data-build-category="${category.id}" data-tooltip="${category.label}: ${category.hint}" aria-label="${category.label}. ${category.hint}" aria-pressed="${index === 0}" ${category.conflictOnly ? 'hidden' : ''}>
                ${renderBuildMenuCategoryIcon(category.icon)}
                <span>${category.label}</span>
              </button>
            `).join('')}
          </nav>
        </section>

        <section class="map-overlay-menu" id="map-overlay-menu" data-overlay-menu hidden aria-label="Map overlays">
          <header class="map-overlay-menu__header">
            <strong>Map overlays</strong>
            <span>Choose a planning layer</span>
          </header>
          <div class="map-overlay-menu__modes">
            <button type="button" class="map-overlay-option" data-overlay-mode="water" aria-pressed="false">
              <span class="map-overlay-option__icon" data-map-overlay-icon="water" aria-hidden="true"></span>
              <span><strong>Groundwater</strong><small>Even well water</small></span>
            </button>
            <button type="button" class="map-overlay-option" data-overlay-mode="wind" aria-pressed="false">
              <span class="map-overlay-option__icon" data-map-overlay-icon="wind" aria-hidden="true"></span>
              <span><strong>Wind</strong><small>Windmill exposure</small></span>
            </button>
            <button type="button" class="map-overlay-option" data-overlay-mode="fertility" aria-pressed="false">
              <span class="map-overlay-option__icon" data-map-overlay-icon="fertility" aria-hidden="true"></span>
              <span><strong>Fertility</strong><small>Soil &amp; crop provinces</small></span>
            </button>
            <button type="button" class="map-overlay-option" data-overlay-mode="communities" aria-pressed="false">
              <span class="map-overlay-option__icon" data-map-overlay-icon="communities" aria-hidden="true"></span>
              <span><strong>Communities</strong><small>Porous local reach</small></span>
            </button>
            <button type="button" class="map-overlay-option" data-overlay-mode="subregions" aria-pressed="false">
              <span class="map-overlay-option__icon" data-map-overlay-icon="subregions" aria-hidden="true"></span>
              <span><strong>Land use</strong><small>Five global affinities</small></span>
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

        <nav class="construction-dock" data-construction-dock aria-label="Base menu">
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="road" data-tooltip="Roads (R)" aria-label="Roads (R)" aria-pressed="false">
          <span class="gk-icon gk-icon--construction gk-icon--road" aria-hidden="true"></span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">R</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="build-menu" data-tooltip="Build menu (B)" aria-label="Build menu (B)" aria-controls="build-menu" aria-haspopup="true" aria-expanded="false" aria-pressed="false">
          <span class="gk-icon gk-icon--construction gk-icon--hammer" aria-hidden="true"></span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">B</span>
        </button>
        <button type="button" class="construction-dock-button" data-action="military-menu" data-tooltip="Military" aria-label="Military" aria-controls="military-menu" aria-expanded="false" aria-pressed="false">
          <span class="military-launcher-icon" aria-hidden="true"></span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey construction-dock-button--overlay" data-action="overlay-menu" data-tooltip="Map overlays (O)" aria-label="Map overlays (O)" aria-controls="map-overlay-menu" aria-haspopup="true" aria-expanded="false" aria-pressed="false">
          <span class="map-overlay-launcher-icon" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">O</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="city-admin" data-tooltip="Select Town Hall administration (I)" aria-label="Select Town Hall administration (I)" aria-pressed="false">
          <span class="gk-icon gk-icon--construction gk-icon--town-hall" aria-hidden="true"></span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">I</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--tutorial" data-action="tutorials" data-tooltip="Tutorials" aria-label="Open tutorials">
          <span class="construction-dock-button__question" aria-hidden="true">?</span>
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

    `);

    this.root = root;
    this.buildMenuOutsideSecondaryClick = new SecondaryClickGesture({
      onClick: this.onBuildMenuOutsideSecondaryClick,
    });
    this.onToggleCityAdministration = handlers.onToggleCityAdministration;
    this.onMilitaryMenuOpen = handlers.onMilitaryMenuOpen;
    this.requestGameSpeed = (speed) => {
      if (!this.gameplayEnabled) return;
      handlers.onSetGameSpeed?.(speed);
    };
    const hudStack = this.mustElement(root, '.hud-right-stack');
    this.settlementHud = new SettlementHud(hudStack, this.requestGameSpeed);
    this.toolbarHandlers = {
      onSelectBuilding: handlers.onSelectBuilding,
      onSelectResidences: handlers.onSelectResidences,
      onSelectDryStoneWall: handlers.onSelectDryStoneWall,
      onOpenRoads: handlers.onOpenRoads,
      onCancelPlacement: handlers.onCancelPlacement,
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
      onAudioEnabledChange: handlers.onAudioEnabledChange,
      onAmbienceVolumeChange: handlers.onAmbienceVolumeChange,
      onForestWindEnabledChange: handlers.onForestWindEnabledChange,
      onSoundEffectsVolumeChange: handlers.onSoundEffectsVolumeChange,
      onMusicEnabledChange: handlers.onMusicEnabledChange,
      onMusicVolumeChange: handlers.onMusicVolumeChange,
      showButton: false,
    });

    this.roadButton = this.mustButton(root, '[data-action="road"]');
    this.buildMenuButton = this.mustButton(root, '[data-action="build-menu"]');
    this.militaryButton = this.mustButton(root, '[data-action="military-menu"]');
    this.militaryMenu = new MilitaryMenu(this.mustElement(root, '[data-hud-bottom-center]'), {
      onSelectCompany: (id) => handlers.onSelectMilitaryCompany?.(id),
      onOrder: (ids, order) => handlers.onMilitaryOrder?.(ids, order) ?? Promise.resolve(),
      onClose: () => this.setMilitaryMenuOpen(false),
    });
    this.militaryButton.addEventListener('click', () => this.setMilitaryMenuOpen(!this.militaryMenu.isOpen));
    this.overlayButton = this.mustButton(root, '[data-action="overlay-menu"]');
    this.cityAdminButton = this.mustButton(root, '[data-action="city-admin"]');
    this.settingsButton = this.mustButton(root, '[data-action="settings"]');
    this.tutorialsButton = this.mustButton(root, '[data-action="tutorials"]');
    this.starterCampButton = this.mustButton(root, '[data-action="place-starter-camp"]');
    this.buildButton = this.mustButton(root, '[data-action="commit-build"]');
    this.buildMenu = this.mustElement(root, '[data-build-menu]');
    this.buildMenuCards = this.mustElement(root, '[data-build-menu-cards]');
    this.buildMenuCategoryTitle = this.mustElement(root, '[data-build-category-title]');
    this.buildMenuCategoryHint = this.mustElement(root, '[data-build-category-hint]');
    this.buildMenuCategoryButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-build-category]'));
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
    this.constructionDock = this.mustElement(root, '[data-construction-dock]');
    this.zoomStat = this.settlementHud.zoomStat;
    this.builderStatusBar = this.mustElement(root, '[data-builder-status]');
    this.compassHud = new CompassHud(root);

    this.buildMenuToggle = {
      button: this.buildMenuButton,
      hotkey: 'b',
      getActive: () => this.buildMenuOpen,
      setActive: (active) => this.setBuildMenuOpen(active),
    };
    this.dockToggles = [this.buildMenuToggle];
    for (const toggle of this.dockToggles) {
      syncDockToggleButton(toggle);
    }
    this.syncMapOverlayUi();
    window.addEventListener('mousedown', this.onBuildMenuOutsideMouseDown, true);

    this.roadButton.addEventListener('click', () => {
      this.closeAllBuildMenus();
      handlers.onOpenRoads();
    });
    this.buildMenuButton.addEventListener('click', () => toggleDockControl(this.buildMenuToggle));
    for (const button of this.buildMenuCategoryButtons) {
      button.addEventListener('click', () => {
        this.setBuildMenuCategory(button.dataset.buildCategory as BuildMenuCategoryId);
      });
    }
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
    this.bindBuildMenuClicks(this.buildMenu, () => this.setBuildMenuOpen(false));
    this.bindBuildMenuScroll(this.buildMenu);
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
    this.unsubscribeLandUseProfile = subscribeLandUseProfile(() => this.syncMapOverlayLegend());
  }

  setMapOverlaySelection(selection: MapOverlaySelection): void {
    this.applyMapOverlaySelection(selection, false);
  }

  setCommunitySettlements(settlements: Iterable<SettlementState>): void {
    const entries = [...settlements]
      .filter((settlement) => settlement.active)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((settlement) => {
        const color = COMMUNITY_REACH_PALETTE[stableCommunityPaletteIndex(settlement.id)];
        return {
          id: settlement.id,
          name: settlement.name,
          color: `rgb(${color[0]}, ${color[1]}, ${color[2]})`,
        };
      });
    const signature = entries.map((entry) => `${entry.id}:${entry.name}:${entry.color}`).join('|');
    if (signature === this.communityLegendSignature) return;
    this.communityLegendSignature = signature;
    this.communityLegendEntries = entries;
    this.syncMapOverlayLegend();
  }

  setGameplayEnabled(enabled: boolean): void {
    if (this.gameplayEnabled === enabled) return;
    this.gameplayEnabled = enabled;
    this.constructionDock.classList.toggle('is-session-blocked', !enabled);
    this.roadButton.disabled = !enabled;
    this.buildMenuButton.disabled = !enabled;
    this.militaryButton.disabled = !enabled;
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
    if (this.vineyardSuitabilityActive) {
      this.cropSuitabilityTitle.textContent = 'Grape suitability';
      this.cropSuitabilitySubtitle.textContent = 'vineyard harvest potential';
      this.cropSuitabilityLabels.innerHTML = '<span>Poor</span><span>Marginal</span><span>Good</span><span>Prime</span>';
      this.cropSuitabilityDescription.textContent = 'Grapes favor sunny, well-drained slopes with lighter, reasonably deep soil. Wet flat frost pockets and heavy ground reduce real grape and wine output.';
      this.cropSuitabilityLegend.dataset.overlay = 'fertility';
      return;
    }
    if (!this.cropSuitabilityActive && selection.mode === 'communities') {
      this.cropSuitabilityTitle.textContent = 'Community reach';
      this.cropSuitabilitySubtitle.textContent = 'local identity, porous borders';
      this.cropSuitabilityLabels.innerHTML = this.communityLegendEntries.length > 0
        ? this.communityLegendEntries.map((entry) => (
            `<span class="community-legend-chip" data-settlement-id="${escapeToolbarHtml(entry.id)}">`
            + `<i style="--community-color:${entry.color}"></i>${escapeToolbarHtml(entry.name)}</span>`
          )).join('')
        : '<span>Found a community to establish local reach</span>';
      this.cropSuitabilityDescription.textContent = 'Homes and civic anchors shape these administrative communities. Workers, carts, roads, goods, and the realm ledger may cross every boundary.';
      this.cropSuitabilityLegend.dataset.overlay = 'communities';
      return;
    }
    if (!this.cropSuitabilityActive && selection.mode === 'subregions') {
      const profile = getPublishedLandUseProfile();
      this.cropSuitabilityTitle.textContent = 'Realm land use';
      this.cropSuitabilitySubtitle.textContent = 'global affinity shares';
      this.cropSuitabilityLabels.innerHTML = SUBREGION_DEFINITIONS.map((definition) => {
        const share = Math.round((profile?.shares[definition.kind] ?? 0) * 100);
        const bonus = Math.round((profile?.bonuses[definition.kind] ?? 0) * 100);
        const tooltip = `${definition.effect}. Affected building icons show each exact current bonus; placement inside this colored area is not required.`;
        return `<span class="subregion-legend-chip" tabindex="0" data-tooltip-title="${escapeToolbarHtml(`${definition.label} affinity`)}" data-tooltip="${escapeToolbarHtml(tooltip)}">`
          + `<i style="--subregion-color:${definition.color}"></i>`
          + `<b>${definition.label}</b> ${share}% <em>+${bonus}% ${definition.affinity}</em></span>`;
      }).join('');
      this.cropSuitabilityDescription.textContent = 'Shares always total 100% of the realm. Fields, pastures, homes, and industry convert meadow or woodland over time; every listed bonus applies globally.';
      this.cropSuitabilityLegend.dataset.overlay = 'subregions';
      return;
    }
    if (this.cropSuitabilityActive || selection.mode === 'fertility') {
      const crop = this.cropSuitabilityActive
        ? this.currentFarmCrop
        : selection.crop;
      this.cropSuitabilityTitle.textContent = `${cropLabel(crop)} suitability`;
      this.cropSuitabilitySubtitle.textContent = 'first-crop site potential';
      this.cropSuitabilityLabels.innerHTML = '<span>Poor</span><span>Marginal</span><span>Good</span><span>Prime</span>';
      this.cropSuitabilityDescription.textContent = `${cropLabel(crop)} prefers ${cropDefinition(crop).sitePreference}. Broad crop provinces create regional advantages; soil, groundwater, and slope still decide the real yield within them.`;
      this.cropSuitabilityLegend.dataset.overlay = 'fertility';
      return;
    }
    if (selection.mode === 'water') {
      this.cropSuitabilityTitle.textContent = 'Groundwater availability';
      this.cropSuitabilitySubtitle.textContent = this.wellAquiferNetworksEnabled
        ? 'subsurface aquifer network'
        : 'even at every well site';
      this.cropSuitabilityLabels.innerHTML = this.wellAquiferNetworksEnabled
        ? '<span>Dry</span><span>Limited</span><span>Good</span><span>Abundant</span>'
        : '<span>Same reliable yield everywhere</span>';
      this.cropSuitabilityDescription.textContent = this.wellAquiferNetworksEnabled
        ? 'This is the authoritative well-water network. Rivers, sea, ponds, and lakes are intentionally excluded.'
        : 'Aquifer networks are off, so well placement does not change capacity or refill. Surface water remains separate.';
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
    this.wellAquiferNetworksEnabled = stats.wellAquiferNetworksEnabled === true;
    const groundwaterOption = this.overlayModeButtons.find((button) => button.dataset.overlayMode === 'water');
    const groundwaterSubtitle = groundwaterOption?.querySelector<HTMLElement>('small');
    if (groundwaterSubtitle) {
      groundwaterSubtitle.textContent = this.wellAquiferNetworksEnabled
        ? 'Well aquifers'
        : 'Even well water';
    }
    this.availableResourceCosts = stats.availableResources ?? null;
    syncBuildMenuCardAffordability(this.buildMenu, this.availableResourceCosts);
    const placingStarterCamp = this.starterCampRequired && stats.mode === 'founders_camp';
    this.starterCampButton.classList.toggle('is-active', placingStarterCamp);
    this.starterCampButton.setAttribute('aria-pressed', String(placingStarterCamp));
    const roadMode = stats.mode === 'road';
    this.roadButton.classList.toggle('is-active', roadMode);
    this.roadButton.setAttribute('aria-pressed', String(roadMode));
    this.syncBuildMenuButtons();
    this.syncBuildMenuCardActiveState(stats.mode);
    this.buildButton.disabled = !stats.canBuild;
    const wallMode = stats.mode === 'dry-stone-wall';
    const buildActionLabel = wallMode ? 'Build dry-stone wall' : 'Build road';
    const buildActionGuidance = stats.canBuild
      ? `${buildActionLabel} (Enter)`
      : `${buildActionLabel} unavailable. ${describeToolbarStatus(stats)}`;
    this.buildButton.title = buildActionGuidance;
    this.buildButton.setAttribute('aria-label', buildActionGuidance);
    this.buildButton.classList.toggle('is-ready', stats.canBuild);
    this.buildButton.classList.toggle('has-draft', stats.hasDraft);
    const statusState = stats.placementBlocked && !stats.placementResourceShortfall
      ? 'warning'
      : stats.placementReady
        ? 'ready'
        : stats.canBuild
          ? 'ready'
          : isBuilderHudMode(stats.mode)
            ? (stats.hasDraft ? 'draft' : 'active')
            : 'idle';
    const cropSuitabilityVisible = stats.mode === 'farm-fields' && stats.farmCrop != null;
    const vineyardSuitabilityVisible = stats.mode === 'vineyards' && stats.vineyardSuitability === true;
    this.vineyardSuitabilityActive = vineyardSuitabilityVisible;
    this.cropSuitabilityActive = cropSuitabilityVisible || vineyardSuitabilityVisible;
    if (stats.farmCrop != null) this.currentFarmCrop = stats.farmCrop;
    this.overlayButton.disabled = !this.gameplayEnabled || this.cropSuitabilityActive;
    this.overlayButton.dataset.tooltip = this.cropSuitabilityActive
      ? vineyardSuitabilityVisible
        ? 'Grape suitability map is active during vineyard layout'
        : 'Crop suitability map is active during field layout'
      : 'Map overlays (O)';
    if (this.cropSuitabilityActive) this.setOverlayMenuOpen(false);
    this.syncMapOverlayLegend();
    this.builderStatusBar.innerHTML = placingStarterCamp ? '' : renderToolbarStatus(stats);
    this.builderStatusBar.hidden = this.firstPersonActive
      || placingStarterCamp
      || !isBuilderHudMode(stats.mode);
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

  isBuildMenuOpen(): boolean {
    return this.buildMenuOpen;
  }

  setMilitaryMenuOpen(open: boolean): void {
    const allowed = open && this.gameplayEnabled && !this.firstPersonActive && !this.starterCampRequired;
    if (allowed) {
      this.setBuildMenuOpen(false);
      this.setOverlayMenuOpen(false);
      this.toolbarHandlers.onCancelPlacement();
      if (!this.militaryMenu.isOpen) this.onMilitaryMenuOpen?.();
    }
    this.militaryMenu.setOpen(allowed);
    this.militaryButton.setAttribute('aria-expanded', String(allowed));
    this.militaryButton.setAttribute('aria-pressed', String(allowed));
    this.militaryButton.classList.toggle('is-active', allowed);
  }

  selectMilitaryCompanies(ids: readonly string[]): void {
    if (ids.length) this.setMilitaryMenuOpen(true);
    this.militaryMenu.select(ids);
  }

  closeMenusForExternalTool(): void {
    this.closeAllBuildMenus();
    dismissDockToggles(this.dockToggles);
  }

  setFirstPersonMode(active: boolean): void {
    if (this.firstPersonActive === active) return;
    this.firstPersonActive = active;
    this.settlementHud.setFirstPersonActive(active);
    this.root.classList.toggle('is-first-person', active);
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

  setFirstPersonPlacementMode(active: boolean): void {
    if (this.firstPersonPlacementActive === active) return;
    this.firstPersonPlacementActive = active;
    this.root.classList.toggle('is-first-person-placement', active);
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
    this.militaryMenu.dispose();
    this.unsubscribeLandUseProfile();
    this.buildMenuOutsideSecondaryClick.dispose();
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('mousedown', this.onBuildMenuOutsideMouseDown, true);
    window.removeEventListener('pointerdown', this.onDeleteOutsidePointerDown, true);
    for (const cleanup of this.buildMenuScrollCleanups) cleanup();
    this.buildMenuScrollCleanups.length = 0;
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
    return this.buildMenuOpen;
  }

  private closeAllBuildMenus(): void {
    this.setBuildMenuOpen(false);
    this.setOverlayMenuOpen(false);
    this.setMilitaryMenuOpen(false);
  }

  private beginBrowsingBuildMenu(): void {
    this.toolbarHandlers.onCancelPlacement();
    this.setOverlayMenuOpen(false);
    this.setMilitaryMenuOpen(false);
  }

  private setOverlayMenuOpen(open: boolean): void {
    const allowed = open && this.gameplayEnabled && !this.cropSuitabilityActive;
    if (this.overlayMenuOpen === allowed) return;
    if (!allowed) this.buildMenuOutsideSecondaryClick.cancel();
    if (allowed) {
      this.setBuildMenuOpen(false);
      this.setMilitaryMenuOpen(false);
    }
    this.overlayMenuOpen = allowed;
    this.overlayMenu.hidden = !allowed;
    this.overlayButton.classList.toggle('is-open', allowed);
    this.overlayButton.setAttribute('aria-expanded', String(allowed));
    this.syncMapOverlayUi();
  }

  private setBuildMenuOpen(open: boolean): void {
    const allowed = open && this.gameplayEnabled;
    if (this.buildMenuOpen === allowed) return;
    if (!allowed) this.buildMenuOutsideSecondaryClick.cancel();
    if (allowed) {
      this.beginBrowsingBuildMenu();
      hydrateBuildMenuImages(this.buildMenu);
    }
    this.buildMenuOpen = allowed;
    this.buildMenu.hidden = !allowed;
    this.buildMenuButton.setAttribute('aria-expanded', String(allowed));
    syncDockToggleButton(this.buildMenuToggle);
    this.syncBuildMenuButtons();
  }

  private setBuildMenuCategory(categoryId: BuildMenuCategoryId, force = false): void {
    const category = BUILD_MENU_CATEGORIES.find((candidate) => candidate.id === categoryId);
    if (!category || (category.conflictOnly && !this.conflictEnabled)) return;
    if (!force && this.buildMenuCategory === category.id) return;

    this.buildMenuCategory = category.id;
    this.buildMenuCategoryTitle.textContent = category.label;
    this.buildMenuCategoryHint.textContent = category.hint;
    this.buildMenuCards.innerHTML = renderBuildMenuCards(category.entries, { mapSize: this.mapSize });
    const viewport = this.mustElement(this.buildMenu, '[data-build-menu-viewport]');
    viewport.scrollLeft = 0;
    hydrateBuildMenuImages(this.buildMenuCards);
    syncBuildMenuCardAffordability(this.buildMenuCards, this.availableResourceCosts);
    for (const button of this.buildMenuCategoryButtons) {
      const active = button.dataset.buildCategory === category.id;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    this.syncBuildMenuCardActiveState(this.hudMode);
  }

  private syncBuildMenuButtons(): void {
    const activeAction = toolbarModeToMenuAction(this.hudMode);
    const buildToolActive = activeAction != null && BUILD_MENU_ACTION_CATEGORY.has(activeAction);
    const browsing = this.isAnyConstructionMenuOpen();
    this.roadSnapControl.hidden = !browsing;

    this.syncBuildMenuButton(
      this.buildMenuButton,
      this.buildMenuOpen,
      buildToolActive,
      browsing,
    );
  }

  setConflictEnabled(enabled: boolean): void {
    if (this.conflictEnabled === enabled) return;
    this.conflictEnabled = enabled;
    this.settlementHud.setConflictEnabled(enabled);
    const militaryButton = this.buildMenuCategoryButtons.find((button) => button.dataset.buildCategory === 'military');
    if (militaryButton) militaryButton.hidden = !enabled;
    if (!enabled && this.buildMenuCategory === 'military') {
      this.setBuildMenuCategory(DEFAULT_BUILD_MENU_CATEGORY, true);
    }
  }

  setMapSize(mapSize: WorldMapSize): void {
    if (this.mapSize === mapSize) return;
    this.mapSize = mapSize;
    this.setBuildMenuCategory(this.buildMenuCategory, true);
  }

  setSimulationState(
    speed: GameSpeed,
    environment: EnvironmentState,
    outlook?: NextDayEnvironmentOutlook,
    severeWeatherEnabled = false,
  ): void {
    this.settlementHud.setSimulationState(
      speed,
      environment,
      outlook,
      severeWeatherEnabled,
    );
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
    this.syncBuildMenuCards(this.buildMenu, activeAction);
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
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      const action = button.dataset.action as BuildMenuAction | undefined;
      if (!action) return;
      runBuildMenuAction(action, this.toolbarHandlers, closeMenu);
    });
    menu.addEventListener('mousedown', (event) => event.stopPropagation());
    menu.addEventListener('click', (event) => event.stopPropagation());
  }

  private bindBuildMenuScroll(menu: HTMLElement): void {
    const viewport = this.mustElement(menu, '[data-build-menu-viewport]');
    const previous = this.mustButton(menu, '[data-build-menu-scroll="previous"]');
    const next = this.mustButton(menu, '[data-build-menu-scroll="next"]');
    const cards = this.mustElement(menu, '.construction-menu__cards');

    const syncButtons = (): void => {
      const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const canScroll = maxScroll > 1;
      menu.classList.toggle('is-scrollable', canScroll);
      previous.disabled = !canScroll || viewport.scrollLeft <= 1;
      next.disabled = !canScroll || viewport.scrollLeft >= maxScroll - 1;
    };
    const scrollByPage = (direction: -1 | 1): void => {
      const pageWidth = Math.max(280, viewport.clientWidth - 120);
      viewport.scrollBy({ left: direction * pageWidth, behavior: 'smooth' });
    };
    const onPrevious = (): void => scrollByPage(-1);
    const onNext = (): void => scrollByPage(1);
    const onWheel = (event: WheelEvent): void => {
      const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
      if (dominantDelta === 0) return;

      event.preventDefault();
      event.stopPropagation();

      const deltaScale = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? viewport.clientWidth
          : 1;
      viewport.scrollLeft += dominantDelta * deltaScale;
      syncButtons();
    };

    previous.addEventListener('click', onPrevious);
    next.addEventListener('click', onNext);
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('scroll', syncButtons, { passive: true });
    const resizeObserver = new ResizeObserver(syncButtons);
    resizeObserver.observe(viewport);
    resizeObserver.observe(cards);
    requestAnimationFrame(syncButtons);

    this.buildMenuScrollCleanups.push(() => {
      previous.removeEventListener('click', onPrevious);
      next.removeEventListener('click', onNext);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('scroll', syncButtons);
      resizeObserver.disconnect();
    });
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
