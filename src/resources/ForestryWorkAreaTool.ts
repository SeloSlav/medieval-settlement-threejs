import * as THREE from 'three';
import {
  updateTerrainCircleFillGeometry,
  updateTerrainCircleRibbonGeometry,
  updateTerrainRibbonGeometry,
  type TerrainOverlaySegment,
} from '../placement/TerrainOverlayGeometry.ts';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';

export const FORESTRY_WORK_AREA_MIN_RADIUS = 20;
export const FORESTRY_WORK_AREA_INITIAL_RADIUS = 70;
export const FORESTRY_WORK_AREA_MAX_RADIUS = 240;
export const FORESTRY_WORK_AREA_RADIUS_STEP = 10;
export const FORESTRY_WORK_AREA_GRID_SPACING = 10;

const WHEEL_STEP_DELTA = 60;
const WHEEL_LINE_PIXEL_SCALE = 32;
const WHEEL_PAGE_PIXEL_FALLBACK = 800;

export type ForestryWorkAreaCommit = {
  buildingId: string;
  x: number;
  z: number;
  radius: number;
};

type ForestryWorkAreaToolOptions = {
  domElement: HTMLElement;
  terrainProjector: TerrainProjector;
  getHeightAt: (x: number, z: number) => number;
  onCommit: (commit: ForestryWorkAreaCommit) => void | Promise<void>;
  onModeChanged: () => void;
  onCommitFailed?: (message: string) => void;
  isBlocked: () => boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element?.isContentEditable);
}

/** One-click terrain authoring mode for lumber-mill and reforester circles. */
export class ForestryWorkAreaTool {
  private readonly options: ForestryWorkAreaToolOptions;
  private readonly overlay: ForestryWorkAreaOverlay;
  private enabled = false;
  private buildingId: string | null = null;
  private center: Point2 = { x: 0, z: 0 };
  private radius = FORESTRY_WORK_AREA_INITIAL_RADIUS;
  private pointerInside = false;
  private pointerClientX = 0;
  private pointerClientY = 0;
  private pointerDirty = false;
  private wheelDelta = 0;
  private commitPending = false;

  constructor(options: ForestryWorkAreaToolOptions) {
    this.options = options;
    this.overlay = new ForestryWorkAreaOverlay(options.getHeightAt);
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    options.domElement.addEventListener('mousemove', this.onPointerMove);
    options.domElement.addEventListener('mouseenter', this.onPointerEnter);
    options.domElement.addEventListener('mouseleave', this.onPointerLeave);
    options.domElement.addEventListener('wheel', this.onWheel, { passive: false, capture: true });
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
  }

  attachTo(parent: THREE.Object3D): void {
    parent.add(this.overlay.group);
  }

