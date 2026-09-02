import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { BuildingKind, GameState } from '../resources/types.ts';
import { computeResourceTotals } from '../resources/resourceTotals.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingPlacementFailureReason, BuildingPlacementResult } from './BuildingPlacementValidation.ts';
import {
  buildingFootprintOverlapsRoadSurface,
  chooseRoadClearBuildingPlacement,
  resolveBuildingPlacementPoint,
  validateBuildingPlacement,
} from './BuildingPlacementValidation.ts';
import type { BuildingMarkers } from './BuildingMarkers.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { TerrainBounds } from '../terrain/Terrain.ts';
import {
  buildingCostWithCarpenterSupport,
  carpenterCartServiceReady,
  hasRoadLinkedCarpenter,
  normalizeCarpenterCartServiceTargetTrips,
} from '../economy/carpenterSupport.ts';
import type { BuildingResourceCost } from '../resources/buildingEconomy.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import {
  buildingPlacementYaw,
  resolveRoadsideBuildingPlacementCandidates,
} from './buildingPlacement.ts';
import { resolveBuildingEdgeSnap } from './BuildingSpacing.ts';
import {
  resolveBuildingPlacementWildlifePreview,
} from './buildingPlacementWildlifePreview.ts';
import type { WorldMapSize } from '../world/worldGenerationSettings.ts';
import { SecondaryClickGesture } from '../input/SecondaryClickGesture.ts';

export type BuildingToolMode = BuildingKind | 'off';

type BuildingPlacementUndoEntry = {
  buildingId: string;
  kind: BuildingKind;
  x: number;
  z: number;
  yaw: number;
};

type BuildingPlacementRedoEntry = {
  kind: BuildingKind;
  x: number;
  z: number;
  yaw: number;
};

const BUILDING_POSITION_TOLERANCE = 0.75;
const BUILDING_SYNC_WAIT_MS = 2000;
const BUILDING_SYNC_POLL_MS = 50;
const PREVIEW_VALIDATION_INTERVAL_MS = 110;
const ROTATION_DRAG_THRESHOLD_PX = 5;
const ROTATION_RADIANS_PER_PIXEL = 0.012;

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  const tag = element?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(element?.isContentEditable);
}

type BuildingToolOptions = {
  domElement: HTMLElement;
  terrainProjector: TerrainProjector;
  markers: BuildingMarkers;
  getState: () => GameState;
  onPlaceBuilding: (kind: BuildingKind, x: number, z: number, yaw: number) => void | Promise<void>;
  onDemolishBuilding: (buildingId: string) => void | Promise<void>;
  isWaterAt: (x: number, z: number) => boolean;
  isResourceDepositAt?: (x: number, z: number) => boolean;
  getNaturalHeightAt: (x: number, z: number) => number;
  countMatureTreesInRadius?: (x: number, z: number, radius: number) => number | null;
  getRoadNetwork?: () => RoadNetwork;
  getMapSize: () => WorldMapSize;
  mapBounds: TerrainBounds;
  getDeliveryTravelSpeedMultiplier?: (origin: { x: number; z: number }) => number;
  onModeChanged: () => void;
  onToolCancelled?: () => void;
  onPlacementPreviewChanged?: () => void;
  describePlacementFailure?: (reason: BuildingPlacementFailureReason) => string;
  onPlacementRejected?: (reason: BuildingPlacementFailureReason) => void;
  onPlacementFailed?: (message: string, kind: BuildingKind) => void;
  onBuildingPlaced?: (kind: BuildingKind, buildingId: string) => void;
  onUndoFailed?: (message: string) => void;
  onRedoFailed?: (message: string) => void;
  isBlocked: () => boolean;
};

export class BuildingTool {
  private readonly options: BuildingToolOptions;
  private mode: BuildingToolMode = 'off';
  private pointerX = 0;
  private pointerY = 0;
  private pointerInside = false;
  private pointerDirty = false;
  private lastPreviewX = Number.NaN;
  private lastPreviewZ = Number.NaN;
  private lastValidatedX = Number.NaN;
  private lastValidatedZ = Number.NaN;
  private lastValidatedYaw = Number.NaN;
  private lastPreviewValidation: BuildingPlacementResult | null = null;
  private lastValidationTime = 0;
  private validationDirty = false;
  private lastWildlifePreviewSignature = '';
  private placementStatusDetail: string | null = null;
  private readonly previewMoveThreshold = 0.18;
  private readonly undoStack: BuildingPlacementUndoEntry[] = [];
  private readonly redoStack: BuildingPlacementRedoEntry[] = [];
  private placementPending = false;
  private placementIntentVersion = 0;
  private roadSnapEnabled = true;
  private manualYaw: number | undefined;
  private primaryGesture: {
    startX: number;
    startY: number;
    x: number;
    z: number;
    yaw: number;
    dragged: boolean;
  } | null = null;
  private readonly secondaryClickGesture: SecondaryClickGesture;

