import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BurgageZoneState, GameState } from '../resources/types.ts';
import { computeResourceTotals } from '../resources/resourceTotals.ts';
import type { BurgageFrontageEdge, BurgageLayoutResult } from './burgageLayout.ts';
import { cornersFromPoints, getZoneEdge, MAX_ROAD_FRONTAGE_DISTANCE, MIN_ZONE_DEPTH, resolveBurgageLayout, STANDARD_ZONE_DEPTH, suggestPlotCount } from './burgageLayout.ts';
import {
  inwardNormalForFrontage,
  measureRawDepthFromBackPoint,
} from './burgageRectangle.ts';
import {
  resolveCurvedFrontageLine,
  resolveHoverFrontagePreview,
  snapBurgagePointBesideRoad,
} from './burgageRoadFrontage.ts';
import { initialPlotCount } from './burgagePlacementValidation.ts';
import { BurgagePreview } from './BurgagePreview.ts';
import {
  countValidFrontageEdges,
  cycleFrontageEdge,
  frontageEdgeLabel,
  validateBurgagePlacement,
  type BurgagePlacementFailureReason,
  type BurgagePlacementResult,
} from './burgagePlacementValidation.ts';
import type { PhysicalDepositFootprint } from '../resources/physicalDepositProtection.ts';
import {
  snapBurgageBoundaryPoint,
  snapBurgageFrontagePoint,
} from './burgagePlotSnap.ts';

const MIN_POINT_DISTANCE = 1.2;
const SNAP_DISTANCE = 6;
const HOVER_PREVIEW_MOVE_THRESHOLD = 0.35;
const VALIDATION_INTERVAL_MS = 180;
const ZONE_CORNER_TOLERANCE = 1.0;
const ZONE_SYNC_WAIT_MS = 2000;
const ZONE_SYNC_POLL_MS = 50;

type BurgagePlacementUndoEntry = {
  zoneId: string;
  commit: BurgageZoneCommit;
};

type BurgagePlacementRedoEntry = BurgageZoneCommit;

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element?.isContentEditable);
}

export type BurgageZoneCommit = {
  corners: THREE.Vector3[];
  frontageEdge: BurgageFrontageEdge;
  plotCount: number;
};

export type BurgageLayoutHudState = {
  plotCount: number;
  residenceCount: number | null;
  maxPlotCount: number;
  canDecrease: boolean;
  canIncrease: boolean;
  canRotateFrontage: boolean;
  frontageLabel: string | null;
  valid: boolean;
};

type BurgageToolOptions = {
  domElement: HTMLElement;
  camera: THREE.Camera;
  terrainProjector: TerrainProjector;
  roadNetwork: RoadNetwork;
  getState: () => GameState;
  getHeightAt: (x: number, z: number) => number;
  getNaturalHeightAt: (x: number, z: number) => number;
  isWaterAt: (x: number, z: number) => boolean;
  isResourceDepositAt?: (x: number, z: number) => boolean;
  physicalDeposits?: readonly PhysicalDepositFootprint[];
  onCommit: (commit: BurgageZoneCommit) => void | Promise<void>;
  onBurgageZonePlaced?: (zoneId: string) => void;
  onDemolishBurgageZone: (zoneId: string) => void | Promise<void>;
  onModeChanged: () => void;
  onPlacementRejected?: (reason: BurgagePlacementFailureReason) => void;
  onPlacementFailed?: (message: string) => void;
  onUndoFailed?: (message: string) => void;
  onRedoFailed?: (message: string) => void;
  onPickRejected?: (reason: 'missed_terrain' | 'too_close' | 'off_road') => void;
  isBlocked: () => boolean;
};

export class BurgageTool {
  private readonly options: BurgageToolOptions;
  private readonly preview: BurgagePreview;
  private enabled = false;
  private points: THREE.Vector3[] = [];
  private placementStage = 0;
  private frontageEdge: BurgageFrontageEdge = 0;
  private plotCount = 1;
  private plotCountTouched = false;
  private frontageTouched = false;
  private hoverPoint: THREE.Vector3 | null = null;
  private pointerInside = false;
  private pointerClientX = 0;
  private pointerClientY = 0;
  private pointerDirty = false;
  private lastHoverPreviewX = Number.NaN;
  private lastHoverPreviewZ = Number.NaN;
  private draftValidation: BurgagePlacementResult = { ok: false, reason: 'invalid_shape' };
  private cachedFrontageOptionCount = 0;
  private lastValidationTime = 0;
  private validationDirty = true;
  private validationScheduled = false;
  private previewLayout: BurgageLayoutResult | null = null;
  private frontageCenters: THREE.Vector3[] = [];
  private frontageOffsetSide: 1 | -1 | null = null;
  private hoverOffsetSide: 1 | -1 | null = null;
  private hoverCenter: THREE.Vector3 | null = null;
  private readonly undoStack: BurgagePlacementUndoEntry[] = [];
  private readonly redoStack: BurgagePlacementRedoEntry[] = [];
  private readonly layoutHudProjectionScratch = new THREE.Vector3();

