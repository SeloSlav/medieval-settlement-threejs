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
import { syncResourceStockRing } from './resourceStockRing.ts';
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
  presentationNode: ResourceNodeState | undefined;
  presentationRemaining: number;
  presentationMaxYield: number;
  presentationResource: ResourceNodeState['resource'] | null;
  presentationIsRich: boolean | undefined;
  presentationInitialized: boolean;
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

    const nodes = this.options.getGeologicalNodes();
    for (const entry of this.entries) {
      const { marker, button, worldPoint } = entry;
      const node = geologicalNodeForMapMarker(marker, nodes);
      syncResourceStockRing(button, node, {
        hideWhenEmpty: node?.isRich === true,
      });
      if (
        !entry.presentationInitialized
        || entry.presentationNode !== node
        || !Object.is(entry.presentationRemaining, node?.remaining ?? Number.NaN)
        || !Object.is(entry.presentationMaxYield, node?.maxYield ?? Number.NaN)
        || entry.presentationResource !== (node?.resource ?? null)
        || entry.presentationIsRich !== node?.isRich
      ) {
        const presentation = describeGeologicalMapMarker(marker, node);
        toggleClassIfChanged(
          button,
          'resource-node-marker--rich',
          node?.isRich === true,
        );
        setDatasetIfChanged(button, 'tooltip', presentation.label);
        setDatasetIfChanged(button, 'reserveLevel', presentation.level);
        setAttributeIfChanged(button, 'aria-label', presentation.label);
        for (const level of ['low', 'depleted', 'deep'] as const) {
          toggleClassIfChanged(
            button,
            `quarry-map-icon--${level}`,
            presentation.level === level,
          );
        }
        entry.presentationNode = node;
        entry.presentationRemaining = node?.remaining ?? Number.NaN;
        entry.presentationMaxYield = node?.maxYield ?? Number.NaN;
        entry.presentationResource = node?.resource ?? null;
        entry.presentationIsRich = node?.isRich;
        entry.presentationInitialized = true;
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

function toggleClassIfChanged(element: HTMLElement, className: string, active: boolean): void {
  if (element.classList.contains(className) !== active) element.classList.toggle(className, active);
}

function setDatasetIfChanged(element: HTMLElement, key: string, value: string): void {
  if (element.dataset[key] !== value) element.dataset[key] = value;
}

function setAttributeIfChanged(element: HTMLElement, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
