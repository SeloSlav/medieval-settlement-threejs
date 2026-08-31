import * as THREE from 'three';
import type { MilitaryCompanyKind } from './militaryProgression.ts';
import {
  MILITARY_COMPANY_STRATEGIC_ICON_ART,
  militaryCompanyStrategicLabel,
} from './militaryCompanyPresentation.ts';

/** Icons appear only once formations stop reading as people. Separate reveal
 * and hide thresholds prevent wheel-zoom jitter from flashing the overlay. */
export const STRATEGIC_COMPANY_ICON_REVEAL_ZOOM_PERCENT = 72;
export const STRATEGIC_COMPANY_ICON_HIDE_ZOOM_PERCENT = 88;

export type StrategicCompanyMarker = {
  id: string;
  kind: MilitaryCompanyKind;
  x: number;
  z: number;
  livingMembers: number;
  controllable: boolean;
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
};

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

  update(): void {
    this.visible = resolveStrategicCompanyIconVisibility(
      this.visible,
      this.options.getZoomPercent(),
      this.options.isBlocked(),
    );
    if (!this.visible || this.entries.size === 0) {
      this.root.hidden = true;
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
      entry.projected
        .set(
          entry.marker.x,
          this.options.getHeightAt(entry.marker.x, entry.marker.z) + 3.15,
          entry.marker.z,
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
      if (this.options.isBlocked()) return;
      this.options.onSelect(marker.id);
    });
    this.syncButton(button, marker);
    return button;
  }

  private syncButton(button: HTMLButtonElement, marker: StrategicCompanyMarker): void {
    const label = militaryCompanyStrategicLabel(marker.kind);
    button.dataset.militaryCompanyId = marker.id;
    button.dataset.militaryCompanyKind = marker.kind;
    button.dataset.controllable = String(marker.controllable);
    button.dataset.tooltipTitle = label;
    button.dataset.tooltip = `${marker.livingMembers} living · click to select company`;
    button.setAttribute(
      'aria-label',
      `${label}, ${marker.livingMembers} living. Select military company.`,
    );
    button.innerHTML = `
      <img class="military-company-map-icon__woodcut" src="${MILITARY_COMPANY_STRATEGIC_ICON_ART[marker.kind]}" alt="" draggable="false">
      <span class="military-company-map-icon__count" aria-hidden="true">${marker.livingMembers}</span>
    `;
    button.classList.toggle('is-selected', marker.id === this.selectedCompanyId);
    button.setAttribute('aria-pressed', String(marker.id === this.selectedCompanyId));
  }
}
