import type { ForestManager } from '../props/ForestManager.ts';
import type { GameState, TreeEntityState } from './types.ts';

export class ForestVisualSync {
  private readonly forestManager: ForestManager;

  constructor(forestManager: ForestManager) {
    this.forestManager = forestManager;
  }

  syncAll(trees: Map<string, TreeEntityState>): void {
    this.syncAuthoritativeTreeLayouts(trees);
    this.forestManager.applyTreePhases(trees.values());
  }

  syncAuthoritativeTreeLayouts(trees: Map<string, TreeEntityState>): void {
    this.forestManager.syncAuthoritativeTreeLayouts(
      [...trees.values()].map((entity) => entity.layoutIndex),
    );
  }

  removeTreeLayouts(layoutIndices: Iterable<number>): void {
    this.forestManager.removeAuthoritativeTreeLayouts(layoutIndices);
  }

  syncTrees(trees: Map<string, TreeEntityState>, treeIds: string[]): void {
    const changedTrees: TreeEntityState[] = [];
    for (const treeId of treeIds) {
      const entity = trees.get(treeId);
      if (entity) changedTrees.push(entity);
    }
    this.forestManager.applyTreePhases(changedTrees);
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
