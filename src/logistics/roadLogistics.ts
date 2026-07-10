import { BUILDING_ROAD_ACCESS_DISTANCE } from '../generated/gameBalance.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import { residenceFirewoodRunwaySeconds } from '../resources/resourceTotals.ts';
import { distancePointToPolylineXZ } from '../utils/pathGeometry.ts';

type RoadPoint = { x: number; z: number };

function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

function polylineLength(path: readonly RoadPoint[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += distance(path[i].x, path[i].z, path[i + 1].x, path[i + 1].z);
  }
  return total;
}

function snapNodes(network: RoadNetwork, x: number, z: number): string[] | null {
  const maxSnap = BUILDING_ROAD_ACCESS_DISTANCE;
  let bestDistance = maxSnap;
  let bestNodes: string[] = [];

  for (const node of network.nodes.values()) {
    const dist = distance(x, z, node.position.x, node.position.z);
    if (dist > bestDistance + 1e-6) continue;
    if (dist < bestDistance - 1e-6) {
      bestDistance = dist;
      bestNodes = [node.id];
    } else if (Math.abs(dist - bestDistance) <= 1e-6) {
      bestNodes.push(node.id);
    }
  }

  for (const edge of network.edges.values()) {
    if (edge.sampledPath.length < 2) continue;
    const dist = distancePointToPolylineXZ(x, z, edge.sampledPath);
    if (dist > bestDistance + 1e-6) continue;
    if (dist < bestDistance - 1e-6) {
      bestDistance = dist;
      bestNodes = [edge.startNodeId, edge.endNodeId];
    }
  }

  return bestNodes.length > 0 ? [...new Set(bestNodes)] : null;
}

function shareComponent(network: RoadNetwork, startNodes: string[], targetNodes: string[]): boolean {
  const targets = new Set(targetNodes);
  const visited = new Set<string>();
  const queue = [...startNodes];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || visited.has(node)) continue;
    visited.add(node);
    if (targets.has(node)) return true;
    const nodeData = network.nodes.get(node);
    if (!nodeData) continue;
    for (const edgeId of nodeData.edgeIds) {
      const edge = network.edges.get(edgeId);
      if (!edge) continue;
      const neighbor = edge.startNodeId === node ? edge.endNodeId : edge.startNodeId;
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }

  return false;
}

export function roadPathDistance(
  network: RoadNetwork,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number | null {
  const nodesA = snapNodes(network, ax, az);
  const nodesB = snapNodes(network, bx, bz);
  if (!nodesA || !nodesB || !shareComponent(network, nodesA, nodesB)) return null;

  const graph = new Map<string, Array<{ id: string; weight: number }>>();
  for (const edge of network.edges.values()) {
    const weight = polylineLength(edge.sampledPath.map((point) => ({ x: point.x, z: point.z })));
    const start = graph.get(edge.startNodeId) ?? [];
    start.push({ id: edge.endNodeId, weight });
    graph.set(edge.startNodeId, start);
    const end = graph.get(edge.endNodeId) ?? [];
    end.push({ id: edge.startNodeId, weight });
    graph.set(edge.endNodeId, end);
  }

  const dist = new Map<string, number>();
  const heap: Array<{ cost: number; id: string }> = [];
  for (const nodeId of nodesA) {
    const node = network.nodes.get(nodeId);
    if (!node) continue;
    const cost = distance(ax, az, node.position.x, node.position.z);
    dist.set(nodeId, cost);
    heap.push({ cost, id: nodeId });
  }

  while (heap.length > 0) {
    heap.sort((a, b) => a.cost - b.cost);
    const current = heap.shift();
    if (!current) break;
    const best = dist.get(current.id);
    if (best == null || current.cost > best + 1e-6) continue;

    for (const neighbor of graph.get(current.id) ?? []) {
      const next = current.cost + neighbor.weight;
      const existing = dist.get(neighbor.id);
      if (existing != null && next + 1e-6 >= existing) continue;
      dist.set(neighbor.id, next);
      heap.push({ cost: next, id: neighbor.id });
    }
  }

  let best = Infinity;
  for (const nodeId of nodesB) {
    const roadCost = dist.get(nodeId);
    const node = network.nodes.get(nodeId);
    if (roadCost == null || !node) continue;
    best = Math.min(
      best,
      roadCost + distance(bx, bz, node.position.x, node.position.z),
    );
  }

  return Number.isFinite(best) ? best : null;
}

export function claimResidencesForLodges(
  network: RoadNetwork,
  lodges: readonly BuildingState[],
  residences: readonly ResidenceState[],
): Map<string, string> {
  const claims = new Map<string, string>();
  const woodcutters = lodges.filter((building) => building.kind === 'woodcutters_lodge');

  for (const residence of residences) {
    if (residence.abandoned) continue;
    let bestLodge: BuildingState | null = null;
    let bestDistance = Infinity;
    for (const lodge of woodcutters) {
      const pathDistance = roadPathDistance(network, lodge.x, lodge.z, residence.x, residence.z);
      if (pathDistance == null) continue;
      if (
        pathDistance + 1e-6 < bestDistance
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && bestLodge && lodge.id < bestLodge.id)
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && !bestLodge)
      ) {
        bestDistance = pathDistance;
        bestLodge = lodge;
      }
    }
    if (bestLodge) claims.set(residence.id, bestLodge.id);
  }

  return claims;
}

export function sortByRoadPathDistance<T extends { x: number; z: number }>(
  network: RoadNetwork,
  origin: { x: number; z: number },
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const da = roadPathDistance(network, origin.x, origin.z, a.x, a.z) ?? Infinity;
    const db = roadPathDistance(network, origin.x, origin.z, b.x, b.z) ?? Infinity;
    return da - db;
  });
}

/** Lowest firewood runway first; tie-break by road-path distance, then residence id. */
export function sortResidencesForDelivery(
  network: RoadNetwork,
  lodge: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState[] {
  return [...residences].sort((a, b) => {
    const runwayA = residenceFirewoodRunwaySeconds(a) ?? Infinity;
    const runwayB = residenceFirewoodRunwaySeconds(b) ?? Infinity;
    if (Math.abs(runwayA - runwayB) > 1e-6) return runwayA - runwayB;
    const distanceA = roadPathDistance(network, lodge.x, lodge.z, a.x, a.z) ?? Infinity;
    const distanceB = roadPathDistance(network, lodge.x, lodge.z, b.x, b.z) ?? Infinity;
    if (Math.abs(distanceA - distanceB) > 1e-6) return distanceA - distanceB;
    return a.id.localeCompare(b.id);
  });
}