  constructor(options: BurgageToolOptions) {
    this.options = options;
    this.preview = new BurgagePreview();
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    options.domElement.addEventListener('mousemove', this.onPointerMove);
    options.domElement.addEventListener('mouseenter', this.onPointerEnter);
    options.domElement.addEventListener('mouseleave', this.onPointerLeave);
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
  }

  hasUndoRedo(): boolean {
    return this.undoStack.length > 0 || this.redoStack.length > 0;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getCursor(): string | null {
    if (!this.enabled || this.options.isBlocked()) return null;
    return 'crosshair';
  }

  shouldBlockCameraInput(event: MouseEvent | WheelEvent): boolean {
    if (!this.enabled || this.options.isBlocked()) return false;
    return event instanceof MouseEvent && event.button === 2;
  }

  hasDraft(): boolean {
    return this.placementStage > 0;
  }

  isDraftBuildable(): boolean {
    return this.placementStage >= 4 && this.draftValidation.ok;
  }

  getPlacementCost(): { timber: number; stone: number } | null {
    return this.previewLayout?.totalCost ?? null;
  }

  isPlacementResourceShortfall(): boolean {
    return !this.draftValidation.ok
      && this.draftValidation.reason === 'insufficient_resources';
  }

  revalidatePreview(): void {
    if (!this.enabled || this.placementStage < 4) return;
    this.validationDirty = true;
    this.lastValidationTime = 0;
    this.runValidation(false);
  }

  markPlacementResourceShortfall(): void {
    if (!this.enabled || this.placementStage < 4 || !this.previewLayout) return;
    this.draftValidation = { ok: false, reason: 'insufficient_resources' };
    this.validationDirty = false;
    this.lastValidationTime = performance.now();
    this.preview.setValidity(false);
  }

  setEnabled(enabled: boolean): void {
    if (enabled && this.options.isBlocked()) return;
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.cancelDraft(false);
    } else {
      this.pointerDirty = true;
      this.refreshPreview();
    }
    this.options.onModeChanged();
  }

