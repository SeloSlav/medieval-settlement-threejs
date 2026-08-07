import type { GameState } from '../resources/types.ts';
import type { WorldMapMarker, WorldMapMarkerKind } from './worldMapMarkers.ts';
import type { RiverField } from '../rivers/RiverField.ts';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import { createTerrainMinimapImage } from './createTerrainMinimapImage.ts';
import { RESOURCE_MAP_ICON_HTML } from './resourceMapIconArt.ts';
import {
  describeGeologicalMapMarker,
  geologicalNodeForMapMarker,
} from './geologicalMapMarkerState.ts';
import {
  riverFieldBounds,
  worldDirectionToMapRotation,
  worldToMapPercent,
} from './worldToMapPercent.ts';

export type MinimapFocus = {
  x: number;
  z: number;
  forwardX: number;
  forwardZ: number;
};

type TerrainMinimapOverlayOptions = {
  uiRoot: HTMLElement;
  riverField: RiverField;
  layoutMarkers: readonly WorldMapMarker[];
  getGameState: () => GameState;
  getFocus: () => MinimapFocus;
  isBlocked: () => boolean;
};

type MinimapMarkerEntry = {
  marker: WorldMapMarker;
  element: HTMLElement;
  hidden: boolean;
};

const MARKER_KIND_CLASS: Record<WorldMapMarkerKind, string> = {
  quarry: 'terrain-minimap__marker--quarry',
  game: 'terrain-minimap__marker--game',
  berries: 'terrain-minimap__marker--berries',
  mushrooms: 'terrain-minimap__marker--mushrooms',
  fish: 'terrain-minimap__marker--fish',
  clay: 'terrain-minimap__marker--clay',
  building: 'terrain-minimap__marker--building',
};

export class TerrainMinimapOverlay {
  private readonly options: TerrainMinimapOverlayOptions;
  private readonly root: HTMLElement;
  private readonly mapSurface: HTMLElement;
  private readonly markersRoot: HTMLElement;
  private readonly focusMarker: HTMLElement;
  private readonly bounds: TerrainBounds;
  private readonly layoutMarkerEntries: MinimapMarkerEntry[] = [];
  private readonly buildingMarkerEntries = new Map<string, MinimapMarkerEntry>();
  private visible = false;

  private constructor(options: TerrainMinimapOverlayOptions, bounds: TerrainBounds) {
    this.options = options;
    this.bounds = bounds;

    this.root = document.createElement('div');
    this.root.className = 'terrain-minimap';
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');

    this.root.innerHTML = `
      <div class="terrain-minimap__panel">
        <div class="terrain-minimap__header">
          <span class="terrain-minimap__title">World map</span>
          <span class="terrain-minimap__hint">Hold G</span>
        </div>
        <div class="terrain-minimap__map-wrap">
          <div class="terrain-minimap__map-surface"></div>
          <div class="terrain-minimap__markers"></div>
          <div class="terrain-minimap__focus" aria-hidden="true"></div>
        </div>
      </div>
    `;

    this.mapSurface = this.root.querySelector<HTMLElement>('.terrain-minimap__map-surface')!;
    this.markersRoot = this.root.querySelector<HTMLElement>('.terrain-minimap__markers')!;
    this.focusMarker = this.root.querySelector<HTMLElement>('.terrain-minimap__focus')!;

    for (const marker of options.layoutMarkers) {
      const entry = this.createMarkerEntry(marker);
      this.layoutMarkerEntries.push(entry);
      this.markersRoot.appendChild(entry.element);
    }

    options.uiRoot.appendChild(this.root);
  }

  static create(options: TerrainMinimapOverlayOptions): TerrainMinimapOverlay {
    const overlay = new TerrainMinimapOverlay(options, riverFieldBounds(options.riverField));
    void overlay.loadTerrainImage();
    return overlay;
  }

  tick({ keyHeld }: { keyHeld: boolean }): void {
    const shouldShow = keyHeld && !this.options.isBlocked();
    if (shouldShow !== this.visible) {
      this.visible = shouldShow;
      this.root.hidden = !shouldShow;
      if (shouldShow) {
        this.refreshLayoutMarkerVisibility();
        this.refreshBuildingMarkerPositions();
        this.updateFocusMarker();
      }
      return;
    }

    if (!this.visible) return;
    this.refreshLayoutMarkerVisibility();
    this.updateFocusMarker();
  }

