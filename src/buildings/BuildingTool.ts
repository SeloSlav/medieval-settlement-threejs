import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { BuildingKind, GameState } from '../resources/types.ts';
import { computeResourceTotals } from '../resources/resourceTotals.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingPlacementFailureReason, BuildingPlacementResult } from './BuildingPlacementValidation.ts';
import {
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
  type ClayDepositSite,
} from '../clay/ClayDepositLayout.ts';
import { resolveRoadsideBuildingPlacementCandidates } from './buildingPlacement.ts';
import { resolveBuildingEdgeSnap } from './BuildingSpacing.ts';
import {
  linkedRemoteWorkCamp,
  REMOTE_WORK_CAMP_MAX_DISTANCE,
  supportsRemoteWorkCamp,
} from './remoteWorkCamp.ts';

export type BuildingToolMode = BuildingKind | 'off';

type BuildingPlacementUndoEntry = {
  buildingId: string;
  kind: BuildingKind;
  x: number;
  z: number;
  linkedWorksiteId: string | null;
};

type BuildingPlacementRedoEntry = {
  kind: BuildingKind;
  x: number;
  z: number;
  linkedWorksiteId: string | null;
};

const BUILDING_POSITION_TOLERANCE = 0.75;
const BUILDING_SYNC_WAIT_MS = 2000;
const BUILDING_SYNC_POLL_MS = 50;
const PREVIEW_VALIDATION_INTERVAL_MS = 110;

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
  onPlaceBuilding: (kind: BuildingKind, x: number, z: number) => void | Promise<void>;
  onPlaceRemoteWorkCamp: (worksiteId: string, x: number, z: number) => void | Promise<void>;
  onDemolishBuilding: (buildingId: string) => void | Promise<void>;
  isWaterAt: (x: number, z: number) => boolean;
  isResourceDepositAt?: (x: number, z: number) => boolean;
  clayDepositSites: readonly ClayDepositSite[];
  getNaturalHeightAt: (x: number, z: number) => number;
  countMatureTreesInRadius?: (x: number, z: number, radius: number) => number | null;
  getRoadNetwork?: () => RoadNetwork;
  mapBounds: TerrainBounds;
  getDeliveryTravelSpeedMultiplier?: (origin: { x: number; z: number }) => number;
  onModeChanged: () => void;
  onPlacementPreviewChanged?: () => void;
  describePlacementFailure?: (reason: BuildingPlacementFailureReason) => string;
  onPlacementRejected?: (reason: BuildingPlacementFailureReason) => void;
  onPlacementFailed?: (message: string) => void;
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
  private lastPreviewValidation: BuildingPlacementResult | null = null;
  private lastValidationTime = 0;
  private validationDirty = false;
  private placementStatusDetail: string | null = null;
  private readonly previewMoveThreshold = 0.18;
  private readonly undoStack: BuildingPlacementUndoEntry[] = [];
  private readonly redoStack: BuildingPlacementRedoEntry[] = [];
  private placementPending = false;
  private placementIntentVersion = 0;
  private roadSnapEnabled = true;
  private linkedWorksiteId: string | null = null;

  constructor(options: BuildingToolOptions) {
    this.options = options;
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    options.domElement.addEventListener('mousemove', this.onPointerMove);
    options.domElement.addEventListener('mouseenter', this.onPointerEnter);
    options.domElement.addEventListener('mouseleave', this.onPointerLeave);
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
      cost: buildingCostWithCarpenterSupport(this.mode, carpenterSupported),
      carpenterSupported,
      carpenterCartServiceEnabled: cartServiceEnabled,
      carpenterCartServiceReady: cartServiceReady,
    };
  }

  shouldBlockCameraInput(event: MouseEvent | WheelEvent): boolean {
    if (!this.isEnabled() || this.options.isBlocked()) return false;
    return event instanceof MouseEvent && event.button === 2;
  }

  setMode(mode: BuildingToolMode): void {
    this.placementIntentVersion += 1;
    this.linkedWorksiteId = null;
    this.activateMode(mode);
  }

  beginLinkedRemoteWorkCampPlacement(worksiteId: string): void {
    if (this.options.isBlocked() || this.placementPending) return;
    this.placementIntentVersion += 1;
    this.linkedWorksiteId = worksiteId;
    this.activateMode('remote_work_camp');
  }

  private activateMode(mode: BuildingToolMode): void {
    if (mode !== 'off' && (this.options.isBlocked() || this.placementPending)) return;
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
      this.clearPreview();
      return;
    }
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.processPointerHover();
      return;
    }
    this.maybeRefreshDeferredValidation();
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.options.domElement.removeEventListener('mousemove', this.onPointerMove);
    this.options.domElement.removeEventListener('mouseenter', this.onPointerEnter);
    this.options.domElement.removeEventListener('mouseleave', this.onPointerLeave);
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
    this.clearPreview();
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

    if (event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      this.setMode('off');
      return;
    }

    if (event.button !== 0) return;

    const point = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!point) return;

    const resolved = this.resolvePoint(this.mode, point.x, point.z);
    const validation = this.validate(this.mode, resolved.x, resolved.z);
    if (!validation.ok) {
      event.preventDefault();
      event.stopPropagation();
      this.options.onPlacementRejected?.(validation.reason);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const kind = this.mode;
    const linkedWorksiteId = this.linkedWorksiteId;
    this.placementPending = true;
    this.setMode('off');
    const placementIntentVersion = this.placementIntentVersion;
    void this.placeAt(kind, resolved.x, resolved.z, linkedWorksiteId, placementIntentVersion);
  };

  private async placeAt(
    kind: BuildingKind,
    x: number,
    z: number,
    linkedWorksiteId: string | null,
    placementIntentVersion: number,
  ): Promise<void> {
    const beforeIds = new Set(this.options.getState().buildings.keys());
    this.options.markers.showPendingPlacement(kind, x, z);
    try {
      // Let the optimistic marker reach the screen before network and
      // authoritative world-sync work can occupy the main thread.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (kind === 'remote_work_camp') {
        if (!linkedWorksiteId) throw new Error('Choose a rural worksite before placing its camp.');
        await this.options.onPlaceRemoteWorkCamp(linkedWorksiteId, x, z);
      } else {
        await this.options.onPlaceBuilding(kind, x, z);
      }
      this.placementPending = false;
      const buildingId = await waitForPlacedBuilding(this.options.getState, beforeIds, kind, x, z);
      this.options.markers.clearPendingPlacement();
      if (buildingId && kind !== 'founders_camp') {
        this.undoStack.push({ buildingId, kind, x, z, linkedWorksiteId });
        this.redoStack.length = 0;
      }
      if (buildingId) {
        this.options.onBuildingPlaced?.(kind, buildingId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Building placement failed.';
      console.error('Building placement failed:', error);
      this.options.onPlacementFailed?.(message);
      this.placementPending = false;
      this.options.markers.clearPendingPlacement();
      if (!this.options.isBlocked() && this.placementIntentVersion === placementIntentVersion) {
        if (kind === 'remote_work_camp' && linkedWorksiteId) {
          this.beginLinkedRemoteWorkCampPlacement(linkedWorksiteId);
        } else {
          this.setMode(kind);
        }
      }
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
        linkedWorksiteId: entry.linkedWorksiteId,
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
      if (entry.kind === 'remote_work_camp') {
        if (!entry.linkedWorksiteId) throw new Error('The camp no longer has a linked worksite.');
        await this.options.onPlaceRemoteWorkCamp(entry.linkedWorksiteId, entry.x, entry.z);
      } else {
        await this.options.onPlaceBuilding(entry.kind, entry.x, entry.z);
      }
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
        linkedWorksiteId: entry.linkedWorksiteId,
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
    this.options.markers.setPlacementPreview(
      kind,
      point.x,
      point.z,
      validation.ok,
      true,
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

  private getPreviewValidation(x: number, z: number): BuildingPlacementResult {
    const dx = x - this.lastValidatedX;
    const dz = z - this.lastValidatedZ;
    if (this.lastPreviewValidation && Number.isFinite(this.lastValidatedX) && Math.hypot(dx, dz) < 0.02) {
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

  private runPreviewValidation(x: number, z: number): BuildingPlacementResult {
    const result = this.validate(this.mode as BuildingKind, x, z);
    this.lastValidatedX = x;
    this.lastValidatedZ = z;
    this.lastPreviewValidation = result;
    this.lastValidationTime = performance.now();
    this.validationDirty = false;
    this.updatePlacementStatusDetail(this.mode as BuildingKind, result);
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
    this.options.markers.setPlacementPreview(
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
    this.lastPreviewValidation = null;
    this.lastValidationTime = 0;
    this.validationDirty = false;
    this.placementStatusDetail = null;
    if (hadPreviewState) {
      this.options.onPlacementPreviewChanged?.();
    }
  }

  private updatePlacementStatusDetail(
    kind: BuildingKind,
    validation: BuildingPlacementResult,
  ): void {
    if (!validation.ok) {
      const detail = this.options.describePlacementFailure?.(
        validation.reason,
      ) ?? `Placement blocked: ${validation.reason}`;
      this.setPlacementStatusDetail(detail);
      return;
    }
    if (kind === 'founders_camp') {
      this.setPlacementStatusDetail('Ready: click to establish the camp');
      return;
    }
    this.setPlacementStatusDetail(
      kind === 'town_hall'
        ? 'Ready: population, civic buildings, and road links confirmed'
        : kind === 'guardhouse'
          ? 'Ready: completed watchtower confirmed'
          : 'Ready: site clear',
    );
  }

  private setPlacementStatusDetail(detail: string | null): void {
    if (detail === this.placementStatusDetail) return;
    this.placementStatusDetail = detail;
    this.options.onPlacementPreviewChanged?.();
  }

  private validate(kind: BuildingKind, x: number, z: number) {
    const state = this.options.getState();
    if (kind === 'remote_work_camp') {
      const worksite = this.linkedWorksiteId
        ? state.buildings.get(this.linkedWorksiteId)
        : null;
      if (
        !worksite
        || worksite.constructionComplete === false
        || !supportsRemoteWorkCamp(worksite.kind)
      ) {
        return { ok: false as const, reason: 'requires_remote_worksite' as const };
      }
      if (linkedRemoteWorkCamp(worksite.id, state.buildings.values())) {
        return { ok: false as const, reason: 'remote_camp_exists' as const };
      }
      if (Math.hypot(x - worksite.x, z - worksite.z) > REMOTE_WORK_CAMP_MAX_DISTANCE) {
        return { ok: false as const, reason: 'outside_remote_worksite_range' as const };
      }
    }
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
      clayDepositSites: this.options.clayDepositSites,
      stockpile: totals,
      isWaterAt: this.options.isWaterAt,
      isResourceDepositAt: this.options.isResourceDepositAt,
      getNaturalHeightAt: this.options.getNaturalHeightAt,
      countMatureTreesInRadius: this.options.countMatureTreesInRadius,
      roadNetwork: this.options.getRoadNetwork?.(),
      mapBounds: this.options.mapBounds,
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
    );
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
