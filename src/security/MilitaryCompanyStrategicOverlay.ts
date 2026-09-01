import * as THREE from 'three';
import type { MilitaryCompanyKind } from './militaryProgression.ts';
import {
  HOSTILE_COMPANY_STRATEGIC_ICON_ART,
  MILITARY_COMPANY_STRATEGIC_ICON_ART,
  hostileCompanyStrategicLabel,
  militaryCompanyStrategicLabel,
  type HostileCompanyStrategicKind,
} from './militaryCompanyPresentation.ts';

/** Icons appear only once formations stop reading as people. Separate reveal
 * and hide thresholds prevent wheel-zoom jitter from flashing the overlay. */
export const STRATEGIC_COMPANY_ICON_REVEAL_ZOOM_PERCENT = 72;
export const STRATEGIC_COMPANY_ICON_HIDE_ZOOM_PERCENT = 88;
export const STRATEGIC_COMPANY_STATIONARY_DEAD_ZONE = 0.8;
export const STRATEGIC_COMPANY_POSITION_SNAP_DISTANCE = 32;
const STRATEGIC_COMPANY_MOVING_RESPONSE = 12;
const STRATEGIC_COMPANY_STATIONARY_RESPONSE = 4.5;
const MAX_POSITION_FILTER_DELTA_SECONDS = 0.05;

export type StrategicCompanyMarker = {
  id: string;
  kind: MilitaryCompanyKind | HostileCompanyStrategicKind;
  x: number;
  z: number;
  livingMembers: number;
  controllable: boolean;
  moving: boolean;
  hostile: boolean;
};

type StrategicCompanyIconOptions = {
  uiRoot: HTMLElement;
  domElement: HTMLElement;
  camera: THREE.Camera;
  getZoomPercent: () => number;
  getHeightAt: (x: number, z: number) => number;
  isBlocked: () => boolean;
  onSelect: (companyId: string) => void;
};

type IconEntry = {
  marker: StrategicCompanyMarker;
  button: HTMLButtonElement;
  projected: THREE.Vector3;
  displayX: number;
  displayZ: number;
};

/** Filters company motion in world space so camera movement remains exact.
 * Small formation-centroid changes are ignored while a company is stationary;
 * genuine motion is followed with a frame-rate-independent response. */
export function strategicCompanyPositionBlend(
  distance: number,
  moving: boolean,
  deltaSeconds: number,
): number {
  if (!Number.isFinite(distance) || distance >= STRATEGIC_COMPANY_POSITION_SNAP_DISTANCE) return 1;
  if (distance <= 0 || (!moving && distance <= STRATEGIC_COMPANY_STATIONARY_DEAD_ZONE)) return 0;
  const dt = THREE.MathUtils.clamp(
    Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
    0,
    MAX_POSITION_FILTER_DELTA_SECONDS,
  );
  const response = moving
    ? STRATEGIC_COMPANY_MOVING_RESPONSE
    : STRATEGIC_COMPANY_STATIONARY_RESPONSE;
  return 1 - Math.exp(-response * dt);
}

export function resolveStrategicCompanyIconVisibility(
  wasVisible: boolean,
  zoomPercent: number,
  blocked = false,
): boolean {
  if (blocked || !Number.isFinite(zoomPercent)) return false;
  return wasVisible
    ? zoomPercent < STRATEGIC_COMPANY_ICON_HIDE_ZOOM_PERCENT
    : zoomPercent <= STRATEGIC_COMPANY_ICON_REVEAL_ZOOM_PERCENT;
}

export function strategicCompanyIconOpacity(zoomPercent: number): number {
  if (!Number.isFinite(zoomPercent)) return 0;
  const span = STRATEGIC_COMPANY_ICON_HIDE_ZOOM_PERCENT
    - STRATEGIC_COMPANY_ICON_REVEAL_ZOOM_PERCENT;
  return THREE.MathUtils.smoothstep(
    (STRATEGIC_COMPANY_ICON_HIDE_ZOOM_PERCENT - zoomPercent) / span,
    0,
    1,
  );
}

/** Lightweight DOM projection for whole-company strategic markers. One button
 * is retained per active company; there are no per-soldier DOM allocations. */
export class MilitaryCompanyStrategicOverlay {
  private readonly options: StrategicCompanyIconOptions;
  private readonly root: HTMLElement;
  private readonly entries = new Map<string, IconEntry>();
  private visible = false;
  private selectedCompanyId: string | null = null;
  private lastUpdateTimeMs: number | null = null;

  constructor(options: StrategicCompanyIconOptions) {
    this.options = options;
    this.root = document.createElement('div');
    this.root.className = 'military-company-map-icons';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Military companies');
    options.uiRoot.appendChild(this.root);
  }

  sync(markers: Iterable<StrategicCompanyMarker>): void {
    const live = new Set<string>();
    for (const marker of markers) {
      live.add(marker.id);
      const entry = this.entries.get(marker.id);
      if (entry) {
        entry.marker = marker;
        this.syncButton(entry.button, marker);
        continue;
      }
      const button = this.createButton(marker);
      this.entries.set(marker.id, {
        marker,
        button,
        projected: new THREE.Vector3(),
        displayX: marker.x,
        displayZ: marker.z,
      });
      this.root.appendChild(button);
    }
    for (const [id, entry] of this.entries) {
      if (live.has(id)) continue;
      entry.button.remove();
      this.entries.delete(id);
    }
    if (this.selectedCompanyId && !live.has(this.selectedCompanyId)) {
      this.selectedCompanyId = null;
    }
  }

