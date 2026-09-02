import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { RoadNetwork, RoadNetworkSnapshot, SnapTarget } from './RoadNetwork.ts';
import type { RoadSelection } from './RoadSelection.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import { RoadPreview } from './RoadPreview.ts';
import {
  validateRoadPlacement,
  type RoadPlacementFailureReason,
  type RoadPlacementResult,
} from './RoadPlacementValidation.ts';
import {
  BuildingRoadConnections,
  type BuildingRoadConnectionSource,
} from './BuildingRoadConnections.ts';
import { ROAD_WIDTH } from './roadDimensions.ts';
import { RoadNodeSnapMarkers } from './RoadNodeSnapMarkers.ts';
import {
  buildRoadBoundaryToRoadPath,
  buildRoadBoundaryPath,
  findRoadBoundarySnap,
  type RoadAlignmentTarget,
  type RoadBoundarySnap,
} from './RoadBoundarySnap.ts';
import { getEdgePath, inwardDirectionAtNode } from './roadEndpoint.ts';
import type { BurgageZoneState } from '../resources/types.ts';
import {
  alignSecondWallAnchorParallel,
  findDryStoneWallRoadSnap,
  type DryStoneWallRoadSnap,
} from '../decorations/DryStoneWallRoadSnap.ts';
import { SecondaryClickGesture } from '../input/SecondaryClickGesture.ts';

const MIN_POINT_DISTANCE = 1.05;
const MIN_COMMIT_LENGTH = 3.5;
const CURVE_WHEEL_STEP = 1.35;
const MAX_CURVE_OFFSET = 34;
const CURVE_EPSILON = 0.05;
const SNAP_DISTANCE = 5.6;
const HOVER_PREVIEW_MOVE_THRESHOLD = 1.1;
const VALIDATION_INTERVAL_MS = 180;
const PREVIEW_MESH_SAMPLE_SPACING = 1.5;
const PREVIEW_MESH_MAX_SAMPLES = 80;
const WALL_MIN_COMMIT_LENGTH = 2.2;
const WALL_SAMPLE_SPACING = 0.52;
const WALL_MAX_SAMPLES = 640;

export type RoadToolMode = 'road' | 'dry-stone-wall' | 'off';

export type RoadDeleteRequest = ({
  kind: 'road';
  edgeId: string;
} | {
  kind: 'dry-stone-wall';
  wallId: string;
}) & {
  clientX: number;
  clientY: number;
};

export type RoadPlacementRejectedEvent = {
  reason: RoadPlacementFailureReason;
  action: 'click' | 'commit';
};

export class RoadTool {
  private readonly options: {
    domElement: HTMLElement;
    network: RoadNetwork;
    sceneManager: SceneManager;
    selection: RoadSelection;
    terrainProjector: TerrainProjector;
    onNetworkChanged: () => void;
    onStateChanged: () => void;
    onDeleteRequested: (request: RoadDeleteRequest | null) => void;
    onPlacementRejected?: (event: RoadPlacementRejectedEvent) => void;
    onDryStoneWallStartRejected?: () => void;
    onToggle?: () => void;
    onToolCancelled?: () => void;
    isBlocked: () => boolean;
    getBuildings: () => Iterable<BuildingRoadConnectionSource>;
    getBurgageZones: () => Iterable<BurgageZoneState>;
  };
  private enabled = false;
  private mode: Exclude<RoadToolMode, 'off'> = 'road';
  private points: THREE.Vector3[] = [];
  private segmentCurves: number[] = [];
  private pendingCurve = 0;
  private hoverPoint: THREE.Vector3 | null = null;
  private undoStack: RoadNetworkSnapshot[] = [];
  private redoStack: RoadNetworkSnapshot[] = [];
  private readonly preview: RoadPreview;
  private readonly buildingConnections: BuildingRoadConnections;
  private readonly roadNodeSnapMarkers: RoadNodeSnapMarkers;
  private lastHoverPreviewX = Number.NaN;
  private lastHoverPreviewZ = Number.NaN;
  private cachedDraftValidation: RoadPlacementResult | null = null;
  private lastValidationTime = 0;
  private validationDirty = true;
  private pointerClientX = Number.NaN;
  private pointerClientY = Number.NaN;
  private pointerDirty = false;
  private validationScheduled = false;
  private readonly previewSampleScratch: THREE.Vector3[] = [];
  private readonly anchorScratch: THREE.Vector3[] = [];
  private readonly curveScratch: number[] = [];
  private readonly boundarySnapScratch: Array<RoadBoundarySnap | null> = [];
  private readonly roadAlignmentSnapScratch: Array<RoadAlignmentTarget | null> = [];
  private readonly projectScratch = new THREE.Vector3();
  private cachedPreviewSignature = '';
  private readonly cachedPreviewPath: THREE.Vector3[] = [];
  private readonly wallSampleScratch: THREE.Vector3[] = [];
  private hoverWallRoadSnap: DryStoneWallRoadSnap | null = null;
  private hoverBoundarySnap: RoadBoundarySnap | null = null;
  private pointBoundarySnaps: Array<RoadBoundarySnap | null> = [];
  private hoverRoadAlignmentSnap: RoadAlignmentTarget | null = null;
  private pointRoadAlignmentSnaps: Array<RoadAlignmentTarget | null> = [];
  private wallStartTangent: THREE.Vector3 | null = null;
  private readonly deleteRaycaster = new THREE.Raycaster();
  private readonly deletePointer = new THREE.Vector2();
  private readonly secondaryClickGesture: SecondaryClickGesture;