  begin(buildingId: string, center: Point2, radius = FORESTRY_WORK_AREA_INITIAL_RADIUS): void {
    if (this.options.isBlocked() || this.commitPending) return;
    this.buildingId = buildingId;
    this.center = { x: center.x, z: center.z };
    this.radius = clampForestryWorkAreaRadius(radius);
    this.wheelDelta = 0;
    this.enabled = true;
    this.pointerDirty = true;
    this.overlay.show(this.center, this.radius);
    this.options.onModeChanged();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getBuildingId(): string | null {
    return this.buildingId;
  }

  getRadius(): number {
    return this.radius;
  }

  getCursor(): string | null {
    return this.enabled && !this.options.isBlocked() ? 'crosshair' : null;
  }

  getStatusDetail(): string {
    return `Move the ${Math.round(this.radius)} m forestry circle · hold Ctrl and scroll to resize · click to set · Esc to cancel`;
  }

  shouldBlockCameraInput(event: MouseEvent | WheelEvent): boolean {
    if (!this.enabled || this.options.isBlocked()) return false;
    if (event instanceof WheelEvent) return event.ctrlKey;
    return event.button === 2;
  }

  setEnabled(enabled: boolean): void {
    if (enabled) return;
    if (!this.enabled && this.buildingId === null) return;
    this.enabled = false;
    this.buildingId = null;
    this.pointerDirty = false;
    this.wheelDelta = 0;
    this.commitPending = false;
    this.overlay.hide();
    this.options.onModeChanged();
  }

  update(): void {
    if (!this.enabled || this.commitPending || this.options.isBlocked() || !this.pointerDirty) return;
    this.pointerDirty = false;
    if (!this.pointerInside) return;
    const picked = this.options.terrainProjector.pick(this.pointerClientX, this.pointerClientY);
    if (!picked) return;
    this.center = { x: picked.x, z: picked.z };
    this.overlay.show(this.center, this.radius);
  }

  dispose(): void {
    const { domElement } = this.options;
    domElement.removeEventListener('mousedown', this.onPointerDown, true);
    domElement.removeEventListener('mousemove', this.onPointerMove);
    domElement.removeEventListener('mouseenter', this.onPointerEnter);
    domElement.removeEventListener('mouseleave', this.onPointerLeave);
    domElement.removeEventListener('wheel', this.onWheel, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.overlay.dispose();
  }

  private readonly onPointerEnter = (): void => {
    this.pointerInside = true;
    this.pointerDirty = true;
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
  };

  private readonly onPointerMove = (event: MouseEvent): void => {
    if (!this.enabled || this.commitPending || this.options.isBlocked()) return;
    this.pointerClientX = event.clientX;
    this.pointerClientY = event.clientY;
    this.pointerDirty = true;
  };

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (!this.enabled || this.commitPending || this.options.isBlocked()) return;
    if (event.button === 2) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setEnabled(false);
      return;
    }
    if (event.button !== 0 || event.altKey) return;
    const picked = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!picked || !this.buildingId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.center = { x: picked.x, z: picked.z };
    this.overlay.show(this.center, this.radius);
    const commit: ForestryWorkAreaCommit = {
      buildingId: this.buildingId,
      x: this.center.x,
      z: this.center.z,
      radius: this.radius,
    };
    this.commitPending = true;
    void Promise.resolve(this.options.onCommit(commit)).then(() => {
      this.setEnabled(false);
    }).catch((error: unknown) => {
      this.commitPending = false;
      this.options.onCommitFailed?.(
        error instanceof Error ? error.message : 'Could not set the forestry work area.',
      );
    });
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled || this.commitPending || this.options.isBlocked() || !event.ctrlKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const normalized = normalizeWheelDelta(event.deltaY, event.deltaMode);
    if (!Number.isFinite(normalized) || normalized === 0) return;
    if (this.wheelDelta !== 0 && Math.sign(normalized) !== Math.sign(this.wheelDelta)) {
      this.wheelDelta = 0;
    }
    this.wheelDelta += normalized;
    if (Math.abs(this.wheelDelta) < WHEEL_STEP_DELTA) return;
    // Wheel up (negative delta) enlarges the authored circle.
    const accumulatedDelta = this.wheelDelta;
    this.wheelDelta = 0;
    const next = resizeForestryWorkAreaRadius(this.radius, accumulatedDelta);
    if (next === this.radius) return;
    this.radius = next;
    this.overlay.show(this.center, this.radius);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target) || !this.enabled || this.commitPending || this.options.isBlocked()) return;
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.setEnabled(false);
  };
}

export function clampForestryWorkAreaRadius(radius: number): number {
  if (!Number.isFinite(radius)) return FORESTRY_WORK_AREA_INITIAL_RADIUS;
  return THREE.MathUtils.clamp(
    Math.round(radius / FORESTRY_WORK_AREA_RADIUS_STEP) * FORESTRY_WORK_AREA_RADIUS_STEP,
    FORESTRY_WORK_AREA_MIN_RADIUS,
    FORESTRY_WORK_AREA_MAX_RADIUS,
  );
}

