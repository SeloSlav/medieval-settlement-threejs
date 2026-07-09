import * as THREE from 'three';
import type { InputManager } from '../input/InputManager.ts';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { RoadNetwork, RoadNetworkSnapshot, SnapTarget } from './RoadNetwork.ts';
import type { RoadSelection } from './RoadSelection.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import { RoadPreview } from './RoadPreview.ts';

const ROAD_WIDTH = 4.2;
const DRAG_THRESHOLD_PX = 5;
const MIN_POINT_DISTANCE = 1.05;
const MIN_COMMIT_LENGTH = 3.5;

export class RoadTool {
  private readonly options: {
    camera: THREE.Camera;
    domElement: HTMLElement;
    input: InputManager;
    network: RoadNetwork;
    sceneManager: SceneManager;
    selection: RoadSelection;
    terrainProjector: TerrainProjector;
    onNetworkChanged: () => void;
    onModeChanged: () => void;
  };
  private enabled = true;
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private points: THREE.Vector3[] = [];
  private latestSnap: SnapTarget | null = null;
  private undoStack: RoadNetworkSnapshot[] = [];
  private readonly preview: RoadPreview;

  constructor(options: {
    camera: THREE.Camera;
    domElement: HTMLElement;
    input: InputManager;
    network: RoadNetwork;
    sceneManager: SceneManager;
    selection: RoadSelection;
    terrainProjector: TerrainProjector;
    onNetworkChanged: () => void;
    onModeChanged: () => void;
  }) {
    this.options = options;
    this.preview = new RoadPreview(options.sceneManager.roadMeshBuilder, options.sceneManager.materials);
    options.sceneManager.previewGroup.add(this.preview.group);
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    options.domElement.addEventListener('mousemove', this.onPointerMove);
    window.addEventListener('mouseup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancel();
    this.options.onModeChanged();
  }

  getCursor(): string | null {
    if (!this.enabled) return null;
    return this.dragging ? 'crosshair' : 'copy';
  }

  update(_dt: number): void {}

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.options.network.restore(snapshot);
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
  }

  deleteSelected(): void {
    const snapshot = this.options.network.snapshot();
    if (this.options.selection.deleteSelected()) {
      this.undoStack.push(snapshot);
      this.options.onNetworkChanged();
    }
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, true);
    this.options.domElement.removeEventListener('mousemove', this.onPointerMove);
    window.removeEventListener('mouseup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    this.preview.dispose();
  }

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    if (!this.enabled) return;
    const hit = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.points = [this.applySnap(hit)];
    this.updatePreview(event.clientX, event.clientY);
  };

  private readonly onPointerMove = (event: MouseEvent): void => {
    if (!this.enabled || !this.dragging) return;
    this.updatePreview(event.clientX, event.clientY);
  };

  private readonly onPointerUp = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.enabled) return;
    if (!this.dragging) {
      this.options.selection.pick(event.clientX, event.clientY);
      return;
    }
    const moved = Math.hypot(event.clientX - this.dragStartX, event.clientY - this.dragStartY);
    this.dragging = false;
    if (moved < DRAG_THRESHOLD_PX) {
      this.preview.clear();
      this.options.selection.pick(event.clientX, event.clientY);
      this.points = [];
      return;
    }
    this.updatePreview(event.clientX, event.clientY);
    this.commit();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (key === 'escape') this.cancel();
    if (key === 'enter' && this.dragging) {
      event.preventDefault();
      this.dragging = false;
      this.commit();
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      this.undo();
    }
    if (key === 'delete' || key === 'backspace') this.deleteSelected();
  };

  private updatePreview(clientX: number, clientY: number): void {
    const hit = this.options.terrainProjector.pick(clientX, clientY);
    if (!hit) return;
    const point = this.applySnap(hit);
    const last = this.points[this.points.length - 1];
    if (!last || distanceXZ(last, point) >= MIN_POINT_DISTANCE) {
      this.points.push(point);
    } else if (this.points.length > 1) {
      this.points[this.points.length - 1] = point;
    }
    const valid = this.isCurrentPlacementValid();
    this.preview.update(this.points, valid, ROAD_WIDTH, this.latestSnap?.point ?? null);
  }

  private applySnap(point: THREE.Vector3): THREE.Vector3 {
    const snap = this.options.network.findSnap(point, 5.6);
    this.latestSnap = snap;
    if (snap) return snap.point.clone();
    return this.options.sceneManager.terrain.getPointAt(point.x, point.z, 0);
  }

  private commit(): void {
    if (!this.isCurrentPlacementValid()) {
      this.cancel();
      return;
    }
    const snapshot = this.options.network.snapshot();
    const added = this.options.network.addRoadPath(this.points, ROAD_WIDTH);
    if (added.length > 0) {
      this.undoStack.push(snapshot);
      this.options.selection.setSelected(added[added.length - 1]);
      this.options.onNetworkChanged();
    }
    this.preview.clear();
    this.points = [];
  }

  private cancel(): void {
    this.dragging = false;
    this.points = [];
    this.latestSnap = null;
    this.preview.clear();
  }

  private isCurrentPlacementValid(): boolean {
    if (this.points.length < 2) return false;
    if (pathLength(this.points) < MIN_COMMIT_LENGTH) return false;
    for (let i = 1; i < this.points.length; i++) {
      const dxz = distanceXZ(this.points[i - 1], this.points[i]);
      const dy = Math.abs(this.points[i].y - this.points[i - 1].y);
      if (dxz > 0.1 && dy / dxz > 0.45) return false;
    }
    return true;
  }
}

function pathLength(points: THREE.Vector3[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += distanceXZ(points[i - 1], points[i]);
  return length;
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}


