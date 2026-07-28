import * as THREE from 'three';
import type { WorldMapMarker } from './worldMapMarkers.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  beginMapIconFrame,
  createMapIconRoot,
  placeProjectedMapButton,
} from './mapIconProjection.ts';
import { QUARRY_ICON_SVG } from './resourceMapIconGlyphs.ts';

type QuarryMapIconsOptions = {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  terrain: Terrain;
  markers: readonly WorldMapMarker[];
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

    for (const entry of this.entries) {
      const { marker, button, worldPoint } = entry;
      placeProjectedMapButton(button, marker.x, marker.z, worldPoint, frame);
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

    button.innerHTML = QUARRY_ICON_SVG;
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
