import type { TreeEntity } from '../../generated/types.ts';
import type { TreeEntityState, TreePhase } from '../../resources/types.ts';
import { isTreePhase } from '../../resources/types.ts';

function normalizeTreePhase(value: string): TreePhase {
  if (isTreePhase(value)) return value;
  return 'mature';
}

export function syncTrees(rows: Iterable<TreeEntity>): Map<string, TreeEntityState> {
  const trees = new Map<string, TreeEntityState>();
  for (const row of rows) {
    trees.set(row.treeId, {
      treeId: row.treeId,
      layoutIndex: Number(row.layoutIndex),
      phase: normalizeTreePhase(row.phase),
      growthProgress: row.growthProgress,
    });
  }
  return trees;
}
