import type { Quarry } from '../../generated/types.ts';
import type { ResourceNodeState } from '../../resources/types.ts';

export function syncQuarries(rows: Iterable<Quarry>): Map<string, ResourceNodeState> {
  const quarries = new Map<string, ResourceNodeState>();
  for (const row of rows) {
    const resource = row.quarryId.startsWith('deposit-iron-')
      ? 'iron'
      : row.quarryId.startsWith('deposit-salt-')
        ? 'salt'
        : 'stone';
    quarries.set(row.quarryId, {
      nodeId: row.quarryId,
      kind: 'quarry',
      resource,
      remaining: row.remaining,
      maxYield: row.maxYield,
      x: row.x,
      z: row.z,
      isRich: row.isRich,
    });
  }
  return quarries;
}