  constructor(options: BuildingToolOptions) {
    this.options = options;
    this.secondaryClickGesture = new SecondaryClickGesture({
      onClick: this.onSecondaryClick,
    });
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    options.domElement.addEventListener('mousemove', this.onPointerMove);
    options.domElement.addEventListener('mouseenter', this.onPointerEnter);
    options.domElement.addEventListener('mouseleave', this.onPointerLeave);
    window.addEventListener('mousemove', this.onRotationMove);
    window.addEventListener('mouseup', this.onPointerUp);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
  }

  getMode(): BuildingToolMode {
    return this.mode;
  }

  isRoadSnapEnabled(): boolean {
    return this.roadSnapEnabled;
  }

  setRoadSnapEnabled(enabled: boolean): void {
    if (this.roadSnapEnabled === enabled) return;
    this.roadSnapEnabled = enabled;
    this.resetPreviewCache();
    if (this.mode !== 'off' && !this.options.isBlocked()) {
      this.refreshPreview();
    }
  }

  isEnabled(): boolean {
    return this.mode !== 'off';
  }

  getPlacementEconomy(): {
    cost: BuildingResourceCost;
    carpenterSupported: boolean;
    carpenterCartServiceEnabled: boolean;
    carpenterCartServiceReady: boolean;
  } | null {
    if (this.mode === 'off') return null;
    const hasPreview = Number.isFinite(this.lastPreviewX)
      && Number.isFinite(this.lastPreviewZ);
    const state = this.options.getState();
    const isFoundersCampBootstrap = this.mode === 'founders_camp'
      && state.physicalFoundingSiteEnabled !== true;
    const disabledBuildingIds = fireDisabledBuildingIds(state.fireIncidents.values());
    const carpenterSupported = hasPreview && hasRoadLinkedCarpenter(
      state.buildings.values(),
      this.options.getRoadNetwork?.(),
      { x: this.lastPreviewX, z: this.lastPreviewZ },
      disabledBuildingIds,
    );
    const cartServiceReady = hasPreview && hasRoadLinkedCarpenter(
      state.buildings.values(),
      this.options.getRoadNetwork?.(),
      { x: this.lastPreviewX, z: this.lastPreviewZ },
      disabledBuildingIds,
      carpenterCartServiceReady,
    );
    const cartServiceEnabled = hasPreview && hasRoadLinkedCarpenter(
      state.buildings.values(),
      this.options.getRoadNetwork?.(),
      { x: this.lastPreviewX, z: this.lastPreviewZ },
      disabledBuildingIds,
      (building) => normalizeCarpenterCartServiceTargetTrips(
        building.carpenterCartServiceTargetTrips,
      ) > 0,
    );
    return {
      cost: isFoundersCampBootstrap
        ? { timber: 0, stone: 0 }
        : buildingCostWithCarpenterSupport(this.mode, carpenterSupported),
      carpenterSupported,
      carpenterCartServiceEnabled: cartServiceEnabled,
      carpenterCartServiceReady: cartServiceReady,
    };
  }

  shouldBlockCameraInput(_event: MouseEvent | WheelEvent): boolean {
    return this.primaryGesture !== null;
  }

  setMode(mode: BuildingToolMode): void {
    this.placementIntentVersion += 1;
    this.activateMode(mode);
  }

  private activateMode(mode: BuildingToolMode): void {
    this.secondaryClickGesture.cancel();
    if (mode !== 'off' && (this.options.isBlocked() || this.placementPending)) return;
    this.primaryGesture = null;
    this.manualYaw = undefined;
    this.mode = mode;
    this.resetPreviewCache();
    if (mode === 'off') {
      this.clearPreview();
    } else {
      this.refreshPreview();
    }
    this.options.onModeChanged();
  }

  toggleMode(kind: BuildingKind): void {
    this.setMode(this.mode === kind ? 'off' : kind);
  }

