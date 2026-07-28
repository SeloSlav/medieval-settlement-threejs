import * as THREE from 'three';
import type { ForagingNodeState } from '../resources/types.ts';
import type { WorldMapMarker } from './worldMapMarkers.ts';
import { isWorldMapForagingMarkerVisible } from './worldMapMarkers.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  beginMapIconFrame,
  createMapIconRoot,
  placeProjectedMapButton,
} from './mapIconProjection.ts';
import {
  BERRY_ICON_SVG,
  FISH_ICON_SVG,
  GAME_ICON_SVG,
  MUSHROOM_ICON_SVG,
} from './resourceMapIconGlyphs.ts';

type ForagingMapIconsOptions = {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  terrain: Terrain;
  markers: readonly WorldMapMarker[];
  getForagingNodes: () => Map<string, ForagingNodeState>;
  getCamera: () => THREE.PerspectiveCamera | null;
  getZoomPercent: () => number;
  onForagingSelect: (nodeId: string) => void;
  isBlocked: () => boolean;
  isVisibilityBlocked?: () => boolean;
};

type ForagingIconEntry = {
  marker: WorldMapMarker;
  button: HTMLButtonElement;
  worldPoint: THREE.Vector3;
};

export class ForagingMapIcons {
  private readonly options: ForagingMapIconsOptions;
  private readonly root: HTMLElement;
  private readonly entries: ForagingIconEntry[];

  constructor(options: ForagingMapIconsOptions) {
    this.options = options;
    this.root = createMapIconRoot(options.uiRoot, 'foraging-map-icons');

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

    const nodes = this.options.getForagingNodes();

    for (const entry of this.entries) {
      const { marker, button, worldPoint } = entry;
      if (!isWorldMapForagingMarkerVisible(marker, nodes)) {
        button.hidden = true;
        continue;
      }

      const node = nodes.get(marker.id);
      button.classList.toggle('foraging-map-icon--depleted', (node?.remaining ?? 0) <= 0);
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
    button.className = 'foraging-map-icon';
    button.dataset.foragingId = marker.id;
    button.dataset.tooltip = marker.label;
    button.setAttribute('aria-label', marker.label);
    button.hidden = true;

    if (marker.kind === 'game') {
      button.classList.add('foraging-map-icon--game');
      button.innerHTML = GAME_ICON_SVG;
    } else if (marker.kind === 'berries') {
      button.classList.add('foraging-map-icon--berries');
      button.innerHTML = BERRY_ICON_SVG;
    } else if (marker.kind === 'mushrooms') {
      button.classList.add('foraging-map-icon--mushrooms');
      button.innerHTML = MUSHROOM_ICON_SVG;
    } else {
      button.classList.add('foraging-map-icon--fish');
      button.innerHTML = FISH_ICON_SVG;
    }

    button.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      if (this.options.isBlocked()) return;
      event.preventDefault();
      event.stopPropagation();
      this.options.onForagingSelect(marker.id);
    });

    return button;
  }
}
