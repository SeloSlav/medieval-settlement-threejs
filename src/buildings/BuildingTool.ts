import type { TerrainProjector } from '../terrain/TerrainProjector.ts';
import type { BuildingKind, GameState } from '../resources/types.ts';
import { placeBuilding } from '../resources/GameState.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { BuildingMarkers } from './BuildingMarkers.ts';

export type BuildingToolMode = BuildingKind | 'off';

type BuildingToolOptions = {
  domElement: HTMLElement;
  terrainProjector: TerrainProjector;
  markers: BuildingMarkers;
  getState: () => GameState;
  onPlaced: (state: GameState) => void;
  /** When set (SpacetimeDB connected), placement goes through the server reducer. */
  onPlaceBuilding?: (kind: BuildingKind, x: number, z: number) => void | Promise<void>;
  isBlocked: () => boolean;
};

export class BuildingTool {
  private readonly options: BuildingToolOptions;
  private mode: BuildingToolMode = 'off';

  constructor(options: BuildingToolOptions) {
    this.options = options;
    options.domElement.addEventListener('mousedown', this.onPointerDown, { capture: true });
  }

  getMode(): BuildingToolMode {
    return this.mode;
  }

  isEnabled(): boolean {
    return this.mode !== 'off';
  }

  setMode(mode: BuildingToolMode): void {
    this.mode = mode;
    if (mode === 'off') {
      this.options.markers.setPlacementPreview(0, 0, 0, false);
    }
  }

  toggleMode(kind: BuildingKind): void {
    this.setMode(this.mode === kind ? 'off' : kind);
  }

  dispose(): void {
    this.options.domElement.removeEventListener('mousedown', this.onPointerDown, { capture: true });
  }

  private readonly onPointerDown = (event: MouseEvent): void => {
    if (event.button !== 0 || this.mode === 'off') return;
    if (this.options.isBlocked()) return;

    const point = this.options.terrainProjector.pick(event.clientX, event.clientY);
    if (!point) return;

    event.preventDefault();
    event.stopPropagation();

    if (this.options.onPlaceBuilding) {
      void Promise.resolve(this.options.onPlaceBuilding(this.mode, point.x, point.z)).catch((error) => {
        console.error('Building placement failed:', error);
      });
      return;
    }

    const result = placeBuilding(this.options.getState(), this.mode, point.x, point.z);
    if (!result.ok) return;

    this.options.onPlaced(result.state);
    this.options.markers.syncBuildings(result.state.buildings.values());
  };
}

export function getBuildingToolLabel(mode: BuildingToolMode): string {
  if (mode === 'off') return 'Building tool off';
  return `${getBuildingDefinition(mode).label} placement`;
}
