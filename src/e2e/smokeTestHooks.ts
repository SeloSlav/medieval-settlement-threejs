import { validateBuildingPlacement } from '../buildings/BuildingPlacementValidation.ts';
import { computeResourceTotals } from '../resources/resourceTotals.ts';
import type { BuildingKind, GameState } from '../resources/types.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingToolMode } from '../buildings/BuildingTool.ts';

export type MedievalE2eHooks = {
  isConnected: () => boolean;
  getBuildingMode: () => BuildingToolMode;
  getHudTimber: () => string;
  getBuildingCount: () => number;
  placeRforesterAtFirstValidSpot: () => Promise<{ x: number; z: number }>;
};

type SmokeTestHookDeps = {
  getState: () => GameState;
  getBuildingMode: () => BuildingToolMode;
  isConnected: () => boolean;
  placeBuilding: (kind: BuildingKind, x: number, z: number) => Promise<void>;
  isWaterAt: (x: number, z: number) => boolean;
  isQuarryPitAt: (x: number, z: number) => boolean;
  getNaturalHeightAt: (x: number, z: number) => number;
  getRoadNetwork: () => RoadNetwork | null;
  playableHalf: number;
};

const REFORESTER_KIND: BuildingKind = 'reforester';
const GRID_STEP = 28;

export function createSmokeTestHooks(deps: SmokeTestHookDeps): MedievalE2eHooks {
  return {
    isConnected: deps.isConnected,
    getBuildingMode: deps.getBuildingMode,
    getHudTimber: () => readHudValue('timber'),
    getBuildingCount: () => deps.getState().buildings.size,
    placeRforesterAtFirstValidSpot: async () => {
      const spot = findFirstValidRforesterSpot(deps);
      if (!spot) {
        throw new Error('No valid reforester placement found for smoke test.');
      }
      await deps.placeBuilding(REFORESTER_KIND, spot.x, spot.z);
      return spot;
    },
  };
}

function readHudValue(resource: string): string {
  const element = document.querySelector<HTMLElement>(`[data-stockpile="${resource}"]`);
  return element?.textContent?.trim() ?? '';
}

function findFirstValidRforesterSpot(deps: SmokeTestHookDeps): { x: number; z: number } | null {
  const half = deps.playableHalf - 40;
  const state = deps.getState();
  const totals = computeResourceTotals(state);
  const roadNetwork = deps.getRoadNetwork() ?? undefined;

  for (let x = -half; x <= half; x += GRID_STEP) {
    for (let z = -half; z <= half; z += GRID_STEP) {
      const validation = validateBuildingPlacement(REFORESTER_KIND, x, z, {
        buildings: state.buildings.values(),
        burgageZones: state.burgageZones.values(),
        quarries: state.quarries.values(),
        foragingNodes: state.foragingNodes.values(),
        stockpile: totals,
        isWaterAt: deps.isWaterAt,
        isQuarryPitAt: deps.isQuarryPitAt,
        getNaturalHeightAt: deps.getNaturalHeightAt,
        roadNetwork,
      });
      if (validation.ok) {
        return { x, z };
      }
    }
  }

  return null;
}

export function installSmokeTestHooks(hooks: MedievalE2eHooks): void {
  (window as typeof window & { __medievalE2e?: MedievalE2eHooks }).__medievalE2e = hooks;
}
