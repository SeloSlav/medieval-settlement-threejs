import { BUILDING_ROAD_ACCESS_DISTANCE } from '../generated/gameBalance.ts';
import { RESIDENCE_FIREWOOD_CAPACITY, RESIDENCE_WATER_CAPACITY } from '../generated/gameBalance.ts';
import { getNeedStock, hasNeedStockRoom } from '../residences/residenceNeedState.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingState, ResidenceState } from '../resources/types.ts';
import { residenceFirewoodRunwaySeconds } from './firewoodLogistics.ts';
import { isResidenceInWellRange, residenceWaterRunwaySeconds } from './waterLogistics.ts';
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

function buildWeightedGraph(network: RoadNetwork): Map<string, Array<{ id: string; weight: number }>> {
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
  return graph;
}

function appendPoint(path: RoadPoint[], point: RoadPoint): void {
  const last = path[path.length - 1];
  if (last && distance(last.x, last.z, point.x, point.z) <= 1e-6) return;
  path.push(point);
}

function edgePolylineBetween(
  network: RoadNetwork,
  from: string,
  to: string,
): RoadPoint[] | null {
  for (const edge of network.edges.values()) {
    const points = edge.sampledPath.map((point) => ({ x: point.x, z: point.z }));
    if (edge.startNodeId === from && edge.endNodeId === to) return points;
    if (edge.endNodeId === from && edge.startNodeId === to) return [...points].reverse();
  }

  const fromNode = network.nodes.get(from);
  const toNode = network.nodes.get(to);
  if (!fromNode || !toNode) return null;
  return [
    { x: fromNode.position.x, z: fromNode.position.z },
    { x: toNode.position.x, z: toNode.position.z },
  ];
}

function materializePolyline(
  network: RoadNetwork,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  nodePath: readonly string[],
): RoadPoint[] {
  const path: RoadPoint[] = [{ x: ax, z: az }];
  for (let i = 0; i < nodePath.length - 1; i++) {
    const segment = edgePolylineBetween(network, nodePath[i], nodePath[i + 1]);
    if (!segment) continue;
    for (const point of segment) appendPoint(path, point);
  }
  appendPoint(path, { x: bx, z: bz });
  return path;
}

function shortestPathSolve(
  network: RoadNetwork,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { nodePath: string[] } | null {
  const nodesA = snapNodes(network, ax, az);
  const nodesB = snapNodes(network, bx, bz);
  if (!nodesA || !nodesB || !shareComponent(network, nodesA, nodesB)) return null;

  const graph = buildWeightedGraph(network);
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const heap: Array<{ cost: number; id: string }> = [];

  for (const nodeId of nodesA) {
    const node = network.nodes.get(nodeId);
    if (!node) continue;
    const cost = distance(ax, az, node.position.x, node.position.z);
    dist.set(nodeId, cost);
    prev.set(nodeId, null);
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
      prev.set(neighbor.id, current.id);
      heap.push({ cost: next, id: neighbor.id });
    }
  }

  let bestEnd: string | null = null;
  let bestTotal = Infinity;
  for (const nodeId of nodesB) {
    const roadCost = dist.get(nodeId);
    const node = network.nodes.get(nodeId);
    if (roadCost == null || !node) continue;
    const total = roadCost + distance(bx, bz, node.position.x, node.position.z);
    if (total + 1e-6 < bestTotal) {
      bestTotal = total;
      bestEnd = nodeId;
    }
  }

  if (!bestEnd || !Number.isFinite(bestTotal)) return null;

  const nodePath: string[] = [];
  let cursor: string | null = bestEnd;
  while (cursor) {
    nodePath.push(cursor);
    cursor = prev.get(cursor) ?? null;
  }
  nodePath.reverse();
  return { nodePath };
}

