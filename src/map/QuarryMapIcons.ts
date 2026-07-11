import * as THREE from 'three';
import type { ResourceNodeDefinition } from '../resources/types.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  beginMapIconFrame,
  createMapIconRoot,
  placeProjectedMapButton,
} from './mapIconProjection.ts';

type QuarryMapIconsOptions = {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  terrain: Terrain;
  registry: WorldLayoutRegistry;
  getCamera: () => THREE.PerspectiveCamera | null;
  getZoomPercent: () => number;
  onQuarrySelect: (quarryId: string) => void;
  isBlocked: () => boolean;
};

type QuarryIconEntry = {
  definition: ResourceNodeDefinition;
  button: HTMLButtonElement;
  worldPoint: THREE.Vector3;
};

const STONE_ICON_SVG = `
  <svg class="quarry-map-icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.5 18.5 9l-2.2 11.5H7.7L5.5 9 12 3.5Z" fill="currentColor" opacity="0.92"/>
    <path d="M9.2 10.2 12 7.8l2.8 2.4-1 5.8H10.2l-1-5.8Z" fill="currentColor" opacity="0.38"/>
  </svg>
`.trim();

export class QuarryMapIcons {
  private readonly options: QuarryMapIconsOptions;
  private readonly root: HTMLElement;
  private readonly entries: QuarryIconEntry[];

  constructor(options: QuarryMapIconsOptions) {
    this.options = options;
    this.root = createMapIconRoot(options.uiRoot, 'quarry-map-icons');

    this.entries = options.registry.definitionList
      .filter((definition) => definition.kind === 'quarry' && definition.resource === 'stone')
      .map((definition) => ({
        definition,
        button: this.createIconButton(definition),
        worldPoint: new THREE.Vector3(),
      }));

    for (const entry of this.entries) {
      this.root.appendChild(entry.button);
    }
  }

  update(): void {
    const frame = beginMapIconFrame(
      this.root,
      this.options.domElement,
      this.options.terrain,
      this.options.getCamera,
      this.options.getZoomPercent,
      this.options.isBlocked,
    );
    if (!frame) return;

    for (const entry of this.entries) {
      const { definition, button, worldPoint } = entry;
      placeProjectedMapButton(button, definition.x, definition.z, worldPoint, frame);
    }
  }

  dispose(): void {
    this.root.remove();
  }

  private createIconButton(definition: ResourceNodeDefinition): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quarry-map-icon';
    button.dataset.quarryId = definition.id;
    button.title = definition.label;
    button.setAttribute('aria-label', definition.label);
    button.hidden = true;

    if (definition.quarryKind === 'large') {
      button.classList.add('quarry-map-icon--large');
    }

    button.innerHTML = STONE_ICON_SVG;
    button.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      if (this.options.isBlocked()) return;
      event.preventDefault();
      event.stopPropagation();
      this.options.onQuarrySelect(definition.id);
    });

    return button;
  }
}