  syncBuildings(markers: readonly WorldMapMarker[]): void {
    const activeIds = new Set<string>();

    for (const marker of markers) {
      activeIds.add(marker.id);
      let entry = this.buildingMarkerEntries.get(marker.id);
      if (!entry) {
        entry = this.createMarkerEntry(marker);
        this.buildingMarkerEntries.set(marker.id, entry);
        this.markersRoot.appendChild(entry.element);
      } else {
        entry.marker = marker;
        entry.element.title = marker.label;
      }
    }

    for (const [id, entry] of this.buildingMarkerEntries) {
      if (activeIds.has(id)) continue;
      entry.element.remove();
      this.buildingMarkerEntries.delete(id);
    }

    if (this.visible) {
      this.refreshBuildingMarkerPositions();
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private async loadTerrainImage(): Promise<void> {
    try {
      const { canvas } = await createTerrainMinimapImage(this.options.riverField);
      this.mapSurface.replaceChildren(canvas);
    } catch (error) {
      console.error('Terrain minimap image failed to load:', error);
    }
  }

  private refreshLayoutMarkerVisibility(): void {
    const state = this.options.getGameState();
    const foragingNodes = state.foragingNodes;
    for (const entry of this.layoutMarkerEntries) {
      // Live rows refine positions and reserve state, but valid generated
      // resources must remain visible while those rows are still hydrating.
      entry.hidden = false;
      const geologicalNode = geologicalNodeForMapMarker(
        entry.marker,
        state.quarries,
      );
      const node = geologicalNode ?? foragingNodes.get(entry.marker.id);
      const geologicalPresentation = geologicalNode
        ? describeGeologicalMapMarker(entry.marker, geologicalNode)
        : null;
      entry.element.classList.toggle(
        'terrain-minimap__marker--depleted',
        geologicalPresentation?.level === 'depleted'
          || Boolean(
            node
            && geologicalNode === undefined
            && node.isRich !== true
            && node.remaining <= 0,
          ),
      );
      for (const level of ['low', 'deep'] as const) {
        entry.element.classList.toggle(
          `terrain-minimap__marker--${level}`,
          geologicalPresentation?.level === level,
        );
      }
      entry.element.dataset.reserveLevel =
        geologicalPresentation?.level ?? 'unknown';
      entry.element.title =
        geologicalPresentation?.label ?? entry.marker.label;
    }
    this.refreshLayoutMarkerPositions();
  }

  private refreshLayoutMarkerPositions(): void {
    for (const entry of this.layoutMarkerEntries) {
      this.placeMarkerEntry(entry);
    }
  }

  private refreshBuildingMarkerPositions(): void {
    for (const entry of this.buildingMarkerEntries.values()) {
      this.placeMarkerEntry(entry);
    }
  }

  private updateFocusMarker(): void {
    const focus = this.options.getFocus();
    const point = worldToMapPercent(focus.x, focus.z, this.bounds);
    this.focusMarker.hidden = false;
    this.focusMarker.style.left = `${point.x}%`;
    this.focusMarker.style.top = `${point.y}%`;
    const rotation = worldDirectionToMapRotation(focus.forwardX, focus.forwardZ);
    this.focusMarker.style.transform = `translate(-50%, -50%) rotate(${rotation}rad)`;
  }

  private placeMarkerEntry(entry: MinimapMarkerEntry): void {
    entry.element.hidden = entry.hidden;
    if (entry.hidden) return;
    const state = this.options.getGameState();
    const node = geologicalNodeForMapMarker(entry.marker, state.quarries)
      ?? state.foragingNodes.get(entry.marker.id);
    const point = worldToMapPercent(
      node?.x ?? entry.marker.x,
      node?.z ?? entry.marker.z,
      this.bounds,
    );
    entry.element.style.left = `${point.x}%`;
    entry.element.style.top = `${point.y}%`;
  }

  private createMarkerEntry(marker: WorldMapMarker): MinimapMarkerEntry {
    const element = document.createElement('span');
    element.className = `terrain-minimap__marker ${MARKER_KIND_CLASS[marker.kind]}`;
    if (marker.kind !== 'building') {
      element.classList.add('terrain-minimap__marker--resource');
      const iconKind = marker.resource === 'iron' || marker.resource === 'salt'
        ? marker.resource
        : marker.kind;
      element.innerHTML = RESOURCE_MAP_ICON_HTML[iconKind];
      if (marker.resource === 'iron' || marker.resource === 'salt') {
        element.classList.add(`terrain-minimap__marker--${marker.resource}`);
      }
      if (marker.kind === 'quarry' && marker.quarryKind === 'large') {
        element.classList.add('terrain-minimap__marker--large');
      }
    }
    element.dataset.kind = marker.kind;
    element.dataset.id = marker.id;
    element.title = marker.label;
    return { marker, element, hidden: false };
  }
}