export function roadPathRoute(
  network: RoadNetwork,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { distance: number; polyline: RoadPoint[] } | null {
  const solve = shortestPathSolve(network, ax, az, bx, bz);
  if (!solve) return null;
  const polyline = materializePolyline(network, ax, az, bx, bz, solve.nodePath);
  const travelDistance = polylineLength(polyline);
  if (travelDistance <= 1e-6) return null;
  return { distance: travelDistance, polyline };
}

/** Travel distance along the road graph polyline (matches server trip movement). */
export function roadPathDistance(
  network: RoadNetwork,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number | null {
  return roadPathRoute(network, ax, az, bx, bz)?.distance ?? null;
}

export function claimResidencesForLodges(
  network: RoadNetwork,
  lodges: readonly BuildingState[],
  residences: readonly ResidenceState[],
): Map<string, string> {
  const claims = new Map<string, string>();
  const woodcutters = lodges.filter((building) => building.kind === 'woodcutters_lodge');

  for (const residence of residences) {
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

export function claimResidencesForWells(
  network: RoadNetwork,
  wells: readonly BuildingState[],
  residences: readonly ResidenceState[],
): Map<string, string> {
  const claims = new Map<string, string>();
  const activeWells = wells.filter((building) => building.kind === 'well');

  for (const residence of residences) {
    let bestWell: BuildingState | null = null;
    let bestDistance = Infinity;
    for (const well of activeWells) {
      if (!isResidenceInWellRange(well, residence)) continue;
      const pathDistance = roadPathDistance(network, well.x, well.z, residence.x, residence.z);
      if (pathDistance == null) continue;
      if (
        pathDistance + 1e-6 < bestDistance
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && bestWell && well.id < bestWell.id)
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && !bestWell)
      ) {
        bestDistance = pathDistance;
        bestWell = well;
      }
    }
    if (bestWell) claims.set(residence.id, bestWell.id);
  }

  return claims;
}

export function claimResidencesForFoodSuppliers(
  network: RoadNetwork,
  suppliers: readonly BuildingState[],
  residences: readonly ResidenceState[],
): Map<string, string> {
  const claims = new Map<string, string>();
  const foodSuppliers = suppliers.filter(
    (building) => building.kind === 'hunters_hall' || building.kind === 'foragers_shed',
  );

  for (const residence of residences) {
    let bestSupplier: BuildingState | null = null;
    let bestDistance = Infinity;
    for (const supplier of foodSuppliers) {
      const pathDistance = roadPathDistance(network, supplier.x, supplier.z, residence.x, residence.z);
      if (pathDistance == null) continue;
      if (
        pathDistance + 1e-6 < bestDistance
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && bestSupplier && supplier.id < bestSupplier.id)
        || (Math.abs(pathDistance - bestDistance) <= 1e-6 && !bestSupplier)
      ) {
        bestDistance = pathDistance;
        bestSupplier = supplier;
      }
    }
    if (bestSupplier) claims.set(residence.id, bestSupplier.id);
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
export function compareResidencesForDelivery(
  network: RoadNetwork,
  lodge: { x: number; z: number },
  a: ResidenceState,
  b: ResidenceState,
): number {
  if (a.abandoned !== b.abandoned) {
    return a.abandoned ? 1 : -1;
  }
  const runwayA = residenceFirewoodRunwaySeconds(a) ?? Infinity;
  const runwayB = residenceFirewoodRunwaySeconds(b) ?? Infinity;
  if (Math.abs(runwayA - runwayB) > 1e-6) return runwayA - runwayB;
  const distanceA = roadPathDistance(network, lodge.x, lodge.z, a.x, a.z) ?? Infinity;
  const distanceB = roadPathDistance(network, lodge.x, lodge.z, b.x, b.z) ?? Infinity;
  if (Math.abs(distanceA - distanceB) > 1e-6) return distanceA - distanceB;
  return a.id.localeCompare(b.id);
}

export function sortResidencesForDelivery(
  network: RoadNetwork,
  lodge: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState[] {
  return [...residences].sort((a, b) => compareResidencesForDelivery(network, lodge, a, b));
}

/** O(n) peek at the next needy residence without sorting the full branch. */
export function peekNextDeliveryTarget(
  network: RoadNetwork,
  lodge: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState | null {
  let best: ResidenceState | null = null;
  for (const residence of residences) {
    if (!hasNeedStockRoom(getNeedStock(residence.needs, 'firewood'), RESIDENCE_FIREWOOD_CAPACITY)) continue;
    if (best == null || compareResidencesForDelivery(network, lodge, residence, best) < 0) {
      best = residence;
    }
  }
  return best;
}

export function compareResidencesForWaterDelivery(
  network: RoadNetwork,
  well: { x: number; z: number },
  a: ResidenceState,
  b: ResidenceState,
): number {
  if (a.abandoned !== b.abandoned) {
    return a.abandoned ? 1 : -1;
  }
  const runwayA = residenceWaterRunwaySeconds(a) ?? Infinity;
  const runwayB = residenceWaterRunwaySeconds(b) ?? Infinity;
  if (Math.abs(runwayA - runwayB) > 1e-6) return runwayA - runwayB;
  const distanceA = roadPathDistance(network, well.x, well.z, a.x, a.z) ?? Infinity;
  const distanceB = roadPathDistance(network, well.x, well.z, b.x, b.z) ?? Infinity;
  if (Math.abs(distanceA - distanceB) > 1e-6) return distanceA - distanceB;
  return a.id.localeCompare(b.id);
}

export function sortResidencesForWaterDelivery(
  network: RoadNetwork,
  well: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState[] {
  return [...residences].sort((a, b) => compareResidencesForWaterDelivery(network, well, a, b));
}

export function peekNextWaterDeliveryTarget(
  network: RoadNetwork,
  well: { x: number; z: number },
  residences: readonly ResidenceState[],
): ResidenceState | null {
  let best: ResidenceState | null = null;
  for (const residence of residences) {
    if (!hasNeedStockRoom(getNeedStock(residence.needs, 'water'), RESIDENCE_WATER_CAPACITY)) continue;
    if (best == null || compareResidencesForWaterDelivery(network, well, residence, best) < 0) {
      best = residence;
    }
  }
  return best;
}
