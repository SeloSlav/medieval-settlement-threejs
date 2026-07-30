import type { ForagingNode } from '../../generated/types.ts';
import { GAME_PATCH_MAX_YIELD } from '../../foraging/foragingYields.ts';
import type { ForagingNodeState } from '../../resources/types.ts';

export function syncForagingNodes(rows: Iterable<ForagingNode>): Map<string, ForagingNodeState> {
  const foragingNodes = new Map<string, ForagingNodeState>();
  for (const row of rows) {
    // Clay uses the shared natural-resource table for its physical reserve.
    // syncQuarries projects it into geological state rather than forage state.
    if (row.nodeKind === 'clay') continue;
    const kind = row.nodeKind === 'game'
      ? 'game'
      : row.nodeKind === 'fish'
        ? 'fish'
        : row.nodeKind === 'mushrooms'
          ? 'mushrooms'
          : 'berries';
    foragingNodes.set(row.nodeId, {
      nodeId: row.nodeId,
      kind,
      resource: kind,
      remaining: row.remaining,
      maxYield: row.maxYield,
      x: row.x,
      z: row.z,
      isRich: (kind === 'fish' && row.maxYield >= 200)
        || (kind === 'game' && row.maxYield > GAME_PATCH_MAX_YIELD),
    });
  }
  return foragingNodes;
}
