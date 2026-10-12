import type { RoadNetwork } from './RoadNetwork.ts';
import type { RockObstacle } from '../utils/pathGeometry.ts';
import { RoadClearanceIndex } from './RoadClearanceIndex.ts';

/** Returns decorative-rock indices whose visible footprint intersects a road. */
export function collectRoadRemovedRockIndices(
  rocks: readonly RockObstacle[],
  network: RoadNetwork | null,
): Set<number> {
  const removed = new Set<number>();
  if (!network || network.edges.size === 0) return removed;

  const clearance = new RoadClearanceIndex([...network.edges.values()]);
  for (let index = 0; index < rocks.length; index++) {
    const rock = rocks[index];
    if (clearance.isNear(rock.x,rock.z,rock.scale*1.35,0.8)) removed.add(index);
  }
  return removed;
}
