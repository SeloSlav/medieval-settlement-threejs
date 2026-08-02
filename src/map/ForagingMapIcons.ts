import * as THREE from 'three';
import type {
  ForagingNodeState,
  ResourceNodeState,
} from '../resources/types.ts';
import type { WorldMapMarker } from './worldMapMarkers.ts';
import { isWorldMapForagingMarkerVisible } from './worldMapMarkers.ts';
import type { Terrain } from '../terrain/Terrain.ts';
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
  BERRY_ICON_HTML,
  CLAY_ICON_HTML,
  FISH_ICON_HTML,
  GAME_ICON_HTML,
  MUSHROOM_ICON_HTML,
} from './resourceMapIconArt.ts';

type ForagingMapIconsOptions = {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  terrain: Terrain;
  markers: readonly WorldMapMarker[];
  getForagingNodes: () => Map<string, ForagingNodeState>;
  getGeologicalNodes: () => Map<string, ResourceNodeState>;
  getCamera: () => THREE.PerspectiveCamera | null;
  getZoomPercent: () => number;
  onForagingSelect: (nodeId: string) => void;
  onClaySelect?: (x: number, z: number) => void;
  isBlocked: () => boolean;
  isVisibilityBlocked?: () => boolean;
};

type ForagingIconEntry = {
  marker: WorldMapMarker;
  button: HTMLButtonElement;
  worldPoint: THREE.Vector3;
  presentationNode: ResourceNodeState | undefined;
  presentationRemaining: number;
  presentationMaxYield: number;
  presentationResource: ResourceNodeState['resource'] | null;
  presentationIsRich: boolean | undefined;
  presentationInitialized: boolean;
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
      presentationNode: undefined,
      presentationRemaining: Number.NaN,
      presentationMaxYield: Number.NaN,
      presentationResource: null,
      presentationIsRich: undefined,
      presentationInitialized: false,
    }));

    for (const entry of this.entries) {
      this.root.appendChild(entry.button);
    }
  }

  update(getFrameRect?: () => DOMRect): void {
    const interactionBlocked = this.options.isBlocked();
    toggleClassIfChanged(this.root, 'is-interaction-blocked', interactionBlocked);
    const frame = beginMapIconFrame(
      this.root,
      this.options.domElement,
      this.options.terrain,
      this.options.getCamera,
      this.options.getZoomPercent,
      this.options.isVisibilityBlocked ?? this.options.isBlocked,
      getFrameRect,
    );
    if (!frame) return;

    const nodes = this.options.getForagingNodes();
    const geologicalNodes = this.options.getGeologicalNodes();

    for (const entry of this.entries) {
      const { marker, button, worldPoint } = entry;
      if (!isWorldMapForagingMarkerVisible(marker, nodes)) {
        if (!button.hidden) button.hidden = true;
        continue;
      }

      const node = marker.kind === 'clay'
        ? geologicalNodeForMapMarker(marker, geologicalNodes)
        : nodes.get(marker.id);
      let geologicalPresentation: ReturnType<typeof describeGeologicalMapMarker> | null = null;
      const geologicalPresentationChanged = marker.kind === 'clay'
        && (
          !entry.presentationInitialized
          || entry.presentationNode !== node
          || !Object.is(entry.presentationRemaining, node?.remaining ?? Number.NaN)
          || !Object.is(entry.presentationMaxYield, node?.maxYield ?? Number.NaN)
          || entry.presentationResource !== (node?.resource ?? null)
          || entry.presentationIsRich !== node?.isRich
        );
      if (geologicalPresentationChanged) {
        geologicalPresentation = describeGeologicalMapMarker(marker, node);
        entry.presentationNode = node;
        entry.presentationRemaining = node?.remaining ?? Number.NaN;
        entry.presentationMaxYield = node?.maxYield ?? Number.NaN;
        entry.presentationResource = node?.resource ?? null;
        entry.presentationIsRich = node?.isRich;
        entry.presentationInitialized = true;
      }
      toggleClassIfChanged(
        button,
        'foraging-map-icon--depleted',
        (geologicalPresentationChanged
          ? geologicalPresentation?.level === 'depleted'
          : button.classList.contains('foraging-map-icon--depleted'))
          || (marker.kind !== 'clay' && (node?.remaining ?? 0) <= 0),
      );
      for (const level of ['low', 'deep'] as const) {
        if (geologicalPresentationChanged) {
          toggleClassIfChanged(
            button,
            `foraging-map-icon--${level}`,
            geologicalPresentation?.level === level,
          );
        }
      }
      if (geologicalPresentationChanged && geologicalPresentation) {
        setDatasetIfChanged(button, 'tooltip', geologicalPresentation.label);
        setDatasetIfChanged(button, 'reserveLevel', geologicalPresentation.level);
        setAttributeIfChanged(button, 'aria-label', geologicalPresentation.label);
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
    button.className = 'foraging-map-icon';
    button.dataset.foragingId = marker.id;
    button.dataset.tooltip = marker.label;
    button.setAttribute('aria-label', marker.label);
    button.hidden = true;

    if (marker.kind === 'game') {
      button.classList.add('foraging-map-icon--game');
      button.innerHTML = GAME_ICON_HTML;
    } else if (marker.kind === 'berries') {
      button.classList.add('foraging-map-icon--berries');
      button.innerHTML = BERRY_ICON_HTML;
    } else if (marker.kind === 'mushrooms') {
      button.classList.add('foraging-map-icon--mushrooms');
      button.innerHTML = MUSHROOM_ICON_HTML;
    } else if (marker.kind === 'clay') {
      button.classList.add('foraging-map-icon--clay');
      button.innerHTML = CLAY_ICON_HTML;
    } else {
      button.classList.add('foraging-map-icon--fish');
      button.innerHTML = FISH_ICON_HTML;
    }

    button.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      if (this.options.isBlocked()) return;
      event.preventDefault();
      event.stopPropagation();
      if (marker.kind === 'clay') {
        this.options.onClaySelect?.(marker.x, marker.z);
      } else {
        this.options.onForagingSelect(marker.id);
      }
    });

    return button;
  }
}

function toggleClassIfChanged(element: HTMLElement, className: string, active: boolean): void {
  if (element.classList.contains(className) !== active) element.classList.toggle(className, active);
}

function setDatasetIfChanged(element: HTMLElement, key: string, value: string): void {
  if (element.dataset[key] !== value) element.dataset[key] = value;
}

function setAttributeIfChanged(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
