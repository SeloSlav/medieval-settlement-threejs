import { CompassHud } from './CompassHud.ts';
import { GameMenu } from './GameMenu.ts';
import type { BurgageLayoutHudState } from '../residences/BurgageTool.ts';
import { isHydrologyOverlayEnabled } from '../scene/hydrologyOverlayPreference.ts';
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
  RURAL_INDUSTRY_BUILD_MENU_ENTRIES,
  renderBuildMenuCards,
  resolveBuildMenuHotkey,
  runBuildMenuAction,
} from './buildMenuCards.ts';
import { toolbarModeToMenuAction } from './buildMenuMapping.ts';
import type { PlacementBuildMenuAction } from './buildMenuCards.ts';
import type { BuildingKind } from '../generated/gameBalance.ts';
import {
  describeBuilderHelp,
  describeBuilderTitle,
  describeToolbarStatus,
  isBuilderHudMode,
  type ToolbarStats,
} from './buildToolbarStatus.ts';
import { SettlementHud } from './SettlementHud.ts';
import type { EnvironmentState } from '../world/seasonPolicy.ts';
import type { GameSpeed } from '../world/gameSpeed.ts';

export type { ToolbarStats };

const BASIC_BUILD_MENU_ACTIONS = new Set(BASIC_BUILD_MENU_ENTRIES.map((entry) => entry.action));
const AGRICULTURE_BUILD_MENU_ACTIONS = new Set(AGRICULTURE_BUILD_MENU_ENTRIES.map((entry) => entry.action));
const RURAL_INDUSTRY_BUILD_MENU_ACTIONS = new Set(RURAL_INDUSTRY_BUILD_MENU_ENTRIES.map((entry) => entry.action));

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
  private readonly waterOverlayButton: HTMLButtonElement;
  private readonly cityAdminButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly buildButton: HTMLButtonElement;
  private readonly basicBuildMenu: HTMLElement;
  private readonly agricultureBuildMenu: HTMLElement;
  private readonly ruralIndustryBuildMenu: HTMLElement;
  private readonly builderControlsPanel: HTMLElement;
  private readonly burgageLayoutHud: HTMLElement;
  private readonly burgagePlotDecreaseButton: HTMLButtonElement;
  private readonly burgagePlotIncreaseButton: HTMLButtonElement;
  private readonly burgagePlotCountLabel: HTMLElement;
  private readonly burgagePlotMaxLabel: HTMLElement;
  private readonly burgageRotateFrontageButton: HTMLButtonElement;
  private readonly burgageFrontageLabel: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly deletePopup: HTMLElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly cancelDeleteButton: HTMLButtonElement;
  readonly settlementHud: SettlementHud;
  private readonly fpModePanel: HTMLElement;
  private readonly constructionDock: HTMLElement;
  private readonly zoomStat: HTMLElement;
  private readonly builderPanelTitle: HTMLElement;
  private readonly builderHelpList: HTMLElement;
  private readonly builderStatusBar: HTMLElement;
  private readonly root: HTMLElement;
  private readonly compassHud: CompassHud;
  private gameMenu: GameMenu | null = null;
  private firstPersonActive = false;
  private basicBuildMenuOpen = false;
  private agricultureBuildMenuOpen = false;
  private ruralIndustryBuildMenuOpen = false;
  private waterOverlayActive = false;
  private buildButtonVisible = false;
  private burgageLayoutHudVisible = false;
  private lastBuildLeft = Number.NaN;
  private lastBuildTop = Number.NaN;
  private lastHudLeft = Number.NaN;
  private lastHudTop = Number.NaN;
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
  private readonly waterOverlayToggle: DockToggle;
  private readonly dockToggles: DockToggle[];
  private readonly toolbarHandlers: BuildMenuHandlers & {
    onOpenRoads: () => void;
    onSetWaterOverlay?: (active: boolean) => void;
  };
  private readonly onToggleCityAdministration: () => void;
  private cityAdministrationOpen = false;
  private gameplayEnabled = true;
  private readonly requestGameSpeed: (speed: GameSpeed) => void;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || this.firstPersonActive || this.isGameMenuOpen()) return;
    if (!this.gameplayEnabled) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    const key = event.key.toLowerCase();
    const speed = key === '1' ? 1 : key === '2' ? 4 : key === '3' ? 12 : null;
    if (speed !== null) {
      event.preventDefault();
      event.stopPropagation();
      this.requestGameSpeed(speed);
      return;
    }
    if (key === 'escape') {
      if (dismissDockToggles(this.dockToggles)) {
        event.preventDefault();
        event.stopPropagation();
      }
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
      onSelectResidences: () => void;
      onToggleCityAdministration: () => void;
      onSetWaterOverlay?: (active: boolean) => void;
      onBurgagePlotDecrease?: () => void;
      onBurgagePlotIncrease?: () => void;
      onBurgageRotateFrontage?: () => void;
      onMenuOpenChange?: (open: boolean) => void;
      onShadowPreferenceChange?: () => void;
      canOpenMenuFromKeyboard?: () => boolean;
      onNewWorld?: () => void;
      onGrantCheatResources?: (amount: number) => Promise<void>;
      onSetGameSpeed?: (speed: GameSpeed) => void;
    },
  ) {
    root.innerHTML = `
      <div class="hud-right-stack">

        <aside class="road-controls-panel" data-road-controls-panel aria-label="Active tool controls" hidden>
          <header class="road-controls-header">
            <div>
              <p class="road-controls-eyebrow">Builder</p>
              <h2 class="road-controls-title">Roads</h2>
              <p class="road-controls-status" data-road-status>Road tool off</p>
            </div>
          </header>

          <section class="road-controls-help" aria-label="Active tool shortcuts">
            <h3 class="road-controls-help-title">Controls</h3>
            <ul class="road-controls-list">
              <li><span>Toggle road tool</span><span class="road-controls-key">R</span></li>
              <li><span>Place point</span><span class="road-controls-key">L-click</span></li>
              <li><span>Undo last point</span><span class="road-controls-key">R-click</span></li>
              <li><span>Curve segment</span><span class="road-controls-key">Ctrl + scroll</span></li>
              <li><span>Build road</span><span class="road-controls-key">Hammer or Enter</span></li>
              <li><span>Delete segment</span><span class="road-controls-key">Alt + L-click</span></li>
              <li><span>Undo change</span><span class="road-controls-key">Ctrl + Z</span></li>
              <li><span>Redo change</span><span class="road-controls-key">Ctrl + Y</span></li>
              <li><span>Cancel / exit</span><span class="road-controls-key">Esc</span></li>
            </ul>
          </section>
        </aside>
      </div>

      <div class="hud-bottom-center" data-hud-bottom-center>
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

        <div class="hud-bottom-messages" data-hud-bottom-messages aria-live="polite">
          <div class="builder-status-bar" data-builder-status hidden></div>
        </div>

        <nav class="construction-dock" data-construction-dock aria-label="Construction tools">
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="road" data-tooltip="Roads (R)" aria-label="Roads (R)" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 21c4.8-4.8 5.2-12.2 1-18" />
            <path d="M15 21c-2.8-5.7-2.2-11.6 2-18" />
            <path d="M12 6.5h1" />
            <path d="M12 11.5h1" />
            <path d="M12 16.5h1" />
          </svg>
          <span class="construction-dock-button__hotkey" aria-hidden="true">R</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="basic-build-menu" data-tooltip="Build (B)" aria-label="Build menu (B)" aria-controls="basic-build-menu" aria-haspopup="true" aria-expanded="false" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.5 5.5l4 4" />
            <path d="M12.3 7.7l4-4 3.9 3.9-4 4" />
            <path d="M14.8 10.8L6.4 19.2a2.1 2.1 0 0 1-3-3l8.4-8.4" />
          </svg>
          <span class="construction-dock-button__hotkey" aria-hidden="true">B</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="agriculture-build-menu" data-tooltip="Agriculture (U)" aria-label="Agriculture menu (U)" aria-controls="agriculture-build-menu" aria-haspopup="true" aria-expanded="false" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v18" />
            <path d="M8 7c2-2 6-2 8 0" />
            <path d="M7 12c2.5-3 7.5-3 10 0" />
            <path d="M6 17c3-3 9-3 12 0" />
          </svg>
          <span class="construction-dock-button__hotkey" aria-hidden="true">U</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="industry-build-menu" data-tooltip="Industry (V)" aria-label="Industry menu (V)" aria-controls="industry-build-menu" aria-haspopup="true" aria-expanded="false" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 18h18" />
            <path d="M7 18V11h10v7" />
            <path d="M10 11V8h4v3" />
            <path d="M12 6v2" />
          </svg>
          <span class="construction-dock-button__hotkey" aria-hidden="true">V</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey construction-dock-button--water" data-action="water-overlay" data-tooltip="Water map (M)" aria-label="Water map (M)" aria-pressed="false">
          <span class="construction-dock-button__icon" aria-hidden="true">💧</span>
          <span class="construction-dock-button__hotkey" aria-hidden="true">M</span>
        </button>
        <button type="button" class="construction-dock-button construction-dock-button--hotkey" data-action="city-admin" data-tooltip="Select Town Hall administration (I)" aria-label="Select Town Hall administration (I)" aria-pressed="false">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 4 7v14h16V7l-8-4Z" />
            <path d="M9 21v-6h6v6" />
            <path d="M10 10h4" />
            <path d="M10 13h4" />
          </svg>
          <span class="construction-dock-button__hotkey" aria-hidden="true">I</span>
        </button>
        <button type="button" class="construction-dock-button" data-action="settings" data-tooltip="Settings (Esc)" aria-label="Settings (Esc)">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z" />
            <path d="M19.4 13.5a7.8 7.8 0 0 0 0-3l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.6A8 8 0 0 0 7 6.6l-2.4-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.4 2.6h4l.4-2.6a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5Z" />
          </svg>
        </button>
      </nav>
      </div>

      <button type="button" class="road-tool-button icon-button floating-build-button" data-action="commit-build" title="Build road (Enter)" aria-label="Build road" disabled hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14.5 5.5l4 4" />
          <path d="M12.3 7.7l4-4 3.9 3.9-4 4" />
          <path d="M14.8 10.8L6.4 19.2a2.1 2.1 0 0 1-3-3l8.4-8.4" />
        </svg>
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

    `;

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
      onSetWaterOverlay: handlers.onSetWaterOverlay,
    };
    window.addEventListener('keydown', this.onKeyDown, true);
    this.gameMenu = new GameMenu(root, {
      onShadowPreferenceChange: () => handlers.onShadowPreferenceChange?.(),
      onOpenChange: handlers.onMenuOpenChange,
      canOpenFromKeyboard: handlers.canOpenMenuFromKeyboard,
      onNewWorld: handlers.onNewWorld,
      onGrantCheatResources: handlers.onGrantCheatResources,
      showButton: false,
    });

    this.roadButton = this.mustButton(root, '[data-action="road"]');
    this.basicBuildMenuButton = this.mustButton(root, '[data-action="basic-build-menu"]');
    this.agricultureBuildMenuButton = this.mustButton(root, '[data-action="agriculture-build-menu"]');
    this.ruralIndustryBuildMenuButton = this.mustButton(root, '[data-action="industry-build-menu"]');
    this.waterOverlayButton = this.mustButton(root, '[data-action="water-overlay"]');
    this.cityAdminButton = this.mustButton(root, '[data-action="city-admin"]');
    this.settingsButton = this.mustButton(root, '[data-action="settings"]');
    this.buildButton = this.mustButton(root, '[data-action="commit-build"]');
    this.basicBuildMenu = this.mustElement(root, '[data-build-menu="basic"]');
    this.agricultureBuildMenu = this.mustElement(root, '[data-build-menu="agriculture"]');
    this.ruralIndustryBuildMenu = this.mustElement(root, '[data-build-menu="industry"]');
    this.builderControlsPanel = this.mustElement(root, '[data-road-controls-panel]');
    this.builderPanelTitle = this.mustElement(this.builderControlsPanel, '.road-controls-title');
    this.builderHelpList = this.mustElement(this.builderControlsPanel, '.road-controls-list');
    this.burgageLayoutHud = this.mustElement(root, '[data-burgage-layout-hud]');
    this.burgagePlotDecreaseButton = this.mustButton(root, '[data-action="burgage-plot-decrease"]');
    this.burgagePlotIncreaseButton = this.mustButton(root, '[data-action="burgage-plot-increase"]');
    this.burgagePlotCountLabel = this.mustElement(root, '[data-burgage-plot-count]');
    this.burgagePlotMaxLabel = this.mustElement(root, '[data-burgage-plot-max]');
    this.burgageRotateFrontageButton = this.mustButton(root, '[data-action="burgage-rotate-frontage"]');
    this.burgageFrontageLabel = this.mustElement(root, '[data-burgage-frontage-label]');
    this.statusLabel = this.mustElement(root, '[data-road-status]');
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
    this.waterOverlayToggle = {
      button: this.waterOverlayButton,
      hotkey: 'm',
      getActive: () => this.waterOverlayActive,
      setActive: (active) => this.applyWaterOverlay(active),
    };
    this.dockToggles = [
      this.basicBuildMenuToggle,
      this.agricultureBuildMenuToggle,
      this.ruralIndustryBuildMenuToggle,
      this.waterOverlayToggle,
    ];
    this.waterOverlayActive = isHydrologyOverlayEnabled();
    for (const toggle of this.dockToggles) {
      syncDockToggleButton(toggle);
    }
    window.addEventListener('mousedown', this.onBuildMenuOutsideMouseDown, true);

    this.syncBuilderControlsPanel();
    this.roadButton.addEventListener('click', () => {
      this.closeAllBuildMenus();
      handlers.onOpenRoads();
    });
    this.basicBuildMenuButton.addEventListener('click', () => toggleDockControl(this.basicBuildMenuToggle));
    this.agricultureBuildMenuButton.addEventListener('click', () => toggleDockControl(this.agricultureBuildMenuToggle));
    this.ruralIndustryBuildMenuButton.addEventListener('click', () => toggleDockControl(this.ruralIndustryBuildMenuToggle));
    this.waterOverlayButton.addEventListener('click', () => toggleDockControl(this.waterOverlayToggle));
    this.cityAdminButton.addEventListener('click', () => {
      this.closeAllBuildMenus();
      this.onToggleCityAdministration();
    });
    this.settingsButton.addEventListener('click', () => {
      this.closeAllBuildMenus();
      this.gameMenu?.toggle();
    });
    this.bindBuildMenuClicks(this.basicBuildMenu, () => this.setBasicBuildMenuOpen(false));
    this.bindBuildMenuClicks(this.agricultureBuildMenu, () => this.setAgricultureBuildMenuOpen(false));
    this.bindBuildMenuClicks(this.ruralIndustryBuildMenu, () => this.setRuralIndustryBuildMenuOpen(false));
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

  setWaterOverlayActive(active: boolean): void {
    this.applyWaterOverlay(active, false);
  }

  setGameplayEnabled(enabled: boolean): void {
    if (this.gameplayEnabled === enabled) return;
    this.gameplayEnabled = enabled;
    this.constructionDock.classList.toggle('is-session-blocked', !enabled);
    this.roadButton.disabled = !enabled;
    this.basicBuildMenuButton.disabled = !enabled;
    this.agricultureBuildMenuButton.disabled = !enabled;
    this.ruralIndustryBuildMenuButton.disabled = !enabled;
    this.waterOverlayButton.disabled = !enabled;
    this.cityAdminButton.disabled = !enabled;
    this.settlementHud.setSpeedControlsEnabled(enabled);
    if (!enabled) {
      this.closeAllBuildMenus();
      dismissDockToggles(this.dockToggles);
      if (this.waterOverlayActive) {
        this.applyWaterOverlay(false);
      }
    }
  }

  private applyWaterOverlay(active: boolean, notify = true): void {
    if (this.waterOverlayActive === active) {
      syncDockToggleButton(this.waterOverlayToggle);
      return;
    }
    this.waterOverlayActive = active;
    syncDockToggleButton(this.waterOverlayToggle);
    if (notify) {
      this.toolbarHandlers.onSetWaterOverlay?.(active);
    }
  }

  setStats(stats: ToolbarStats): void {
    this.hudMode = stats.mode;
    const roadMode = stats.mode === 'road';
    this.roadButton.classList.toggle('is-active', roadMode);
    this.roadButton.setAttribute('aria-pressed', String(roadMode));
    this.syncBuildMenuButtons();
    this.syncBuildMenuCardActiveState(stats.mode);
    this.buildButton.disabled = !stats.canBuild;
    this.buildButton.classList.toggle('is-ready', stats.canBuild);
    this.buildButton.classList.toggle('has-draft', stats.hasDraft);
    this.statusLabel.textContent = describeToolbarStatus(stats);
    this.statusLabel.dataset.state = stats.canBuild
      ? 'ready'
      : isBuilderHudMode(stats.mode)
        ? (stats.hasDraft ? 'draft' : 'active')
        : 'idle';
    if (isBuilderHudMode(stats.mode)) {
      this.builderPanelTitle.textContent = describeBuilderTitle(stats.mode);
      this.builderHelpList.innerHTML = describeBuilderHelp(stats.mode);
    }
    const statusText = describeToolbarStatus(stats);
    this.builderStatusBar.textContent = statusText;
    this.builderStatusBar.hidden = this.firstPersonActive || !isBuilderHudMode(stats.mode);
    this.builderStatusBar.dataset.state = this.statusLabel.dataset.state;
    this.syncBuilderControlsPanel();
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

    const plotLabel = state.plotCount === 1 ? 'plot' : 'plots';
    const residenceHint = state.residenceCount != null && state.residenceCount !== state.plotCount
      ? ` · ${state.residenceCount} fit`
      : '';
    this.burgagePlotCountLabel.textContent = state.plotCount.toString();
    this.burgagePlotMaxLabel.textContent = `${plotLabel} / ${state.maxPlotCount} max${residenceHint}`;
    this.burgagePlotDecreaseButton.disabled = !state.canDecrease;
    this.burgagePlotIncreaseButton.disabled = !state.canIncrease;
    this.burgageLayoutHud.dataset.state = state.valid ? 'ready' : 'warning';

    const showFrontage = state.canRotateFrontage && state.frontageLabel != null;
    this.burgageRotateFrontageButton.hidden = !showFrontage;
    if (showFrontage) {
      this.burgageFrontageLabel.textContent = state.frontageLabel;
    }

    this.burgageLayoutHud.hidden = false;
    this.burgageLayoutHudVisible = true;

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
    this.root.classList.toggle('is-first-person', active);
    this.fpModePanel.classList.toggle('is-active', active);
    this.constructionDock.hidden = active;
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
    this.syncBuilderControlsPanel();
  }

  private syncBuilderControlsPanel(): void {
    this.builderControlsPanel.hidden = this.firstPersonActive || !isBuilderHudMode(this.hudMode);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('mousedown', this.onBuildMenuOutsideMouseDown, true);
    window.removeEventListener('pointerdown', this.onDeleteOutsidePointerDown, true);
    this.gameMenu?.dispose();
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
    return this.basicBuildMenuOpen || this.agricultureBuildMenuOpen || this.ruralIndustryBuildMenuOpen;
  }

  private closeAllBuildMenus(): void {
    this.setBasicBuildMenuOpen(false);
    this.setAgricultureBuildMenuOpen(false);
    this.setRuralIndustryBuildMenuOpen(false);
  }

  private closeOtherBuildMenus(except: 'basic' | 'agriculture' | 'industry'): void {
    if (except !== 'basic') this.setBasicBuildMenuOpen(false);
    if (except !== 'agriculture') this.setAgricultureBuildMenuOpen(false);
    if (except !== 'industry') this.setRuralIndustryBuildMenuOpen(false);
  }

  private setBasicBuildMenuOpen(open: boolean): void {
    if (this.basicBuildMenuOpen === open) return;
    if (open) this.closeOtherBuildMenus('basic');
    this.basicBuildMenuOpen = open;
    this.basicBuildMenu.hidden = !open;
    this.basicBuildMenuButton.setAttribute('aria-expanded', String(open));
    syncDockToggleButton(this.basicBuildMenuToggle);
    this.syncBuildMenuButtons();
  }

  private setAgricultureBuildMenuOpen(open: boolean): void {
    if (this.agricultureBuildMenuOpen === open) return;
    if (open) this.closeOtherBuildMenus('agriculture');
    this.agricultureBuildMenuOpen = open;
    this.agricultureBuildMenu.hidden = !open;
    this.agricultureBuildMenuButton.setAttribute('aria-expanded', String(open));
    syncDockToggleButton(this.agricultureBuildMenuToggle);
    this.syncBuildMenuButtons();
  }

  private setRuralIndustryBuildMenuOpen(open: boolean): void {
    if (this.ruralIndustryBuildMenuOpen === open) return;
    if (open) this.closeOtherBuildMenus('industry');
    this.ruralIndustryBuildMenuOpen = open;
    this.ruralIndustryBuildMenu.hidden = !open;
    this.ruralIndustryBuildMenuButton.setAttribute('aria-expanded', String(open));
    syncDockToggleButton(this.ruralIndustryBuildMenuToggle);
    this.syncBuildMenuButtons();
  }

  private syncBuildMenuButtons(): void {
    const activeAction = toolbarModeToMenuAction(this.hudMode);
    const basicConstruction = activeAction != null && BASIC_BUILD_MENU_ACTIONS.has(activeAction);
    const agricultureConstruction = activeAction != null && AGRICULTURE_BUILD_MENU_ACTIONS.has(activeAction);
    const ruralIndustryConstruction = activeAction != null && RURAL_INDUSTRY_BUILD_MENU_ACTIONS.has(activeAction);
    const browsing = this.isAnyBuildMenuOpen();

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
  }

  setSimulationState(speed: GameSpeed, environment: EnvironmentState): void {
    this.settlementHud.setSimulationState(speed, environment);
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
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element?.isContentEditable);
}