  update(): void {
    if (this.mode === 'off') return;
    if (this.options.isBlocked()) {
      this.primaryGesture = null;
      this.clearPreview();
      return;
    }
    if (this.pointerDirty) {
      this.pointerDirty = false;
      if (this.primaryGesture) this.refreshPreview();
      else this.processPointerHover();
      return;
    }
    this.maybeRefreshWildlifePreview();
    this.maybeRefreshDeferredValidation();
  }

  dispose(): void {
    this.primaryGesture = null;
    this.secondaryClickGesture.dispose();
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.options.domElement.removeEventListener('mousemove', this.onPointerMove);
    this.options.domElement.removeEventListener('mouseenter', this.onPointerEnter);
    this.options.domElement.removeEventListener('mouseleave', this.onPointerLeave);
    window.removeEventListener('mousemove', this.onRotationMove);
    window.removeEventListener('mouseup', this.onPointerUp);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
  }

  hasUndoRedo(): boolean {
    return this.undoStack.length > 0 || this.redoStack.length > 0;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();

    if (key === 'escape' && this.mode !== 'off' && !this.options.isBlocked()) {
      event.preventDefault();
      this.setMode('off');
      return;
    }

    if (!this.hasUndoRedo() || this.options.isBlocked()) return;

    if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      void this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (key === 'y' || (event.shiftKey && key === 'z'))) {
      event.preventDefault();
      event.stopPropagation();
      void this.redo();
    }
  };

  private readonly onPointerEnter = (): void => {
    this.pointerInside = true;
    this.pointerDirty = true;
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    if (!this.primaryGesture) this.clearPreview();
  };

  private readonly onPointerMove = (event: MouseEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    if (this.mode === 'off' || !this.pointerInside || this.options.isBlocked()) return;
    this.pointerDirty = true;
  };

  private processPointerHover(): void {
    const point = this.options.terrainProjector.pick(this.pointerX, this.pointerY);
    if (!point) {
      this.clearPreview();
      return;
    }

    const resolved = this.resolvePoint(this.mode as BuildingKind, point.x, point.z);
    const dx = resolved.x - this.lastPreviewX;
    const dz = resolved.z - this.lastPreviewZ;
    if (Number.isFinite(this.lastPreviewX) && Math.hypot(dx, dz) < this.previewMoveThreshold) {
      return;
    }

    this.refreshPreviewAt(new THREE.Vector3(resolved.x, point.y, resolved.z));
  }

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (this.mode === 'off' || this.options.isBlocked()) return;
    if (event.button !== 0) this.primaryGesture = null;
    if (this.secondaryClickGesture.begin(event)) return;
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    // A click immediately after a rotation uses the preview left at its pivot.
    // A moved cursor first catches up with the ordinary hover placement.
    if (this.pointerDirty || !Number.isFinite(this.lastPreviewX)
      || event.clientX !== this.pointerX || event.clientY !== this.pointerY) {
      this.pointerX = event.clientX;
      this.pointerY = event.clientY;
      this.processPointerHover();
    }
    this.pointerDirty = false;
    if (!Number.isFinite(this.lastPreviewX)) return;
    this.primaryGesture = {
      startX: event.clientX,
      startY: event.clientY,
      x: this.lastPreviewX,
      z: this.lastPreviewZ,
      yaw: this.resolveYaw(this.mode, this.lastPreviewX, this.lastPreviewZ),
      dragged: false,
    };
  };

  private updateRotationGesture(event: MouseEvent): void {
    const gesture = this.primaryGesture;
    if (!gesture) return;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    gesture.dragged ||= Math.hypot(dx, dy) > ROTATION_DRAG_THRESHOLD_PX;
    if (!gesture.dragged) return;
    const yaw = gesture.yaw + dx * ROTATION_RADIANS_PER_PIXEL;
    this.manualYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    this.pointerDirty = true;
  }

  private readonly onRotationMove = (event: MouseEvent): void => {
    if (!this.primaryGesture) return;
    if ((event.buttons & 1) === 0 || this.options.isBlocked()) {
      this.primaryGesture = null;
      this.pointerDirty = false;
      if (!this.pointerInside) this.clearPreview();
      return;
    }
    this.updateRotationGesture(event);
  };

  private readonly onPointerUp = (event: MouseEvent): void => {
    if (event.button !== 0 || !this.primaryGesture) return;
    const gesture = this.primaryGesture;
    this.updateRotationGesture(event);
    this.pointerDirty = false;
    if (this.mode === 'off' || this.options.isBlocked()) {
      this.primaryGesture = null;
      this.clearPreview();
      return;
    }
    // Never commit a drag, even if the cursor returns to its starting point.
    if (gesture.dragged) {
      this.refreshPreview();
      this.primaryGesture = null;
      if (!this.pointerInside) this.clearPreview();
      return;
    }
    this.primaryGesture = null;
    if (!this.options.domElement.contains(event.target as Node)) return;
    event.preventDefault();
    event.stopPropagation();
    const { x, z } = gesture;
    const yaw = this.resolveYaw(this.mode, x, z);
    const validation = this.validate(this.mode, x, z);
    if (!validation.ok) {
      this.revalidatePreview();
      this.options.onPlacementRejected?.(validation.reason);
      return;
    }
    const kind = this.mode;
    this.placementPending = true;
    this.setMode('off');
    const placementIntentVersion = this.placementIntentVersion;
    void this.placeAt(kind, x, z, yaw, placementIntentVersion);
  };

  private readonly onWindowBlur = (): void => {
    this.primaryGesture = null;
    this.clearPreview();
  };

  private readonly onSecondaryClick = (event: MouseEvent): void => {
    if (this.mode === 'off' || this.options.isBlocked()) return;
    event.preventDefault();
    this.setMode('off');
    this.options.onToolCancelled?.();
  };

  private async placeAt(
    kind: BuildingKind,
    x: number,
    z: number,
    yaw: number,
    placementIntentVersion: number,
  ): Promise<void> {
    const stateBeforePlacement = this.options.getState();
    const isFoundersCampBootstrap = kind === 'founders_camp'
      && stateBeforePlacement.physicalFoundingSiteEnabled !== true;
    const beforeIds = new Set(stateBeforePlacement.buildings.keys());
    this.options.markers.showPendingPlacement(kind, x, z, yaw);
    try {
      // Let the optimistic marker reach the screen before network and
      // authoritative world-sync work can occupy the main thread.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await this.options.onPlaceBuilding(kind, x, z, yaw);
      this.placementPending = false;
      const buildingId = await waitForPlacedBuilding(this.options.getState, beforeIds, kind, x, z);
      this.options.markers.clearPendingPlacement();
      if (buildingId && !isFoundersCampBootstrap) {
        this.undoStack.push({ buildingId, kind, x, z, yaw });
        this.redoStack.length = 0;
      }
      if (buildingId) {
        this.options.onBuildingPlaced?.(kind, buildingId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Building placement failed.';
      console.error('Building placement failed:', error);
      this.placementPending = false;
      this.options.markers.clearPendingPlacement();
      if (!this.options.isBlocked() && this.placementIntentVersion === placementIntentVersion) {
        this.setMode(kind);
        this.manualYaw = yaw;
        this.resetPreviewCache();
        this.refreshPreviewAt(new THREE.Vector3(x, 0, z));
      }
      this.options.onPlacementFailed?.(message, kind);
      return;
    }
  }

  private async undo(): Promise<void> {
    const entry = this.undoStack.pop();
    if (!entry) return;
    try {
      await this.options.onDemolishBuilding(entry.buildingId);
      this.redoStack.push({
        kind: entry.kind,
        x: entry.x,
        z: entry.z,
        yaw: entry.yaw,
      });
    } catch (error) {
      this.undoStack.push(entry);
      const message = error instanceof Error ? error.message : 'Building undo failed.';
      console.error('Building undo failed:', error);
      this.options.onUndoFailed?.(message);
    }
  }

  private async redo(): Promise<void> {
    const entry = this.redoStack.pop();
    if (!entry) return;
    const beforeIds = new Set(this.options.getState().buildings.keys());
    try {
      await this.options.onPlaceBuilding(entry.kind, entry.x, entry.z, entry.yaw);
      const buildingId = await waitForPlacedBuilding(
        this.options.getState,
        beforeIds,
        entry.kind,
        entry.x,
        entry.z,
      );
      if (!buildingId) {
        throw new Error('Redo could not find the placed building.');
      }
      this.undoStack.push({
        buildingId,
        kind: entry.kind,
        x: entry.x,
        z: entry.z,
        yaw: entry.yaw,
      });
    } catch (error) {
      this.redoStack.push(entry);
      const message = error instanceof Error ? error.message : 'Building redo failed.';
      console.error('Building redo failed:', error);
      this.options.onRedoFailed?.(message);
    }
  }

  private refreshPreview(): void {
    if (this.mode === 'off' || this.options.isBlocked()) {
      this.clearPreview();
      return;
    }

    if (this.primaryGesture) {
      this.refreshPreviewAt(new THREE.Vector3(this.primaryGesture.x, 0, this.primaryGesture.z));
      return;
    }

    const point = this.options.terrainProjector.pick(this.pointerX, this.pointerY);
    if (!point) {
      this.clearPreview();
      return;
    }

    const resolved = this.resolvePoint(this.mode, point.x, point.z);
    this.refreshPreviewAt(new THREE.Vector3(resolved.x, point.y, resolved.z));
  }

  private refreshPreviewAt(point: THREE.Vector3): void {
    if (this.mode === 'off') return;
    const kind = this.mode;
    this.lastPreviewX = point.x;
    this.lastPreviewZ = point.z;
    const validation = this.getPreviewValidation(point.x, point.z);
    this.publishPlacementPreview(
      kind,
      point.x,
      point.z,
      validation.ok,
      true,
    );
  }

  private publishPlacementPreview(
    kind: BuildingKind,
    x: number,
    z: number,
    valid: boolean,
    visible: boolean,
  ): void {
    const yaw = this.resolveYaw(kind, x, z);
    const wildlifePreview = resolveBuildingPlacementWildlifePreview(
      kind,
      x,
      z,
      yaw,
      this.options.getState().foragingNodes.values(),
    );
    this.lastWildlifePreviewSignature = wildlifePreview.signature;
    this.options.markers.setPlacementPreview(
      kind,
      x,
      z,
      valid,
      visible,
      wildlifePreview,
      yaw,
    );
  }

  private maybeRefreshWildlifePreview(): void {
    if (
      this.mode === 'off'
      || !Number.isFinite(this.lastPreviewX)
      || !Number.isFinite(this.lastPreviewZ)
      || !this.lastPreviewValidation
    ) {
      return;
    }
    const yaw = this.resolveYaw(this.mode, this.lastPreviewX, this.lastPreviewZ);
    const wildlifePreview = resolveBuildingPlacementWildlifePreview(
      this.mode,
      this.lastPreviewX,
      this.lastPreviewZ,
      yaw,
      this.options.getState().foragingNodes.values(),
    );
    if (wildlifePreview.signature === this.lastWildlifePreviewSignature) return;

    this.lastWildlifePreviewSignature = wildlifePreview.signature;
    this.options.markers.setPlacementPreview(
      this.mode,
      this.lastPreviewX,
      this.lastPreviewZ,
      this.lastPreviewValidation.ok,
      true,
      wildlifePreview,
      yaw,
    );
  }

  getStatusDetail(): string | null {
    return this.placementStatusDetail;
  }

  isPlacementBlocked(): boolean {
    return this.lastPreviewValidation?.ok === false;
  }

  isPlacementReady(): boolean {
    return this.lastPreviewValidation?.ok === true;
  }

  isPlacementResourceShortfall(): boolean {
    return this.lastPreviewValidation?.ok === false
      && this.lastPreviewValidation.reason === 'insufficient_resources';
  }

  invalidatePreview(): void {
    if (
      this.mode === 'off'
      || !Number.isFinite(this.lastPreviewX)
      || !Number.isFinite(this.lastPreviewZ)
    ) {
      return;
    }
    this.validationDirty = true;
    this.lastValidationTime = 0;
  }

  revalidatePreview(): void {
    if (
      this.mode === 'off'
      || !Number.isFinite(this.lastPreviewX)
      || !Number.isFinite(this.lastPreviewZ)
    ) {
      return;
    }
    const kind = this.mode;
    const validation = this.runPreviewValidation(
      this.lastPreviewX,
      this.lastPreviewZ,
      false,
    );
    this.publishPlacementPreview(
      kind,
      this.lastPreviewX,
      this.lastPreviewZ,
      validation.ok,
      true,
    );
  }

  markPlacementResourceShortfall(kind: BuildingKind): void {
    if (this.mode !== kind) return;
    const validation: BuildingPlacementResult = {
      ok: false,
      reason: 'insufficient_resources',
    };
    this.lastPreviewValidation = validation;
    this.validationDirty = false;
    this.lastValidationTime = performance.now();
    this.updatePlacementStatusDetail(this.mode, validation, false);
    if (Number.isFinite(this.lastPreviewX) && Number.isFinite(this.lastPreviewZ)) {
      this.publishPlacementPreview(
        this.mode,
        this.lastPreviewX,
        this.lastPreviewZ,
        false,
        true,
      );
    }
  }

  private getPreviewValidation(x: number, z: number): BuildingPlacementResult {
    const yaw = this.resolveYaw(this.mode as BuildingKind, x, z);
    const dx = x - this.lastValidatedX;
    const dz = z - this.lastValidatedZ;
    if (!this.validationDirty && this.lastPreviewValidation
      && Number.isFinite(this.lastValidatedX) && Math.hypot(dx, dz) < 0.02
      && yaw === this.lastValidatedYaw) {
      this.validationDirty = false;
      return this.lastPreviewValidation;
    }

    this.validationDirty = true;
    if (
      this.lastPreviewValidation
      && performance.now() - this.lastValidationTime < PREVIEW_VALIDATION_INTERVAL_MS
    ) {
      return this.lastPreviewValidation;
    }
    return this.runPreviewValidation(x, z);
  }

  private runPreviewValidation(
    x: number,
    z: number,
    notifyStatusChange = true,
  ): BuildingPlacementResult {
    const result = this.validate(this.mode as BuildingKind, x, z);
    this.lastValidatedX = x;
    this.lastValidatedZ = z;
    this.lastValidatedYaw = this.resolveYaw(this.mode as BuildingKind, x, z);
    this.lastPreviewValidation = result;
    this.lastValidationTime = performance.now();
    this.validationDirty = false;
    this.updatePlacementStatusDetail(
      this.mode as BuildingKind,
      result,
      notifyStatusChange,
    );
    return result;
  }

  private maybeRefreshDeferredValidation(): void {
    if (
      !this.validationDirty
      || this.mode === 'off'
      || !Number.isFinite(this.lastPreviewX)
      || performance.now() - this.lastValidationTime < PREVIEW_VALIDATION_INTERVAL_MS
    ) {
      return;
    }

    const kind = this.mode;
    const validation = this.runPreviewValidation(this.lastPreviewX, this.lastPreviewZ);
    this.publishPlacementPreview(
      kind,
      this.lastPreviewX,
      this.lastPreviewZ,
      validation.ok,
      true,
    );
  }

  private resetPreviewCache(): void {
    const hadPreviewState = this.lastPreviewValidation !== null
      || this.placementStatusDetail !== null;
    this.pointerDirty = false;
    this.lastPreviewX = Number.NaN;
    this.lastPreviewZ = Number.NaN;
    this.lastValidatedX = Number.NaN;
    this.lastValidatedZ = Number.NaN;
    this.lastValidatedYaw = Number.NaN;
    this.lastPreviewValidation = null;
    this.lastValidationTime = 0;
    this.validationDirty = false;
    this.lastWildlifePreviewSignature = '';
    this.placementStatusDetail = null;
    if (hadPreviewState) {
      this.options.onPlacementPreviewChanged?.();
    }
  }

  private updatePlacementStatusDetail(
    kind: BuildingKind,
    validation: BuildingPlacementResult,
    notify = true,
  ): void {
    if (
      kind === 'founders_camp'
      && this.options.getState().physicalFoundingSiteEnabled !== true
    ) {
      this.setPlacementStatusDetail(null, notify);
      return;
    }
    if (!validation.ok) {
      if (validation.reason === 'insufficient_resources') {
        this.setPlacementStatusDetail('Site clear', notify);
        return;
      }
      const detail = this.options.describePlacementFailure?.(
        validation.reason,
      ) ?? `Placement blocked: ${validation.reason}`;
      this.setPlacementStatusDetail(detail, notify);
      return;
    }
    this.setPlacementStatusDetail(
      kind === 'town_hall'
        ? 'Ready: population, civic buildings, and road links confirmed'
        : kind === 'guardhouse'
          ? 'Ready: completed watchtower confirmed'
          : 'Ready: site clear',
      notify,
    );
  }

  private setPlacementStatusDetail(detail: string | null, notify = true): void {
    if (detail === this.placementStatusDetail) return;
    this.placementStatusDetail = detail;
    if (notify) this.options.onPlacementPreviewChanged?.();
  }

  private validate(kind: BuildingKind, x: number, z: number) {
    const state = this.options.getState();
    const totals = computeResourceTotals(state);
    return validateBuildingPlacement(kind, x, z, {
      buildings: state.buildings.values(),
      residences: state.residences.values(),
      burgageZones: state.burgageZones.values(),
      farmFields: state.farmFields.values(),
      pastures: state.pastures.values(),
      vineyardParcels: state.vineyardParcels?.values(),
      quarries: state.quarries.values(),
      foragingNodes: state.foragingNodes.values(),
      stockpile: totals,
      isWaterAt: this.options.isWaterAt,
      isResourceDepositAt: this.options.isResourceDepositAt,
      getNaturalHeightAt: this.options.getNaturalHeightAt,
      countMatureTreesInRadius: this.options.countMatureTreesInRadius,
      roadNetwork: this.options.getRoadNetwork?.(),
      yaw: this.resolveYaw(kind, x, z),
      mapBounds: this.options.mapBounds,
      mapSize: this.options.getMapSize(),
      physicalFoundingSiteEnabled: state.physicalFoundingSiteEnabled,
      fireDisabledBuildingIds: fireDisabledBuildingIds(state.fireIncidents.values()),
    });
  }

  private resolvePoint(
    kind: BuildingKind,
    x: number,
    z: number,
  ): { x: number; z: number } {
    const state = this.options.getState();
    const resolved = resolveBuildingPlacementPoint(
      kind,
      x,
      z,
      state.quarries.values(),
    );
    const fullRoadNetwork = this.options.getRoadNetwork?.();
    const roadNetwork = this.roadSnapEnabled ? fullRoadNetwork : null;
    const roadsideCandidates = resolveRoadsideBuildingPlacementCandidates(
      kind,
      resolved.x,
      resolved.z,
      roadNetwork,
    );
    const roadsidePoint = roadNetwork
      ? chooseRoadClearBuildingPlacement(kind, roadsideCandidates, roadNetwork)
        ?? roadsideCandidates[0]
      : roadsideCandidates[0];
    return resolveBuildingEdgeSnap(
      kind,
      roadsidePoint.x,
      roadsidePoint.z,
      state.buildings.values(),
      fullRoadNetwork,
      fullRoadNetwork
        ? (candidateX, candidateZ) => buildingFootprintOverlapsRoadSurface(
          kind,
          candidateX,
          candidateZ,
          fullRoadNetwork,
          this.resolveYaw(kind, candidateX, candidateZ),
        )
        : undefined,
      this.manualYaw === undefined ? undefined : this.resolveYaw(kind, roadsidePoint.x, roadsidePoint.z),
    );
  }

  private resolveYaw(kind: BuildingKind, x: number, z: number): number {
    // Road snapping owns the facing near a road; retain the manual angle as
    // the fallback when moving the preview back into open terrain.
    const roads = this.roadSnapEnabled || this.manualYaw === undefined
      ? this.options.getRoadNetwork?.()
      : null;
    return buildingPlacementYaw(kind, x, z, roads, this.manualYaw);
  }

  private clearPreview(): void {
    this.resetPreviewCache();
    this.options.markers.clearPlacementPreview();
  }
}

function findPlacedBuildingId(
  buildings: Map<string, { id: string; kind: BuildingKind; x: number; z: number }>,
  beforeIds: Set<string>,
  kind: BuildingKind,
  x: number,
  z: number,
): string | null {
  for (const building of buildings.values()) {
    if (beforeIds.has(building.id)) continue;
    if (building.kind !== kind) continue;
    if (Math.hypot(building.x - x, building.z - z) > BUILDING_POSITION_TOLERANCE) continue;
    return building.id;
  }
  return null;
}

async function waitForPlacedBuilding(
  getState: () => GameState,
  beforeIds: Set<string>,
  kind: BuildingKind,
  x: number,
  z: number,
): Promise<string | null> {
  const deadline = performance.now() + BUILDING_SYNC_WAIT_MS;
  while (performance.now() < deadline) {
    const buildingId = findPlacedBuildingId(getState().buildings, beforeIds, kind, x, z);
    if (buildingId) return buildingId;
    await new Promise((resolve) => {
      window.setTimeout(resolve, BUILDING_SYNC_POLL_MS);
    });
  }
  return findPlacedBuildingId(getState().buildings, beforeIds, kind, x, z);
}

export function getBuildingToolLabel(mode: BuildingToolMode): string {
  if (mode === 'off') return 'Building tool off';
  return `${getBuildingDefinition(mode).label} placement`;
}
