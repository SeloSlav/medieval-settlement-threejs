import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import type { GameState } from '../resources/types.ts';
import {
  beginMapIconFrame,
  createMapIconRoot,
  placeProjectedMapButton,
} from './mapIconProjection.ts';
import {
  deriveSettlementMapMarkers,
  type PersistentSettlementMapMarker,
} from './settlementMapMarker.ts';
import { SETTLEMENT_MAP_ICON_HTML } from './settlementMapIconArt.ts';
import {
  getMapOverlaySelection,
  subscribeMapOverlayPreference,
} from '../scene/mapOverlayPreference.ts';
import {
  COMMUNITY_REACH_PALETTE,
  stableCommunityPaletteIndex,
} from '../settlement/CommunityReachRaster.ts';

type SettlementMapIconsOptions = {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  terrain: Terrain;
  getState: () => GameState;
  getCamera: () => THREE.PerspectiveCamera | null;
  getZoomPercent: () => number;
  onSettlementSelect: (settlementId: string) => void;
  onSettlementRename?: (settlementId: string) => void;
  isBlocked: () => boolean;
  isVisibilityBlocked?: () => boolean;
};

type SettlementIconEntry = {
  marker: PersistentSettlementMapMarker;
  button: HTMLButtonElement;
  worldPoint: THREE.Vector3;
};

/** Projected, persistent town labels backed by Settlement rows rather than camp lifetime. */
export class SettlementMapIcons {
  private readonly options: SettlementMapIconsOptions;
  private readonly root: HTMLElement;
  private readonly entries = new Map<string, SettlementIconEntry>();
  private lastSettlements: GameState['settlements'] | null = null;
  private lastBuildings: GameState['buildings'] | null = null;
  private lastResidences: GameState['residences'] | null = null;
  private communityOverlayActive = getMapOverlaySelection().mode === 'communities';
  private readonly unsubscribeOverlay: () => void;

  constructor(options: SettlementMapIconsOptions) {
    this.options = options;
    this.root = createMapIconRoot(options.uiRoot, 'settlement-map-icons');
    this.root.removeAttribute('aria-hidden');
    this.unsubscribeOverlay = subscribeMapOverlayPreference(() => {
      this.communityOverlayActive = getMapOverlaySelection().mode === 'communities';
    });
  }

  update(getFrameRect?: () => DOMRect): void {
    this.syncEntries();
    const visibilityBlocked = this.options.isVisibilityBlocked?.() ?? this.options.isBlocked();
    const frame = beginMapIconFrame(
      this.root,
      this.options.domElement,
      this.options.terrain,
      this.options.getCamera,
      this.options.getZoomPercent,
      () => visibilityBlocked,
      getFrameRect,
      this.communityOverlayActive,
    );
    if (!frame) return;
    for (const entry of this.entries.values()) {
      placeProjectedMapButton(
        entry.button,
        entry.marker.x,
        entry.marker.z,
        entry.worldPoint,
        frame,
      );
    }
  }

  dispose(): void {
    this.unsubscribeOverlay();
    this.root.remove();
  }

  private syncEntries(): void {
    const state = this.options.getState();
    if (
      this.lastSettlements === state.settlements
      && this.lastBuildings === state.buildings
      && this.lastResidences === state.residences
    ) return;
    this.lastSettlements = state.settlements;
    this.lastBuildings = state.buildings;
    this.lastResidences = state.residences;
    const markers = deriveSettlementMapMarkers({
      settlements: state.settlements.values(),
      buildings: state.buildings.values(),
      residences: state.residences.values(),
    });
    const liveIds = new Set(markers.map((marker) => marker.settlementId));
    for (const [id, entry] of this.entries) {
      if (liveIds.has(id)) continue;
      entry.button.remove();
      this.entries.delete(id);
    }
    for (const marker of markers) {
      const entry = this.entries.get(marker.settlementId);
      if (entry) {
        entry.marker = marker;
        this.syncButton(entry.button, marker);
        continue;
      }
      const button = this.createButton(marker);
      this.entries.set(marker.settlementId, {
        marker,
        button,
        worldPoint: new THREE.Vector3(),
      });
      this.root.appendChild(button);
    }
  }

  private createButton(marker: PersistentSettlementMapMarker): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'settlement-map-icon';
    button.hidden = true;
    button.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || this.options.isBlocked()) return;
      event.preventDefault();
      event.stopPropagation();
      const settlementId = button.dataset.settlementId;
      if (!settlementId) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-settlement-map-rename]')) {
        this.options.onSettlementRename?.(settlementId);
      } else {
        this.options.onSettlementSelect(settlementId);
      }
    });
    this.syncButton(button, marker);
    return button;
  }

  private syncButton(button: HTMLButtonElement, marker: PersistentSettlementMapMarker): void {
    button.dataset.settlementId = marker.settlementId;
    button.dataset.tooltip = marker.label;
    button.setAttribute('aria-label', `Open ${marker.name} community report. ${marker.label}`);
    button.dataset.tier = marker.tier;
    const color = COMMUNITY_REACH_PALETTE[stableCommunityPaletteIndex(marker.settlementId)];
    button.style.setProperty('--settlement-color', `rgb(${color[0]}, ${color[1]}, ${color[2]})`);
    button.innerHTML = `<span class="settlement-map-icon__art">${SETTLEMENT_MAP_ICON_HTML[marker.tier]}</span><strong data-settlement-map-rename title="Rename ${escapeHtml(marker.name)}">${escapeHtml(marker.name)}</strong>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character] ?? character);
}
