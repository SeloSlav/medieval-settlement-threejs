import * as THREE from 'three';
import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { BuildingKind, GameState } from '../resources/types.ts';
import { computeResourceTotals } from '../resources/resourceTotals.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingPlacementFailureReason, BuildingPlacementResult } from './BuildingPlacementValidation.ts';
import {
  foragerPlacementCandidates,
  resolveBuildingPlacementPoint,
  validateBuildingPlacement,
} from './BuildingPlacementValidation.ts';
import type { BuildingMarkers } from './BuildingMarkers.ts';
import type { BuildingTerrainSource } from './BuildingTerrainLayout.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { getBuildingExtent } from './buildingExtents.ts';

export type BuildingToolMode = BuildingKind | 'off';

type BuildingPlacementUndoEntry = {
  buildingId: string;
  kind: BuildingKind;
  x: number;
  z: number;
};

type BuildingPlacementRedoEntry = {
  kind: BuildingKind;
  x: number;
  z: number;
};

const BUILDING_POSITION_TOLERANCE = 0.75;
const BUILDING_SYNC_WAIT_MS = 2000;
const BUILDING_SYNC_POLL_MS = 50;

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
  onDemolishBuilding: (buildingId: string) => void | Promise<void>;
  isWaterAt: (x: number, z: number) => boolean;
  isQuarryPitAt?: (x: number, z: number) => boolean;
  getNaturalHeightAt: (x: number, z: number) => number;
  countMatureTreesInRadius?: (x: number, z: number, radius: number) => number;
  getRoadNetwork?: () => RoadNetwork;
  onPreviewChange?: (preview: BuildingTerrainSource | null) => void;
  onModeChanged: () => void;
  onPlacementRejected?: (reason: BuildingPlacementFailureReason) => void;
  onPlacementFailed?: (message: string) => void;
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
  private lastPreviewValidation: BuildingPlacementResult | null = null;
  private lastTerrainPreviewX = Number.NaN;
  private lastTerrainPreviewZ = Number.NaN;
  private readonly previewMoveThreshold = 0.35;
  private readonly terrainPreviewMoveThreshold = 0.45;
  private readonly undoStack: BuildingPlacementUndoEntry[] = [];
  private readonly redoStack: BuildingPlacementRedoEntry[] = [];
  private placementPending = false;

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

  isEnabled(): boolean {
    return this.mode !== 'off';
  }

  shouldBlockCameraInput(event: MouseEvent | WheelEvent): boolean {
    if (!this.isEnabled() || this.options.isBlocked()) return false;
    return event instanceof MouseEvent && event.button === 2;
  }

  setMode(mode: BuildingToolMode): void {
    if (mode !== 'off' && (this.options.isBlocked() || this.placementPending)) return;
    this.mode = mode;
    this.resetPreviewCache();
    if (mode === 'off') {
      this.clearPreview();
      this.options.onPreviewChange?.(null);
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
      this.options.onPreviewChange?.(null);
      return;
    }
    if (this.pointerDirty) {
      this.pointerDirty = false;
      this.processPointerHover();
    }
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
    this.options.onPreviewChange?.(null);
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
      this.options.onPreviewChange?.(null);
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
    this.placementPending = true;
    this.setMode('off');
    void this.placeAt(kind, resolved.x, resolved.z);
  };

  private async placeAt(kind: BuildingKind, x: number, z: number): Promise<void> {
    const beforeIds = new Set(this.options.getState().buildings.keys());
    const pendingSource = { kind, x, z };
    this.options.markers.showPendingPlacement(kind, x, z);
    this.options.onPreviewChange?.(pendingSource);
    try {
      await this.options.onPlaceBuilding(kind, x, z);
      this.placementPending = false;
      const buildingId = await waitForPlacedBuilding(this.options.getState, beforeIds, kind, x, z);
      this.options.markers.clearPendingPlacement();
      this.options.onPreviewChange?.(null);
      if (buildingId) {
        this.undoStack.push({ buildingId, kind, x, z });
        this.redoStack.length = 0;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Building placement failed.';
      console.error('Building placement failed:', error);
      this.options.onPlacementFailed?.(message);
      this.placementPending = false;
      this.options.markers.clearPendingPlacement();
      this.options.onPreviewChange?.(null);
      if (!this.options.isBlocked()) this.setMode(kind);
      return;
    }
  }

  private async undo(): Promise<void> {
    const entry = this.undoStack.pop();
    if (!entry) return;
    try {
      await this.options.onDemolishBuilding(entry.buildingId);
      this.redoStack.push({ kind: entry.kind, x: entry.x, z: entry.z });
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
      await this.options.onPlaceBuilding(entry.kind, entry.x, entry.z);
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
      this.options.onPreviewChange?.(null);
      return;
    }

    const point = this.options.terrainProjector.pick(this.pointerX, this.pointerY);
    if (!point) {
      this.clearPreview();
      this.options.onPreviewChange?.(null);
      return;
    }

    const resolved = this.resolvePoint(this.mode, point.x, point.z);
    this.refreshPreviewAt(new THREE.Vector3(resolved.x, point.y, resolved.z));
  }

  private refreshPreviewAt(point: THREE.Vector3): void {
    if (this.mode === 'off') return;
    const kind = this.mode;
    const definition = getBuildingDefinition(kind);
    const extent = getBuildingExtent(kind, definition.workRadius);
    const validation = this.validateAt(point.x, point.z);
    this.updateTerrainPreview(point.x, point.z);
    this.options.markers.setPlacementPreview(
      kind,
      point.x,
      point.z,
      extent?.radius ?? 0,
      validation.ok,
      true,
    );
  }

  private validateAt(x: number, z: number): BuildingPlacementResult {
    const dx = x - this.lastPreviewX;
    const dz = z - this.lastPreviewZ;
    if (this.lastPreviewValidation && Number.isFinite(this.lastPreviewX) && Math.hypot(dx, dz) < 0.02) {
      return this.lastPreviewValidation;
    }

    const result = this.validate(this.mode as BuildingKind, x, z);
    this.lastPreviewX = x;
    this.lastPreviewZ = z;
    this.lastPreviewValidation = result;
    return result;
  }

  private resetPreviewCache(): void {
    this.pointerDirty = false;
    this.lastPreviewX = Number.NaN;
    this.lastPreviewZ = Number.NaN;
    this.lastPreviewValidation = null;
    this.lastTerrainPreviewX = Number.NaN;
    this.lastTerrainPreviewZ = Number.NaN;
  }

  private updateTerrainPreview(x: number, z: number): void {
    const dx = x - this.lastTerrainPreviewX;
    const dz = z - this.lastTerrainPreviewZ;
    if (Number.isFinite(this.lastTerrainPreviewX) && Math.hypot(dx, dz) < this.terrainPreviewMoveThreshold) {
      return;
    }

    this.lastTerrainPreviewX = x;
    this.lastTerrainPreviewZ = z;
    this.options.onPreviewChange?.({ kind: this.mode as BuildingKind, x, z });
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
      quarries: state.quarries.values(),
      foragingNodes: state.foragingNodes.values(),
      stockpile: totals,
      isWaterAt: this.options.isWaterAt,
      isQuarryPitAt: this.options.isQuarryPitAt,
      getNaturalHeightAt: this.options.getNaturalHeightAt,
      countMatureTreesInRadius: this.options.countMatureTreesInRadius,
      roadNetwork: this.options.getRoadNetwork?.(),
    });
  }

  private resolvePoint(kind: BuildingKind, x: number, z: number): { x: number; z: number } {
    const state = this.options.getState();
    const resolved = resolveBuildingPlacementPoint(
      kind,
      x,
      z,
      state.quarries.values(),
    );
    if (kind !== 'foragers_shed') return resolved;

    const initialValidation = this.validate(kind, resolved.x, resolved.z);
    if (initialValidation.ok || initialValidation.reason === 'insufficient_resources') {
      return resolved;
    }
    for (const candidate of foragerPlacementCandidates(
      x,
      z,
      state.foragingNodes.values(),
    )) {
      if (this.validate(kind, candidate.x, candidate.z).ok) return candidate;
    }
    return resolved;
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
