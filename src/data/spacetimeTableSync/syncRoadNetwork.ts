import type { RoadNetworkState } from '../../generated/types.ts';
import type { RoadNetworkSnapshot } from '../../roads/RoadNetwork.ts';

export const EMPTY_ROAD_SNAPSHOT: RoadNetworkSnapshot = {
  nextNodeId: 1,
  nextEdgeId: 1,
  nodes: [],
  edges: [],
};

export function syncRoadNetwork(
  rows: Iterable<RoadNetworkState>,
  identityHex: string | null,
): RoadNetworkSnapshot | null {
  if (!identityHex) return null;

  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    try {
      return JSON.parse(row.snapshotJson) as RoadNetworkSnapshot;
    } catch {
      return { ...EMPTY_ROAD_SNAPSHOT };
    }
  }
  return null;
}
