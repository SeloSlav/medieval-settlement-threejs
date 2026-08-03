import type { RoadNetwork } from './RoadNetwork.ts';
import { isRockNearPath, type RockObstacle } from '../utils/pathGeometry.ts';

/** Returns decorative-rock indices whose visible footprint intersects a road. */
export function collectRoadRemovedRockIndices(
  rocks: readonly RockObstacle[],
  network: RoadNetwork | null,
): Set<number> {
  const removed = new Set<number>();
  if (!network || network.edges.size === 0) return removed;

  const edges = [...network.edges.values()];
  for (let index = 0; index < rocks.length; index++) {
    const rock = rocks[index];
    for (const edge of edges) {
      const path = edge.sampledPath.length >= 2 ? edge.sampledPath : edge.controlPoints;
      if (path.length < 2) continue;
      if (isRockNearPath(rock, path, edge.width * 0.5)) {
        removed.add(index);
        break;
      }
    }
  }
  return removed;
}
