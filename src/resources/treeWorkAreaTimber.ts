import { LOG_HEALTH_PER_TIMBER } from '../forestry/forestry.ts';
import type { TreeRegistry } from './TreeRegistry.ts';
import type { GameState, TreeWorkArea } from './types.ts';

/** Timber still in this woodland, before hauling it into building storage. */
export function timberInTreeWorkArea(
  state: Pick<GameState, 'trees'>,
  registry: Pick<TreeRegistry, 'treesInRadius'>,
  area: TreeWorkArea,
): number {
  let timber = 0;
  for (const layout of registry.treesInRadius(area.x, area.z, area.radius)) {
    const tree = state.trees.get(layout.id);
    if (!tree) continue;
    if (tree.phase === 'mature' || tree.phase === 'falling' || tree.phase === 'fallen') {
      timber += Math.max(0, Math.floor(layout.woodYield));
    } else {
      for (const log of tree.logs ?? []) {
        timber += Math.max(0, Math.floor(log.health / LOG_HEALTH_PER_TIMBER));
      }
    }
  }
  return timber;
}
