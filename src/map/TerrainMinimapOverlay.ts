import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { GameState } from '../resources/types.ts';
import type { RiverField } from '../rivers/RiverField.ts';
import type { Terrain, TerrainBounds } from '../terrain/Terrain.ts';
import type { ForestCore } from '../props/forestField.ts';
import {
  createTerrainMinimapImage,
  type TerrainMinimapImage,
} from './createTerrainMinimapImage.ts';
import {
  drawIllustratedMapLayers,
  drawIllustratedResourceStampLayer,
  type IllustratedMapStampImages,
} from './illustratedMapLayers.ts';
import {
  MAP_STAMP_RESOURCE_KINDS,
  type MapStampKey,
} from './illustratedMapGeometry.ts';
import type { WorldMapMarker } from './worldMapMarkers.ts';
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

export type TerrainMinimapLayerImage = TerrainMinimapImage & {
  stampCanvas: HTMLCanvasElement;
};

type TerrainMinimapOverlayOptions = {
  uiRoot: HTMLElement;
  riverField: RiverField;
  terrain: Terrain;
  forestCores: readonly ForestCore[];
  worldSeed: number;
  layoutMarkers: readonly WorldMapMarker[];
  getRoadNetwork: () => RoadNetwork;
  getGameState: () => GameState;
  getFocus: () => MinimapFocus;
  isBlocked: () => boolean;
  onTerrainImageReady?: (image: TerrainMinimapLayerImage) => void;
  onTerrainImageUpdated?: () => void;
};

export class TerrainMinimapOverlay {
  private readonly options: TerrainMinimapOverlayOptions;
  private readonly root: HTMLElement;
  private readonly mapSurface: HTMLElement;
  private readonly focusMarker: HTMLElement;
  private readonly bounds: TerrainBounds;
  private readonly stampImages = new Map<MapStampKey, HTMLImageElement>();
  private baseCanvas: HTMLCanvasElement | null = null;
  private mapCanvas: HTMLCanvasElement | null = null;
  private stampCanvas: HTMLCanvasElement | null = null;
  private visible = false;
  private redrawQueued = false;
  private disposed = false;

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
          <div class="terrain-minimap__focus" aria-hidden="true"></div>
        </div>
      </div>
    `;

    this.mapSurface = this.root.querySelector<HTMLElement>('.terrain-minimap__map-surface')!;
    this.focusMarker = this.root.querySelector<HTMLElement>('.terrain-minimap__focus')!;

    // Mount outside the ordinary UI stacking context so the held map always
    // covers menus, HUD chrome, inspectors, and setup overlays.
    options.uiRoot.ownerDocument.body.appendChild(this.root);
  }

  static create(options: TerrainMinimapOverlayOptions): TerrainMinimapOverlay {
    const overlay = new TerrainMinimapOverlay(options, riverFieldBounds(options.riverField));
    void overlay.loadTerrainImage();
    void overlay.loadResourceStamps();
    return overlay;
  }

  tick({ keyHeld }: { keyHeld: boolean }): void {
    const shouldShow = keyHeld && !this.options.isBlocked();
    if (shouldShow !== this.visible) {
      this.visible = shouldShow;
      this.root.hidden = !shouldShow;
      this.root.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
      if (shouldShow) this.updateFocusMarker();
      return;
    }

    if (this.visible) this.updateFocusMarker();
  }

  syncBuildings(_markers: readonly WorldMapMarker[]): void {
    this.scheduleRedraw();
  }

  syncSettlement(): void {
    this.scheduleRedraw();
  }

  syncResources(): void {
    this.scheduleRedraw();
  }

  syncRoads(): void {
    this.scheduleRedraw();
  }

  dispose(): void {
    this.disposed = true;
    this.root.remove();
  }

  private async loadTerrainImage(): Promise<void> {
    try {
      const image = await createTerrainMinimapImage({
        riverField: this.options.riverField,
        terrain: this.options.terrain,
        forestCores: this.options.forestCores,
        seed: this.options.worldSeed,
      });
      if (this.disposed) return;
      this.baseCanvas = image.canvas;
      this.mapCanvas = document.createElement('canvas');
      this.mapCanvas.width = image.canvas.width;
      this.mapCanvas.height = image.canvas.height;
      this.mapCanvas.dataset.terrainStyle = 'medieval-parchment-live-map';
      this.mapCanvas.className = 'terrain-minimap__terrain-canvas';
      this.mapCanvas.setAttribute('role', 'img');
      this.mapCanvas.setAttribute(
        'aria-label',
        'Illustrated parchment map with ink roads, true building footprints, and resource woodcuts',
      );
      this.stampCanvas = document.createElement('canvas');
      this.stampCanvas.width = image.canvas.width;
      this.stampCanvas.height = image.canvas.height;
      this.stampCanvas.className = 'terrain-minimap__stamp-canvas';
      this.stampCanvas.dataset.mapLayer = 'resource-stamps';
      this.stampCanvas.setAttribute('aria-hidden', 'true');
      this.redrawMap();
      this.mapSurface.replaceChildren(this.mapCanvas, this.stampCanvas);
      this.options.onTerrainImageReady?.({
        canvas: this.mapCanvas,
        stampCanvas: this.stampCanvas,
        bounds: image.bounds,
      });
    } catch (error) {
      console.error('Terrain minimap image failed to load:', error);
    }
  }

  private async loadResourceStamps(): Promise<void> {
    const baseUrl = import.meta.env.BASE_URL.endsWith('/')
      ? import.meta.env.BASE_URL
      : `${import.meta.env.BASE_URL}/`;
    const loads: Promise<void>[] = [];
    for (const resource of MAP_STAMP_RESOURCE_KINDS) {
      for (const variant of ['normal', 'rich'] as const) {
        const key: MapStampKey = `${resource}-${variant}`;
        const image = new Image();
        image.decoding = 'async';
        const loaded = new Promise<void>((resolve) => {
          image.addEventListener('load', () => {
            this.stampImages.set(key, image);
            resolve();
          }, { once: true });
          image.addEventListener('error', () => {
            console.error(`Map stamp failed to load: ${key}`);
            resolve();
          }, { once: true });
        });
        image.src = `${baseUrl}assets/ui/map-stamps/${key}.png`;
        loads.push(loaded);
      }
    }
    await Promise.all(loads);
    if (!this.disposed) this.scheduleRedraw();
  }

  private scheduleRedraw(): void {
    if (this.redrawQueued || this.disposed) return;
    this.redrawQueued = true;
    queueMicrotask(() => {
      this.redrawQueued = false;
      if (!this.disposed) this.redrawMap();
    });
  }

  private redrawMap(): void {
    if (!this.baseCanvas || !this.mapCanvas || !this.stampCanvas) return;
    const context = this.mapCanvas.getContext('2d');
    const stampContext = this.stampCanvas.getContext('2d');
    if (!context || !stampContext) return;
    context.clearRect(0, 0, this.mapCanvas.width, this.mapCanvas.height);
    context.drawImage(this.baseCanvas, 0, 0);
    drawIllustratedMapLayers({
      context,
      bounds: this.bounds,
      roadNetwork: this.options.getRoadNetwork(),
      state: this.options.getGameState(),
    });
    stampContext.clearRect(0, 0, this.stampCanvas.width, this.stampCanvas.height);
    drawIllustratedResourceStampLayer({
      context: stampContext,
      bounds: this.bounds,
      state: this.options.getGameState(),
      layoutMarkers: this.options.layoutMarkers,
      stampImages: this.stampImages as IllustratedMapStampImages,
    });
    this.options.onTerrainImageUpdated?.();
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
}
