import type { ForagingNode } from '../../generated/types.ts';
import { isRichForagingCapacity } from '../../foraging/foragingYields.ts';
import type { ForagingNodeState } from '../../resources/types.ts';
import { wholeResourceUnits } from '../../resources/resourceUnits.ts';

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
      remaining: wholeResourceUnits(row.remaining),
      maxYield: wholeResourceUnits(row.maxYield),
      x: row.x,
      z: row.z,
      isRich: isRichForagingCapacity(kind, row.maxYield),
    });
  }
  return foragingNodes;
}
