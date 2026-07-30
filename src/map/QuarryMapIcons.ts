import * as THREE from 'three';
import type { WorldMapMarker } from './worldMapMarkers.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import type { ResourceNodeState } from '../resources/types.ts';
import {
  beginMapIconFrame,
  createMapIconRoot,
  placeProjectedMapButton,
} from './mapIconProjection.ts';
import {
  describeGeologicalMapMarker,
  geologicalNodeForMapMarker,
} from './geologicalMapMarkerState.ts';
import {
  IRON_ICON_HTML,
  QUARRY_ICON_HTML,
  SALT_ICON_HTML,
} from './resourceMapIconArt.ts';

type QuarryMapIconsOptions = {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  terrain: Terrain;
  markers: readonly WorldMapMarker[];
  getGeologicalNodes: () => Map<string, ResourceNodeState>;
  getCamera: () => THREE.PerspectiveCamera | null;
  getZoomPercent: () => number;
  onQuarrySelect: (quarryId: string) => void;
  isBlocked: () => boolean;
  isVisibilityBlocked?: () => boolean;
};

type QuarryIconEntry = {
  marker: WorldMapMarker;
  button: HTMLButtonElement;
  worldPoint: THREE.Vector3;
};

export class QuarryMapIcons {
  private readonly options: QuarryMapIconsOptions;
  private readonly root: HTMLElement;
  private readonly entries: QuarryIconEntry[];

  constructor(options: QuarryMapIconsOptions) {
    this.options = options;
    this.root = createMapIconRoot(options.uiRoot, 'quarry-map-icons');

    this.entries = options.markers.map((marker) => ({
      marker,
      button: this.createIconButton(marker),
      worldPoint: new THREE.Vector3(),
    }));

    for (const entry of this.entries) {
      this.root.appendChild(entry.button);
    }
  }

  update(): void {
    const interactionBlocked = this.options.isBlocked();
    this.root.classList.toggle('is-interaction-blocked', interactionBlocked);
    const frame = beginMapIconFrame(
      this.root,
      this.options.domElement,
      this.options.terrain,
      this.options.getCamera,
      this.options.getZoomPercent,
      this.options.isVisibilityBlocked ?? this.options.isBlocked,
    );
    if (!frame) return;

    const nodes = this.options.getGeologicalNodes();
    for (const entry of this.entries) {
      const { marker, button, worldPoint } = entry;
      const node = geologicalNodeForMapMarker(marker, nodes);
      const presentation = describeGeologicalMapMarker(marker, node);
      button.dataset.tooltip = presentation.label;
      button.dataset.reserveLevel = presentation.level;
      button.setAttribute('aria-label', presentation.label);
      for (const level of ['low', 'depleted', 'deep'] as const) {
        button.classList.toggle(
          `quarry-map-icon--${level}`,
          presentation.level === level,
        );
      }
      placeProjectedMapButton(
        button,
        node?.x ?? marker.x,
        node?.z ?? marker.z,
        worldPoint,
        frame,
      );
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private createIconButton(marker: WorldMapMarker): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quarry-map-icon';
    button.dataset.quarryId = marker.id;
    button.dataset.tooltip = marker.label;
    button.setAttribute('aria-label', marker.label);
    button.hidden = true;

    if (marker.quarryKind === 'large') {
      button.classList.add('quarry-map-icon--large');
    }
    if (marker.resource === 'iron' || marker.resource === 'salt') {
      button.classList.add(`quarry-map-icon--${marker.resource}`);
    }

    button.innerHTML = marker.resource === 'iron'
      ? IRON_ICON_HTML
      : marker.resource === 'salt'
        ? SALT_ICON_HTML
        : QUARRY_ICON_HTML;
    button.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      if (this.options.isBlocked()) return;
      event.preventDefault();
      event.stopPropagation();
      this.options.onQuarrySelect(marker.id);
    });

    return button;
  }
}
