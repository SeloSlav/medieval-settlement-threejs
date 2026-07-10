import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { BuildingKind, GameState } from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingPlacementFailureReason, BuildingPlacementResult } from './BuildingPlacementValidation.ts';
import { validateBuildingPlacement } from './BuildingPlacementValidation.ts';
import type { BuildingMarkers } from './BuildingMarkers.ts';
import type { BuildingTerrainSource } from './BuildingTerrainLayout.ts';

export type BuildingToolMode = BuildingKind | 'off';

type BuildingToolOptions = {
  domElement: HTMLElement;
  terrainProjector: TerrainProjector;
  markers: BuildingMarkers;
  getState: () => GameState;
  onPlaceBuilding: (kind: BuildingKind, x: number, z: number) => void | Promise<void>;
  isWaterAt: (x: number, z: number) => boolean;
  getNaturalHeightAt: (x: number, z: number) => number;
  onPreviewChange?: (preview: BuildingTerrainSource | null) => void;
  onModeChanged: () => void;
  onPlacementRejected?: (reason: BuildingPlacementFailureReason) => void;
  onPlacementFailed?: (message: string) => void;
  isBlocked: () => boolean;
};

export class BuildingTool {
  private readonly options: BuildingToolOptions;
  private mode: BuildingToolMode = 'off';
  private pointerX = 0;
  private pointerY = 0;
  private pointerInside = false;
  private lastPreviewX = Number.NaN;
  private lastPreviewZ = Number.NaN;
  private lastPreviewValidation: BuildingPlacementResult | null = null;
  private lastTerrainPreviewX = Number.NaN;
  private lastTerrainPreviewZ = Number.NaN;
  private readonly terrainPreviewMoveThreshold = 0.45;

  constructor(options: BuildingToolOptions) {
    this.options = options;
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
    options.domElement.addEventListener('mousemove', this.onPointerMove);
    options.domElement.addEventListener('mouseenter', this.onPointerEnter);
    options.domElement.addEventListener('mouseleave', this.onPointerLeave);
  }

  getMode(): BuildingToolMode {
    return this.mode;
  }

  isEnabled(): boolean {
    return this.mode !== 'off';
  }

  setMode(mode: BuildingToolMode): void {
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
    if (this.mode === 'off' || !this.pointerInside) return;
    this.refreshPreview();
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
    this.options.domElement.removeEventListener('mousemove', this.onPointerMove);
    this.options.domElement.removeEventListener('mouseenter', this.onPointerEnter);
    this.options.domElement.removeEventListener('mouseleave', this.onPointerLeave);
  }

  private readonly onPointerEnter = (): void => {
    this.pointerInside = true;
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.clearPreview();
    this.options.onPreviewChange?.(null);
  };

  private readonly onPointerMove = (event: MouseEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
  };

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (event.button !== 0 || this.mode === 'off') return;
    if (this.options.isBlocked()) return;

    const point = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!point) return;

    const validation = this.validate(this.mode, point.x, point.z);
    if (!validation.ok) {
      event.preventDefault();
      event.stopPropagation();
      this.options.onPlacementRejected?.(validation.reason);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    void this.placeAt(this.mode, point.x, point.z);
  };

  private async placeAt(kind: BuildingKind, x: number, z: number): Promise<void> {
    try {
      await this.options.onPlaceBuilding(kind, x, z);
      this.setMode('off');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Building placement failed.';
      console.error('Building placement failed:', error);
      this.options.onPlacementFailed?.(message);
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

    const definition = getBuildingDefinition(this.mode);
    const validation = this.validateAt(point.x, point.z);
    this.updateTerrainPreview(point.x, point.z);
    this.options.markers.setPlacementPreview(
      this.mode,
      point.x,
      point.z,
      definition.workRadius,
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
    return validateBuildingPlacement(kind, x, z, {
      buildings: this.options.getState().buildings.values(),
      stockpile: this.options.getState().stockpile,
      isWaterAt: this.options.isWaterAt,
      getNaturalHeightAt: this.options.getNaturalHeightAt,
    });
  }

  private clearPreview(): void {
    this.resetPreviewCache();
    this.options.markers.clearPlacementPreview();
  }
}

export function getBuildingToolLabel(mode: BuildingToolMode): string {
  if (mode === 'off') return 'Building tool off';
  return `${getBuildingDefinition(mode).label} placement`;
}
