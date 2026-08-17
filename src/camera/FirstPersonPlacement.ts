import * as THREE from 'three';
import { disposeObject3D } from '../utils/dispose.ts';

const HOVER_COLOR = 0xe9d9a3;
const LOCKED_COLOR = 0xf0b54a;

export type FirstPersonPlacementConfig = {
  camera: THREE.Camera;
  domElement: HTMLElement;
  parent: THREE.Object3D;
  pickGround: (clientX: number, clientY: number) => THREE.Vector3 | null;
  onConfirm: (point: THREE.Vector3) => void;
  onCancel: () => void;
  isInputBlocked?: () => boolean;
};

/** RTS-side, map-pin placement step used before first-person takes camera ownership. */
export class FirstPersonPlacement {
  private readonly config: FirstPersonPlacementConfig;
  private readonly marker = new THREE.Group();
  private readonly markerMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly selectedPoint = new THREE.Vector3();
  private readonly hoverPoint = new THREE.Vector3();
  private readonly panel: HTMLElement;
  private readonly cursor: HTMLElement;
  private readonly confirmButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private active = false;
  private hasSelection = false;

  constructor(config: FirstPersonPlacementConfig) {
    this.config = config;
    this.marker.name = 'First-person placement marker';
    this.buildMarker();
    this.marker.visible = false;
    config.parent.add(this.marker);

    const uiParent = config.domElement.parentElement ?? document.body;
    this.panel = document.createElement('section');
    this.panel.className = 'fp-placement-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Choose first-person starting point');
    this.panel.innerHTML = `
      <div class="fp-placement-panel__copy">
        <strong>Choose where to walk</strong>
        <span data-fp-placement-status>Move over the land, then click to place your marker.</span>
      </div>
      <div class="fp-placement-panel__actions">
        <button type="button" class="ghost-button" data-fp-placement-cancel>Cancel&nbsp; (~)</button>
        <button type="button" data-fp-placement-confirm disabled>Drop into first person</button>
      </div>
    `;
    this.status = this.panel.querySelector<HTMLElement>('[data-fp-placement-status]')!;
    this.confirmButton = this.panel.querySelector<HTMLButtonElement>('[data-fp-placement-confirm]')!;
    const cancelButton = this.panel.querySelector<HTMLButtonElement>('[data-fp-placement-cancel]')!;
    this.confirmButton.addEventListener('click', this.onConfirmClick);
    cancelButton.addEventListener('click', this.onCancelClick);
    uiParent.appendChild(this.panel);

    this.cursor = document.createElement('div');
    this.cursor.className = 'fp-placement-cursor';
    this.cursor.hidden = true;
    this.cursor.setAttribute('aria-hidden', 'true');
    this.cursor.innerHTML = `
      <svg viewBox="0 0 30 38" aria-hidden="true">
        <path d="M15 36C12.5 29.4 4 22.1 4 13.7A11 11 0 0 1 26 13.7C26 22.1 17.5 29.4 15 36Z" />
        <circle cx="15" cy="10.5" r="3.2" />
        <path d="M9.8 23.1c.7-5 2.4-7.6 5.2-7.6s4.5 2.6 5.2 7.6" />
      </svg>
    `;
    uiParent.appendChild(this.cursor);
  }

  isActive(): boolean {
    return this.active;
  }

  hasLockedSelection(): boolean {
    return this.active && this.hasSelection;
  }

  begin(): void {
    if (this.active) return;
    this.active = true;
    this.hasSelection = false;
    this.marker.visible = false;
    this.panel.hidden = false;
    this.cursor.hidden = false;
    this.confirmButton.disabled = true;
    this.status.textContent = 'Move over the land, then click to place your marker.';
  }

  end(): void {
    if (!this.active) return;
    this.active = false;
    this.hasSelection = false;
    this.marker.visible = false;
    this.panel.hidden = true;
    this.cursor.hidden = true;
  }

  handlePointerMove(event: PointerEvent): void {
    if (!this.active || this.config.isInputBlocked?.()) return;
    if (this.hasSelection) {
      this.cursor.hidden = true;
      return;
    }
    this.cursor.hidden = false;
    this.cursor.style.left = `${event.clientX}px`;
    this.cursor.style.top = `${event.clientY}px`;
    const hit = this.config.pickGround(event.clientX, event.clientY);
    if (hit) {
      this.hoverPoint.copy(hit);
      this.setMarkerPoint(hit, false);
    } else {
      this.marker.visible = false;
    }
  }

  handleCanvasClick(event: MouseEvent): boolean {
    if (!this.active || this.config.isInputBlocked?.()) return false;
    const hit = this.config.pickGround(event.clientX, event.clientY);
    if (!hit) return true;
    event.preventDefault();
    event.stopPropagation();
    this.selectedPoint.copy(hit);
    this.hasSelection = true;
    this.setMarkerPoint(hit, true);
    this.cursor.hidden = true;
    this.confirmButton.disabled = false;
    this.status.textContent = 'Starting point selected. Click elsewhere to move it, or confirm.';
    return true;
  }

  update(): void {
    if (!this.active || !this.marker.visible) return;
    const point = this.hasSelection ? this.selectedPoint : this.hoverPoint;
    const distance = this.config.camera.position.distanceTo(point);
    const scale = THREE.MathUtils.clamp(distance * 0.026, 1.35, 7.5);
    this.marker.scale.setScalar(scale);
    this.marker.rotation.y += 0.012;
  }

  dispose(): void {
    this.end();
    this.confirmButton.removeEventListener('click', this.onConfirmClick);
    this.panel.querySelector<HTMLButtonElement>('[data-fp-placement-cancel]')
      ?.removeEventListener('click', this.onCancelClick);
    this.panel.remove();
    this.cursor.remove();
    this.marker.removeFromParent();
    disposeObject3D(this.marker, true);
  }

  private buildMarker(): void {
    const makeMaterial = (opacity = 1): THREE.MeshBasicMaterial => {
      const material = new THREE.MeshBasicMaterial({
        color: HOVER_COLOR,
        depthTest: false,
        depthWrite: false,
        opacity,
        side: THREE.DoubleSide,
        transparent: opacity < 1,
        toneMapped: false,
      });
      this.markerMaterials.push(material);
      return material;
    };

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.82, 32), makeMaterial(0.72));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.035;

    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 16), makeMaterial());
    pin.rotation.z = Math.PI;
    pin.position.y = 0.27;

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.38, 4, 10), makeMaterial());
    body.position.y = 0.78;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), makeMaterial());
    head.position.y = 1.25;

    for (const mesh of [ring, pin, body, head]) {
      mesh.renderOrder = 10_000;
      mesh.frustumCulled = false;
      this.marker.add(mesh);
    }
  }

  private setMarkerPoint(point: THREE.Vector3, locked: boolean): void {
    this.marker.position.set(point.x, point.y + 0.04, point.z);
    this.marker.visible = true;
    const color = locked ? LOCKED_COLOR : HOVER_COLOR;
    for (const material of this.markerMaterials) material.color.setHex(color);
  }

  private readonly onConfirmClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!this.active || !this.hasSelection) return;
    this.config.onConfirm(this.selectedPoint.clone());
  };

  private readonly onCancelClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!this.active) return;
    this.config.onCancel();
  };
}