  getBuildButtonPosition(): { clientX: number; clientY: number } | null {
    if (!this.enabled || !this.isDraftBuildable() || this.placementStage < 4) return null;
    const anchor = this.points[1] ?? this.points[this.points.length - 1];
    const rect = this.options.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const projected = anchor.clone();
    projected.y += 1.4;
    projected.project(this.options.camera);
    if (projected.z < -1 || projected.z > 1) return null;
    return {
      clientX: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      clientY: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  getStatusDetail(): string | null {
    if (!this.enabled) return null;
    if (this.placementStage === 0) {
      return 'Click along the road to start the frontage (nearby residence-plot ends snap together)';
    }
    if (this.placementStage === 1) {
      return 'Click along the road to set the other end (nearby residence-plot ends snap together)';
    }
    if (this.placementStage === 2) {
      const depth = this.getPreviewDepthMeters();
      if (depth != null) {
        if (depth < MIN_ZONE_DEPTH - 0.05) {
          return `First back corner is too shallow — pull farther from the road (~${Math.round(MIN_ZONE_DEPTH)}m min)`;
        }
        const deepCostHint = depth > STANDARD_ZONE_DEPTH + 0.05
          ? ' · higher site-work cost'
          : '';
        return `Click to set the first back corner (point 3/4 · ~${Math.round(depth)}m deep${deepCostHint})`;
      }
      return `Click the first back corner (at least ~${Math.round(MIN_ZONE_DEPTH)}m from the road)`;
    }
    if (this.placementStage === 3) {
      const depth = this.getPreviewDepthMeters();
      if (depth != null) {
        if (depth < MIN_ZONE_DEPTH - 0.05) {
          return `Second back corner is too shallow — pull farther from the road (~${Math.round(MIN_ZONE_DEPTH)}m min)`;
        }
        const deepCostHint = depth > STANDARD_ZONE_DEPTH + 0.05
          ? ' · higher site-work cost'
          : '';
        return `Click to set the independent back corner (point 4/4 · ~${Math.round(depth)}m deep${deepCostHint})`;
      }
      return 'Click the other back corner to shape the angled rear boundary';
    }
    const validation = this.draftValidation;
    let layout: BurgageLayoutResult;
    if (!validation.ok) {
      if (validation.reason === 'too_small') return `Plot too shallow — pull the back edge farther from the road (~${Math.round(MIN_ZONE_DEPTH)}m min)`;
      if (validation.reason === 'no_fit') return 'Too many plots for this frontage — press − to reduce plot count';
      if (validation.reason === 'insufficient_resources') {
        if (!this.previewLayout) return 'Adjust plot shape or plot count';
        layout = this.previewLayout;
      } else {
        if (validation.reason === 'no_road_frontage') return 'Frontage must face a connected road';
        if (validation.reason === 'overlaps_existing') return 'Overlaps an existing residence zone — adjust shape or plot count';
        if (validation.reason === 'overlaps_building') return 'Overlaps a building — choose a different spot';
        if (validation.reason === 'overlaps_farm_field') return 'Overlaps cultivated farmland — choose a different spot';
        return 'Adjust plot shape or plot count';
      }
    } else {
      layout = validation.layout;
    }
    const count = layout.residences.length;
    const frontageOptions = this.cachedFrontageOptionCount;
    const frontageHint = frontageOptions > 1
      ? ` · frontage ${frontageEdgeLabel(this.frontageEdge)} (F to rotate)`
      : '';
    const depthCostHint = layout.depthCostMultiplier > 1.001
      ? ` · deep-lot site works ×${layout.depthCostMultiplier.toFixed(1)}`
      : '';
    const placementHint = validation.ok ? ' · hammer or Enter to place' : '';
    return `${count} cottage ${count === 1 ? 'worksite' : 'worksites'} planned${depthCostHint}${frontageHint}${placementHint}`;
  }

  getLayoutHudState(target?: BurgageLayoutHudState): BurgageLayoutHudState | null {
    if (!this.enabled || !this.canAdjustLayout()) return null;
    const maxPlotCount = this.getMaxPlotCount();
    const validation = this.draftValidation;
    const residenceCount = validation.ok ? validation.layout.residences.length : null;
    const frontageOptions = this.cachedFrontageOptionCount;
    const state = target ?? {
      plotCount: 0,
      residenceCount: null,
      maxPlotCount: 0,
      canDecrease: false,
      canIncrease: false,
      canRotateFrontage: false,
      frontageLabel: null,
      valid: false,
    };
    state.plotCount = this.plotCount;
    state.residenceCount = residenceCount;
    state.maxPlotCount = maxPlotCount;
    state.canDecrease = this.plotCount > 1;
    state.canIncrease = this.plotCount < maxPlotCount;
    state.canRotateFrontage = frontageOptions > 1;
    state.frontageLabel = frontageOptions > 1 ? frontageEdgeLabel(this.frontageEdge) : null;
    state.valid = validation.ok;
    return state;
  }

  getLayoutHudPosition(
    target?: { clientX: number; clientY: number },
  ): { clientX: number; clientY: number } | null {
    if (!this.enabled || !this.canAdjustLayout()) return null;
    const corners = this.placementStage >= 4 ? this.points : this.resolvePreviewCorners();
    if (corners.length !== 4) return null;

    const frontStart = corners[this.frontageEdge];
    const frontEnd = corners[(this.frontageEdge + 1) % 4];
    const midX = (frontStart.x + frontEnd.x) * 0.5;
    const midZ = (frontStart.z + frontEnd.z) * 0.5;
    const rect = this.options.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const projected = this.layoutHudProjectionScratch.set(
      midX,
      this.options.getHeightAt(midX, midZ) + 2.4,
      midZ,
    );
    projected.project(this.options.camera);
    if (projected.z < -1 || projected.z > 1) return null;

    const position = target ?? { clientX: 0, clientY: 0 };
    position.clientX = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
    position.clientY = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    return position;
  }

  adjustPlotCount(delta: number): void {
    if (!this.canAdjustLayout() || delta === 0) return;
    const maxPlotCount = this.getMaxPlotCount();
    const next = Math.max(1, Math.min(maxPlotCount, this.plotCount + delta));
    if (next === this.plotCount) return;
    this.plotCountTouched = true;
    this.plotCount = next;
    this.refreshPreview();
    this.options.onModeChanged();
  }

  rotateFrontageEdge(): void {
    if (!this.canAdjustLayout()) return;
    const corners = this.getZoneCorners();
    if (!corners) return;
    const next = cycleFrontageEdge(corners, this.options.roadNetwork, this.frontageEdge);
    if (next === this.frontageEdge) return;
    this.frontageTouched = true;
    this.frontageEdge = next;
    if (!this.plotCountTouched) this.syncPlotCountFromFrontage();
    this.refreshPreview();
    this.options.onModeChanged();
  }

  commitDraft(): void {
    if (this.placementStage < 4) return;
    const validation = this.computeValidation();
    if (!validation.ok) {
      this.rejectCommit(validation.reason);
      return;
    }
    void this.commitValidated();
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.options.domElement.removeEventListener('mousemove', this.onPointerMove);
    this.options.domElement.removeEventListener('mouseenter', this.onPointerEnter);
    this.options.domElement.removeEventListener('mouseleave', this.onPointerLeave);
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    this.preview.dispose();
  }

  attachTo(parent: THREE.Group): void {
    parent.add(this.preview.group);
  }

  update(): void {
    if (!this.enabled) {
      this.preview.clear();
      return;
    }
    if (this.options.isBlocked()) return;
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.processPointerHover(this.pointerClientX, this.pointerClientY);
      return;
    }
    this.maybeRunDeferredValidation(false);
  }

  private readonly onPointerEnter = (): void => {
    this.pointerInside = true;
    this.pointerDirty = true;
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.hoverPoint = null;
    this.hoverCenter = null;
    this.hoverOffsetSide = null;
    this.lastHoverPreviewX = Number.NaN;
    this.lastHoverPreviewZ = Number.NaN;
    this.refreshPreview();
  };

  private processPointerHover(clientX: number, clientY: number): void {
    if (!this.enabled || this.options.isBlocked() || !this.pointerInside) return;
    const point = this.pickPoint(clientX, clientY);
    if (point && this.shouldSkipHoverPreview(point)) return;
    this.hoverPoint = point;
    this.validationDirty = true;
    this.refreshPreviewVisual();
    this.scheduleDeferredValidation();
  }

  private readonly onPointerMove = (event: MouseEvent): void => {
    if (!this.enabled || this.options.isBlocked()) return;
    this.pointerClientX = event.clientX;
    this.pointerClientY = event.clientY;
    this.pointerDirty = true;
  };

  private shouldSkipHoverPreview(point: THREE.Vector3): boolean {
    const dx = point.x - this.lastHoverPreviewX;
    const dz = point.z - this.lastHoverPreviewZ;
    if (!Number.isFinite(this.lastHoverPreviewX)) return false;
    return Math.hypot(dx, dz) < HOVER_PREVIEW_MOVE_THRESHOLD;
  }

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (!this.enabled || this.options.isBlocked()) return;

    if (event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      if (this.hasDraft()) {
        this.undoLastStep();
      } else {
        this.setEnabled(false);
      }
      return;
    }

    if (event.button !== 0) return;
    if (event.altKey) return;

    const point = this.pickPoint(event.clientX, event.clientY);
    if (!point) {
      this.options.onPickRejected?.('missed_terrain');
      return;
    }

    if (this.placementStage >= 4) {
      const validation = this.computeValidation();
      if (!validation.ok) {
        event.preventDefault();
        event.stopPropagation();
        this.rejectCommit(validation.reason);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void this.commitValidated();
      return;
    }

    if (this.points.length > 0) {
      const last = this.points[this.points.length - 1];
      if (Math.hypot(point.x - last.x, point.z - last.z) < MIN_POINT_DISTANCE) {
        this.options.onPickRejected?.('too_close');
        return;
      }
    }

    event.preventDefault();
    event.stopPropagation();
    if (this.placementStage < 2) {
      this.recordFrontageCenter(event.clientX, event.clientY, point);
    }
    this.points.push(point);
    this.placementStage = this.points.length;
    // The pointer used to remain both the newly accepted corner and the next
    // hover corner until the mouse moved. That transient duplicate generated
    // zero-length/overlapping plot edges and validated the wrong four points.
    this.hoverPoint = null;
    this.hoverCenter = null;
    this.hoverOffsetSide = null;
    this.lastHoverPreviewX = Number.NaN;
    this.lastHoverPreviewZ = Number.NaN;
    if (this.placementStage === 4) {
      this.syncFrontageAndPlotCount();
    }
    this.options.onModeChanged();
    this.refreshPreview();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();

    if (this.hasUndoRedo() && !this.options.isBlocked()) {
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        void this.undoCommitted();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (key === 'y' || (event.shiftKey && key === 'z'))) {
        event.preventDefault();
        event.stopPropagation();
        void this.redoCommitted();
        return;
      }
    }

    if (!this.enabled || this.options.isBlocked()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.hasDraft()) this.cancelDraft(true);
      else this.setEnabled(false);
      return;
    }