  setSelected(companyId: string | null): void {
    if (this.selectedCompanyId === companyId) return;
    this.selectedCompanyId = companyId;
    for (const [id, entry] of this.entries) {
      entry.button.classList.toggle('is-selected', id === companyId);
      entry.button.setAttribute('aria-pressed', String(id === companyId));
    }
  }

  update(timeMs = performance.now()): void {
    const deltaSeconds = this.lastUpdateTimeMs === null
      ? 0
      : Math.max(0, (timeMs - this.lastUpdateTimeMs) / 1000);
    this.lastUpdateTimeMs = timeMs;
    this.visible = resolveStrategicCompanyIconVisibility(
      this.visible,
      this.options.getZoomPercent(),
      this.options.isBlocked(),
    );
    if (!this.visible || this.entries.size === 0) {
      this.root.hidden = true;
      for (const entry of this.entries.values()) {
        entry.displayX = entry.marker.x;
        entry.displayZ = entry.marker.z;
      }
      return;
    }
    this.root.hidden = false;
    this.root.style.opacity = strategicCompanyIconOpacity(
      this.options.getZoomPercent(),
    ).toFixed(3);
    const rect = this.options.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      this.root.hidden = true;
      return;
    }
    this.options.camera.updateMatrixWorld();
    for (const entry of this.entries.values()) {
      const offsetX = entry.marker.x - entry.displayX;
      const offsetZ = entry.marker.z - entry.displayZ;
      const positionBlend = strategicCompanyPositionBlend(
        Math.hypot(offsetX, offsetZ),
        entry.marker.moving,
        deltaSeconds,
      );
      entry.displayX += offsetX * positionBlend;
      entry.displayZ += offsetZ * positionBlend;
      entry.projected
        .set(
          entry.displayX,
          this.options.getHeightAt(entry.displayX, entry.displayZ) + 3.15,
          entry.displayZ,
        )
        .project(this.options.camera);
      const inView = entry.projected.z >= -1
        && entry.projected.z <= 1
        && entry.projected.x >= -1.08
        && entry.projected.x <= 1.08
        && entry.projected.y >= -1.08
        && entry.projected.y <= 1.08;
      entry.button.hidden = !inView;
      if (!inView) continue;
      entry.button.style.left = `${rect.left + (entry.projected.x * 0.5 + 0.5) * rect.width}px`;
      entry.button.style.top = `${rect.top + (-entry.projected.y * 0.5 + 0.5) * rect.height}px`;
    }
  }

  dispose(): void {
    this.entries.clear();
    this.root.remove();
  }

  private createButton(marker: StrategicCompanyMarker): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'military-company-map-icon';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('pointerdown', (event) => {
      if (event.button === 0) event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.options.isBlocked() || marker.hostile) return;
      this.options.onSelect(marker.id);
    });
    const woodcut = document.createElement('img');
    woodcut.className = 'military-company-map-icon__woodcut';
    woodcut.alt = '';
    woodcut.draggable = false;
    const count = document.createElement('span');
    count.className = 'military-company-map-icon__count';
    count.setAttribute('aria-hidden', 'true');
    button.append(woodcut, count);
    this.syncButton(button, marker);
    return button;
  }

  private syncButton(button: HTMLButtonElement, marker: StrategicCompanyMarker): void {
    const hostileKind = marker.hostile
      ? marker.kind as HostileCompanyStrategicKind
      : null;
    const label = hostileKind
      ? hostileCompanyStrategicLabel(hostileKind)
      : militaryCompanyStrategicLabel(marker.kind as MilitaryCompanyKind);
    button.dataset.militaryCompanyId = marker.id;
    button.dataset.militaryCompanyKind = marker.kind;
    button.dataset.controllable = String(marker.controllable);
    button.dataset.hostile = String(marker.hostile);
    button.tabIndex = marker.hostile ? -1 : 0;
    button.setAttribute('aria-disabled', String(marker.hostile));
    button.dataset.tooltipTitle = label;
    button.dataset.tooltip = marker.hostile
      ? `${marker.livingMembers} living · enemy company`
      : `${marker.livingMembers} living · click to select company`;
    button.setAttribute(
      'aria-label',
      marker.hostile
        ? `${label}, ${marker.livingMembers} living. Enemy company.`
        : `${label}, ${marker.livingMembers} living. Select military company.`,
    );
    const woodcut = button.querySelector<HTMLImageElement>('.military-company-map-icon__woodcut');
    const art = hostileKind
      ? HOSTILE_COMPANY_STRATEGIC_ICON_ART[hostileKind]
      : MILITARY_COMPANY_STRATEGIC_ICON_ART[marker.kind as MilitaryCompanyKind];
    if (woodcut?.getAttribute('src') !== art) woodcut?.setAttribute('src', art);
    const count = button.querySelector<HTMLElement>('.military-company-map-icon__count');
    const countText = String(marker.livingMembers);
    if (count && count.textContent !== countText) count.textContent = countText;
    button.classList.toggle('is-selected', marker.id === this.selectedCompanyId);
    button.setAttribute('aria-pressed', String(marker.id === this.selectedCompanyId));
  }
}
