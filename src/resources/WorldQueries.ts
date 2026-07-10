import type { Terrain } from '../terrain/Terrain.ts';
import type { RiverField } from '../rivers/RiverField.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { GameState, InspectableTarget, QuarryNodeState } from './types.ts';
import type { WorldLayoutRegistry } from './WorldLayoutRegistry.ts';
import { buildingKindLabel, findNearestBuilding as findBuilding } from './WorldLayoutRegistry.ts';
import { countTreesNearBuilding } from './ForestVisualSync.ts';
import type { TreeRegistry } from './TreeRegistry.ts';

const RIVER_INSPECT_MAX_SHORE = 8;
const NEAREST_ROAD_MAX_DISTANCE = 18;

export class WorldQueries {
  private readonly terrain: Terrain;
  private readonly riverField: RiverField;
  private readonly registry: WorldLayoutRegistry;
  private readonly getGameState: () => GameState;
  private readonly getRoadNetwork: () => RoadNetwork;
  private readonly getTreeRegistry: () => TreeRegistry | null;

  constructor(options: {
    terrain: Terrain;
    riverField: RiverField;
    registry: WorldLayoutRegistry;
    getGameState: () => GameState;
    getRoadNetwork: () => RoadNetwork;
    getTreeRegistry: () => TreeRegistry | null;
  }) {
    this.terrain = options.terrain;
    this.riverField = options.riverField;
    this.registry = options.registry;
    this.getGameState = options.getGameState;
    this.getRoadNetwork = options.getRoadNetwork;
    this.getTreeRegistry = options.getTreeRegistry;
  }

  getHeightAt(x: number, z: number): number {
    return this.terrain.getHeightAt(x, z);
  }

  getRiverAccessInfo(x: number, z: number): { shoreDistance: number; onWater: boolean } {
    return {
      onWater: this.riverField.isRenderedWetAt(x, z),
      shoreDistance: this.riverField.sampleShoreDistance(x, z),
    };
  }

  findInspectableTarget(x: number, z: number): InspectableTarget | null {
    const state = this.getGameState();
    const building = findBuilding(state.buildings.values(), x, z);
    if (building) {
      const treeRegistry = this.getTreeRegistry();
      const counts = treeRegistry
        ? countTreesNearBuilding(state, treeRegistry, building.x, building.z, building.workRadius)
        : { matureTrees: 0, stumpTrees: 0, growingTrees: 0 };
      return {
        kind: 'building',
        building,
        matureTrees: counts.matureTrees,
        stumpTrees: counts.stumpTrees,
        growingTrees: counts.growingTrees,
      };
    }

    const quarryDefinition = this.registry.findNearestQuarry(x, z);
    if (quarryDefinition) {
      const quarryState = state.quarries.get(quarryDefinition.id);
      if (quarryState) {
        return { kind: 'quarry', definition: quarryDefinition, state: quarryState };
      }
    }

    const river = this.getRiverAccessInfo(x, z);
    if (river.onWater || river.shoreDistance <= RIVER_INSPECT_MAX_SHORE) {
      return { kind: 'river', x, z, ...river };
    }

    return null;
  }

  getNearestRoadNodeDistance(x: number, z: number): number | null {
    const network = this.getRoadNetwork();
    let best: number | null = null;

    for (const node of network.nodes.values()) {
      const distance = Math.hypot(x - node.position.x, z - node.position.z);
      if (distance > NEAREST_ROAD_MAX_DISTANCE) continue;
      if (best == null || distance < best) best = distance;
    }

    return best;
  }

  getBuildingLabel(kind: Parameters<typeof buildingKindLabel>[0]): string {
    return buildingKindLabel(kind);
  }

  findNearestQuarryWithRemaining(x: number, z: number, radius: number): QuarryNodeState | null {
    const state = this.getGameState();
    let best: QuarryNodeState | null = null;
    let bestDistance = Infinity;

    for (const definition of this.registry.definitionList) {
      const quarryState = state.quarries.get(definition.id);
      if (!quarryState || quarryState.remaining <= 0) continue;
      const distance = Math.hypot(x - definition.x, z - definition.z);
      if (distance > radius || distance >= bestDistance) continue;
      bestDistance = distance;
      best = quarryState;
    }

    return best;
  }
}