    if (event.key === 'Backspace' && this.hasDraft()) {
      event.preventDefault();
      this.undoLastStep();
      return;
    }

    if (!this.canAdjustLayout()) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      this.commitDraft();
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.adjustPlotCount(1);
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      this.adjustPlotCount(-1);
      return;
    }
    if (event.code === 'KeyF') {
      event.preventDefault();
      this.rotateFrontageEdge();
    }
  };

  private async commitValidated(): Promise<void> {
    const validation = this.computeValidation();
    if (!validation.ok) {
      this.rejectCommit(validation.reason);
      return;
    }
    const commit: BurgageZoneCommit = {
      corners: this.points.map((point) => point.clone()),
      frontageEdge: this.frontageEdge,
      plotCount: validation.layout.plotCount,
    };
    const beforeIds = new Set(this.options.getState().burgageZones.keys());
    try {
      await this.options.onCommit(commit);
      const zoneId = await waitForPlacedZone(this.options.getState, beforeIds, commit);
      if (zoneId) {
        this.undoStack.push({ zoneId, commit });
        this.redoStack.length = 0;
        this.options.onBurgageZonePlaced?.(zoneId);
      }
      this.setEnabled(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Residence placement failed.';
      this.options.onPlacementFailed?.(message);
    }
  }

  private async undoCommitted(): Promise<void> {
    const entry = this.undoStack.pop();
    if (!entry) return;
    try {
      await this.options.onDemolishBurgageZone(entry.zoneId);
      this.redoStack.push(entry.commit);
    } catch (error) {
      this.undoStack.push(entry);
      const message = error instanceof Error ? error.message : 'Residence undo failed.';
      console.error('Residence undo failed:', error);
      this.options.onUndoFailed?.(message);
    }
  }

  private async redoCommitted(): Promise<void> {
    const entry = this.redoStack.pop();
    if (!entry) return;
    const beforeIds = new Set(this.options.getState().burgageZones.keys());
    try {
      await this.options.onCommit(entry);
      const zoneId = await waitForPlacedZone(this.options.getState, beforeIds, entry);
      if (!zoneId) {
        throw new Error('Redo could not find the placed residence zone.');
      }
      this.undoStack.push({ zoneId, commit: entry });
    } catch (error) {
      this.redoStack.push(entry);
      const message = error instanceof Error ? error.message : 'Residence redo failed.';
      console.error('Residence redo failed:', error);
      this.options.onRedoFailed?.(message);
    }
  }

  private rejectCommit(reason: BurgagePlacementFailureReason): void {
    this.options.onPlacementRejected?.(reason);
  }

  private undoLastStep(): void {
    if (this.placementStage >= 4) {
      this.points.pop();
      this.placementStage = 3;
      this.plotCountTouched = false;
      this.frontageTouched = false;
      this.clearDraftValidation();
      this.refreshPreview();
      this.options.onModeChanged();
      return;
    }

    if (this.placementStage === 3) {
      this.points.pop();
      this.placementStage = 2;
      this.clearDraftValidation();
      this.refreshPreview();
      this.options.onModeChanged();
      return;
    }

    if (this.placementStage === 2) {
      this.points.pop();
      this.frontageCenters.pop();
      this.placementStage = this.points.length;
      this.refreshPreview();
      this.options.onModeChanged();
      return;
    }

    if (this.placementStage === 1) {
      this.points = [];
      this.frontageCenters = [];
      this.frontageOffsetSide = null;
      this.placementStage = 0;
      this.refreshPreview();
      this.options.onModeChanged();
    }
  }

  private cancelDraft(notify: boolean): void {
    this.points = [];
    this.frontageCenters = [];
    this.frontageOffsetSide = null;
    this.hoverOffsetSide = null;
    this.placementStage = 0;
    this.hoverPoint = null;
    this.hoverCenter = null;
    this.lastHoverPreviewX = Number.NaN;
    this.lastHoverPreviewZ = Number.NaN;
    this.frontageEdge = 0;
    this.plotCount = 1;
    this.plotCountTouched = false;
    this.frontageTouched = false;
    this.clearDraftValidation();
    this.preview.clear();
    if (notify) this.options.onModeChanged();
  }

  private clearDraftValidation(): void {
    this.draftValidation = { ok: false, reason: 'invalid_shape' };
    this.cachedFrontageOptionCount = 0;
    this.previewLayout = null;
    this.validationDirty = true;
    this.lastValidationTime = 0;
  }

  private computeValidation(
    corners: THREE.Vector3[] = this.points,
    frontageEdge: BurgageFrontageEdge = this.frontageEdge,
    plotCount: number = this.plotCount,
    precomputedLayout: BurgageLayoutResult | null = null,
  ): BurgagePlacementResult {
    const state = this.options.getState();
    const totals = computeResourceTotals(state);
    return validateBurgagePlacement({
      corners,
      frontageEdge,
      plotCount,
      stockpile: totals,
      existingZones: state.burgageZones.values(),
      existingBuildings: state.buildings.values(),
      roadNetwork: this.options.roadNetwork,
      isWaterAt: this.options.isWaterAt,
      isResourceDepositAt: this.options.isResourceDepositAt,
      physicalDeposits: this.options.physicalDeposits,
      getNaturalHeightAt: this.options.getNaturalHeightAt,
      precomputedLayout,
      gameState: state,
    });
  }

  private refreshPreview(): void {
    this.validationDirty = true;
    this.refreshPreviewVisual();
    this.runValidation(true);
  }

  private refreshPreviewVisual(): void {
    const corners = this.resolvePreviewCorners();
    const placing = this.placementStage < 4;
    let previewFrontageEdge = this.frontageEdge;
    let previewPlotCount = this.plotCount;
    let layout: BurgageLayoutResult | null = null;

    const zoneCorners = corners.length === 4
      ? cornersFromPoints(corners.map((point) => ({ x: point.x, z: point.z })))
      : null;

    if (zoneCorners && this.canAdjustLayout() && !this.frontageTouched) {
      if (!this.plotCountTouched) {
        previewPlotCount = initialPlotCount(zoneCorners, previewFrontageEdge);
      }
      if (this.placementStage >= 4) {
        this.frontageEdge = previewFrontageEdge;
        if (!this.plotCountTouched) {
          this.plotCount = previewPlotCount;
        }
      }
    }

    if (zoneCorners) {
      layout = resolveBurgageLayout(zoneCorners, previewFrontageEdge, previewPlotCount);
      this.cachedFrontageOptionCount = countValidFrontageEdges(zoneCorners, this.options.roadNetwork);
    } else {
      this.cachedFrontageOptionCount = 0;
    }

    this.previewLayout = layout;

    if (this.hoverPoint) {
      this.lastHoverPreviewX = this.hoverPoint.x;
      this.lastHoverPreviewZ = this.hoverPoint.z;
    }
    // A moved draft has not been checked yet; keep it neutral until validation
    // catches up instead of painting the new geometry with the previous
    // cursor position's red result.
    const previewValid = this.validationDirty ? true : this.draftValidation.ok;
    const previewOutline = this.resolvePreviewOutline();
    const placedPoints = this.placementStage >= 4
      ? this.points.map((point) => point.clone())
      : this.points.map((point) => point.clone());
    this.preview.update(
      corners,
      layout,
      previewValid,
      this.options.getHeightAt,
      placing,
      this.placementStage,
      this.hoverPoint,
      previewFrontageEdge,
      previewOutline?.points ?? null,
      previewOutline?.frontagePointCount ?? 0,
      placedPoints,
      this.resolveDepthGuide(),
    );
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
    if (!this.enabled) return;
    if (!force && !this.validationDirty) return;
    const now = performance.now();
    if (!force && now - this.lastValidationTime < VALIDATION_INTERVAL_MS) return;
    this.runValidation(force);
  }

  private runValidation(force: boolean): void {
    const corners = this.resolvePreviewCorners();
    if (!this.canAdjustLayout() || corners.length !== 4) {
      this.draftValidation = { ok: false, reason: 'invalid_shape' };
      this.validationDirty = false;
      this.preview.setValidity(false);
      if (force) this.options.onModeChanged();
      return;
    }

    const zoneCorners = cornersFromPoints(corners.map((point) => ({ x: point.x, z: point.z })));
    if (!zoneCorners) {
      this.draftValidation = { ok: false, reason: 'invalid_shape' };
      this.validationDirty = false;
      this.preview.setValidity(false);
      if (force) this.options.onModeChanged();
      return;
    }

    let previewFrontageEdge = this.frontageEdge;
    let previewPlotCount = this.plotCount;
    if (!this.frontageTouched) {
      if (!this.plotCountTouched) {
        previewPlotCount = initialPlotCount(zoneCorners, previewFrontageEdge);
      }
    }

    const layout = this.previewLayout
      ?? resolveBurgageLayout(zoneCorners, previewFrontageEdge, previewPlotCount);
    this.draftValidation = this.computeValidation(
      corners,
      previewFrontageEdge,
      previewPlotCount,
      layout,
    );
    this.validationDirty = false;
    this.lastValidationTime = performance.now();
    this.preview.setValidity(this.draftValidation.ok);
    if (force) this.options.onModeChanged();
  }

  private resolvePreviewCorners(): THREE.Vector3[] {
    if (this.placementStage >= 4) {
      return this.points.map((point) => point.clone());
    }

    if (this.points.length === 3) {
      if (!this.hoverPoint) return this.points.map((point) => point.clone());
      return [
        this.points[0].clone(),
        this.points[1].clone(),
        this.points[2].clone(),
        this.hoverPoint.clone(),
      ];
    }

    if (this.points.length === 2 && this.hoverPoint) {
      const frontStart = this.points[0];
      const frontEnd = this.points[1];
      const firstRear = this.hoverPoint;
      const otherRearX = frontStart.x + (firstRear.x - frontEnd.x);
      const otherRearZ = frontStart.z + (firstRear.z - frontEnd.z);
      return [
        frontStart.clone(),
        frontEnd.clone(),
        firstRear.clone(),
        new THREE.Vector3(
          otherRearX,
          this.options.getHeightAt(otherRearX, otherRearZ),
          otherRearZ,
        ),
      ];
    }

    if (this.points.length === 1) {
      const corners = [this.points[0].clone()];
      if (this.hoverPoint) corners.push(this.hoverPoint.clone());
      return corners;
    }

    return this.points.map((point) => point.clone());
  }

  private resolvePreviewOutline(): { points: THREE.Vector3[]; frontagePointCount: number } | null {
    if (this.points.length === 0) {
      const hoverCenter = this.getHoverFrontageCenter();
      if (!hoverCenter || !this.shouldSnapToRoad()) return null;
      return resolveHoverFrontagePreview(
        hoverCenter,
        this.options.roadNetwork,
        this.hoverOffsetSide ?? this.frontageOffsetSide ?? 1,
        this.options.getHeightAt,
      );
    }

    const secondPoint = this.points.length >= 2 ? this.points[1] : this.hoverPoint;
    if (!secondPoint) return null;

    const frontStart = { x: this.points[0].x, z: this.points[0].z };
    const frontEnd = { x: secondPoint.x, z: secondPoint.z };
    const centerStart = this.frontageCenters[0]
      ? { x: this.frontageCenters[0].x, z: this.frontageCenters[0].z }
      : undefined;
    const centerEnd = this.points.length >= 2 && this.frontageCenters[1]
      ? { x: this.frontageCenters[1].x, z: this.frontageCenters[1].z }
      : this.getHoverFrontageCenter() ?? undefined;

    if (this.placementStage < 2) {
      const frontLine = resolveCurvedFrontageLine(
        frontStart,
        frontEnd,
        this.options.roadNetwork,
        centerStart,
        centerEnd ?? undefined,
        this.frontageOffsetSide ?? 1,
      );
      const points = frontLine.map((point) => {
        const y = this.options.getHeightAt(point.x, point.z);
        return new THREE.Vector3(point.x, y, point.z);
      });
      return { points, frontagePointCount: points.length };
    }

    const previewCorners = this.resolvePreviewCorners();
    const frontLine = resolveCurvedFrontageLine(
      frontStart,
      frontEnd,
      this.options.roadNetwork,
      centerStart,
      centerEnd,
      this.frontageOffsetSide ?? 1,
    );
    const outline = [
      ...frontLine,
      ...previewCorners.slice(2).map((point) => ({ x: point.x, z: point.z })),
    ];
    const points = outline.map((point) => {
      const y = this.options.getHeightAt(point.x, point.z);
      return new THREE.Vector3(point.x, y, point.z);
    });
    return { points, frontagePointCount: frontLine.length };
  }

  private getHoverFrontageCenter(): { x: number; z: number } | null {
    if (!this.hoverCenter) return null;
    return { x: this.hoverCenter.x, z: this.hoverCenter.z };
  }

  private recordFrontageCenter(_clientX: number, _clientY: number, _offsetPoint: THREE.Vector3): void {
    if (!this.hoverCenter) return;
    this.frontageCenters.push(this.hoverCenter.clone());
    if (this.frontageOffsetSide === null && this.hoverOffsetSide !== null) {
      this.frontageOffsetSide = this.hoverOffsetSide;
    }
  }

  private canAdjustLayout(): boolean {
    return this.placementStage >= 2;
  }

  private getPreviewDepthMeters(): number | null {
    if (this.points.length < 2) return null;
    const backPoint = this.hoverPoint;
    if (!backPoint) return null;
    const frontStart = { x: this.points[0].x, z: this.points[0].z };
    const frontEnd = { x: this.points[1].x, z: this.points[1].z };
    const inward = inwardNormalForFrontage(frontStart, frontEnd, this.options.roadNetwork);
    const depthAnchor = this.placementStage === 3 ? frontStart : frontEnd;
    return measureRawDepthFromBackPoint(
      depthAnchor,
      { x: backPoint.x, z: backPoint.z },
      inward,
    );
  }

  private resolveDepthGuide(): { from: THREE.Vector3; to: THREE.Vector3 } | null {
    if ((this.placementStage !== 2 && this.placementStage !== 3)
      || this.points.length < 2
      || !this.hoverPoint) return null;
    const anchor = this.placementStage === 3 ? this.points[0] : this.points[1];
    const heightAt = this.options.getHeightAt;
    return {
      from: new THREE.Vector3(
        anchor.x,
        heightAt(anchor.x, anchor.z) + 0.48,
        anchor.z,
      ),
      to: new THREE.Vector3(
        this.hoverPoint.x,
        heightAt(this.hoverPoint.x, this.hoverPoint.z) + 0.48,
        this.hoverPoint.z,
      ),
    };
  }

  private getZoneCorners() {
    const corners = this.resolvePreviewCorners();
    if (corners.length !== 4) return null;
    return cornersFromPoints(corners.map((point) => ({ x: point.x, z: point.z })));
  }

  private syncFrontageAndPlotCount(): void {
    const corners = this.getZoneCorners();
    if (!corners) return;
    this.frontageEdge = 0;
    this.frontageTouched = false;
    this.syncPlotCountFromFrontage();
  }

  private syncPlotCountFromFrontage(): void {
    const corners = this.getZoneCorners();
    if (!corners) return;
    this.plotCount = initialPlotCount(corners, this.frontageEdge);
  }

  private getMaxPlotCount(): number {
    const corners = this.getZoneCorners();
    if (!corners) return 1;
    const [start, end] = getZoneEdge(corners, this.frontageEdge);
    return suggestPlotCount(Math.hypot(end.x - start.x, end.z - start.z));
  }

  private pickPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const picked = this.options.terrainProjector.pick(clientX, clientY);
    if (!picked) return null;
    if (this.shouldSnapToRoad()) {
      const snap = this.options.roadNetwork.findSnap(picked, SNAP_DISTANCE);
      if (!snap) {
        this.hoverCenter = null;
        this.hoverOffsetSide = null;
        this.options.onPickRejected?.('off_road');
        return null;
      }
      const roadPoint = this.applyRoadSnap(picked);
      const point = this.snapFrontagePointToExistingPlots(roadPoint);
      return new THREE.Vector3(point.x, point.y, point.z);
    }
    this.hoverCenter = null;
    const constrained = this.constrainBackPointToMinimumDepth(
      new THREE.Vector3(picked.x, picked.y, picked.z),
    );
    return this.snapBackPointToExistingPlots(constrained);
  }

  private snapFrontagePointToExistingPlots(point: THREE.Vector3): THREE.Vector3 {
    const snapped = snapBurgageFrontagePoint(
      point,
      this.options.getState().burgageZones.values(),
    );
    if (Math.hypot(snapped.x - point.x, snapped.z - point.z) <= 1e-6) return point;

    // Keep the curved frontage preview anchored to the road position that
    // corresponds to the existing plot corner, rather than the raw cursor.
    const roadSnap = this.options.roadNetwork.findSnap(
      new THREE.Vector3(snapped.x, point.y, snapped.z),
      MAX_ROAD_FRONTAGE_DISTANCE,
    );
    if (!roadSnap) return point;
    this.hoverCenter = roadSnap.point.clone();
    return new THREE.Vector3(
      snapped.x,
      this.options.getHeightAt(snapped.x, snapped.z),
      snapped.z,
    );
  }

  private snapBackPointToExistingPlots(point: THREE.Vector3): THREE.Vector3 {
    const snapped = snapBurgageBoundaryPoint(
      point,
      this.options.getState().burgageZones.values(),
      undefined,
      (candidate) => this.backPointMeetsMinimumDepth(candidate),
    );
    return new THREE.Vector3(
      snapped.x,
      this.options.getHeightAt(snapped.x, snapped.z),
      snapped.z,
    );
  }

  private backPointMeetsMinimumDepth(point: { x: number; z: number }): boolean {
    if ((this.placementStage !== 2 && this.placementStage !== 3) || this.points.length < 2) {
      return true;
    }
    const frontStart = this.points[0];
    const frontEnd = this.points[1];
    const inward = inwardNormalForFrontage(frontStart, frontEnd, this.options.roadNetwork);
    const anchor = this.placementStage === 3 ? frontStart : frontEnd;
    return measureRawDepthFromBackPoint(anchor, point, inward) >= MIN_ZONE_DEPTH - 0.05;
  }

  private constrainBackPointToMinimumDepth(point: THREE.Vector3): THREE.Vector3 {
    if ((this.placementStage !== 2 && this.placementStage !== 3) || this.points.length < 2) {
      return point;
    }
    const frontStart = this.points[0];
    const frontEnd = this.points[1];
    const inward = inwardNormalForFrontage(frontStart, frontEnd, this.options.roadNetwork);
    const anchor = this.placementStage === 3 ? frontStart : frontEnd;
    const depth = measureRawDepthFromBackPoint(anchor, point, inward);
    if (depth >= MIN_ZONE_DEPTH) return point;

    const correction = MIN_ZONE_DEPTH - depth;
    point.x += inward.x * correction;
    point.z += inward.z * correction;
    point.y = this.options.getHeightAt(point.x, point.z);
    return point;
  }

  private shouldSnapToRoad(): boolean {
    return this.placementStage < 2;
  }

  private applyRoadSnap(point: THREE.Vector3): THREE.Vector3 {
    const beside = snapBurgagePointBesideRoad(
      point,
      this.options.roadNetwork,
      SNAP_DISTANCE,
      this.frontageOffsetSide,
    );
    // Hovering may freely cross the road. Lock the selected side only when the
    // first frontage point is actually accepted in recordFrontageCenter().
    this.hoverOffsetSide = beside.side;
    this.hoverCenter = beside.center;
    beside.point.y = point.y;
    return beside.point;
  }
}