  constructor(options: {
    domElement: HTMLElement;
    network: RoadNetwork;
    sceneManager: SceneManager;
    selection: RoadSelection;
    terrainProjector: TerrainProjector;
    onNetworkChanged: () => void;
    onStateChanged: () => void;
    onDeleteRequested: (request: RoadDeleteRequest | null) => void;
    onPlacementRejected?: (event: RoadPlacementRejectedEvent) => void;
    onDryStoneWallStartRejected?: () => void;
    onToggle?: () => void;
    onToolCancelled?: () => void;
    isBlocked: () => boolean;
    getBuildings: () => Iterable<BuildingRoadConnectionSource>;
    getBurgageZones: () => Iterable<BurgageZoneState>;
  }) {
    this.options = options;
    this.secondaryClickGesture = new SecondaryClickGesture({
      onClick: this.onSecondaryClick,
    });
    this.preview = new RoadPreview(options.sceneManager.roadMeshBuilder, options.sceneManager.materials);
    options.sceneManager.previewGroup.add(this.preview.group);
    this.buildingConnections = new BuildingRoadConnections({
      parent: options.sceneManager.previewGroup,
      terrain: options.sceneManager.terrain,
      getBuildings: options.getBuildings,
      getRoadNetwork: () => options.network,
    });
    this.roadNodeSnapMarkers = new RoadNodeSnapMarkers({
      parent: options.sceneManager.previewGroup,
      network: options.network,
    });
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    window.addEventListener('mousemove', this.onPointerMove, { capture: true });
    options.domElement.addEventListener('wheel', this.onWheel, { passive: false, capture: true });
    window.addEventListener('keydown', this.onKeyDown);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getMode(): RoadToolMode {
    return this.enabled ? this.mode : 'off';
  }

  hasDraft(): boolean {
    return this.points.length > 0;
  }

  isDraftBuildable(): boolean {
    return this.cachedDraftValidation?.ok ?? false;
  }

  setEnabled(enabled: boolean): void {
    if (enabled && this.enabled && this.mode !== 'road') {
      this.secondaryClickGesture.cancel();
      this.cancelDraft(false);
      this.mode = 'road';
      this.buildingConnections.setVisible(true);
      this.roadNodeSnapMarkers.setVisible(true);
      this.options.onStateChanged();
      return;
    }
    if (enabled && this.options.isBlocked()) return;
    if (this.enabled === enabled) return;
    if (enabled) this.mode = 'road';
    this.enabled = enabled;
    this.buildingConnections.setVisible(enabled && this.mode === 'road');
    this.roadNodeSnapMarkers.setVisible(enabled);
    if (
      enabled
      && Number.isFinite(this.pointerClientX)
      && Number.isFinite(this.pointerClientY)
    ) {
      this.processPointerHover(this.pointerClientX, this.pointerClientY);
    }
    this.options.onDeleteRequested(null);
    this.options.selection.setSelected(null);
    if (!enabled) {
      this.secondaryClickGesture.cancel();
      this.cancelDraft(false);
      this.preview.updateCursor(null);
      this.options.sceneManager.dryStoneWallRenderer.setPreviewCursor(null);
    }
    this.options.onStateChanged();
  }

  setMode(mode: RoadToolMode): void {
    if (mode === 'off') {
      this.setEnabled(false);
      return;
    }
    if (mode === 'road') {
      this.setEnabled(true);
      return;
    }
    if (this.options.isBlocked()) return;
    if (this.enabled && this.mode === mode) return;
    this.secondaryClickGesture.cancel();
    this.cancelDraft(false);
    this.mode = mode;
    this.enabled = true;
    this.buildingConnections.setVisible(false);
    this.roadNodeSnapMarkers.setVisible(true);
    this.options.onDeleteRequested(null);
    this.options.selection.setSelected(null);
    if (
      Number.isFinite(this.pointerClientX)
      && Number.isFinite(this.pointerClientY)
    ) {
      this.processPointerHover(this.pointerClientX, this.pointerClientY);
    }
    this.options.onStateChanged();
  }

  getCursor(): string | null {
    if (!this.enabled) return null;
    if (this.mode === 'dry-stone-wall') return 'crosshair';
    return this.hasDraft() ? 'crosshair' : 'copy';
  }

  getBuildButtonPosition(): { clientX: number; clientY: number } | null {
    if (!this.enabled || !this.isDraftBuildable()) return null;
    const lastPoint = this.points[this.points.length - 1];
    if (!lastPoint) return null;
    const rect = this.options.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const projected = this.projectScratch.copy(lastPoint);
    projected.y += 1.2;
    projected.project(this.options.sceneManager.camera);
    if (projected.z < -1 || projected.z > 1) return null;

    return {
      clientX: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      clientY: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  update(dt: number): void {
    if (!this.enabled) return;
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.processPointerHover(this.pointerClientX, this.pointerClientY);
    }
    if (this.mode === 'road') this.buildingConnections.update(dt);
    this.roadNodeSnapMarkers.update(dt);
    if (!this.hasDraft()) return;
    this.maybeRunDeferredValidation(false);
  }

  commitDraft(): void {
    if (this.options.isBlocked()) return;
    const path = this.buildDraftPath();
    const validation = validateRoadPlacement(path, this.minimumCommitLength());
    if (!validation.ok) {
      this.options.onPlacementRejected?.({ reason: validation.reason, action: 'commit' });
      return;
    }
    const snapshot = this.options.network.snapshot();
    if (this.mode === 'dry-stone-wall') {
      this.options.sceneManager.roadMeshBuilder.samplePathInto(
        path,
        WALL_SAMPLE_SPACING,
        this.wallSampleScratch,
        WALL_MAX_SAMPLES,
      );
      const wallId = this.options.network.addDryStoneWallPath(this.wallSampleScratch);
      if (!wallId) return;
    } else {
      const added = this.options.network.addRoadPath(path, ROAD_WIDTH);
      if (added.length === 0) return;
    }
    this.undoStack.push(snapshot);
    this.redoStack.length = 0;
    this.cancelDraft(false);
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
    this.options.onStateChanged();
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.redoStack.push(this.options.network.snapshot());
    this.options.network.restore(snapshot);
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
  }

  redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return;
    this.undoStack.push(this.options.network.snapshot());
    this.options.network.restore(snapshot);
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
  }

  deleteSelected(): void {
    const snapshot = this.options.network.snapshot();
    if (this.options.selection.deleteSelected()) {
      this.undoStack.push(snapshot);
      this.redoStack.length = 0;
      this.options.onNetworkChanged();
    }
  }

  confirmDelete(edgeId: string): void {
    const snapshot = this.options.network.snapshot();
    if (!this.options.network.deleteEdge(edgeId)) return;
    this.undoStack.push(snapshot);
    this.redoStack.length = 0;
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
    this.refreshPreview();
    this.options.onStateChanged();
  }

  confirmDryStoneWallDelete(wallId: string): void {
    const snapshot = this.options.network.snapshot();
    if (!this.options.network.deleteDryStoneWall(wallId)) return;
    this.undoStack.push(snapshot);
    this.redoStack.length = 0;
    this.options.selection.setSelected(null);
    this.options.onNetworkChanged();
    this.refreshPreview();
    this.options.onStateChanged();
  }

  shouldBlockCameraInput(event: MouseEvent | WheelEvent): boolean {
    if (!this.enabled) return false;
    return event instanceof WheelEvent && event.ctrlKey;
  }

  dispose(): void {
    this.secondaryClickGesture.dispose();
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, true);
    window.removeEventListener('mousemove', this.onPointerMove, true);
    this.options.domElement.removeEventListener('wheel', this.onWheel, true);
    window.removeEventListener('keydown', this.onKeyDown);
    this.preview.dispose();
    this.options.sceneManager.dryStoneWallRenderer.clearPreview();
    this.options.sceneManager.dryStoneWallRenderer.setPreviewCursor(null);
    this.buildingConnections.dispose();
    this.roadNodeSnapMarkers.dispose();
  }

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (!this.enabled || this.options.isBlocked()) return;
    if (this.secondaryClickGesture.begin(event)) return;
    if (event.button === 0 && event.altKey) {
      this.requestDelete(event);
      return;
    }
    if (event.button !== 0) return;
    const hit = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!hit) return;
    this.buildingConnections.setCursor(this.mode === 'road' ? hit : null);
    this.roadNodeSnapMarkers.setCursor(hit);
    event.preventDefault();
    event.stopPropagation();
    const rejectionReason = this.getInvalidClickReason();
    if (rejectionReason) {
      this.options.onPlacementRejected?.({ reason: rejectionReason, action: 'click' });
      return;
    }
    this.options.onDeleteRequested(null);
    this.options.selection.setSelected(null);
    const point = this.applySnap(hit);
    if (
      this.mode === 'dry-stone-wall'
      && !this.hasDraft()
      && !this.hoverWallRoadSnap
    ) {
      this.options.onDryStoneWallStartRejected?.();
      return;
    }
    if (this.mode === 'dry-stone-wall') {
      this.preview.updateCursor(null);
      this.options.sceneManager.dryStoneWallRenderer.setPreviewCursor(
        point,
        this.hasDraft() || Boolean(this.hoverWallRoadSnap),
      );
    } else {
      this.preview.updateCursor(point);
    }
    this.addRoadPoint(point);
  };

  private readonly onSecondaryClick = (event: MouseEvent): void => {
    if (!this.enabled || this.options.isBlocked()) return;
    event.preventDefault();
    if (this.hasDraft()) {
      this.undoLastPoint();
      return;
    }
    this.setEnabled(false);
    this.options.onToolCancelled?.();
  };

  private readonly onPointerMove = (event: MouseEvent): void => {
    this.pointerClientX = event.clientX;
    this.pointerClientY = event.clientY;
    if (!this.enabled) return;
    this.pointerDirty = true;
  };

  private processPointerHover(clientX: number, clientY: number): void {
    const hit = this.options.terrainProjector.pick(clientX, clientY);
    if (!hit) {
      this.buildingConnections.setCursor(null);
      this.roadNodeSnapMarkers.setCursor(null);
      this.preview.updateCursor(null);
      this.options.sceneManager.dryStoneWallRenderer.setPreviewCursor(null);
      this.hoverBoundarySnap = null;
      this.hoverRoadAlignmentSnap = null;
      return;
    }
    this.buildingConnections.setCursor(this.mode === 'road' ? hit : null);
    this.roadNodeSnapMarkers.setCursor(hit);
    const snapped = this.applySnap(hit);
    if (this.mode === 'dry-stone-wall') {
      this.preview.updateCursor(null);
      this.options.sceneManager.dryStoneWallRenderer.setPreviewCursor(
        snapped,
        this.hasDraft() || Boolean(this.hoverWallRoadSnap),
      );
    } else {
      this.options.sceneManager.dryStoneWallRenderer.setPreviewCursor(null);
      this.preview.updateCursor(snapped);
    }
    this.hoverPoint = snapped;
    if (!this.hasDraft()) return;
    if (this.shouldSkipHoverPreview(snapped)) return;
    this.lastHoverPreviewX = snapped.x;
    this.lastHoverPreviewZ = snapped.z;
    this.refreshPreviewVisual();
    this.validationDirty = true;
    this.scheduleDeferredValidation();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabled || !this.hasDraft() || !event.ctrlKey || event.deltaY === 0) return;
    const target = this.getCurveTarget();
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.deltaY > 0 ? -1 : 1;
    const steps = Math.max(1, Math.ceil(Math.abs(event.deltaY) / 100));
    const delta = direction * CURVE_WHEEL_STEP * steps;
    if (target === 'pending') {
      this.pendingCurve = clampCurve(this.pendingCurve + delta);
    } else {
      this.segmentCurves[target] = clampCurve((this.segmentCurves[target] ?? 0) + delta);
    }
    this.refreshPreview();
    this.options.onStateChanged();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    if (this.options.isBlocked()) return;
    const key = event.key.toLowerCase();
    if (key === 'r') {
      event.preventDefault();
      if (this.options.onToggle) this.options.onToggle();
      else this.setEnabled(!this.enabled);
      return;
    }
    if (key === 'escape') {
      event.preventDefault();
      if (this.hasDraft()) this.cancelDraft();
      else if (this.enabled) this.setEnabled(false);
      return;
    }
    if (key === 'enter' && this.hasDraft()) {
      event.preventDefault();
      this.commitDraft();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (this.hasDraft()) this.undoLastPoint();
      else this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (key === 'y' || (event.shiftKey && key === 'z'))) {
      event.preventDefault();
      this.redo();
      return;
    }
    if (key === 'delete' || key === 'backspace') this.deleteSelected();
  };

  private addRoadPoint(point: THREE.Vector3): void {
    const last = this.points[this.points.length - 1];
    if (last) {
      if (distanceXZ(last, point) < MIN_POINT_DISTANCE) return;
      this.segmentCurves.push(this.pendingCurve);
    }
    this.points.push(point.clone());
    this.pointBoundarySnaps.push(this.mode === 'road' ? this.hoverBoundarySnap : null);
    this.pointRoadAlignmentSnaps.push(
      this.mode === 'road' ? this.hoverRoadAlignmentSnap : null,
    );
    if (
      this.mode === 'dry-stone-wall'
      && this.points.length === 1
      && this.hoverWallRoadSnap
    ) {
      this.wallStartTangent = this.hoverWallRoadSnap.tangent.clone();
    }
    this.pendingCurve = 0;
    this.hoverPoint = null;
    this.resetHoverPreviewCache();
    this.refreshPreview();
    this.options.onStateChanged();
  }

  private undoLastPoint(): void {
    if (!this.hasDraft()) return;
    this.points.pop();
    this.pointBoundarySnaps.pop();
    this.pointRoadAlignmentSnaps.pop();
    if (this.segmentCurves.length >= this.points.length) this.segmentCurves.pop();
    this.pendingCurve = 0;
    this.hoverPoint = null;
    this.resetHoverPreviewCache();
    if (this.points.length === 0) this.cancelDraft();
    else {
      this.refreshPreview();
      this.options.onStateChanged();
    }
  }

  private requestDelete(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.mode === 'dry-stone-wall') {
      this.requestDryStoneWallDelete(event);
      return;
    }
    const edgeId = this.options.selection.pickEdgeId(event.clientX, event.clientY);
    if (!edgeId) {
      this.options.selection.setSelected(null);
      this.options.onDeleteRequested(null);
      return;
    }
    this.options.selection.setSelected(edgeId);
    this.options.onDeleteRequested({ kind: 'road', edgeId, clientX: event.clientX, clientY: event.clientY });
  }

  private requestDryStoneWallDelete(event: MouseEvent): void {
    const rect = this.options.domElement.getBoundingClientRect();
    this.deletePointer.set(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.deleteRaycaster.setFromCamera(
      this.deletePointer,
      this.options.sceneManager.camera,
    );
    const hits = this.deleteRaycaster.intersectObjects(
      this.options.sceneManager.getDryStoneWallPickMeshes(),
      true,
    );
    for (const hit of hits) {
      const wallIds = hit.object.userData.dryStoneWallIds as string[] | undefined;
      const instanceId = hit.instanceId;
      if (!wallIds || instanceId === undefined) continue;
      const wallId = wallIds[instanceId];
      if (!wallId) continue;
      this.options.onDeleteRequested({
        kind: 'dry-stone-wall',
        wallId,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      return;
    }
    this.options.onDeleteRequested(null);
  }

  private refreshPreview(): void {
    this.cachedPreviewSignature = '';
    this.runValidation(true);
    this.refreshPreviewVisual();
  }

  private refreshPreviewVisual(): void {
    if (!this.hasDraft()) {
      this.preview.clear();
      this.options.sceneManager.dryStoneWallRenderer.clearPreview();
      this.cachedDraftValidation = null;
      return;
    }

    const { anchors, path } = this.buildPreviewAnchors();
    const valid = this.cachedDraftValidation?.ok ?? true;
    if (this.mode === 'dry-stone-wall') {
      this.preview.clear();
      if (path.length < 2) {
        this.options.sceneManager.dryStoneWallRenderer.updatePreview(path, valid, anchors);
        return;
      }
      this.options.sceneManager.roadMeshBuilder.samplePathInto(
        path,
        WALL_SAMPLE_SPACING,
        this.wallSampleScratch,
        WALL_MAX_SAMPLES,
      );
      this.options.sceneManager.dryStoneWallRenderer.updatePreview(
        this.wallSampleScratch,
        valid,
        anchors,
      );
      return;
    }
    this.options.sceneManager.dryStoneWallRenderer.clearPreview();
    if (path.length < 2) {
      this.preview.update(path, valid, ROAD_WIDTH, anchors);
      return;
    }

    const meshBuilder = this.options.sceneManager.roadMeshBuilder;
    meshBuilder.samplePathInto(
      path,
      PREVIEW_MESH_SAMPLE_SPACING,
      this.previewSampleScratch,
      PREVIEW_MESH_MAX_SAMPLES,
    );
    this.preview.update(path, valid, ROAD_WIDTH, anchors, this.previewSampleScratch);
  }

  private scheduleDeferredValidation(): void {
    if (this.validationScheduled) return;
    this.validationScheduled = true;
    requestAnimationFrame(() => {
      this.validationScheduled = false;
      this.maybeRunDeferredValidation(false);
    });
  }

  private maybeRunDeferredValidation(force: boolean): void {
    if (!this.hasDraft()) return;
    if (!force && !this.validationDirty) return;
    const now = performance.now();
    if (!force && now - this.lastValidationTime < VALIDATION_INTERVAL_MS) return;
    this.runValidation(force);
  }

  private runValidation(_force: boolean): void {
    if (!this.hasDraft()) return;
    const { path } = this.buildPreviewAnchors();
    if (path.length < 2) {
      this.cachedDraftValidation = { ok: false, reason: 'too_short' };
      this.validationDirty = false;
      if (this.mode === 'dry-stone-wall') this.refreshPreviewVisual();
      else this.preview.setValidity(false);
      return;
    }

    const validation = validateRoadPlacement(path, this.minimumCommitLength());
    this.cachedDraftValidation = validation;
    this.validationDirty = false;
    this.lastValidationTime = performance.now();
    if (this.mode === 'dry-stone-wall') this.refreshPreviewVisual();
    else this.preview.setValidity(validation.ok);
  }

  private buildPreviewAnchors(): { anchors: THREE.Vector3[]; path: THREE.Vector3[] } {
    const signature = this.previewAnchorSignature();
    if (signature === this.cachedPreviewSignature && this.cachedPreviewPath.length >= 1) {
      return { anchors: this.anchorScratch, path: this.cachedPreviewPath };
    }

    const hover = this.getUsableHoverPoint();
    this.anchorScratch.length = 0;
    this.anchorScratch.push(...this.points);
    if (hover) this.anchorScratch.push(hover);

    this.curveScratch.length = 0;
    this.curveScratch.push(...this.segmentCurves);
    if (hover) this.curveScratch.push(this.pendingCurve);

    this.boundarySnapScratch.length = 0;
    this.boundarySnapScratch.push(...this.pointBoundarySnaps);
    if (hover) this.boundarySnapScratch.push(this.hoverBoundarySnap);

    this.roadAlignmentSnapScratch.length = 0;
    this.roadAlignmentSnapScratch.push(...this.pointRoadAlignmentSnaps);
    if (hover) this.roadAlignmentSnapScratch.push(this.hoverRoadAlignmentSnap);

    this.cachedPreviewPath.length = 0;
    const path = this.buildPathFromAnchorsInto(
      this.anchorScratch,
      this.curveScratch,
      this.cachedPreviewPath,
      this.boundarySnapScratch,
      this.roadAlignmentSnapScratch,
    );
    this.cachedPreviewSignature = signature;
    return { anchors: this.anchorScratch, path };
  }

  private previewAnchorSignature(): string {
    let hash = this.points.length * 31 + this.segmentCurves.length;
    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i];
      hash = (hash * 31 + Math.round(point.x * 10)) | 0;
      hash = (hash * 31 + Math.round(point.z * 10)) | 0;
    }
    for (let i = 0; i < this.segmentCurves.length; i++) {
      hash = (hash * 31 + Math.round(this.segmentCurves[i] * 10)) | 0;
    }
    hash = (hash * 31 + Math.round(this.pendingCurve * 10)) | 0;
    const hover = this.getUsableHoverPoint();
    if (hover) {
      hash = (hash * 31 + Math.round(hover.x * 10)) | 0;
      hash = (hash * 31 + Math.round(hover.z * 10)) | 0;
    }
    const boundarySnaps = hover
      ? [...this.pointBoundarySnaps, this.hoverBoundarySnap]
      : this.pointBoundarySnaps;
    for (const snap of boundarySnaps) {
      if (!snap) continue;
      hash = (hash * 31 + snap.edgeIndex + 1) | 0;
      for (let index = 0; index < snap.zoneId.length; index += 1) {
        hash = (hash * 31 + snap.zoneId.charCodeAt(index)) | 0;
      }
    }
    const roadSnaps = hover
      ? [...this.pointRoadAlignmentSnaps, this.hoverRoadAlignmentSnap]
      : this.pointRoadAlignmentSnaps;
    for (const snap of roadSnaps) {
      if (!snap) continue;
      for (const tangent of snap.tangents) {
        hash = (hash * 31 + Math.round(tangent.x * 100)) | 0;
        hash = (hash * 31 + Math.round(tangent.z * 100)) | 0;
      }
    }
    return `${hash}`;
  }

  private shouldSkipHoverPreview(point: THREE.Vector3): boolean {
    const dx = point.x - this.lastHoverPreviewX;
    const dz = point.z - this.lastHoverPreviewZ;
    if (!Number.isFinite(this.lastHoverPreviewX)) return false;
    return Math.hypot(dx, dz) < HOVER_PREVIEW_MOVE_THRESHOLD;
  }

  private resetHoverPreviewCache(): void {
    this.lastHoverPreviewX = Number.NaN;
    this.lastHoverPreviewZ = Number.NaN;
    this.cachedPreviewSignature = '';
    this.cachedPreviewPath.length = 0;
  }

  private applySnap(point: THREE.Vector3): THREE.Vector3 {
    if (this.mode === 'dry-stone-wall') {
      this.hoverBoundarySnap = null;
      this.hoverRoadAlignmentSnap = null;
      const roadside = findDryStoneWallRoadSnap(
        this.options.network,
        this.options.sceneManager.terrain,
        point,
      );
      this.hoverWallRoadSnap = roadside;
      if (roadside) return roadside.point.clone();
      const terrainPoint = this.options.sceneManager.terrain.getPointAt(point.x, point.z, 0);
      if (this.points.length === 1 && this.wallStartTangent) {
        return alignSecondWallAnchorParallel(
          this.points[0],
          this.wallStartTangent,
          terrainPoint,
          this.options.sceneManager.terrain,
        );
      }
      return terrainPoint;
    }
    this.hoverWallRoadSnap = null;
    this.buildingConnections.refresh();
    const networkSnap = this.options.network.findSnap(point, SNAP_DISTANCE);
    const draftSnap = this.findDraftSnap(point, SNAP_DISTANCE);
    const buildingSnap = this.buildingConnections.findSnap(point, SNAP_DISTANCE);
    const snap = pickNearestSnap(pickNearestSnap(networkSnap, draftSnap), buildingSnap);
    if (snap) {
      this.hoverBoundarySnap = snap === draftSnap
        ? draftSnap.boundarySnap
        : null;
      this.hoverRoadAlignmentSnap = snap === draftSnap
        ? draftSnap.roadAlignmentSnap
        : snap === networkSnap
          ? this.resolveRoadAlignmentSnap(networkSnap)
          : null;
      return snap.point.clone();
    }
    const boundarySnap = findRoadBoundarySnap(
      point,
      this.options.getBurgageZones(),
    );
    if (boundarySnap) {
      this.hoverBoundarySnap = boundarySnap;
      this.hoverRoadAlignmentSnap = null;
      return this.options.sceneManager.terrain.getPointAt(
        boundarySnap.point.x,
        boundarySnap.point.z,
        0,
      );
    }
    this.hoverBoundarySnap = null;
    this.hoverRoadAlignmentSnap = null;
    return this.options.sceneManager.terrain.getPointAt(point.x, point.z, 0);
  }

  private resolveRoadAlignmentSnap(snap: SnapTarget): RoadAlignmentTarget | null {
    const tangents: Array<{ x: number; z: number }> = [];
    if (snap.kind === 'node') {
      const node = this.options.network.nodes.get(snap.nodeId);
      if (!node) return null;
      for (const incident of this.options.network.getIncidents(node)) {
        const direction = inwardDirectionAtNode(incident.edge, node.id);
        tangents.push({ x: direction.x, z: direction.z });
      }
    } else {
      const edge = this.options.network.edges.get(snap.edgeId);
      if (!edge) return null;
      const path = getEdgePath(edge);
      if (path.length < 2) return null;
      const scaledIndex = THREE.MathUtils.clamp(snap.t, 0, 1) * (path.length - 1);
      const index = Math.min(path.length - 2, Math.floor(scaledIndex));
      const dx = path[index + 1].x - path[index].x;
      const dz = path[index + 1].z - path[index].z;
      const length = Math.hypot(dx, dz);
      if (length > 1e-5) tangents.push({ x: dx / length, z: dz / length });
    }
    return tangents.length > 0
      ? { point: { x: snap.point.x, z: snap.point.z }, tangents }
      : null;
  }

  private findDraftSnap(
    point: THREE.Vector3,
    maxDistance: number,
  ): {
    point: THREE.Vector3;
    distance: number;
    boundarySnap: RoadBoundarySnap | null;
    roadAlignmentSnap: RoadAlignmentTarget | null;
  } | null {
    let best: {
      point: THREE.Vector3;
      distance: number;
      boundarySnap: RoadBoundarySnap | null;
      roadAlignmentSnap: RoadAlignmentTarget | null;
    } | null = null;
    const lastIndex = this.points.length - 1;
    for (let i = 0; i < this.points.length; i++) {
      if (i === lastIndex) continue;
      const anchor = this.points[i];
      const distance = distanceXZ(point, anchor);
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = {
          point: anchor,
          distance,
          boundarySnap: this.pointBoundarySnaps[i] ?? null,
          roadAlignmentSnap: this.pointRoadAlignmentSnaps[i] ?? null,
        };
      }
    }
    return best;
  }

  private cancelDraft(notify = true): void {
    this.points = [];
    this.pointBoundarySnaps = [];
    this.pointRoadAlignmentSnaps = [];
    this.segmentCurves = [];
    this.pendingCurve = 0;
    this.hoverPoint = null;
    this.cachedDraftValidation = null;
    this.validationDirty = true;
    this.hoverWallRoadSnap = null;
    this.hoverBoundarySnap = null;
    this.hoverRoadAlignmentSnap = null;
    this.wallStartTangent = null;
    this.resetHoverPreviewCache();
    this.preview.clear();
    this.options.sceneManager.dryStoneWallRenderer.clearPreview();
    this.options.onDeleteRequested(null);
    if (notify) this.options.onStateChanged();
  }

  private buildDraftPath(): THREE.Vector3[] {
    return this.buildPathFromAnchors(
      this.points,
      this.segmentCurves,
      this.pointBoundarySnaps,
      this.pointRoadAlignmentSnaps,
    );
  }

  private buildPathFromAnchors(
    anchors: THREE.Vector3[],
    curves: number[],
    boundarySnaps: Array<RoadBoundarySnap | null> = [],
    roadAlignmentSnaps: Array<RoadAlignmentTarget | null> = [],
  ): THREE.Vector3[] {
    return this.buildPathFromAnchorsInto(
      anchors,
      curves,
      [],
      boundarySnaps,
      roadAlignmentSnaps,
    );
  }

  private buildPathFromAnchorsInto(
    anchors: THREE.Vector3[],
    curves: number[],
    out: THREE.Vector3[],
    boundarySnaps: Array<RoadBoundarySnap | null> = [],
    roadAlignmentSnaps: Array<RoadAlignmentTarget | null> = [],
  ): THREE.Vector3[] {
    out.length = 0;
    if (anchors.length === 0) return out;
    out.push(anchors[0].clone());
    const terrain = this.options.sceneManager.terrain;
    const midpointScratch = new THREE.Vector3();
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      const curve = curves[i] ?? 0;
      const boundaryStart = boundarySnaps[i] ?? null;
      const boundaryEnd = boundarySnaps[i + 1] ?? null;
      const roadStart = roadAlignmentSnaps[i] ?? null;
      const roadEnd = roadAlignmentSnaps[i + 1] ?? null;
      let constrainedPath: Array<{ x: number; z: number }> | null = null;
      if (Math.abs(curve) <= CURVE_EPSILON && this.mode === 'road') {
        if (boundaryStart && boundaryEnd) {
          constrainedPath = buildRoadBoundaryPath(boundaryStart, boundaryEnd);
        } else if (boundaryStart && roadEnd) {
          constrainedPath = buildRoadBoundaryToRoadPath(boundaryStart, roadEnd);
        } else if (roadStart && boundaryEnd) {
          constrainedPath = buildRoadBoundaryToRoadPath(boundaryEnd, roadStart);
          constrainedPath?.reverse();
        }
      }
      if (constrainedPath) {
        for (let pathIndex = 1; pathIndex < constrainedPath.length; pathIndex += 1) {
          if (pathIndex === constrainedPath.length - 1) {
            out.push(b.clone());
            continue;
          }
          const point = constrainedPath[pathIndex];
          const clamped = terrain.clampXZ(point.x, point.z);
          terrain.getPointAtInto(clamped.x, clamped.z, midpointScratch, 0);
          if (distanceXZ(out[out.length - 1], midpointScratch) >= 0.1) {
            out.push(midpointScratch.clone());
          }
        }
        continue;
      }
      if (Math.abs(curve) > CURVE_EPSILON) {
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        if (length > 0.001) {
          const normalX = -dz / length;
          const normalZ = dx / length;
          const x = (a.x + b.x) * 0.5 + normalX * curve;
          const z = (a.z + b.z) * 0.5 + normalZ * curve;
          const clamped = terrain.clampXZ(x, z);
          terrain.getPointAtInto(clamped.x, clamped.z, midpointScratch, 0);
          if (
            distanceXZ(out[out.length - 1], midpointScratch) >= 0.1
            && distanceXZ(midpointScratch, b) >= 0.1
          ) {
            out.push(midpointScratch.clone());
          }
        }
      }
      out.push(b.clone());
    }
    return out;
  }

  private getUsableHoverPoint(): THREE.Vector3 | null {
    if (!this.hoverPoint || this.points.length === 0) return null;
    const last = this.points[this.points.length - 1];
    return distanceXZ(last, this.hoverPoint) >= MIN_POINT_DISTANCE ? this.hoverPoint : null;
  }

  private getCurveTarget(): 'pending' | number | null {
    if (this.getUsableHoverPoint()) return 'pending';
    if (this.segmentCurves.length > 0) return this.segmentCurves.length - 1;
    return null;
  }

  private getInvalidClickReason(): RoadPlacementFailureReason | null {
    const hover = this.getUsableHoverPoint();
    if (!hover || !this.hasDraft()) return null;
    const path = this.buildPathFromAnchors(
      [...this.points, hover],
      [...this.segmentCurves, this.pendingCurve],
      [...this.pointBoundarySnaps, this.hoverBoundarySnap],
      [...this.pointRoadAlignmentSnaps, this.hoverRoadAlignmentSnap],
    );
    if (path.length < 2) return null;

    const result = validateRoadPlacement(path, this.minimumCommitLength());
    if (result.ok || result.reason === 'too_short') return null;
    return result.reason;
  }

  private minimumCommitLength(): number {
    return this.mode === 'dry-stone-wall'
      ? WALL_MIN_COMMIT_LENGTH
      : MIN_COMMIT_LENGTH;
  }
}

function distanceXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function pickNearestSnap(
  first: { point: THREE.Vector3; distance: number } | null,
  second: { point: THREE.Vector3; distance: number } | null,
): { point: THREE.Vector3; distance: number } | null {
  if (!first) return second;
  if (!second) return first;
  return first.distance <= second.distance ? first : second;
}

function clampCurve(value: number): number {
  return THREE.MathUtils.clamp(value, -MAX_CURVE_OFFSET, MAX_CURVE_OFFSET);
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element?.isContentEditable);
}
