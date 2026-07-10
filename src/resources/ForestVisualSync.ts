import type { ForestManager } from '../props/ForestManager.ts';
import type { GameState, TreeEntityState } from './types.ts';

export class ForestVisualSync {
  private readonly forestManager: ForestManager;

  constructor(forestManager: ForestManager) {
    this.forestManager = forestManager;
  }

  syncAll(trees: Map<string, TreeEntityState>): void {
    for (const entity of trees.values()) {
      this.syncTree(entity);
    }
  }

  syncTrees(trees: Map<string, TreeEntityState>, treeIds: string[]): void {
    for (const treeId of treeIds) {
      const entity = trees.get(treeId);
      if (entity) this.syncTree(entity);
    }
  }

  private syncTree(entity: TreeEntityState): void {
    this.forestManager.applyTreePhase(entity.layoutIndex, entity.phase, entity.growthProgress);
  }
}

export function countTreesNearBuilding(
  state: GameState,
  treeRegistry: { treesInRadius(x: number, z: number, radius: number): { id: string }[] },
  x: number,
  z: number,
  radius: number,
): { matureTrees: number; stumpTrees: number; growingTrees: number } {
  let matureTrees = 0;
  let stumpTrees = 0;
  let growingTrees = 0;

  for (const entry of treeRegistry.treesInRadius(x, z, radius)) {
    const entity = state.trees.get(entry.id);
    if (!entity) continue;
    switch (entity.phase) {
      case 'mature':
        matureTrees++;
        break;
      case 'stump':
        stumpTrees++;
        break;
      case 'growing':
        growingTrees++;
        break;
      default: {
        const unreachable: never = entity.phase;
        return unreachable;
      }
    }
  }

  return { matureTrees, stumpTrees, growingTrees };
}
