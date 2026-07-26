import { validateBuildingPlacement } from '../buildings/BuildingPlacementValidation.ts';
import { computeResourceTotals } from '../resources/resourceTotals.ts';
import type { BuildingKind, GameState } from '../resources/types.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingToolMode } from '../buildings/BuildingTool.ts';

export type MedievalE2eHooks = {
  isConnected: () => boolean;
  getRendererStats: () => { backend: string; frames: number; calls: number; triangles: number };
  getBuildingMode: () => BuildingToolMode;
  getHudTimber: () => string;
  getBuildingCount: () => number;
  placeRforesterAtFirstValidSpot: () => Promise<{ x: number; z: number }>;
};

type SmokeTestHookDeps = {
  getState: () => GameState;
  getBuildingMode: () => BuildingToolMode;
  isConnected: () => boolean;
  getRendererStats: () => { backend: string; frames: number; calls: number; triangles: number };
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
    getRendererStats: deps.getRendererStats,
    getBuildingMode: deps.getBuildingMode,
    getHudTimber: () => readHudValue('timber'),
    getBuildingCount: () => deps.getState().buildings.size,
    placeRforesterAtFirstValidSpot: () => placeRforesterAtFirstAuthoritativeSpot(deps),
  };
}

function readHudValue(resource: string): string {
  const element = document.querySelector<HTMLElement>(`[data-stockpile="${resource}"]`);
  return element?.textContent?.trim() ?? '';
}

async function placeRforesterAtFirstAuthoritativeSpot(
  deps: SmokeTestHookDeps,
): Promise<{ x: number; z: number }> {
  const half = deps.playableHalf - 40;
  const state = deps.getState();
  const totals = computeResourceTotals(state);
  const roadNetwork = deps.getRoadNetwork() ?? undefined;
  let rejectedCandidates = 0;
  let lastRejection: unknown = null;

  for (let x = -half; x <= half; x += GRID_STEP) {
    for (let z = -half; z <= half; z += GRID_STEP) {
      const validation = validateBuildingPlacement(REFORESTER_KIND, x, z, {
        buildings: state.buildings.values(),
        residences: state.residences.values(),
        burgageZones: state.burgageZones.values(),
        quarries: state.quarries.values(),
        foragingNodes: state.foragingNodes.values(),
        stockpile: totals,
        isWaterAt: deps.isWaterAt,
        isQuarryPitAt: deps.isQuarryPitAt,
        getNaturalHeightAt: deps.getNaturalHeightAt,
        roadNetwork,
      });
      if (!validation.ok) continue;

      try {
        await deps.placeBuilding(REFORESTER_KIND, x, z);
        return { x, z };
      } catch (error) {
        // Other smoke-test identities share the persistent local world but are
        // intentionally absent from this player's state. Let the authoritative
        // reducer reject their occupied extents, then advance to the next spot.
        rejectedCandidates += 1;
        lastRejection = error;
      }
    }
  }

  const suffix = lastRejection instanceof Error ? ` Last rejection: ${lastRejection.message}` : '';
  throw new Error(
    `No authoritative reforester placement found after ${rejectedCandidates} server rejections.${suffix}`,
  );
}

export function installSmokeTestHooks(hooks: MedievalE2eHooks): void {
  (window as typeof window & { __medievalE2e?: MedievalE2eHooks }).__medievalE2e = hooks;
}
