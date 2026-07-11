import type { ForagingNode } from '../../generated/types.ts';
import type { ForagingNodeState } from '../../resources/types.ts';

export function syncForagingNodes(rows: Iterable<ForagingNode>): Map<string, ForagingNodeState> {
  const foragingNodes = new Map<string, ForagingNodeState>();
  for (const row of rows) {
    const kind = row.nodeKind === 'game' ? 'game' : 'berries';
    foragingNodes.set(row.nodeId, {
      nodeId: row.nodeId,
      kind,
      resource: kind,
      remaining: row.remaining,
      maxYield: row.maxYield,
      x: row.x,
      z: row.z,
    });
  }
  return foragingNodes;
}
