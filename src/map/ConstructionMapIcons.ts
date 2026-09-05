import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import { residenceHasActiveProject, type GameState } from '../resources/types.ts';
import { buildingHoverLabel, constructionProgressFraction, residenceHoverLabel } from '../resources/worldHoverPresentation.ts';
import { beginMapIconFrame, createMapIconRoot, placeProjectedMapButton, type MapIconFrame } from './mapIconProjection.ts';
import { syncResourceStockRing } from './resourceStockRing.ts';

type ConstructionMapIconsOptions = {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  terrain: Terrain;
  getState: () => GameState;
  getCamera: () => THREE.PerspectiveCamera | null;
  isBlocked: () => boolean;
};

type ConstructionEntry = { element: HTMLButtonElement; point: THREE.Vector3 };

/** Passive, centered work-progress wheels. They never intercept world selection. */
export class ConstructionMapIcons {
  private readonly root: HTMLElement;
  private readonly entries = new Map<string, ConstructionEntry>();
  private readonly activeKeys = new Set<string>();
  private readonly options: ConstructionMapIconsOptions;

  constructor(options: ConstructionMapIconsOptions) {
    this.options = options;
    this.root = createMapIconRoot(options.uiRoot, 'construction-map-icons');
  }

  update(getFrameRect?: () => DOMRect): void {
    const frame = beginMapIconFrame(this.root, this.options.domElement, this.options.terrain,
      this.options.getCamera, () => 0, this.options.isBlocked, getFrameRect, true);
    if (!frame) return;
    this.activeKeys.clear();
    const state = this.options.getState();
    for (const building of state.buildings.values()) {
      if (building.constructionComplete !== false) continue;
      this.sync(`building:${building.id}`, building.x, building.z,
        building.constructionProgress, buildingHoverLabel(building), frame);
    }
    for (const residence of state.residences.values()) {
      if (residence.tier !== 0 && !residenceHasActiveProject(residence)) continue;
      this.sync(`residence:${residence.id}`, residence.x, residence.z,
        residence.upgradeProgress, residenceHoverLabel(residence), frame);
    }
    for (const [key, entry] of this.entries) {
      if (this.activeKeys.has(key)) continue;
      entry.element.remove();
      this.entries.delete(key);
    }
  }

  dispose(): void {
    this.root.remove();
    this.entries.clear();
  }

  private sync(key: string, x: number, z: number, progress: number | undefined,
    label: string, frame: MapIconFrame): void {
    this.activeKeys.add(key);
    let entry = this.entries.get(key);
    if (!entry) {
      const element = document.createElement('button');
      element.type = 'button';
      element.disabled = true;
      element.tabIndex = -1;
      element.className = 'construction-map-icon';
      element.dataset.constructionId = key;
      element.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 3 7 7-3 3-3-3-9 11-3-3 11-9-3-3Z" fill="currentColor"/></svg>';
      entry = { element, point: new THREE.Vector3() };
      this.entries.set(key, entry);
      this.root.appendChild(element);
    }
    const fraction = constructionProgressFraction(progress);
    syncResourceStockRing(entry.element, { remaining: fraction, maxYield: 1 });
    const description = `${label} · ${Math.round(fraction * 100)}%`;
    if (entry.element.getAttribute('aria-label') !== description) {
      entry.element.setAttribute('aria-label', description);
    }
    placeProjectedMapButton(entry.element, x, z, entry.point, frame);
  }
}