export function resizeForestryWorkAreaRadius(radius: number, wheelDelta: number): number {
  if (!Number.isFinite(wheelDelta) || wheelDelta === 0) {
    return clampForestryWorkAreaRadius(radius);
  }
  // Browser wheel deltas are negative when scrolling up.
  const direction = wheelDelta < 0 ? 1 : -1;
  return clampForestryWorkAreaRadius(
    radius + direction * FORESTRY_WORK_AREA_RADIUS_STEP,
  );
}

function normalizeWheelDelta(delta: number, mode: number): number {
  if (mode === WheelEvent.DOM_DELTA_LINE) return delta * WHEEL_LINE_PIXEL_SCALE;
  if (mode === WheelEvent.DOM_DELTA_PAGE) return delta * WHEEL_PAGE_PIXEL_FALLBACK;
  return delta;
}

class ForestryWorkAreaOverlay {
  readonly group = new THREE.Group();
  private readonly getHeightAt: (x: number, z: number) => number;
  private readonly fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly grid: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly outline: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  constructor(getHeightAt: (x: number, z: number) => number) {
    this.getHeightAt = getHeightAt;
    this.group.name = 'Forestry work area selector';
    this.group.visible = false;
    this.group.frustumCulled = false;

    this.fill = createOverlayMesh('Forestry work area fill', 0x1c241e, 0.26, 12);
    this.grid = createOverlayMesh('Forestry work area planning grid', 0xffffff, 0.32, 13);
    this.outline = createOverlayMesh('Forestry work area white outline', 0xfffdf5, 0.96, 14);
    this.outline.material.toneMapped = false;
    this.group.add(this.fill, this.grid, this.outline);
  }

  show(center: Point2, radius: number): void {
    updateTerrainCircleFillGeometry(
      this.fill.geometry,
      center,
      radius,
      this.getHeightAt,
      { lift: 0.105, radialSpacing: 7 },
    );
    updateTerrainRibbonGeometry(
      this.grid.geometry,
      circleGridSegments(center, radius, FORESTRY_WORK_AREA_GRID_SPACING),
      this.getHeightAt,
      { width: 0.18, lift: 0.16, sampleSpacing: 3.2 },
    );
    updateTerrainCircleRibbonGeometry(
      this.outline.geometry,
      center,
      radius,
      this.getHeightAt,
      { width: 0.52, lift: 0.21, sampleSpacing: 3.2, segmentCount: 144 },
    );
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of [this.fill, this.grid, this.outline]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}

function createOverlayMesh(
  name: string,
  color: number,
  opacity: number,
  renderOrder: number,
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
  );
  mesh.name = name;
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  mesh.raycast = () => undefined;
  return mesh;
}

export function circleGridSegments(
  center: Point2,
  radius: number,
  spacing = FORESTRY_WORK_AREA_GRID_SPACING,
): TerrainOverlaySegment[] {
  const segments: TerrainOverlaySegment[] = [];
  const safeSpacing = Math.max(2, spacing);
  const radiusSq = radius * radius;
  const minX = Math.ceil((center.x - radius) / safeSpacing) * safeSpacing;
  const maxX = center.x + radius;
  for (let x = minX; x <= maxX + 1e-6; x += safeSpacing) {
    const dx = x - center.x;
    const halfChord = Math.sqrt(Math.max(0, radiusSq - dx * dx));
    if (halfChord <= 0.05) continue;
    segments.push([
      { x, z: center.z - halfChord },
      { x, z: center.z + halfChord },
    ]);
  }
  const minZ = Math.ceil((center.z - radius) / safeSpacing) * safeSpacing;
  const maxZ = center.z + radius;
  for (let z = minZ; z <= maxZ + 1e-6; z += safeSpacing) {
    const dz = z - center.z;
    const halfChord = Math.sqrt(Math.max(0, radiusSq - dz * dz));
    if (halfChord <= 0.05) continue;
    segments.push([
      { x: center.x - halfChord, z },
      { x: center.x + halfChord, z },
    ]);
  }
  return segments;
}