function zoneMatchesCommit(zone: BurgageZoneState, commit: BurgageZoneCommit): boolean {
  if (zone.frontageEdge !== commit.frontageEdge) return false;
  const zoneCorners = [zone.cornerA, zone.cornerB, zone.cornerC, zone.cornerD];
  for (let i = 0; i < 4; i++) {
    const corner = zoneCorners[i];
    const commitCorner = commit.corners[i];
    if (!commitCorner) return false;
    if (Math.hypot(corner.x - commitCorner.x, corner.z - commitCorner.z) > ZONE_CORNER_TOLERANCE) {
      return false;
    }
  }
  return true;
}

function findPlacedZoneId(
  zones: Map<string, BurgageZoneState>,
  beforeIds: Set<string>,
  commit: BurgageZoneCommit,
): string | null {
  for (const zone of zones.values()) {
    if (beforeIds.has(zone.id)) continue;
    if (zoneMatchesCommit(zone, commit)) return zone.id;
  }
  return null;
}

async function waitForPlacedZone(
  getState: () => GameState,
  beforeIds: Set<string>,
  commit: BurgageZoneCommit,
): Promise<string | null> {
  const deadline = performance.now() + ZONE_SYNC_WAIT_MS;
  while (performance.now() < deadline) {
    const zoneId = findPlacedZoneId(getState().burgageZones, beforeIds, commit);
    if (zoneId) return zoneId;
    await new Promise((resolve) => {
      window.setTimeout(resolve, ZONE_SYNC_POLL_MS);
    });
  }
  return findPlacedZoneId(getState().burgageZones, beforeIds, commit);
}
